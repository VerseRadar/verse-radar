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


## 0.5 – Live-News vorbereiten

Der Worker nutzt die offizielle RSI Comm-Link-Seite als Quelle. Öffne nach dem Deployment `/preview`, um zu testen, ob RSI-Beiträge erkannt werden. Für das automatische Zurückschreiben nach GitHub werden später die Worker-Secrets `GITHUB_TOKEN` und `GITHUB_REPO` benötigt. `OPENAI_API_KEY` ist in 0.5 optional.
