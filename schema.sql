-- WHKD Trainingstagebuch — Supabase Schema (Multi-Tenant + Kurse)
-- Einmal komplett im Supabase SQL-Editor eines frischen Projekts ausführen.
-- Jede Schule (Ortsverband) hat isolierte Kurse; jeder Kurs hat isolierte
-- Techniken, Schwerpunkte und Trainings. Dashboard-Sections sind schul-weit.
-- Neue Schulen per `select bootstrap_school(...)`.
--
-- Für bestehende Kiel-Datenbanken NICHT diese Datei laufen lassen — siehe
-- `schema-multitenant-migration.sql` (für Single→Multi-Tenant) und
-- `schema-courses-migration.sql` (für den Kurs-Sprung).

-- ─── Schulen + Trainer ─────────────────────────────────────────────────────

create table schools (
  id bigserial primary key,
  slug text not null unique,      -- URL-freundlich, z.B. 'kiel'
  name text not null,             -- Anzeigename im Header, z.B. 'Kiel'
  active_course_id bigint,        -- FK folgt weiter unten (courses existiert noch nicht)
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

-- ─── Kurse ─────────────────────────────────────────────────────────────────

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

-- FK von schools.active_course_id → courses.id nachziehen (jetzt existiert
-- die Zieltabelle). ON DELETE SET NULL, damit ein gelöschter Kurs den Zeiger
-- nur räumt, statt die Schule mitzureißen.
alter table schools
  add constraint schools_active_course_fk
  foreign key (active_course_id) references courses(id) on delete set null;

-- ─── Fach-Tabellen (alle course-gescopt, school_id als Cache) ─────────────

create table techniques (
  id bigserial primary key,
  school_id bigint not null references schools(id) on delete cascade,
  course_id bigint not null references courses(id) on delete cascade,
  name text not null,
  icon text,                       -- optionales Emoji; wenn leer → Lucide-Fallback
  created_at timestamptz default now(),
  unique (course_id, name)
);
create index techniques_school_idx on techniques (school_id);
create index techniques_course_idx on techniques (course_id);

create table focus_areas (
  id bigserial primary key,
  school_id bigint not null references schools(id) on delete cascade,
  course_id bigint not null references courses(id) on delete cascade,
  name text not null,
  icon text,                       -- optionales Emoji; wenn leer → Lucide-Fallback
  created_at timestamptz default now(),
  unique (course_id, name)
);
create index focus_areas_school_idx on focus_areas (school_id);
create index focus_areas_course_idx on focus_areas (course_id);

create table entries (
  id uuid primary key default gen_random_uuid(),
  school_id bigint not null references schools(id) on delete cascade,
  course_id bigint not null references courses(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  comment text,
  created_at timestamptz default now()
);
create index entries_school_created_at_idx on entries (school_id, created_at desc);
create index entries_course_created_at_idx on entries (course_id, created_at desc);

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

-- Dashboard-Notizblöcke. Jeder Block ist entweder global (course_id NULL,
-- schulweit sichtbar) oder an einen einzelnen Kurs gebunden. Beliebig viele
-- Blöcke pro Schule/Kurs. Name und Scope sind nach Anlage unveränderbar.
create table sections (
  id bigserial primary key,
  school_id bigint not null references schools(id) on delete cascade,
  course_id bigint references courses(id) on delete cascade,
  title text not null,
  content text not null default '',
  updated_by uuid references auth.users(id),
  updated_at timestamptz default now(),
  created_at timestamptz default now()
);

-- ─── Trigger: school_id automatisch aus course_id ableiten ────────────────
-- Client schickt nur course_id, school_id folgt. Läuft vor RLS.

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
create trigger set_school_id_from_course before insert on sections
  for each row execute function set_school_id_from_course();

-- ─── Views für Häufigkeitszahlen ────────────────────────────────────────────
-- `security_invoker = true` sorgt dafür, dass die RLS-Policies der Basis-
-- tabellen greifen — sonst würden Views mit Owner-Rechten laufen und die
-- Isolation umgehen.

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

-- ─── bootstrap_course: neuen Kurs + Standard-Katalog anlegen ──────────────
-- Aus dem Client per `supa.rpc('bootstrap_course', {...})` aufrufen. Sicher
-- gemacht durch expliziten Vergleich mit `my_school_id()`.

create or replace function bootstrap_course(
  p_school_id bigint,
  p_slug text,
  p_name text,
  p_color text default null
) returns bigint language plpgsql
security definer set search_path = public as $$
declare new_id bigint;
begin
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

  insert into sections (school_id, course_id, title, content) values
    (p_school_id, new_id, 'Notizen',   ''),
    (p_school_id, new_id, 'Prüflinge', '');

  return new_id;
end $$;

-- ─── bootstrap_school: neue Schule + Basis-Kurs + Dashboard-Slots ─────────
-- Aufruf im SQL-Editor: `select bootstrap_school('hamburg', 'Hamburg');`

create or replace function bootstrap_school(p_slug text, p_name text)
returns bigint language plpgsql as $$
declare new_id bigint; new_course_id bigint;
begin
  insert into schools (slug, name) values (p_slug, p_name) returning id into new_id;

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

  insert into sections (school_id, course_id, title, content) values
    (new_id, new_course_id, 'Notizen',   ''),
    (new_id, null,          'Events',    ''),
    (new_id, new_course_id, 'Prüflinge', '');

  return new_id;
end $$;

-- ─── Row Level Security ─────────────────────────────────────────────────────

alter table schools           enable row level security;
alter table trainers          enable row level security;
alter table courses           enable row level security;
alter table techniques        enable row level security;
alter table focus_areas       enable row level security;
alter table entries           enable row level security;
alter table entry_techniques  enable row level security;
alter table entry_focus_areas enable row level security;
alter table sections          enable row level security;

-- schools: nur die eigene Schule sichtbar; Update erlaubt (für active_course_id)
create policy school_read on schools
  for select to authenticated using (id = my_school_id());
create policy school_update on schools
  for update to authenticated
  using (id = my_school_id())
  with check (id = my_school_id());

-- trainers: Kollegen der eigenen Schule sichtbar
create policy school_read on trainers
  for select to authenticated using (school_id = my_school_id());

-- courses
create policy school_read on courses
  for select to authenticated using (school_id = my_school_id());
create policy school_insert on courses
  for insert to authenticated with check (school_id = my_school_id());
create policy school_delete on courses
  for delete to authenticated using (school_id = my_school_id());

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

-- sections: eigene Schule lesen; nur der letzte Editor darf updaten;
-- jeder Trainer der Schule darf neue Blöcke anlegen und beliebige löschen.
create policy school_read on sections
  for select to authenticated using (school_id = my_school_id());
create policy school_insert on sections
  for insert to authenticated
  with check (school_id = my_school_id() and updated_by = auth.uid());
create policy school_update on sections
  for update to authenticated
  using (school_id = my_school_id())
  with check (school_id = my_school_id() and updated_by = auth.uid());
create policy school_delete on sections
  for delete to authenticated
  using (school_id = my_school_id());
