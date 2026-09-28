# Verse Radar 0.9.11

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
- Secret: `RUN_SECRET` (für die neue Steuerungsseite erforderlich; für die älteren `/run`-Aufrufe optional)
- Variable: `GITHUB_REPO` = `VerseRadar/verse-radar`
- Variable optional: `GITHUB_BRANCH` = `main`
- Variable optional: `MAX_ITEMS`
- Variable optional: `NEWS_AUTO_PUBLISH` = `true` **erst nach Prüfung von `/preview/news` und einem erfolgreichen manuellen `/run/news` setzen**. Bis dahin pausiert der automatische News-Import; Patch-Automatik bleibt separat durch `PATCH_AUTO_PUBLISH` gesteuert.
- Variable optional: `PATCH_AUTO_PUBLISH` = `true` erst nach Prüfung der Patch-Vorschau und dem ersten manuellen Import setzen. Diese Variable steuert nur den automatischen Patch-Import.

Cron: bisheriger Zwei-Stunden-Takt (`0 */2 * * *`) und neuer Zwei-Minuten-Takt (`*/2 * * * *`). Der neue Takt schreibt nur nach Start über `/backfill` Patchdaten; News bleiben davon unberührt. Ohne `NEWS_AUTO_PUBLISH=true` und ohne `PATCH_AUTO_PUBLISH=true` schreibt der Zwei-Stunden-Cron keine Daten. Der manuelle Endpunkt `/run/news` veröffentlicht nur News; `/run` veröffentlicht News und Patches. Falls `RUN_SECRET` gesetzt ist, benötigen die manuellen Endpunkte den Schlüssel.

### Patch-History automatisch fertigstellen (0.9.7)
1. Das Cloudflare Worker-Secret `RUN_SECRET` einmalig auf einen eigenen langen Wert setzen. Wenn du schon einen Wert gesetzt hast, diesen weiterverwenden. Danach benötigen die bisherigen manuellen `/run/patches`-Links `?key=DEIN_WERT`.
2. Update 0.9.7 mit `wrangler.toml` veröffentlichen; im Cloudflare-Dashboard prüfen, dass **beide** Cron-Trigger aktiv sind, insbesondere `*/2 * * * *`. Bei Änderungen kann die Aktivierung bis zu 15 Minuten dauern.
3. `/backfill` auf deiner Worker-Adresse öffnen, das Secret eingeben und **Starten** klicken. Die Seite kann geschlossen werden. **Status prüfen** zeigt zuletzt gespeicherte Einträge, neue Einträge, Archivseite und noch fehlende 3.x-Versionen. **Anhalten** pausiert; **Starten** setzt fort.
4. Bei einer Fehlermeldung hält der Import an. Den angezeigten vollständigen Status zur Prüfung schicken. Sobald alle 81 bekannten 3.x-Versionen gespeichert und alle Archivseiten durchsucht sind, wechselt der Status automatisch auf `completed`.

Jeder Durchlauf nutzt die bestehende Begrenzung von acht historischen Versionen und zwei Archivseiten. Für den Start ist kein `PATCH_AUTO_PUBLISH=true` nötig. Die Steuerdatei `public/data/patch-backfill-control.json` wird beim ersten Start auf GitHub angelegt; weder diese Datei noch die gespeicherten Patchdaten werden von der ZIP ersetzt. Die acht auswertbaren Einträge der aktuellen 0.9.6-Vorschau können vor dem Update manuell importiert werden; andernfalls übernimmt sie der erste automatische Durchlauf.

**0.9.8:** Wenn eine historische Version unbrauchbar war und der bisherige Cursor bereits weitergerückt ist, prüft der nächste Durchlauf diese Lücke zuerst erneut. Ist die Quelle weiterhin nicht auswertbar, pausiert die Automatik mit `lastRun.historicalUnusableVersions` einschließlich Version und Grund. Ein Klick auf „Anhalten“ löscht diese Fehlermeldung nicht mehr. Nach dem Einspielen der ZIP auf der Steuerungsseite wieder „Starten“ wählen; ein separater Reset des gespeicherten Patchstandes ist nicht erforderlich.

**0.9.9:** Die Archivquellen zu Alpha 3.17.5, 3.17.4 und 3.11.1a werden anhand ihrer tatsächlichen kurzen Patch-Abschnitte ausgewertet. Für diese drei Versionen liegen offizielle RSI-Spectrum-Threads als Quelllink vor. Auf der pausierten `/backfill`-Seite nach dem Update einmal „Starten“ wählen. Wenn eine andere Version wegen eines Quellenfehlers nicht verarbeitet werden kann, hält die Automatik weiter an und nennt Version und Ursache.

**0.9.10:** Bei 3.11.1a steht die Versionskennung im Wiki vor der eigentlichen Patch-Notiz und fällt bei der Textbereinigung weg. Der Worker prüft sie nun anhand des Wiki-API-Titels und übernimmt nur Korrekturen, deren Inhalte im bereinigten Patchabschnitt wirklich vorkommen. Der zuvor pausierte Lauf kann auf `/backfill` mit „Starten“ fortgesetzt werden; alte Patch-Einträge und die Fortschrittsdateien bleiben bestehen.

**0.9.11:** Alpha 3.1.3 und 3.0.0 erhalten gezielte Quellenprüfung und konkrete deutsche Änderungspunkte. 3.1.3 ist kürzer als die bisherige Mindestlänge, 3.0.0 verwendet eine andere Gliederung. Nach dem Update `/backfill` öffnen und einmal **Starten** wählen. Die bereits gespeicherten 102 Patches und `nextPage: 35` bleiben erhalten; die weiteren Comm-Link-Seiten werden automatisch in begrenzten Durchläufen gescannt.
Version 0.7.0 entfernt technische Archiv-Einträge und ersetzt wiederholte News-Platzhalter mit vorsichtigen deutschen Beschreibungen, die auf dem Titel beruhen. Wo eine bereits geprüfte Patch-Zusammenfassung zur exakt selben Comm-Link-ID vorliegt, nutzt die News-Karte deren erste zwei Sätze. Artikelinhalte werden ohne brauchbare Quellbeschreibung oder KI-Schlüssel nicht als vollständig zusammengefasst ausgegeben.
Die Patch-Seite zeigt höchstens fünf aktuelle Einträge; die History zeigt alle gespeicherten Versionen. Der Worker ergänzt bei jedem geprüften manuellen Patch-Import zwei ältere Archivseiten und behält bestehende Versionen. Wie weit das Archiv zurückreichen kann, hängt von der verfügbaren Patch-Quelle ab. Die geprüfte Patch-Aufbereitung bleibt auf `summaryVersion=0.6.8`.
Version 0.8.1 übernimmt neue Einträge in die Patch History nur, wenn ihr RSI-Quelllink tatsächlich auf Patch Notes zeigt. Ältere bereits gespeicherte Update-Ankündigungen bleiben erhalten, werden aber als solche bezeichnet und mit ihrem echten RSI-Link versehen. Eine allgemeine Titelübereinstimmung wie „Alpha 4.7.2“ genügt nicht mehr für eine Patch Note.
Version 0.8.2 liest das GitHub-Archiv unmittelbar vor dem Schreiben erneut. Bei einem 409-Konflikt wird es höchstens dreimal mit dem jeweils aktuellen GitHub-Stand zusammengeführt. Zusätzliche Einträge anderer Schreibvorgänge bleiben erhalten. Der Archivfortschritt wird erst nach dem erfolgreichen Archiv-Schreibzugriff gesetzt und ebenfalls bei 409 mit dem neueren Stand abgeglichen.
Version 0.8.3 ergänzt `/preview/patches?diagnostic=1`: eine kurze, schreibfreie Übersicht über Anzahl und ID-Bereich der geprüften Archivseiten sowie gefundene Alpha-Titel, Quellkanal, URL und Filterergebnis. Damit können Lücken im Community-Archiv ohne weiteren Import geprüft werden.
Version 0.8.4 prüft die offiziell gelistete Alpha 4.7 (ID 21070) zusätzlich direkt anhand der Community-Detailseite und der Wiki-Update-Seite. In der kompakten Diagnose meldet `seedDiagnostics`, ob ausreichend Quelltext vorliegt. Ein Eintrag ohne auswertbaren Quelltext wird nicht veröffentlicht. Die ZIP enthält keine Archiv-Fortschrittsdatei mehr: Bei Updates die bereits im GitHub-Repository vorhandene Datei `public/data/patch-archive-state.json` behalten. Bei einer vollständigen Neuinstallation legt der Worker sie beim ersten erfolgreichen Import selbst an.
Version 0.8.5 ergänzt für Alpha 4.7 eine ausführlichere deutsche Aufbereitung von Missionen, Inventar, Crafting, Bergbau, Schiffen, Nyx und VR. Das Datum ist anhand der Wiki-Patchseite auf den 25.03.2026 gesetzt. Vor der Veröffentlichung `/preview/patches` prüfen.
Version 0.8.6 verwendet für Alpha 4.7 den tatsächlichen RSI-Link mit dem URL-Ende `Alpha-47`.
Version 0.8.7 prüft die offiziell verlinkten Alpha-Versionen 4.6, 4.5 und 4.4 zusätzlich über Wiki-Patchtexte. Die Community-API liefert dafür teils `SCW/...-API`-Platzhalter statt der Original-URLs. Gezielte deutsche Änderungspunkte werden nur angelegt, wenn die wesentlichen Quellabschnitte vorhanden sind; andernfalls bleibt der Eintrag in der Diagnose sichtbar, wird jedoch nicht veröffentlicht. Vor `/run/patches` die neuen Einträge in `/preview/patches` auf Inhalt und RSI-Link prüfen.
Version 0.8.8 holt für 4.5 und 4.4 zusätzlich den vollständigen Wiki-Patchtext, falls der API-Detailtext wichtige Abschnitte auslässt. `seedDiagnostics.matchedChanges` zeigt die erkannten Punkte. Die Update-ZIP enthält weder `public/data/patches.json` noch die Fortschrittsdatei: Beide vorhandenen GitHub-Dateien bei Updates behalten. Die vorherigen ZIPs enthielten einen alten Stand mit sechs Patches, der bei einer vollständigen Dateiübernahme den veröffentlichten siebten Eintrag überschreiben konnte.
Version 0.8.9 ergänzt die offiziell verlinkten Alpha-Versionen 4.3.2, 4.3.1 und 4.3 als geprüfte Archivkandidaten mit eigenen deutschen Änderungspunkten. Die kompakte Diagnose zeigt zusätzlich `patchAutoPublishEnabled`, damit sich eine mögliche Cron-Veröffentlichung leichter einordnen lässt. Vor jedem Import die Vorschau und die dort aufgeführten neuen Einträge prüfen.
Version 0.9.0 ergänzt die Lücke mit Alpha 4.2.1, 4.2, 4.1.1 und 4.1: offiziell belegte Links und Daten, eigene deutsche Änderungspunkte und Quelltextprüfung vor Veröffentlichung. Der Import-Cursor kann auf Seite 9 bleiben; die zusätzliche Quellprüfung findet ältere Versionen unabhängig davon.
Version 0.9.1 ergänzt 4.0, 4.0.1 und 4.0.2 sowie 4.7.1, 4.7.2 und 4.8.2. Die drei 4.0-Versionen haben eigene RSI-Patch-Notes-Links. Für die nummerierten Content-Updates 4.7.1 und 4.8.2 führt der Wiki-Link „Full patch notes“ zum übergeordneten Hauptpatch; sie erhalten deshalb einen als Community-Archiv gekennzeichneten Quelllink und den Typ `Content Update`. 4.7.2 ist mit seiner offiziellen RSI-Update-Meldung verlinkt. Die bereits gespeicherten 4.8.1/4.8.3 bleiben als Release Info erkennbar; 3.x folgt separat.
Version 0.9.2 erkennt Alpha 4.0 auch dann, wenn die Detail-API nur den verkürzten Text mit Wipe, Pyro und Server Meshing liefert. Die zusätzlichen Änderungspunkte sind anhand der vollständigen Wiki-Patchseite und des offiziellen RSI-Patchlinks geprüft.
Version 0.9.3 begrenzt Quellabrufe pro Aufruf, damit der Patch-Import im Anfragebudget von Cloudflare Workers Free bleibt. Bereits gespeicherte Versionen werden nicht erneut abgerufen. In der kompakten Vorschau zeigen `deferredSeedItems` und `deferredPageItems` die zunächst zurückgestellten Quellen. Ein Aufruf veröffentlicht maximal zwei fehlende fest hinterlegte Versionen und maximal zwei neue Detailfunde aus dem Seitenarchiv. Für die übrigen 4.x-Einträge denselben Ablauf aus Vorschau und `/run/patches` wiederholen, bis beide `deferred`-Werte null sind und `newItems` null ist. Ein zuvor gescheiterter Lauf kann das Archiv bereits teilweise gespeichert haben; deshalb zuerst mit der Vorschau den GitHub-Stand neu prüfen.
Version 0.9.4 ergänzt die dort gelisteten 3.x-Quellen aus dem Star Citizen Wiki und prüft pro Aufruf maximal acht fehlende historische Versionen. Die Quellenprüfung setzt einen datierten und auswertbaren Patchtext voraus. Wo der archivierte Eintrag einen nachweisbaren RSI-Patch-Notes-Link enthält, wird dieser verwendet. Andernfalls trägt der Eintrag einen als `Community Archive` gekennzeichneten Wiki-Link. Zusätze wie `a` und `b` bleiben eigenständige Versionen. `historicalCandidates` zählt die im Quellenverzeichnis gefundenen 3.x-Versionen; `historicalDeferredItems` zeigt die noch nicht abgefragten Seiten, `historicalUnusableItems` fehlende oder unvollständige Inhalte aus diesem Durchgang. Für die ganze 3.x-History sind wegen des Cloudflare-Anfragelimits mehrere geprüfte `/run/patches`-Aufrufe erforderlich; eine neue ZIP ist dafür nicht jedes Mal nötig. `backfillComplete` bezieht sich weiterhin auf den getrennten Comm-Link-Seitencursor und ist kein Fertigsignal für 3.x.
Version 0.9.5 behebt einen leeren 3.x-Quellenindex der Wiki-API: Die 80 öffentlich gelisteten historischen Versionsnummern sind jetzt fest im Worker hinterlegt. Für die Inhalte, Daten und Original-Links werden die einzelnen Wiki-Patchseiten weiterhin live geprüft. Eine nicht lesbare Patchseite erscheint mit `reason` in `historicalDiagnostics` und wird nicht veröffentlicht.
Version 0.9.6 ergänzt Alpha 3.17.2a als eigenständigen Hotfix: Er erscheint im Comm-Link-Archiv und als offizielle RSI-Spectrum-Patch Note, fehlt aber in der 80er-Liste der Wiki-Patchkategorie. Der historische Index umfasst damit 81 Versionen. Die 3.17.2a-Zusammenfassung bleibt auf die Inhalte dieses Hotfixes beschränkt. Bereits gespeicherte Patches und Fortschrittsdateien bleiben beim Update erhalten.
Der lokale Datenstand enthält 13 redaktionelle News und sechs ältere Patches als Rückfall bei API-Ausfall. Bei dieser Update-ZIP bleiben die vorhandenen GitHub-Patchdaten maßgeblich.

## Datenstruktur
Die Website-Daten liegen ausschließlich unter `public/data/`.
- `public/data/news.json`
- `public/data/patches.json` (vorhandenen GitHub-Stand behalten; nicht in der Update-ZIP)
- `public/data/patch-archive-state.json` (vom Worker gespeicherter Fortschritt; nicht in der ZIP enthalten)
- `public/data/patch-backfill-control.json` (vom Worker angelegter Start- und Laufstatus; nicht in der ZIP enthalten)
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
- `/run/patches` – schreibt nur das Patch-Archiv und Metadaten. Vor jedem Aufruf `/preview/patches?diagnostic=1` prüfen; anschließend die nächste Vorschau der noch offenen Versionen prüfen. `patchHistoricalDeferredItems` zeigt die noch ungeprüften 3.x-Seiten. Bei `historicalUnusableItems > 0` die betroffenen Versionen aus `historicalDiagnostics` prüfen, bevor die 3.x-Runde als abgeschlossen gilt. Vorhandene Archiveinträge bleiben erhalten. Falls die Archivdatei geschrieben wurde, aber der Fortschritt nicht, liest der nächste Aufruf das gespeicherte Archiv erneut und setzt fort.
- `/backfill` – mit `RUN_SECRET` geschützte Start-, Stopp- und Statusseite für den begrenzten, alle zwei Minuten fortgesetzten Import.

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
