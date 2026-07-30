-- WHKD Trainingstagebuch — Migration: Kurse (courses) pro Schule
-- Einmal im Supabase SQL-Editor bestehender Datenbanken ausführen.
--
-- Ergänzt das Multi-Tenant-Schema um eine Kurs-Ebene innerhalb jeder Schule.
-- Techniken, Schwerpunkte und Trainings gehören ab jetzt zu einem Kurs.
-- Für jede bestehende Schule wird automatisch ein „Basis"-Kurs angelegt und
-- alle bereits vorhandenen Daten diesem Basis-Kurs zugeordnet.
--
-- Idempotenz: NEIN. Ein zweiter Lauf schlägt fehl. Bei Problemen rollback und
-- Fehler prüfen.

begin;

-- ─── 1. courses-Tabelle ────────────────────────────────────────────────────

create table courses (
  id bigserial primary key,
  school_id bigint not null references schools(id) on delete cascade,
  slug text not null,             -- z.B. 'basis', 'kickboxen'
  name text not null,             -- Anzeigename, z.B. 'Basis'
  color text,                     -- optionaler Hex-Wert für Header-Farbe
  created_at timestamptz default now(),
  unique (school_id, slug)
);
create index courses_school_idx on courses (school_id);

-- ─── 2. Aktiver Kurs pro Schule (geteilt für alle Trainer) ────────────────

alter table schools
  add column active_course_id bigint references courses(id) on delete set null;

-- ─── 3. Basis-Kurs für jede bestehende Schule anlegen ─────────────────────

insert into courses (school_id, slug, name)
  select id, 'basis', 'Basis' from schools;

-- ─── 4. course_id an den drei Fakt-Tabellen — erstmal nullable ────────────

alter table techniques  add column course_id bigint references courses(id) on delete cascade;
alter table focus_areas add column course_id bigint references courses(id) on delete cascade;
alter table entries     add column course_id bigint references courses(id) on delete cascade;

-- ─── 5. Bestehende Zeilen dem Basis-Kurs ihrer Schule zuordnen ────────────

update techniques t
  set course_id = (select c.id from courses c
                   where c.school_id = t.school_id and c.slug = 'basis');
update focus_areas f
  set course_id = (select c.id from courses c
                   where c.school_id = f.school_id and c.slug = 'basis');
update entries e
  set course_id = (select c.id from courses c
                   where c.school_id = e.school_id and c.slug = 'basis');

-- ─── 6. active_course_id je Schule auf Basis setzen ───────────────────────

update schools s
  set active_course_id = (select c.id from courses c
                          where c.school_id = s.id and c.slug = 'basis');

-- ─── 7. NOT NULL erzwingen ─────────────────────────────────────────────────

alter table techniques  alter column course_id set not null;
alter table focus_areas alter column course_id set not null;
alter table entries     alter column course_id set not null;

-- ─── 8. Uniqueness auf Kurs-Ebene ─────────────────────────────────────────
-- Kategorienamen dürfen sich zwischen Kursen wiederholen.

alter table techniques  drop constraint techniques_name_school_uniq;
alter table techniques  add constraint techniques_name_course_uniq unique (course_id, name);
alter table focus_areas drop constraint focus_areas_name_school_uniq;
alter table focus_areas add constraint focus_areas_name_course_uniq unique (course_id, name);

create index entries_course_created_at_idx on entries (course_id, created_at desc);

-- ─── 9. Views neu — inkl. course_id in select und group by ────────────────

drop view if exists technique_stats;
drop view if exists focus_area_stats;

create view technique_stats
with (security_invoker = true) as
  select t.id, t.school_id, t.course_id, t.name, t.icon,
         count(et.entry_id)::int as usage_count,
         max(e.created_at)       as last_used_at
  from techniques t
  left join entry_techniques et on et.technique_id = t.id
  left join entries e            on e.id = et.entry_id
  group by t.id, t.school_id, t.course_id, t.name, t.icon;

create view focus_area_stats
with (security_invoker = true) as
  select f.id, f.school_id, f.course_id, f.name, f.icon,
         count(ef.entry_id)::int as usage_count,
         max(e.created_at)       as last_used_at
  from focus_areas f
  left join entry_focus_areas ef on ef.focus_area_id = f.id
  left join entries e            on e.id = ef.entry_id
  group by f.id, f.school_id, f.course_id, f.name, f.icon;

-- ─── 10. Trigger: school_id aus course_id ableiten ────────────────────────
-- Client schickt nur noch course_id; school_id folgt automatisch. Läuft
-- VOR dem bestehenden set_school_id_from_auth-Trigger.

create or replace function set_school_id_from_course() returns trigger
language plpgsql as $$
begin
  if new.school_id is null and new.course_id is not null then
    select school_id into new.school_id from courses where id = new.course_id;
  end if;
  return new;
end $$;

create trigger set_school_id_from_course before insert on techniques
  for each row execute function set_school_id_from_course();
create trigger set_school_id_from_course before insert on focus_areas
  for each row execute function set_school_id_from_course();
create trigger set_school_id_from_course before insert on entries
  for each row execute function set_school_id_from_course();

-- ─── 11. RLS für courses ──────────────────────────────────────────────────

alter table courses enable row level security;

create policy school_read on courses
  for select to authenticated using (school_id = my_school_id());
create policy school_insert on courses
  for insert to authenticated with check (school_id = my_school_id());
create policy school_delete on courses
  for delete to authenticated using (school_id = my_school_id());

-- ─── 12. RLS: schools darf jetzt geupdated werden (active_course_id) ──────

create policy school_update on schools
  for update to authenticated
  using (id = my_school_id())
  with check (id = my_school_id());

-- ─── 13. bootstrap_course: neuen Kurs + Standard-Katalog anlegen ──────────
-- Aufruf im SQL-Editor oder aus dem Client per rpc(). Rückgabe: neue Kurs-ID.

create or replace function bootstrap_course(
  p_school_id bigint,
  p_slug text,
  p_name text,
  p_color text default null
) returns bigint language plpgsql
security definer set search_path = public as $$
declare new_id bigint;
begin
  -- Absicherung: nur eigene Schule darf befüllt werden.
  if p_school_id is distinct from my_school_id() then
    raise exception 'Kein Zugriff auf diese Schule';
  end if;

  insert into courses (school_id, slug, name, color)
    values (p_school_id, p_slug, p_name, p_color)
    returning id into new_id;

  insert into techniques (school_id, course_id, name)
    select p_school_id, new_id, n from unnest(array[
      'Basis', 'Tabellen', 'Handkombinationen', 'Trittkombinationen',
      'Offensiv Setups', 'Defensiv Setups', 'Würfe', 'Chin-Na Techniken',
      'Falltritte', 'Greifkonter', 'Schlagkonter', 'Trittkonter',
      'Messerkonter', 'Stockkonter', 'Waffentraining', 'Escrima'
    ]) as n;

  insert into focus_areas (school_id, course_id, name)
    select p_school_id, new_id, n from unnest(array[
      'Beine', 'Arme', 'Rumpf', 'Kondition', 'Kraft',
      'Pratze/Airbag', 'Multiman', 'Todmachertraining'
    ]) as n;

  return new_id;
end $$;

-- ─── 14. bootstrap_school neu: nutzt bootstrap_course intern ──────────────

create or replace function bootstrap_school(p_slug text, p_name text)
returns bigint language plpgsql as $$
declare new_id bigint; new_course_id bigint;
begin
  insert into schools (slug, name) values (p_slug, p_name) returning id into new_id;

  -- Basis-Kurs mit Standard-Katalog (Aufruf umgeht my_school_id-Check via
  -- direktes Insert statt bootstrap_course, weil der aufrufende Admin
  -- typischerweise nicht Trainer der neuen Schule ist).
  insert into courses (school_id, slug, name)
    values (new_id, 'basis', 'Basis')
    returning id into new_course_id;

  update schools set active_course_id = new_course_id where id = new_id;

  insert into techniques (school_id, course_id, name)
    select new_id, new_course_id, n from unnest(array[
      'Basis', 'Tabellen', 'Handkombinationen', 'Trittkombinationen',
      'Offensiv Setups', 'Defensiv Setups', 'Würfe', 'Chin-Na Techniken',
      'Falltritte', 'Greifkonter', 'Schlagkonter', 'Trittkonter',
      'Messerkonter', 'Stockkonter', 'Waffentraining', 'Escrima'
    ]) as n;

  insert into focus_areas (school_id, course_id, name)
    select new_id, new_course_id, n from unnest(array[
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
