# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**WHKD Trainingstagebuch** — kleine mobile-first Webapp für Kung-Fu-Trainer, um sich innerhalb einer Schule gegenseitig anzuzeigen, welche Techniken/Schwerpunkte zuletzt trainiert wurden. Multi-Tenant: mehrere Schulen (Ortsverbände, z.B. „Kiel", „Hamburg") sind komplett isoliert — jede hat eigene Techniken, Schwerpunkte, Einträge und Dashboard-Sections. Kein Public-Facing.

## Stack & Hosting

- **Frontend:** reines HTML / CSS / Vanilla JS. Kein Bundler, kein Framework, kein npm. Supabase-SDK per CDN in `index.html`.
- **Hosting:** Vercel als statische Seite (kein Build-Command, kein Output-Dir).
- **Backend:** Supabase (Auth, Postgres, RLS). Multi-Tenant-Schema in `schema.sql`; für bestehende Single-Tenant-DBs gibt es `schema-multitenant-migration.sql`.

Konsequenz: keine Import-Statements, kein `type="module"`, kein `package.json` erwünscht. Wenn eine Änderung ein Build-System nötig machen würde, vorher fragen.

## Auth-Konvention

Supabase Auth erwartet E-Mails, aber die App zeigt "Benutzername". `app.js` hängt intern `@whkd.local` an. Anzeigename, Farbe und die Zugehörigkeit zur Schule stehen in der `trainers`-Tabelle — verknüpft mit `auth.users` per `user_id`. Der `trainers.slug` sollte dem Local-Part der E-Mail entsprechen (z.B. `sihinghauke@whkd.local` → `slug = 'sihinghauke'`), damit `data-author`-Attribute in gespeicherten Dashboard-Sections stabil bleiben.

Neue Trainer werden ausschließlich manuell angelegt: erst per Supabase-Auth-Dashboard, dann ein `insert into trainers (...)` im SQL-Editor. Kein In-App-Admin.

## Architektur

Eine HTML-Seite, zwei Screens (`#login`, `#app`), umgeschaltet per `hidden`-Attribut. Innerhalb der App zwei Tabs (`#tab-tagebuch`, `#tab-dashboard`).

Datenfluss:
1. `checkSession()` → wenn Session da, `enterApp()`.
2. `enterApp()` lädt einmal die eigene Trainer-Row mit verknüpfter Schule (`currentSchool`, `currentUser`), setzt den Schulnamen im Header (`.brand-school`) und ruft `refresh()`.
3. `refresh()` lädt parallel `technique_stats`, `focus_area_stats`, die letzten 16 `entries` inkl. m:n-Joins, die drei Dashboard-`sections` und alle `trainers` der eigenen Schule. RLS scopet jede Query automatisch über `my_school_id()`.
4. Renderer schreiben in State (`techniques`, `focusAreas`, `trainers`, `historyEntries`, `sections`, Sets `selectedTech`/`selectedFocus`).
5. FAB öffnet Modal, das Chips aus dem gleichen State rendert. Save → `insert into entries` (+ Bulk-Inserts in `entry_techniques`/`entry_focus_areas`) → `refresh()`. `school_id` setzt ein Before-Insert-Trigger automatisch; der Client muss das nicht mitschicken.

Häufigkeit kommt aus SQL-Views (`technique_stats`, `focus_area_stats`) — nicht als eigenes Feld gespeichert. Wenn ein Feature das braucht (z.B. „gemeinsam vs. persönlich zählen"), Views anpassen statt Client-Logik zu duplizieren.

`authorFor(userId)` löst Anzeigenamen über die `trainers`-Liste auf — keine hartcodierten if/else-Mappings mehr. `colorForSlug(slug)` liest `trainers.color`, sonst deterministische Fallback-Palette (`FALLBACK_COLORS`).

## Kategorien

Standard-Katalog (16 Techniken, 8 Schwerpunkte) wird von der SQL-Funktion `bootstrap_school(slug, name)` beim Anlegen einer neuen Schule kopiert. Neue Kategorien können Trainer inline im Add-Modal anlegen (`addCategory()`); RLS erlaubt `insert` nur für die eigene Schule.

## Neue Schule anlegen

Im Supabase-SQL-Editor: `select bootstrap_school('hamburg', 'Hamburg');` — legt Schule + Standard-Katalog + drei leere Dashboard-Slots an. Trainer danach manuell (Auth-Dashboard + `insert into trainers`). Details in `README.md`.

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
