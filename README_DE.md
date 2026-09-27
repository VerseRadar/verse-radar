# Verse Radar 0.8.2

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
- Variable: `GITHUB_REPO` = `VerseRadar/verse-radar`
- Variable optional: `GITHUB_BRANCH` = `main`
- Variable optional: `MAX_ITEMS`
- Variable optional: `NEWS_AUTO_PUBLISH` = `true` **erst nach Prüfung von `/preview/news` und einem erfolgreichen manuellen `/run/news` setzen**. Bis dahin pausiert der automatische News-Import; Patch-Automatik bleibt separat durch `PATCH_AUTO_PUBLISH` gesteuert.
- Variable optional: `PATCH_AUTO_PUBLISH` = `true` erst nach Prüfung der Patch-Vorschau und dem ersten manuellen Import setzen. Diese Variable steuert nur den automatischen Patch-Import.

Cron: alle 2 Stunden (`0 */2 * * *`).
Ohne `NEWS_AUTO_PUBLISH=true` und ohne `PATCH_AUTO_PUBLISH=true` schreibt der Cron keine Daten. Der manuelle Endpunkt `/run/news` veröffentlicht nur News; `/run` veröffentlicht News und Patches. Falls `RUN_SECRET` gesetzt ist, benötigen beide Endpunkte den gewohnten Schlüssel.
Version 0.7.0 entfernt technische Archiv-Einträge und ersetzt wiederholte News-Platzhalter mit vorsichtigen deutschen Beschreibungen, die auf dem Titel beruhen. Wo eine bereits geprüfte Patch-Zusammenfassung zur exakt selben Comm-Link-ID vorliegt, nutzt die News-Karte deren erste zwei Sätze. Artikelinhalte werden ohne brauchbare Quellbeschreibung oder KI-Schlüssel nicht als vollständig zusammengefasst ausgegeben.
Die Patch-Seite zeigt höchstens fünf aktuelle Einträge; die History zeigt alle gespeicherten Versionen. Der Worker ergänzt bei jedem geprüften manuellen Patch-Import zwei ältere Archivseiten und behält bestehende Versionen. Wie weit das Archiv zurückreichen kann, hängt von der verfügbaren Patch-Quelle ab. Die geprüfte Patch-Aufbereitung bleibt auf `summaryVersion=0.6.8`.
Version 0.8.1 übernimmt neue Einträge in die Patch History nur, wenn ihr RSI-Quelllink tatsächlich auf Patch Notes zeigt. Ältere bereits gespeicherte Update-Ankündigungen bleiben erhalten, werden aber als solche bezeichnet und mit ihrem echten RSI-Link versehen. Eine allgemeine Titelübereinstimmung wie „Alpha 4.7.2“ genügt nicht mehr für eine Patch Note.
Version 0.8.2 liest das GitHub-Archiv unmittelbar vor dem Schreiben erneut. Bei einem 409-Konflikt wird es höchstens dreimal mit dem jeweils aktuellen GitHub-Stand zusammengeführt. Zusätzliche Einträge anderer Schreibvorgänge bleiben erhalten. Der Archivfortschritt wird erst nach dem erfolgreichen Archiv-Schreibzugriff gesetzt und ebenfalls bei 409 mit dem neueren Stand abgeglichen.
Der beigelegte statische Datenstand enthält 13 redaktionelle News und alle sechs geprüften Patches als Rückfall bei API-Ausfall. Der Datumsstand ist der bestätigte Erstimport vom 26.09.2026.

## Datenstruktur
Die Website-Daten liegen ausschließlich unter `public/data/`.
- `public/data/news.json`
- `public/data/patches.json`
- `public/data/patch-archive-state.json` (Fortschritt des schrittweisen Archivimports)
- `public/data/deals.json`
- `public/data/events.json`
- `public/data/freefly.json`
- `public/data/meta.json`

Im Browser werden diese Dateien über `/data/...` geladen, weil `public/` bei Cloudflare als Website-Wurzel dient. Der alte Root-Ordner `data/` wird nicht mehr verwendet und sollte im GitHub-Repository gelöscht werden.

## Test-Endpunkte
- `/health` – zeigt die laufende Worker-Version.
- `/preview` – holt RSI-Beiträge ab, ohne GitHub zu verändern.
- `/preview/news` – berechnet die fertig veröffentlichbaren News inklusive `count`, `newItems`, `refreshedItems`, `aiItems` und `items`, ohne GitHub zu verändern. Vor `/run/news` prüfen.
- `/preview/patches` – erstellt ohne GitHub-Schreibzugriff die fertig aufbereiteten Patch-Daten einschließlich `changes`, `summary`, `fullSummary` und Vorgängerversion; zeigt auch `newItems`, `scannedPages`, `nextPage` und `backfillComplete`. Erst diese Ausgabe prüfen, bevor Patches veröffentlicht werden.
- `/api/patches` – liefert die aktuell gespeicherten Patch Notes für die Website.
- `/run` – führt den Import aus und schreibt bei vorhandenen GitHub-Zugangsdaten die Daten zurück.
- `/run/news` – schreibt nur News und Metadaten zurück; gespeicherte Patch Notes bleiben erhalten.
- `/run/patches` – schreibt nur das Patch-Archiv und Metadaten. Vor jedem Aufruf `/preview/patches` prüfen; anschließend kann bei Bedarf mit der nächsten Vorschau die folgende Archivseite geprüft werden. Vorhandene Archiveinträge bleiben erhalten. Bei unlesbaren Quelldaten oder GitHub-Daten bricht der Import ab. Falls die Archivdatei geschrieben wurde, aber das Schreiben des Fortschritts fehlschlägt, wiederholt der nächste Aufruf dieselbe Seite.

## 0.5.8
Der RSI-Parser wurde robuster gegen Änderungen am HTML-Aufbau der Comm-Link-Seite gemacht. `/preview` liefert bei einem Fehler zusätzliche technische Diagnosewerte, damit ein weiterer Fehler gezielt behoben werden kann.

## Was bewusst manuell bleibt
Deals werden noch nicht automatisch aus dem Pledge Store übernommen. Das soll erst mit einer belastbaren offiziellen/strukturierten Quelle passieren, damit keine veralteten Preise auf der Seite landen.

## Rechtlicher Fan-Hinweis
Vor Veröffentlichung die aktuellen RSI-Fankit/Fan-Site-Vorgaben prüfen und den offiziellen Hinweis sichtbar übernehmen. Inhalte werden nur zusammengefasst; Originalquellen werden verlinkt.


## Diagnose
- `/debug/github` prüft die GitHub-Verbindung des Workers, ohne das Secret auszugeben.

## Patch-Notes-Quelle
Für die Patch-Notes-Erkennung und Archivierung wird neben der offiziellen RSI-Quelle die Community-API von `api.star-citizen.wiki` verwendet. Diese archiviert offizielle RSI-Comm-Links; die Originalquelle auf RSI bleibt auf Verse Radar verlinkt.
