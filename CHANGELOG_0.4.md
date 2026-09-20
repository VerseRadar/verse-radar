# Verse Radar 0.4

## Der große Schritt
- RSI Comm-Link RSS ist als echte automatische Quelle eingebaut.
- Neue RSS-Einträge werden nur einmal per ID verarbeitet; bestehende Datensätze bleiben erhalten.
- KI-Ausgabe enthält Titel, deutsche Zusammenfassung und Kategorie.
- Kategorien: NEWS, PATCH NOTES, FREE FLY, EVENT, ROADMAP, SCHIFFE.
- Patch-History wird automatisch ergänzt und nach Version sortiert.
- Events und Free-Fly-Meldungen werden aus dem Feed abgeleitet.
- Datenstand wird als Live-Pipeline ausgewiesen.
- `/health` Endpoint für Monitoring.
- Manueller `/run` Endpoint kann mit `RUN_SECRET` geschützt werden.
- Deals bleiben bewusst manuell, solange keine stabile offizielle strukturierte Quelle vorhanden ist.

## Wichtig
0.4 kann die automatische Pipeline noch nicht allein auf deinem PC starten. Für den Live-Betrieb müssen Cloudflare Worker, GitHub und OpenAI einmal eingerichtet werden.
