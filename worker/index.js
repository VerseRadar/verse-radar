/* Verse Radar 0.6.7 – RSI news + patch notes ingestion
   Purpose: fetch the official RSI Comm-Link page, normalize current posts,
   filter relevant Star Citizen news, and (when GitHub secrets are configured)
   publish public/data/news.json back to the connected repository.

   Secrets: GITHUB_TOKEN, RUN_SECRET (optional), OPENAI_API_KEY (optional)
   Vars: GITHUB_REPO, GITHUB_BRANCH (optional), MAX_ITEMS (optional)

   0.5 deliberately works WITHOUT OpenAI: it can publish source headlines first.
   AI enrichment is added only when OPENAI_API_KEY is configured.
*/

const COMM_LINK_URL = "https://robertsspaceindustries.com/en/comm-link?sort=publish_new";
const MAX = 20;
const PATCH_MAX = 12;
const PATCH_SEEDS = [
  { version: "Alpha 4.10", id: 21293, date: "2026-08-26T18:00:00.000Z" },
  { version: "Alpha 4.9", id: 21245, date: "2026-07-15T18:00:00.000Z" }
];
const VERSION_RE = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?$/;
const PATCH_NOTES_URL = "https://robertsspaceindustries.com/en/patch-notes";
const RELEVANT = /patch|alpha\s*\d|free\s*fly|foundation festival|fleet week|invictus|iae|event|roadmap|ship showdown|siege|monthly report|this week in star citizen|live experience|pirate week|subscriber|vehicle|ship|aegis|argo|anvil|kruger|rsi|sabre|aurora|gameplay|engineering/i;

export default {
  async fetch(request, env) {
    const u = new URL(request.url);
    if (u.pathname === "/health") {
      return json({ ok: true, service: "verse-radar-updater", version: "0.6.7" });
    }
    if (u.pathname === "/preview") {
      try {
        const items = await fetchRSIItems();
        return json({ ok: true, source: COMM_LINK_URL, count: items.length, items });
      } catch (e) {
        return json({ ok: false, error: e.message }, 502);
      }
    }
    if (u.pathname === "/preview/patches") {
      try {
        // Use the same transformation as /run, but never write GitHub here.
        const result = await updatePatches(env);
        return json({
          ok: true,
          source: PATCH_NOTES_URL,
          count: result.patches.length,
          aiItems: result.aiItems,
          items: result.patches,
          discovery: result.items.map(item => ({
            version: item.version,
            sourceId: item.sourceId,
            sourceContentLength: item.content.length
          }))
        });
      } catch (e) {
        return json({ ok: false, error: e.message }, 502);
      }
    }
    if (u.pathname === "/api/patches") {
      try {
        if (env.GITHUB_TOKEN && env.GITHUB_REPO) {
          const patches = await readGithubJSON(env, "public/data/patches.json", null);
          if (Array.isArray(patches)) return json(patches);
        }
        if (env.ASSETS) {
          const asset = await env.ASSETS.fetch(new Request(new URL("/data/patches.json", u.origin), request));
          return new Response(await asset.text(), { status: asset.status, headers: { "content-type": "application/json;charset=utf-8", "cache-control": "no-store, no-cache, must-revalidate" } });
        }
        return json([]);
      } catch (e) { return json({ ok: false, error: e.message }, 500); }
    }
    if (u.pathname === "/run") {
      if (env.RUN_SECRET && u.searchParams.get("key") !== env.RUN_SECRET) return json({ ok: false, error: "Unauthorized" }, 401);
      try { return json(await updateSite(env)); } catch (e) { return json({ ok: false, error: e.message }, 500); }
    }
    if (u.pathname === "/debug/github") {
      try {
        const d = await githubDiagnostics(env, "public/data/news.json");
        return json({ ok: true, version: "0.6.7", github: d });
      } catch (e) {
        return json({ ok: false, version: "0.6.7", error: e.message }, 500);
      }
    }
    if (u.pathname === "/api/news") {
      try {
        if (env.GITHUB_TOKEN && env.GITHUB_REPO) {
          const news = await readGithubJSON(env, "public/data/news.json", null);
          if (Array.isArray(news)) {
            return new Response(JSON.stringify(news, null, 2), {
              status: 200,
              headers: {
                "content-type": "application/json;charset=utf-8",
                "cache-control": "no-store, no-cache, must-revalidate",
                "x-verse-radar-news-source": "github"
              }
            });
          }
        }
        if (env.ASSETS) {
          const asset = await env.ASSETS.fetch(new Request(new URL("/data/news.json", u.origin), request));
          const body = await asset.text();
          return new Response(body, { status: asset.status, headers: { "content-type": "application/json;charset=utf-8", "cache-control": "no-store, no-cache, must-revalidate", "x-verse-radar-news-source": "static-fallback" } });
        }
        return json([]);
      } catch (e) {
        return json({ ok: false, error: e.message }, 500);
      }
    }
    // Public website: let Cloudflare Static Assets serve /public.
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("Verse Radar 0.6.7", { headers: { "content-type": "text/plain;charset=utf-8" } });
  },
  async scheduled(_, env, ctx) {
    // Keep the proven news schedule; patches are published automatically only
    // after the preview has been reviewed and this flag is explicitly enabled.
    ctx.waitUntil(updateSite(env, { includePatches: env.PATCH_AUTO_PUBLISH === "true" }));
  }
};

const json = (x, s = 200) => new Response(JSON.stringify(x, null, 2), { status: s, headers: { "content-type": "application/json;charset=utf-8", "cache-control": "no-store" } });

async function fetchRSIItems() {
  // Primary: current RSI HTML. In some server-side requests RSI returns the
  // app shell without article anchors, so we also use the community-maintained
  // Star Citizen Wiki API as a structured fallback. Original source URLs still
  // point directly to RSI.
  const urls = [
    "https://robertsspaceindustries.com/en/comm-link?sort=publish_new&type=post",
    "https://robertsspaceindustries.com/en/comm-link?sort=publish_new"
  ];
  const diagnostics = [];

  for (const url of urls) {
    try {
      const r = await fetch(url, {
        headers: {
          "user-agent": "Verse-Radar/0.6.7 (+independent fan site)",
          "accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
          "accept-language": "en-US,en;q=0.9,de;q=0.8"
        }
      });
      const html = await r.text();
      const parsed = r.ok ? parseCommLink(html) : { candidates: 0, items: [] };
      diagnostics.push({ source: url, httpStatus: r.status, htmlLength: html.length, candidates: parsed.candidates, parsedItems: parsed.items.length });
      if (r.ok && parsed.items.length) {
        const relevant = parsed.items.filter(x => RELEVANT.test(`${x.title} ${x.description}`)).slice(0, MAX);
        return await enrichDates(relevant.length ? relevant : parsed.items.slice(0, MAX));
      }
    } catch (e) {
      diagnostics.push({ source: url, error: e.message });
    }
  }

  // Structured fallback. The API archives official RSI Comm-Links and is
  // particularly useful when RSI serves only its frontend shell to Workers.
  try {
    const apiUrl = "https://api.star-citizen.wiki/api/comm-links?page[size]=50&sort=-id";
    const r = await fetch(apiUrl, {
      headers: {
        "user-agent": "Verse-Radar/0.6.7 (+independent fan site)",
        "accept": "application/json"
      }
    });
    const textBody = await r.text();
    let body = null;
    try { body = JSON.parse(textBody); } catch {}
    const records = Array.isArray(body?.data) ? body.data : [];
    diagnostics.push({ source: apiUrl, httpStatus: r.status, bodyLength: textBody.length, records: records.length });
    if (r.ok && records.length) {
      const items = records.map(normalizeWikiCommLink).filter(Boolean);
      const relevant = items.filter(x => RELEVANT.test(`${x.title} ${x.description}`));
      return (relevant.length ? relevant : items).slice(0, MAX);
    }
  } catch (e) {
    diagnostics.push({ source: "star-citizen-wiki-api", error: e.message });
  }

  const detail = diagnostics.map(d => {
    if (d.source.includes('api.star-citizen.wiki')) return `${d.source}: HTTP ${d.httpStatus ?? "?"}, JSON ${d.bodyLength ?? 0}, Datensätze ${d.records ?? 0}`;
    return `${d.source}: HTTP ${d.httpStatus ?? "?"}, HTML ${d.htmlLength ?? 0}, Kandidaten ${d.candidates ?? 0}, erkannt ${d.parsedItems ?? 0}`;
  }).join(" | ");
  throw Error(`Keine Comm-Link-Beiträge erkannt. [Debug: ${detail}]`);
}

function normalizeWikiCommLink(record) {
  const id = Number(record?.id);
  const title = strip(record?.title || "");
  if (!Number.isInteger(id) || id <= 0 || !validTitle(title)) return null;
  const slug = slugify(title);
  const url = `https://robertsspaceindustries.com/en/comm-link/transmission/${id}-${slug}`;
  let date = null;
  if (record?.created_at) {
    const d = new Date(record.created_at);
    if (!Number.isNaN(d.getTime())) date = d.toISOString();
  }
  if (!date && record?.created_at_human) {
    const d = new Date(record.created_at_human);
    if (!Number.isNaN(d.getTime())) date = d.toISOString();
  }
  return {
    title,
    url,
    date: date || new Date().toISOString(),
    description: "Offizieller RSI Comm-Link-Beitrag. Öffne die Originalquelle für den vollständigen Inhalt.",
    sourceId: id
  };
}

function slugify(value) {
  return String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

async function enrichDates(items) {
  // Fetch only the small final set. If an individual article cannot be read,
  // retain ingestion time rather than dropping the story.
  return await Promise.all(items.map(async item => {
    try {
      const r = await fetch(item.url, { headers: { "user-agent": "Verse-Radar/0.6.7 (+independent fan site)", "accept": "text/html,application/xhtml+xml" } });
      if (!r.ok) return item;
      const html = await r.text();
      const iso = extractPublishedDate(html);
      return iso ? { ...item, date: iso } : item;
    } catch { return item; }
  }));
}

function extractPublishedDate(html) {
  const patterns = [
    /<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["']date["'][^>]+content=["']([^"']+)["']/i,
    /<time[^>]+datetime=["']([^"']+)["']/i,
    /Date:\s*([A-Za-z]+\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4})/i
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) {
      const d = new Date(m[1]);
      if (!Number.isNaN(d.getTime())) return d.toISOString();
    }
  }
  return null;
}

function parseCommLink(html) {
  const out = [];
  const seen = new Set();
  let candidates = 0;

  // Current RSI pages can expose links in normal anchors as well as in
  // serialized/escaped markup. We deliberately search for the URL pattern
  // itself instead of depending on one specific DOM structure.
  const patterns = [
    /href\s*=\s*["']([^"']*\/en\/comm-link\/[^"'#?\s<>]+)["']/gi,
    /["']((?:https?:\/\/robertsspaceindustries\.com)?\/en\/comm-link\/[^"'#?\s<>]+)["']/gi,
    /\\\/en\\\/comm-link\\\/[^"'\s<>\\]+/gi
  ];

  const hrefs = [];
  for (const re of patterns) {
    for (const m of html.matchAll(re)) {
      const raw = m[1] || m[0];
      const href = cleanUrl(raw.replace(/\\\//g, "/"));
      if (!href || !isArticleUrl(href) || seen.has(href)) continue;
      seen.add(href);
      hrefs.push(href);
    }
  }
  candidates = hrefs.length;

  // First try to recover the visible title from the anchor containing each URL.
  for (const href of hrefs) {
    let title = "";
    const escapedHref = href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pathOnly = new URL(href).pathname;
    const slug = pathOnly.split("/").pop() || "";
    const slugTitle = slug.replace(/^\d+-/, "").replace(/[-_]+/g, " ");

    const anchorPatterns = [
      new RegExp(`<a\\b[^>]*href=["'](?:${escapedHref}|${escapeRegExp(pathOnly)})["'][^>]*>([\s\S]*?)<\\/a>`, "i"),
      new RegExp(`<a\\b[^>]*href=["'][^"']*${escapeRegExp(pathOnly)}[^"']*["'][^>]*>([\s\S]*?)<\\/a>`, "i")
    ];
    for (const re of anchorPatterns) {
      const m = html.match(re);
      if (m) { title = strip(m[1]); if (title) break; }
    }

    if (!title) title = slugTitle;
    if (!validTitle(title)) continue;

    out.push({
      title,
      url: href,
      date: new Date().toISOString(),
      description: "Offizieller RSI Comm-Link-Beitrag. Öffne die Originalquelle für den vollständigen Inhalt."
    });
    if (out.length >= 60) break;
  }

  return { items: out, candidates };
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function strip(raw) {
  if (!raw) return "";
  return String(raw)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '\"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanUrl(raw) {
  if (!raw) return null;
  try {
    const value = String(raw).trim().replace(/&amp;/g, "&");
    const url = new URL(value, "https://robertsspaceindustries.com");
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function isArticleUrl(url) {
  if (!url) return false;
  try {
    const u = new URL(url);
    if (u.hostname !== "robertsspaceindustries.com") return false;
    return /\/en\/comm-link\/(?!\?|$)[^/]+\/\d+-/.test(u.pathname) || /\/en\/comm-link\/[^/]+\/\d+/.test(u.pathname);
  } catch { return false; }
}

function validTitle(title) {
  if (!title || title.length < 5 || title.length > 240) return false;
  if (/^(all rsi communications|comm-link|input|channel|series|type|sort|new|old)$/i.test(title)) return false;
  return !/^(read more|view all|login|sign in|search)$/i.test(title);
}

function extractDateFromSlug(url) {
  // Slugs normally do not contain dates, so return null here.  Actual article
  // dates are filled from the article page in the enrichment pass when needed.
  return null;
}

async function updateSite(env, { includePatches = true } = {}) {
  const items = await fetchRSIItems();
  const existing = env.GITHUB_TOKEN && env.GITHUB_REPO ? await readGithubJSON(env, "public/data/news.json", []) : [];
  const known = new Set(existing.map(x => x.id));
  const news = [];
  let aiCount = 0;

  for (const item of items) {
    const id = hash(item.url);
    const old = existing.find(x => x.id === id);
    if (old) { news.push(old); continue; }
    let ai = null;
    if (env.OPENAI_API_KEY) {
      try { ai = await summarize(item, env.OPENAI_API_KEY); aiCount++; } catch (_) {}
    }
    news.push({ id, title: ai?.title || item.title, category: ai?.category || classify(item.title), date: item.date, summary: ai?.summary || item.description, sourceUrl: item.url, source: "RSI Comm-Link", ai: Boolean(ai) });
  }
  for (const old of existing) if (!news.some(n => n.id === old.id)) news.push(old);
  news.sort((a, b) => new Date(b.date) - new Date(a.date));
  const finalNews = news.slice(0, 60);

  const patchResult = includePatches ? await updatePatches(env) : null;
  const now = new Date().toISOString();
  const meta = { updatedAt: now, source: COMM_LINK_URL, patchSource: PATCH_NOTES_URL, mode: env.GITHUB_TOKEN && env.GITHUB_REPO ? "live" : "preview", automation: includePatches ? "Cloudflare Worker + RSI Comm-Link + RSI Patch Notes" : "Cloudflare Worker + RSI Comm-Link; Patch-Import pausiert", version: "0.6.7", fetchedItems: items.length, newItems: news.filter(n => !known.has(n.id)).length, aiItems: aiCount, patchItems: patchResult?.items.length ?? null, patchAiItems: patchResult?.aiItems ?? null };

  if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) {
    return { ok: true, version: "0.6.7", published: false, ...meta, note: "RSI-Abholung funktioniert. GitHub Secrets fehlen noch; daher wurde nichts zurückgeschrieben." };
  }

  await putGithub(env, "public/data/news.json", JSON.stringify(finalNews, null, 2) + "\n", "Verse Radar 0.6.7: update news");
  if (includePatches) await putGithub(env, "public/data/patches.json", JSON.stringify(patchResult.patches, null, 2) + "\n", "Verse Radar 0.6.7: update patches");
  await putGithub(env, "public/data/meta.json", JSON.stringify(meta, null, 2) + "\n", "Verse Radar 0.6.7: update meta");
  return { ok: true, version: "0.6.7", published: true, ...meta };
}

async function updatePatches(env) {
  const { items } = await fetchPatchItems();
  const existingData = await readGithubJSON(env, "public/data/patches.json", []);
  const existing = Array.isArray(existingData) ? existingData : [];
  const unique = dedupePatchItems(items).sort(comparePatchVersionsDesc);
  const patches = [];
  let aiItems = 0;

  for (let i = 0; i < unique.length && i < PATCH_MAX; i++) {
    const item = unique[i];
    const previous = unique[i + 1]?.version || null;
    const old = existing.find(x => x.version === item.version && x.sourceUrl === item.sourceUrl);
    if (old && old.summaryVersion === "0.6.7" && old.summary && old.fullSummary && Array.isArray(old.changes) && old.changes.length) {
      patches.push({ ...old, previous });
      continue;
    }
    let ai = null;
    if (env.OPENAI_API_KEY && item.content) {
      try { ai = await summarizePatch(item, previous, env.OPENAI_API_KEY); aiItems++; } catch (_) {}
    }
    patches.push({
      version: item.version,
      date: item.date,
      previous,
      summary: ai?.summary || item.fallbackSummary,
      changes: ai?.changes?.length ? ai.changes : buildPatchChanges(item),
      fullSummary: ai?.fullSummary || item.fallbackFullSummary,
      sourceUrl: item.sourceUrl,
      ai: Boolean(ai),
      summaryVersion: "0.6.7",
      note: "Deutsche Zusammenfassung der offiziellen Patch Notes. Kein offizieller RSI-Text."
    });
  }
  return { patches, items: unique.slice(0, PATCH_MAX), aiItems };
}

async function fetchPatchItems() {
  const discovered = [];
  try {
    const apiUrl = "https://api.star-citizen.wiki/api/comm-links?page[size]=100&sort=-id";
    const r = await fetch(apiUrl, { headers: { "user-agent": "Verse-Radar/0.6.7 (+independent fan site)", "accept": "application/json" } });
    const body = await r.json();
    const records = Array.isArray(body?.data) ? body.data : [];
    for (const record of records) {
      const title = strip(record?.title || "");
      if (!/^Star Citizen Alpha \d+(?:\.\d+){1,2}(?:\.0)?(?:\s|:|$)/i.test(title)) continue;
      const id = Number(record?.id); if (!id) continue;
      const version = normalizePatchVersion(title.replace(/^Star Citizen /i, "").trim());
      const date = validDate(record?.created_at) || validDate(record?.published_at) || new Date().toISOString();
      const sourceUrl = officialPatchUrl(id, title);
      let content = cleanPatchText(extractPatchContent(record));
      if (content.length < 500) content = cleanPatchText(await fetchPatchDetail(id, content));
      if (content.length < 500) content = cleanPatchText(await fetchWikiUpdatePage(version, content));
      discovered.push({ version, date, sourceUrl, sourceId: id, content, fallbackSummary: fallbackPatchSummary(version, content), fallbackFullSummary: fallbackFullSummary(version, content) });
    }
  } catch (_) {}

  // RSI's patch index is sometimes only partially mirrored by the archive API.
  // Seed the current major patches so a temporary archive/index gap cannot hide them.
  for (const seed of PATCH_SEEDS) {
    const already = discovered.some(x => x.version === seed.version);
    if (already) continue;
    const title = `Star Citizen ${seed.version}`;
    const sourceUrl = officialPatchUrl(seed.id, title);
    let content = cleanPatchText(await fetchPatchDetail(seed.id, ""));
    if (content.length < 500) content = cleanPatchText(await fetchWikiUpdatePage(seed.version, content));
    discovered.push({ version: seed.version, date: seed.date, sourceUrl, sourceId: seed.id, content, fallbackSummary: fallbackPatchSummary(seed.version, content), fallbackFullSummary: fallbackFullSummary(seed.version, content) });
  }

  if (!discovered.length) throw Error("Keine Patch Notes erkannt.");
  // A title variant (e.g. "Alpha 4.8: Tactical Strike") is not a separate
  // predecessor of the same numbered release. Never publish empty source text
  // as a generic patch summary.
  const unique = dedupePatchItems(discovered).filter(item => item.content.length >= 500).sort(comparePatchVersionsDesc).slice(0, PATCH_MAX);
  if (!unique.length) throw Error("Keine Patch Notes mit auswertbarem Quelltext erkannt.");
  return { items: unique };
}

function extractPatchContent(record) {
  const candidates = [
    record?.content,
    record?.content_html,
    record?.content_text,
    record?.body,
    record?.description,
    record?.summary
  ];
  for (const value of candidates) {
    const text = strip(value || "");
    if (text.length >= 500) return text;
  }
  return "";
}

async function fetchPatchDetail(id, current = "") {
  try {
    const detail = await fetch(`https://api.star-citizen.wiki/api/comm-links/${id}`, {
      headers: { "user-agent": "Verse-Radar/0.6.7 (+independent fan site)", "accept": "application/json" }
    });
    if (!detail.ok) return current;
    const dj = await detail.json();
    const d = dj?.data || dj;
    return extractPatchContent(d) || current;
  } catch (_) { return current; }
}

async function fetchWikiUpdatePage(version, current = "") {
  // Prefer the Star Citizen Wiki MediaWiki API over the rendered page.
  // The rendered page is sometimes blocked/changed for server-side requests,
  // while the API exposes the actual article content directly.
  const rawVersion = String(version || "").trim();
  const candidates = [rawVersion];
  if (/^Alpha \d+\.\d+$/.test(rawVersion)) candidates.push(`${rawVersion}.0`);

  for (const candidate of candidates) {
    try {
      const title = `Update:Star Citizen ${candidate}`;
      const api = new URL("https://starcitizen.tools/api.php");
      api.searchParams.set("action", "parse");
      api.searchParams.set("page", title);
      api.searchParams.set("prop", "text");
      api.searchParams.set("format", "json");
      api.searchParams.set("origin", "*");
      const r = await fetch(api.toString(), {
        headers: { "user-agent": "Verse-Radar/0.6.7 (+independent fan site)", "accept": "application/json" }
      });
      if (r.ok) {
        const body = await r.json();
        const html = body?.parse?.text?.["*"] || "";
        const text = cleanPatchText(strip(html));
        if (text.length > current.length) return text;
      }
    } catch (_) {}
  }

  // Secondary fallback: rendered article page.
  for (const candidate of candidates) {
    try {
      const slug = `Star Citizen ${candidate}`.replace(/\s+/g, "_");
      const url = `https://starcitizen.tools/Update%3A${encodeURIComponent(slug)}`;
      const r = await fetch(url, { headers: { "user-agent": "Verse-Radar/0.6.7 (+independent fan site)", "accept": "text/html,application/xhtml+xml" } });
      if (!r.ok) continue;
      const html = await r.text();
      const main = html.match(/<main[\s\S]*?<\/main>/i)?.[0] || html.match(/<article[\s\S]*?<\/article>/i)?.[0] || html;
      const text = cleanPatchText(strip(main));
      if (text.length > current.length) return text;
    } catch (_) {}
  }
  return current;
}

function normalizePatchVersion(v) {
  return String(v || "").replace(/\.0(?=\b)/g, "").replace(/\s+/g, " ").trim();
}
function officialPatchUrl(id, title) {
  const slug = String(title || "Star Citizen Patch Notes").trim()
    .replace(/^Star Citizen\s*/i, "Star-Citizen-")
    .replace(/[^A-Za-z0-9:.]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return `https://robertsspaceindustries.com/en/comm-link/Patch-Notes/${id}-${slug}`;
}

function cleanPatchText(value) {
  let t = strip(value || "");
  if (!t) return "";
  t = t.replace(/\b(Update\s*:\s*Star Citizen Alpha [^\n]+?)\s+Star Citizen build released on [^\n]+/i, "");
  const patchMarker = t.search(/\bPatch notes\s+edit\s+/i);
  if (patchMarker >= 0) t = t.slice(patchMarker).replace(/^Patch notes\s+edit\s+/i, "");
  const roadmap = t.search(/\bRoadmap deliverables\s+edit\s+/i);
  if (roadmap >= 0) t = t.slice(0, roadmap);
  const refs = t.search(/\bReferences\s+edit\s+/i);
  if (refs >= 0) t = t.slice(0, refs);
  t = t.replace(/\b(?:More languages|In other languages|Variants|Views|Read|Edit|History|Related pages|Update Discussion|More actions|More Tools|What links here|Related changes|Printable version|Permanent link|Page information|View buckets|Cite this page)\b/gi, " ");
  t = t.replace(/\s+edit\s+(?=(Gameplay|Bug fixes|Bug Fixes|Features|Technical|Stability|Audio|Missions|Ships|Locations|Inventory|Roadmap|Weapons|Core Tech|Client crashes))/gi, " ");
  t = t.replace(/\s+/g, " ").trim();
  return t;
}

function versionParts(version) {
  const m = String(version || "").match(/(\d+(?:\.\d+){0,2})/);
  if (!m) return [0,0,0];
  const p = m[1].split(".").map(Number);
  return [p[0]||0,p[1]||0,p[2]||0];
}
function comparePatchVersionsDesc(a,b) {
  const av=versionParts(a.version), bv=versionParts(b.version);
  for(let i=0;i<3;i++){ if(av[i]!==bv[i]) return bv[i]-av[i]; }
  return new Date(b.date)-new Date(a.date);
}
function dedupePatchItems(items) {
  const map = new Map();
  for (const item of items) {
    const key = versionParts(item.version).join(".");
    const old = map.get(key);
    if (!old ||
        (item.content.length >= 500 && old.content.length < 500) ||
        ((item.content.length >= 500) === (old.content.length >= 500) && Number(item.sourceId||0) > Number(old.sourceId||0))) map.set(key,item);
  }
  return [...map.values()];
}

function validDate(v) { const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d.toISOString(); }
function sentenceList(parts, max=6) {
  return parts.filter(Boolean).slice(0, max).join(" ");
}
function fallbackPatchSummary(version, content) {
  const t = content || "";
  const parts = [];
  if (/orison relief support/i.test(t)) parts.push("Orison Relief Support bringt eine neue Reihe von Wiederaufbau-, Transport-, Herstellungs- und Kampfeinsätzen mit persönlichem Fortschritts- und Belohnungssystem.");
  if (/siege of orison v2/i.test(t)) parts.push("Siege of Orison wurde als Instancing-Mission überarbeitet und bietet eine geschlossene Mission für Spieler und Gruppe.");
  if (/recco battaglia/i.test(t)) parts.push("Recco Battaglia erweitert das Missionsangebot mit storybasierten und wiederholbaren Aufträgen rund um Bergbau und Ressourcenlogistik.");
  if (/instancing/i.test(t)) parts.push("Instancing hält unterstützte Inhalte in separaten Instanzen für die jeweilige Gruppe und führt dafür neue Backend- und Skalierungslogik ein.");
  if (/hydrogen & quantum fuel rebalance/i.test(t)) parts.push("Hydrogen- und Quantum-Treibstoff wurden bei Kapazitäten, Verbrauch und Preisen neu ausbalanciert.");
  if (/vehicle armor update/i.test(t)) parts.push("Die Schiffsrüstung berücksichtigt ihren Zustand nun bei der Schadensreduktion und Schadensberechnung.");
  if (/pricing, claims, & availability/i.test(t)) parts.push("Claim-, Liefer- und Expedite-Kosten sowie die Verfügbarkeit verschiedener Fahrzeuge, Waffen und Gegenstände wurden angepasst.");
  if (/new fps weapon|arlington rifle|cq7.*bullpup|vendetta hmg|super heavy armor/i.test(t)) parts.push("Mehrere neue Waffen bzw. Ausrüstungsgegenstände wurden hinzugefügt, darunter neue FPS-Waffen und schwere Ausrüstung.");
  if (/virtual reality updates|experimental vr|openxr/i.test(t)) parts.push("Die experimentelle VR-Unterstützung wurde bei Headtracking, Cursor, Rendering und OpenXR erweitert.");
  if (/ground vehicle soft death/i.test(t)) parts.push("Bodenfahrzeuge können nun einen Soft-Death-Zustand erreichen, statt direkt zerstört zu werden.");
  if (/creature and plant loot quality/i.test(t)) parts.push("Bei Kreaturen- und Pflanzenbeute gibt es nun unterschiedliche Qualitätsstufen.");
  if (/weapon attachment availability/i.test(t)) parts.push("Bestimmte Waffenaufsätze sind nun breiter im allgemeinen Loot-Pool verfügbar.");
  if (/hauling and delivery cargo distribution/i.test(t)) parts.push("Die Frachtverteilung bei Multi-Pickup-Aufträgen berücksichtigt nun die SCU-Menge der einzelnen Abholorte.");
  if (/ordnance cargo holder/i.test(t)) parts.push("Der Ordnance Cargo Holder erweitert den Transport von Munition und Ausrüstung.");
  if (/freight elevator kiosk/i.test(t)) parts.push("Die Bedienoberfläche des Frachtaufzugs wurde überarbeitet.");
  if (/combat mission rebalance|combat missions rebalance/i.test(t)) parts.push("Kampfmissionen und ihre Balance wurden angepasst.");
  if (/mining laser.{0,80}20%|20%.{0,80}mining laser/i.test(t)) parts.push("Die Leistung von Mining-Lasern wurde angepasst.");
  if (/cq7.{0,25}bullpup/i.test(t)) parts.push("Das CQ7 Bullpup erweitert das Waffenangebot.");
  if (/defend location.{0,60}ship battles v3/i.test(t)) parts.push("Defend Location – Ship Battles V3 verbindet Verteidigungs- und Eskortaufträge mit neuen Gegnerwellen.");
  if (/return of xenothreat|xenothreat returns/i.test(t)) parts.push("Return of XenoThreat bringt die XenoThreat-Bedrohung als Event zurück.");
  if (/tactical strike group/i.test(t)) parts.push("Die Tactical Strike Group erweitert das Missionsangebot.");
  const m = t.match(/closes\s+(\d+)\s+(?:bug fixes|issues)/i);
  if (m) parts.push(`Zusätzlich wurden ${m[1]} dokumentierte Korrekturen bzw. Issues geschlossen.`);
  else if (/stability and performance|client crashes|server crashes/i.test(t)) parts.push("Der Patch enthält zahlreiche Stabilitäts-, Crash- und Performance-Korrekturen.");
  return sentenceList(parts, 7) || `${version} enthält Gameplay-, Technik- und Fehlerbehebungsänderungen laut den offiziellen Patch Notes.`;
}
function fallbackFullSummary(version, content) {
  if (!content) return "Die Patch-Notizen konnten technisch noch nicht vollständig aus dem Archiv übernommen werden. Die offizielle Originalquelle ist direkt verlinkt.";
  const t = content;
  const parts = [];
  if (/orison relief support/i.test(t)) parts.push("Im Gameplay bringt der Patch mit Orison Relief Support eine neue Reihe von Wiederaufbau- und Unterstützungsaufträgen. Je nach Auftrag geht es um Ressourcensammlung, Herstellung, Transporte oder Kämpfe; der persönliche Fortschritt schaltet mehrere Belohnungen frei.");
  if (/siege of orison v2/i.test(t)) parts.push("Siege of Orison wurde als Instancing-Inhalt überarbeitet. Die Mission läuft in einer geschlossenen Instanz für die eigene Gruppe, nutzt Checkpoints und wurde bei Plattformen, Gegnern und Belohnungen angepasst.");
  if (/recco battaglia/i.test(t)) parts.push("Mit Recco Battaglia kommt ein weiterer Missionsgeber hinzu. Ihre Aufträge führen durch Bergbau-, Verteidigungs-, Such- und Bergungsinhalte und schalten über Reputation weitere Verträge und Belohnungen frei.");
  if (/loot generation & drop rates/i.test(t)) parts.push("Die Loot-Generierung wurde umfassend angepasst: Caches und Container enthalten mehr Gegenstände, Seltenheitsstufen wurden neu gewichtet und bestimmte Gegenstände erhalten eigene Loot-Quellen.");
  if (/hydrogen & quantum fuel rebalance/i.test(t)) parts.push("Bei Hydrogen- und Quantum-Treibstoff wurden Kapazitäten, Verbrauch, Preise und die darauf abgestimmten Refuelling-Missionen neu ausbalanciert.");
  if (/vehicle armor update/i.test(t)) parts.push("Die Schiffsrüstung wurde technisch angepasst: Schadensreduktion greift nur noch bei vorhandener Rüstungsintegrität, und der Zustand der Rüstung beeinflusst die Schadensaufnahme.");
  if (/pricing, claims, & availability/i.test(t)) parts.push("Claim- und Lieferzeiten orientieren sich stärker am Wert des Fahrzeugs. Auch Ausrüstung, Expedite-Gebühren, Munitionspreise und Shop-Angebote wurden angepasst.");
  if (/instancing/i.test(t)) parts.push("Instancing wird technisch durch einen neuen Broker und zusätzliche Skalierungsmechanismen unterstützt. Serverlast, Instanzverwaltung, Streaming und einige Performance-Bereiche wurden ebenfalls überarbeitet.");
  if (/performance & streaming/i.test(t)) parts.push("Für Performance und Streaming wurden unter anderem Physik- und Rendering-Abläufe, Partikeleffekte, Speicherverwaltung und die Darstellung in Levski optimiert.");
  if (/virtual reality updates|experimental vr|openxr/i.test(t)) parts.push("Die experimentelle VR-Unterstützung erhält Verbesserungen für Headtracking, Stereo-Cursor, Kioske, Wasser-Rendering und OpenXR.");
  if (/ground vehicle soft death/i.test(t)) parts.push("Bodenfahrzeuge können nun in Soft Death übergehen.");
  if (/creature and plant loot quality/i.test(t)) parts.push("Kreaturen- und Pflanzenbeute besitzt nun Qualitätsstufen.");
  if (/weapon attachment availability/i.test(t)) parts.push("Bestimmte Waffenaufsätze wurden in den allgemeinen Loot-Pool aufgenommen.");
  if (/hauling and delivery cargo distribution/i.test(t)) parts.push("Die Verteilung von Fracht auf mehrere Abholorte wurde korrigiert und berücksichtigt die SCU-Menge je Pickup.");
  if (/secondwind/i.test(t)) parts.push("Für Orison Relief Support sind zusätzliche SecondWind-Belohnungen vorgesehen. Die Bedingungen und die einzelnen Namen stehen in der Originalquelle.");
  if (/th-01 propulsor/i.test(t)) parts.push("Der TH-01 Propulsor kann im Rahmen der neuen Inhalte hergestellt werden.");
  if (/sab(re|er).{0,70}audio|amrs.{0,50}audio/i.test(t)) parts.push("Audio von Fahrzeugen und Waffen wurde angepasst.");
  if (/ordnance cargo holder/i.test(t)) parts.push("Ein Ordnance Cargo Holder ermöglicht zusätzliche Abläufe beim Transport von Munition. Die Details und Einschränkungen stehen in den offiziellen Patch Notes.");
  if (/freight elevator kiosk/i.test(t)) parts.push("Beim Freight Elevator Kiosk wurden Bedienung und Darstellung angepasst.");
  if (/combat mission rebalance|combat missions rebalance/i.test(t)) parts.push("Kampfmissionen wurden bei Schwierigkeit und Ablauf neu abgestimmt.");
  if (/cq7.{0,25}bullpup/i.test(t)) parts.push("Das CQ7 Bullpup kommt als weitere FPS-Waffe hinzu.");
  if (/grenade hud marker/i.test(t)) parts.push("HUD-Marker machen Granaten im Kampf besser erkennbar.");
  if (/defend location.{0,60}ship battles v3/i.test(t)) parts.push("Defend Location – Ship Battles V3 kombiniert Verteidigung und Eskorte. Unterschiedliche Schauplätze und Schwierigkeitsgrade sowie Gegner wie Ace Pilots beeinflussen Missionsablauf, Reputation und Belohnungen.");
  if (/return of xenothreat|xenothreat returns/i.test(t)) parts.push("Return of XenoThreat steht als Event im Mittelpunkt dieses Updates.");
  if (/tactical strike group/i.test(t)) parts.push("Die Tactical Strike Group ergänzt das Missionsangebot.");
  const m = t.match(/closes\s+(\d+)\s+(?:bug fixes|issues)/i);
  if (m) parts.push(`Bei Stabilität und Fehlerbehebungen wurden ${m[1]} dokumentierte Korrekturen bzw. Issues geschlossen.`);
  else if (/stability and performance/i.test(t)) parts.push("Zusätzlich enthält der Patch zahlreiche Stabilitäts-, Crash- und Performance-Fixes.");
  return sentenceList(parts, 12) || `${version} enthält Gameplay-, Technik-, Missions- und Fehlerbehebungsänderungen. Die vollständige Liste ist über die offizielle Originalquelle abrufbar.`;
}
function buildPatchChanges(item) {
  const t = item.content || ""; const changes = [];
  const add = (category,title,description,pattern) => { if (pattern.test(t)) changes.push({category,title,description}); };
  add("Gameplay","Orison Relief Support","Neue Wiederaufbau- und Unterstützungsaufträge rund um Orison mit Ressourcen, Herstellung, Transport und Kampf.",/orison relief support/i);
  add("Missionen","Siege of Orison V2","Die Mission wurde auf Instancing umgestellt und für Gruppen mit Checkpoints und überarbeiteten Gefechten neu aufgebaut.",/siege of orison v2/i);
  add("Missionen","Recco Battaglia","Neue storybasierte und wiederholbare Aufträge rund um Bergbau, Verteidigung, Suche und Ressourcenlogistik.",/recco battaglia/i);
  add("Gameplay","Loot und Drop-Raten","Loot-Caches, Container und Seltenheitsstufen wurden umfassend neu gewichtet.",/loot generation & drop rates/i);
  add("Schiffe & Fahrzeuge","Treibstoff-Balance","Hydrogen- und Quantum-Treibstoff wurden bei Kapazität, Verbrauch, Preisen und Refuelling angepasst.",/hydrogen & quantum fuel rebalance/i);
  add("Schiffe & Fahrzeuge","Schiffsarmor","Die Schadensreduktion durch Rüstung berücksichtigt nun deren aktuellen Zustand.",/vehicle armor update/i);
  add("Schiffe & Fahrzeuge","Claims und Verfügbarkeit","Claim-/Lieferzeiten, Expedite-Kosten, Munitionspreise und verschiedene Shop-Angebote wurden angepasst.",/pricing, claims, & availability/i);
  add("Schiffe & Fahrzeuge","Soft Death für Bodenfahrzeuge","Bodenfahrzeuge können nun deaktiviert werden und bleiben inert, statt direkt zerstört zu werden.",/ground vehicle soft death/i);
  add("Inventar","Neue Waffen und Ausrüstung","Neue FPS-Waffen und schwere Ausrüstung erweitern das verfügbare Arsenal.",/new fps weapon|arlington rifle|cq7.*bullpup|vendetta hmg|super heavy armor/i);
  add("Technik","Instancing","Geschlossene Instanzen für unterstützte Inhalte werden durch neue Backend- und Skalierungslogik ermöglicht.",/instancing/i);
  add("Technik","Performance & Streaming","Physik, Rendering, Partikel, Streaming und Speicherverwaltung wurden an mehreren Stellen optimiert.",/performance & streaming/i);
  add("VR","Experimentelle VR-Unterstützung","Headtracking, Stereo-Cursor, Rendering und OpenXR wurden weiterentwickelt.",/virtual reality updates|experimental vr|openxr/i);
  add("Missionen","Frachtverteilung","Multi-Pickup-Aufträge verteilen Fracht nun anhand der SCU-Menge der einzelnen Abholorte.",/hauling and delivery cargo distribution/i);
  add("Inventar","Loot-Verfügbarkeit von Waffenaufsätzen","Bestimmte Kompensatoren und Stabilisatoren sind nun breiter im allgemeinen Loot-Pool verfügbar.",/weapon attachment availability/i);
  add("Gameplay","Kreaturen- und Pflanzenbeute","Beute von Kreaturen und Pflanzen erhält abgestufte Qualitätsstufen.",/creature and plant loot quality/i);
  add("Belohnungen","SecondWind-Belohnungen","Orison Relief Support bietet mehrere zusätzliche Belohnungen.",/secondwind/i);
  add("Herstellung","TH-01 Propulsor","Der TH-01 Propulsor erhält eine Herstellungsmöglichkeit.",/th-01 propulsor/i);
  add("Missionen","Defend Location – Ship Battles V3","Verteidigung und Eskorte werden in mehreren Schwierigkeitsgraden kombiniert.",/defend location.{0,60}ship battles v3/i);
  add("Events","Return of XenoThreat","Das XenoThreat-Event kehrt zurück.",/return of xenothreat|xenothreat returns/i);
  add("Missionen","Tactical Strike Group","Neue Einsätze der Tactical Strike Group.",/tactical strike group/i);
  add("Fracht","Ordnance Cargo Holder","Munition kann über den neuen Cargo Holder transportiert werden.",/ordnance cargo holder/i);
  add("Fracht","Freight Elevator Kiosk","Bedienung und Anzeige des Frachtaufzugs wurden angepasst.",/freight elevator kiosk/i);
  add("Missionen","Kampfmissionen","Schwierigkeit und Abläufe von Kampfeinsätzen wurden neu abgestimmt.",/combat mission rebalance|combat missions rebalance/i);
  add("Waffen","CQ7 Bullpup","Die neue FPS-Waffe erweitert das Arsenal.",/cq7.{0,25}bullpup/i);
  add("UI","Granaten-Marker","HUD-Marker erleichtern das Erkennen von Granaten.",/grenade hud marker/i);
  add("Technik","Stabilität und Fehlerbehebungen","Der Patch enthält zahlreiche Crash-, Stabilitäts- und Performance-Korrekturen.",/stability and performance|client crashes|server crashes|bug fixes/i);
  return changes.slice(0,12);
}

async function summarizePatch(item, previous, key) {
  const prompt = `Du bist Redakteur einer unabhängigen deutschen Star-Citizen-Fanseite. Arbeite ausschließlich mit den gelieferten Patch Notes. Erfinde nichts. Keine 1:1-Übersetzung und keine langen Originalpassagen. Erstelle eine wirklich informative deutsche Zusammenfassung der wichtigsten Änderungen. Berücksichtige neue Inhalte, Gameplay-Systeme, Missionen, Schiffe/Fahrzeuge, Waffen/Ausrüstung, Orte, Technik/Performance, Audio/VR und wichtige Fixes. changes soll 6-12 konkrete Punkte enthalten; nur Kategorien verwenden, die im Patch tatsächlich vorkommen. summary: 80-140 Wörter. fullSummary: 350-900 Wörter. JSON-Felder exakt: summary, fullSummary, changes, previous. changes ist ein Array aus {category,title,description}. Patch: ${item.version}. Vorherige Version: ${previous||"unbekannt"}. Inhalt: ${item.content.slice(0,50000)}`;
  const r=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{"content-type":"application/json","authorization":"Bearer "+key},body:JSON.stringify({model:"gpt-5-mini",input:prompt})});
  if(!r.ok) throw Error(`OpenAI error ${r.status}`);
  const j=await r.json(); const text=j.output_text||""; return JSON.parse(text.replace(/^```json\s*|\s*```$/g,""));
}

function classify(t) {
  if (/patch|alpha\s*\d/i.test(t)) return "PATCH NOTES";
  if (/free\s*fly/i.test(t)) return "FREE FLY";
  if (/event|foundation festival|invictus|fleet week|iae|pirate week|ship showdown|siege/i.test(t)) return "EVENT";
  if (/roadmap/i.test(t)) return "ROADMAP";
  if (/ship|vehicle|sabre|argo|aegis|anvil|kruger|rsi/i.test(t)) return "SCHIFFE";
  return "NEWS";
}

async function summarize(item, key) {
  const prompt = `Du bist Redakteur einer unabhängigen deutschen Star-Citizen-Fanseite. Verarbeite ausschließlich den gelieferten Titel. Keine erfundenen Fakten. Antworte ausschließlich als valides JSON mit title, summary, category. category: NEWS, PATCH NOTES, FREE FLY, EVENT, ROADMAP oder SCHIFFE. Titel max. 100 Zeichen. Zusammenfassung 40-90 Wörter. Wenn nur ein Titel vorliegt, darfst du nur vorsichtig paraphrasieren und keine zusätzlichen Fakten ergänzen.\nTitel: ${item.title}`;
  const r = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { "content-type": "application/json", "authorization": "Bearer " + key }, body: JSON.stringify({ model: "gpt-5-mini", input: prompt }) });
  if (!r.ok) throw Error(`OpenAI error ${r.status}`);
  const j = await r.json();
  const text = j.output_text || "";
  return JSON.parse(text.replace(/^```json\s*|\s*```$/g, ""));
}

async function githubDiagnostics(env, path) {
  const rawRepo = String(env.GITHUB_REPO || "").trim();
  const parts = rawRepo.split("/").filter(Boolean);
  const owner = parts[0] || "";
  const repo = parts[1] || "";
  const branch = String(env.GITHUB_BRANCH || "main").trim() || "main";
  const tokenConfigured = Boolean(env.GITHUB_TOKEN);
  const result = {
    tokenConfigured,
    repoConfigured: Boolean(rawRepo),
    repo: rawRepo || null,
    branch,
    path,
    requestAttempted: false,
    httpStatus: null,
    githubMessage: null,
    hasContent: false,
    decodedBytes: 0,
    parsedJson: false,
    itemCount: null
  };
  if (!owner || !repo) { result.githubMessage = "GITHUB_REPO fehlt oder hat nicht das Format owner/repository"; return result; }
  if (!tokenConfigured) { result.githubMessage = "GITHUB_TOKEN ist im Worker nicht konfiguriert"; return result; }
  const api = `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`;
  result.requestAttempted = true;
  const r = await fetch(api, { headers: gh(env.GITHUB_TOKEN) });
  result.httpStatus = r.status;
  const text = await r.text();
  let j = null;
  try { j = JSON.parse(text); } catch {}
  if (!r.ok) {
    result.githubMessage = j?.message || `GitHub API HTTP ${r.status}`;
    return result;
  }
  result.hasContent = Boolean(j?.content);
  if (!j?.content) {
    result.githubMessage = "GitHub API antwortet, aber die Datei enthält kein content-Feld";
    return result;
  }
  try {
    const b64 = String(j.content).replace(/\s/g, "");
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    result.decodedBytes = bytes.length;
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    result.parsedJson = true;
    result.itemCount = Array.isArray(parsed) ? parsed.length : null;
  } catch (e) {
    result.githubMessage = `JSON/Content konnte nicht gelesen werden: ${e.message}`;
  }
  return result;
}

async function readGithubJSON(env, path, fallback) {
  const d = await githubDiagnostics(env, path);
  if (!d.parsedJson) return fallback;
  const [owner, repo] = String(env.GITHUB_REPO || "").trim().split("/");
  const branch = String(env.GITHUB_BRANCH || "main").trim() || "main";
  const api = `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`;
  const r = await fetch(api, { headers: gh(env.GITHUB_TOKEN) });
  if (!r.ok) return fallback;
  try {
    const j = await r.json();
    const b64 = String(j.content || "").replace(/\s/g, "");
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch { return fallback; }
}
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0).toString(16); }
async function putGithub(env, path, content, message) {
  const [owner, repo] = env.GITHUB_REPO.split("/");
  const api = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
  let sha; const old = await fetch(api, { headers: gh(env.GITHUB_TOKEN) }); if (old.ok) sha = (await old.json()).sha;
  const bytes = new TextEncoder().encode(content);
  let binary = ""; for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const body = { message, content: btoa(binary), branch: env.GITHUB_BRANCH || "main" }; if (sha) body.sha = sha;
  const r = await fetch(api, { method: "PUT", headers: { ...gh(env.GITHUB_TOKEN), "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw Error(`GitHub update failed ${r.status}`);
}
const gh = t => ({ accept: "application/vnd.github+json", authorization: `Bearer ${t}`, "x-github-api-version": "2022-11-28", "user-agent": "Verse-Radar/0.6.7" });
