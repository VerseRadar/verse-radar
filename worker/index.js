/* Verse Radar 0.6.4 – RSI news + patch notes ingestion
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
      return json({ ok: true, service: "verse-radar-updater", version: "0.6.4" });
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
        const items = await fetchPatchItems();
        return json({ ok: true, source: PATCH_NOTES_URL, count: items.length, items });
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
        return json({ ok: true, version: "0.6.4", github: d });
      } catch (e) {
        return json({ ok: false, version: "0.6.4", error: e.message }, 500);
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
    return new Response("Verse Radar 0.6.4", { headers: { "content-type": "text/plain;charset=utf-8" } });
  },
  async scheduled(_, env, ctx) { ctx.waitUntil(updateSite(env)); }
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
          "user-agent": "Verse-Radar/0.6.4 (+independent fan site)",
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
        "user-agent": "Verse-Radar/0.6.4 (+independent fan site)",
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
      const r = await fetch(item.url, { headers: { "user-agent": "Verse-Radar/0.6.4 (+independent fan site)", "accept": "text/html,application/xhtml+xml" } });
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

async function updateSite(env) {
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

  const patchResult = await updatePatches(env);
  const now = new Date().toISOString();
  const meta = { updatedAt: now, source: COMM_LINK_URL, patchSource: PATCH_NOTES_URL, mode: env.GITHUB_TOKEN && env.GITHUB_REPO ? "live" : "preview", automation: "Cloudflare Worker + RSI Comm-Link + RSI Patch Notes", version: "0.6.4", fetchedItems: items.length, newItems: news.filter(n => !known.has(n.id)).length, aiItems: aiCount, patchItems: patchResult.items.length, patchAiItems: patchResult.aiItems };

  if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) {
    return { ok: true, version: "0.6.4", published: false, ...meta, note: "RSI-Abholung funktioniert. GitHub Secrets fehlen noch; daher wurde nichts zurückgeschrieben." };
  }

  await putGithub(env, "public/data/news.json", JSON.stringify(finalNews, null, 2) + "\n", "Verse Radar 0.6.4: update news");
  await putGithub(env, "public/data/patches.json", JSON.stringify(patchResult.patches, null, 2) + "\n", "Verse Radar 0.6.4: update patches");
  await putGithub(env, "public/data/meta.json", JSON.stringify(meta, null, 2) + "\n", "Verse Radar 0.6.4: update meta");
  return { ok: true, version: "0.6.4", published: true, ...meta };
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
    if (old && old.summary && old.fullSummary && Array.isArray(old.changes) && old.changes.length) {
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
      note: "Deutsche Zusammenfassung der offiziellen Patch Notes. Kein offizieller RSI-Text."
    });
  }
  return { patches, items: unique.slice(0, PATCH_MAX), aiItems };
}

async function fetchPatchItems() {
  const discovered = [];
  try {
    const apiUrl = "https://api.star-citizen.wiki/api/comm-links?page[size]=100&sort=-id";
    const r = await fetch(apiUrl, { headers: { "user-agent": "Verse-Radar/0.6.4 (+independent fan site)", "accept": "application/json" } });
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
  const unique = dedupePatchItems(discovered).sort(comparePatchVersionsDesc).slice(0, PATCH_MAX);
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
      headers: { "user-agent": "Verse-Radar/0.6.4 (+independent fan site)", "accept": "application/json" }
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
        headers: { "user-agent": "Verse-Radar/0.6.4 (+independent fan site)", "accept": "application/json" }
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
      const r = await fetch(url, { headers: { "user-agent": "Verse-Radar/0.6.4 (+independent fan site)", "accept": "text/html,application/xhtml+xml" } });
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
    const key = item.version;
    const old = map.get(key);
    if (!old || Number(item.sourceId||0) > Number(old.sourceId||0) || item.content.length > old.content.length) map.set(key,item);
  }
  return [...map.values()];
}

function validDate(v) { const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d.toISOString(); }
function fallbackPatchSummary(version, content) {
  const text = content || "";
  const parts = [];
  if (/orison relief support/i.test(text)) parts.push("Orison Relief Support ergänzt neue Unterstützungs- und Wiederaufbauinhalte rund um Orison.");
  if (/ground vehicle soft death/i.test(text)) parts.push("Das Verhalten von Bodenfahrzeugen bei Soft Death wurde erweitert.");
  if (/creature and plant loot quality/i.test(text)) parts.push("Die Qualität bzw. Verfügbarkeit von Beute bei Kreaturen und Pflanzen wurde angepasst.");
  if (/weapon attachment availability/i.test(text)) parts.push("Bestimmte Waffenaufsätze sind nun breiter im Loot-Pool verfügbar.");
  if (/cargo distribution|pickup/i.test(text)) parts.push("Die Verteilung von Fracht bei Liefer- und Hauling-Aufträgen wurde überarbeitet.");
  if (/audio/i.test(text)) parts.push("Mehrere Audio-Bereiche wurden erweitert oder überarbeitet.");
  if (/client crashes|server crashes|stability and performance|bug fixes/i.test(text)) parts.push("Der Patch enthält zahlreiche Fehlerbehebungen sowie Stabilitätsverbesserungen.");
  return parts.slice(0,5).join(" ") || `${version} enthält Änderungen und Fehlerbehebungen laut den offiziellen Patch Notes.`;
}
function fallbackFullSummary(version, content) {
  if (!content) return "Die Patch-Notizen konnten technisch noch nicht vollständig aus dem Archiv übernommen werden. Die offizielle Originalquelle ist direkt verlinkt.";
  const t = content;
  const parts = [];
  if (/orison relief support/i.test(t)) parts.push("Im Gameplay bringt der Patch mit Orison Relief Support eine zeitlich begrenzte Reihe von Aufträgen zum Wiederaufbau von Orison. Dazu gehören Sammel-, Herstellungs-, Transport- und Kampfeinsätze mit einem persönlichen Fortschritts- und Belohnungssystem.");
  if (/ground vehicle soft death/i.test(t)) parts.push("Bodenfahrzeuge können nun in einen Soft-Death-Zustand wechseln, anstatt direkt zerstört zu werden.");
  if (/creature and plant loot quality/i.test(t)) parts.push("Bei Kreaturen und Pflanzen gibt es nun abgestufte Beutequalitäten.");
  if (/weapon attachment availability/i.test(t)) parts.push("Bestimmte Waffenaufsätze sind breiter im allgemeinen Loot-Pool verfügbar.");
  if (/hauling and delivery cargo distribution/i.test(t)) parts.push("Die Frachtverteilung bei mehrteiligen Hauling- und Lieferaufträgen wurde überarbeitet und berücksichtigt die SCU-Menge der einzelnen Abholorte.");
  if (/hydrogen & quantum fuel rebalance|siege of orison v2/i.test(t)) parts.push("Der Patch enthält außerdem umfangreiche Gameplay- und Systemänderungen rund um Siege of Orison, Treibstoff, Schiffs- und Fahrzeugmechaniken sowie Instancing.");
  if (/client crashes|server crashes|stability and performance|closes 37 issues|closes 479 bug fixes/i.test(t)) {
    const m=t.match(/closes\s+(\d+)\s+(?:bug fixes|issues)/i);
    parts.push(`Zusätzlich wurden zahlreiche Stabilitäts- und Fehlerprobleme behoben${m ? `, darunter ${m[1]} dokumentierte Korrekturen` : ""}.`);
  }
  if (/experimental vr|openxr/i.test(t)) parts.push("Für VR wurden experimentelle Verbesserungen an Headtracking, Cursor, Rendering und OpenXR ergänzt.");
  return parts.slice(0,8).join(" ") || `${version} enthält Gameplay-, Technik- und Fehlerbehebungsänderungen. Die vollständige Liste ist über die offizielle Originalquelle abrufbar.`;
}
function buildPatchChanges(item) {
  const t=item.content||""; const changes=[];
  const add=(category,title,description,pattern)=>{ if(pattern.test(t)) changes.push({category,title,description}); };
  add("Gameplay","Orison Relief Support","Neue Unterstützungs- und Wiederaufbauinhalte rund um Orison mit Aufträgen für Ressourcen, Herstellung, Transport und Kampf.",/orison relief support/i);
  add("Gameplay","Ground Vehicle Soft Death","Bodenfahrzeuge können nun in einen Soft-Death-Zustand wechseln.",/ground vehicle soft death/i);
  add("Gameplay","Creature & Plant Loot","Beute von Kreaturen und Pflanzen erhält abgestufte Qualitätsstufen.",/creature and plant loot quality/i);
  add("Inventar","Waffenaufsätze","Bestimmte Kompensatoren und Stabilisatoren sind nun breiter im allgemeinen Loot-Pool verfügbar.",/weapon attachment availability/i);
  add("Missionen","Frachtverteilung","Multi-Pickup-Verträge berücksichtigen die SCU-Menge je Abholort bei der Verteilung.",/hauling and delivery cargo distribution|cargo distribution/i);
  add("Schiffe & Fahrzeuge","Fahrzeug- und Hangar-Fixes","Mehrere Probleme mit Fahrzeugschaden, Soft Death, ASOP, Hangars und Fahrzeugabruf wurden behoben.",/ships and vehicles|hangars, asop|vehicle retrieval/i);
  add("Audio","Audio-Überarbeitungen","Mehrere Schiffs- und gemeinsame Audioarbeiten sowie zusätzliche Waffengeräusche wurden ergänzt.",/audio|sabre series audio/i);
  add("Technik","Stabilität & Performance","Der Patch enthält zahlreiche Stabilitäts-, Crash- und Performance-Korrekturen.",/stability and performance|client crashes|server crashes|crash and stability/i);
  add("Bugfixes","Missionen & UI","Mehrere Fehler bei Missionen, Starmap, Inventar, Aufträgen und Benutzeroberflächen wurden behoben.",/bug fixes|starmap|inventory and items/i);
  add("VR","Experimentelle VR-Unterstützung","VR-Headtracking, Cursor und Rendering wurden weiter überarbeitet.",/experimental vr|openxr/i);
  return changes;
}

async function summarizePatch(item, previous, key) {
  const prompt = `Du bist Redakteur einer unabhängigen deutschen Star-Citizen-Fanseite. Fasse die gelieferten offiziellen Patch Notes auf Deutsch zusammen. Erfinde nichts. Erzeuge KEINE vollständige Übersetzung des Originaltexts und kopiere keine langen Passagen. Gib stattdessen eine vollständige, strukturierte deutsche Zusammenfassung der wesentlichen Änderungen. JSON-Felder: summary (80-140 Wörter), fullSummary (300-900 Wörter), changes (Array mit category,title,description), previous. Kategorien: Gameplay, Schiffe & Fahrzeuge, Orte, Missionen, Inventar, Technik, Audio, Bugfixes, Sonstiges. Patch: ${item.version}. Vorherige Version: ${previous||"unbekannt"}. Inhalt: ${item.content.slice(0,50000)}`;
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
const gh = t => ({ accept: "application/vnd.github+json", authorization: `Bearer ${t}`, "x-github-api-version": "2022-11-28", "user-agent": "Verse-Radar/0.6.4" });
