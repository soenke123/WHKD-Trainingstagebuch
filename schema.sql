-- WHKD Trainingstagebuch — Supabase Schema
-- Einmal komplett im Supabase SQL-Editor ausführen.

-- ─── Tabellen ────────────────────────────────────────────────────────────────

create table techniques (
  id bigserial primary key,
  name text not null unique,
  created_at timestamptz default now()
);

create table focus_areas (
  id bigserial primary key,
  name text not null unique,
  created_at timestamptz default now()
);

create table entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  comment text,
  created_at timestamptz default now()
);
create index entries_created_at_idx on entries (created_at desc);

create table entry_techniques (
  entry_id uuid references entries(id) on delete cascade,
  technique_id bigint references techniques(id) on delete restrict,
  primary key (entry_id, technique_id)
);

create table entry_focus_areas (
  entry_id uuid references entries(id) on delete cascade,
  focus_area_id bigint references focus_areas(id) on delete restrict,
  primary key (entry_id, focus_area_id)
);

-- ─── Views für Häufigkeitszahlen ────────────────────────────────────────────

create view technique_stats as
  select t.id,
         t.name,
         count(et.entry_id)::int as usage_count,
         max(e.created_at)       as last_used_at
  from techniques t
  left join entry_techniques et on et.technique_id = t.id
  left join entries e            on e.id = et.entry_id
  group by t.id, t.name;

create view focus_area_stats as
  select f.id,
         f.name,
         count(ef.entry_id)::int as usage_count,
         max(e.created_at)       as last_used_at
  from focus_areas f
  left join entry_focus_areas ef on ef.focus_area_id = f.id
  left join entries e            on e.id = ef.entry_id
  group by f.id, f.name;

-- ─── Seed: echte Kategorien ─────────────────────────────────────────────────

insert into techniques (name) values
  ('Basis'),
  ('Tabellen'),
  ('Handkombinationen'),
  ('Trittkombinationen'),
  ('Offensiv Setups'),
  ('Defensiv Setups'),
  ('Würfe'),
  ('Chin-Na Techniken'),
  ('Falltritte'),
  ('Greifkonter'),
  ('Schlagkonter'),
  ('Trittkonter'),
  ('Messerkonter'),
  ('Stockkonter'),
  ('Waffentraining'),
  ('Escrima');

insert into focus_areas (name) values
  ('Beine'),
  ('Arme'),
  ('Rumpf'),
  ('Kondition'),
  ('Kraft'),
  ('Pratze/Airbag'),
  ('Multiman'),
  ('Todmachertraining');

-- ─── Row Level Security ─────────────────────────────────────────────────────

alter table entries          enable row level security;
alter table entry_techniques enable row level security;
alter table entry_focus_areas enable row level security;
alter table techniques       enable row level security;
alter table focus_areas      enable row level security;

create policy auth_read on entries
  for select to authenticated using (true);
create policy auth_insert on entries
  for insert to authenticated with check (user_id = auth.uid());

create policy auth_read on entry_techniques
  for select to authenticated using (true);
create policy auth_insert on entry_techniques
  for insert to authenticated with check (true);

create policy auth_read on entry_focus_areas
  for select to authenticated using (true);
create policy auth_insert on entry_focus_areas
  for insert to authenticated with check (true);

create policy auth_read on techniques
  for select to authenticated using (true);
create policy auth_insert on techniques
  for insert to authenticated with check (true);
create policy auth_delete on techniques
  for delete to authenticated using (true);

create policy auth_read on focus_areas
  for select to authenticated using (true);
create policy auth_insert on focus_areas
  for insert to authenticated with check (true);
create policy auth_delete on focus_areas
  for delete to authenticated using (true);
