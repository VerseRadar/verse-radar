# Verse Radar 0.5.4

## RSI-Importer robuster gemacht

- Parser nicht mehr an eine einzige HTML-Struktur gebunden.
- Erkennung von Comm-Link-URLs über mehrere Muster.
- Unterstützung für absolute und relative RSI-URLs.
- Unterstützung für escaped URLs aus serialisiertem HTML.
- Fallback-Titelerkennung aus dem URL-Slug, wenn der Linktext nicht direkt gefunden wird.
- Doppelte URLs werden entfernt.
- `/preview` liefert bei einem Importfehler jetzt technische Debug-Informationen (HTTP-Status, HTML-Länge, gefundene Kandidaten, erkannte Beiträge).
- Wenn Beiträge erkannt werden, aber der Relevanzfilter keinen Treffer liefert, werden ersatzweise die neuesten erkannten Beiträge verwendet, damit der Import nicht leer bleibt.
- Versionsnummern und User-Agent auf 0.5.4 aktualisiert.

## Weiterhin unverändert

- Noch kein GitHub-Writeback ohne `GITHUB_TOKEN` und `GITHUB_REPO`.
- OpenAI bleibt optional.
- Deals bleiben bewusst manuell.
