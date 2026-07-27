# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**WHKD Trainingstagebuch** — kleine mobile-first Webapp für zwei Kung-Fu-Trainer (SihingHauke, SihingSoenke), um sich gegenseitig anzuzeigen, welche Techniken/Schwerpunkte zuletzt trainiert wurden. Nur zwei Nutzer, kein Public-Facing.

## Stack & Hosting

- **Frontend:** reines HTML / CSS / Vanilla JS. Kein Bundler, kein Framework, kein npm. Supabase-SDK per CDN in `index.html`.
- **Hosting:** Vercel als statische Seite (kein Build-Command, kein Output-Dir).
- **Backend:** Supabase (Auth, Postgres, RLS). Alle Tabellen + Views + Policies in `schema.sql`.

Konsequenz: keine Import-Statements, kein `type="module"`, kein `package.json` erwünscht. Wenn eine Änderung ein Build-System nötig machen würde, vorher fragen.

## Auth-Konvention

Supabase Auth erwartet E-Mails, aber die App zeigt "Benutzername". `app.js` hängt intern `@whkd.local` an. Konten sind:
- `sihinghauke@whkd.local` → Anzeigename `SihingHauke`
- `sihingsoenke@whkd.local` → Anzeigename `SihingSoenke`

Kein Profil-Table — Anzeigenamen werden aus dem E-Mail-Local-Part abgeleitet (`displayName()` in `app.js`).

## Architektur

Eine HTML-Seite, zwei Screens (`#login`, `#app`), umgeschaltet per `hidden`-Attribut. Innerhalb der App zwei Tabs (`#tab-tagebuch`, `#tab-dashboard`). Dashboard ist Platzhalter — kommt in einer späteren Iteration.

Datenfluss:
1. `checkSession()` → wenn Session da, `enterApp()` → `refresh()`.
2. `refresh()` lädt parallel `technique_stats`, `focus_area_stats`, letzte 16 `entries` inkl. m:n-Joins.
3. Renderer schreiben in State-Variablen (`techniques`, `focusAreas`, Sets `selectedTech`/`selectedFocus`).
4. FAB öffnet Modal, das Chips aus dem gleichen State rendert. Save → `insert into entries` + Bulk-Inserts in `entry_techniques`/`entry_focus_areas` → `refresh()`.

Häufigkeit kommt aus SQL-Views (`technique_stats`, `focus_area_stats`) — nicht als eigenes Feld gespeichert. Wenn ein Feature das braucht (z.B. „gemeinsam vs. persönlich zählen"), Views anpassen statt Client-Logik zu duplizieren.

## Kategorien

Initiale Techniken und Schwerpunkte stehen im Seed-Block von `schema.sql`. Neue Kategorien können Nutzer im Add-Modal inline anlegen (`addCategory()`); RLS erlaubt `insert` für authentifizierte Nutzer.

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
