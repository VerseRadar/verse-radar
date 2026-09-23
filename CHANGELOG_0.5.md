# Verse Radar 0.5

## Erste echte RSI-News-Anbindung
- Der Worker ruft die offizielle RSI Comm-Link-Seite ab.
- Relevante Beiträge werden automatisch erkannt und dedupliziert.
- `/preview` ermöglicht einen sicheren Test der RSI-Abholung ohne Secrets.
- `/run` veröffentlicht neue News in `public/data/news.json`, sobald GitHub Secrets konfiguriert sind.
- OpenAI ist optional: ohne API-Key werden zunächst offizielle Überschriften/Quellen übernommen.
- Mit OpenAI werden Titel, Kurzfassung und Kategorie automatisch erzeugt.
- Static Assets aus `public/` werden korrekt ausgeliefert.
- Version 0.5 ist bewusst ein Zwischenstand: Patch-Vergleich, Events/Free Fly und Deals folgen auf der nächsten Stufe.
