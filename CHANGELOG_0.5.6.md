# Verse Radar 0.5.6

- Website news now loads from `/api/news` instead of relying on the statically deployed `public/data/news.json`.
- `/api/news` reads the latest `public/data/news.json` directly from the configured GitHub repository.
- Static JSON remains as a fallback if GitHub cannot be read.
- Updated worker and frontend version identifiers to 0.5.6.
- Fixed the GitHub update commit message version.
- Existing `/preview`, `/run`, and scheduled automation remain unchanged.
