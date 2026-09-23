/* Verse Radar 0.5 – RSI news ingestion
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
const RELEVANT = /patch|alpha\s*\d|free\s*fly|foundation festival|fleet week|invictus|iae|event|roadmap|ship showdown|siege|monthly report|this week in star citizen|live experience|pirate week|subscriber|vehicle|ship|aegis|argo|anvil|kruger|rsi|sabre|aurora|gameplay|engineering/i;

export default {
  async fetch(request, env) {
    const u = new URL(request.url);
    if (u.pathname === "/health") {
      return json({ ok: true, service: "verse-radar-updater", version: "0.5" });
    }
    if (u.pathname === "/preview") {
      try {
        const items = await fetchRSIItems();
        return json({ ok: true, source: COMM_LINK_URL, count: items.length, items });
      } catch (e) {
        return json({ ok: false, error: e.message }, 502);
      }
    }
    if (u.pathname === "/run") {
      if (env.RUN_SECRET && u.searchParams.get("key") !== env.RUN_SECRET) return json({ ok: false, error: "Unauthorized" }, 401);
      try { return json(await updateSite(env)); } catch (e) { return json({ ok: false, error: e.message }, 500); }
    }
    // Public website: let Cloudflare Static Assets serve /public.
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("Verse Radar 0.5", { headers: { "content-type": "text/plain;charset=utf-8" } });
  },
  async scheduled(_, env, ctx) { ctx.waitUntil(updateSite(env)); }
};

const json = (x, s = 200) => new Response(JSON.stringify(x, null, 2), { status: s, headers: { "content-type": "application/json;charset=utf-8", "cache-control": "no-store" } });

async function fetchRSIItems() {
  const r = await fetch(COMM_LINK_URL, { headers: { "user-agent": "Verse-Radar/0.5 (+independent fan site)", "accept": "text/html" } });
  if (!r.ok) throw Error(`RSI Comm-Link fetch failed: ${r.status}`);
  const html = await r.text();
  const items = parseCommLink(html);
  if (!items.length) throw Error("Keine Comm-Link-Beiträge erkannt. RSI-Seitenstruktur möglicherweise geändert.");
  return items.filter(x => RELEVANT.test(`${x.title} ${x.description}`)).slice(0, Number(0) || MAX);
}

function parseCommLink(html) {
  const out = [];
  const seen = new Set();
  // The public Comm-Link page contains links to post pages. We intentionally
  // parse only anchor/title text and nearby visible snippets; no article body is copied.
  const re = /<a[^>]+href=["']([^"']*\/comm-link\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const m of html.matchAll(re)) {
    const href = cleanUrl(m[1]);
    const title = strip(m[2]);
    if (!href || !title || title.length < 5 || title.length > 240) continue;
    if (/^All RSI communications$|^COMM-LINK$|^Input$|^Channel$|^Series$|^Type$|^Sort$/i.test(title)) continue;
    if (seen.has(href)) continue;
    seen.add(href);
    out.push({ title, url: href, date: new Date().toISOString(), description: "Offizieller RSI Comm-Link-Beitrag. Öffne die Originalquelle für den vollständigen Inhalt." });
    if (out.length >= 60) break;
  }
  return out;
}

function cleanUrl(href) {
  const h = href.replace(/&amp;/g, "&").trim();
  if (!h || h.startsWith("#") || h.startsWith("javascript:")) return "";
  try { return new URL(h, "https://robertsspaceindustries.com").href; } catch { return ""; }
}
function strip(s) { return s.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim(); }

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
      try { ai = await summarize(item, env.OPENAI_API_KEY); aiCount++; } catch (_) { /* keep source headline */ }
    }
    news.push({
      id,
      title: ai?.title || item.title,
      category: ai?.category || classify(item.title),
      date: item.date,
      summary: ai?.summary || item.description,
      sourceUrl: item.url,
      source: "RSI Comm-Link",
      ai: Boolean(ai)
    });
  }
  for (const old of existing) if (!news.some(n => n.id === old.id)) news.push(old);
  news.sort((a, b) => new Date(b.date) - new Date(a.date));
  const finalNews = news.slice(0, 60);

  const now = new Date().toISOString();
  const meta = { updatedAt: now, source: COMM_LINK_URL, mode: env.GITHUB_TOKEN && env.GITHUB_REPO ? "live" : "preview", automation: "Cloudflare Worker + RSI Comm-Link", version: "0.5", fetchedItems: items.length, newItems: news.filter(n => !known.has(n.id)).length, aiItems: aiCount };

  if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) {
    return { ok: true, version: "0.5", published: false, ...meta, note: "RSI-Abholung funktioniert. GitHub Secrets fehlen noch; daher wurde nichts zurückgeschrieben." };
  }

  await putGithub(env, "public/data/news.json", JSON.stringify(finalNews, null, 2) + "\n", "Verse Radar 0.5: update news");
  await putGithub(env, "public/data/meta.json", JSON.stringify(meta, null, 2) + "\n", "Verse Radar 0.5: update meta");
  return { ok: true, version: "0.5", published: true, ...meta };
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

async function readGithubJSON(env, path, fallback) {
  const [owner, repo] = env.GITHUB_REPO.split("/");
  const r = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, { headers: gh(env.GITHUB_TOKEN) });
  if (!r.ok) return fallback;
  try { const j = await r.json(); return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(j.content.replace(/\n/g, "")), c => c.charCodeAt(0)))); } catch { return fallback; }
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
const gh = t => ({ accept: "application/vnd.github+json", authorization: `Bearer ${t}`, "x-github-api-version": "2022-11-28", "user-agent": "Verse-Radar/0.5" });
