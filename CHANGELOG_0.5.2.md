# Verse Radar 0.5.2

## Fix
- Fehlende Funktion `cleanUrl()` ergänzt, die in 0.5.1 den `/preview`-Aufruf mit `cleanUrl is not defined` abgebrochen hat.
- Relative und absolute RSI-Links werden sauber normalisiert.
- `/preview` kann damit wieder direkt getestet werden, bevor GitHub-Schreibzugriff eingerichtet wird.

## Nächster Schritt
Nach dem Deployment zuerst `/preview` öffnen. Wenn dort aktuelle RSI-Beiträge aus September 2026 erscheinen, richten wir anschließend den GitHub-Schreibzugriff ein, damit die News automatisch auf der öffentlichen Seite aktualisiert werden.
