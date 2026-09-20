# Verse Radar 0.3

Dies ist der erste Schritt von einer statischen Demo zu einer automatisierbaren Seite.

## Sichtbare Änderungen
- Live-Datenstatus auf der Startseite
- Statistikleiste für News, Patches, Deals und Events
- Radar-Kontakte werden aus den geladenen News/Events erzeugt
- neue News-Seite mit Suche und Kategoriefilter
- News-Karten mit relativer Aktualitätsanzeige
- bessere Deal-/Patch-Zeilen
- `data/meta.json` für den Datenstand

## Automatisierung vorbereitet
Der Cloudflare Worker kann:
1. RSI Comm-Link RSS abrufen
2. relevante Meldungen filtern
3. mit OpenAI auf Deutsch zusammenfassen
4. `news.json`, `patches.json` und `meta.json` in einem GitHub-Repository aktualisieren
5. per Cron alle 2 Stunden laufen

Noch nötig für den Live-Betrieb: eigenes GitHub-Repository, Cloudflare Worker Deployment, `OPENAI_API_KEY` und `GITHUB_TOKEN`. Der Referral-Link bleibt bis zur Eingabe des echten Links ein Platzhalter.
