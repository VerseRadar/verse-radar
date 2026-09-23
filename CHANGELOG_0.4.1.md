# Verse Radar 0.4.1

## Fix: Static Website auf Cloudflare Workers

- `public/` wird über Cloudflare Workers Static Assets ausgeliefert.
- Die JSON-Daten liegen jetzt unter `public/data/`, damit die Website sie öffentlich laden kann.
- Der automatische Worker aktualisiert dieselben Dateien im GitHub-Repository.
- Die Website zeigt damit nach einem erfolgreichen Deployment tatsächlich die Verse-Radar-Oberfläche statt nur die Worker-Statusmeldung.
- Versionsanzeige auf 0.4.1 aktualisiert.

## Wichtig

Die automatische RSI-/OpenAI-Pipeline benötigt weiterhin die entsprechenden Cloudflare-Secrets (`OPENAI_API_KEY`, `GITHUB_TOKEN`) und die korrekte `GITHUB_REPO`-Variable. Diese Version ändert daran nichts.
