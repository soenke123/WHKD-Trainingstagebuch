-- WHKD Trainingstagebuch — Migration Single-Tenant → Multi-Tenant
-- Einmal im Supabase SQL-Editor der BESTEHENDEN Kiel-Datenbank ausführen.
-- Legt schools/trainers an, hängt school_id an alle Fakt-Tabellen, migriert
-- die vorhandenen Zeilen auf die Schule 'kiel' und ersetzt die alten
-- RLS-Policies durch schul-gescopte.
--
-- Idempotenz: NEIN. Ein zweiter Lauf schlägt fehl (Tabellen existieren
-- bereits). Bei Problemen ganze Transaktion rollback'en und Fehler prüfen.

begin;

-- ─── 1. Neue Tabellen ──────────────────────────────────────────────────────

create table schools (
  id bigserial primary key,
  slug text not null unique,
  name text not null,
  created_at timestamptz default now()
);

create table trainers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  school_id bigint not null references schools(id) on delete cascade,
  slug text not null,
  display_name text not null,
  color text,
  created_at timestamptz default now(),
  unique (school_id, slug)
);
create index trainers_school_idx on trainers (school_id);

-- ─── 2. Kiel als erste Schule + die zwei bekannten Trainer ────────────────

insert into schools (slug, name) values ('kiel', 'Kiel');

insert into trainers (user_id, school_id, slug, display_name, color)
select u.id,
       (select id from schools where slug = 'kiel'),
       split_part(u.email, '@', 1),
       case u.email
         when 'sihinghauke@whkd.local'  then 'SihingHauke'
         when 'sihingsoenke@whkd.local' then 'SihingSoenke'
         else initcap(split_part(u.email, '@', 1))
       end,
       case u.email
         when 'sihinghauke@whkd.local'  then '#1a2744'
         when 'sihingsoenke@whkd.local' then '#c49a2a'
       end
from auth.users u
where u.email in ('sihinghauke@whkd.local', 'sihingsoenke@whkd.local');

-- ─── 3. Helper-Funktion ────────────────────────────────────────────────────

create or replace function my_school_id() returns bigint
language sql stable security definer set search_path = public as $$
  select school_id from trainers where user_id = auth.uid()
$$;

-- ─── 4. school_id an bestehende Tabellen — erstmal nullable ────────────────

alter table techniques  add column school_id bigint references schools(id) on delete cascade;
alter table focus_areas add column school_id bigint references schools(id) on delete cascade;
alter table entries     add column school_id bigint references schools(id) on delete cascade;
alter table sections    add column school_id bigint references schools(id) on delete cascade;

-- ─── 5. Bestehende Zeilen der Kiel-Schule zuordnen ─────────────────────────

update techniques  set school_id = (select id from schools where slug = 'kiel');
update focus_areas set school_id = (select id from schools where slug = 'kiel');
update entries     set school_id = (select id from schools where slug = 'kiel');
update sections    set school_id = (select id from schools where slug = 'kiel');

-- ─── 6. NOT NULL erzwingen ─────────────────────────────────────────────────

alter table techniques  alter column school_id set not null;
alter table focus_areas alter column school_id set not null;
alter table entries     alter column school_id set not null;
alter table sections    alter column school_id set not null;

-- ─── 7. Uniqueness / PK umbauen ────────────────────────────────────────────

alter table techniques  drop constraint techniques_name_key;
alter table techniques  add constraint techniques_name_school_uniq unique (school_id, name);
alter table focus_areas drop constraint focus_areas_name_key;
alter table focus_areas add constraint focus_areas_name_school_uniq unique (school_id, name);

alter table sections drop constraint sections_pkey;
alter table sections add primary key (school_id, slot);

-- Indexe: alten entries-Index durch einen ersetzen, der school_id vorne hat
drop index if exists entries_created_at_idx;
create index entries_school_created_at_idx on entries (school_id, created_at desc);

create index techniques_school_idx  on techniques  (school_id);
create index focus_areas_school_idx on focus_areas (school_id);

-- ─── 8. Views neu — mit school_id + security_invoker ──────────────────────

drop view if exists technique_stats;
drop view if exists focus_area_stats;

create view technique_stats
with (security_invoker = true) as
  select t.id, t.school_id, t.name,
         count(et.entry_id)::int as usage_count,
         max(e.created_at)       as last_used_at
  from techniques t
  left join entry_techniques et on et.technique_id = t.id
  left join entries e            on e.id = et.entry_id
  group by t.id, t.school_id, t.name;

create view focus_area_stats
with (security_invoker = true) as
  select f.id, f.school_id, f.name,
         count(ef.entry_id)::int as usage_count,
         max(e.created_at)       as last_used_at
  from focus_areas f
  left join entry_focus_areas ef on ef.focus_area_id = f.id
  left join entries e            on e.id = ef.entry_id
  group by f.id, f.school_id, f.name;

-- ─── 9. Trigger: school_id automatisch aus Session setzen ─────────────────

create or replace function set_school_id_from_auth() returns trigger
language plpgsql as $$
begin
  if new.school_id is null then
    new.school_id := my_school_id();
  end if;
  return new;
end $$;

create trigger set_school_id before insert on techniques
  for each row execute function set_school_id_from_auth();
create trigger set_school_id before insert on focus_areas
  for each row execute function set_school_id_from_auth();
create trigger set_school_id before insert on entries
  for each row execute function set_school_id_from_auth();

-- ─── 10. Alte Policies droppen ─────────────────────────────────────────────

drop policy if exists auth_read   on entries;
drop policy if exists auth_insert on entries;
drop policy if exists auth_read   on entry_techniques;
drop policy if exists auth_insert on entry_techniques;
drop policy if exists auth_read   on entry_focus_areas;
drop policy if exists auth_insert on entry_focus_areas;
drop policy if exists auth_read   on techniques;
drop policy if exists auth_insert on techniques;
drop policy if exists auth_delete on techniques;
drop policy if exists auth_read   on focus_areas;
drop policy if exists auth_insert on focus_areas;
drop policy if exists auth_delete on focus_areas;
drop policy if exists auth_read   on sections;
drop policy if exists auth_update on sections;

-- ─── 11. Neue schul-gescopte Policies ─────────────────────────────────────

alter table schools  enable row level security;
alter table trainers enable row level security;

create policy school_read on schools
  for select to authenticated using (id = my_school_id());
create policy school_read on trainers
  for select to authenticated using (school_id = my_school_id());

create policy school_read on techniques
  for select to authenticated using (school_id = my_school_id());
create policy school_insert on techniques
  for insert to authenticated with check (school_id = my_school_id());
create policy school_delete on techniques
  for delete to authenticated using (school_id = my_school_id());

create policy school_read on focus_areas
  for select to authenticated using (school_id = my_school_id());
create policy school_insert on focus_areas
  for insert to authenticated with check (school_id = my_school_id());
create policy school_delete on focus_areas
  for delete to authenticated using (school_id = my_school_id());

create policy school_read on entries
  for select to authenticated using (school_id = my_school_id());
create policy school_insert on entries
  for insert to authenticated
  with check (school_id = my_school_id() and user_id = auth.uid());

create policy school_read on entry_techniques
  for select to authenticated using (
    exists (select 1 from entries e where e.id = entry_id and e.school_id = my_school_id())
  );
create policy school_insert on entry_techniques
  for insert to authenticated with check (
    exists (select 1 from entries e where e.id = entry_id and e.school_id = my_school_id())
  );

create policy school_read on entry_focus_areas
  for select to authenticated using (
    exists (select 1 from entries e where e.id = entry_id and e.school_id = my_school_id())
  );
create policy school_insert on entry_focus_areas
  for insert to authenticated with check (
    exists (select 1 from entries e where e.id = entry_id and e.school_id = my_school_id())
  );

create policy school_read on sections
  for select to authenticated using (school_id = my_school_id());
create policy school_update on sections
  for update to authenticated
  using (school_id = my_school_id())
  with check (school_id = my_school_id() and updated_by = auth.uid());

-- ─── 12. bootstrap_school-Funktion für weitere Schulen ────────────────────

create or replace function bootstrap_school(p_slug text, p_name text)
returns bigint language plpgsql as $$
declare new_id bigint;
begin
  insert into schools (slug, name) values (p_slug, p_name) returning id into new_id;
  insert into techniques (school_id, name)
    select new_id, n from unnest(array[
      'Basis', 'Tabellen', 'Handkombinationen', 'Trittkombinationen',
      'Offensiv Setups', 'Defensiv Setups', 'Würfe', 'Chin-Na Techniken',
      'Falltritte', 'Greifkonter', 'Schlagkonter', 'Trittkonter',
      'Messerkonter', 'Stockkonter', 'Waffentraining', 'Escrima'
    ]) as n;
  insert into focus_areas (school_id, name)
    select new_id, n from unnest(array[
      'Beine', 'Arme', 'Rumpf', 'Kondition', 'Kraft',
      'Pratze/Airbag', 'Multiman', 'Todmachertraining'
    ]) as n;
  insert into sections (school_id, slot, title, content) values
    (new_id, 1, 'Notizen',   ''),
    (new_id, 2, 'Events',    ''),
    (new_id, 3, 'Prüflinge', '');
  return new_id;
end $$;

commit;
