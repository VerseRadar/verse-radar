# Verse Radar 0.5.9

## Fix
- `wrangler.toml` now contains the actual GitHub repository `VerseRadar/verse-radar`.
- Explicitly configures `GITHUB_BRANCH = "main"` and `MAX_ITEMS = "20"`.
- Keeps `GITHUB_TOKEN` as a Cloudflare Secret; it is not stored in this file.
- `/api/news` can therefore read the current `public/data/news.json` from the configured GitHub repository.

## Why this matters
The Worker was running correctly, but the deployment configuration still contained the placeholder `DEIN-GITHUB-USERNAME/verse-radar`. That caused the live news endpoint to fall back to an empty result even though `/preview` could still fetch the current RSI news.
