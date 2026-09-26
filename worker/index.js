/* Verse Radar 0.6.0 – RSI news + patch notes ingestion
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
const PATCH_NOTES_URL = "https://robertsspaceindustries.com/en/patch-notes";
const RELEVANT = /patch|alpha\s*\d|free\s*fly|foundation festival|fleet week|invictus|iae|event|roadmap|ship showdown|siege|monthly report|this week in star citizen|live experience|pirate week|subscriber|vehicle|ship|aegis|argo|anvil|kruger|rsi|sabre|aurora|gameplay|engineering/i;

export default {
  async fetch(request, env) {
    const u = new URL(request.url);
    if (u.pathname === "/health") {
      return json({ ok: true, service: "verse-radar-updater", version: "0.6.0" });
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
        return json({ ok: true, version: "0.6.0", github: d });
      } catch (e) {
        return json({ ok: false, version: "0.6.0", error: e.message }, 500);
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
    return new Response("Verse Radar 0.6.0", { headers: { "content-type": "text/plain;charset=utf-8" } });
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
          "user-agent": "Verse-Radar/0.6.0 (+independent fan site)",
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
        "user-agent": "Verse-Radar/0.6.0 (+independent fan site)",
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
      const r = await fetch(item.url, { headers: { "user-agent": "Verse-Radar/0.6.0 (+independent fan site)", "accept": "text/html,application/xhtml+xml" } });
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
  const meta = { updatedAt: now, source: COMM_LINK_URL, patchSource: PATCH_NOTES_URL, mode: env.GITHUB_TOKEN && env.GITHUB_REPO ? "live" : "preview", automation: "Cloudflare Worker + RSI Comm-Link + RSI Patch Notes", version: "0.6.0", fetchedItems: items.length, newItems: news.filter(n => !known.has(n.id)).length, aiItems: aiCount, patchItems: patchResult.items.length, patchAiItems: patchResult.aiItems };

  if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) {
    return { ok: true, version: "0.6.0", published: false, ...meta, note: "RSI-Abholung funktioniert. GitHub Secrets fehlen noch; daher wurde nichts zurückgeschrieben." };
  }

  await putGithub(env, "public/data/news.json", JSON.stringify(finalNews, null, 2) + "\n", "Verse Radar 0.6.0: update news");
  await putGithub(env, "public/data/patches.json", JSON.stringify(patchResult.patches, null, 2) + "\n", "Verse Radar 0.6.0: update patches");
  await putGithub(env, "public/data/meta.json", JSON.stringify(meta, null, 2) + "\n", "Verse Radar 0.6.0: update meta");
  return { ok: true, version: "0.6.0", published: true, ...meta };
}

async function updatePatches(env) {
  const items = await fetchPatchItems();
  const existing = env.GITHUB_TOKEN && env.GITHUB_REPO ? await readGithubJSON(env, "public/data/patches.json", []) : [];
  const patches = [];
  let aiItems = 0;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const previous = items[i + 1]?.version || null;
    const old = existing.find(x => x.version === item.version);
    if (old && old.summary && old.sourceUrl === item.sourceUrl) { patches.push({ ...old, previous: old.previous || previous }); continue; }
    let ai = null;
    if (env.OPENAI_API_KEY && item.content) {
      try { ai = await summarizePatch(item, previous, env.OPENAI_API_KEY); aiItems++; } catch (_) {}
    }
    patches.push({
      version: item.version, date: item.date, previous,
      summary: ai?.summary || item.fallbackSummary,
      changes: ai?.changes || buildPatchChanges(item),
      fullSummary: ai?.fullSummary || item.fallbackFullSummary,
      sourceUrl: item.sourceUrl,
      ai: Boolean(ai),
      note: "Deutsche Zusammenfassung der offiziellen Patch Notes. Kein offizieller RSI-Text."
    });
  }
  patches.sort((a,b)=>new Date(b.date)-new Date(a.date));
  return { patches: patches.slice(0, PATCH_MAX), items, aiItems };
}

async function fetchPatchItems() {
  const out = [];
  try {
    const apiUrl = "https://api.star-citizen.wiki/api/comm-links?page[size]=100&sort=-id";
    const r = await fetch(apiUrl, { headers: { "user-agent": "Verse-Radar/0.6.0 (+independent fan site)", "accept": "application/json" } });
    const body = await r.json();
    const records = Array.isArray(body?.data) ? body.data : [];
    for (const record of records) {
      const title = strip(record?.title || "");
      if (!/^Star Citizen Alpha \d+(?:\.\d+){1,2}(?:\.0)?(?:\s|$)/i.test(title)) continue;
      const id = Number(record?.id); if (!id) continue;
      const version = title.replace(/^Star Citizen /i, "").trim();
      const date = validDate(record?.created_at) || validDate(record?.published_at) || new Date().toISOString();
      const sourceUrl = `https://robertsspaceindustries.com/en/comm-link/Patch-Notes/${id}-${slugify(title.replace(/\s+/g," ").replace(/^Star Citizen /i,"Star-Citizen-"))}`;
      let content = strip(record?.content || record?.body || record?.description || "");
      if (content.length < 300) {
        try {
          const detail = await fetch(`https://api.star-citizen.wiki/api/comm-links/${id}`, { headers: { "user-agent": "Verse-Radar/0.6.0 (+independent fan site)", "accept": "application/json" } });
          if (detail.ok) { const dj = await detail.json(); const d = dj?.data || dj; content = strip(d?.content || d?.body || d?.description || content); }
        } catch {}
      }
      out.push({ version, date, sourceUrl, content, fallbackSummary: fallbackPatchSummary(version, content), fallbackFullSummary: fallbackFullSummary(content) });
      if (out.length >= PATCH_MAX) break;
    }
  } catch {}
  if (!out.length) throw Error("Keine Patch Notes erkannt.");
  return out;
}

function validDate(v) { const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d.toISOString(); }
function fallbackPatchSummary(version, content) {
  const text = content || "";
  const parts = [];
  if (/orison relief support/i.test(text)) parts.push("Orison Relief Support bringt neue Wiederaufbau- und Unterstützungsaufträge nach dem Angriff auf Orison.");
  if (/cargo distribution|pickup/i.test(text)) parts.push("Die Verteilung von Fracht bei Liefer- und Hauling-Aufträgen wurde überarbeitet.");
  if (/audio/i.test(text)) parts.push("Mehrere Audio-Bereiche wurden erweitert oder überarbeitet.");
  if (/crash|stability|performance/i.test(text)) parts.push("Der Patch enthält zahlreiche Stabilitäts-, Performance- und Fehlerbehebungen.");
  return parts.join(" ") || `${version} enthält Änderungen und Fehlerbehebungen laut den offiziellen Patch Notes.`;
}
function fallbackFullSummary(content) {
  if (!content) return "Die vollständige offizielle Liste der Änderungen ist über den Original-Link verfügbar.";
  const sentences = content.split(/(?<=[.!?])\s+/).filter(x => x.length > 30).slice(0, 12);
  return sentences.join(" ").slice(0, 1800) || "Die offiziellen Patch Notes enthalten zahlreiche Änderungen und Fehlerbehebungen. Für die vollständige Liste siehe Originalquelle.";
}
function buildPatchChanges(item) {
  const t=item.content||""; const changes=[];
  if (/orison relief support/i.test(t)) changes.push({category:"Gameplay", title:"Orison Relief Support", description:"Neue Aufträge rund um den Wiederaufbau und die Unterstützung von Orison."});
  if (/hauling and delivery cargo distribution/i.test(t)) changes.push({category:"Gameplay", title:"Frachtverteilung", description:"Die Verteilung von Fracht auf mehrere Abholorte wurde überarbeitet."});
  if (/audio/i.test(t)) changes.push({category:"Audio", title:"Audio-Überarbeitungen", description:"Mehrere Audio-Bereiche wurden erweitert oder überarbeitet."});
  if (/bug fixes|fixed an issue|stability and performance/i.test(t)) changes.push({category:"Bugfixes", title:"Fehlerbehebungen", description:"Der Patch enthält zahlreiche Fehlerbehebungen sowie Stabilitäts- und Performance-Verbesserungen."});
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
const gh = t => ({ accept: "application/vnd.github+json", authorization: `Bearer ${t}`, "x-github-api-version": "2022-11-28", "user-agent": "Verse-Radar/0.6.0" });
