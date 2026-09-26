# Changelog – Verse Radar

## 0.6.9 – Kennzeichnung der Zusammenfassungen
- News und Patch Notes werden nur bei `ai: true` als KI-gestützt bezeichnet. Regelbasiert erzeugte Patch-Zusammenfassungen sind entsprechend gekennzeichnet; News ohne KI tragen die neutrale Bezeichnung „Kurzbeschreibung“.
- Startseite und Patch History lesen wie die Patch-Seite die aktuellen Einträge von `/api/patches`, mit Rückfall auf die lokale Datei bei API-Fehlern. Die History verlinkt echte Änderungen und Originalquellen statt einen noch nicht vorhandenen Vergleich zu versprechen.
- Die Patch-Seite beschreibt die tatsächlich dargestellten Änderungen je Version und verweist für den vollen Wortlaut auf die Originalquellen.
- Worker- und Frontend-Version aktualisiert; die Patch-Aufbereitung bleibt unverändert auf `summaryVersion=0.6.8`, damit bereits geprüfte Einträge weiterverwendet werden.

## 0.6.8 – Wiederholte Inhalte präziser einordnen
- „Tactical Strike Group“ wird nach dem ersten Alpha-4.8-Eintrag nicht mehr allein wegen einer späteren Erwähnung als neuer Inhalt ausgegeben.
- Das CQ7 Bullpup wird nur bei Alpha 4.9 als neue Waffe ausgewiesen; eine bloße Erwähnung in späteren Patches genügt nicht.
- Recco Battaglia wird bei Alpha 4.10 als fortgeführte Auftragsreihe statt als erstmals eingeführter Missionsgeber beschrieben.
- Gespeicherte 0.6.7-Zusammenfassungen werden mit `summaryVersion=0.6.8` neu erzeugt. Automatische Patch-Veröffentlichung bleibt deaktiviert.


## 0.6.7 – Patch-Aliasse und fehlende Quelltexte
- Titelvarianten mit derselben numerischen Version werden als ein Patch behandelt; „Alpha 4.8: Tactical Strike“ kann nicht mehr fälschlich als Vorgänger von Alpha 4.8 erscheinen.
- Einträge ohne auswertbaren Quelltext werden nicht als allgemeine Patch-Zusammenfassung veröffentlicht. Fehlen alle brauchbaren Quellen, meldet die Vorschau einen Fehler.
- Bei doppelten Versionen wird zuerst ein brauchbarer Quelltext bevorzugt; bei zwei brauchbaren Treffern bleibt die neuere Quell-ID maßgeblich.
- Die Vorschau bleibt ohne GitHub-Schreibzugriff, der automatische Patch-Import pausiert weiterhin bis zur ausdrücklichen Aktivierung.


## 0.6.6 – Patch-Vorschau zeigt die veröffentlichbare Ausgabe
- `/preview/patches` führt nun dieselbe Aufbereitung wie `/run` aus, ohne Dateien in GitHub zu schreiben. Die Vorschau enthält `previous`, `summary`, `changes`, `fullSummary`, `sourceUrl`, `ai` und `summaryVersion`.
- Eine kompakte `discovery`-Diagnose zeigt Quell-ID und Textlänge, ohne komplette Original-Patch-Notes in der Vorschau auszugeben.
- Fallback-Erkennung für konkrete ältere Patch-Themen wie Recco Battaglia, Fracht- und Kampfmissionen, Defend Location – Ship Battles V3 sowie XenoThreat ergänzt; ein Punkt wird nur gezeigt, wenn der abgerufene Quelltext dazu passt.
- Ausgewählte Details zu Orison Relief Support und weiteren Ausrüstungs- und Belohnungsthemen ergänzt.
- Gespeicherte Zusammenfassungen früherer Versionen werden neu bewertet. News-Import und MediaWiki-Inhaltsabruf bleiben erhalten.
- Der Zeitplan aktualisiert News weiter, schreibt Patch-Daten jedoch erst nach dem Setzen von `PATCH_AUTO_PUBLISH=true`. `/run` bleibt der manuelle erste Patch-Import nach Prüfung der Vorschau.

## 0.6.5 – Patch-Zusammenfassungen deutlich verbessert
- Die echte Patch-Notiz bleibt weiterhin die Datenbasis; 0.6.4 hatte bereits den Content-Fetch repariert.
- Fallback-Zusammenfassungen wurden für große Patches wie 4.10, 4.10.1 und 4.9 deutlich erweitert.
- „Was hat sich geändert?“ erzeugt jetzt konkrete Punkte zu Gameplay, Missionen, Schiffen/Fahrzeugen, Loot, Technik, VR und wichtigen Fixes statt allgemeiner Sammeltexte.
- Die lokale deutsche Gesamtzusammenfassung greift wichtige konkrete Patch-Themen und dokumentierte Fix-Zahlen auf.
- Bereits gespeicherte 0.6.4-Zusammenfassungen werden nicht mehr fälschlich als aktuell übernommen; 0.6.5 erzeugt sie neu.
- Der OpenAI-Prompt wurde präzisiert: 6–12 konkrete Änderungen, 350–900 Wörter Gesamtzusammenfassung, nur tatsächlich im Patch vorhandene Kategorien.
- Worker-Version, User-Agent und GitHub-Commitmeldungen auf 0.6.5 aktualisiert.

## 0.6.3 – Patch Notes repariert und robuster gemacht
- Doppelte Patch-Versionen werden jetzt vor der Verarbeitung entfernt; bei `Alpha 4.10.1` wird der aktuellere Datensatz bevorzugt.
- `previous` wird erst nach der Bereinigung ermittelt und zeigt damit die tatsächliche Vorgängerversion statt eines Duplikats.
- Patch-Inhalte werden aus mehreren möglichen API-Feldern erkannt.
- Falls die Listen-/Detailantwort keinen ausreichenden Inhalt liefert, versucht Verse Radar zusätzlich das archivierte Patch-Notes-Dokument von StarCitizen.tools auszulesen.
- Strukturierte Änderungen für Gameplay, Inventar, Audio sowie Bugfixes werden auch ohne OpenAI-Key erzeugt.
- Die lokale Fallback-Zusammenfassung wurde erweitert und bleibt deutsch.
- Versionsanzeige, Worker-User-Agent, GitHub-Commitmeldungen und README auf 0.6.3 aktualisiert.
- Attribution für `api.star-citizen.wiki` ergänzt.

## 0.6.2 – Patch-Archiv-Fallback korrigiert
- Korrekte StarCitizen.tools-Wiki-Seiten für Patch-Versionen verwendet.
- Patch-Titel mit Varianten wie `Alpha 4.10: ...` werden erkannt.
- Patch-Versionen werden nach numerischer Versionsnummer sortiert und dedupliziert.

## 0.6.1 – Patch-Notes-Datenpipeline
- Patch-Discovery und Archiv-Fallback erweitert.
- Vorgängerversion und Patch-Vergleich bereinigt.
- Strukturierte Patch-Daten für die spätere deutsche Aufbereitung vorbereitet.

## 0.6.0
- Patch-Notes-Pipeline ergänzt: automatische Erkennung aktueller Alpha-Patchnotes über RSI/Star Citizen Wiki API.
- Neue Worker-Routen `/preview/patches` und `/api/patches`.
- `public/data/patches.json` wird bei `/run` automatisch aktualisiert.
- Patch-Darstellung um „Was hat sich geändert?“, strukturierte Kategorien und deutsche Zusammenfassung erweitert.
- Optional: KI-Zusammenfassung über `OPENAI_API_KEY`; ohne API-Key bleibt ein lokaler Fallback.
- Original-RSI-Quelle wird immer verlinkt; Verse Radar veröffentlicht keinen offiziellen RSI-Originaltext.
- Version auf 0.6.0 erhöht.

# Verse Radar – Changelog

## 0.5.11 – Datenstruktur bereinigt
- `public/data/` ist die einzige vorgesehene Datenablage für die Website.
- Alle sechs Daten-Dateien werden über `/data/...` im Browser geladen; das entspricht der Cloudflare-Asset-Wurzel `public/`.
- Der Worker liest und schreibt `public/data/news.json` und `public/data/meta.json`.
- GitHub-Konfiguration bleibt auf `VerseRadar/verse-radar`, Branch `main`, maximal 20 importierte Comm-Link-Beiträge.
- Die Root-Ebene `data/` wird nicht mehr verwendet; bestehende alte Dateien dort müssen einmalig im GitHub-Repository gelöscht werden.
- `/debug/github` bleibt vorerst für die Verifikation der GitHub-Anbindung erhalten.
- Changelog wird zentral in dieser Datei fortgeführt.

## 0.5.10 – GitHub-Diagnose
- Fügt `/debug/github` hinzu, um die GitHub-Verbindung des Workers gezielt zu diagnostizieren.
- Zeigt keinen Token an, sondern nur Konfigurationsstatus, Repository, Branch, HTTP-Status, Dateistatus und JSON-Ergebnis.
- `/api/news` bleibt unverändert funktionsfähig und verwendet weiterhin GitHub mit statischem Fallback.
- Version auf 0.5.10 aktualisiert.

## 0.5.9
## Fix
- `wrangler.toml` now contains the actual GitHub repository `VerseRadar/verse-radar`.
- Explicitly configures `GITHUB_BRANCH = "main"` and `MAX_ITEMS = "20"`.
- Keeps `GITHUB_TOKEN` as a Cloudflare Secret; it is not stored in this file.
- `/api/news` can therefore read the current `public/data/news.json` from the configured GitHub repository.

## Why this matters
The Worker was running correctly, but the deployment configuration still contained the placeholder `DEIN-GITHUB-USERNAME/verse-radar`. That caused the live news endpoint to fall back to an empty result even though `/preview` could still fetch the current RSI news.

## 0.5.8
## Fix: News API
- `/api/news` now reads `public/data/news.json` explicitly from the configured GitHub branch.
- GitHub repository/branch values are normalized before the API request.
- Base64 decoding is handled more robustly.
- Static asset fallback no longer references an unavailable request variable.
- Worker and frontend version updated to 0.5.8.

## 0.5.7
- Robust news API handling.
- Frontend validates that `/api/news` returns an array and falls back to static news if the API is unavailable or malformed.
- News API now sends explicit no-cache headers and a source diagnostic header.
- Version strings updated to 0.5.7.

## 0.5.6
- Website news now loads from `/api/news` instead of relying on the statically deployed `public/data/news.json`.
- `/api/news` reads the latest `public/data/news.json` directly from the configured GitHub repository.
- Static JSON remains as a fallback if GitHub cannot be read.
- Updated worker and frontend version identifiers to 0.5.6.
- Fixed the GitHub update commit message version.
- Existing `/preview`, `/run`, and scheduled automation remain unchanged.

## 0.5.5
- Robust RSI ingestion with structured fallback via the Star Citizen Wiki API.
- Original `sourceUrl` remains the official RSI Comm-Link URL.
- Keeps direct RSI HTML parsing as primary path.
- Adds detailed diagnostics for both RSI and API fallback.
- Normalizes API records into Verse Radar news items.
- No OpenAI or GitHub secrets required for `/preview`.
- The fallback API is community-maintained, archives official RSI Comm-Links, and requires attribution for public projects; Verse Radar should credit api.star-citizen.wiki in the site footer/about page if this fallback remains enabled.

## 0.5.4
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

## 0.5.2
## Fix
- Fehlende Funktion `cleanUrl()` ergänzt, die in 0.5.1 den `/preview`-Aufruf mit `cleanUrl is not defined` abgebrochen hat.
- Relative und absolute RSI-Links werden sauber normalisiert.
- `/preview` kann damit wieder direkt getestet werden, bevor GitHub-Schreibzugriff eingerichtet wird.

## Nächster Schritt
Nach dem Deployment zuerst `/preview` öffnen. Wenn dort aktuelle RSI-Beiträge aus September 2026 erscheinen, richten wir anschließend den GitHub-Schreibzugriff ein, damit die News automatisch auf der öffentlichen Seite aktualisiert werden.

## 0.5.1
## RSI-Abholung korrigiert
- Der Worker nutzt die aktuelle Comm-Link-Sortierung (`sort=publish_new`) und filtert echte Artikel-Links statt Navigationslinks.
- Die `/preview`-Route liefert damit die neuesten offiziellen RSI-Comm-Link-Beiträge.
- Für die gefundenen Beiträge werden die Veröffentlichungsdaten aus den jeweiligen Originalseiten ausgelesen, sofern verfügbar.
- Mehrere RSI-URL-Varianten dienen als Fallback, falls RSI die Listenparameter verändert.
- GitHub- und OpenAI-Anbindung bleiben wie in 0.5 optional.

## 0.4.1
## Fix: Static Website auf Cloudflare Workers

- `public/` wird über Cloudflare Workers Static Assets ausgeliefert.
- Die JSON-Daten liegen jetzt unter `public/data/`, damit die Website sie öffentlich laden kann.
- Der automatische Worker aktualisiert dieselben Dateien im GitHub-Repository.
- Die Website zeigt damit nach einem erfolgreichen Deployment tatsächlich die Verse-Radar-Oberfläche statt nur die Worker-Statusmeldung.
- Versionsanzeige auf 0.4.1 aktualisiert.

## Wichtig

Die automatische RSI-/OpenAI-Pipeline benötigt weiterhin die entsprechenden Cloudflare-Secrets (`OPENAI_API_KEY`, `GITHUB_TOKEN`) und die korrekte `GITHUB_REPO`-Variable. Diese Version ändert daran nichts.

## 0.4
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

## 0.3
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

## 0.2
- aktuelle RSI-bezogene Demo-News statt generischer Platzhalter
- Patch-Ansicht mit Versionsvergleich Alpha 4.10 / 4.9
- Event-, Deal- und Free-Fly-Datenstruktur
- News-Karten mit Hover-Effekt
- sichtbare Versionskennung
- automatische Verarbeitung weiterhin vorbereitet
