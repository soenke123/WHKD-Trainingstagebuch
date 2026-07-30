-- WHKD Trainingstagebuch — Migration: optionale Emoji-Icons für Kategorien
-- Einmal im Supabase SQL-Editor bestehender Datenbanken ausführen.
-- Fügt eine optionale `icon`-Spalte (Emoji als Text) an techniques und
-- focus_areas an und baut die Häufigkeits-Views so um, dass sie das Icon
-- gleich mitliefern.

alter table techniques  add column if not exists icon text;
alter table focus_areas add column if not exists icon text;

drop view if exists technique_stats;
drop view if exists focus_area_stats;

create view technique_stats
with (security_invoker = true) as
  select t.id, t.school_id, t.name, t.icon,
         count(et.entry_id)::int as usage_count,
         max(e.created_at)       as last_used_at
  from techniques t
  left join entry_techniques et on et.technique_id = t.id
  left join entries e            on e.id = et.entry_id
  group by t.id, t.school_id, t.name, t.icon;

create view focus_area_stats
with (security_invoker = true) as
  select f.id, f.school_id, f.name, f.icon,
         count(ef.entry_id)::int as usage_count,
         max(e.created_at)       as last_used_at
  from focus_areas f
  left join entry_focus_areas ef on ef.focus_area_id = f.id
  left join entries e            on e.id = ef.entry_id
  group by f.id, f.school_id, f.name, f.icon;
