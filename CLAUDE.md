# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**WHKD Trainingstagebuch** — kleine mobile-first Webapp für Kung-Fu-Trainer, um sich innerhalb einer Schule gegenseitig anzuzeigen, welche Techniken/Schwerpunkte zuletzt trainiert wurden. Multi-Tenant: mehrere Schulen (Ortsverbände, z.B. „Kiel", „Hamburg") sind komplett isoliert. Innerhalb einer Schule gibt es beliebig viele **Kurse** (z.B. „Basis", „Kickboxen", „Kinder"); jeder Kurs hat einen eigenen Katalog aus Techniken/Schwerpunkten und eigene Trainings-Einträge. Dashboard-Sections dagegen sind schul-weit geteilt. Kein Public-Facing.

## Stack & Hosting

- **Frontend:** reines HTML / CSS / Vanilla JS. Kein Bundler, kein Framework, kein npm. Supabase-SDK per CDN in `index.html`.
- **Hosting:** Vercel als statische Seite (kein Build-Command, kein Output-Dir).
- **Backend:** Supabase (Auth, Postgres, RLS). Multi-Tenant + Kurs-Schema in `schema.sql`. Migrationen: `schema-multitenant-migration.sql` (Single → Multi-Tenant), `schema-add-icon-column.sql` (Emoji-Icons), `schema-courses-migration.sql` (Kurs-Ebene).

Konsequenz: keine Import-Statements, kein `type="module"`, kein `package.json` erwünscht. Wenn eine Änderung ein Build-System nötig machen würde, vorher fragen.

## Auth-Konvention

Supabase Auth erwartet E-Mails, aber die App zeigt "Benutzername". `app.js` hängt intern `@whkd.local` an. Anzeigename, Farbe und die Zugehörigkeit zur Schule stehen in der `trainers`-Tabelle — verknüpft mit `auth.users` per `user_id`. Der `trainers.slug` sollte dem Local-Part der E-Mail entsprechen (z.B. `sihinghauke@whkd.local` → `slug = 'sihinghauke'`), damit `data-author`-Attribute in gespeicherten Dashboard-Sections stabil bleiben.

Neue Trainer werden ausschließlich manuell angelegt: erst per Supabase-Auth-Dashboard, dann ein `insert into trainers (...)` im SQL-Editor. Kein In-App-Admin.

## Architektur

Eine HTML-Seite, zwei Screens (`#login`, `#app`), umgeschaltet per `hidden`-Attribut. Innerhalb der App zwei Tabs (`#tab-tagebuch`, `#tab-dashboard`).

Datenfluss:
1. `checkSession()` → wenn Session da, `enterApp()`.
2. `enterApp()` lädt Trainer + Schule (inkl. `active_course_id`), dann alle Kurse der Schule, wählt den aktiven Kurs (Fallback: erster Kurs), färbt den Header (`applyCourseTheme`) und ruft `refresh()`.
3. `refresh()` lädt parallel `technique_stats`, `focus_area_stats`, die letzten 16 `entries` — alle drei über `.eq('course_id', currentCourse.id)` — plus die drei Dashboard-`sections`, alle `trainers` und die aktuelle Kurs-Liste. RLS scopet zusätzlich alles über `my_school_id()`.
4. Renderer schreiben in State (`techniques`, `focusAreas`, `courses`, `trainers`, `historyEntries`, `sections`, Sets `selectedTech`/`selectedFocus`).
5. FAB öffnet Modal, das Chips aus dem gleichen State rendert. Save → `insert into entries` (mit `course_id`, `user_id`) + Bulk-Inserts in `entry_techniques`/`entry_focus_areas` → `refresh()`. `school_id` setzt der `set_school_id_from_course`-Trigger automatisch aus dem `course_id`.
6. Kurs-Switcher im Header öffnet ein Popover-Menü mit allen Kursen + „+ Kurs". Auswahl ruft `switchCourse(id)` → aktualisiert `schools.active_course_id`, lädt Kategorien/Trainings neu, färbt den Header. „+ Kurs" öffnet Kurs-Modal (Name + Farbe aus `COURSE_COLORS`), das per `supa.rpc('bootstrap_course', ...)` den neuen Kurs samt Standard-Katalog anlegt. Kurs löschen läuft über dieselbe Drag-in-Delete-Zone wie Kategorien; letzter Kurs kann nicht gelöscht werden.

Häufigkeit kommt aus SQL-Views (`technique_stats`, `focus_area_stats`) — nicht als eigenes Feld gespeichert. Wenn ein Feature das braucht (z.B. „gemeinsam vs. persönlich zählen"), Views anpassen statt Client-Logik zu duplizieren.

`authorFor(userId)` löst Anzeigenamen über die `trainers`-Liste auf — keine hartcodierten if/else-Mappings mehr. `colorForSlug(slug)` liest `trainers.color`, sonst deterministische Fallback-Palette (`FALLBACK_COLORS`).

## Kategorien

Standard-Katalog (16 Techniken, 8 Schwerpunkte) wird von `bootstrap_course(school_id, slug, name, color)` in jeden neuen Kurs kopiert. `bootstrap_school(slug, name)` ruft implizit einen Basis-Kurs mit demselben Katalog auf. Neue Kategorien können Trainer inline im Add-Modal anlegen (`insertCategory`); sie bekommen automatisch den aktiven Kurs; RLS erlaubt `insert` nur für die eigene Schule.

## Neue Schule anlegen

Im Supabase-SQL-Editor: `select bootstrap_school('hamburg', 'Hamburg');` — legt Schule + Basis-Kurs + Standard-Katalog + drei leere Dashboard-Slots an, und setzt den Basis-Kurs als aktiven Kurs der Schule. Trainer danach manuell (Auth-Dashboard + `insert into trainers`). Weitere Kurse legen Trainer in der App an. Details in `README.md`.

## Lokal ausführen

```powershell
python -m http.server 8000
# oder
npx serve .
```

Dann `http://localhost:8000/`. Kein Build-Step. Damit Supabase-Requests funktionieren, muss `config.js` vorher mit echten Werten befüllt sein.

## Design

Angelehnt an das Design von `..\whkd-kiel\` (Next.js-Website des Vereins). Palette in `styles.css` als CSS-Custom-Properties:

- `--primary` `#1a2744` (Navy) — Header, Text, „Techniken"-Spalte
- `--accent`  `#c49a2a` (Gold) — CTAs, FAB, Eyebrows, „Schwerpunkte"-Spalte
- `--surface` `#f7f5f0` (warmes Off-White) — Karten-Hintergrund
- `--tech` / `--focus` steuern die Spaltenfarben. Techniken sind immer Navy, Schwerpunkte immer Gold — sowohl in den Kategorienlisten unten als auch in der „Letztes Training"-Karte und den Modal-Toggle-Chips.

Typografie: **Barlow** (Body) und **Barlow Condensed** (Display, Uppercase) von Google Fonts, in `index.html` per `<link>` geladen. Charakteristisch sind die kleinen Uppercase-„Eyebrow"-Labels mit sehr weitem Letter-Spacing (`0.28em`–`0.35em`).

Mobile-first (`max-width: 480px`), kein separates Desktop-Layout. Icons per Lucide-CDN.
