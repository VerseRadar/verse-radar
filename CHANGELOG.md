# 0.13.1

- Radar: Leuchtpunkte folgen dem Zeiger; Animationsverzögerungen bleiben beim Neustart erhalten.
- Version auf 0.13.1 angehoben.

# Changelog – Verse Radar

## 0.12.6 – Mehrzeilige Hinweise

- Zeilenumbrüche und Leerzeilen aus dem Angebots-Hinweisfeld werden auf der Deals-Seite sichtbar.
- Alle Funktionen und Korrekturen aus 0.12.5 enthalten; gespeicherte Daten bleiben erhalten.

## 0.12.5 – Bildkatalog und einfacher Game-Package-Editor

- Schiffssuche in der Verwaltung schlägt bereits gespeicherte Bilder vor.
- Neues Package-Bild kann nur für das jeweilige Angebot verwendet werden; Standardbild wird nur bewusst ersetzt.
- Bildkatalog bleibt nach Ablauf oder Entfernung eines Angebots erhalten.
- Spielzugangstext aus einzelnen Angeboten entfernt; einmalige Bestätigung in der Verwaltung und Hinweis oben auf der Deals-Seite.
- Referral-Hinweis und Link für neue RSI-Konten auf der Deals-Seite ergänzt; Vorteile für Verse Radar offengelegt.
- Bildvorschau, Kommapreise, manuelle Referral-Einschätzung und sieben Tage Anzeige aus 0.12.4 enthalten.

## 0.12.4 – Preise, Referral und Bildvorschau

- Bildvorschau durch Freigabe offizieller RSI-Bilder in der Sicherheitsrichtlinie repariert.
- Angezeigte EUR-Preise inklusive deutscher MwSt.; Eingabe und Vorschau im deutschen Kommaformat.
- Referral-Einschätzung als manuelles Ja/Nein statt USD-Vorsteuerbetrag.
- Automatisches Ausblenden ohne offizielles Enddatum erst nach sieben Tagen ohne neue Prüfung.
- Gespeicherte Daten und bereits hinterlegter Referral-Link bleiben erhalten.

## 0.12.3 – Bilder für Game Packages

- Bild des Packages oder Schiffs auf der Angebotsseite ergänzt.
- Verwaltung prüft offizielle direkte RSI-Bildadresse und zeigt ein Ladebild vor Veröffentlichung.
- Gespeicherte Einträge ohne Bild bleiben erhalten und können nach erneuter Prüfung ergänzt werden.
- Referral-Link und gespeicherte News, Patches, Events und Angebote bleiben unverändert.

## 0.12.2 – Game Packages und Referral-Preisgrenze

- Angebotsbereich auf Game Packages mit konkretem RSI-Package-Link begrenzt.
- Schiff, Spielzugang und sämtliche weiteren bestätigten Bestandteile werden einzeln angezeigt.
- Ja/Nein-Anzeige für die 40-USD-Preisgrenze vor Steuern; zusätzlicher Hinweis auf RSIs weitere Referral-Bedingungen.
- Hinweise zu ungesicherten Angaben und zur maßgeblichen Originalquelle ergänzt.
- Ältere unvollständige Angebote bleiben gespeichert, werden bis zur erneuten Prüfung nicht angezeigt.
- Bestehender Referral-Link und News-, Patch- und Eventdaten bleiben erhalten.

## 0.12.1 – Referral-Link und flexible Angebotsprüfung

- Vom Betreiber bereitgestellten Referral-Link hinterlegt; offizielle www-Adresse und Bindestriche im Code werden akzeptiert.
- Referral-Button wird ohne zusätzliche Worker-Variable aktiv; Bedingungen bleiben bei RSI nachzulesen.
- Ein offiziell nicht genanntes Angebotsende kann leer bleiben; die Anzeige endet dann spätestens 48 Stunden nach Prüfung.
- Offiziell genanntes Enddatum bleibt separat erkennbar; die Preisprüfung muss trotzdem frisch sein.
- Shopseiten mit oder ohne www-Adresse zulässig; News- und Patchdaten bleiben unverändert.

## 0.12.0 – Geprüfte Deals und funktionierender Referral-Link

- Die Deals-Seite zeigt nur geprüfte Game Packages und Angebote mit offizieller Shopseite, Preis, Währung und Ende.
- 48-Stunden-Grenze für die Preisprüfung; abgelaufene oder alte Angebote verschwinden automatisch.
- `/manage/deals` mit vorhandenem `RUN_SECRET`, Vorschau, GitHub-Schutz gegen konkurrierende Änderungen und Live-Daten über `/api/deals`.
- Referral-Platzhalterlink entfernt. Button nur bei gültigem `REFERRAL_URL` sichtbar; keine Änderungen an News oder Patches.
- Keine automatischen Preisbehauptungen und kein OpenAI-Key nötig.

## 0.11.2 – Verwaltungsseite ohne Asset-Bindung

- `/manage/events` wird direkt aus dem Worker ausgeliefert und benötigt keine `env.ASSETS`-Bindung oder separate CSS-Datei.
- Schutz durch `RUN_SECRET`, Vorschau und GitHub-Schreibpfad bleiben wie in 0.11.1.
- Test prüft ausdrücklich die Seite ohne Asset-Bindung; bestehende Daten bleiben erhalten.

## 0.11.1 – Bestätigte Zeiträume einfach pflegen

- `/manage/events`: geschütztes Formular mit vorhandenem `RUN_SECRET`, Vorschau und getrennter Veröffentlichung.
- Event-Meldungen können Titel und offiziellen Quelllink im Formular vorbelegen; Start und Ende bleiben prüfpflichtig.
- GitHub speichert bestätigte Zeiträume mit Schutz vor konkurrierenden Änderungen; Free Fly deaktivieren und Event entfernen ebenfalls möglich.
- `/api/freefly` und `/api/events` liefern neue Daten sofort an die Website, ohne ein neues Deployment.
- News und Patch-History unverändert; kein zusätzlicher API-Key oder KI-Dienst nötig.

## 0.11.0 – Free Fly und Events klar anzeigen

- Free-Fly-Seite mit getrenntem Status, bestätigten Terminen und Event-Meldungen aus vorhandenen News.
- Aktive Free-Fly-Hervorhebung auf der Startseite nur innerhalb eines bestätigten Start- und Endzeitraums; sie endet automatisch.
- Event-Termine nur mit vollständiger Zeitangabe und offizieller RSI-Quelle; abgelaufene Events verschwinden aus der Vorschau.
- Event-Meldungen bleiben als Meldungen erkennbar und werden nicht zu vermeintlich laufenden Events.
- Keine zusätzlichen Zugänge oder laufenden API-Kosten; News- und Patchdaten bleiben in der Update-ZIP ausgeschlossen.

## 0.10.3 – Unsichere News-Themen zurücknehmen
- Die Vorschau mit 0.10.2 zeigte wiederholte, teils unpassende Themen und fehlerhafte Formulierungen wie „um der Roadmap“. Die allgemeine Worttreffer-Regel wird entfernt.
- Bereits veröffentlichte News-Kurztexte bleiben erhalten; der geprüfte Roadmap-Beitrag vom 9. September wird korrekt als „Aus dem Artikeltext“ gekennzeichnet.
- Keine erneuten Detailabrufe für die entfernte Regel; die automatische News-Veröffentlichung bleibt deaktiviert.
- Test sichert die Umkennzeichnung eines zuvor gespeicherten Roadmap-Titeltexts sowie die übrigen News- und Patchfunktionen.

## 0.10.1 – News-Vorschau nach echten Daten berichtigen
- Die Patch-Kurzfassung endet nun am Ende des ersten vollständigen Satzes; die in der Vorschau abgeschnittene Abkürzung „bzw.“ entfällt.
- Der Roadmap-Artikel mit ID 21314 erhält den geprüften RSI-Titel und Link vom 9. September sowie konkrete Änderungspunkte zu Orison Relief Support und Alpha 4.11.
- Wöchentliche Meldungen erhalten ihr jeweiliges Veröffentlichungsdatum im Titel und im deutschen Kurztext; der Juli-Monatsbericht nennt den Monat auf Deutsch.
- News bleiben weiterhin vor einer gemeinsamen Sichtprüfung der Vorschau unveröffentlicht.

## 0.10.0 – News-Quellen und Patch-Kennzeichnung berichtigen
- News aus der strukturierten Ersatzquelle übernehmen nur noch belegte RSI-Artikel-URLs, die zur Artikel-ID passen. Unbrauchbare Archiv-Platzhalter und erfundene Transmission-Links entfallen.
- Wenn alte und neue URLs zur selben Comm-Link-ID gehören, erscheint nur ein News-Eintrag.
- Alpha 3.0.0 bleibt in der Patch History als „Patch Notes“ gekennzeichnet, obwohl die offizielle RSI-Patchseite unter `/transmission/` liegt.
- Die sichtbare Versionsanzeige auf der Startseite lautet 0.10.0; der automatische News-Import bleibt bis zur Prüfung der Vorschau deaktiviert.

## 0.9.11 – Die letzten zwei bekannten 3.x-Patches erschließen
- Alpha 3.1.3: kurze Patch Notes gezielt erkennen; KI-Piloten, großer Revel-and-York-Hangar sowie Client- und Serverabstürze als konkrete Änderungen.
- Alpha 3.0.0: ursprüngliche RSI-Patch Notes trotz abweichender Überschriften auswerten; erkundbare Oberflächen, Außenposten, Ursa Explorer, Missionssystem, Sauerstoff, Tag-Nacht-Zyklus und Launcher.
- Import nur bei nachweisbarer Versionskennung und mehreren passenden Textstellen; beide Einträge mit ihrem offiziellen RSI-Quelllink.
- Regressionstest für beide zuvor abgewiesenen Formate. Archiv mit 102 Einträgen, Fortschritt und pausierte Steuerung bleiben beim Update bestehen.

## 0.9.10 – Hotfix 3.11.1a korrekt zuordnen
- Beim Bereinigen des Wiki-Texts wird die vor dem Patchabschnitt stehende Versionsüberschrift entfernt. 0.9.9 verlangte für 3.11.1a anschließend fälschlich genau diese Überschrift im verbleibenden Patchtext.
- Die Version wird nun am Titel der Wiki-API-Antwort geprüft; die Zusammenfassung verlangt weiterhin mindestens zwei konkret belegte Korrekturen aus den Patch Notes.
- Ein Regressionstest bildet das Abschneiden der Überschrift nach und prüft, dass 3.11.1a trotzdem übernommen wird. Laufstatus und vorhandenes Patch-Archiv bleiben beim Update erhalten.

## 0.9.9 – Drei kurze historische Patch Notes auswerten
- Alpha 3.17.5: Red Festival und aktualisierte Mondneujahr-Umschläge anhand der Wiki-Archivseite erkennen.
- Alpha 3.17.4: Drake Corsair und behobenen Serverabsturz aus den kurzen Patch Notes übernehmen.
- Alpha 3.11.1a: Korrekturen an Schiffen, Sitzanimation, Lackierung, Handelskiosken sowie Server und Backend gezielt auswerten.
- Die drei Einträge verwenden geprüfte offizielle RSI-Spectrum-Links und werden nur übernommen, wenn die jeweils passenden Quellstellen vorliegen. Der pausierte Automatikstand bleibt erhalten.

## 0.9.8 – Übersprungene historische Versionen erneut prüfen
- Ein fehlender 3.x-Eintrag vor dem gespeicherten Cursor wird vor den nächsten alten Versionen noch einmal geprüft. So bleibt auch eine wegen eines temporären Quellenfehlers übersprungene Version erreichbar.
- Ist ein Eintrag weiterhin unbrauchbar, stoppt die Automatik und meldet Version sowie konkreten Grund im letzten Durchlauf. Der Cursor bleibt auf der fehlerhaften Version stehen.
- „Anhalten“ bewahrt eine vorhandene Fehlermeldung; „Starten“ löscht sie für einen neuen Versuch. Bereits gespeicherte Patches bleiben erhalten.

## 0.9.7 – Automatischer Patch-Archivimport
- Neuer Zwei-Minuten-Cron für die Patch-History; der bisherige Zwei-Stunden-Cron bleibt erhalten.
- `/backfill` zeigt Start, Stopp und Status. Das Worker-Secret `RUN_SECRET` schützt die Steuerung; das Secret steht nicht in der URL.
- Start und Fortschritt werden in einer neuen GitHub-Steuerdatei gespeichert. Gleichzeitige Cron-Aufrufe teilen sich eine Sperre; ein Fehler pausiert den Import mit Fehlermeldung.
- Fertigmeldung erst nach dem letzten Archivblatt und allen 81 bekannten 3.x-Versionen. Gespeicherte Patchdaten und Fortschrittsdateien bleiben beim Update erhalten.

## 0.9.6 – Eigenständigen Hotfix 3.17.2a ergänzen
- Die Comm-Link-Suche meldet Alpha 3.17.2a, die 80er-Liste der Wiki-Patchkategorie führt sie jedoch nicht als eigene Update-Seite.
- Der Hotfix erhält einen separaten Eintrag mit dem offiziellen RSI-Spectrum-Link, dem datierten Archivtext und eigenen Änderungspunkten zu Kampfhilfe-Aufträgen, Kiosken, Esperia Blade und Fehlerbehebungen.
- Text des darauffolgenden 3.17.2-Archivabschnitts wird nicht in die 3.17.2a-Zusammenfassung übernommen.
- Der Index umfasst jetzt 81 Versionen; ein bereits gespeicherter Archivfortschritt bleibt kompatibel.

## 0.9.5 – 3.x-Quellenindex korrigiert
- Der Wiki-API-Index lieferte trotz vorhandener Archivseiten keine 3.x-Einträge. Die 80 in der öffentlich sichtbaren Patch-Kategorie aufgeführten 3.x-Versionen sind nun direkt im Worker hinterlegt.
- Jede einzelne Patchseite wird weiterhin vor einer Übernahme geprüft; bestehende 4.x-Archiveinträge bleiben unangetastet.
- Die Diagnose nennt bei nicht lesbaren Details die Ursache, etwa einen fehlenden Patchtext oder ein nicht erkennbares Erscheinungsdatum.
- Test deckt ausdrücklich einen leeren API-Index und die Wiederaufnahme nach einem fehlerhaften Detail ab.

## 0.9.4 – 3.x-Archiv aus überprüfbaren Patchseiten erschließen
- Das vollständige 3.x-Verzeichnis der Star Citizen Wiki wird zur Versionssuche verwendet; pro Aufruf werden höchstens acht noch fehlende Patchseiten geprüft.
- Datum, Patchtext und Original-Link werden einzeln geprüft. Wo kein eigener RSI-Patch-Notes-Link belegt ist, führt der Eintrag sichtbar gekennzeichnet zum Community-Archiv.
- Nachträge wie `3.23.1a` bleiben eigenständige Versionen und werden nicht mit `3.23.1` zusammengeführt.
- Die Diagnose zeigt `historicalCandidates`, `historicalDeferredItems`, `historicalUnusableItems` und Details der gerade geprüften Quellen.
- Neue 3.x-Zusammenfassungen greifen konkrete Themen aus dem Quelltext auf. Nicht lesbare Seiten werden nicht veröffentlicht.

## 0.9.3 – Worker-Anfragelimit beim Patch-Import beachten
- Bereits archivierte Versionen werden bei der Quellprüfung übersprungen.
- Pro Aufruf höchstens zwei neue Patch-Details und zwei zusätzliche Archivversionen aus den festen Quellen prüfen; offene Versionen folgen bei den nächsten Aufrufen.
- `deferredSeedItems` und `deferredPageItems` zeigen in der Vorschau, wie viele Quellprüfungen noch warten; `/run/patches` meldet die Werte mit `patch`-Präfix.
- Bei einem fehlgeschlagenen Schreibvorgang wird der GitHub-Archivstand beim nächsten Aufruf erneut gelesen. Bereits gespeicherte Einträge werden nicht doppelt importiert, und der Archivcursor überspringt keine zurückgestellten Seiten.

## 0.9.2 – Alpha 4.0 trotz verkürzter Detailquelle erkennen
- Das Community-Detail zu Alpha 4.0 enthält nur einen verkürzten Patchtext. Die zentralen Änderungen sind anhand der vollständigen Wiki-Patchseite geprüft und werden bei bestätigtem Wipe, Pyro und Server Meshing erkannt.
- Regressionstest prüft den tatsächlich beobachteten verkürzten Quelltext.

## 0.9.1 – 4.x gesammelt abschließen
- Alpha 4.0, 4.0.1 und 4.0.2 mit geprüften RSI-Patch-Notes-Links, Daten und deutschen Änderungspunkten ergänzt.
- Fehlende nummerierte Content-Updates 4.7.1, 4.7.2 und 4.8.2 mit konkreter Quelle und klarer Kennzeichnung in der History ergänzt; ein Link auf die Patch Notes des Hauptpatches wird nicht als eigener Patchlink ausgegeben.
- Community-Wiki-Links sind sichtbar als „Community-Archiv“ bezeichnet. Bestehende Update-Meldungen 4.8.1/4.8.3 bleiben erhalten.

## 0.9.0 – Archivlücke zwischen Alpha 4.3 und 4.0 schließen
- Offizielle Patch-Notes-Links und Veröffentlichungsdaten für Alpha 4.2.1, 4.2, 4.1.1 und 4.1 ergänzt.
- Versionseigene Änderungspunkte zu Resource Drive, Storm Breaker, Schiffsmissionen und Orbital Assault.
- Unvollständige Quelltexte führen weiterhin nicht zu einem neuen Archiv-Eintrag.

## 0.8.9 – Patch-History bis Alpha 4.3 vorbereiten
- Offizielle Patch-Notes-Links, Veröffentlichungsdaten und konkrete Änderungspunkte für Alpha 4.3, 4.3.1 und 4.3.2 ergänzt.
- Neue Einträge erscheinen nur bei ausreichend passendem Quelltext.
- Die Diagnose meldet, ob `PATCH_AUTO_PUBLISH=true` gesetzt ist; dadurch kann ein unerwarteter Cursor-Fortschritt eingeordnet werden.

## 0.8.8 – Archivdaten beim Update erhalten
- Die Update-ZIP enthält keine ältere `public/data/patches.json` mehr. Der veröffentlichte GitHub-Stand soll bei der Installation erhalten bleiben.
- Für 4.5 und 4.4 wird bei unvollständigen API-Detailtexten zusätzlich die vollständige Wiki-Patchseite geprüft.
- `seedDiagnostics.matchedChanges` zeigt erkannte Änderungspunkte für ältere Versionen.

## 0.8.7 – Ältere Patch Notes erschließen
- Für Alpha 4.6, 4.5 und 4.4 sind die offiziellen Patch-Notes-IDs, Veröffentlichungsdaten und passende deutsche Änderungspunkte hinterlegt.
- Die drei Einträge brauchen auswertbare Wiki-Patchtexte mit mehreren belegten Hauptpunkten; Quelllücken erscheinen unter `seedDiagnostics`.
- Die `SCW/...-API`-Platzhalter der Community-API bleiben als Originalquelle ausgeschlossen.

## 0.8.6 – Original-Link von Alpha 4.7
- Der Alpha-4.7-Eintrag verwendet den offiziellen RSI-Link `21070-Star-Citizen-Alpha-47`.

## 0.8.5 – Alpha 4.7 vollständig zusammenfassen
- Alpha 4.7 nennt nun Breaker Stations, Inventar, Crafting, Materialqualität, Aurora Mk II, Schiffsänderungen, Nyx-Stationen, VR und wichtige Fehlerkorrekturen.
- Fehlendes Datum auf den belegten 25.03.2026 gesetzt.
- Die erweiterte Ersatz-Zusammenfassung greift nur, wenn die Quelle die zentralen Abschnittsüberschriften enthält.

## 0.8.4 – Fehlenden Alpha-4.7-Eintrag gezielt prüfen
- Alpha 4.7 mit der auf RSI gelisteten ID 21070 als zusätzliche Quellprüfung; Veröffentlichung nur bei mindestens 500 Zeichen auswertbarem Wiki-Quelltext.
- Die kompakte Vorschau zeigt unter `seedDiagnostics` die Quelltextlänge und Eignung zusätzlicher Patch-Quellen.
- Die ZIP enthält keine statische Archiv-Fortschrittsdatei mehr. Der beim Import gespeicherte GitHub-Stand soll bei Updates erhalten bleiben.

## 0.8.3 – Quelllücken im Patch-Archiv sichtbar machen
- Die Patch-Vorschau zeigt für jede geprüfte API-Seite Anzahl und ID-Bereich sowie Alpha-Titel, RSI-URL und Filterergebnis.
- `/preview/patches?diagnostic=1` gibt nur die kompakte Diagnose zurück, ohne Zusammenfassungen oder GitHub-Schreibzugriff.
- Der gespeicherte Patch-Stand und der Archiv-Cursor werden durch die Diagnose nicht verändert.

## 0.8.2 – GitHub-Konflikte beim Patch-Import abfangen
- Vor dem Archiv-Schreibzugriff wird der aktuelle GitHub-Stand erneut gelesen. Bei 409-Konflikten versucht der Worker bis zu drei Mal, neue Patches mit inzwischen gespeicherten Versionen zusammenzuführen.
- Der Archiv-Cursor wird erst nach erfolgreicher Archiv-Aktualisierung geschrieben und kann einen inzwischen weiter fortgeschrittenen Stand nicht zurücksetzen.
- Lokale Tests prüfen Konflikte, gleichzeitige Archiv-Erweiterungen und Fehler ohne Cursor-Fortschritt.

## 0.8.1 – Originalquellen der Patch History prüfen
- Titel wie „Star Citizen Alpha 4.7.2“ können Update-Ankündigungen sein. Nur RSI-Links aus dem Kanal `Patch-Notes` werden neu als Patch Notes archiviert; vorhandene Zusammenfassungen bleiben erhalten.
- Die zwei bereits gespeicherten Update-Ankündigungen 4.8.1 und 4.8.3 erhalten ihre echten Transmission-Links und werden sichtbar als „UPDATE-MELDUNG“ gekennzeichnet.
- Das neue Archiv überspringt dadurch 4.7.2 und sucht auf weiteren Archivseiten nach echten älteren Patch Notes. Vorschau und Fehlerfälle werden erneut geprüft.

## 0.8.0 – Patch History als fortlaufendes Archiv
- Die bisherige Grenze von zwölf gespeicherten Patch-Versionen entfällt. `/patch-history.html` zeigt alle gespeicherten Versionen, `/patches.html` weiterhin nur die fünf neuesten.
- Die schreibfreie Vorschau `/preview/patches` ergänzt jeweils ältere Archivseiten, meldet Fortschritt und die Zahl neuer Versionen. `/run/patches` veröffentlicht unabhängig von News.
- Der Fortschritt liegt in `public/data/patch-archive-state.json`. Er wird erst nach dem Archiv geschrieben; ein Fehler kann daher keine älteren Versionen überspringen. Bestehende Zusammenfassungen werden nicht durch schlechtere Quellen überschrieben.
- Bei nicht lesbaren GitHub-Dateien, ungültigem Archiv, kaputter Quellenantwort oder wiederholter erster Quellseite bricht der Import ohne Archiv-Schreibzugriff ab. Automatische Veröffentlichung bleibt deaktiviert.
- Archivablauf, fehlgeschlagene Quell- und GitHub-Aufrufe sowie der Wiederholungsfall nach einem fehlgeschlagenen Fortschritts-Schreibzugriff werden lokal getestet.

## 0.7.0 – News-Import überprüfen und bereinigen
- `/preview/news` zeigt die veröffentlichbare News-Liste ohne GitHub-Schreibzugriff. `/run/news` veröffentlicht nur News und Metadaten.
- Relevanz wird am Titel geprüft; der generische RSI-Platzhalter zählt nicht mehr als Suchtreffer. Technische `R-PU-ORS-*`-Kennungen und doppelte identische Roadmap-Titel werden ausgelassen. Wiederkehrende Wochenübersichten bleiben erhalten.
- Die alten identischen News-Platzhalter werden durch vorsichtige deutsche Beschreibungen anhand des Titels ersetzt. Für eine News zur exakt selben Comm-Link-ID wie bereits geprüfte Patch Notes werden zwei Sätze daraus verwendet. Die Herkunft der Beschreibung ist auf der Seite gekennzeichnet.
- Der automatische News-Import pausiert nach dem Einspielen, bis `NEWS_AUTO_PUBLISH=true` ausdrücklich gesetzt wird. Die Patch-Automatik bleibt separat deaktiviert; die manuelle `/run`-Route bleibt erhalten.
- Die statischen Rückfalldaten spiegeln den geprüften Stand mit 13 relevanten News und sechs Patch Notes statt alter Beispiele. GitHub-JSON wird mit einer Anfrage je Lesevorgang gelesen.
- Bei statischem Datenrückfall meldet die Startseite einen gespeicherten Stand statt fälschlich „ONLINE“. Der News-Import bricht bei nicht lesbaren GitHub-Bestandsdaten ab, bevor er bestehende Einträge überschreiben könnte.
- News-Kategoriefilter an die tatsächlich gespeicherten Werte `FREE FLY` und `EVENT` angepasst.
- Startseite und Über-uns-Text beschreiben die tatsächliche Herkunft der Kurztexte; pauschale KI-Behauptungen und der alte Versionshinweis wurden entfernt.
- Fehlende Koordinaten für den sechsten News- und vierten Event-Kontakt im Startseitenradar ergänzt.
- Alte Event-Beispiele ohne Termin und Quelle entfernt. Nur Events mit gültigem aktuellem oder zukünftigem Zeitraum erscheinen; bei leerem Kalender wird ein ehrlicher Leerzustand angezeigt.

## 0.6.10 – Fünf aktuelle Patch Notes, ältere in der History
- `/patches.html` zeigt höchstens die fünf neuesten Versionen. Die Startseite zeigt weiterhin höchstens fünf.
- `/patch-history.html` zeigt alle aktuell gespeicherten Versionen; für Einträge außerhalb der fünf neuesten lassen sich Zusammenfassung und Änderungen direkt dort öffnen.
- Die bisherige Importgrenze von zwölf Einträgen bleibt bestehen. Ein dauerhaftes Archiv ist ein gesonderter Ausbau.
- Worker- und Frontend-Version aktualisiert; die Patch-Aufbereitung bleibt auf `summaryVersion=0.6.8`.

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
