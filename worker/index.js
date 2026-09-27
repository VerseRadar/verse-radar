/* Verse Radar 0.9.9 – RSI news + patch notes ingestion
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
const PATCH_PAGE_SIZE = 100;
const PATCH_PAGES_PER_IMPORT = 2;
// Leave headroom for GitHub reads/writes, redirects and retries on Workers Free.
const PATCH_DETAILS_PER_IMPORT = 2;
const PATCH_SEEDS_PER_IMPORT = 2;
const HISTORICAL_PATCHES_PER_IMPORT = 8;
const PATCH_STATE_PATH = "public/data/patch-archive-state.json";
const PATCH_BACKFILL_PATH = "public/data/patch-backfill-control.json";
const PATCH_BACKFILL_CRON = "*/2 * * * *";
const PATCH_BACKFILL_LEASE_MS = 10 * 60 * 1000;
const VERSION = "0.9.9";
// These two release announcements were imported as patch notes before the
// source channel was checked. Keep their summaries, repair their RSI links.
const LEGACY_RELEASE_LINKS = new Map([
  ["4.8.3", "https://robertsspaceindustries.com/en/comm-link/transmission/21206-Star-Citizen-Alpha-483"],
  ["4.8.1", "https://robertsspaceindustries.com/en/comm-link/transmission/21177-Star-Citizen-Alpha-481"]
]);
const PATCH_SEEDS = [
  { version: "Alpha 4.10", id: 21293, date: "2026-08-26T18:00:00.000Z" },
  { version: "Alpha 4.9", id: 21245, date: "2026-07-15T18:00:00.000Z" },
  { version: "Alpha 4.7", id: 21070, date: "2026-03-25T00:00:00.000Z" },
  { version: "Alpha 4.6", id: 20969, date: "2026-01-28T00:00:00.000Z" },
  { version: "Alpha 4.5", id: 20934, date: "2025-12-17T00:00:00.000Z" },
  { version: "Alpha 4.4", id: 20899, date: "2025-11-19T00:00:00.000Z" },
  { version: "Alpha 4.3.2", id: 20852, date: "2025-10-16T00:00:00.000Z" },
  { version: "Alpha 4.3.1", id: 20777, date: "2025-09-18T00:00:00.000Z" },
  { version: "Alpha 4.3", id: 20728, date: "2025-08-16T00:00:00.000Z" },
  { version: "Alpha 4.2.1", id: 20702, date: "2025-07-17T00:00:00.000Z" },
  { version: "Alpha 4.2", id: 20638, date: "2025-06-19T00:00:00.000Z" },
  { version: "Alpha 4.1.1", id: 20598, date: "2025-05-13T00:00:00.000Z" },
  { version: "Alpha 4.1", id: 20522, date: "2025-03-27T00:00:00.000Z" },
  { version: "Alpha 4.0.2", id: 20445, date: "2025-02-28T00:00:00.000Z" },
  { version: "Alpha 4.0.1", id: 20418, date: "2025-01-29T00:00:00.000Z" },
  { version: "Alpha 4.0", id: 20360, date: "2024-12-19T00:00:00.000Z" },
  { version: "Alpha 4.8.2", id: 0, date: "2026-06-17T00:00:00.000Z", sourceType: "Content Update", sourceUrl: "https://starcitizen.tools/Update:Star_Citizen_Alpha_4.8.2" },
  { version: "Alpha 4.7.2", id: 0, date: "2026-04-22T00:00:00.000Z", sourceType: "Content Update", sourceUrl: "https://robertsspaceindustries.com/en/comm-link/transmission/21125-Star-Citizen-Alpha-472" },
  { version: "Alpha 4.7.1", id: 0, date: "2026-04-08T00:00:00.000Z", sourceType: "Content Update", sourceUrl: "https://starcitizen.tools/Update:Star_Citizen_Alpha_4.7.1" }
];
// The public category lists 80 releases; 3.17.2a is separately documented
// in RSI Spectrum and the comm-link archive. Keep the combined historical
// index locally: the Wiki categorymembers API can return an empty list.
const HISTORICAL_VERSIONS = [
  "3.0.0", "3.0.1", "3.1.0", "3.1.1", "3.1.2", "3.1.3", "3.1.4",
  "3.2.0", "3.2.1", "3.2.2", "3.3.0", "3.3.5", "3.3.6", "3.3.7",
  "3.4.0", "3.4.1", "3.4.2", "3.4.3", "3.5.0", "3.5.1",
  "3.6.0", "3.6.1", "3.6.2", "3.7.0", "3.7.1", "3.7.2",
  "3.8.0", "3.8.1", "3.8.2", "3.9.0", "3.9.1",
  "3.10.0", "3.10.1", "3.10.2", "3.11.0", "3.11.0a", "3.11.0b", "3.11.0c", "3.11.1", "3.11.1a",
  "3.12.0", "3.12.0a", "3.12.0b", "3.12.1", "3.13.0", "3.13.0a", "3.13.1",
  "3.14.0", "3.14.1", "3.15.0", "3.15.1", "3.16.0", "3.16.1",
  "3.17.0", "3.17.1", "3.17.2", "3.17.2a", "3.17.3", "3.17.4", "3.17.5",
  "3.18.0", "3.18.1", "3.18.2", "3.19.0", "3.19.1",
  "3.20.0", "3.20.0a", "3.20.0b", "3.21.0", "3.21.1",
  "3.22.0", "3.22.0a", "3.22.1", "3.23.0", "3.23.1", "3.23.1a",
  "3.24.0", "3.24.1", "3.24.2", "3.24.2a", "3.24.3"
];
// These short releases have verified, version-specific notes on RSI Spectrum.
// Their wiki mirrors do not use the headings expected by the general parser.
const HISTORICAL_SHORT_RELEASES = {
  "Alpha 3.17.5": {
    marker: /\balpha patch 3\.17\.5\b/i, minimum: 1,
    sourceUrl: "https://robertsspaceindustries.com/spectrum/community/SC/forum/190048/thread/star-citizen-alpha-3-17-5-live-8338165-patch-notes/5683361",
    changes: [
      ["Event", "Red Festival 2953", "Das Red Festival erhält zum Mondneujahr überarbeitete Umschläge zum Jahr des Hahns.", /\blunar new year envelope\b[\s\S]{0,90}\byear of the rooster\b/i]
    ]
  },
  "Alpha 3.17.4": {
    marker: /\balpha patch 3\.17\.4\b/i, minimum: 2,
    sourceUrl: "https://robertsspaceindustries.com/spectrum/community/SC/forum/190048/thread/star-citizen-alpha-3-17-4-live-8288900-patch-notes",
    changes: [
      ["Schiffe & Fahrzeuge", "Drake Corsair", "Die Drake Corsair kommt als neues Schiff hinzu.", /\badded new ship:\s*drake corsair\b/i],
      ["Technik", "Serverabsturz behoben", "Die Notizen melden die Behebung eines Serverabsturzes.", /\bfixed 1 server crash\b/i]
    ]
  },
  "Alpha 3.11.1a": {
    marker: /\bhot\s*fix 3\.11\.1a\b/i, minimum: 2,
    sourceUrl: "https://robertsspaceindustries.com/spectrum/community/SC/forum/190048/thread/star-citizen-alpha-3-11-1-live-6538054-patch-notes",
    changes: [
      ["Schiffe & Fahrzeuge", "Schiffe auf Planeten", "Ausgeschaltete Schiffe sollten nicht mehr durch Planetenoberflächen fallen.", /\bships to fall through planet surfaces when powered off\b/i],
      ["Charakter", "Nomad-Sitzanimation", "Sitzanimationen weiblicher Figuren im Nomad wurden korrigiert.", /\bfemale characters\b[\s\S]{0,80}\bsit animations\b[\s\S]{0,80}\bnomad\b/i],
      ["Schiffe & Fahrzeuge", "Sabre-Comet-Lackierung", "Lackierungen lassen sich wieder auf die Sabre Comet anwenden.", /\bpaints\b[\s\S]{0,75}\bsabre comet\b/i],
      ["Handel", "Handelskioske", "Die Anzeige für illegale Fracht erscheint ohne entsprechende Ladung nicht mehr fälschlich.", /\billegal cargo\b[\s\S]{0,100}\btrading kiosks\b/i],
      ["Technik", "Server und Backend", "Ein Server-Deadlock und ein Absturz des Backend-Dienstes wurden behoben.", /\bfixed a server deadlock\b[\s\S]{0,100}\bfixed a backend service crash\b/i]
    ]
  }
};
const VERSION_RE = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?$/;
const PATCH_NOTES_URL = "https://robertsspaceindustries.com/en/patch-notes";
const RELEVANT = /patch|alpha\s*\d|free\s*fly|foundation festival|fleet week|invictus|iae|event|roadmap|ship showdown|siege|monthly report|this week in star citizen|live experience|pirate week|subscriber|vehicle|ship|aegis|argo|anvil|kruger|sabre|aurora|gameplay|engineering|q\s*&\s*a|letter from the chairman/i;
const NEWS_SUMMARY_VERSION = "0.7.0";
const OLD_NEWS_PLACEHOLDER = "Offizieller RSI Comm-Link-Beitrag. Öffne die Originalquelle für den vollständigen Inhalt.";

export default {
  async fetch(request, env) {
    const u = new URL(request.url);
    if (u.pathname === "/health") {
      return json({ ok: true, service: "verse-radar-updater", version: VERSION });
    }
    if (u.pathname === "/backfill") return backfillPage();
    if (u.pathname === "/backfill/status" || u.pathname === "/backfill/start" || u.pathname === "/backfill/stop") {
      if (!env.RUN_SECRET) return json({ ok: false, error: "Für die Importsteuerung RUN_SECRET als Worker-Secret einrichten." }, 503);
      if (request.headers.get("x-run-secret") !== env.RUN_SECRET) return json({ ok: false, error: "Unauthorized" }, 401);
      if (u.pathname !== "/backfill/status" && request.method !== "POST") return json({ ok: false, error: "POST erforderlich" }, 405);
      if (u.pathname === "/backfill/status" && request.method !== "GET") return json({ ok: false, error: "GET erforderlich" }, 405);
      try {
        if (u.pathname === "/backfill/status") return json({ ok: true, version: VERSION, ...parseBackfillControl((await getGithubJSONStrict(env, PATCH_BACKFILL_PATH, { allowMissing: true })).data) });
        return json({ ok: true, version: VERSION, ...(await setBackfillControl(env, u.pathname === "/backfill/start" ? "running" : "paused")) });
      } catch (e) { return json({ ok: false, error: e.message }, 500); }
    }
    if (u.pathname === "/preview") {
      try {
        const items = await fetchRSIItems();
        return json({ ok: true, source: COMM_LINK_URL, count: items.length, items });
      } catch (e) {
        return json({ ok: false, error: e.message }, 502);
      }
    }
    if (u.pathname === "/preview/news") {
      try {
        const result = await buildNews(env);
        return json({ ok: true, count: result.news.length, fetchedItems: result.fetchedItems, newItems: result.newItems, refreshedItems: result.refreshedItems, aiItems: result.aiItems, published: false, items: result.news });
      } catch (e) {
        return json({ ok: false, error: e.message }, 502);
      }
    }
    if (u.pathname === "/preview/patches") {
      try {
        // Use the same transformation as /run, but never write GitHub here.
        const result = await updatePatches(env);
        if (u.searchParams.get("diagnostic") === "1") {
          return json({ ok: true, version: VERSION, published: false,
            count: result.patches.length, newItems: result.newItems,
            scannedPages: result.scannedPages, nextPage: result.nextState.nextPage,
            backfillComplete: result.nextState.complete, pageDiagnostics: result.pageDiagnostics,
            patchAutoPublishEnabled: env.PATCH_AUTO_PUBLISH === "true",
            deferredSeedItems: result.deferredSeedItems,
            deferredPageItems: result.deferredPageItems,
            historicalCandidates: result.historicalCandidates,
            historicalDeferredItems: result.historicalDeferredItems,
            historicalUnusableItems: result.historicalUnusableItems,
            historicalDiagnostics: result.historicalDiagnostics,
            seedDiagnostics: result.seedDiagnostics });
        }
        return json({
          ok: true,
          source: PATCH_NOTES_URL,
          count: result.patches.length,
          newItems: result.newItems,
          aiItems: result.aiItems,
          scannedPages: result.scannedPages,
          nextPage: result.nextState.nextPage,
          backfillComplete: result.nextState.complete,
          deferredSeedItems: result.deferredSeedItems,
          deferredPageItems: result.deferredPageItems,
          historicalCandidates: result.historicalCandidates,
          historicalDeferredItems: result.historicalDeferredItems,
          historicalUnusableItems: result.historicalUnusableItems,
          published: false,
          pageDiagnostics: result.pageDiagnostics,
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
          if (Array.isArray(patches)) return new Response(JSON.stringify(patches, null, 2), { headers: { "content-type": "application/json;charset=utf-8", "cache-control": "no-store", "x-verse-radar-patches-source": "github" } });
        }
        if (env.ASSETS) {
          const asset = await env.ASSETS.fetch(new Request(new URL("/data/patches.json", u.origin), request));
          return new Response(await asset.text(), { status: asset.status, headers: { "content-type": "application/json;charset=utf-8", "cache-control": "no-store, no-cache, must-revalidate", "x-verse-radar-patches-source": "static-fallback" } });
        }
        return json([]);
      } catch (e) { return json({ ok: false, error: e.message }, 500); }
    }
    if (u.pathname === "/run" || u.pathname === "/run/news" || u.pathname === "/run/patches") {
      if (env.RUN_SECRET && u.searchParams.get("key") !== env.RUN_SECRET) return json({ ok: false, error: "Unauthorized" }, 401);
      try { return json(await updateSite(env, { includeNews: u.pathname !== "/run/patches", includePatches: u.pathname !== "/run/news" })); } catch (e) { return json({ ok: false, error: e.message }, 500); }
    }
    if (u.pathname === "/debug/github") {
      try {
        const d = await githubDiagnostics(env, "public/data/news.json");
        return json({ ok: true, version: VERSION, github: d });
      } catch (e) {
        return json({ ok: false, version: VERSION, error: e.message }, 500);
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
    return new Response(`Verse Radar ${VERSION}`, { headers: { "content-type": "text/plain;charset=utf-8" } });
  },
  async scheduled(event, env, ctx) {
    if (event?.cron === PATCH_BACKFILL_CRON) {
      await runBackfillTick(env);
      return;
    }
    // Both data types require a reviewed preview before scheduled publishing.
    const includeNews = env.NEWS_AUTO_PUBLISH === "true";
    const includePatches = env.PATCH_AUTO_PUBLISH === "true";
    if (includeNews || includePatches) ctx.waitUntil(updateSite(env, { includeNews, includePatches }));
  }
};

const json = (x, s = 200) => new Response(JSON.stringify(x, null, 2), { status: s, headers: { "content-type": "application/json;charset=utf-8", "cache-control": "no-store" } });

function parseBackfillControl(data) {
  if (data == null) return { status: "paused", lastRun: null };
  if (!data || !["running", "paused", "completed"].includes(data.status)) throw Error("Importsteuerung ungültig; automatischer Import angehalten.");
  return data;
}

async function setBackfillControl(env, status) {
  if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) throw Error("GitHub-Konfiguration fehlt; automatischer Import nicht gestartet.");
  for (let attempt = 0; attempt < 3; attempt++) {
    const latest = await getGithubJSONStrict(env, PATCH_BACKFILL_PATH, { allowMissing: true });
    const current = parseBackfillControl(latest.data);
    const next = { ...current, status, sessionId: crypto.randomUUID(), leaseId: null, leaseUntil: null,
      lastError: status === "running" ? null : current.lastError ?? null, changedAt: new Date().toISOString() };
    try {
      await putGithub(env, PATCH_BACKFILL_PATH, JSON.stringify(next, null, 2) + "\n", `Verse Radar ${VERSION}: ${status} patch backfill`, latest.sha);
      return next;
    } catch (e) { if (e.status !== 409 || attempt === 2) throw e; }
  }
}

async function finishBackfillTick(env, sessionId, leaseId, result, error) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const latest = await getGithubJSONStrict(env, PATCH_BACKFILL_PATH);
    const current = parseBackfillControl(latest.data);
    if (current.status !== "running" || current.sessionId !== sessionId || current.leaseId !== leaseId) return;
    const complete = !error && result.patchBackfillComplete && result.patchHistoricalMissingItems === 0 &&
      result.patchDeferredSeedItems === 0 && result.patchDeferredPageItems === 0;
    const missingAtEnd = !error && result.patchBackfillComplete && result.patchHistoricalDeferredItems === 0 &&
      result.patchHistoricalMissingItems > 0;
    const reason = error?.message || (result.patchHistoricalUnusableItems > 0
      ? `${result.patchHistoricalUnusableItems} historische Quelle(n) unbrauchbar; bitte prüfen.`
      : missingAtEnd ? `${result.patchHistoricalMissingItems} historische Version(en) fehlen; bitte prüfen.` : null);
    const next = { ...current, status: complete ? "completed" : reason ? "paused" : "running",
      leaseId: null, leaseUntil: null, changedAt: new Date().toISOString(), lastError: reason,
      lastRun: result ? { at: result.updatedAt, patchItems: result.patchItems,
        newItems: result.patchNewItems, nextPage: result.patchNextPage,
        backfillComplete: result.patchBackfillComplete, historicalMissingItems: result.patchHistoricalMissingItems,
        historicalDeferredItems: result.patchHistoricalDeferredItems,
        historicalUnusableItems: result.patchHistoricalUnusableItems,
        historicalUnusableVersions: result.patchHistoricalUnusableVersions } : current.lastRun };
    try {
      await putGithub(env, PATCH_BACKFILL_PATH, JSON.stringify(next, null, 2) + "\n", `Verse Radar ${VERSION}: patch backfill progress`, latest.sha);
      return;
    } catch (e) { if (e.status !== 409 || attempt === 2) throw e; }
  }
}

async function runBackfillTick(env) {
  if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) return;
  const latest = await getGithubJSONStrict(env, PATCH_BACKFILL_PATH, { allowMissing: true });
  const control = parseBackfillControl(latest.data);
  if (control.status !== "running" || (control.leaseUntil && Date.parse(control.leaseUntil) > Date.now())) return;
  const leaseId = crypto.randomUUID();
  const locked = { ...control, leaseId, leaseUntil: new Date(Date.now() + PATCH_BACKFILL_LEASE_MS).toISOString() };
  try {
    await putGithub(env, PATCH_BACKFILL_PATH, JSON.stringify(locked, null, 2) + "\n", `Verse Radar ${VERSION}: claim patch backfill`, latest.sha);
  } catch (e) {
    if (e.status === 409) return; // Another cron invocation already owns this batch.
    throw e;
  }
  let result = null;
  let error = null;
  try {
    result = await updateSite(env, { includeNews: false, includePatches: true });
    if (!result.published) throw Error("GitHub-Veröffentlichung fehlgeschlagen; Import angehalten.");
  } catch (e) { error = e; }
  await finishBackfillTick(env, control.sessionId, leaseId, result, error);
  if (error) throw error;
}

function backfillPage() {
  return new Response(`<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Verse Radar · Patch-Archiv</title>
<style>body{max-width:650px;margin:4rem auto;padding:0 1rem;background:#09141c;color:#eef5f4;font:16px/1.5 system-ui}h1{font-size:1.8rem}input,button{padding:.75rem;border-radius:.5rem;border:1px solid #62948d;font:inherit}input{background:#101f29;color:white;max-width:100%;width:22rem}button{cursor:pointer;background:#315e57;color:white;margin:.6rem .6rem 0 0}button:hover{background:#40796f}pre{white-space:pre-wrap;word-break:break-word;background:#101f29;border-radius:.6rem;padding:1rem}</style>
<h1>Patch-Archiv automatisch füllen</h1><p>Start führt etwa alle zwei Minuten einen Importblock aus. Bei einem Fehler hält der Import an. Der Status bleibt nach dem Schließen der Seite erhalten.</p>
<label for="secret">RUN_SECRET</label><br><input id="secret" type="password" autocomplete="off" placeholder="Worker-Secret eingeben"><br><button id="start">Starten</button><button id="stop">Anhalten</button><button id="refresh">Status prüfen</button>
<pre id="status">Secret eingeben und „Status prüfen“ wählen.</pre><script>
const secret=document.getElementById('secret'),out=document.getElementById('status');
async function call(action){if(!secret.value){out.textContent='Bitte zuerst RUN_SECRET eingeben.';return}try{const response=await fetch('/backfill/'+action,{method:action==='status'?'GET':'POST',headers:{'x-run-secret':secret.value}});const data=await response.json();out.textContent=JSON.stringify(data,null,2)}catch(error){out.textContent=error.message}}
for(const action of ['start','stop','status'])document.getElementById(action==='status'?'refresh':action).addEventListener('click',()=>call(action));
</script></html>`, { headers: { "content-type": "text/html;charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" } });
}

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
          "user-agent": "Verse-Radar/0.7.0 (+independent fan site)",
          "accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
          "accept-language": "en-US,en;q=0.9,de;q=0.8"
        }
      });
      const html = await r.text();
      const parsed = r.ok ? parseCommLink(html) : { candidates: 0, items: [] };
      diagnostics.push({ source: url, httpStatus: r.status, htmlLength: html.length, candidates: parsed.candidates, parsedItems: parsed.items.length });
      if (r.ok && parsed.items.length) {
        const relevant = dedupeNewsItems(parsed.items.filter(x => relevantNewsTitle(x.title))).slice(0, MAX);
        if (relevant.length >= 3) return await enrichDates(relevant);
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
        "user-agent": "Verse-Radar/0.7.0 (+independent fan site)",
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
      const relevant = dedupeNewsItems(items.filter(x => relevantNewsTitle(x.title))).slice(0, MAX);
      if (relevant.length >= 3) return relevant;
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
  let date = record?.published_at ? validDate(record.published_at) : null;
  if (!date && record?.created_at) date = validDate(record.created_at);
  if (!date && record?.created_at_human) {
    const d = new Date(record.created_at_human);
    if (!Number.isNaN(d.getTime())) date = d.toISOString();
  }
  return {
    title,
    url,
    date: date || new Date().toISOString(),
    description: "",
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
      const r = await fetch(item.url, { headers: { "user-agent": "Verse-Radar/0.7.0 (+independent fan site)", "accept": "text/html,application/xhtml+xml" } });
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
      description: ""
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

function relevantNewsTitle(title) {
  // The archive can also contain internal asset names such as
  // R-PU-ORS-HeavyArmour-6; these are not editorial news articles.
  return validTitle(title) && !/^R-PU-ORS-/i.test(title) && RELEVANT.test(title);
}

function newsTitleKey(title) {
  return String(title || "").normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function dedupeNewsItems(items) {
  const urls = new Set();
  const titles = new Set();
  return items.filter(item => {
    const key = newsTitleKey(item.title);
    const url = item.url || item.sourceUrl;
    if (urls.has(url) || (!/^this week in star citizen$/i.test(key) && titles.has(key))) return false;
    urls.add(url);
    titles.add(key);
    return true;
  });
}

function isNewsPlaceholder(summary) {
  return !summary || strip(summary) === OLD_NEWS_PLACEHOLDER;
}

function fallbackNewsSummary(item) {
  const title = strip(item.title);
  let match;
  if (/^this week in star citizen$/i.test(title)) return "RSI veröffentlicht einen neuen Wochenüberblick zu Star Citizen. Die konkreten Themen stehen in der Originalmeldung.";
  if ((match = title.match(/^q\s*&\s*a:\s*(.+)$/i))) return `Fragen und Antworten zu ${match[1]}. Die einzelnen Aussagen stehen in der Originalmeldung.`;
  if (/^roadmap roundup/i.test(title)) return `RSI veröffentlicht „${title}“. Welche Punkte des Entwicklungsplans besprochen werden, steht in der Originalmeldung.`;
  if ((match = title.match(/^star citizen monthly report:\s*(.+)$/i))) return `Monatsbericht zur Entwicklung von Star Citizen für ${match[1]}. Die behandelten Arbeiten stehen in der Originalmeldung.`;
  if (/ship showdown.*winners/i.test(title)) return `RSI gibt in „${title}“ die Gewinner des Ship Showdown bekannt. Die Ergebnisse stehen in der Originalmeldung.`;
  if (/^star citizen alpha\s*\d/i.test(title)) return `Offizielle Mitteilung zu ${title}. Die konkreten Änderungen findest du in den verlinkten Patch Notes.`;
  if (/letter from the chairman/i.test(title)) return `Brief des Chairman unter dem Titel „${title}“. Den Wortlaut findest du in der Originalmeldung.`;
  if (/improving the live experience/i.test(title)) return `RSI informiert unter „${title}“ über die Live-Spielerfahrung. Einzelheiten stehen in der Originalmeldung.`;
  if (/free\s*fly/i.test(title)) return `RSI-Beitrag zu Free Fly: „${title}“. Termine und Bedingungen stehen in der Originalmeldung.`;
  if (/^aegis\s|^argo\s|^anvil\s|^kruger\s/i.test(title)) return `RSI-Beitrag über ${title}. Weitere Angaben stehen in der Originalmeldung.`;
  return `RSI-Beitrag mit dem Titel „${title}“. Die Einzelheiten stehen in der Originalmeldung.`;
}

function patchNewsSummary(item, patches) {
  const articleId = Number(item.sourceId || item.url?.match(/\/(\d+)-/)?.[1]);
  if (!articleId || !Array.isArray(patches)) return "";
  const patch = patches.find(x => x.summaryVersion === "0.6.8" && Number(x.sourceUrl?.match(/\/(\d+)-/)?.[1]) === articleId);
  if (!patch?.summary) return "";
  // Use only the beginning of the already reviewed patch summary on news cards.
  return patch.summary.split(/(?<=[.!?])\s+(?=[A-ZÄÖÜ])/u).slice(0, 2).join(" ").trim();
}

function extractDateFromSlug(url) {
  // Slugs normally do not contain dates, so return null here.  Actual article
  // dates are filled from the article page in the enrichment pass when needed.
  return null;
}

async function buildNews(env) {
  const items = await fetchRSIItems();
  if (items.length < 3) throw Error("Zu wenige redaktionelle Comm-Link-Beiträge erkannt; News-Import nicht veröffentlicht.");
  const existingData = env.GITHUB_TOKEN && env.GITHUB_REPO ? await readGithubJSON(env, "public/data/news.json", null) : [];
  if (!Array.isArray(existingData)) throw Error("Gespeicherte News aus GitHub nicht lesbar; News-Import sicherheitshalber abgebrochen.");
  const existing = existingData;
  const existingPatches = env.GITHUB_TOKEN && env.GITHUB_REPO ? await readGithubJSON(env, "public/data/patches.json", []) : [];
  const known = new Set(existing.map(x => x.id));
  const news = [];
  let aiCount = 0;
  let refreshedItems = 0;

  for (const item of items) {
    const id = hash(item.url);
    const old = existing.find(x => x.id === id);
    if (old && !isNewsPlaceholder(old.summary)) { news.push(old); continue; }
    if (old) refreshedItems++;
    const patchSummary = patchNewsSummary(item, existingPatches);
    let ai = null;
    if (env.OPENAI_API_KEY && !patchSummary) {
      try { ai = await summarize(item, env.OPENAI_API_KEY); aiCount++; } catch (_) {}
    }
    news.push({ id, title: ai?.title || item.title, category: ai?.category || classify(item.title), date: item.date, summary: patchSummary || ai?.summary || fallbackNewsSummary(item), sourceUrl: item.url, source: "RSI Comm-Link", ai: Boolean(ai), summaryBasis: patchSummary ? "Patch Notes" : ai ? "KI" : "Titel", summaryVersion: NEWS_SUMMARY_VERSION });
  }
  // Preserve older useful articles, but remove stale demo links, technical
  // archive records and the repeated placeholder from earlier imports.
  for (const old of existing) {
    if (news.some(n => n.id === old.id) || isNewsPlaceholder(old.summary) || !isArticleUrl(old.sourceUrl) || /^R-PU-ORS-/i.test(old.title || "")) continue;
    news.push(old);
  }
  news.sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));
  const finalNews = dedupeNewsItems(news).slice(0, 60);
  return { news: finalNews, fetchedItems: items.length, newItems: finalNews.filter(n => n.id && !known.has(n.id)).length, refreshedItems, aiItems: aiCount };
}

async function updateSite(env, { includeNews = true, includePatches = true } = {}) {
  const newsResult = includeNews ? await buildNews(env) : null;

  const patchResult = includePatches ? await updatePatches(env) : null;
  const now = new Date().toISOString();
  const automation = includeNews && includePatches ? "Cloudflare Worker + RSI Comm-Link + RSI Patch Notes" : includeNews ? "Cloudflare Worker + RSI Comm-Link; Patch-Import pausiert" : "Cloudflare Worker + RSI Patch Notes; News-Import pausiert";
  const meta = { updatedAt: now, source: COMM_LINK_URL, patchSource: PATCH_NOTES_URL, mode: env.GITHUB_TOKEN && env.GITHUB_REPO ? "live" : "preview", automation, version: VERSION, fetchedItems: newsResult?.fetchedItems ?? null, newItems: newsResult?.newItems ?? null, refreshedItems: newsResult?.refreshedItems ?? null, aiItems: newsResult?.aiItems ?? null, newsItems: newsResult?.news.length ?? null, patchItems: patchResult?.patches.length ?? null, patchNewItems: patchResult?.newItems ?? null, patchNextPage: patchResult?.nextState.nextPage ?? null, patchBackfillComplete: patchResult?.nextState.complete ?? null, patchDeferredSeedItems: patchResult?.deferredSeedItems ?? null, patchDeferredPageItems: patchResult?.deferredPageItems ?? null, patchHistoricalCandidates: patchResult?.historicalCandidates ?? null, patchHistoricalDeferredItems: patchResult?.historicalDeferredItems ?? null, patchHistoricalUnusableItems: patchResult?.historicalUnusableItems ?? null, patchHistoricalUnusableVersions: patchResult?.historicalDiagnostics.filter(item => !item.eligible).map(({ version, reason }) => ({ version, reason })) ?? null, patchHistoricalMissingItems: null, patchAiItems: patchResult?.aiItems ?? null };

  if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) {
    return { ok: true, version: VERSION, published: false, ...meta, note: "GitHub Secrets fehlen; nichts zurückgeschrieben." };
  }

  if (includePatches) {
    // Publish the archive before advancing its cursor. A failed cursor write
    // merely repeats a page; it can never skip unsaved older versions.
    const savedPatches = await publishPatchArchive(env, patchResult.patches);
    meta.patchItems = savedPatches.length;
    const storedVersions = new Set(savedPatches.map(p => patchKey(p.version)));
    meta.patchHistoricalMissingItems = HISTORICAL_VERSIONS.filter(v => !storedVersions.has(patchKey(`Alpha ${v}`))).length;
    await publishPatchCursor(env, patchResult.nextState);
  }
  if (includeNews) await putGithub(env, "public/data/news.json", JSON.stringify(newsResult.news, null, 2) + "\n", `Verse Radar ${VERSION}: update news`);
  await putGithub(env, "public/data/meta.json", JSON.stringify(meta, null, 2) + "\n", `Verse Radar ${VERSION}: update meta`);
  return { ok: true, version: VERSION, published: true, ...meta };
}

function validateArchiveEntries(entries) {
  if (!Array.isArray(entries) || entries.some(x => !x || typeof x.version !== "string" || !x.version || !x.sourceUrl)) throw Error("Gespeichertes Patch-Archiv ungültig; Import abgebrochen.");
  const keys = entries.map(x => patchKey(x.version));
  if (new Set(keys).size !== keys.length) throw Error("Doppelte Versionen im gespeicherten Patch-Archiv; Import abgebrochen.");
}

function correctLegacyLink(entry) {
  const key = patchKey(entry.version);
  const corrected = LEGACY_RELEASE_LINKS.get(key);
  return corrected && /\/Patch-Notes\//i.test(entry.sourceUrl)
    ? { ...entry, sourceUrl: corrected, sourceType: "Release Info" } : entry;
}

async function publishPatchArchive(env, proposed) {
  const path = "public/data/patches.json";
  for (let attempt = 0; attempt < 3; attempt++) {
    const latest = await getGithubJSONStrict(env, path);
    validateArchiveEntries(latest.data);
    // GitHub can change while the source pages are fetched. Keep every entry
    // currently in the repository, and append only genuinely new versions.
    const merged = new Map(latest.data.map(p => [patchKey(p.version), correctLegacyLink(p)]));
    for (const p of proposed) {
      const key = patchKey(p.version);
      if (!merged.has(key)) merged.set(key, p);
    }
    const sorted = [...merged.values()].sort(comparePatchVersionsDesc);
    const archive = sorted.map((p, i) => ({ ...p, previous: sorted[i + 1]?.version || null }));
    try {
      await putGithub(env, path, JSON.stringify(archive, null, 2) + "\n", `Verse Radar ${VERSION}: extend patch archive`, latest.sha);
      return archive;
    } catch (e) {
      if (e.status !== 409 || attempt === 2) throw e;
      await new Promise(resolve => setTimeout(resolve, 150 * (attempt + 1)));
    }
  }
}

async function publishPatchCursor(env, desired) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const latest = await getGithubJSONStrict(env, PATCH_STATE_PATH, { allowMissing: true });
    const current = parsePatchState(latest.data);
    // A second invocation may already have advanced the historical cursor.
    // A wrapped cursor (end of 3.x list -> start) must still be writable.
    const historicalNextIndex = current.historicalNextIndex === desired.historicalStartIndex
      ? desired.historicalNextIndex : current.historicalNextIndex;
    const next = { nextPage: Math.max(current.nextPage, desired.nextPage),
      complete: current.complete || desired.complete, historicalNextIndex };
    if (latest.data && current.nextPage === next.nextPage && current.complete === next.complete &&
        current.historicalNextIndex === next.historicalNextIndex) return;
    try {
      await putGithub(env, PATCH_STATE_PATH, JSON.stringify(next, null, 2) + "\n", `Verse Radar ${VERSION}: advance patch archive`, latest.sha);
      return;
    } catch (e) {
      if (e.status !== 409 || attempt === 2) throw e;
      await new Promise(resolve => setTimeout(resolve, 150 * (attempt + 1)));
    }
  }
}

async function updatePatches(env) {
  const connected = Boolean(env.GITHUB_TOKEN && env.GITHUB_REPO);
  const archive = connected ? await getGithubJSONStrict(env, "public/data/patches.json") : { data: [], sha: null };
  const stateFile = connected ? await getGithubJSONStrict(env, PATCH_STATE_PATH, { allowMissing: true }) : { data: null, sha: null };
  const existing = archive.data;
  validateArchiveEntries(existing);
  const state = parsePatchState(stateFile.data);
  const existingVersions = new Set(existing.map(x => patchKey(x.version)));
  const { items, scannedPages, nextState, pageDiagnostics, seedDiagnostics, deferredSeedItems, deferredPageItems, historicalCandidates, historicalDeferredItems, historicalUnusableItems, historicalDiagnostics } = await fetchPatchItems(state, existingVersions);
  const unique = dedupePatchItems(items).sort(comparePatchVersionsDesc);
  const byVersion = new Map(existing.map(x => [patchKey(x.version), correctLegacyLink(x)]));
  let aiItems = 0;

  for (let i = 0; i < unique.length; i++) {
    const item = unique[i];
    const key = patchKey(item.version);
    // Never replace a stored version because a later crawl has incomplete or
    // differently formatted source data.
    if (byVersion.has(key)) continue;
    let ai = null;
    if (env.OPENAI_API_KEY && item.content) {
      try { ai = await summarizePatch(item, null, env.OPENAI_API_KEY); aiItems++; } catch (_) {}
    }
    byVersion.set(key, {
      version: item.version,
      date: item.date,
      previous: null,
      summary: ai?.summary || item.fallbackSummary,
      changes: ai?.changes?.length ? ai.changes : buildPatchChanges(item),
      fullSummary: ai?.fullSummary || item.fallbackFullSummary,
      sourceUrl: item.sourceUrl,
      sourceType: item.sourceType || "Patch Notes",
      ai: Boolean(ai),
      summaryVersion: Object.hasOwn(HISTORICAL_SHORT_RELEASES, item.version) ? "0.9.9" : item.historical ? "0.9.6" : "0.6.8",
      note: item.sourceType === "Community Archive"
        ? "Deutsche Zusammenfassung einer archivierten Patchseite der Star Citizen Wiki; ein eigenständiger offizieller Patch-Notes-Link ist dort nicht belegt."
        : item.sourceType === "RSI Release Info"
        ? "Deutsche Zusammenfassung aus dem archivierten Patchtext; der Original-Link führt zu einer offiziellen RSI-Veröffentlichung."
        : item.sourceType === "Content Update"
        ? "Deutsche Zusammenfassung des nummerierten Content-Updates aus dem Community-Archiv; der Quelllink ist gekennzeichnet. Kein eigenständiger RSI-Patch-Notes-Link."
        : "Deutsche Zusammenfassung der offiziellen Patch Notes. Kein offizieller RSI-Text."
    });
  }
  const patches = [...byVersion.values()].sort(comparePatchVersionsDesc).map((p, i, all) => ({ ...p, previous: all[i + 1]?.version || null }));
  return { patches, items: unique, newItems: patches.length - existing.length, aiItems, scannedPages, nextState, pageDiagnostics, seedDiagnostics, deferredSeedItems, deferredPageItems, historicalCandidates, historicalDeferredItems, historicalUnusableItems, historicalDiagnostics, archiveSha: archive.sha, stateSha: stateFile.sha };
}

function parsePatchState(value) {
  if (value == null) return { nextPage: 1, complete: false, historicalNextIndex: 0 };
  if (!value || !Number.isSafeInteger(value.nextPage) || value.nextPage < 1 || typeof value.complete !== "boolean" ||
      (value.historicalNextIndex != null && (!Number.isSafeInteger(value.historicalNextIndex) || value.historicalNextIndex < 0)))
    throw Error("Patch-Archivstand ungültig; Import abgebrochen.");
  return { nextPage: value.nextPage, complete: value.complete,
    historicalNextIndex: value.historicalNextIndex ?? 0 };
}

async function fetchPatchItems(state, existingVersions) {
  const discovered = [];
  const scannedPages = [];
  const pageDiagnostics = [];
  const seedDiagnostics = [];
  let fetchedDetails = 0;
  let deferredPageItems = 0;
  let firstDeferredPage = null;
  let recognizedPatchNotes = 0;
  let historicalCandidates = 0;
  let historicalDeferredItems = 0;
  let historicalUnusableItems = 0;
  const historicalDiagnostics = [];
  const pages = state.complete ? [1] : [...new Set([1, ...Array.from({ length: PATCH_PAGES_PER_IMPORT }, (_, i) => state.nextPage + i)])];
  let lastPage = null;
  let reachedEnd = false;
  let firstPageIds = null;
  for (const page of pages) {
    if (lastPage !== null && page > lastPage) break;
    const apiUrl = `https://api.star-citizen.wiki/api/comm-links?page[size]=${PATCH_PAGE_SIZE}&page[number]=${page}&sort=-id`;
    const r = await fetch(apiUrl, { headers: { "user-agent": `Verse-Radar/${VERSION} (+independent fan site)`, "accept": "application/json" } });
    if (!r.ok) throw Error(`Patch-Quelle Seite ${page}: HTTP ${r.status}; Import abgebrochen.`);
    const body = await r.json();
    if (!Array.isArray(body?.data)) throw Error(`Patch-Quelle Seite ${page}: ungültige Antwort; Import abgebrochen.`);
    if (Number.isSafeInteger(body?.meta?.current_page) && body.meta.current_page !== page) throw Error(`Patch-Quelle Seite ${page}: falsche Seitennummer; Import abgebrochen.`);
    const records = body.data;
    if (Number.isSafeInteger(body?.meta?.last_page)) lastPage = body.meta.last_page;
    const pageIds = records.map(record => record?.id).filter(Boolean);
    if (page > 1 && records.length && JSON.stringify(pageIds) === JSON.stringify(firstPageIds)) {
      throw Error(`Patch-Quelle Seite ${page}: Paginierung wiederholt die erste Seite; Import abgebrochen.`);
    }
    if (page === 1) firstPageIds = pageIds;
    scannedPages.push(page);
    const alphaRecords = records.filter(record => /^Star Citizen Alpha/i.test(strip(record?.title || "")) || Number(record?.id) === 21070);
    pageDiagnostics.push({ page, records: records.length,
      firstId: pageIds[0] ?? null, lastId: pageIds[pageIds.length - 1] ?? null,
      sourceLastPage: lastPage,
      alphaRecords: alphaRecords.slice(0, 25).map(record => {
        const sourceUrl = String(record?.rsi_url || record?.url || "");
        return { id: record?.id ?? null, title: strip(record?.title || ""),
          channel: record?.channel ?? null, sourceUrl,
          accepted: /^Star Citizen Alpha \d+(?:\.\d+){1,2}(?:\.0)?(?:\s|:|$)/i.test(strip(record?.title || "")) &&
            /^https:\/\/robertsspaceindustries\.com\/(?:en\/)?comm-link\/Patch-Notes\/\d+-/i.test(sourceUrl) };
      }) });
    if (!records.length && page > 1) { reachedEnd = true; break; }
    for (const record of records) {
      const title = strip(record?.title || "");
      if (!/^Star Citizen Alpha \d+(?:\.\d+){1,2}(?:\.0)?(?:\s|:|$)/i.test(title)) continue;
      // Titles alone also match marketing transmissions such as Alpha 4.7.2.
      // Only a real RSI Patch-Notes URL qualifies for the patch archive.
      const sourceUrl = String(record?.rsi_url || record?.url || "");
      if (!sourceUrl) throw Error(`Patch-Quelle ID ${record?.id || "?"}: Original-URL fehlt; Import abgebrochen.`);
      if (!/^https:\/\/robertsspaceindustries\.com\/(?:en\/)?comm-link\/Patch-Notes\/\d+-/i.test(sourceUrl)) continue;
      const id = Number(record?.id); if (!id) continue;
      const version = normalizePatchVersion(title.replace(/^Star Citizen /i, "").trim());
      recognizedPatchNotes++;
      if (existingVersions.has(patchKey(version))) continue;
      if (fetchedDetails >= PATCH_DETAILS_PER_IMPORT) {
        deferredPageItems++;
        firstDeferredPage ??= page;
        continue;
      }
      fetchedDetails++;
      const date = validDate(record?.created_at) || validDate(record?.published_at) || new Date().toISOString();
      let content = cleanPatchText(extractPatchContent(record));
      if (content.length < 500) content = cleanPatchText(await fetchPatchDetail(id, content));
      if (content.length < 500) content = cleanPatchText(await fetchWikiUpdatePage(version, content));
      discovered.push({ version, date, sourceUrl, sourceId: id, content, fallbackSummary: fallbackPatchSummary(version, content), fallbackFullSummary: fallbackFullSummary(version, content) });
    }
  }
  if (!scannedPages.length || (scannedPages.length === 1 && !recognizedPatchNotes)) throw Error("Keine Patch Notes in der aktuellen Quelle erkannt; Import abgebrochen.");

  // RSI's patch index is sometimes only partially mirrored by the archive API.
  // Seed the current major patches so a temporary archive/index gap cannot hide them.
  let fetchedSeeds = 0;
  let deferredSeedItems = 0;
  for (const seed of [...PATCH_SEEDS].sort(comparePatchVersionsDesc)) {
    const already = discovered.some(x => x.version === seed.version);
    if (already) continue;
    if (existingVersions.has(patchKey(seed.version))) {
      seedDiagnostics.push({ version: seed.version, sourceId: seed.id, alreadyStored: true });
      continue;
    }
    if (fetchedSeeds >= PATCH_SEEDS_PER_IMPORT) {
      seedDiagnostics.push({ version: seed.version, sourceId: seed.id, deferred: true });
      deferredSeedItems++;
      continue;
    }
    fetchedSeeds++;
    const title = `Star Citizen ${seed.version}`;
    const sourceUrl = seed.sourceUrl || officialPatchUrl(seed.id, title);
    let content = seed.id ? cleanPatchText(await fetchPatchDetail(seed.id, "")) : "";
    if (!publishablePatch(seed.version, content)) {
      // A detail record may be long yet omit whole feature sections. Check
      // the full wiki update before deciding that a major patch is unusable.
      const wikiContent = cleanPatchText(await fetchWikiUpdatePage(seed.version, ""));
      if (publishablePatch(seed.version, wikiContent) || wikiContent.length > content.length) content = wikiContent;
    }
    seedDiagnostics.push({ version: seed.version, sourceId: seed.id, sourceContentLength: content.length,
      eligible: publishablePatch(seed.version, content),
      matchedChanges: Object.hasOwn(ARCHIVE_HIGHLIGHTS, seed.version)
        ? (archiveHighlights(seed.version, content) || []).map(change => change.title) : undefined });
    discovered.push({ version: seed.version, date: seed.date, sourceUrl, sourceType: seed.sourceType || "Patch Notes", sourceId: seed.id, content, fallbackSummary: fallbackPatchSummary(seed.version, content), fallbackFullSummary: fallbackFullSummary(seed.version, content) });
  }

  // The comm-link mirror assigns placeholder links to many 3.x notes. Read
  // the indexed wiki originals and publish only pages with a date and text.
  const historical = await listHistoricalPatches();
  historicalCandidates = historical.length;
  const discoveredKeys = new Set(discovered.map(item => patchKey(item.version)));
  let checked = 0;
  let lastCheckedIndex = historical.length ? state.historicalNextIndex % historical.length : 0;
  let firstDeferredIndex = null;
  let firstUnusableIndex = null;
  const historicalCursorIndex = lastCheckedIndex;
  // A previous run may have advanced past a rejected page. Retry that gap
  // before processing more older versions; stored entries are always skipped.
  const earlierMissing = historical.findIndex((patch, index) => index < historicalCursorIndex &&
    !existingVersions.has(patchKey(patch.version)) && !discoveredKeys.has(patchKey(patch.version)));
  const historicalStartIndex = earlierMissing < 0 ? historicalCursorIndex : earlierMissing;
  for (let offset = 0; offset < historical.length; offset++) {
    const index = (historicalStartIndex + offset) % historical.length;
    const patch = historical[index];
    if (existingVersions.has(patchKey(patch.version)) || discoveredKeys.has(patchKey(patch.version))) continue;
    if (checked >= HISTORICAL_PATCHES_PER_IMPORT) {
      historicalDeferredItems++;
      firstDeferredIndex ??= index;
      continue;
    }
    checked++;
    lastCheckedIndex = index;
    const item = await fetchHistoricalPatch(patch);
    const eligible = Boolean(item?.content && publishablePatch(item.version, item.content));
    historicalDiagnostics.push({ version: patch.version, eligible,
      sourceType: item?.sourceType || null, sourceContentLength: item?.content?.length || 0,
      sourceUrl: item?.sourceUrl || null,
      reason: eligible ? undefined : item?.unusableReason || "Patchtext nicht ausreichend auswertbar" });
    if (eligible) discovered.push(item);
    else { historicalUnusableItems++; firstUnusableIndex ??= index; }
  }

  if (!discovered.length && !existingVersions.size) throw Error("Keine Patch Notes erkannt.");
  // A title variant (e.g. "Alpha 4.8: Tactical Strike") is not a separate
  // predecessor of the same numbered release. Never publish empty source text
  // as a generic patch summary.
  const unique = dedupePatchItems(discovered).filter(item => publishablePatch(item.version, item.content)).sort(comparePatchVersionsDesc);
  if (!unique.length && !existingVersions.size) throw Error("Keine Patch Notes mit auswertbarem Quelltext erkannt.");
  const lastScanned = scannedPages[scannedPages.length - 1];
  const complete = !firstDeferredPage && (state.complete || reachedEnd || (lastPage !== null && lastScanned >= lastPage));
  const nextPage = firstDeferredPage || (complete ? Math.max(lastScanned, state.nextPage) : lastScanned + 1);
  return { items: unique, scannedPages, pageDiagnostics, seedDiagnostics, deferredSeedItems, deferredPageItems,
    historicalCandidates, historicalDeferredItems, historicalUnusableItems, historicalDiagnostics,
    nextState: { nextPage, complete,
      historicalStartIndex: historicalCursorIndex,
      historicalNextIndex: firstUnusableIndex ?? firstDeferredIndex ?? (historical.length ? (lastCheckedIndex + 1) % historical.length : 0) } };
}

function extractPatchContent(record) {
  const candidates = [
    record?.translations?.en_EN,
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
      headers: { "user-agent": "Verse-Radar/0.7.0 (+independent fan site)", "accept": "application/json" }
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
        headers: { "user-agent": "Verse-Radar/0.7.0 (+independent fan site)", "accept": "application/json" }
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
      const r = await fetch(url, { headers: { "user-agent": "Verse-Radar/0.7.0 (+independent fan site)", "accept": "text/html,application/xhtml+xml" } });
      if (!r.ok) continue;
      const html = await r.text();
      const main = html.match(/<main[\s\S]*?<\/main>/i)?.[0] || html.match(/<article[\s\S]*?<\/article>/i)?.[0] || html;
      const text = cleanPatchText(strip(main));
      if (text.length > current.length) return text;
    } catch (_) {}
  }
  return current;
}

function listHistoricalPatches() {
  if (!HISTORICAL_PATCHES_PER_IMPORT) return [];
  return HISTORICAL_VERSIONS.map(version => ({ title: `Update:Star Citizen Alpha ${version}`,
    version: `Alpha ${version}` })).sort(comparePatchVersionsDesc);
}

async function fetchHistoricalPatch(patch) {
  if (patch.version === "Alpha 3.17.2a") return fetchHistorical3172a();
  const api = new URL("https://starcitizen.tools/api.php");
  for (const [key, value] of Object.entries({ action: "parse", page: patch.title,
    prop: "text", format: "json" })) api.searchParams.set(key, value);
  const response = await fetch(api.toString(), { headers: { "user-agent": `Verse-Radar/${VERSION} (+independent fan site)`, "accept": "application/json" } });
  if (!response.ok) return { unusableReason: `Wiki-Detail HTTP ${response.status}` };
  let body;
  try { body = await response.json(); } catch (_) { return { unusableReason: "Wiki-Detail liefert kein JSON" }; }
  const html = body?.parse?.text?.["*"];
  if (typeof html !== "string") return { unusableReason: `Wiki-Detail ohne Patchtext${body?.error?.code ? ` (${body.error.code})` : ""}` };
  if (body.parse.title && body.parse.title.replace(/_/g, " ") !== patch.title) return { unusableReason: "Wiki-Detail verweist auf andere Version" };
  const raw = strip(html);
  const dateMatch = raw.match(/\bbuild\s+released\s+on\s*(\d{4}-\d{2}-\d{2})\b/i)
    || raw.match(/\bReleased\s+(\d{4}-\d{2}-\d{2})\b/i);
  const date = dateMatch && validDate(dateMatch[1]);
  if (!date) return { unusableReason: "Erscheinungsdatum im Wiki-Detail nicht erkennbar" };
  const wikiUrl = `https://starcitizen.tools/${patch.title.replace(/ /g, "_")}`;
  const sourceUrl = HISTORICAL_SHORT_RELEASES[patch.version]?.sourceUrl || historicalOfficialLink(html) || wikiUrl;
  const sourceType = /\/spectrum\/community\/SC\/forum\/190048\/thread\//i.test(sourceUrl) || /\/comm-link\/Patch-Notes\/\d+-/i.test(sourceUrl) ? "Patch Notes" :
    /\/comm-link\/transmission\/\d+-/i.test(sourceUrl) ? "RSI Release Info" : "Community Archive";
  const content = cleanPatchText(raw);
  return { version: patch.version, date, sourceUrl, sourceType, historical: true,
    sourceId: Number(html.match(/api\.star-citizen\.wiki\/comm-links\/(\d+)/i)?.[1] || 0),
    content, fallbackSummary: fallbackPatchSummary(patch.version, content),
    fallbackFullSummary: fallbackFullSummary(patch.version, content) };
}

async function fetchHistorical3172a() {
  const version = "Alpha 3.17.2a";
  // This hotfix has an RSI Spectrum patch-note thread and an archived
  // comm-link record, but no separate Wiki Update page in the category.
  const sourceUrl = "https://robertsspaceindustries.com/spectrum/community/SC/forum/190048/thread/star-citizen-alpha-3-17-2a-live-8186206-patch-note";
  let content = cleanPatchText(await fetchPatchDetail(18804, ""));
  const nextPatch = content.search(/back to top\s+star citizen patch 3\.17\.2\s+alpha patch 3\.17\.2\b/i);
  if (nextPatch > 0) content = content.slice(0, nextPatch).trim();
  if (!/\b3\.17\.2a\b/i.test(content)) return { unusableReason: "3.17.2a nicht eindeutig im Archivtext" };
  return { version, date: "2022-08-31T00:00:00.000Z", sourceUrl, sourceType: "Patch Notes",
    historical: true, sourceId: 18804, content,
    fallbackSummary: fallbackPatchSummary(version, content),
    fallbackFullSummary: fallbackFullSummary(version, content) };
}

function historicalOfficialLink(html) {
  for (const anchor of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    if (!/full patch notes/i.test(strip(anchor[2]))) continue;
    try {
      const url = new URL(anchor[1].replace(/&amp;/g, "&"), "https://starcitizen.tools");
      if (/^(?:www\.)?robertsspaceindustries\.com$/i.test(url.hostname) &&
          /^\/(?:en\/)?comm-link\/(?:Patch-Notes|transmission)\/\d+-/i.test(url.pathname)) return url.href;
    } catch (_) {}
  }
  return null;
}

function normalizePatchVersion(v) {
  const version = String(v || "").replace(/\s+/g, " ").trim();
  return /^Alpha 3\./i.test(version) ? version : version.replace(/\.0(?=\b)/g, "");
}
function officialPatchUrl(id, title) {
  const verifiedSlugs = new Map([[21070,"47"],[20969,"46"],[20934,"450"],[20899,"440"],[20852,"432"],[20777,"431"],[20728,"430"],[20702,"421"],[20638,"42"],[20598,"411"],[20522,"41"],[20445,"402"],[20418,"401"],[20360,"40"]]);
  if (verifiedSlugs.has(id)) return `https://robertsspaceindustries.com/en/comm-link/Patch-Notes/${id}-Star-Citizen-Alpha-${verifiedSlugs.get(id)}`;
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
function patchKey(version) {
  const numeric = versionParts(version).join(".");
  const suffix = String(version || "").match(/\d+(?:\.\d+){1,2}([a-z])\b/i)?.[1]?.toLowerCase() || "";
  return numeric + suffix;
}
function comparePatchVersionsDesc(a,b) {
  const av=versionParts(a.version), bv=versionParts(b.version);
  for(let i=0;i<3;i++){ if(av[i]!==bv[i]) return bv[i]-av[i]; }
  const as = patchKey(a.version).match(/[a-z]$/)?.[0] || "";
  const bs = patchKey(b.version).match(/[a-z]$/)?.[0] || "";
  if (as !== bs) return bs.localeCompare(as);
  return new Date(b.date)-new Date(a.date);
}
function dedupePatchItems(items) {
  const map = new Map();
  for (const item of items) {
    const key = patchKey(item.version);
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
// A keyword in later bug fixes does not mean that a feature was introduced again.
// These two named additions have a known first release in the available archive.
function debutedIn(version, feature) {
  return feature === "tactical-strike-group" ? version === "Alpha 4.8" :
         feature === "cq7-bullpup" ? version === "Alpha 4.9" : false;
}
function newGearMention(content) {
  return /new fps weapon|arlington rifle|vendetta hmg|super heavy armor/i.test(content);
}
function alpha47Content(version, content) {
  return version === "Alpha 4.7" && /operation breaker stations/i.test(content) &&
    /inventory rework/i.test(content) && /crafting, fabricator, and blueprints/i.test(content);
}
function alpha47Changes(content) {
  const changes = [];
  const add = (category, title, description, pattern) => {
    if (pattern.test(content)) changes.push({ category, title, description });
  };
  add("Missionen", "Operation Breaker Stations", "In Nyx werden QV Breaker Stations über Aufträge erschlossen: Kämpfe, Gefahren und Rätsel führen zu Rohstoffen im Asteroiden.", /operation breaker stations/i);
  add("Gameplay", "Inventar überarbeitet", "Zwei Inventarfenster, nahe Container als Tabs sowie Suche, Sortierung und Filter vereinfachen das Verwalten von Gegenständen.", /two-panel layout[\s\S]*nearby inventories[\s\S]*search, sort, and filter/i);
  add("Herstellung", "Crafting und Baupläne", "Mit dem Item Fabricator lassen sich Gegenstände anhand von Bauplänen und gesammelten Materialien herstellen.", /crafting, fabricator, and blueprints/i);
  add("Bergbau", "Materialqualität", "Abgebaute Rohstoffe erhalten Qualitätswerte; die Qualität eingesetzter Materialien beeinflusst die Werte hergestellter Gegenstände.", /material quality and mining updates/i);
  add("Schiffe & Fahrzeuge", "Aurora Mk II", "Die RSI Aurora Mk II wird als neues Schiff eingeführt.", /new ship:\s*rsi aurora mk ii/i);
  add("Schiffe & Fahrzeuge", "Schilde, Rüstung und Radar", "Schutzsysteme wurden neu abgestimmt; Radar-Komponenten und radarbasierte Zielhilfe kommen hinzu.", /shield balance[\s\S]*armor balance[\s\S]*radar-based aim assist/i);
  add("Orte", "Stationen in Nyx", "People's Service Stations bieten neue Anlaufstellen und können als Heimatort gewählt werden.", /people.s service stations/i);
  add("VR", "Experimentelle VR-Unterstützung", "Cursor, Oberfläche und Rendering für VR wurden weiterentwickelt.", /virtual reality updates/i);
  add("Technik", "Fehlerbehebungen", "Über 150 Fehler- und Absturzkorrekturen seit Alpha 4.6 sind dokumentiert.", /over 150 bug and crash fixes/i);
  return changes;
}
const ARCHIVE_HIGHLIGHTS = {
  "Alpha 4.6": {
    required: /clearing the air[\s\S]*light amplification system/i,
    changes: [
      ["Missionen","Clearing the Air", "Hilfseinsätze rund um eine Gesundheitskrise in Levski: Transporte, Beschaffung und Verteidigung.", /clearing the air/i],
      ["Schiffe & Fahrzeuge","LAMP", "Das Light Amplification System verbessert die Sicht bei wenig Licht.", /light amplification system/i],
      ["Schiffe & Fahrzeuge","Engineering und Rüstung", "Schiffstechnik und Rüstung erhalten Anpassungen im Gameplay.", /engineering and ship armor gameplay updates/i],
      ["Schiffe & Fahrzeuge","Aurora-Serie", "Die Aurora-Schiffe wurden überarbeitet.", /aurora series update/i],
      ["Gameplay","Kel-To-Versorgung", "Neue Versorgungskioske bieten Schiffsbesatzungen Werkzeug und Proviant.", /kel-to ship supply kiosks/i],
      ["VR","Experimentelle VR", "Die VR-Unterstützung erhält weitere Verbesserungen.", /virtual reality updates/i],
      ["Technik","Fehlerbehebungen", "Über 160 Fehler- und Absturzkorrekturen sind dokumentiert.", /over 160 bug and crash fixes/i]
    ]
  },
  "Alpha 4.5": {
    required: /engineering gameplay[\s\S]*virtual reality support \(experimental\)/i,
    changes: [
      ["Gameplay","Schiffs-Engineering", "Schiffssysteme lassen sich über ein Engineering-Terminal überwachen, reparieren und austauschen.", /engineering gameplay/i],
      ["Schiffe & Fahrzeuge","Schiffsrüstung", "Rüstung und Schutzsysteme wurden für das Engineering-Gameplay angepasst.", /ship armor/i],
      ["Gameplay","Brandgefahren", "Feuer an Bord ergänzt das Engineering-Gameplay.", /fire hazards/i],
      ["Gameplay","Loot und Raffinerie", "Beute und die Wirtschaft der Erzraffinierung wurden angepasst.", /loot refresh[\s\S]*ore refining economic balance/i],
      ["Inventar","Physische Helme", "Helme erhalten eine stärkere physische Einbindung.", /physicalized helmets/i],
      ["VR","Experimentelle VR", "Erste experimentelle VR-Unterstützung wurde eingeführt.", /virtual reality support \(experimental\)/i],
      ["Technik","Vulkan", "Grafikeinstellungen und Vulkan-Rendering wurden überarbeitet.", /vulkan graphics and settings overhaul/i],
      ["Technik","Fehlerbehebungen", "Über 150 Fehler- und Absturzkorrekturen sind dokumentiert.", /over 150 bug and crash fixes/i]
    ]
  },
  "Alpha 4.4": {
    required: /welcome to nyx[\s\S]*sworn enemies operation/i,
    changes: [
      ["Orte","Nyx, Levski und Delamar", "Nyx wird als drittes Sternensystem ergänzt; Levski und Delamar kehren zurück.", /welcome to nyx[\s\S]*return to levski/i],
      ["Missionen","Sworn Enemies", "Die Operation erweitert die Aufträge in Nyx.", /sworn enemies operation/i],
      ["Missionen","Interstellarer Transport", "Neue Frachtaufträge führen zwischen Sternensystemen.", /interstellar hauling/i],
      ["Missionen","Nyx Mission Pack", "Weitere Missionen erweitern das neue Sternensystem.", /nyx mission pack/i],
      ["Fracht","Externe Frachtaufzüge", "Stationen erhalten außenliegende Frachtaufzüge.", /external station freight elevators/i],
      ["Waffen","Neue FPS-Waffen", "TripleDown und Boomtube erweitern das Arsenal.", /tripledown[\s\S]*boomtube/i],
      ["Technik","Streaming und Performance", "Streaming und Umgebungsdarstellung wurden optimiert.", /streaming improvements[\s\S]*performance optimizations/i],
      ["Technik","Fehlerbehebungen", "Über 180 Fehler- und Absturzkorrekturen sind dokumentiert.", /over 180 bug and crash fixes/i]
    ]
  },
  "Alpha 4.3.2": {
    required: /yormandi encounter[\s\S]*structural salvage update/i,
    changes: [
      ["Missionen","Yormandi Encounter", "Eine neue Begegnung führt in die Onyx-Anlage und ihre unterirdischen Bereiche.", /yormandi encounter/i],
      ["Gameplay","Strukturelles Salvage", "Das Zerlegen von Schiffsstrukturen wurde überarbeitet.", /structural salvage update/i],
      ["Missionen","Frontier Fighters", "Die Auftragsreihe erhält ein Finale.", /frontier fighters finale/i],
      ["Schiffe & Fahrzeuge","Neue Schiffe", "Anvil Paladin, Esperia Stinger und Grey's Market Shiv werden ergänzt.", /anvil paladin[\s\S]*esperia stinger[\s\S]*grey.s market shiv/i],
      ["Waffen","Neue FPS-Waffen", "Killshot Rifle und Pulverizer LMG ergänzen das Arsenal.", /killshot rifle[\s\S]*pulverizer lmg/i],
      ["Technik","Fehlerbehebungen", "Etwa 130 Fehler- und Absturzkorrekturen sind dokumentiert.", /approximately 130 bug and crash fixes/i]
    ]
  },
  "Alpha 4.3.1": {
    required: /onyx facility expansion[\s\S]*medgel/i,
    changes: [
      ["Missionen","Onyx-Anlagen erweitert", "Neue Rätsel, Hindernisse und Gefechte führen tiefer in die Forschungseinrichtungen.", /onyx facility expansion/i],
      ["Medizin","MedGel", "Schiffs-Krankenbetten benötigen MedGel für Respawns und die Behandlung von Verletzungen.", /medgel - medical respawn resource/i],
      ["Gameplay","Dropships und Wachtürme", "In Pyro bringen Dropships Verstärkung; deaktivierte Wachtürme können sie aufhalten.", /dropships & watch towers/i],
      ["Schiffe & Fahrzeuge","Ballistik gegen Rüstung und Schilde", "Die Schadensreduktion von Schiffsrüstung und Schild wurde neu abgestimmt.", /armor and ballistic damage changes/i],
      ["Schiffe & Fahrzeuge","Gladius-Flugverhalten", "Beschleunigung und Steuerverhalten der Gladius wurden angepasst.", /gladius flight changes/i],
      ["Waffen","Raketenexplosionen", "Die Explosionsradien verschiedener Raketen wurden angepasst.", /missiles damage radius adjustments/i]
    ]
  },
  "Alpha 4.3": {
    required: /onyx facilities[\s\S]*dynamic snow/i,
    changes: [
      ["Missionen","Onyx-Anlagen", "Verlassene Forschungsanlagen bieten Ermittlungsaufträge mit Daten, Rätseln und Gefahren.", /onyx facilities/i],
      ["Missionen","Missionsverteilung", "Aufträge werden besser auf verfügbare Einsatzorte verteilt.", /mission distribution tech updates/i],
      ["Schiffe & Fahrzeuge","Leichte Jäger", "Die Flugbalance leichter Jäger wurde überarbeitet.", /light fighter flight tuning changes/i],
      ["Wetter","Dynamischer Schnee", "Schneefall reagiert an ausgewählten Orten auf das Wetter.", /dynamic snow/i],
      ["Gameplay","Leitern", "Neue Bewegungs- und Ausstiegsmöglichkeiten verbessern die Nutzung von Leitern.", /ladder improvements/i],
      ["Gameplay","Persönliche Hangars", "Am gewählten Heimatort erfolgt der Einstieg direkt im eigenen instanzierten Hangar.", /personal instanced hangar spawning/i],
      ["Technik","Fehlerbehebungen", "Rund 100 Korrekturen zu Problemen aus Alpha 4.2.1 sind dokumentiert.", /approximately 100 bugfixes/i]
    ]
  },
  "Alpha 4.2.1": {
    required: /resource drive[\s\S]*ship escort/i,
    changes: [
      ["Events","Resource Drive", "Ein zeitlich begrenztes Event erweitert die laufende Geschichte um die Regen-Krise.", /new time-limited event:\s*resource drive/i],
      ["Missionen","Schiffs-Eskorte", "Neue Aufträge drehen sich um die Begleitung bedrohter Schiffe.", /new mission type:\s*ship escort/i],
      ["Gameplay","Wikelo-Aufträge", "Rezepte und Belohnungen bei Wikelo wurden neu abgestimmt.", /wikelo recipe updates/i],
      ["Schiffe & Fahrzeuge","Flugverhalten", "Mehrere Schiffe erhalten Änderungen an ihrer Flugbalance.", /ship flight tuning changes/i],
      ["Waffen","VOLT Pulse", "Die VOLT Pulse Laser Pistol erweitert die FPS-Waffen.", /volt pulse laser pistol/i],
      ["Technik","Fehlerbehebungen", "Knapp 160 Korrekturen zu Problemen aus Alpha 4.2 sind dokumentiert.", /nearly 160 bugfixes/i]
    ]
  },
  "Alpha 4.2": {
    required: /storm breaker[\s\S]*new environmental hazard:\s*radiation/i,
    changes: [
      ["Gameplay","Storm Breaker", "Neue Sandbox-Orte um ASD-Forschung und Stürme erweitern die Regen-Krise.", /new persistent sandbox activity:\s*storm breaker/i],
      ["Orte","ASD-Anlagen", "Datenzentren, Shuttle-Stationen und Forschungseinrichtungen werden erkundbar.", /asd data centers[\s\S]*asd research facilities/i],
      ["Gameplay","Strahlung", "Gefährliche Strahlungszonen erfordern Schutzkleidung und angepasste Routen.", /new environmental hazard:\s*radiation/i],
      ["Wetter","Dynamischer Regen", "Regen reagiert an unterstützten Orten auf das Wetter.", /dynamic rain/i],
      ["Inventar","Ausrüstungstausch", "Beim Wechsel von Rüstung werden außen befestigte Gegenstände nach Möglichkeit übernommen.", /equipment swapping hierarchy/i],
      ["Schiffe & Fahrzeuge","Prowler Utility", "Der Esperia Prowler Utility ergänzt die Fahrzeugauswahl.", /prowler utility/i]
    ]
  },
  "Alpha 4.1.1": {
    required: /ship battle missions v1[\s\S]*hunt the polaris/i,
    changes: [
      ["Missionen","Schiffsgefechte", "Neue Patrouillen- und Gefechtsaufträge erweitern den Raumkampf.", /ship battle missions v1/i],
      ["Missionen","Hunt the Polaris", "Eine serverweite Mission führt auf die Jagd nach einer gestohlenen Polaris.", /hunt the polaris/i],
      ["Orte","Asteroiden-Basen", "Neue Bergbau-Basen in Asteroidenfeldern dienen als Schauplätze für Missionen.", /asteroid cluster mining base/i],
      ["Gameplay","Quantum-Reise zum eigenen Schiff", "Spieler können ein verlassenes, noch funktionsfähiges eigenes Schiff direkt als Reiseziel wählen.", /unattended vehicle quantum travel/i],
      ["Fracht","ARGO RAFT", "Die Frachtkapazität der RAFT steigt durch ein neues Raster auf 192 SCU.", /argo raft cargo improvements/i],
      ["Schiffe & Fahrzeuge","Großschiffe", "Die Flugbalance von Polaris, 890 Jump und Reclaimer wurde angepasst.", /capital ship flight adjustments/i]
    ]
  },
  "Alpha 4.1": {
    required: /align\s*&\s*mine[\s\S]*drake golem/i,
    changes: [
      ["Gameplay","Align & Mine", "Eine neue dauerhafte Sandbox-Aktivität verbindet Ausrichtung und Bergbau.", /align\s*&\s*mine/i],
      ["Orte","Hathor-Anlagen", "Neue Alignment-Anlagen und Orbitalplattformen kommen hinzu.", /hathor[\s\S]*orbital platforms/i],
      ["Gameplay","Bergbau und Item Recovery", "Bodenfahrzeug- und FPS-Bergbau sowie Item Recovery erhalten neue Funktionen.", /ground vehicle[\s\S]*fps mining updates/i],
      ["Schiffe & Fahrzeuge","Neue Fahrzeuge", "Drake Golem und Argo ATLS GEO ergänzen die Auswahl.", /drake golem[\s\S]*argo atls geo/i],
      ["Waffen","VOLT Parallax", "Das VOLT Parallax-Gewehr erweitert das Arsenal.", /volt[\s\S]*parallax/i],
      ["Technik","Streaming", "Streaming und Verzögerungen im Spielbetrieb wurden überarbeitet.", /streaming radius improvements/i]
    ]
  },
  "Alpha 4.0.2": {
    required: /supply or die[\s\S]*courier missions/i,
    changes: [
      ["Events","Supply or Die", "Das Pyro-Event ergänzt die laufenden Inhalte.", /supply or die/i],
      ["Missionen","Kurieraufträge in Pyro", "Kuriermissionen werden im Pyro-System aktiviert.", /courier missions in pyro/i],
      ["Orte","Nacht und Außenposten", "Nächtliche Sichtbarkeit und Performance an Orten in Pyro wurden verbessert.", /planetary night brightness[\s\S]*pyro outposts/i],
      ["Technik","Stabilität", "Verbindung, Aufzüge und allgemeine Stabilität stehen im Fokus.", /connectivity\/stability[\s\S]*elevator behavior/i]
    ]
  },
  "Alpha 4.0.1": {
    required: /contested zone polish[\s\S]*frontier outpost polish/i,
    changes: [
      ["Orte","Contested Zones", "Darstellung, Beleuchtung und Performance der umkämpften Zonen wurden verbessert.", /contested zone polish/i],
      ["Orte","Pyro-Außenposten", "Inventare und Darstellung der Frontier Outposts wurden korrigiert.", /frontier outpost polish/i],
      ["Orte","New Babbage", "Beleuchtung und Performance der Stadt wurden überarbeitet.", /new babbage polish/i],
      ["Schiffe & Fahrzeuge","Schiffsabstimmung", "Starfighter Ion, Mirai Guardian und Anvil Ballista erhalten Anpassungen.", /starfighter ion[\s\S]*mirai guardian[\s\S]*anvil ballista/i],
      ["Gameplay","Geschütze und Kopfgelder", "Stationsgeschütze wurden gestärkt, mehrere Kopfgeldbelohnungen angepasst.", /station turrets aiming prediction[\s\S]*bounty missions/i]
    ]
  },
  "Alpha 4.0": {
    // The mirror detail for 20360 omits entire feature sections. These five
    // points were checked against the full 4.0 wiki patch page and RSI link.
    required: /full wipe[\s\S]*server meshing/i,
    verifiedStatic: true,
    changes: [
      ["Orte","Pyro-System", "Mit Pyro kommt ein zweites Sternensystem hinzu.", /pyro/i],
      ["Gameplay","Contested Zones", "Stationen in Pyro erhalten umkämpfte FPS-Zonen mit Fortschritt und Beute.", /pyro/i],
      ["Bergbau","Rohstoffe in Pyro", "Pyro ergänzt neue abbaubare Ressourcen und eigene Verteilungen.", /pyro/i],
      ["Technik","Server Meshing", "Die erste statische Server-Meshing-Version verteilt einen Shard auf mehrere Server.", /server meshing/i],
      ["Gameplay","Vollständiger Reset", "Der Übergang auf Alpha 4.0 setzt Fortschritt und Guthaben zurück.", /full wipe/i]
    ]
  },
  "Alpha 4.8.2": {
    required: /new ships and many bugfixes[\s\S]*characters being unstowed/i,
    changes: [
      ["Schiffe & Fahrzeuge","Neue Schiffe", "Das Content-Update kündigt weitere Schiffe für das Live-Spiel an.", /new ships and many bugfixes/i],
      ["Technik","Charakterzustand", "Probleme mit festhängenden und nicht korrekt geladenen Charakteren werden bearbeitet.", /characters being unstowed/i],
      ["Missionen","Eskortaufträge", "Ein Fehler mit Hangartoren bei Eskortmissionen wird adressiert.", /escort missions/i]
    ]
  },
  "Alpha 4.7.2": {
    required: /nyx mission pack 2[\s\S]*delivery:\s*courier/i,
    changes: [
      ["Missionen","Nyx Mission Pack 2", "Neue Verträge erweitern Nyx und Stanton.", /nyx mission pack 2/i],
      ["Missionen","Kurier und Bergung", "Aufträge für Zustellungen und die Rückholung verlorener Fracht kommen hinzu.", /delivery:\s*courier[\s\S]*delivery:\s*recover cargo/i],
      ["Missionen","Schiffskampf", "Gegnerwellen und Kopfgeldaufträge erweitern den Raumkampf.", /ship wave attack[\s\S]*bounty \(kill ship\)/i],
      ["Missionen","Bombing Run", "Bombardierungsaufträge kehren zurück.", /bombing run/i],
      ["Bergung","Paid Salvage", "Bezahlte legale Bergungsaufträge werden angeboten.", /paid salvage/i]
    ]
  },
  "Alpha 4.7.1": {
    required: /new ship:\s*misc hull b[\s\S]*greycat utv/i,
    changes: [
      ["Schiffe & Fahrzeuge","MISC Hull B", "Der Frachter mit ausfahrbarer Frachtstruktur kommt ins Spiel.", /new ship:\s*misc hull b/i],
      ["Schiffe & Fahrzeuge","Greycat UTV", "Ein neues zweisitziges Nutzfahrzeug kann kleine Frachtkisten transportieren.", /new vehicle:\s*greycat utv/i],
      ["Bergbau","Breaker Stations", "Vorkommen und Qualität von Savrillium werden angepasst.", /breaker stations updates/i],
      ["Technik","Abstürze und Fehler", "Mehrere Client- und Serverabstürze wurden behoben.", /fixed 9 client crashes[\s\S]*fixed 14 server/i]
    ]
  }
};
function archiveHighlights(version, content) {
  const spec = ARCHIVE_HIGHLIGHTS[version];
  if (!spec || !spec.required.test(content)) return null;
  if (spec.verifiedStatic && !/pyro/i.test(content)) return null;
  return spec.changes.filter(([, , , pattern]) => pattern.test(content))
    .map(([category,title,description]) => ({category,title,description}));
}
function historicalPatchChanges(content, version = "") {
  const shortRelease = HISTORICAL_SHORT_RELEASES[version];
  if (shortRelease) {
    if (!shortRelease.marker.test(content)) return [];
    return shortRelease.changes.filter(([, , , pattern]) => pattern.test(content))
      .map(([category, title, description]) => ({ category, title, description }));
  }
  if (version === "Alpha 3.17.2a") {
    const fixes = [
      ["Missionen", "Combat Assistance Beacons", "Häufigkeit, Schwierigkeit und Bezahlung der Kampfhilfe-Aufträge wurden angepasst.", /combat assistance service beacons/i],
      ["Gameplay", "Shop-Kioske", "Die MAX-Schaltfläche an Shop-Kiosken wurde durch eine +10-Schaltfläche ersetzt.", /max button on shop kiosks to \+10/i],
      ["Schiffe & Fahrzeuge", "Esperia Blade", "Die Trefferpunkte mehrerer Bauteile der Esperia Blade wurden reduziert.", /reduced the hp of multiple parts on the esperia blade/i],
      ["Technik", "Fehlerbehebungen", "Die Notizen dokumentieren Korrekturen an Aufzügen, Missionen und Client- sowie Serverabstürzen.", /major bug fixes[\s\S]*client crashes[\s\S]*server crashes/i]
    ];
    return fixes.filter(([, , , pattern]) => pattern.test(content))
      .map(([category, title, description]) => ({ category, title, description }));
  }
  const main = content.match(/features and gameplay[\s\S]*?(?=bug fixes|technical updates|known issues|$)/i)?.[0] || content;
  const rules = [
    ["Gameplay", "Bergbau", "Bergbau und Rohstoffgewinnung werden erweitert oder angepasst.", /\bmining gameplay\b|\bnew mining\b|\bmining v2\b/i],
    ["Gameplay", "Salvage", "Bergung und Verwertung von Schiffswracks werden erweitert.", /\bstructural salvage\b|\bsalvage gameplay\b|\bvehicle salvage\b/i],
    ["Gameplay", "Schiff zu Schiff betanken", "Schiffe können andere Schiffe direkt mit Treibstoff versorgen.", /\bship.to.ship refueling\b|\brefueling gameplay\b/i],
    ["Gameplay", "Bergbau-Werkzeuge", "Neue Werkzeuge oder Anbauteile erweitern den Bergbau.", /\bmining gadgets\b|\bmining modules\b/i],
    ["Gameplay", "Gegenstände verkaufen", "Gesammelte Gegenstände können an Shops verkauft werden.", /\bsell items\b|\bselling items\b/i],
    ["Gameplay", "Fracht und Hangars", "Frachtverwaltung und persönliche Hangars werden überarbeitet.", /\bpersistent hangars\b|\bpersonal hangars\b|\bfreight elevator\b|\bcargo hauling\b/i],
    ["Schiffe & Fahrzeuge", "Master Modes", "Das Flug- und Kampfverhalten der Schiffe erhält die Master Modes.", /\bmaster modes\b/i],
    ["Technik", "Persistent Entity Streaming", "Gegenstände und Veränderungen werden durch Persistent Entity Streaming dauerhaft gespeichert.", /\bpersistent entity streaming\b/i],
    ["Technik", "Server Crash Recovery", "Nach Serverfehlern wird die Spielsitzung wiederhergestellt.", /\bserver crash recovery\b/i],
    ["Technik", "Object Container Streaming", "Object Container Streaming verbessert das Nachladen von Spielinhalten.", /\bobject container streaming\b/i],
    ["Technik", "Vulkan-Grafik", "Vulkan ergänzt die Grafikschnittstellen des Spiels.", /\bvulkan renderer\b|\bvulkan graphics\b/i],
    ["Gameplay", "Inventar", "Der Zugriff auf Inventar und Ausrüstung wird angepasst.", /\bpersonal inventory\b|\bphysicalized inventory\b|\binventory rework\b/i],
    ["Charakter", "Charaktereditor", "Mehr Gesichter, Frisuren oder Anpassungen für eigene Figuren werden ergänzt.", /\bcharacter creator dna\b|\bcharacter customizer\b|\bnew hair and beard styles\b/i],
    ["Schiffe & Fahrzeuge", "Schiffsanzeigen", "HUD und Multifunktionsanzeigen der Schiffe werden überarbeitet.", /\bvehicle hud\b.{0,20}\bmfd\b|\bmfd.*rework\b/i],
    ["Schiffe & Fahrzeuge", "Zeus Mk II", "Die Zeus Mk II wird als neues Schiff ergänzt.", /\badded new ships[\s\S]{0,150}\bzeus mk ii\b/i],
    ["Schiffe & Fahrzeuge", "Quantum-Reisen", "Tempo, Treibstoffverbrauch oder Bedienung der Quantum-Reise werden angepasst.", /\bquantum travel polish\b|\bquantum travel update\b/i],
    ["Orte", "Neue Höhlen", "Neue Höhlentypen erweitern erkundbare Schauplätze.", /\bnew caves\b|\bcave system archetypes\b/i],
    ["Orte", "Hurston", "Hurston und seine Monde erweitern das Stanton-System.", /\bhurston and its moons\b|\bhurston moons\b/i],
    ["Orte", "ArcCorp", "ArcCorp ergänzt weitere Landeflächen und Orte.", /\barccorp and its moons\b|\bplanet arccorp\b/i],
    ["Orte", "MicroTech", "MicroTech erweitert die begehbaren Planeten in Stanton.", /\bmicrotech planet\b|\bplanet microtech\b/i],
    ["Orte", "Crusader", "Crusader und Orison erweitern die Spielwelt.", /\borison landing zone\b|\bcrusader and orison\b/i],
    ["Missionen", "Siege of Orison", "Das Event rund um Orison erhält neue Kampfeinsätze.", /\bsiege of orison\b/i],
    ["Missionen", "XenoThreat", "Die XenoThreat-Missionen und ihre Abläufe werden angepasst.", /\bxenothreat\b/i],
    ["Gameplay", "Medizinisches Gameplay", "Verletzungen, Behandlung und Wiederbelebung erhalten neue Funktionen.", /\bmedical gameplay\b|\bmedical system\b/i],
    ["Gameplay", "Ernährung und Überleben", "Hunger, Durst und weitere Überlebensmechaniken werden eingeführt oder angepasst.", /\bplayer status system\b|\bhunger and thirst\b/i],
    ["Gameplay", "Handel", "Warenhandel und Verkaufsabläufe erhalten Änderungen.", /\bcommodity trading\b|\bplayer trading\b|\btrading app\b/i],
    ["Gameplay", "Rufsystem", "Der Ruf bei Fraktionen beeinflusst weitere Aufträge.", /\breputation system\b|\breputation v2\b/i],
    ["Schiffe & Fahrzeuge", "Greycat ROC", "Der Greycat ROC erweitert den Fahrzeugbergbau.", /\bgreycat roc\b/i],
    ["Schiffe & Fahrzeuge", "Drake Cutlass Blue", "Die Cutlass Blue wird zur Schiffsauswahl hinzugefügt.", /\bdrake cutlass blue\b/i],
    ["Gameplay", "Arena Commander", "Arena Commander erhält neue Spielmodi oder Anpassungen.", /\barena commander.*(?:new mode|experimental mode|game mode)\b/i]
  ];
  const changes = rules.filter(([, , , pattern]) => pattern.test(main))
    .map(([category, title, description]) => ({ category, title, description }));
  if (/\bbug fixes\b|\bfixed\b|\bclient crashes\b|\bserver crashes\b/i.test(content))
    changes.push({ category: "Technik", title: "Fehlerbehebungen", description: "Die Patch Notes dokumentieren Korrekturen und Stabilitätsarbeiten." });
  return changes.slice(0, 9);
}
function publishablePatch(version, content) {
  const shortRelease = HISTORICAL_SHORT_RELEASES[version];
  if (shortRelease) return content.length >= 300 &&
    historicalPatchChanges(content, version).length >= shortRelease.minimum;
  if (content.length < 500) return false;
  if (/^Alpha 3\./.test(version)) return historicalPatchChanges(content, version).length > 0 &&
    /\bpatch notes\b|\bfeatures and gameplay\b|\bbug fixes\b/i.test(content);
  if (Object.hasOwn(ARCHIVE_HIGHLIGHTS, version)) {
    return (archiveHighlights(version, content)?.length || 0) >= minimumHighlights(version);
  }
  return true;
}
function minimumHighlights(version) {
  return PATCH_SEEDS.find(seed => seed.version === version)?.sourceType === "Content Update" ? 2 : 4;
}
function fallbackPatchSummary(version, content) {
  const t = content || "";
  if (/^Alpha 3\./.test(version)) return `${version}: ${historicalPatchChanges(t, version).slice(0, 6).map(x => x.description).join(" ")}`;
  if (alpha47Content(version, t)) return "Alpha 4.7 erweitert Nyx mit Operation Breaker Stations: In den Stationen warten Kämpfe, Rätsel und abbaubare Rohstoffe. Das Inventar wurde mit zwei Fenstern und Zugriff auf nahe Container überarbeitet. Crafting startet mit dem Item Fabricator, Bauplänen und Materialqualität, die sich auf hergestellte Gegenstände auswirkt. Dazu kommen die RSI Aurora Mk II, Änderungen an Schilden, Rüstung und Radar sowie weitere Anlaufstellen in Nyx. Experimentelle VR-Funktionen und zahlreiche Fehlerkorrekturen runden das Update ab.";
  const highlights = archiveHighlights(version, t);
  if (highlights?.length >= minimumHighlights(version)) return highlights.map(x => x.description).join(" ");
  const parts = [];
  if (/orison relief support/i.test(t)) parts.push("Orison Relief Support bringt eine neue Reihe von Wiederaufbau-, Transport-, Herstellungs- und Kampfeinsätzen mit persönlichem Fortschritts- und Belohnungssystem.");
  if (/siege of orison v2/i.test(t)) parts.push("Siege of Orison wurde als Instancing-Mission überarbeitet und bietet eine geschlossene Mission für Spieler und Gruppe.");
  if (/recco battaglia/i.test(t)) parts.push("Recco Battaglia erweitert das Missionsangebot mit storybasierten und wiederholbaren Aufträgen rund um Bergbau und Ressourcenlogistik.");
  if (/instancing/i.test(t)) parts.push("Instancing hält unterstützte Inhalte in separaten Instanzen für die jeweilige Gruppe und führt dafür neue Backend- und Skalierungslogik ein.");
  if (/hydrogen & quantum fuel rebalance/i.test(t)) parts.push("Hydrogen- und Quantum-Treibstoff wurden bei Kapazitäten, Verbrauch und Preisen neu ausbalanciert.");
  if (/vehicle armor update/i.test(t)) parts.push("Die Schiffsrüstung berücksichtigt ihren Zustand nun bei der Schadensreduktion und Schadensberechnung.");
  if (/pricing, claims, & availability/i.test(t)) parts.push("Claim-, Liefer- und Expedite-Kosten sowie die Verfügbarkeit verschiedener Fahrzeuge, Waffen und Gegenstände wurden angepasst.");
  if (newGearMention(t)) parts.push("Mehrere neue Waffen bzw. Ausrüstungsgegenstände wurden hinzugefügt, darunter neue FPS-Waffen und schwere Ausrüstung.");
  if (/virtual reality updates|experimental vr|openxr/i.test(t)) parts.push("Die experimentelle VR-Unterstützung wurde bei Headtracking, Cursor, Rendering und OpenXR erweitert.");
  if (/ground vehicle soft death/i.test(t)) parts.push("Bodenfahrzeuge können nun einen Soft-Death-Zustand erreichen, statt direkt zerstört zu werden.");
  if (/creature and plant loot quality/i.test(t)) parts.push("Bei Kreaturen- und Pflanzenbeute gibt es nun unterschiedliche Qualitätsstufen.");
  if (/weapon attachment availability/i.test(t)) parts.push("Bestimmte Waffenaufsätze sind nun breiter im allgemeinen Loot-Pool verfügbar.");
  if (/hauling and delivery cargo distribution/i.test(t)) parts.push("Die Frachtverteilung bei Multi-Pickup-Aufträgen berücksichtigt nun die SCU-Menge der einzelnen Abholorte.");
  if (/ordnance cargo holder/i.test(t)) parts.push("Der Ordnance Cargo Holder erweitert den Transport von Munition und Ausrüstung.");
  if (/freight elevator kiosk/i.test(t)) parts.push("Die Bedienoberfläche des Frachtaufzugs wurde überarbeitet.");
  if (/combat mission rebalance|combat missions rebalance/i.test(t)) parts.push("Kampfmissionen und ihre Balance wurden angepasst.");
  if (/mining laser.{0,80}20%|20%.{0,80}mining laser/i.test(t)) parts.push("Die Leistung von Mining-Lasern wurde angepasst.");
  if (debutedIn(version, "cq7-bullpup") && /cq7.{0,25}bullpup/i.test(t)) parts.push("Das CQ7 Bullpup erweitert das Waffenangebot.");
  if (/defend location.{0,60}ship battles v3/i.test(t)) parts.push("Defend Location – Ship Battles V3 verbindet Verteidigungs- und Eskortaufträge mit neuen Gegnerwellen.");
  if (/return of xenothreat|xenothreat returns/i.test(t)) parts.push("Return of XenoThreat bringt die XenoThreat-Bedrohung als Event zurück.");
  if (debutedIn(version, "tactical-strike-group") && /tactical strike group/i.test(t)) parts.push("Die Tactical Strike Group erweitert das Missionsangebot.");
  const m = t.match(/closes\s+(\d+)\s+(?:bug fixes|issues)/i);
  if (m) parts.push(`Zusätzlich wurden ${m[1]} dokumentierte Korrekturen bzw. Issues geschlossen.`);
  else if (/stability and performance|client crashes|server crashes/i.test(t)) parts.push("Der Patch enthält zahlreiche Stabilitäts-, Crash- und Performance-Korrekturen.");
  return sentenceList(parts, 7) || `${version} enthält Gameplay-, Technik- und Fehlerbehebungsänderungen laut den offiziellen Patch Notes.`;
}
function fallbackFullSummary(version, content) {
  if (!content) return "Die Patch-Notizen konnten technisch noch nicht vollständig aus dem Archiv übernommen werden. Die offizielle Originalquelle ist direkt verlinkt.";
  const t = content;
  if (/^Alpha 3\./.test(version)) return `${version} enthält folgende dokumentierte Änderungen: ${historicalPatchChanges(t, version).map(x => x.description).join(" ")} Die verlinkte Quelle enthält die vollständigen Patch Notes.`;
  if (alpha47Content(version, t)) return "Alpha 4.7 bringt Operation Breaker Stations nach Nyx. In diesen Aufträgen kämpfen sich Spieler durch Gegner und Gefahren, lösen Rätsel und nehmen eine Bergbaustation wieder in Betrieb, um an Rohstoffe im Asteroiden zu gelangen. Stationen können exklusiv oder gemeinsam zugänglich sein. Das Inventar erhält eine neue Oberfläche mit zwei Fenstern. Nahe Container, Rucksäcke und Körper erscheinen als auswählbare Tabs; Suche, Sortierung und Filter helfen beim Umlagern und Ausrüsten. Das neue Crafting nutzt den Item Fabricator und Baupläne. Gesammelte und abgebaute Materialien besitzen Qualitätswerte, die die Werte des hergestellten Gegenstands beeinflussen. Auch die Verteilung von abbaubaren Rohstoffen wurde angepasst. Bei Schiffen kommt die RSI Aurora Mk II hinzu. Schilde und Rüstung wurden neu abgestimmt; Radar-Komponenten und radarbasierte Zielhilfe verändern die technischen Möglichkeiten der Fahrzeuge. In Nyx bieten People's Service Stations zusätzliche Anlaufstellen und mögliche Heimatorte. Die experimentelle VR-Unterstützung erhält Verbesserungen bei Cursor, Oberfläche und Rendering. Laut Patch Notes wurden seit Alpha 4.6 zudem über 150 Fehler und Abstürze korrigiert.";
  const highlights = archiveHighlights(version, t);
  if (highlights?.length >= minimumHighlights(version)) return `${version} umfasst folgende Änderungen: ${highlights.map(x => x.description).join(" ")} Weitere Details stehen in der verlinkten Quelle.`;
  const parts = [];
  if (/orison relief support/i.test(t)) parts.push("Im Gameplay bringt der Patch mit Orison Relief Support eine neue Reihe von Wiederaufbau- und Unterstützungsaufträgen. Je nach Auftrag geht es um Ressourcensammlung, Herstellung, Transporte oder Kämpfe; der persönliche Fortschritt schaltet mehrere Belohnungen frei.");
  if (/siege of orison v2/i.test(t)) parts.push("Siege of Orison wurde als Instancing-Inhalt überarbeitet. Die Mission läuft in einer geschlossenen Instanz für die eigene Gruppe, nutzt Checkpoints und wurde bei Plattformen, Gegnern und Belohnungen angepasst.");
  if (/recco battaglia/i.test(t)) parts.push(`${version === "Alpha 4.9" ? "Mit Recco Battaglia kommt ein weiterer Missionsgeber hinzu." : "Die Auftragsreihe um Recco Battaglia wird fortgeführt."} Ihre Aufträge führen durch Bergbau-, Verteidigungs-, Such- und Bergungsinhalte und schalten über Reputation weitere Verträge und Belohnungen frei.`);
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
  if (debutedIn(version, "cq7-bullpup") && /cq7.{0,25}bullpup/i.test(t)) parts.push("Das CQ7 Bullpup kommt als weitere FPS-Waffe hinzu.");
  if (/grenade hud marker/i.test(t)) parts.push("HUD-Marker machen Granaten im Kampf besser erkennbar.");
  if (/defend location.{0,60}ship battles v3/i.test(t)) parts.push("Defend Location – Ship Battles V3 kombiniert Verteidigung und Eskorte. Unterschiedliche Schauplätze und Schwierigkeitsgrade sowie Gegner wie Ace Pilots beeinflussen Missionsablauf, Reputation und Belohnungen.");
  if (/return of xenothreat|xenothreat returns/i.test(t)) parts.push("Return of XenoThreat steht als Event im Mittelpunkt dieses Updates.");
  if (debutedIn(version, "tactical-strike-group") && /tactical strike group/i.test(t)) parts.push("Die Tactical Strike Group ergänzt das Missionsangebot.");
  const m = t.match(/closes\s+(\d+)\s+(?:bug fixes|issues)/i);
  if (m) parts.push(`Bei Stabilität und Fehlerbehebungen wurden ${m[1]} dokumentierte Korrekturen bzw. Issues geschlossen.`);
  else if (/stability and performance/i.test(t)) parts.push("Zusätzlich enthält der Patch zahlreiche Stabilitäts-, Crash- und Performance-Fixes.");
  return sentenceList(parts, 12) || `${version} enthält Gameplay-, Technik-, Missions- und Fehlerbehebungsänderungen. Die vollständige Liste ist über die offizielle Originalquelle abrufbar.`;
}
function buildPatchChanges(item) {
  const t = item.content || ""; const changes = [];
  if (item.historical) return historicalPatchChanges(t, item.version);
  if (alpha47Content(item.version, t)) return alpha47Changes(t);
  const highlights = archiveHighlights(item.version, t);
  if (highlights?.length >= minimumHighlights(item.version)) return highlights;
  const add = (category,title,description,pattern) => { if (pattern.test(t)) changes.push({category,title,description}); };
  add("Gameplay","Orison Relief Support","Neue Wiederaufbau- und Unterstützungsaufträge rund um Orison mit Ressourcen, Herstellung, Transport und Kampf.",/orison relief support/i);
  add("Missionen","Siege of Orison V2","Die Mission wurde auf Instancing umgestellt und für Gruppen mit Checkpoints und überarbeiteten Gefechten neu aufgebaut.",/siege of orison v2/i);
  add("Missionen","Recco Battaglia",item.version === "Alpha 4.9" ? "Neue storybasierte und wiederholbare Aufträge rund um Bergbau, Verteidigung, Suche und Ressourcenlogistik." : "Die Auftragsreihe umfasst Story- und wiederholbare Verträge rund um Bergbau, Verteidigung, Suche und Ressourcenlogistik.",/recco battaglia/i);
  add("Gameplay","Loot und Drop-Raten","Loot-Caches, Container und Seltenheitsstufen wurden umfassend neu gewichtet.",/loot generation & drop rates/i);
  add("Schiffe & Fahrzeuge","Treibstoff-Balance","Hydrogen- und Quantum-Treibstoff wurden bei Kapazität, Verbrauch, Preisen und Refuelling angepasst.",/hydrogen & quantum fuel rebalance/i);
  add("Schiffe & Fahrzeuge","Schiffsarmor","Die Schadensreduktion durch Rüstung berücksichtigt nun deren aktuellen Zustand.",/vehicle armor update/i);
  add("Schiffe & Fahrzeuge","Claims und Verfügbarkeit","Claim-/Lieferzeiten, Expedite-Kosten, Munitionspreise und verschiedene Shop-Angebote wurden angepasst.",/pricing, claims, & availability/i);
  add("Schiffe & Fahrzeuge","Soft Death für Bodenfahrzeuge","Bodenfahrzeuge können nun deaktiviert werden und bleiben inert, statt direkt zerstört zu werden.",/ground vehicle soft death/i);
  if (newGearMention(t)) changes.push({category:"Inventar",title:"Neue Waffen und Ausrüstung",description:"Neue FPS-Waffen und schwere Ausrüstung erweitern das verfügbare Arsenal."});
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
  if (debutedIn(item.version, "tactical-strike-group")) add("Missionen","Tactical Strike Group","Neue Einsätze der Tactical Strike Group.",/tactical strike group/i);
  add("Fracht","Ordnance Cargo Holder","Munition kann über den neuen Cargo Holder transportiert werden.",/ordnance cargo holder/i);
  add("Fracht","Freight Elevator Kiosk","Bedienung und Anzeige des Frachtaufzugs wurden angepasst.",/freight elevator kiosk/i);
  add("Missionen","Kampfmissionen","Schwierigkeit und Abläufe von Kampfeinsätzen wurden neu abgestimmt.",/combat mission rebalance|combat missions rebalance/i);
  if (debutedIn(item.version, "cq7-bullpup")) add("Waffen","CQ7 Bullpup","Die neue FPS-Waffe erweitert das Arsenal.",/cq7.{0,25}bullpup/i);
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

async function getGithubJSONStrict(env, path, { allowMissing = false } = {}) {
  const [owner, repo] = String(env.GITHUB_REPO || "").trim().split("/");
  if (!env.GITHUB_TOKEN || !owner || !repo) throw Error("GitHub-Konfiguration fehlt; Import abgebrochen.");
  const branch = String(env.GITHUB_BRANCH || "main").trim() || "main";
  const api = `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`;
  const r = await fetch(api, { headers: gh(env.GITHUB_TOKEN) });
  if (r.status === 404 && allowMissing) return { data: null, sha: null };
  if (!r.ok) throw Error(`GitHub-Datei ${path} nicht lesbar (HTTP ${r.status}); Import abgebrochen.`);
  const j = await r.json();
  if (!j?.sha || typeof j.sha !== "string") throw Error(`GitHub-Datei ${path}: SHA fehlt; Import abgebrochen.`);
  try {
    let value;
    if (!j.content && Number(j.size) > 0) {
      // GitHub omits the Base64 content for files above 1 MB. Request raw
      // bytes without changing the SHA used for optimistic concurrency.
      const raw = await fetch(api, { headers: { ...gh(env.GITHUB_TOKEN), accept: "application/vnd.github.raw+json" } });
      if (!raw.ok) throw Error(`HTTP ${raw.status}`);
      value = await raw.text();
    } else {
    const b64 = String(j.content || "").replace(/\s/g, "");
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      value = new TextDecoder().decode(bytes);
    }
    return { data: JSON.parse(value), sha: j.sha };
  } catch (e) { throw Error(`GitHub-Datei ${path} ungültig (${e.message}); Import abgebrochen.`); }
}
async function readGithubJSON(env, path, fallback) {
  if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) return fallback;
  try { return (await getGithubJSONStrict(env, path, { allowMissing: true })).data ?? fallback; }
  catch { return fallback; }
}
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0).toString(16); }
async function putGithub(env, path, content, message, expectedSha = undefined) {
  const [owner, repo] = env.GITHUB_REPO.split("/");
  const api = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
  let sha = expectedSha;
  if (sha === undefined) {
    const old = await fetch(api, { headers: gh(env.GITHUB_TOKEN) });
    if (old.ok) sha = (await old.json()).sha;
    else if (old.status !== 404) throw Error(`GitHub-Datei ${path} vor dem Schreiben nicht prüfbar (HTTP ${old.status}); Import abgebrochen.`);
  }
  const bytes = new TextEncoder().encode(content);
  let binary = ""; for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const body = { message, content: btoa(binary), branch: env.GITHUB_BRANCH || "main" }; if (sha) body.sha = sha;
  const r = await fetch(api, { method: "PUT", headers: { ...gh(env.GITHUB_TOKEN), "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) {
    const error = new Error(`GitHub update failed ${r.status} (${path}); gespeichertes Archiv nicht überschrieben.`);
    error.status = r.status;
    throw error;
  }
}
const gh = t => ({ accept: "application/vnd.github+json", authorization: `Bearer ${t}`, "x-github-api-version": "2022-11-28", "user-agent": `Verse-Radar/${VERSION}` });
