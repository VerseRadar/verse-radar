/* Verse Radar 0.4 – automatische Redaktion
   Secrets: OPENAI_API_KEY, GITHUB_TOKEN, RUN_SECRET
   Vars: GITHUB_REPO, GITHUB_BRANCH (optional), MAX_ITEMS (optional)

   Pipeline: RSI Comm-Link RSS -> relevance filter -> AI DE summary -> GitHub JSON
   -> static site. Cron can run every 2 hours.
*/
const RSS_URL = "https://robertsspaceindustries.com/en/comm-link/rss";
const MAX = 20;
const RELEVANT = /patch|alpha\s*\d|free\s*fly|foundation festival|fleet week|invictus|iae|event|roadmap|ship showdown|siege|monthly report|this week in star citizen|live experience|pirate week|subscriber|comm-link/i;

export default {
  async fetch(request, env) {
    const u = new URL(request.url);
    if (u.pathname === "/health") return json({ ok: true, service: "verse-radar-updater", version: "0.4" });
    if (u.pathname !== "/run") return new Response("Verse Radar updater online – 0.4", { headers: { "content-type": "text/plain;charset=utf-8" } });
    if (env.RUN_SECRET && u.searchParams.get("key") !== env.RUN_SECRET) return json({ ok: false, error: "Unauthorized" }, 401);
    try { return json(await updateSite(env)); } catch (e) { return json({ ok: false, error: e.message }, 500); }
  },
  async scheduled(_, env, ctx) { ctx.waitUntil(updateSite(env)); }
};

const json = (x, s = 200) => new Response(JSON.stringify(x, null, 2), { status: s, headers: { "content-type": "application/json;charset=utf-8", "cache-control": "no-store" } });

async function updateSite(env) {
  for (const k of ["OPENAI_API_KEY", "GITHUB_TOKEN", "GITHUB_REPO"]) if (!env[k]) return { ok: false, error: `Missing ${k}` };
  const rss = await fetch(RSS_URL, { headers: { "user-agent": "Verse-Radar/0.4 (+independent fan site)" } });
  if (!rss.ok) throw Error(`RSI RSS fetch failed: ${rss.status}`);
  const items = parseRSS(await rss.text()).filter(x => RELEVANT.test(`${x.title} ${x.description}`)).slice(0, Number(env.MAX_ITEMS) || MAX);

  const existing = await readGithubJSON(env, "data/news.json", []);
  const known = new Set(existing.map(x => x.id));
  const news = [];
  for (const item of items) {
    const id = hash(item.url);
    const old = existing.find(x => x.id === id);
    if (old) { news.push(old); continue; }
    const ai = await summarize(item, env.OPENAI_API_KEY);
    news.push({ id, title: ai.title || item.title, category: ai.category || classify(item.title), date: item.date, summary: ai.summary || item.description || "", sourceUrl: item.url, source: "RSI Comm-Link", ai: true });
  }
  for (const old of existing) if (!news.some(n => n.id === old.id)) news.push(old);
  news.sort((a, b) => new Date(b.date) - new Date(a.date));

  const patches = await updatePatchHistory(env, news);
  const events = deriveEvents(news);
  const freefly = deriveFreeFly(news);
  const deals = await readGithubJSON(env, "data/deals.json", []);
  const now = new Date().toISOString();

  await putGithub(env, "data/news.json", JSON.stringify(news.slice(0, 60), null, 2) + "\n");
  await putGithub(env, "data/patches.json", JSON.stringify(patches, null, 2) + "\n");
  await putGithub(env, "data/events.json", JSON.stringify(events, null, 2) + "\n");
  await putGithub(env, "data/freefly.json", JSON.stringify(freefly, null, 2) + "\n");
  await putGithub(env, "data/meta.json", JSON.stringify({ updatedAt: now, source: "RSI Comm-Link RSS", mode: "live", automation: "Cloudflare Worker + RSI RSS + OpenAI", version: "0.4", fetchedItems: items.length, newItems: news.filter(n => !known.has(n.id)).length }, null, 2) + "\n");
  return { ok: true, version: "0.4", updatedAt: now, fetched: items.length, news: Math.min(news.length, 60), patches: patches.length, events: events.length, freeFlyActive: freefly.active, note: "Deals bleiben bis zur offiziellen Pledge-Quelle manuell gepflegt." };
}

function parseRSS(xml) {
  const out = [];
  for (const block of xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
    const b = block[1];
    const get = tag => { const m = b.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\S]*?)<\\/${tag}>`, "i")); return m ? decode(m[1]).trim() : ""; };
    out.push({ title: get("title"), url: get("link"), date: get("pubDate") || get("published"), description: strip(get("description") || get("summary")) });
  }
  return out.filter(x => x.title && x.url);
}
function strip(s) { return s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 7000); }
function decode(s) { return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}
function classify(t) {
  if (/patch|alpha\s*\d/i.test(t)) return "PATCH NOTES";
  if (/free\s*fly/i.test(t)) return "FREE FLY";
  if (/event|foundation festival|invictus|fleet week|iae|pirate week|ship showdown|siege/i.test(t)) return "EVENT";
  if (/roadmap/i.test(t)) return "ROADMAP";
  if (/ship|vehicle|kruger/i.test(t)) return "SCHIFFE";
  return "NEWS";
}

async function summarize(item, key) {
  const prompt = `Du bist Redakteur einer unabhängigen deutschen Star-Citizen-Fanseite. Verarbeite ausschließlich den gelieferten RSS-Inhalt. Keine erfundenen Fakten, keine Werbesprache. Antworte ausschließlich als valides JSON mit den Feldern title, summary, category. category muss genau eines sein: NEWS, PATCH NOTES, FREE FLY, EVENT, ROADMAP, SCHIFFE. Titel max. 100 Zeichen. Zusammenfassung 50-110 Wörter. Wenn der Inhalt nur ein Teaser ist, fasse nur diesen Teaser zusammen.\nQuelle: ${item.url}\nTitel: ${item.title}\nInhalt: ${item.description}`;
  const r = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { "content-type": "application/json", "authorization": "Bearer " + key }, body: JSON.stringify({ model: "gpt-5-mini", input: prompt }) });
  if (!r.ok) throw Error(`OpenAI error ${r.status}`);
  const j = await r.json();
  const text = j.output_text || "";
  try { return JSON.parse(text.replace(/^```json\s*|\s*```$/g, "")); } catch { return { title: item.title, summary: item.description || "Zusammenfassung konnte nicht verarbeitet werden.", category: classify(item.title) }; }
}

function extractVersion(s) { const m = s.match(/(?:Alpha\s*)?(\d+\.\d+(?:\.\d+)?)/i); return m ? `Alpha ${m[1]}` : ""; }
async function updatePatchHistory(env, news) {
  const old = await readGithubJSON(env, "data/patches.json", []);
  const map = new Map(old.map(p => [p.version, p]));
  for (const n of news.filter(x => x.category === "PATCH NOTES")) {
    const version = extractVersion(n.title);
    if (!version) continue;
    if (!map.has(version)) map.set(version, { version, date: n.date, previous: "", summary: n.summary, diff: "Automatisch erkannt. Ein inhaltlicher Diff wird ergänzt, sobald für beide Versionen ausreichende Patchdaten vorliegen.", sourceUrl: n.sourceUrl });
  }
  const arr = [...map.values()].sort((a, b) => new Date(b.date) - new Date(a.date));
  for (let i = 0; i < arr.length; i++) arr[i].previous = arr[i + 1]?.version || "";
  return arr.slice(0, 30);
}
function deriveEvents(news) {
  return news.filter(n => ["EVENT", "FREE FLY"].includes(n.category)).slice(0, 12).map(n => ({ id: n.id, name: n.title, type: n.category, start: n.date, dateText: `Ankündigung: ${new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(n.date))}`, sourceUrl: n.sourceUrl }));
}
function deriveFreeFly(news) {
  const n = news.find(x => x.category === "FREE FLY");
  if (!n) return { active: false, title: "Kein Free Fly erkannt", dateText: "", summary: "Aktuell wurde im offiziellen RSI-Feed kein Free-Fly-Beitrag erkannt.", pageUrl: "https://robertsspaceindustries.com/en/comm-link" };
  return { active: true, title: n.title, dateText: new Intl.DateTimeFormat("de-DE", { date: "long" }).format(new Date(n.date)), summary: n.summary, pageUrl: n.sourceUrl, sourceUrl: n.sourceUrl };
}
async function readGithubJSON(env, path, fallback) {
  const [owner, repo] = env.GITHUB_REPO.split("/");
  const r = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, { headers: gh(env.GITHUB_TOKEN) });
  if (!r.ok) return fallback;
  try { const j = await r.json(); return JSON.parse(decodeURIComponent(escape(atob(j.content.replace(/\n/g, ""))))); } catch { return fallback; }
}
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0).toString(16); }
async function putGithub(env, path, content) {
  const [owner, repo] = env.GITHUB_REPO.split("/");
  const api = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
  let sha; const old = await fetch(api, { headers: gh(env.GITHUB_TOKEN) }); if (old.ok) sha = (await old.json()).sha;
  const body = { message: `Verse Radar 0.4: update ${path}`, content: btoa(unescape(encodeURIComponent(content))), branch: env.GITHUB_BRANCH || "main" }; if (sha) body.sha = sha;
  const r = await fetch(api, { method: "PUT", headers: { ...gh(env.GITHUB_TOKEN), "content-type": "application/json" }, body: JSON.stringify(body) }); if (!r.ok) throw Error(`GitHub update failed ${r.status}`);
}
const gh = t => ({ accept: "application/vnd.github+json", authorization: `Bearer ${t}`, "x-github-api-version": "2022-11-28", "user-agent": "Verse-Radar/0.4" });
