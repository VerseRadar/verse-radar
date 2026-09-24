# Verse Radar 0.5.5

- Robust RSI ingestion with structured fallback via the Star Citizen Wiki API.
- Original `sourceUrl` remains the official RSI Comm-Link URL.
- Keeps direct RSI HTML parsing as primary path.
- Adds detailed diagnostics for both RSI and API fallback.
- Normalizes API records into Verse Radar news items.
- No OpenAI or GitHub secrets required for `/preview`.
- The fallback API is community-maintained, archives official RSI Comm-Links, and requires attribution for public projects; Verse Radar should credit api.star-citizen.wiki in the site footer/about page if this fallback remains enabled.
