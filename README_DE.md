# Verse Radar 0.4.1

Unabhängige deutschsprachige Star-Citizen-Fanseite – ohne Werbung.

## Lokal testen
`START-VORSCHAU.bat` starten. Danach öffnet sich die Seite unter `http://localhost:8000/`.

## Was 0.4 vorbereitet
Die automatische Redaktion liest den offiziellen RSI Comm-Link RSS-Feed, filtert relevante Meldungen, erstellt mit OpenAI eine deutsche Kurzfassung und schreibt strukturierte JSON-Daten in ein GitHub-Repository. Cloudflare Cron kann den Worker regelmäßig ausführen.

### Benötigt für Live-Betrieb
- GitHub Repository für die Website-Daten
- Cloudflare-Konto
- OpenAI API Key
- GitHub Token mit Schreibzugriff auf das Repository

### Cloudflare Variablen/Secrets
- Secret: `OPENAI_API_KEY`
- Secret: `GITHUB_TOKEN`
- Secret optional: `RUN_SECRET`
- Variable: `GITHUB_REPO` = `DEIN-USERNAME/verse-radar`
- Variable optional: `GITHUB_BRANCH` = `main`
- Variable optional: `MAX_ITEMS`

Cron-Vorschlag: alle 2 Stunden (`0 */2 * * *`).

## Was noch bewusst manuell bleibt
Deals werden in 0.4 noch nicht automatisch aus dem Pledge Store übernommen. Das soll erst mit einer belastbaren offiziellen/strukturierten Quelle passieren, damit keine veralteten Preise auf der Seite landen.

## Rechtlicher Fan-Hinweis
Vor Veröffentlichung die aktuellen RSI-Fankit/Fan-Site-Vorgaben prüfen und den offiziellen Hinweis sichtbar übernehmen. Inhalte werden nur zusammengefasst; Originalquellen werden verlinkt.
