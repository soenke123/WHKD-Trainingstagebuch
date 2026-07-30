-- WHKD Trainingstagebuch — Migration: Dashboard-Sections mit Scope (global vs. Kurs)
-- Einmal im Supabase SQL-Editor bestehender Datenbanken ausführen.
--
-- Sections hatten bisher genau 3 feste Slots pro Schule (Notizen/Events/Prüflinge).
-- Ab jetzt beliebig viele Blöcke, jeder entweder global (schulweit) oder an
-- einen einzelnen Kurs gebunden.
--
-- Migration bestehender Zeilen:
--   'Events'  → global (course_id NULL)
--   'Notizen', 'Prüflinge' → aktiver Kurs der jeweiligen Schule
--
-- Idempotenz: NEIN. Ein zweiter Lauf schlägt fehl.

begin;

-- ─── 1. Struktur umbauen ─────────────────────────────────────────────────────

alter table sections drop constraint sections_pkey;
alter table sections add column id bigserial primary key;
alter table sections add column course_id bigint references courses(id) on delete cascade;
alter table sections add column created_at timestamptz default now();
alter table sections alter column slot drop not null;

-- ─── 2. Bestehende Zeilen zuordnen ───────────────────────────────────────────

update sections s
   set course_id = sc.active_course_id
  from schools sc
 where s.school_id = sc.id
   and s.title in ('Notizen', 'Prüflinge');

-- ─── 3. slot-Spalte entfernen (wird nicht mehr gebraucht) ────────────────────

alter table sections drop column slot;

-- ─── 4. Trigger: bei Kurs-Scope school_id automatisch aus course_id ableiten ─
-- Für globale Sections setzt der Client school_id direkt (course_id NULL);
-- der Trigger greift dann nicht.

create trigger set_school_id_from_course before insert on sections
  for each row execute function set_school_id_from_course();

-- ─── 5. RLS: insert + delete ergänzen (bisher nur read + update) ─────────────

create policy school_insert on sections
  for insert to authenticated
  with check (school_id = my_school_id() and updated_by = auth.uid());

create policy school_delete on sections
  for delete to authenticated
  using (school_id = my_school_id());

commit;
