# Verse Radar 0.5.8

## Fix: News API
- `/api/news` now reads `public/data/news.json` explicitly from the configured GitHub branch.
- GitHub repository/branch values are normalized before the API request.
- Base64 decoding is handled more robustly.
- Static asset fallback no longer references an unavailable request variable.
- Worker and frontend version updated to 0.5.8.
