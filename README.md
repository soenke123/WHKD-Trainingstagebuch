# WHKD Trainingstagebuch

Kleine mobile-first Webapp, mit der Kung-Fu-Trainer gegenseitig sichtbar machen, was zuletzt trainiert wurde. Statisches HTML/CSS/JS auf Vercel + Supabase als Backend.

**Multi-Tenant + Kurse:** jede Schule (Ortsverband) hat isolierte Daten. Innerhalb einer Schule gibt es beliebig viele **Kurse** (z.B. „Basis", „Kickboxen", „Kinder"), die jeweils eigene Techniken, Schwerpunkte und Trainingseinträge haben. Dashboard-Sections bleiben schul-weit geteilt. Im Header steht `WHKD · <Schule>` und darunter der aktive Kurs als Dropdown; dessen Farbe färbt den Header, damit auf einen Blick klar ist, in welchem Kurs man gerade Einträge macht.

## Setup — Reihenfolge

### 1. Supabase-Projekt anlegen

1. Bei [supabase.com](https://supabase.com) einloggen und ein neues Projekt erstellen (Region z.B. Frankfurt).
2. **SQL-Editor** öffnen, Inhalt von `schema.sql` einfügen und ausführen (Multi-Tenant-Schema für ein frisches Projekt).
3. **Authentication → Providers → Email** öffnen: „Confirm email" **ausschalten** (sonst kommt man mit den `whkd.local`-Adressen nicht rein).
4. Erste Schule anlegen und Trainer verknüpfen — siehe [Neue Schule anlegen](#neue-schule-anlegen) unten.
5. **Project Settings → API** öffnen, `Project URL` und `anon public key` in `config.js` eintragen.

### 2. Lokal testen (optional)

Kein Build nötig. Aus dem Projekt-Ordner z.B. per PowerShell:

```powershell
python -m http.server 8000
# oder
npx serve .
```

Dann `http://localhost:8000/` öffnen. `file://` direkt sollte auch klappen, aber ein lokaler Server ist robuster.

### 3. Vercel Deployment

1. Repo auf GitHub pushen.
2. Auf [vercel.com](https://vercel.com) „Add New → Project" → GitHub-Repo importieren.
3. **Framework Preset:** *Other*. **Build Command:** leer. **Output Directory:** leer (Root).
4. Deploy.

`config.js` liegt im Repo mit **anon key** — das ist okay: der anon key darf öffentlich sein, die RLS-Policies aus `schema.sql` beschränken den Zugriff auf eingeloggte Nutzer und die eigene Schule.

## Neue Schule anlegen

Ein Aufruf im SQL-Editor legt die Schule inkl. Basis-Kurs (Standard-Katalog: 16 Techniken, 8 Schwerpunkte) und 3 leere Dashboard-Sections an. Der Basis-Kurs ist gleich der aktive Kurs.

```sql
select bootstrap_school('kiel', 'Kiel');
-- oder
select bootstrap_school('hamburg', 'Hamburg');
```

Weitere Kurse legen Trainer direkt in der App an (Kurs-Dropdown im Header → „+ Kurs") — dabei kopiert `bootstrap_course(...)` den Standard-Katalog in den neuen Kurs, der dann angepasst werden kann.

Danach jeden Trainer der neuen Schule anlegen:

1. **Authentication → Users → Add user → Create new user** — E-Mail nach dem Muster `<username>@whkd.local`, Passwort setzen, „Auto Confirm User" aktivieren. Die UUID des angelegten Users kopieren.
2. Im SQL-Editor die Trainer-Zuordnung anlegen:

```sql
insert into trainers (user_id, school_id, slug, display_name, color)
values (
  '<uuid-des-users>',
  (select id from schools where slug = 'kiel'),
  'sihinghauke',         -- Kurz-ID, muss zum E-Mail-Local-Part passen
  'SihingHauke',         -- Anzeigename im UI
  '#1a2744'              -- optional: Hex-Farbe für Dashboard-Autorenstreifen
);
```

`slug` sollte dem lokalen Teil der E-Mail entsprechen (`sihinghauke@whkd.local` → `sihinghauke`), damit vorhandene Dashboard-Sections mit `data-author="sihinghauke"` weiterhin die richtige Farbe kriegen. `color` ist optional — ohne Wert kriegt der Trainer eine deterministische Farbe aus der Fallback-Palette (`FALLBACK_COLORS` in `app.js`).

## Migration bestehender Kiel-Datenbank

Der Weg auf den aktuellen Stand geht in Etappen — im SQL-Editor der bestehenden DB nacheinander laufen lassen:

1. `schema-multitenant-migration.sql` — Single-Tenant → Multi-Tenant (Kiel als erste Schule).
2. `schema-add-icon-column.sql` — optionale Emoji-Icons für Kategorien.
3. `schema-courses-migration.sql` — Kurs-Ebene einführen; legt pro Schule einen Basis-Kurs an und mappt alle bestehenden Techniken, Schwerpunkte und Trainings darauf.

Danach läuft die App unverändert weiter, nur mit dem neuen Kurs-Dropdown im Header.

## Dateien

| Datei                              | Zweck                                                                    |
|------------------------------------|--------------------------------------------------------------------------|
| `index.html`                       | UI-Grundgerüst (Login-Screen, Tabs, Kategorielisten, Modal)              |
| `styles.css`                       | Mobile-first Layout, WHKD-Farben (Navy + Gold)                           |
| `app.js`                           | Auth, Datenabruf, Rendering, Modal-Logik, Kurs-Switcher                  |
| `config.js`                        | Supabase URL + anon key (hier einsetzen)                                 |
| `schema.sql`                       | Multi-Tenant + Kurs-Schema für ein frisches Projekt                      |
| `schema-multitenant-migration.sql` | Migration Single-Tenant → Multi-Tenant                                   |
| `schema-add-icon-column.sql`       | Migration: optionale Emoji-Icons an Kategorien                           |
| `schema-courses-migration.sql`     | Migration: Kurs-Ebene innerhalb einer Schule                             |

## Datenmodell

- `schools` — eine Zeile pro Ortsverband (`slug`, `name`, `active_course_id` als geteilter Zeiger auf den aktuell aktiven Kurs).
- `trainers` — verknüpft `auth.users` mit einer Schule, hält Anzeigenamen und optionale Autorfarbe.
- `courses` — Kurse innerhalb einer Schule (`slug`, `name`, optionale `color`); pro Schule gibt es mindestens den Basis-Kurs.
- `techniques` / `focus_areas` — Kategorien mit `school_id` + `course_id`, uniqueness pro Kurs.
- `entries` — ein Training mit `school_id`, `course_id`, `user_id`, optionalem `comment`, `created_at`.
- `entry_techniques` / `entry_focus_areas` — m:n-Verknüpfungen.
- `sections` — pro Schule drei Dashboard-Slots (Notizen, Events, Prüflinge); nicht kurs-gescopt.
- `technique_stats` / `focus_area_stats` — Views mit Häufigkeit, jeweils inkl. `school_id` und `course_id`.

RLS filtert jede Tabelle über den Helper `my_school_id()` (der wiederum in `trainers` nachschlägt). Neue `techniques`/`focus_areas`/`entries`-Zeilen bekommen ihre `school_id` per Before-Insert-Trigger automatisch aus der `course_id` — der Client schickt nur `course_id` (und ggf. `user_id`).
