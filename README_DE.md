# Verse Radar 0.5.8

Unabhängige deutschsprachige Star-Citizen-Fanseite – ohne Werbung.

## Lokal testen
`START-VORSCHAU.bat` starten. Danach öffnet sich die Seite unter `http://localhost:8000/`.

## Automatischer RSI-News-Import
Der Worker liest die offizielle RSI Comm-Link-Seite ein, erkennt aktuelle Comm-Link-Artikel, filtert relevante Meldungen und kann die strukturierten Daten später in das verbundene GitHub-Repository zurückschreiben.

### Benötigt für Live-Betrieb
- GitHub Repository für die Website-Daten
- Cloudflare-Konto
- GitHub Token mit Schreibzugriff auf das Repository
- OpenAI API Key nur für optionale deutsche KI-Zusammenfassungen

### Cloudflare Variablen/Secrets
- Secret: `OPENAI_API_KEY` (optional)
- Secret: `GITHUB_TOKEN` (für automatisches Zurückschreiben)
- Secret optional: `RUN_SECRET`
- Variable: `GITHUB_REPO` = `DEIN-USERNAME/verse-radar`
- Variable optional: `GITHUB_BRANCH` = `main`
- Variable optional: `MAX_ITEMS`

Cron: alle 2 Stunden (`0 */2 * * *`).

## Test-Endpunkte
- `/health` – zeigt die laufende Worker-Version.
- `/preview` – holt RSI-Beiträge ab, ohne GitHub zu verändern.
- `/run` – führt den Import aus und schreibt bei vorhandenen GitHub-Zugangsdaten die Daten zurück.

## 0.5.8
Der RSI-Parser wurde robuster gegen Änderungen am HTML-Aufbau der Comm-Link-Seite gemacht. `/preview` liefert bei einem Fehler zusätzliche technische Diagnosewerte, damit ein weiterer Fehler gezielt behoben werden kann.

## Was bewusst manuell bleibt
Deals werden noch nicht automatisch aus dem Pledge Store übernommen. Das soll erst mit einer belastbaren offiziellen/strukturierten Quelle passieren, damit keine veralteten Preise auf der Seite landen.

## Rechtlicher Fan-Hinweis
Vor Veröffentlichung die aktuellen RSI-Fankit/Fan-Site-Vorgaben prüfen und den offiziellen Hinweis sichtbar übernehmen. Inhalte werden nur zusammengefasst; Originalquellen werden verlinkt.


## Diagnose
- `/debug/github` prüft die GitHub-Verbindung des Workers, ohne das Secret auszugeben.
