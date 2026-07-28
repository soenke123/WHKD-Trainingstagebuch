-- WHKD Trainingstagebuch — Supabase Schema (Multi-Tenant)
-- Einmal komplett im Supabase SQL-Editor eines frischen Projekts ausführen.
-- Jede Schule (Ortsverband) hat isolierte Techniken, Schwerpunkte, Einträge
-- und Dashboard-Sections. Neue Schulen per `select bootstrap_school(...)`.
--
-- Für bestehende Kiel-Datenbanken NICHT diese Datei laufen lassen — siehe
-- `schema-multitenant-migration.sql`.

-- ─── Schulen + Trainer ─────────────────────────────────────────────────────

create table schools (
  id bigserial primary key,
  slug text not null unique,      -- URL-freundlich, z.B. 'kiel'
  name text not null,             -- Anzeigename im Header, z.B. 'Kiel'
  created_at timestamptz default now()
);

create table trainers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  school_id bigint not null references schools(id) on delete cascade,
  slug text not null,             -- Kurz-ID für data-author im Section-HTML
  display_name text not null,     -- Anzeigename, z.B. 'SihingHauke'
  color text,                     -- optionaler Hex-Wert für die Autorfarbe
  created_at timestamptz default now(),
  unique (school_id, slug)
);
create index trainers_school_idx on trainers (school_id);

-- Helper: eigene Schule aus der trainers-Tabelle auflösen.
-- `security definer` damit RLS auf trainers das Nachschlagen nicht selbst
-- blockiert (sonst Henne-und-Ei mit der trainers-Policy weiter unten).
create or replace function my_school_id() returns bigint
language sql stable security definer set search_path = public as $$
  select school_id from trainers where user_id = auth.uid()
$$;

-- ─── Fach-Tabellen (alle school-gescopt) ───────────────────────────────────

create table techniques (
  id bigserial primary key,
  school_id bigint not null references schools(id) on delete cascade,
  name text not null,
  created_at timestamptz default now(),
  unique (school_id, name)
);
create index techniques_school_idx on techniques (school_id);

create table focus_areas (
  id bigserial primary key,
  school_id bigint not null references schools(id) on delete cascade,
  name text not null,
  created_at timestamptz default now(),
  unique (school_id, name)
);
create index focus_areas_school_idx on focus_areas (school_id);

create table entries (
  id uuid primary key default gen_random_uuid(),
  school_id bigint not null references schools(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  comment text,
  created_at timestamptz default now()
);
create index entries_school_created_at_idx on entries (school_id, created_at desc);

create table entry_techniques (
  entry_id uuid references entries(id) on delete cascade,
  technique_id bigint references techniques(id) on delete cascade,
  primary key (entry_id, technique_id)
);

create table entry_focus_areas (
  entry_id uuid references entries(id) on delete cascade,
  focus_area_id bigint references focus_areas(id) on delete cascade,
  primary key (entry_id, focus_area_id)
);

-- Genau drei Dashboard-Slots pro Schule (Notizen, Events, Prüflinge).
-- Titel ist frei umbenennbar, Inhalt ist sanitized HTML mit optionalen
-- data-author-Attributen auf Top-Level-Blöcken (siehe app.js).
create table sections (
  school_id bigint not null references schools(id) on delete cascade,
  slot int not null check (slot in (1, 2, 3)),
  title text not null,
  content text not null default '',
  updated_by uuid references auth.users(id),
  updated_at timestamptz default now(),
  primary key (school_id, slot)
);

-- ─── Trigger: school_id beim Insert automatisch setzen ─────────────────────
-- Damit der Client kein school_id mitschicken muss. RLS würde einen falschen
-- Wert ohnehin ablehnen, der Trigger sorgt für den Default und läuft VOR
-- der RLS-Prüfung.

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

-- ─── Views für Häufigkeitszahlen ────────────────────────────────────────────
-- `security_invoker = true` sorgt dafür, dass die RLS-Policies der Basis-
-- tabellen greifen — sonst würden Views mit Owner-Rechten laufen und die
-- Isolation umgehen.

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

-- ─── bootstrap_school: neue Schule + Standard-Katalog + leere Sections ────
-- Aufruf im SQL-Editor: `select bootstrap_school('hamburg', 'Hamburg');`

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

-- ─── Row Level Security ─────────────────────────────────────────────────────

alter table schools           enable row level security;
alter table trainers          enable row level security;
alter table techniques        enable row level security;
alter table focus_areas       enable row level security;
alter table entries           enable row level security;
alter table entry_techniques  enable row level security;
alter table entry_focus_areas enable row level security;
alter table sections          enable row level security;

-- schools: nur die eigene Schule sichtbar
create policy school_read on schools
  for select to authenticated using (id = my_school_id());

-- trainers: Kollegen der eigenen Schule sichtbar
create policy school_read on trainers
  for select to authenticated using (school_id = my_school_id());

-- techniques
create policy school_read on techniques
  for select to authenticated using (school_id = my_school_id());
create policy school_insert on techniques
  for insert to authenticated with check (school_id = my_school_id());
create policy school_delete on techniques
  for delete to authenticated using (school_id = my_school_id());

-- focus_areas
create policy school_read on focus_areas
  for select to authenticated using (school_id = my_school_id());
create policy school_insert on focus_areas
  for insert to authenticated with check (school_id = my_school_id());
create policy school_delete on focus_areas
  for delete to authenticated using (school_id = my_school_id());

-- entries: eigene Schule lesen; eigene Schule + eigener user_id schreiben;
-- löschen darf nur der Autor selbst (nicht Kollegen der Schule).
create policy school_read on entries
  for select to authenticated using (school_id = my_school_id());
create policy school_insert on entries
  for insert to authenticated
  with check (school_id = my_school_id() and user_id = auth.uid());
create policy school_delete on entries
  for delete to authenticated
  using (school_id = my_school_id() and user_id = auth.uid());

-- Join-Tabellen: filtern über den Parent-Entry
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

-- sections: eigene Schule lesen; nur der letzte Editor darf updaten
create policy school_read on sections
  for select to authenticated using (school_id = my_school_id());
create policy school_update on sections
  for update to authenticated
  using (school_id = my_school_id())
  with check (school_id = my_school_id() and updated_by = auth.uid());
