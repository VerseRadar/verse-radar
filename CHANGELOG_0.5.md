# Verse Radar 0.5.1

## RSI-Abholung korrigiert
- Der Worker nutzt die aktuelle Comm-Link-Sortierung (`sort=publish_new`) und filtert echte Artikel-Links statt Navigationslinks.
- Die `/preview`-Route liefert damit die neuesten offiziellen RSI-Comm-Link-Beiträge.
- Für die gefundenen Beiträge werden die Veröffentlichungsdaten aus den jeweiligen Originalseiten ausgelesen, sofern verfügbar.
- Mehrere RSI-URL-Varianten dienen als Fallback, falls RSI die Listenparameter verändert.
- GitHub- und OpenAI-Anbindung bleiben wie in 0.5 optional.
