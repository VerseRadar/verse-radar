import { DurableObject } from "cloudflare:workers";

/* Verse Radar – RSI news + patch notes ingestion
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
const NEWS_UPDATE_CRON = "0 */2 * * *";
const PATCH_UPDATE_CRON = "30 */2 * * *";
const PATCH_BACKFILL_LEASE_MS = 10 * 60 * 1000;
const VERSION = "1.0.0";
const COMMUNITY_FEED_URL = "https://leonick.se/feeds/rsi/json";
const DEFAULT_REFERRAL_URL = "https://www.robertsspaceindustries.com/enlist?referral=STAR-6KT2-XJBC";
// These two release announcements were imported as patch notes before the
// source channel was checked. Keep their summaries, repair their RSI links.
const LEGACY_RELEASE_LINKS = new Map([
  ["4.8.3", "https://robertsspaceindustries.com/en/comm-link/transmission/21206-Star-Citizen-Alpha-483"],
  ["4.8.1", "https://robertsspaceindustries.com/en/comm-link/transmission/21177-Star-Citizen-Alpha-481"]
]);
const PATCH_SEEDS = [
  // Official LIVE note reported while the community index was still stale.
  { version: "Alpha 4.10.2", id: 21351, date: "2026-10-09T00:00:00.000Z", sourceUrl: "https://robertsspaceindustries.com/en/comm-link/Patch-Notes/21351-Star-Citizen-Alpha-4102" },
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
// This release was checked against the official LIVE notes on October 9.
// RSI's frontend currently sends an app shell to the Worker and the mirror
// has no 21351 record. Keep this independent German editorial summary until
// the indexed source becomes readable; never label it as extracted raw text.
const CURATED_LIVE_PATCHES = {
  "Alpha 4.10.2": {
    summary: "Alpha 4.10.2 bringt RSI Discovery Month mit Kämpfen, Transport, Rohstoffsuche und Bergung sowie eigenen Fortschrittswegen und Belohnungen. Die Constellation Mk IV wurde bei Brücke, Zugängen, Aufzügen, Türmen, Snub-Bucht und Innenräumen überarbeitet. Ein neues Physik-Netcode soll lose Gegenstände ruhiger und genauer synchronisieren. Dazu kommen ein regelbarer VR-Zoom, neue Ausrüstung und weitere Korrekturen.",
    changes: [
      { category: "Missionen", title: "RSI Discovery Month", description: "Neue Aufträge für Schiffs- und FPS-Kampf, Transport, Rohstoffe und Bergung; Fortschritt über Karrierepfade mit Belohnungen." },
      { category: "Schiffe & Fahrzeuge", title: "Constellation Mk IV überarbeitet", description: "Brücke, Luftschleuse, Fracht- und Crewaufzüge, Geschütztürme, Snub-Bucht, Technikbereiche und Innenräume wurden erneuert." },
      { category: "Technik", title: "Physik-Netcode für lose Objekte", description: "Kisten, Granaten und andere lose Gegenstände sollen seltener springen, rutschen oder nach einer Korrektur versetzt erscheinen." },
      { category: "VR", title: "Einstellbarer Zoom", description: "VR erhält eine eigene Zoomfunktion für Interaktionen, präzises Zielen im Schiff und FPS-Visiere; die Stärke lässt sich anpassen oder abschalten." },
      { category: "Schiffe & Fahrzeuge", title: "Schilde und abgestellte Fahrzeuge", description: "Feste Schildwiderstände werden korrekt angewandt; verlassene Fahrzeuge an mehreren Stationen verschwinden nach einem eigenen Timer." },
      { category: "Ausrüstung", title: "Rüstungen und Wikelo-Rezepte", description: "Heavy Combat Hunter 3 und neue RRS-Tarnvarianten kommen hinzu; Wikelo bietet weitere Rezepte für Gemini LMG und Grey Combat Armour." },
      { category: "Technik", title: "VR- und Bedienfehler behoben", description: "Unter anderem wurden verschwindende UI-Symbole und zurückgesetzte Mauseinstellungen beim Wechsel zu VR korrigiert." }
    ],
    fullSummary: "RSI Discovery Month erweitert Stanton um Aufträge für Schiffs- und FPS-Gefechte, Warentransport, Rohstoffe und Bergung. Die Aufgaben bringen Eventpunkte, Fortschritt in eigenen Karrierepfaden und Belohnungen. Die Constellation Mk IV wurde umfassend modernisiert: Eine klarere Brückenverglasung, veränderte Luftschleuse, neue Fracht- und Crewaufzüge, überarbeitete Geschütztürme und Snub-Bucht sowie angepasste Technik- und Wohnbereiche gehören dazu. Das neue experimentelle Physik-Netcode synchronisiert lose Gegenstände wie Kisten und Wurfobjekte mit sanfteren Korrekturen; Schiffe und Figuren nutzen weiterhin das bisherige System. VR erhält einen regelbaren Zoom für Interaktionen, Zielvorgänge in Schiffen und FPS-Visiere. Feste Schildwiderstände wirken nun wie vorgesehen, verlassene Fahrzeuge an ausgewählten Stationen haben einen eigenen Ablauf-Timer. Neue Rüstungsvarianten und Wikelo-Rezepte ergänzen Ausrüstung und Herstellung. Die offiziellen Notizen führen außerdem Fehlerbehebungen bei VR und Benutzeroberfläche auf."
  }
};
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
// These historical releases have verified, version-specific notes. Some are
// short; others use headings the generic historical parser does not recognize.
const HISTORICAL_SHORT_RELEASES = {
  "Alpha 3.0.0": {
    marker: /\bstar citizen alpha patch 3\.0\.0\b/i, minimum: 5,
    sourceUrl: "https://robertsspaceindustries.com/en/comm-link/transmission/16349-Star-Citizen-Alpha-300",
    changes: [
      ["Orte", "Erkundbare Oberflächen", "Yela, Daymar, Cellin und Delamar erhalten erstmals erkundbare Oberflächen.", /\byela\b[\s\S]{0,100}\bdaymar\b[\s\S]{0,100}\bcellin\b[\s\S]{0,100}\bdelamar\b/i],
      ["Orte", "Außenposten", "Außenposten und Schiffswracks verteilen sich auf den neuen Oberflächen.", /\bsurface outposts and derelict ships\b/i],
      ["Schiffe & Fahrzeuge", "Ursa Explorer", "Der Ursa Explorer wird als erstes eigens dafür vorgesehenes Bodenfahrzeug eingeführt.", /\bfirst dedicated ground vehicle\s*\(?ursa\)?\s*explorer\b/i],
      ["Missionen", "Neues Missionssystem", "Ein überarbeitetes Missionssystem bildet die Grundlage für neue Aufträge.", /\brevamped mission system with new missions\b/i],
      ["Gameplay", "Sauerstoff und Ausdauer", "Sauerstoffvorrat, Ausdauer und Puls beeinflussen die Belastung des Charakters.", /\bbreathing, stamina\s*&\s*heart rate\b/i],
      ["Orte", "Tag und Nacht", "Die Himmelskörper rotieren und erhalten dynamische Tag-Nacht-Zyklen.", /\bplanetary bodies now have rotational motion complete with dynamic day\/night cycles\b/i],
      ["Technik", "Launcher und Patcher", "Ein neuer Launcher und ein neues Patchsystem werden eingeführt.", /\bnew launcher and patcher system\b/i]
    ]
  },
  "Alpha 3.1.3": {
    marker: /\balpha patch 3\.1\.3\b/i, minimum: 2,
    sourceUrl: "https://robertsspaceindustries.com/spectrum/community/SC/forum/4/thread/star-citizen-alpha-3-1-3-live-746975-patch-notes",
    changes: [
      ["Technik", "KI-Piloten", "KI-Piloten wechseln nicht mehr gelegentlich in einen inaktiven Zustand.", /\bai pilots occasionally going into idle states\b/i],
      ["Orte", "Revel-and-York-Hangar", "Der große persönliche Hangar lädt wieder für Schiffe der Größe 5 und größer.", /\blarger revel and york personal hangar for size 5\+ ships will now load again\b/i],
      ["Technik", "Abstürze", "Die Patch Notes nennen Korrekturen für Client- und Serverabstürze.", /\bfixed 3 client crashes\b[\s\S]{0,80}\bfixed 9 potential server crash causes\b/i]
    ]
  },
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
    // The Wiki places "Hot Fix 3.11.1a" before the Patch notes heading;
    // cleanPatchText removes that introduction. Verify parse.title below.
    marker: null, minimum: 2,
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
const RELEVANT = /patch|alpha\s*\d|free\s*fly|foundation festival|fleet week|invictus|iae|event|roadmap|ship showdown|siege|monthly report|this week in star citizen|live experience|pirate week|discovery month|constellation|subscriber|vehicle|ship|aegis|argo|anvil|kruger|sabre|aurora|gameplay|engineering|q\s*&\s*a|letter from the chairman/i;
const NEWS_SUMMARY_VERSION = "0.10.3";
// The archived metadata for this article still names the August edition;
// RSI redirects its old URL to the September 9 edition with the same ID.
const NEWS_SOURCE_CORRECTIONS = {
  21314: {
    oldTitle: "Roadmap Roundup - August 26, 2026",
    title: "Roadmap Roundup - September 9, 2026",
    url: "https://robertsspaceindustries.com/en/comm-link/transmission/21314-Roadmap-Roundup-September-9-2026",
    summary: "Orison Relief Support ist laut Roadmap für ein kommendes 4.10.x-Update vorgesehen. Alpha 4.11 wurde auf das vierte Quartal 2026 verschoben."
  }
};
// Temporary bridge for official October 9 articles until public indexes catch up.
// Keep the original RSI links, and let later feed/API records replace these
// date-only headlines when a precise publication time becomes available.
const CONFIRMED_NEWS = [
  [21353, "Roadmap Roundup - October 9, 2026", "Roadmap-Roundup-October-9-2026"],
  [21350, "FAQ: RSI Discovery Month", "FAQ-RSI-Discovery-Month"],
  [21334, "Alpha 4.10.2: RSI Discovery Month - Missions, Rewards, & Icons", "Alpha-4102-RSI-Discovery-Month"],
  [21276, "RSI Discovery Month Digital Goodies Pack", "RSI-Discovery-Month-Digital-Goodies-Pack"],
  [21336, "RSI Constellation Mk IV Celebration", "RSI-Constellation-Mk-IV-Celebration"]
].map(([sourceId, title, slug]) => ({ sourceId, title,
  url: `https://robertsspaceindustries.com/en/comm-link/transmission/${sourceId}-${slug}`,
  date: "2026-10-09T00:00:00.000Z", description: "" }));
const OLD_NEWS_PLACEHOLDER = "Offizieller RSI Comm-Link-Beitrag. Öffne die Originalquelle für den vollständigen Inhalt.";

export default {
  async fetch(request, env) {
    const u = new URL(request.url);
    if (u.pathname === "/health") {
      return json({ ok: true, service: "verse-radar-updater", version: VERSION });
    }
    if (u.pathname === "/backfill") return backfillPage();
    if (u.pathname === "/admin" && request.method === "GET") return adminLoginPage();
    if (u.pathname === "/event-admin.html" || u.pathname === "/deal-admin.html") return new Response(null, { status: 302, headers: { location: "/admin", "cache-control": "no-store" } });
    if (u.pathname === "/manage/login") return adminLogin(request, env, u);
    if (u.pathname === "/manage/logout") return adminLogout(request, u);
    if (u.pathname === "/manage/session") return json({ ok: await adminAuthorized(request, env, u) });
    if (u.pathname === "/manage/stats") {
      if (request.method !== "GET") return json({ ok: false, error: "GET erforderlich" }, 405);
      if (!await adminAuthorized(request, env, u)) return json({ ok: false, error: "Unauthorized" }, 401);
      if (!env.PAGE_VIEWS) return json({ ok: false, error: "Aufrufzähler nicht eingerichtet" }, 503);
      try {
        const months = await env.PAGE_VIEWS.getByName("verse-radar").summary();
        return json({ ok: true, months, metric: "page_views" });
      } catch { return json({ ok: false, error: "Aufrufzahlen gerade nicht verfügbar" }, 503); }
    }
    if (u.pathname === "/manage" || u.pathname === "/manage/events" || u.pathname === "/manage/deals" || u.pathname === "/manage/referral") {
      if (!await adminAuthorized(request, env, u)) return new Response(null, { status: 302, headers: { location: "/admin", "cache-control": "no-store" } });
      if (request.method !== "GET") return json({ ok: false, error: "GET erforderlich" }, 405);
      return u.pathname === "/manage" ? adminDashboardPage() : u.pathname === "/manage/events" ? eventAdminPage() : u.pathname === "/manage/deals" ? dealAdminPage() : referralAdminPage();
    }
    if (["/manage/referral/state", "/manage/referral/preview", "/manage/referral/publish"].includes(u.pathname)) {
      if (!env.RUN_SECRET) return json({ ok: false, error: "Zugangsschlüssel nicht eingerichtet." }, 503);
      if (!await adminAuthorized(request, env, u)) return json({ ok: false, error: "Unauthorized" }, 401);
      const state = u.pathname.endsWith("/state");
      if (request.method !== (state ? "GET" : "POST")) return json({ ok: false, error: state ? "GET erforderlich" : "POST erforderlich" }, 405);
      if (!state && !sameOrigin(request, u)) return json({ ok: false, error: "Andere Herkunft nicht erlaubt" }, 403);
      try {
        if (state) return json({ ok: true, version: VERSION, ...await referralSpecialState(env) });
        const raw = await request.text();
        if (raw.length > 6000) return json({ ok: false, error: "Eingabe zu groß" }, 413);
        return json({ ok: true, version: VERSION, ...await editReferralSpecial(env, JSON.parse(raw), u.pathname.endsWith("/publish")) });
      } catch (e) { return json({ ok: false, error: e.message }, e.status === 409 ? 409 : 400); }
    }
    if (["/manage/deals/state", "/manage/deals/preview", "/manage/deals/publish"].includes(u.pathname)) {
      if (!env.RUN_SECRET) return json({ ok: false, error: "RUN_SECRET fehlt." }, 503);
      if (!await adminAuthorized(request, env, u)) return json({ ok: false, error: "Unauthorized" }, 401);
      const state = u.pathname.endsWith("/state");
      if (request.method !== (state ? "GET" : "POST")) return json({ ok: false, error: state ? "GET erforderlich" : "POST erforderlich" }, 405);
      if (!state && !sameOrigin(request, u)) return json({ ok: false, error: "Andere Herkunft nicht erlaubt" }, 403);
      try {
        if (state) {
          const [deals, shipImages] = await Promise.all([getDealsStrict(env), getShipImagesStrict(env)]);
          return json({ ok: true, version: VERSION, deals: deals.data, shipImages: shipImages.data });
        }
        const raw = await request.text();
        if (raw.length > 8000) return json({ ok: false, error: "Eingabe zu groß" }, 413);
        return json({ ok: true, version: VERSION, ...await editDealData(env, JSON.parse(raw), u.pathname.endsWith("/publish")) });
      } catch (e) { return json({ ok: false, error: e.message }, e.status === 409 ? 409 : 400); }
    }
    if (u.pathname === "/manage/events/state" || u.pathname === "/manage/events/preview" || u.pathname === "/manage/events/publish") {
      if (!env.RUN_SECRET) return json({ ok: false, error: "RUN_SECRET fehlt." }, 503);
      if (!await adminAuthorized(request, env, u)) return json({ ok: false, error: "Unauthorized" }, 401);
      const state = u.pathname.endsWith("/state");
      if (request.method !== (state ? "GET" : "POST")) return json({ ok: false, error: state ? "GET erforderlich" : "POST erforderlich" }, 405);
      if (!state && !sameOrigin(request, u)) return json({ ok: false, error: "Andere Herkunft nicht erlaubt" }, 403);
      try {
        if (state) return json({ ok: true, version: VERSION, ...await eventEditorState(env) });
        const raw = await request.text();
        if (raw.length > 8000) return json({ ok: false, error: "Eingabe zu groß" }, 413);
        const input = JSON.parse(raw);
        return json({ ok: true, version: VERSION, ...await editEventData(env, input, u.pathname.endsWith("/publish")) });
      } catch (e) { return json({ ok: false, error: e.message }, e.status === 409 ? 409 : 400); }
    }
    if (u.pathname === "/manage/activities/image" && request.method === "POST") {
      if (!await adminAuthorized(request, env, u)) return json({ ok: false, error: "Unauthorized" }, 401);
      if (!sameOrigin(request, u)) return json({ ok: false, error: "Andere Herkunft nicht erlaubt" }, 403);
      try { return json({ ok: true, ...(await uploadActivityImage(request, env)) }); }
      catch (e) { return json({ ok: false, error: e.message }, e.status || 400); }
    }
    if (u.pathname.startsWith("/activity-image/") && request.method === "GET") return serveActivityImage(env, u.pathname);
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
        return json({ ok: true, version: VERSION, count: result.news.length, fetchedItems: result.fetchedItems, newItems: result.newItems, refreshedItems: result.refreshedItems, aiItems: result.aiItems, published: false, sourceDiagnostics: result.sourceDiagnostics, items: result.news });
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
            patchAutoPublishEnabled: env.PATCH_AUTO_PUBLISH !== "false",
            deferredSeedItems: result.deferredSeedItems,
            deferredPageItems: result.deferredPageItems,
            historicalCandidates: result.historicalCandidates,
            historicalDeferredItems: result.historicalDeferredItems,
            historicalUnusableItems: result.historicalUnusableItems,
            historicalDiagnostics: result.historicalDiagnostics,
            feedDiagnostics: result.feedDiagnostics,
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
    if (u.pathname === "/api/page-view") {
      if (request.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST" } });
      if (request.headers.get("origin") !== u.origin || request.headers.get("sec-fetch-site") === "cross-site") return new Response(null, { status: 403 });
      if (!env.PAGE_VIEWS) return new Response(null, { status: 503 });
      try {
        await env.PAGE_VIEWS.getByName("verse-radar").record();
        return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
      } catch { return new Response(null, { status: 503 }); }
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
    if (u.pathname === "/api/freefly" || u.pathname === "/api/events" || u.pathname === "/api/activities") {
      const path = u.pathname === "/api/freefly" ? FREE_FLY_DATA_PATH : u.pathname === "/api/activities" ? ACTIVITY_DATA_PATH : EVENT_DATA_PATH;
      const asset = u.pathname === "/api/freefly" ? "/data/freefly.json" : u.pathname === "/api/activities" ? "/data/activities.json" : "/data/events.json";
      try {
        const data = await readGithubJSON(env, path, null);
        if (u.pathname === "/api/activities" && data == null) return json([]);
        if (u.pathname !== "/api/freefly" ? Array.isArray(data) : data && typeof data === "object" && !Array.isArray(data)) {
          return new Response(JSON.stringify(data), { headers: { "content-type": "application/json;charset=utf-8", "cache-control": "no-store", "x-verse-radar-event-source": "github" } });
        }
        if (env.ASSETS) {
          const fallback = await env.ASSETS.fetch(new Request(new URL(asset, u.origin), request));
          return new Response(await fallback.text(), { status: fallback.status, headers: { "content-type": "application/json;charset=utf-8", "cache-control": "no-store", "x-verse-radar-event-source": "static-fallback" } });
        }
        return json(u.pathname !== "/api/freefly" ? [] : { active: false });
      } catch (e) { return json({ ok: false, error: e.message }, 500); }
    }
    if (u.pathname === "/api/deals") {
      try {
        const deals = await readGithubJSON(env, DEAL_DATA_PATH, null);
        if (Array.isArray(deals)) return new Response(JSON.stringify(deals), { headers: { "content-type": "application/json;charset=utf-8", "cache-control": "no-store", "x-verse-radar-deals-source": "github" } });
        if (env.ASSETS) {
          const fallback = await env.ASSETS.fetch(new Request(new URL("/data/deals.json", u.origin), request));
          return new Response(await fallback.text(), { status: fallback.status, headers: { "content-type": "application/json;charset=utf-8", "cache-control": "no-store", "x-verse-radar-deals-source": "static-fallback" } });
        }
        return json([]);
      } catch (e) { return json({ ok: false, error: e.message }, 500); }
    }
    if (u.pathname === "/api/referral") {
      const url = validReferralUrl(env.REFERRAL_URL) || validReferralUrl(DEFAULT_REFERRAL_URL);
      return json({ enabled: Boolean(url), url });
    }
    if (u.pathname === "/api/referral-special") {
      const data = await readGithubJSON(env, REFERRAL_SPECIAL_PATH, null);
      return json(publicReferralSpecial(data));
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
    // Keep the two imports in separate invocations to stay within the Worker
    // subrequest budget. Explicit "false" pauses the respective schedule.
    if (event?.cron === NEWS_UPDATE_CRON && env.NEWS_AUTO_PUBLISH !== "false")
      ctx.waitUntil(updateSite(env, { includeNews: true, includePatches: false, onlyWhenChanged: true }));
    if (event?.cron === PATCH_UPDATE_CRON && env.PATCH_AUTO_PUBLISH !== "false")
      ctx.waitUntil(updateSite(env, { includeNews: false, includePatches: true, onlyWhenChanged: true }));
  }
};

// Stores aggregate page views only. No IP, browser identifier, or individual visits are persisted.
export class PageViewCounter extends DurableObject {
  constructor(state, env) {
    super(state, env);
    state.storage.sql.exec("CREATE TABLE IF NOT EXISTS monthly_views (month TEXT PRIMARY KEY, views INTEGER NOT NULL)");
  }
  monthFor(date) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit" }).formatToParts(date).map(p => [p.type, p.value]));
    return `${parts.year}-${parts.month}`;
  }
  async record() {
    const month = this.monthFor(new Date());
    this.ctx.storage.sql.exec("INSERT INTO monthly_views (month, views) VALUES (?, 1) ON CONFLICT(month) DO UPDATE SET views = views + 1", month);
  }
  async summary() {
    const [year, currentMonth] = this.monthFor(new Date()).split("-").map(Number);
    const months = Array.from({ length: 6 }, (_, i) => this.monthFor(new Date(Date.UTC(year, currentMonth - 1 - i, 15, 12))));
    const counts = new Map(this.ctx.storage.sql.exec("SELECT month, views FROM monthly_views WHERE month >= ?", months.at(-1)).toArray().map(row => [row.month, row.views]));
    return months.map(month => ({ month, views: counts.get(month) || 0 }));
  }
}

const json = (x, s = 200) => new Response(JSON.stringify(x, null, 2), { status: s, headers: { "content-type": "application/json;charset=utf-8", "cache-control": "no-store" } });
const ADMIN_COOKIE = "vr_admin";
const ADMIN_SESSION_SECONDS = 8 * 60 * 60;
const sameOrigin = (request, url) => request.headers.get("origin") === url.origin;
const adminHeaders = { "content-type": "text/html;charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer", "x-frame-options": "DENY", "content-security-policy": "default-src 'none'; connect-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'" };
function adminLoginPage() {
  return new Response(`<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Admin Login – Verse Radar</title><style>body{font:16px/1.5 system-ui;background:#041016;color:#e2eaea;max-width:520px;margin:9vh auto;padding:24px}a{color:#79f05c}input,button{display:block;font:inherit;padding:12px;margin:12px 0;width:100%;box-sizing:border-box}input{background:#071219;color:white;border:1px solid #24404b}button{background:#184f29;color:white;border:1px solid #5dcc62;cursor:pointer}</style><a href="/">← Verse Radar</a><h1>Admin Login</h1><p>Melde dich mit deinem Zugangsschlüssel an.</p><form id="login"><label>Zugangsschlüssel<input id="secret" type="password" autocomplete="current-password" required></label><button>Anmelden</button></form><p id="message" role="status"></p><script>fetch('/manage/session',{cache:'no-store'}).then(r=>r.json()).then(x=>{if(x.ok)location.replace('/manage')});document.querySelector('#login').addEventListener('submit',async e=>{e.preventDefault();const field=document.querySelector('#secret'),secret=field.value;field.value='';try{const r=await fetch('/manage/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({secret}),cache:'no-store'});if(!r.ok)throw Error('Anmeldung fehlgeschlagen. Zugangsschlüssel prüfen.');location.replace('/manage')}catch(x){document.querySelector('#message').textContent=x.message}})</script></html>`, { headers: adminHeaders });
}
function adminDashboardPage() {
  return new Response(`<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Verwaltung – Verse Radar</title><style>body{font:16px/1.5 system-ui;background:#041016;color:#e2eaea;max-width:700px;margin:9vh auto;padding:24px}a{color:#79f05c;display:block;padding:14px;border:1px solid #24404b;margin:12px 0;text-decoration:none}button{background:#184f29;color:white;border:1px solid #5dcc62;padding:10px 16px;cursor:pointer}section{border:1px solid #24404b;padding:16px;margin:25px 0}li{margin:7px 0}</style><h1>Verse Radar · Verwaltung</h1><a href="/manage/events">Free Fly & Events pflegen →</a><a href="/manage/deals">Game Packages pflegen →</a><a href="/manage/referral">Referral-Sonderaktion pflegen →</a><section><h2>Seitenaufrufe pro Monat</h2><p>Nur öffentliche Seiten seit Aktivierung dieses Zählers. Mehrere Aufrufe derselben Person zählen mehrfach; dies ist keine Anzahl verschiedener Personen.</p><div id="monthly-views" role="status">Lade Aufrufzahlen …</div></section><button id="logout">Abmelden</button><script>fetch('/manage/stats',{cache:'no-store'}).then(async r=>{if(r.status===401){location.replace('/admin');return}const data=await r.json();if(!r.ok||!data.ok)throw Error(data.error||'Zähler gerade nicht verfügbar');const root=document.querySelector('#monthly-views');root.replaceChildren();const list=document.createElement('ul');for(const item of data.months){const row=document.createElement('li');const date=new Date(item.month+'-15T12:00:00Z');row.textContent=new Intl.DateTimeFormat('de-DE',{month:'long',year:'numeric',timeZone:'Europe/Berlin'}).format(date)+': '+new Intl.NumberFormat('de-DE').format(item.views);list.append(row)}root.append(list)}).catch(e=>{document.querySelector('#monthly-views').textContent=e.message});document.querySelector('#logout').onclick=async()=>{await fetch('/manage/logout',{method:'POST',cache:'no-store'});location.replace('/admin')}</script></html>`, { headers: adminHeaders });
}
async function adminKey(env) {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(env.RUN_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
function adminCookie(request) {
  return request.headers.get("cookie")?.split(";").map(x=>x.trim()).find(x=>x.startsWith(ADMIN_COOKIE+"="))?.slice(ADMIN_COOKIE.length+1) || "";
}
async function adminAuthorized(request, env, url) {
  if (!env.RUN_SECRET) return false;
  const match=/^(\d{10,13})\.([\da-f-]{36})\.([A-Za-z0-9_-]{43})$/.exec(adminCookie(request));
  if (!match || Number(match[1]) <= Date.now() || Number(match[1]) > Date.now()+ADMIN_SESSION_SECONDS*1000) return false;
  try {
    const key=await adminKey(env);
    const signature=Uint8Array.from(atob(match[3].replace(/-/g,"+").replace(/_/g,"/")+"="),c=>c.charCodeAt(0));
    return crypto.subtle.verify("HMAC",key,signature,new TextEncoder().encode(`${match[1]}.${match[2]}.${url.origin}`));
  } catch { return false; }
}
async function adminLogin(request, env, url) {
  if (request.method !== "POST") return json({ ok: false, error: "POST erforderlich" },405);
  if (!sameOrigin(request,url)) return json({ ok: false, error: "Andere Herkunft nicht erlaubt" },403);
  if (!env.RUN_SECRET) return json({ ok: false, error: "RUN_SECRET fehlt" },503);
  let secret;
  try { if (Number(request.headers.get("content-length"))>1024) throw Error(); secret=(await request.text()); if (secret.length>1024) throw Error(); secret=JSON.parse(secret).secret; } catch { return json({ok:false,error:"Ungültige Eingabe"},400); }
  if (typeof secret !== "string" || secret.length>256) return json({ok:false,error:"Unauthorized"},401);
  const [given,expected]=await Promise.all([secret,env.RUN_SECRET].map(s=>crypto.subtle.digest("SHA-256",new TextEncoder().encode(s))));
  const a=new Uint8Array(given),b=new Uint8Array(expected);
  let mismatch=0; for(let i=0;i<a.length;i++) mismatch|=a[i]^b[i];
  if (mismatch) return json({ok:false,error:"Unauthorized"},401);
  const expires=Date.now()+ADMIN_SESSION_SECONDS*1000,nonce=crypto.randomUUID();
  const payload=`${expires}.${nonce}`,key=await adminKey(env);
  const bytes=new Uint8Array(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(`${payload}.${url.origin}`)));
  const signature=btoa(String.fromCharCode(...bytes)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");
  return new Response(JSON.stringify({ok:true}),{headers:{"content-type":"application/json","cache-control":"no-store","set-cookie":`${ADMIN_COOKIE}=${payload}.${signature}; Path=/manage; Max-Age=${ADMIN_SESSION_SECONDS}; HttpOnly; Secure; SameSite=Strict`}});
}
function adminLogout(request,url) {
  if (request.method!=="POST") return json({ok:false,error:"POST erforderlich"},405);
  if (!sameOrigin(request,url)) return json({ok:false,error:"Andere Herkunft nicht erlaubt"},403);
  return new Response(JSON.stringify({ok:true}),{headers:{"content-type":"application/json","cache-control":"no-store","set-cookie":`${ADMIN_COOKIE}=; Path=/manage; Max-Age=0; HttpOnly; Secure; SameSite=Strict`}});
}

// Self-contained editor: the Worker can run without a static asset binding.
const EVENT_ADMIN_HTML = "<!doctype html>\n<html lang=\"de\">\n<head>\n<meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n<meta name=\"robots\" content=\"noindex,nofollow\"><title>Terminpflege – Verse Radar</title>\n<style>\n*{box-sizing:border-box}body{margin:0;background:#041016;color:#e2eaea;font:15px/1.5 system-ui,Arial,sans-serif}a{color:#70ceda;text-decoration:none}.site-header{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:18px 25px;border-bottom:1px solid #24404b}.site-header .brand{display:flex;flex-direction:column;color:#e2eaea;line-height:1}.brand strong{color:#79f05c}.brand small{font-size:8px;color:#7e969c;margin-top:5px}.site-header nav{display:flex;gap:14px;font-size:12px}.menu-toggle,.brand-radar{display:none}.page{padding:35px 20px;margin:0 auto}.eyebrow{color:#79f05c;font-size:10px;letter-spacing:.15em}.page-intro{color:#93aab0;max-width:700px}@media(max-width:720px){.site-header nav{display:none}}\n.event-editor{max-width:850px}.event-editor fieldset{border:1px solid #24404b;border-radius:8px;padding:20px;margin:22px 0}.event-editor label{display:block;margin:12px 0;font-size:13px}.event-editor input,.event-editor textarea,.event-editor select{display:block;box-sizing:border-box;width:100%;max-width:650px;margin-top:5px;background:#071219;border:1px solid #24404b;color:#e2eaea;border-radius:4px;padding:10px;font:inherit}.event-editor button{background:#184f29;color:#e2eaea;border:1px solid #5dcc62;border-radius:5px;padding:10px 15px;margin:8px 8px 0 0;cursor:pointer}.event-editor button:disabled{opacity:.45;cursor:default}.event-editor pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#071219;border:1px solid #24404b;padding:15px;border-radius:5px}.event-editor .entry{border-top:1px solid #24404b;margin-top:12px;padding-top:12px}\n</style>\n</head>\n<body>\n<header class=\"site-header\"><a class=\"brand\" href=\"/\"><span class=\"brand-radar\"><span></span></span><span><b>VERSE</b><strong>RADAR</strong><small>DEINE NEWS AUS DEM VERSE</small></span></a><button class=\"menu-toggle\">☰</button><nav><a href=\"/news.html\">News</a><a href=\"/patches.html\">Patch Notes</a><a href=\"/patch-history.html\">Patch History</a><a href=\"/free-fly.html\">Free Fly &amp; Events</a></nav></header>\n<main class=\"page event-editor\"><div class=\"eyebrow\">VERSE RADAR · VERWALTUNG</div><h1>Free Fly, Events & Ingame-Aktionen pflegen</h1><p class=\"page-intro\">Nur offizielle RSI-Quellen verwenden. Erst Vorschau prüfen, dann veröffentlichen. Abgelaufene Termine verschwinden automatisch; Aktionen ohne bestätigtes Ende bitte selbst entfernen.</p>\n<p><a href=\"/manage\">← Verwaltung</a></p><button id=\"load\" type=\"button\">Gespeicherten Stand laden</button>\n<fieldset><legend>Free Fly</legend>\n<label>Titel<input id=\"fly-title\" placeholder=\"Offizieller Name des Free Fly\"></label>\n<label>Offizieller RSI-Link<input id=\"fly-url\" type=\"url\" placeholder=\"https://robertsspaceindustries.com/…\"></label>\n<label>Beginn (deine lokale Uhrzeit)<input id=\"fly-start\" type=\"datetime-local\"></label>\n<label>Ende (deine lokale Uhrzeit)<input id=\"fly-end\" type=\"datetime-local\"></label>\n<label>Kurzer Hinweis (optional)<textarea id=\"fly-summary\" rows=\"3\" maxlength=\"400\"></textarea></label>\n<button id=\"fly-preview\" type=\"button\">Free Fly prüfen</button><button id=\"fly-disable\" type=\"button\">Free Fly deaktivieren – Vorschau</button>\n</fieldset>\n<fieldset><legend>Bestätigtes Event</legend>\n<label>Event-Meldung als Ausgangspunkt<select id=\"event-source\"><option value=\"\">Quelle selbst eingeben</option></select></label>\n<label>Name<input id=\"event-name\" placeholder=\"Name des Events\"></label>\n<label>Offizieller RSI-Link<input id=\"event-url\" type=\"url\" placeholder=\"https://robertsspaceindustries.com/…\"></label>\n<label>Beginn (deine lokale Uhrzeit)<input id=\"event-start\" type=\"datetime-local\"></label>\n<label>Ende (deine lokale Uhrzeit)<input id=\"event-end\" type=\"datetime-local\"></label>\n<label>Kurzer Hinweis (optional)<textarea id=\"event-summary\" rows=\"3\" maxlength=\"400\"></textarea></label>\n<button id=\"event-preview\" type=\"button\">Event prüfen</button><div id=\"saved-events\"></div>\n</fieldset>\n<fieldset><legend>Offizielle Ingame-Aktion</legend>\n<p class=\"page-intro\">Zum Beispiel Orison Relief Support: Aufgaben im Spiel und Belohnungen für den eigenen Account. Gemeinschaftsziele nur ausfüllen, wenn die offizielle Quelle sie bestätigt. Jede Belohnung gehört zum Ziel in derselben Zeile.</p>\n<label>Name<input id=\"activity-name\" maxlength=\"150\" placeholder=\"Name der Ingame-Aktion\"></label>\n<label>Offizielle RSI-Quelle<input id=\"activity-url\" type=\"url\" placeholder=\"https://robertsspaceindustries.com/spectrum/…\"></label>\n<label>Aufgaben (eine pro Zeile)<textarea id=\"activity-tasks\" rows=\"4\" placeholder=\"Aufgabe und erforderliche Menge laut Quelle\"></textarea></label>\n<label>Persönliche Belohnungen (eine pro Zeile)<textarea id=\"activity-rewards\" rows=\"4\" placeholder=\"Belohnung und Voraussetzung laut Quelle\"></textarea></label>\n<label>Gemeinschaftsziele (optional, eines pro Zeile)<textarea id=\"activity-group-goals\" rows=\"4\" placeholder=\"Nur wenn offiziell bestätigt\"></textarea></label>\n<label>Gemeinschaftsbelohnungen (optional, eine pro Zeile)<textarea id=\"activity-group-rewards\" rows=\"4\" placeholder=\"Reihenfolge wie bei den Zielen\"></textarea></label>\n<label>Beginn, falls bestätigt (deine lokale Uhrzeit)<input id=\"activity-start\" type=\"datetime-local\"></label>\n<label>Ende, falls bestätigt (deine lokale Uhrzeit)<input id=\"activity-end\" type=\"datetime-local\"></label>\n<label>Kurzer Hinweis (optional)<textarea id=\"activity-summary\" rows=\"3\" maxlength=\"400\"></textarea></label>\n<label>Eigenes Bild (optional, PNG/JPG/WebP, Original bis 12 MB)<input id=\"activity-image\" type=\"file\" accept=\"image/png,image/jpeg,image/webp\"></label><p class=\"page-intro\">Größere Bilder werden vor dem Upload im Browser auf höchstens 1600 Pixel und unter 1 MB verkleinert. Nur die verkleinerte Datei landet bei GitHub.</p><button id=\"upload-image\" type=\"button\">Bild hochladen</button><p id=\"upload-status\" role=\"status\"></p><img id=\"activity-image-preview\" alt=\"Vorschau des Bildes zur Ingame-Aktion\" style=\"max-width:100%;max-height:260px\" hidden>\n<button id=\"activity-preview\" type=\"button\">Ingame-Aktion prüfen</button><div id=\"saved-activities\"></div>\n</fieldset>\n<h2>Vorschau</h2><pre id=\"result\">Noch nichts geprüft.</pre><button id=\"publish\" type=\"button\" disabled>Geprüfte Änderung veröffentlichen</button>\n</main>\n<script>\nconst byId=id=>document.getElementById(id), output=byId('result');let pending=null,activityImageUrl='';\nfunction iso(id){const value=byId(id).value;return value&&Number.isFinite(new Date(value).getTime())?new Date(value).toISOString():''}\nfunction local(value){if(!value)return '';const d=new Date(value);if(!Number.isFinite(d.getTime()))return '';const n=v=>String(v).padStart(2,'0');return `${d.getFullYear()}-${n(d.getMonth()+1)}-${n(d.getDate())}T${n(d.getHours())}:${n(d.getMinutes())}`}\nfunction invalidate(){pending=null;byId('publish').disabled=true}\nasync function call(action,payload){const r=await fetch('/manage/events/'+action,{method:action==='state'?'GET':'POST',headers:{'content-type':'application/json'},body:payload?JSON.stringify(payload):undefined,cache:'no-store'});if(r.status===401){location.replace('/admin');throw Error('Sitzung abgelaufen. Bitte erneut anmelden.')}const body=await r.json();if(!r.ok||!body.ok)throw Error(body.error||`HTTP ${r.status}`);return body}\nfunction show(value){output.textContent=typeof value==='string'?value:JSON.stringify(value,null,2)}\nasync function load(){try{invalidate();const data=await call('state');const f=data.freeFly||{};byId('fly-title').value=f.title||'';byId('fly-url').value=f.sourceUrl||'';byId('fly-start').value=local(f.start);byId('fly-end').value=local(f.end);byId('fly-summary').value=f.summary||'';const root=byId('saved-events');root.replaceChildren();for(const event of data.events){const row=document.createElement('div');row.className='entry';const name=document.createElement('span');name.textContent=`RSI · ${event.name} · ${new Date(event.start).toLocaleString('de-DE')} – ${new Date(event.end).toLocaleString('de-DE')}`;const button=document.createElement('button');button.type='button';button.textContent='Entfernen – Vorschau';button.addEventListener('click',()=>preview({kind:'event',action:'remove',data:{sourceUrl:event.sourceUrl,start:event.start}}));row.append(name,button);root.append(row)}const acts=byId('saved-activities');acts.replaceChildren();for(const activity of data.activities){const row=document.createElement('div');row.className='entry';const label=document.createElement('span');label.textContent=`${activity.name} · ${activity.end?'bis '+new Date(activity.end).toLocaleString('de-DE'):'Ende nicht bestätigt'}`;const remove=document.createElement('button');remove.type='button';remove.textContent='Entfernen – Vorschau';remove.addEventListener('click',()=>preview({kind:'activity',action:'remove',data:{sourceUrl:activity.sourceUrl}}));row.append(label,remove);acts.append(row)}show(`Gespeichert: ${data.events.length} Event(s), ${data.activities.length} Ingame-Aktion(en). Free Fly: ${f.active?'eingetragen':'inaktiv'}.`)}catch(e){show(e.message)}}\nasync function suggestions(){try{const r=await fetch('/api/news',{cache:'no-store'});const news=await r.json();for(const item of news.filter(n=>['EVENT','FREE FLY'].includes(n.category)&&n.sourceUrl?.startsWith('https://robertsspaceindustries.com/')).slice(0,15)){const option=document.createElement('option');option.value=item.sourceUrl;option.textContent=item.title;option.dataset.title=item.title;byId('event-source').append(option)}}catch{}}\nasync function preview(payload){try{invalidate();const result=await call('preview',payload);pending={...payload,expectedSha:result.expectedSha};show({hinweis:'Bitte den Titel, Zeitraum und Original-Link prüfen. Erst danach veröffentlichen.',vorschau:result.proposal});byId('publish').disabled=false}catch(e){show(e.message)}}\nbyId('load').addEventListener('click',load);\nbyId('event-source').addEventListener('change',e=>{const option=e.target.selectedOptions[0];if(option?.dataset.title){byId('event-name').value=option.dataset.title;byId('event-url').value=option.value}invalidate()});\nbyId('fly-preview').addEventListener('click',()=>preview({kind:'freefly',action:'set',data:{title:byId('fly-title').value,sourceUrl:byId('fly-url').value,start:iso('fly-start'),end:iso('fly-end'),summary:byId('fly-summary').value}}));\nbyId('fly-disable').addEventListener('click',()=>preview({kind:'freefly',action:'disable'}));\nbyId('event-preview').addEventListener('click',()=>preview({kind:'event',action:'set',data:{name:byId('event-name').value,sourceUrl:byId('event-url').value,start:iso('event-start'),end:iso('event-end'),summary:byId('event-summary').value}}));\nasync function preparedActivityImage(file){\n  if(!['image/png','image/jpeg','image/webp'].includes(file.type))throw Error('Bitte PNG, JPG oder WebP auswählen.');\n  if(file.size>12*1024*1024)throw Error('Das Ausgangsbild ist größer als 12 MB.');\n  if(file.size<=900*1024)return file;\n  const bitmap=await createImageBitmap(file);\n  try{\n    for(const maxSide of [1600,1200,1000,800]){\n      const factor=Math.min(1,maxSide/Math.max(bitmap.width,bitmap.height));\n      const canvas=document.createElement('canvas');\n      canvas.width=Math.max(1,Math.round(bitmap.width*factor));\n      canvas.height=Math.max(1,Math.round(bitmap.height*factor));\n      canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);\n      for(const quality of [0.82,0.7,0.58]){\n        const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',quality));\n        if(blob?.type==='image/webp'&&blob.size<=900*1024)return blob;\n      }\n    }\n    throw Error('Bild konnte nicht ausreichend verkleinert werden. Bitte ein anderes Bild wählen.');\n  }finally{bitmap.close()}\n}\nbyId('activity-image').addEventListener('change',()=>{activityImageUrl='';byId('upload-status').textContent='Bild ausgewählt. Bitte erst hochladen.';byId('activity-image-preview').hidden=true;invalidate()});\nbyId('upload-image').addEventListener('click',async()=>{const file=byId('activity-image').files[0];if(!file){byId('upload-status').textContent='Bitte zuerst eine Bilddatei auswählen.';return}try{byId('upload-status').textContent='Bild wird vorbereitet …';const ready=await preparedActivityImage(file);byId('upload-status').textContent='Bild wird hochgeladen …';const r=await fetch('/manage/activities/image',{method:'POST',headers:{'content-type':ready.type},body:ready,cache:'no-store'});if(r.status===401){location.replace('/admin');return}const data=await r.json();if(!r.ok||!data.ok)throw Error(data.error||'Upload fehlgeschlagen');activityImageUrl=data.imageUrl;byId('activity-image-preview').src=data.imageUrl;byId('activity-image-preview').hidden=false;byId('upload-status').textContent='Bild hochgeladen ('+Math.round(data.size/1024)+' KB bei GitHub). Motiv in der Vorschau prüfen.';invalidate()}catch(e){byId('upload-status').textContent=e.message}});\nbyId('activity-preview').addEventListener('click',()=>{if(byId('activity-image').files[0]&&!activityImageUrl){show('Ausgewähltes Bild bitte vor der Prüfung hochladen.');return}preview({kind:'activity',action:'set',data:{name:byId('activity-name').value,sourceUrl:byId('activity-url').value,tasks:byId('activity-tasks').value,rewards:byId('activity-rewards').value,groupGoals:byId('activity-group-goals').value,groupRewards:byId('activity-group-rewards').value,start:iso('activity-start'),end:iso('activity-end'),summary:byId('activity-summary').value,imageUrl:activityImageUrl}})});\nbyId('publish').addEventListener('click',async()=>{if(!pending)return;try{const result=await call('publish',pending);invalidate();show(`Gespeichert: ${result.kind==='event'?'Event':result.kind==='activity'?'Ingame-Aktion':'Free Fly'}. Die öffentliche Seite übernimmt die Änderung aus den Website-Daten.`);await load()}catch(e){invalidate();show(e.message)}});\nfor(const input of document.querySelectorAll('input,textarea,select'))input.addEventListener('input',invalidate);\nsuggestions();\n</script>\n</body></html>\n";
function eventAdminPage() {
  return new Response(EVENT_ADMIN_HTML, { headers: {
    "content-type": "text/html;charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer",
    "x-frame-options": "DENY", "content-security-policy": "default-src 'none'; connect-src 'self'; img-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'"
  } });
}

// Self-contained editor: no optional Cloudflare static asset binding required.
const DEAL_ADMIN_HTML = "<!doctype html><html lang=\"de\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><meta name=\"robots\" content=\"noindex,nofollow\"><title>Deals pflegen – Verse Radar</title>\n<style>*{box-sizing:border-box}body{margin:0;background:#041016;color:#e2eaea;font:15px/1.5 system-ui,Arial,sans-serif}.site-header{padding:20px;border-bottom:1px solid #24404b}.site-header a{color:#79f05c;text-decoration:none;font-weight:700}.page{padding:35px 20px;max-width:850px;margin:auto}.eyebrow{color:#79f05c;font-size:10px;letter-spacing:.15em}.page-intro{color:#93aab0}.editor fieldset{border:1px solid #24404b;border-radius:8px;padding:20px;margin:22px 0}.editor label{display:block;margin:12px 0;font-size:13px}.editor input,.editor textarea,.editor select{display:block;width:100%;max-width:650px;margin-top:5px;background:#071219;border:1px solid #24404b;color:#e2eaea;border-radius:4px;padding:10px;font:inherit}.editor button{background:#184f29;color:#e2eaea;border:1px solid #5dcc62;border-radius:5px;padding:10px 15px;margin:8px 8px 0 0;cursor:pointer}.editor button:disabled{opacity:.45;cursor:default}.editor pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#071219;border:1px solid #24404b;padding:15px;border-radius:5px}.entry{border-top:1px solid #24404b;margin-top:12px;padding-top:12px}</style></head>\n<body><header class=\"site-header\"><a href=\"/\">VERSE RADAR</a></header><main class=\"page editor\"><div class=\"eyebrow\">VERSE RADAR · VERWALTUNG</div><h1>Game Packages pflegen</h1><p class=\"page-intro\">Alle Angaben mit der konkreten RSI-Shopseite abgleichen: angezeigter Preis, Schiff, Spielzugang und weitere Bestandteile. Der Eintrag bleibt längstens sieben Tage nach der letzten Prüfung sichtbar; ein früheres offizielles Ende gilt weiterhin.</p>\n<p><a href=\"/manage\">← Verwaltung</a></p><button id=\"load\" type=\"button\">Gespeicherte Angebote laden</button><button id=\"new-deal\" type=\"button\">Neues Angebot beginnen</button><p id=\"editor-mode\" class=\"page-intro\">Neues Angebot: Alle Angaben frisch eintragen. Nur der Bildkatalog merkt sich einen Bildlink pro Schiff.</p>\n<fieldset><legend>Geprüftes Game Package</legend>\n<label>Name<input id=\"name\" placeholder=\"Name des offiziellen Angebots\"></label>\n<label>Schiff suchen<input id=\"ship\" list=\"ship-names\" placeholder=\"z. B. Avenger Titan\"></label><datalist id=\"ship-names\"></datalist>\n<div id=\"ship-image-suggestion\" class=\"entry\" hidden><strong id=\"ship-image-title\"></strong><p>Für dieses Schiff ist bereits ein Bild gespeichert:</p><img id=\"ship-image-img\" alt=\"Gespeichertes Schiffsbild\" style=\"max-width:100%;max-height:180px;object-fit:contain\"><br><button id=\"use-image\" type=\"button\">Vorhandenes Bild verwenden</button><button id=\"other-image\" type=\"button\">Anderes Bild für dieses Angebot</button></div>\n<label>Konkrete RSI-Shopseite<input id=\"source\" type=\"url\" placeholder=\"https://robertsspaceindustries.com/pledge/Packages/…\"></label>\n<label>Direkter Bildlink zum Game Package oder Schiff (RSI)<input id=\"image-url\" type=\"url\" placeholder=\"https://robertsspaceindustries.com/i/…/source.webp\"></label><p class=\"page-intro\">Bei einer Slideshow den Bildlink in Chrome unter „Netzwerk → Img“ kopieren. Erlaubt sind direkte JPG-, PNG-, WebP- oder AVIF-Links von RSI. Das Bild in der Vorschau prüfen.</p>\n<label><input id=\"remember-image\" type=\"checkbox\" checked style=\"display:inline;width:auto\"> Dieses Bild als Standard für das Schiff merken</label><p class=\"page-intro\">Wenn schon ein Standardbild vorhanden ist, wird es nur nach deiner ausdrücklichen Auswahl ersetzt. Ein Sonderbild kann ausschließlich für dieses Angebot verwendet werden.</p>\n<label>Angezeigter Angebotspreis (bei EUR inklusive deutscher MwSt.)<input id=\"price\" inputmode=\"decimal\" placeholder=\"z. B. 58,24\"></label>\n<label>Angezeigter Vergleichspreis (optional, nur wenn auf der Quelle bestätigt)<input id=\"old-price\" inputmode=\"decimal\" placeholder=\"z. B. 77,65\"></label>\n<label>Währung<select id=\"currency\"><option value=\"EUR\">EUR</option><option value=\"USD\">USD</option></select></label><p class=\"page-intro\">Preise mit Komma eingeben. Europreise entsprechen dem für dich angezeigten Preis mit deutscher MwSt.; in anderen Ländern können sie abweichen.</p>\n<label>Qualifiziert sich nach deiner Prüfung für Referral?<select id=\"referral\"><option value=\"\">Bitte Ja oder Nein auswählen</option><option value=\"yes\">Ja</option><option value=\"no\">Nein</option></select></label><p class=\"page-intro\">Eine manuelle Einschätzung. Ob der Kauf tatsächlich zählt, richtet sich nach RSIs aktuellen Bedingungen und dem Account.</p>\n<label><input id=\"game-access-confirmed\" type=\"checkbox\" style=\"display:inline;width:auto\"> Star Citizen Digital Download ist auf der RSI-Shopseite als enthalten bestätigt</label>\n<label>Alle weiteren Bestandteile (einer pro Zeile)<textarea id=\"extras\" rows=\"6\" placeholder=\"Versicherung ...&#10;Skin ...&#10;Startguthaben ...\"></textarea></label><p class=\"page-intro\">Skins, Versicherungsdauer und andere Bestandteile nur nennen, wenn auf der Shopseite bestätigt. Falls keine weiteren Bestandteile aufgeführt sind, „Keine weiteren Bestandteile laut RSI“ eintragen.</p>\n<label>Offizielles Ende, falls angegeben (deine lokale Uhrzeit)<input id=\"until\" type=\"datetime-local\"></label><p class=\"page-intro\">Ohne offizielles Enddatum verschwindet der Eintrag spätestens sieben Tage nach deiner Prüfung.</p>\n<label>Kurzer Hinweis (optional)<textarea id=\"note\" rows=\"3\" maxlength=\"400\"></textarea></label>\n<button id=\"preview\" type=\"button\">Angebot prüfen</button><div id=\"saved\"></div>\n</fieldset><h2>Vorschau</h2><pre id=\"result\">Noch nichts geprüft.</pre><figure id=\"image-preview\" hidden><img id=\"image-preview-img\" alt=\"Vorschau des Game Packages\" style=\"max-width:100%;max-height:320px;object-fit:contain\"><figcaption id=\"image-preview-status\">Bildvorschau</figcaption></figure><button id=\"publish\" type=\"button\" disabled>Geprüfte Änderung veröffentlichen</button>\n</main><script>\nconst byId=id=>document.getElementById(id),output=byId('result');let pending=null,shipImages=[],editingSource=null,suggestedImage='';\nfunction iso(id){const value=byId(id).value;return value&&Number.isFinite(new Date(value).getTime())?new Date(value).toISOString():''}\nfunction local(value){if(!value)return '';const d=new Date(value);if(!Number.isFinite(d.getTime()))return '';const n=v=>String(v).padStart(2,'0');return `${d.getFullYear()}-${n(d.getMonth()+1)}-${n(d.getDate())}T${n(d.getHours())}:${n(d.getMinutes())}`}\nfunction invalidate(){pending=null;byId('publish').disabled=true;byId('image-preview').hidden=true;byId('image-preview-img').removeAttribute('src')}\nfunction shipKey(value){return String(value||'').normalize('NFKC').trim().replace(/\\s+/g,' ').toLocaleLowerCase('de-DE')}\nfunction shipMatch(){return shipImages.find(x=>shipKey(x.ship)===shipKey(byId('ship').value))}\nfunction shipSuggestion(){const match=shipMatch(),box=byId('ship-image-suggestion');box.hidden=!match;byId('remember-image').checked=!match;if(byId('image-url').value===suggestedImage)byId('image-url').value='';suggestedImage='';if(match){byId('ship-image-title').textContent=match.ship;byId('ship-image-img').src=match.imageUrl;if(!byId('image-url').value){byId('image-url').value=match.imageUrl;suggestedImage=match.imageUrl}}else byId('ship-image-img').removeAttribute('src')}\nfunction clearEditor(){for(const id of ['name','ship','source','image-url','price','old-price','referral','extras','until','note'])byId(id).value='';byId('currency').value='EUR';byId('game-access-confirmed').checked=false;byId('remember-image').checked=true;editingSource=null;suggestedImage='';byId('editor-mode').textContent='Neues Angebot: Alle Angaben frisch eintragen. Nur der Bildkatalog merkt sich einen Bildlink pro Schiff.';shipSuggestion();invalidate()}\nbyId('new-deal').addEventListener('click',()=>{clearEditor();show('Neues Angebot: alle Angaben frisch eintragen. Für ein weiteres Angebot eine eigene RSI-Shopseite verwenden.')});\nbyId('ship').addEventListener('input',shipSuggestion);\nbyId('use-image').addEventListener('click',()=>{const match=shipMatch();if(!match)return;byId('image-url').value=match.imageUrl;suggestedImage=match.imageUrl;byId('remember-image').checked=false;invalidate()});\nbyId('other-image').addEventListener('click',()=>{byId('image-url').value='';suggestedImage='';byId('remember-image').checked=false;byId('image-url').focus();invalidate()});\nasync function call(action,payload){const r=await fetch('/manage/deals/'+action,{method:action==='state'?'GET':'POST',headers:{'content-type':'application/json'},body:payload?JSON.stringify(payload):undefined,cache:'no-store'});if(r.status===401){location.replace('/admin');throw Error('Sitzung abgelaufen. Bitte erneut anmelden.')}const body=await r.json();if(!r.ok||!body.ok)throw Error(body.error||`HTTP ${r.status}`);return body}\nfunction show(value){output.textContent=typeof value==='string'?value:JSON.stringify(value,null,2)}\nfunction money(value,currency){return value==null?null:new Intl.NumberFormat('de-DE',{style:'currency',currency}).format(value)}\nasync function preview(payload){try{invalidate();const result=await call('preview',payload);pending={...payload,expectedSha:result.expectedSha,expectedCatalogSha:result.expectedCatalogSha};show({hinweis:'Bild, Lieferumfang, Spielzugang, angezeigte Preise und offiziellen Package-Link vor dem Veröffentlichen mit RSI abgleichen.',bildAlsStandardSpeichern:result.catalogChanged,vorschau:result.proposal.map(d=>({...d,price:money(d.price,d.currency),oldPrice:money(d.oldPrice,d.currency),referralEligible:typeof d.referralEligible==='boolean'?(d.referralEligible?'Ja':'Nein'):null}))});if(payload.action==='set'){byId('image-preview').hidden=false;byId('image-preview-status').textContent='Bild wird geladen …';byId('image-preview-img').src=result.proposal.at(-1).imageUrl}else byId('publish').disabled=false}catch(e){show(e.message)}}\nbyId('image-preview-img').addEventListener('load',()=>{byId('image-preview-status').textContent='Bild geladen – Motiv bitte mit dem Game Package vergleichen.';if(pending?.action==='set')byId('publish').disabled=false});\nbyId('image-preview-img').addEventListener('error',()=>{byId('image-preview-status').textContent='Bild kann nicht geladen werden. Bitte Bildadresse korrigieren und erneut prüfen.';invalidate();byId('image-preview').hidden=false});\nasync function load(){try{invalidate();const state=await call('state');shipImages=state.shipImages||[];const names=byId('ship-names');names.replaceChildren();for(const item of shipImages){const option=document.createElement('option');option.value=item.ship;names.append(option)}shipSuggestion();const root=byId('saved');root.replaceChildren();for(const deal of state.deals){const row=document.createElement('div');row.className='entry';const name=document.createElement('span');name.textContent=`${deal.name||'Unbenannt'} · ${money(deal.price,deal.currency)||'?'} · geprüft: ${deal.checkedAt?new Date(deal.checkedAt).toLocaleString('de-DE'):'nicht bestätigt'}`;const fill=document.createElement('button');fill.textContent='Erneut prüfen';fill.type='button';fill.addEventListener('click',()=>{clearEditor();editingSource=deal.sourceUrl;byId('editor-mode').textContent=`Erneut prüfen: ${deal.name}. Alle Angaben samt Shopseite frisch eintragen; nur ein bekanntes Schiffsbild wird beim Tippen des Schiffsnamens vorgeschlagen.`;show('Angebot zum erneuten Prüfen gewählt. Bitte alle Felder neu aus der aktuellen RSI-Shopseite ausfüllen. Der vorhandene Eintrag wird erst nach Vorschau und Veröffentlichung ersetzt.')});const remove=document.createElement('button');remove.textContent='Entfernen – Vorschau';remove.type='button';remove.addEventListener('click',()=>preview({action:'remove',data:{sourceUrl:deal.sourceUrl}}));row.append(name,fill,remove);root.append(row)}show(`Gespeichert: ${state.deals.length} Angebot(e), ${shipImages.length} Schiffsbild(er). Beim erneuten Prüfen alle Angaben frisch eintragen.`)}catch(e){show(e.message)}}\nbyId('load').addEventListener('click',load);\nbyId('preview').addEventListener('click',()=>preview({action:'set',replaceExistingSource:editingSource,data:{name:byId('name').value,type:'Game Package',sourceUrl:byId('source').value,imageUrl:byId('image-url').value,saveImageToCatalog:byId('remember-image').checked,price:byId('price').value,oldPrice:byId('old-price').value,currency:byId('currency').value,referralEligible:byId('referral').value,ship:byId('ship').value,gameAccessConfirmed:byId('game-access-confirmed').checked,extras:byId('extras').value,validUntil:iso('until'),note:byId('note').value}}));\nbyId('publish').addEventListener('click',async()=>{if(!pending)return;try{const result=await call('publish',pending);clearEditor();await load();show(`Änderung gespeichert. Der sichtbare Stand ist auf /deals.html und /api/deals prüfbar. Gespeicherte Angebote: ${result.count}.${result.catalogWarning?' '+result.catalogWarning:''}`)}catch(e){invalidate();show(e.message)}});\nfor(const field of document.querySelectorAll('input,textarea,select'))field.addEventListener('input',invalidate);\n</script></body></html>\n";
function dealAdminPage() {
  return new Response(DEAL_ADMIN_HTML, { headers: {
    "content-type": "text/html;charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer",
    "x-frame-options": "DENY", "content-security-policy": "default-src 'none'; connect-src 'self'; img-src https://robertsspaceindustries.com https://*.robertsspaceindustries.com; script-src 'unsafe-inline'; style-src 'unsafe-inline'"
  } });
}

const REFERRAL_ADMIN_HTML = "<!doctype html>\n<html lang=\"de\">\n<head>\n<meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n<meta name=\"robots\" content=\"noindex,nofollow\"><title>Referral-Sonderaktion – Verse Radar</title>\n<style>\n*{box-sizing:border-box}body{margin:0 auto;max-width:850px;padding:24px;background:#041016;color:#e2eaea;font:15px/1.55 system-ui,Arial,sans-serif}a{color:#70ceda}h1{color:#79f05c}fieldset{border:1px solid #24404b;border-radius:8px;padding:20px;margin:22px 0}label{display:block;margin:14px 0}input,textarea{display:block;width:100%;margin-top:6px;padding:10px;color:#e2eaea;background:#071219;border:1px solid #24404b;border-radius:4px;font:inherit}button{padding:10px 15px;margin:8px 8px 0 0;color:#e2eaea;background:#184f29;border:1px solid #5dcc62;border-radius:5px;cursor:pointer}button:disabled{opacity:.5;cursor:default}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#071219;border:1px solid #24404b;padding:15px}p{color:#b1c5c9}img{max-width:100%;max-height:320px;object-fit:contain}\n</style>\n</head>\n<body>\n<p><a href=\"/manage\">← Verwaltung</a></p><h1>Referral-Sonderaktion pflegen</h1>\n<p>Nur eine von RSI bestätigte zeitlich begrenzte Referral-Aktion eintragen. Sie erscheint ausschließlich auf der Referral-Seite, zusätzlich zum normalen Bonus. Start und Ende aus der offiziellen Quelle übernehmen; danach verschwindet sie automatisch.</p>\n<button id=\"load\" type=\"button\">Gespeicherten Stand laden</button>\n<fieldset><legend>Zusätzlicher Referral-Bonus</legend>\n<label>Titel der Aktion<input id=\"title\" maxlength=\"150\" placeholder=\"Offizieller Name der Aktion\"></label>\n<label>Offizieller RSI-Link zur Aktion<input id=\"source\" type=\"url\" placeholder=\"https://robertsspaceindustries.com/…\"></label>\n<label>Direkter Bildlink von RSI (optional)<input id=\"image\" type=\"url\" placeholder=\"https://robertsspaceindustries.com/i/…/source.webp\"></label>\n<p>Nur einen direkten JPG-, PNG-, WebP- oder AVIF-Link von RSI verwenden. Das Motiv vor der Veröffentlichung prüfen; es wird kein Bild hochgeladen.</p>\n<label>Beginn (deine lokale Uhrzeit)<input id=\"start\" type=\"datetime-local\"></label>\n<label>Ende (deine lokale Uhrzeit)<input id=\"end\" type=\"datetime-local\"></label>\n<label>Was erhält der neue Spieler zusätzlich? Eine Belohnung pro Zeile<textarea id=\"rewards\" rows=\"6\" placeholder=\"Rüstungsset&#10;Rucksack&#10;Multitool\"></textarea></label>\n<label>Zusätzlicher Hinweis laut RSI (optional)<textarea id=\"note\" rows=\"3\" maxlength=\"400\"></textarea></label>\n<p>Die Liste zeigt nur Belohnungen für den neuen Spieler. Der öffentliche Text empfiehlt ein Game Package für mindestens 40 USD während der Aktion als klaren Teilnahmeweg. Referral-Code bei der Registrierung oder innerhalb von 24 Stunden danach eintragen. Das Konto darf früher erstellt worden sein, wenn die erstmalige Qualifikation als neuer Backer in der Aktion liegt. Die offizielle Meldung ist maßgeblich.</p>\n<button id=\"preview\" type=\"button\">Sonderaktion prüfen</button><button id=\"disable\" type=\"button\">Sonderaktion beenden – Vorschau</button>\n</fieldset>\n<h2>Vorschau</h2><pre id=\"result\" role=\"status\">Noch nichts geprüft.</pre>\n<figure id=\"image-preview\" hidden><img id=\"preview-img\" alt=\"Vorschau des Referral-Aktionsbildes\"><figcaption id=\"image-status\">Bild wird geladen …</figcaption></figure>\n<button id=\"publish\" type=\"button\" disabled>Geprüfte Änderung veröffentlichen</button>\n<script>\nconst byId=id=>document.getElementById(id);let pending=null;\nfunction iso(id){const value=byId(id).value;return value&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():''}\nfunction invalidate(){pending=null;byId('publish').disabled=true;byId('image-preview').hidden=true;byId('preview-img').removeAttribute('src')}\nfunction show(value){byId('result').textContent=typeof value==='string'?value:JSON.stringify(value,null,2)}\nasync function call(action,payload){const r=await fetch('/manage/referral/'+action,{method:action==='state'?'GET':'POST',headers:{'content-type':'application/json'},body:payload?JSON.stringify(payload):undefined,cache:'no-store'});if(r.status===401){location.replace('/admin');throw Error('Sitzung abgelaufen. Bitte erneut anmelden.')}const data=await r.json();if(!r.ok||!data.ok)throw Error(data.error||`HTTP ${r.status}`);return data}\nasync function load(){try{invalidate();const result=await call('state');const s=result.special;show(s?{gespeichert:s,hinweis:'Für eine neue Prüfung alle Felder anhand der aktuellen RSI-Quelle frisch ausfüllen.'}:'Noch keine Sonderaktion gespeichert. Der normale Referral-Bonus bleibt sichtbar.')}catch(e){show(e.message)}}\nasync function preview(payload){try{invalidate();const result=await call('preview',payload);pending={...payload,expectedSha:result.expectedSha};show({hinweis:'Zeitraum, zusätzliche Belohnungen, Bild und Teilnahmebedingungen anhand der offiziellen RSI-Quelle prüfen.',vorschau:result.proposal});if(payload.action==='set'&&result.proposal.imageUrl){byId('image-preview').hidden=false;byId('image-status').textContent='Bild wird geladen …';byId('preview-img').src=result.proposal.imageUrl}else byId('publish').disabled=false}catch(e){show(e.message)}}\nbyId('preview-img').addEventListener('load',()=>{byId('image-status').textContent='Bild geladen – Motiv bitte mit RSI abgleichen.';if(pending?.action==='set')byId('publish').disabled=false});\nbyId('preview-img').addEventListener('error',()=>{byId('image-status').textContent='Bild kann nicht geladen werden. Bitte einen anderen Bildlink verwenden und erneut prüfen.';pending=null;byId('publish').disabled=true;byId('image-preview').hidden=false});\nbyId('load').addEventListener('click',load);\nbyId('preview').addEventListener('click',()=>preview({action:'set',data:{title:byId('title').value,sourceUrl:byId('source').value,imageUrl:byId('image').value,start:iso('start'),end:iso('end'),rewards:byId('rewards').value,note:byId('note').value}}));\nbyId('disable').addEventListener('click',()=>preview({action:'disable'}));\nbyId('publish').addEventListener('click',async()=>{if(!pending)return;try{const result=await call('publish',pending);invalidate();show(result.published?'Änderung veröffentlicht. Die Anzeige auf /referral.html richtet sich automatisch nach dem Zeitraum.':'Nicht gespeichert.');await load()}catch(e){invalidate();show(e.message)}});\nfor(const field of document.querySelectorAll('input,textarea'))field.addEventListener('input',invalidate);\n</script></body></html>\n";
function referralAdminPage() {
  return new Response(REFERRAL_ADMIN_HTML, { headers: {
    "content-type": "text/html;charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer",
    "x-frame-options": "DENY", "content-security-policy": "default-src 'none'; connect-src 'self'; img-src https://robertsspaceindustries.com https://*.robertsspaceindustries.com; script-src 'unsafe-inline'; style-src 'unsafe-inline'"
  } });
}

const REFERRAL_SPECIAL_PATH = "public/data/referral-special.json";
function validStoredReferralSpecial(item, now = Date.now()) {
  if (!item || item.active !== true || typeof item.title !== "string" || !item.title.trim() || !Array.isArray(item.rewards) || !item.rewards.length || item.rewards.some(x=>typeof x!=="string"||!x.trim())) return false;
  if (typeof item.sourceUrl!=="string" || !officialReferralSource(item.sourceUrl) || item.imageUrl && !officialReferralImage(item.imageUrl)) return false;
  return typeof item.start==="string" && typeof item.end==="string" && Number.isFinite(Date.parse(item.start)) && Number.isFinite(Date.parse(item.end)) && Date.parse(item.start)<=now && now<Date.parse(item.end) && Date.parse(item.end)>Date.parse(item.start);
}
function officialReferralSource(value) {
  try {const u=new URL(value);return u.protocol==="https:" && ["robertsspaceindustries.com","www.robertsspaceindustries.com"].includes(u.hostname) && !u.username && !u.password && !u.port;}
  catch {return false;}
}
function officialReferralImage(value) {
  try {const u=new URL(value);return u.protocol==="https:" && (u.hostname==="robertsspaceindustries.com" || u.hostname.endsWith(".robertsspaceindustries.com")) && !u.username && !u.password && !u.port && /\.(?:png|jpe?g|webp|avif)$/i.test(u.pathname);}
  catch {return false;}
}
function publicReferralSpecial(data) {
  return validStoredReferralSpecial(data) ? {active:true,title:data.title,sourceUrl:data.sourceUrl,imageUrl:data.imageUrl||"",start:data.start,end:data.end,rewards:data.rewards,note:data.note||""} : {active:false};
}
async function referralSpecialState(env) {
  const current=await getGithubJSONStrict(env,REFERRAL_SPECIAL_PATH,{allowMissing:true});
  if (current.data!==null && (!current.data || typeof current.data!=="object" || Array.isArray(current.data))) throw Error("Gespeicherte Referral-Sonderaktion ungültig; nichts verändert.");
  return {special:current.data};
}
async function editReferralSpecial(env,input,publish) {
  if (!["set","disable"].includes(input?.action)) throw Error("Unbekannte Aktion.");
  const current=await getGithubJSONStrict(env,REFERRAL_SPECIAL_PATH,{allowMissing:true});
  if (current.data!==null && (!current.data || typeof current.data!=="object" || Array.isArray(current.data))) throw Error("Gespeicherte Referral-Sonderaktion ungültig; nichts verändert.");
  if (publish && (input.expectedSha??null)!==(current.sha??null)) {const e=new Error("Daten wurden seit der Vorschau geändert. Bitte erneut prüfen.");e.status=409;throw e;}
  let next;
  if (input.action==="disable") next={active:false};
  else {
    const title=String(input.data?.title||"").trim();
    if (title.length<5 || title.length>150) throw Error("Titel der Sonderaktion (5–150 Zeichen) eintragen.");
    const sourceUrl=officialEventLink(input.data?.sourceUrl);
    const start=editorDate(input.data?.start),end=editorDate(input.data?.end);
    if (Date.parse(end)<=Date.parse(start) || Date.parse(end)<=Date.now()) throw Error("Ein zukünftiges Ende nach dem Beginn eintragen.");
    const imageUrl=input.data?.imageUrl ? officialPackageImage(input.data.imageUrl) : "";
    const rewards=activityLines(input.data?.rewards,"Zusätzliche Belohnungen");
    const note=String(input.data?.note||"").trim();
    if (note.length>400) throw Error("Hinweis zu lang (maximal 400 Zeichen).");
    next={active:true,title,sourceUrl,imageUrl,start,end,rewards,note,checkedAt:new Date().toISOString()};
  }
  if (publish) await putGithub(env,REFERRAL_SPECIAL_PATH,JSON.stringify(next,null,2)+"\n",`Verse Radar ${VERSION}: referral special ${input.action}`,current.sha);
  return {published:publish,proposal:next,expectedSha:publish?undefined:current.sha};
}

const FREE_FLY_DATA_PATH = "public/data/freefly.json";
const EVENT_DATA_PATH = "public/data/events.json";
const ACTIVITY_DATA_PATH = "public/data/activities.json";
const ACTIVITY_IMAGE_DIR = "public/activity-images/";
const MAX_ACTIVITY_IMAGE_BYTES = 1024 * 1024;
const DEAL_DATA_PATH = "public/data/deals.json";
const SHIP_IMAGES_PATH = "public/data/ship-images.json";

function validReferralUrl(raw) {
  try {
    const url = new URL(raw);
    const code = url.searchParams.get("referral") || "";
    if (url.protocol !== "https:" || !["robertsspaceindustries.com","www.robertsspaceindustries.com"].includes(url.hostname) || url.pathname.replace(/\/$/, "") !== "/enlist" || url.username || url.password || url.port || !/^[a-z0-9-]{4,32}$/i.test(code) || /^DEINCODE$/i.test(code)) return null;
    url.hash = "";
    return url.toString();
  } catch { return null; }
}

async function getDealsStrict(env) {
  const result = await getGithubJSONStrict(env, DEAL_DATA_PATH);
  if (!Array.isArray(result.data)) throw Error("Gespeicherte Angebote ungültig; nichts verändert.");
  return result;
}

async function getShipImagesStrict(env) {
  const result = await getGithubJSONStrict(env, SHIP_IMAGES_PATH, { allowMissing: true });
  if (result.data === null) return { data: [], sha: null };
  if (!Array.isArray(result.data) || result.data.some(x => !x || typeof x.ship !== "string" || typeof x.imageUrl !== "string")) throw Error("Gespeicherter Schiffsbilder-Katalog ungültig; nichts verändert.");
  return result;
}

function shipKey(name) { return String(name).normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("de-DE"); }

function checkedDealFields(data) {
  const name = String(data?.name || "").trim();
  if (name.length < 5 || name.length > 150) throw Error("Angebotsname muss zwischen 5 und 150 Zeichen haben.");
  if (data.type !== "Game Package") throw Error("Nur Game Packages können veröffentlicht werden.");
  const sourceUrl = officialEventLink(data.sourceUrl);
  if (!/^\/(?:en\/)?pledge\/Packages\/[^/]+\/?$/i.test(new URL(sourceUrl).pathname)) throw Error("Bitte die konkrete offizielle RSI-Shopseite eines Game Packages verlinken.");
  const imageUrl = officialPackageImage(data.imageUrl);
  const price = dealAmount(data.price, "Angebotspreis");
  const oldPrice = data.oldPrice === "" || data.oldPrice == null ? null : dealAmount(data.oldPrice, "Vergleichspreis");
  if (oldPrice !== null && oldPrice <= price) throw Error("Vergleichspreis muss höher als der Angebotspreis sein.");
  if (!["USD", "EUR"].includes(data.currency)) throw Error("Währung auswählen.");
  if (!["yes", "no"].includes(data.referralEligible)) throw Error("Referral-Anforderung bitte mit Ja oder Nein beantworten.");
  const referralEligible = data.referralEligible === "yes";
  const ship = String(data.ship || "").trim();
  const extras = String(data.extras || "").split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  if (!ship || ship.length > 150) throw Error("Schiff aus dem Package eintragen (maximal 150 Zeichen).");
  if (data.gameAccessConfirmed !== true) throw Error("Star Citizen Spielzugang im Package bitte auf RSI bestätigen.");
  if (!extras.length || extras.length > 20 || extras.some(x => x.length > 150)) throw Error("Weitere Bestandteile einzeln eintragen; falls keine vorhanden sind: ‚Keine weiteren Bestandteile laut RSI‘.");
  const checkedAt = new Date().toISOString();
  const officialEndProvided = Boolean(data.validUntil);
  const validUntil = officialEndProvided ? editorDate(data.validUntil) : new Date(Date.parse(checkedAt) + 7 * 86400000).toISOString();
  if (Date.parse(validUntil) <= Date.now()) throw Error("Das Angebot ist bereits abgelaufen.");
  const note = String(data.note || "").trim();
  if (note.length > 400) throw Error("Hinweis zu lang (maximal 400 Zeichen).");
  return { name, type: data.type, sourceUrl, imageUrl, price, oldPrice, currency: data.currency, referralEligible, gameAccessConfirmed: true, contents: { ship, extras }, note, validUntil, checkedAt, officialEndProvided, active: true };
}

function dealAmount(raw, label) {
  const value = String(raw);
  if (!/^\d+(?:[,.]\d{1,2})?$/.test(value)) throw Error(`${label} mit Komma eingeben, z. B. 58,24.`);
  const amount = Number(value.replace(",", "."));
  if (!Number.isFinite(amount) || amount <= 0 || amount >= 100000) throw Error(`${label} ist ungültig.`);
  return amount;
}

function officialPackageImage(raw) {
  if (typeof raw !== "string" || raw.length > 1200) throw Error("Bitte einen direkten Bildlink von RSI angeben.");
  let url;
  try { url = new URL(raw.trim()); } catch { throw Error("Bitte einen direkten Bildlink von RSI angeben."); }
  if (url.protocol !== "https:" || !(url.hostname === "robertsspaceindustries.com" || url.hostname.endsWith(".robertsspaceindustries.com")) || url.username || url.password || url.port || !/\.(?:png|jpe?g|webp|avif)$/i.test(url.pathname)) throw Error("Das Bild benötigt einen direkten HTTPS-Link zu einer JPG-, PNG-, WebP- oder AVIF-Datei von RSI.");
  url.hash = "";
  return url.toString();
}

async function editDealData(env, input, publish) {
  if (!["set", "remove"].includes(input?.action)) throw Error("Unbekannte Angebotsaktion.");
  const [current, catalog] = await Promise.all([getDealsStrict(env), getShipImagesStrict(env)]);
  if (publish && (!input.expectedSha || input.expectedSha !== current.sha)) {
    const error = new Error("Angebote wurden seit der Vorschau geändert. Bitte erneut prüfen."); error.status = 409; throw error;
  }
  let next;
  if (input.action === "remove") {
    const url = officialEventLink(input.data?.sourceUrl);
    if (!current.data.some(x => x.sourceUrl === url)) throw Error("Angebot nicht gefunden.");
    next = current.data.filter(x => x.sourceUrl !== url);
  } else {
    const entry = checkedDealFields(input.data);
    const existing = current.data.some(x => x.sourceUrl === entry.sourceUrl);
    const replaceSource = input.replaceExistingSource || null;
    if (existing && replaceSource !== entry.sourceUrl) throw Error("Diese Shopseite ist bereits als Angebot gespeichert. Zum Erneuern beim gespeicherten Angebot ‚Erneut prüfen‘ wählen und alle Angaben frisch eintragen.");
    if (!existing && replaceSource) throw Error("Das gewählte Angebot wurde nicht gefunden. Bitte als neues Angebot beginnen.");
    next = current.data.filter(x => x.sourceUrl !== entry.sourceUrl).concat(entry);
  }
  const saveImage = input.action === "set" && input.data.saveImageToCatalog === true;
  const entry = saveImage ? next.at(-1) : null;
  const oldImage = entry && catalog.data.find(x => shipKey(x.ship) === shipKey(entry.contents.ship));
  const catalogChanged = saveImage && oldImage?.imageUrl !== entry.imageUrl;
  if (publish && catalogChanged && input.expectedCatalogSha !== catalog.sha) {
    const error = new Error("Schiffsbilder wurden seit der Vorschau geändert. Bitte erneut prüfen."); error.status = 409; throw error;
  }
  let catalogSaved = !catalogChanged, catalogWarning = null;
  if (publish) {
    await putGithub(env, DEAL_DATA_PATH, JSON.stringify(next, null, 2) + "\n", `Verse Radar ${VERSION}: deal ${input.action}`, current.sha);
    if (catalogChanged) {
      const updated = catalog.data.filter(x => shipKey(x.ship) !== shipKey(entry.contents.ship)).concat({ ship: entry.contents.ship, imageUrl: entry.imageUrl, sourceUrl: entry.sourceUrl });
      try {
        await putGithub(env, SHIP_IMAGES_PATH, JSON.stringify(updated, null, 2) + "\n", `Verse Radar ${VERSION}: ship image ${entry.contents.ship}`, catalog.sha);
        catalogSaved = true;
      } catch (error) { catalogWarning = `Angebot veröffentlicht, aber Bildkatalog nicht gespeichert: ${error.message}`; }
    }
  }
  return { published: publish, action: input.action, count: next.length, proposal: next, expectedSha: publish ? undefined : current.sha, expectedCatalogSha: publish ? undefined : catalog.sha, catalogChanged, catalogSaved, catalogWarning };
}

function officialEventLink(raw) {
  let url;
  try { url = new URL(raw); } catch { throw Error("Offizieller RSI-Link fehlt oder ist ungültig."); }
  if (url.protocol !== "https:" || !["robertsspaceindustries.com","www.robertsspaceindustries.com"].includes(url.hostname) || url.username || url.password || url.port) throw Error("Nur HTTPS-Links zu robertsspaceindustries.com erlaubt.");
  url.hash = "";
  return url.toString();
}

function editorDate(raw) {
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/.test(raw) || !Number.isFinite(Date.parse(raw))) throw Error("Start und Ende benötigen ein vollständiges Datum mit Uhrzeit und Zeitzone.");
  return new Date(raw).toISOString();
}

function checkedEventFields(data) {
  if (!data || typeof data !== "object") throw Error("Termindaten fehlen.");
  const start = editorDate(data.start), end = editorDate(data.end);
  if (Date.parse(end) <= Date.parse(start)) throw Error("Ende muss nach dem Beginn liegen.");
  if (Date.parse(end) <= Date.now()) throw Error("Ein bereits beendeter Termin kann nicht veröffentlicht werden.");
  const sourceUrl = officialEventLink(data.sourceUrl);
  const summary = String(data.summary || "").trim();
  if (summary.length > 400) throw Error("Beschreibung zu lang (maximal 400 Zeichen).");
  return { start, end, sourceUrl, summary };
}

function activityImage(raw) {
  if (!raw) return "";
  if (typeof raw!=="string" || !/^\/activity-image\/[a-f0-9]{64}\.(?:png|jpg|webp)$/.test(raw)) throw Error("Bitte ein Bild über den Upload für Ingame-Aktionen auswählen.");
  return raw;
}
function activityLines(value,label,required=true) {
  const lines=String(value||"").split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  if ((required&&!lines.length) || lines.length>12 || lines.some(x=>x.length>240)) throw Error(label+": "+(required?"1–12":"höchstens 12")+" Zeilen mit höchstens 240 Zeichen je Zeile eintragen.");
  return lines;
}
function checkedActivityFields(data) {
  const name=String(data?.name||"").trim();
  if (name.length<5 || name.length>150) throw Error("Name der Ingame-Aktion (5–150 Zeichen) eintragen.");
  const sourceUrl=officialEventLink(data.sourceUrl);
  const start=data.start?editorDate(data.start):null, end=data.end?editorDate(data.end):null;
  if (end && (!start || Date.parse(end)<=Date.parse(start) || Date.parse(end)<=Date.now())) throw Error("Für ein Enddatum einen früheren Beginn und ein zukünftiges Ende eintragen.");
  const summary=String(data.summary||"").trim();
  if (summary.length>400) throw Error("Beschreibung zu lang (maximal 400 Zeichen).");
  const groupGoals=activityLines(data.groupGoals,"Gemeinschaftsziele",false),groupRewards=activityLines(data.groupRewards,"Gemeinschaftsbelohnungen",false);
  if (groupGoals.length!==groupRewards.length) throw Error("Für jedes Gemeinschaftsziel eine zugehörige Belohnung in derselben Zeile eintragen.");
  return {name,type:"Ingame Activity",sourceUrl,start,end,summary,tasks:activityLines(data.tasks,"Aufgaben"),rewards:activityLines(data.rewards,"Persönliche Belohnungen"),groupGoals,groupRewards,imageUrl:activityImage(data.imageUrl),active:true,checkedAt:new Date().toISOString()};
}
async function assertActivityImageExists(env,url) {
  if (!url) return;
  const [owner,repo]=String(env.GITHUB_REPO||"").split("/");
  if (!env.GITHUB_TOKEN || !owner || !repo) throw Error("GitHub-Konfiguration für Bilder fehlt.");
  const path=ACTIVITY_IMAGE_DIR+url.slice("/activity-image/".length);
  const r=await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(env.GITHUB_BRANCH||"main")}`,{headers:gh(env.GITHUB_TOKEN)});
  if (!r.ok) throw Error("Hochgeladenes Bild nicht gefunden. Bitte erneut hochladen.");
}

function imageFormat(bytes) {
  if (bytes.length>=24 && bytes.slice(0,8).every((x,i)=>x===[137,80,78,71,13,10,26,10][i])) return {ext:"png",mime:"image/png"};
  if (bytes.length>=4 && bytes[0]===255 && bytes[1]===216 && bytes.at(-2)===255 && bytes.at(-1)===217) return {ext:"jpg",mime:"image/jpeg"};
  if (bytes.length>=16 && new TextDecoder().decode(bytes.slice(0,4))==="RIFF" && new TextDecoder().decode(bytes.slice(8,12))==="WEBP") return {ext:"webp",mime:"image/webp"};
  return null;
}
async function uploadActivityImage(request,env) {
  if (Number(request.headers.get("content-length"))>MAX_ACTIVITY_IMAGE_BYTES) {const e=Error("Bild zu groß (maximal 1 MB nach Optimierung).");e.status=413;throw e;}
  const reader=request.body?.getReader();
  if (!reader) throw Error("Bilddatei fehlt.");
  const parts=[];let total=0;
  while (true) {
    const {done,value}=await reader.read();if(done)break;
    total+=value.length;
    if(total>MAX_ACTIVITY_IMAGE_BYTES){await reader.cancel();const e=Error("Bild zu groß (maximal 1 MB nach Optimierung).");e.status=413;throw e;}
    parts.push(value);
  }
  const bytes=new Uint8Array(total);let offset=0;
  for(const part of parts){bytes.set(part,offset);offset+=part.length;}
  const format=imageFormat(bytes);
  if (!bytes.length || bytes.length>MAX_ACTIVITY_IMAGE_BYTES || !format) {const e=Error("Nur vollständige PNG-, JPG- oder WebP-Bilder bis 1 MB hochladen.");e.status=413;throw e;}
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),x=>x.toString(16).padStart(2,"0")).join("");
  const filename=`${digest}.${format.ext}`,path=ACTIVITY_IMAGE_DIR+filename;
  const [owner,repo]=String(env.GITHUB_REPO||"").split("/");
  if (!env.GITHUB_TOKEN || !owner || !repo) throw Error("GitHub-Konfiguration fehlt.");
  const r=await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(env.GITHUB_BRANCH||"main")}`,{headers:gh(env.GITHUB_TOKEN)});
  if (r.status===404) await putGithub(env,path,bytes,`Verse Radar ${VERSION}: ingame activity image`,null);
  else if (!r.ok) throw Error(`Bildspeicher nicht erreichbar (HTTP ${r.status}).`);
  return {imageUrl:`/activity-image/${filename}`,size:bytes.length};
}
async function serveActivityImage(env,pathname) {
  const match=/^\/activity-image\/([a-f0-9]{64}\.(?:png|jpg|webp))$/.exec(pathname);
  if (!match || !env.GITHUB_TOKEN || !env.GITHUB_REPO) return new Response("Bild nicht gefunden",{status:404});
  const [owner,repo]=env.GITHUB_REPO.split("/");
  const r=await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${ACTIVITY_IMAGE_DIR}${match[1]}?ref=${encodeURIComponent(env.GITHUB_BRANCH||"main")}`,{headers:gh(env.GITHUB_TOKEN)});
  if (!r.ok) return new Response("Bild nicht gefunden",{status:r.status===404?404:502});
  const data=await r.json();
  if (data.size>MAX_ACTIVITY_IMAGE_BYTES || !data.content) return new Response("Bild nicht verfügbar",{status:502});
  const bytes=Uint8Array.from(atob(data.content.replace(/\s/g,"")),c=>c.charCodeAt(0));
  const format=imageFormat(bytes);
  if (!format || format.ext!==match[1].split(".").at(-1)) return new Response("Ungültiges Bild",{status:502});
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),x=>x.toString(16).padStart(2,"0")).join("");
  if (!match[1].startsWith(digest+".")) return new Response("Ungültiges Bild",{status:502});
  return new Response(bytes,{headers:{"content-type":format.mime,"cache-control":"public,max-age=3600,immutable","x-content-type-options":"nosniff"}});
}

async function eventEditorState(env) {
  const [freeFly, events, activities] = await Promise.all([
    getGithubJSONStrict(env, FREE_FLY_DATA_PATH), getGithubJSONStrict(env, EVENT_DATA_PATH), getGithubJSONStrict(env, ACTIVITY_DATA_PATH, {allowMissing:true})
  ]);
  if (!freeFly.data || typeof freeFly.data !== "object" || Array.isArray(freeFly.data) || !Array.isArray(events.data) || activities.data!==null && !Array.isArray(activities.data)) throw Error("Gespeicherte Termin-Dateien ungültig; nichts verändert.");
  return { freeFly: freeFly.data, events: events.data.filter(e=>e.type!=="Community Event"), activities: activities.data||[] };
}

async function editEventData(env, input, publish) {
  const kind = input?.kind, action = input?.action;
  if (!["freefly", "event", "activity"].includes(kind)) throw Error("Unbekannte Terminart.");
  if (kind === "freefly" ? !["set", "disable"].includes(action) : !["set", "remove"].includes(action)) throw Error("Unbekannte Aktion.");
  const path = kind === "freefly" ? FREE_FLY_DATA_PATH : kind === "activity" ? ACTIVITY_DATA_PATH : EVENT_DATA_PATH;
  const current = await getGithubJSONStrict(env, path, {allowMissing:kind==="activity"});
  if (kind !== "freefly" ? current.data!==null && !Array.isArray(current.data) : !current.data || typeof current.data !== "object" || Array.isArray(current.data)) throw Error("Gespeicherte Termindaten ungültig; nichts verändert.");
  if (publish && (input.expectedSha ?? null) !== (current.sha ?? null)) {
    const error = new Error("Daten wurden seit der Vorschau geändert. Bitte erneut prüfen."); error.status = 409; throw error;
  }
  let next;
  if (kind === "freefly") {
    if (action === "disable") next = { ...current.data, active: false };
    else {
      const title = String(input.data?.title || "").trim();
      if (title.length < 5 || title.length > 150) throw Error("Free-Fly-Titel muss zwischen 5 und 150 Zeichen haben.");
      next = { active: true, title, ...checkedEventFields(input.data), pageUrl: "/free-fly.html" };
    }
  } else {
    const items = current.data||[];
    if (action === "remove") {
      const sourceUrl = officialEventLink(input.data?.sourceUrl), start = kind==="activity"?null:editorDate(input.data?.start);
      if (!items.some(x => x.sourceUrl === sourceUrl && (kind==="activity" || x.start === start))) throw Error("Eintrag nicht gefunden.");
      next = items.filter(x => x.sourceUrl !== sourceUrl || kind!=="activity" && x.start !== start);
    } else {
      let event;
      if (kind === "activity") { event=checkedActivityFields(input.data);await assertActivityImageExists(env,event.imageUrl); }
      else {
        const name = String(input.data?.name || "").trim();
        if (name.length < 5 || name.length > 150) throw Error("Event-Name muss zwischen 5 und 150 Zeichen haben.");
        event = { name, type: "Event", ...checkedEventFields(input.data) };
      }
      next = items.filter(x => x.sourceUrl !== event.sourceUrl || kind!=="activity" && x.start !== event.start).concat(event).sort((a, b) => (Date.parse(a.start)||0) - (Date.parse(b.start)||0));
    }
  }
  if (publish) await putGithub(env, path, JSON.stringify(next, null, 2) + "\n", `Verse Radar ${VERSION}: ${kind} ${action}`, current.sha);
  return { published: publish, kind, action, itemCount: kind !== "freefly" ? next.length : undefined, proposal: next, expectedSha: publish ? undefined : current.sha };
}

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
  // RSI may return only its app shell to server-side requests. Combine the
  // official listing with two independently updated indexes, rather than
  // returning early when one source has three old articles.
  const urls = [
    "https://robertsspaceindustries.com/en/comm-link?sort=publish_new&type=post",
    "https://robertsspaceindustries.com/en/comm-link?sort=publish_new",
    "https://robertsspaceindustries.com/en/comm-link/transmission"
  ];
  const diagnostics = [];
  const collected = [];

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
      if (r.ok && parsed.items.length) collected.push(...parsed.items.filter(x => relevantNewsTitle(x.title)));
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
    diagnostics.push({ source: apiUrl, httpStatus: r.status, bodyLength: textBody.length, records: records.length,
      firstId: records[0]?.id ?? null });
    if (r.ok && records.length) {
      const items = records.map(normalizeWikiCommLink).filter(Boolean);
      collected.push(...items.filter(x => relevantNewsTitle(x.title)));
    }
  } catch (e) {
    diagnostics.push({ source: "star-citizen-wiki-api", error: e.message });
  }

  try {
    const r = await fetch(COMMUNITY_FEED_URL, { headers: { "accept": "application/feed+json,application/json", "user-agent": `Verse-Radar/${VERSION} (+independent fan site)` } });
    const body = r.ok ? await r.json() : null;
    const feedItems = Array.isArray(body?.items) ? body.items.map(normalizeFeedItem).filter(Boolean) : [];
    diagnostics.push({ source: COMMUNITY_FEED_URL, httpStatus: r.status, records: body?.items?.length ?? 0,
      accepted: feedItems.length, sample: feedSample(body?.items?.[0]) });
    collected.push(...feedItems.filter(x => relevantNewsTitle(x.title)));
  } catch (e) {
    diagnostics.push({ source: COMMUNITY_FEED_URL, error: e.message });
  }

  collected.push(...CONFIRMED_NEWS);
  diagnostics.push({ source: "confirmed-rsi-links", records: CONFIRMED_NEWS.length });
  const relevant = dedupeNewsItems(collected.filter(x => relevantNewsTitle(x.title))
    .sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0)))
    .slice(0, MAX);
  if (relevant.length >= 3) return { items: relevant, diagnostics };

  const detail = diagnostics.map(d => {
    if (d.source.includes('api.star-citizen.wiki')) return `${d.source}: HTTP ${d.httpStatus ?? "?"}, JSON ${d.bodyLength ?? 0}, Datensätze ${d.records ?? 0}`;
    return `${d.source}: HTTP ${d.httpStatus ?? "?"}, HTML ${d.htmlLength ?? 0}, Kandidaten ${d.candidates ?? 0}, erkannt ${d.parsedItems ?? 0}`;
  }).join(" | ");
  throw Error(`Keine Comm-Link-Beiträge erkannt. [Debug: ${detail}]`);
}

function normalizeFeedItem(record) {
  const title = strip(record?.title || "");
  // The feed is a discovery aid only. Never publish a feed-owned URL or
  // arbitrary external link as an official RSI article.
  const url = feedArticleUrl(record);
  if (!validTitle(title) || !url) return null;
  const date = validDate(record?.date_published || record?.published_at || record?.published || record?.date_modified || record?.date || "");
  if (!date) return null;
  return { title, url, date, description: "" };
}

function feedArticleUrl(record) {
  for (const value of [record?.external_url, record?.url, record?.link, record?.id]) {
    const candidate = cleanUrl(value);
    if (!candidate) continue;
    const parsed = new URL(candidate);
    if (!/^(?:www\.)?robertsspaceindustries\.com$/i.test(parsed.hostname)) continue;
    const path = parsed.pathname.replace(/^\/comm-link\//i, "/en/comm-link/");
    const canonical = `https://robertsspaceindustries.com${path}`;
    if (isArticleUrl(canonical)) return canonical;
  }
  return null;
}

function feedSample(record) {
  if (!record || typeof record !== "object") return null;
  const rawUrl = String(record.external_url || record.url || record.link || "");
  let host = null, path = null;
  try { const u = new URL(rawUrl); host = u.hostname; path = u.pathname.slice(0, 120); } catch {}
  return { keys: Object.keys(record).slice(0, 15), title: strip(record.title || "").slice(0, 100), host, path,
    datePublished: String(record.date_published || record.published_at || record.published || record.date || "").slice(0, 40) };
}

function normalizeWikiCommLink(record) {
  const id = Number(record?.id);
  let title = strip(record?.title || "");
  if (!Number.isInteger(id) || id <= 0 || !validTitle(title)) return null;
  // The archive sometimes returns a placeholder URL such as /comm-link/SCW/…
  // and a title alone does not establish whether the article is a patch note
  // or a transmission. Only use a supplied, matching RSI article link.
  let url = cleanUrl(record?.rsi_url);
  if (!url || !isArticleUrl(url) || /\/SCW\/|\-API(?:[/?#]|$)/i.test(url) || Number(new URL(url).pathname.match(/\/(\d+)-/)?.[1]) !== id) return null;
  const correction = NEWS_SOURCE_CORRECTIONS[id];
  if (correction && title === correction.oldTitle) { title = correction.title; url = correction.url; }
  let date = record?.published_at ? validDate(record.published_at) : null;
  if (!date && record?.created_at) date = validDate(record.created_at);
  if (!date && record?.created_at_human) {
    const d = new Date(record.created_at_human);
    if (!Number.isNaN(d.getTime())) date = d.toISOString();
  }
  // The archive omits the edition date from recurring weekly headlines.
  // The published UTC calendar date identifies each edition unambiguously.
  if (/^This Week in Star Citizen$/i.test(title) && date) {
    title += " - " + new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", day: "numeric", year: "numeric" }).format(new Date(date));
  }
  return {
    title,
    url,
    verifiedSummary: correction && title === correction.title ? correction.summary : null,
    date: date || new Date().toISOString(),
    description: "",
    sourceId: id
  };
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
      date: null,
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
  const articleIds = new Set();
  return items.filter(item => {
    const key = newsTitleKey(item.title);
    const url = item.url || item.sourceUrl;
    const articleId = Number(url?.match(/\/(\d+)-/)?.[1]) || null;
    if (urls.has(url) || (articleId && articleIds.has(articleId)) || (!/^this week in star citizen$/i.test(key) && titles.has(key))) return false;
    urls.add(url);
    if (articleId) articleIds.add(articleId);
    titles.add(key);
    return true;
  });
}

function isNewsPlaceholder(summary) {
  return !summary || strip(summary) === OLD_NEWS_PLACEHOLDER;
}

function fallbackNewsSummary(item) {
  if (item.verifiedSummary) return item.verifiedSummary;
  const title = strip(item.title);
  let match;
  if (/^this week in star citizen(?:\s*[-–]\s*.*)?$/i.test(title)) return `Wochenüberblick vom ${new Intl.DateTimeFormat("de-DE", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" }).format(new Date(item.date))}. Die konkreten Themen stehen in der Originalmeldung.`;
  if ((match = title.match(/^q\s*&\s*a:\s*(.+)$/i))) return `Fragen und Antworten zu ${match[1]}. Die einzelnen Aussagen stehen in der Originalmeldung.`;
  if (/^roadmap roundup/i.test(title)) return `RSI veröffentlicht „${title}“. Welche Punkte des Entwicklungsplans besprochen werden, steht in der Originalmeldung.`;
  if ((match = title.match(/^star citizen monthly report:\s*(.+)$/i))) return `Monatsbericht zur Entwicklung von Star Citizen für ${match[1].replace(/\bJanuary\b/i, "Januar").replace(/\bFebruary\b/i, "Februar").replace(/\bMarch\b/i, "März").replace(/\bMay\b/i, "Mai").replace(/\bJune\b/i, "Juni").replace(/\bJuly\b/i, "Juli").replace(/\bOctober\b/i, "Oktober").replace(/\bDecember\b/i, "Dezember")}. Die behandelten Arbeiten stehen in der Originalmeldung.`;
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
  // The second fragment can end at an abbreviation such as "bzw.". The
  // first complete sentence already conveys the main point of a news card.
  return patch.summary.split(/(?<=[.!?])\s+(?=[A-ZÄÖÜ])/u)[0].trim();
}

function extractDateFromSlug(url) {
  // Slugs normally do not contain dates, so return null here.  Actual article
  // dates are filled from the article page in the enrichment pass when needed.
  return null;
}

async function buildNews(env) {
  const { items, diagnostics: sourceDiagnostics } = await fetchRSIItems();
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
    if (old && !isNewsPlaceholder(old.summary) && !(item.verifiedSummary && old.summaryBasis === "Titel")) { news.push(old); continue; }
    if (old) refreshedItems++;
    const patchSummary = patchNewsSummary(item, existingPatches);
    let ai = null;
    if (env.OPENAI_API_KEY && !patchSummary) {
      try { ai = await summarize(item, env.OPENAI_API_KEY); aiCount++; } catch (_) {}
    }
    news.push({ id, title: ai?.title || item.title, category: ai?.category || classify(item.title), date: item.date, summary: patchSummary || ai?.summary || fallbackNewsSummary(item), sourceUrl: item.url, source: "RSI Comm-Link", ai: Boolean(ai), summaryBasis: patchSummary ? "Patch Notes" : item.verifiedSummary ? "Quelltext" : ai ? "KI" : "Titel", summaryVersion: NEWS_SUMMARY_VERSION });
  }
  // Preserve older useful articles, but remove stale demo links, technical
  // archive records and the repeated placeholder from earlier imports.
  for (const old of existing) {
    if (news.some(n => n.id === old.id) || isNewsPlaceholder(old.summary) || !isArticleUrl(old.sourceUrl) || /^R-PU-ORS-/i.test(old.title || "")) continue;
    news.push(old);
  }
  news.sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));
  const finalNews = dedupeNewsItems(news).slice(0, 60);
  return { news: finalNews, changed: JSON.stringify(finalNews) !== JSON.stringify(existing), fetchedItems: items.length, newItems: finalNews.filter(n => n.id && !known.has(n.id)).length, refreshedItems, aiItems: aiCount, sourceDiagnostics };
}

async function updateSite(env, { includeNews = true, includePatches = true, onlyWhenChanged = false } = {}) {
  const newsResult = includeNews ? await buildNews(env) : null;

  const patchResult = includePatches ? await updatePatches(env) : null;
  const now = new Date().toISOString();
  const automation = includeNews && includePatches ? "Cloudflare Worker + RSI Comm-Link + RSI Patch Notes" : includeNews ? "Cloudflare Worker + RSI Comm-Link; Patch-Import pausiert" : "Cloudflare Worker + RSI Patch Notes; News-Import pausiert";
  const meta = { updatedAt: now, source: COMM_LINK_URL, patchSource: PATCH_NOTES_URL, mode: env.GITHUB_TOKEN && env.GITHUB_REPO ? "live" : "preview", automation, version: VERSION, fetchedItems: newsResult?.fetchedItems ?? null, newItems: newsResult?.newItems ?? null, refreshedItems: newsResult?.refreshedItems ?? null, aiItems: newsResult?.aiItems ?? null, newsItems: newsResult?.news.length ?? null, patchItems: patchResult?.patches.length ?? null, patchNewItems: patchResult?.newItems ?? null, patchNextPage: patchResult?.nextState.nextPage ?? null, patchBackfillComplete: patchResult?.nextState.complete ?? null, patchDeferredSeedItems: patchResult?.deferredSeedItems ?? null, patchDeferredPageItems: patchResult?.deferredPageItems ?? null, patchHistoricalCandidates: patchResult?.historicalCandidates ?? null, patchHistoricalDeferredItems: patchResult?.historicalDeferredItems ?? null, patchHistoricalUnusableItems: patchResult?.historicalUnusableItems ?? null, patchHistoricalUnusableVersions: patchResult?.historicalDiagnostics.filter(item => !item.eligible).map(({ version, reason, sourceContentLength, matchedChanges }) => ({ version, reason, sourceContentLength, matchedChanges })) ?? null, patchHistoricalMissingItems: null, patchAiItems: patchResult?.aiItems ?? null };

  if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) {
    return { ok: true, version: VERSION, published: false, ...meta, note: "GitHub Secrets fehlen; nichts zurückgeschrieben." };
  }

  const newsChanged = includeNews && (!onlyWhenChanged || newsResult.changed);
  const patchChanged = includePatches && (!onlyWhenChanged || patchResult.changed);
  let cursorChanged = false;
  if (includePatches) {
    // Publish the archive before advancing its cursor. A failed cursor write
    // merely repeats a page; it can never skip unsaved older versions.
    const savedPatches = patchChanged ? await publishPatchArchive(env, patchResult.patches) : patchResult.patches;
    meta.patchItems = savedPatches.length;
    const storedVersions = new Set(savedPatches.map(p => patchKey(p.version)));
    meta.patchHistoricalMissingItems = HISTORICAL_VERSIONS.filter(v => !storedVersions.has(patchKey(`Alpha ${v}`))).length;
    cursorChanged = await publishPatchCursor(env, patchResult.nextState);
  }
  if (newsChanged) await putGithub(env, "public/data/news.json", JSON.stringify(newsResult.news, null, 2) + "\n", `Verse Radar ${VERSION}: update news`);
  if (onlyWhenChanged && !newsChanged && !patchChanged && !cursorChanged)
    return { ok: true, version: VERSION, published: false, ...meta, note: "Keine neuen Inhalte; nichts geändert." };
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
        current.historicalNextIndex === next.historicalNextIndex) return false;
    try {
      await putGithub(env, PATCH_STATE_PATH, JSON.stringify(next, null, 2) + "\n", `Verse Radar ${VERSION}: advance patch archive`, latest.sha);
      return true;
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
  const { items, scannedPages, nextState, pageDiagnostics, feedDiagnostics, seedDiagnostics, deferredSeedItems, deferredPageItems, historicalCandidates, historicalDeferredItems, historicalUnusableItems, historicalDiagnostics } = await fetchPatchItems(state, existingVersions);
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
    if (env.OPENAI_API_KEY && item.content && !item.curated) {
      try { ai = await summarizePatch(item, null, env.OPENAI_API_KEY); aiItems++; } catch (_) {}
    }
    byVersion.set(key, {
      version: item.version,
      date: item.date,
      previous: null,
      summary: item.curated?.summary || ai?.summary || item.fallbackSummary,
      changes: item.curated?.changes || (ai?.changes?.length ? ai.changes : buildPatchChanges(item)),
      fullSummary: item.curated?.fullSummary || ai?.fullSummary || item.fallbackFullSummary,
      sourceUrl: item.sourceUrl,
      sourceType: item.sourceType || "Patch Notes",
      ai: Boolean(ai),
      summaryVersion: item.curated || Object.hasOwn(HISTORICAL_SHORT_RELEASES, item.version) ? VERSION : item.historical ? "0.9.6" : "0.6.8",
      note: item.curated ? "Redaktionell geprüfte deutsche Zusammenfassung der offiziellen RSI-Patch-Notes. Der Worker konnte den Quelltext beim Import nicht automatisch auslesen. Kein offizieller RSI-Text."
        : item.sourceType === "Community Archive"
        ? "Deutsche Zusammenfassung einer archivierten Patchseite der Star Citizen Wiki; ein eigenständiger offizieller Patch-Notes-Link ist dort nicht belegt."
        : item.sourceType === "RSI Release Info"
        ? "Deutsche Zusammenfassung aus dem archivierten Patchtext; der Original-Link führt zu einer offiziellen RSI-Veröffentlichung."
        : item.sourceType === "Content Update"
        ? "Deutsche Zusammenfassung des nummerierten Content-Updates aus dem Community-Archiv; der Quelllink ist gekennzeichnet. Kein eigenständiger RSI-Patch-Notes-Link."
        : "Deutsche Zusammenfassung der offiziellen Patch Notes. Kein offizieller RSI-Text."
    });
  }
  const patches = [...byVersion.values()].sort(comparePatchVersionsDesc).map((p, i, all) => ({ ...p, previous: all[i + 1]?.version || null }));
  return { patches, changed: JSON.stringify(patches) !== JSON.stringify(existing), items: unique, newItems: patches.length - existing.length, aiItems, scannedPages, nextState, pageDiagnostics, feedDiagnostics, seedDiagnostics, deferredSeedItems, deferredPageItems, historicalCandidates, historicalDeferredItems, historicalUnusableItems, historicalDiagnostics, archiveSha: archive.sha, stateSha: stateFile.sha };
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
  let feedDiagnostics = { source: COMMUNITY_FEED_URL, records: 0, accepted: 0 };
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
      if (content.length < 500) content = cleanPatchText(await fetchOfficialPatchText(sourceUrl, version, content));
      if (content.length < 500) content = cleanPatchText(await fetchWikiUpdatePage(version, content));
      discovered.push({ version, date, sourceUrl, sourceId: id, content, fallbackSummary: fallbackPatchSummary(version, content), fallbackFullSummary: fallbackFullSummary(version, content) });
    }
  }
  if (!scannedPages.length || (scannedPages.length === 1 && !recognizedPatchNotes)) throw Error("Keine Patch Notes in der aktuellen Quelle erkannt; Import abgebrochen.");

  // A fresh LIVE patch can appear in the feed before the wiki index. A feed
  // link only discovers the official note; the text still has to pass the
  // same patch-source and content checks as an indexed record.
  try {
    const r = await fetch(COMMUNITY_FEED_URL, { headers: { "accept": "application/feed+json,application/json", "user-agent": `Verse-Radar/${VERSION} (+independent fan site)` } });
    const body = r.ok ? await r.json() : null;
    const records = Array.isArray(body?.items) ? body.items : [];
    const candidates = records.map(record => {
      const sourceUrl = feedArticleUrl(record);
      const title = strip(record?.title || "");
      const id = Number(sourceUrl?.match(/\/Patch-Notes\/(\d+)-/i)?.[1]);
      if (!id || !/^https:\/\/robertsspaceindustries\.com\/en\/comm-link\/Patch-Notes\/\d+-/i.test(sourceUrl) || !/^Star Citizen Alpha \d+(?:\.\d+){1,2}(?:\s|:|$)/i.test(title)) return null;
      return { id, version: normalizePatchVersion(title.replace(/^Star Citizen /i, "").trim()), sourceUrl,
        date: validDate(record?.date_published || record?.date_modified || "") };
    }).filter(x => x && x.date);
    feedDiagnostics = { source: COMMUNITY_FEED_URL, httpStatus: r.status, records: records.length, accepted: candidates.length,
      sample: feedSample(records[0]) };
    for (const candidate of candidates) {
      if (existingVersions.has(patchKey(candidate.version)) || discovered.some(x => patchKey(x.version) === patchKey(candidate.version))) continue;
      if (fetchedDetails >= PATCH_DETAILS_PER_IMPORT) { deferredPageItems++; continue; }
      fetchedDetails++;
      let content = cleanPatchText(await fetchPatchDetail(candidate.id, ""));
      if (!publishablePatch(candidate.version, content)) content = cleanPatchText(await fetchOfficialPatchText(candidate.sourceUrl, candidate.version, content));
      if (!publishablePatch(candidate.version, content)) content = cleanPatchText(await fetchWikiUpdatePage(candidate.version, content));
      discovered.push({ version: candidate.version, date: candidate.date, sourceUrl: candidate.sourceUrl, sourceId: candidate.id, content,
        fallbackSummary: fallbackPatchSummary(candidate.version, content), fallbackFullSummary: fallbackFullSummary(candidate.version, content) });
    }
  } catch (e) { feedDiagnostics = { source: COMMUNITY_FEED_URL, error: e.message }; }

  // RSI's patch index is sometimes only partially mirrored by the archive API.
  // Seed the current major patches so a temporary archive/index gap cannot hide them.
  let fetchedSeeds = 0;
  let deferredSeedItems = 0;
  for (const seed of [...PATCH_SEEDS].sort(comparePatchVersionsDesc)) {
    const already = discovered.some(x => x.version === seed.version && publishablePatch(x.version, x.content));
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
    if (!publishablePatch(seed.version, content) && seed.sourceUrl) {
      const official = cleanPatchText(await fetchOfficialPatchText(sourceUrl, seed.version, ""));
      if (official.length > content.length) content = official;
    }
    if (!publishablePatch(seed.version, content) && seed.version !== "Alpha 4.10.2") {
      // A detail record may be long yet omit whole feature sections. Check
      // the full wiki update before deciding that a major patch is unusable.
      const wikiContent = cleanPatchText(await fetchWikiUpdatePage(seed.version, ""));
      if (publishablePatch(seed.version, wikiContent) || wikiContent.length > content.length) content = wikiContent;
    }
    const curated = !publishablePatch(seed.version, content) ? CURATED_LIVE_PATCHES[seed.version] : null;
    seedDiagnostics.push({ version: seed.version, sourceId: seed.id, sourceContentLength: content.length,
      eligible: publishablePatch(seed.version, content) || Boolean(curated),
      ...(curated ? { editorialSummary: true } : {}),
      matchedChanges: Object.hasOwn(ARCHIVE_HIGHLIGHTS, seed.version)
        ? (archiveHighlights(seed.version, content) || []).map(change => change.title) : undefined });
    discovered.push({ version: seed.version, date: seed.date, sourceUrl, sourceType: seed.sourceType || "Patch Notes", sourceId: seed.id, content, curated,
      fallbackSummary: fallbackPatchSummary(seed.version, content), fallbackFullSummary: fallbackFullSummary(seed.version, content) });
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
      matchedChanges: eligible || !item?.content ? undefined : historicalPatchChanges(item.content, patch.version).map(change => change.title),
      reason: eligible ? undefined : item?.unusableReason || "Patchtext nicht ausreichend auswertbar" });
    if (eligible) discovered.push(item);
    else { historicalUnusableItems++; firstUnusableIndex ??= index; }
  }

  if (!discovered.length && !existingVersions.size) throw Error("Keine Patch Notes erkannt.");
  // A title variant (e.g. "Alpha 4.8: Tactical Strike") is not a separate
  // predecessor of the same numbered release. Never publish empty source text
  // as a generic patch summary.
  const unique = dedupePatchItems(discovered).filter(item => item.curated || publishablePatch(item.version, item.content)).sort(comparePatchVersionsDesc);
  if (!unique.length && !existingVersions.size) throw Error("Keine Patch Notes mit auswertbarem Quelltext erkannt.");
  const lastScanned = scannedPages[scannedPages.length - 1];
  const complete = !firstDeferredPage && (state.complete || reachedEnd || (lastPage !== null && lastScanned >= lastPage));
  const nextPage = firstDeferredPage || (complete ? Math.max(lastScanned, state.nextPage) : lastScanned + 1);
  return { items: unique, scannedPages, pageDiagnostics, feedDiagnostics, seedDiagnostics, deferredSeedItems, deferredPageItems,
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

async function fetchOfficialPatchText(sourceUrl, version, current = "") {
  if (!/^https:\/\/robertsspaceindustries\.com\/en\/comm-link\/Patch-Notes\/\d+-/i.test(sourceUrl)) return current;
  try {
    const r = await fetch(sourceUrl, { headers: { "user-agent": `Verse-Radar/${VERSION} (+independent fan site)`, "accept": "text/html" } });
    if (!r.ok) return current;
    const html = await r.text();
    const main = html.match(/<article\b[\s\S]*?<\/article>/i)?.[0] || html.match(/<main\b[\s\S]*?<\/main>/i)?.[0] || "";
    const content = cleanPatchText(main);
    // App shells, previews and marketing articles are not patch texts.
    const number = version.replace(/^Alpha\s+/i, "");
    if (!content.includes(number) || !/\b(?:release notes|patch notes|build information)\b/i.test(content) || content.length < 500) return current;
    return content;
  } catch { return current; }
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
  if (patch.version === "Alpha 3.11.1a" && !body.parse.title) return { unusableReason: "Wiki-Detail ohne Versionskennung" };
  if (body.parse.title && body.parse.title.replace(/_/g, " ") !== patch.title) return { unusableReason: "Wiki-Detail verweist auf andere Version" };
  const raw = strip(html);
  const dateMatch = raw.match(/\bbuild\s+released\s+on\s*(\d{4}-\d{2}-\d{2})\b/i)
    || raw.match(/\bReleased\s+(\d{4}-\d{2}-\d{2})\b/i);
  const date = dateMatch && validDate(dateMatch[1]);
  if (!date) return { unusableReason: "Erscheinungsdatum im Wiki-Detail nicht erkennbar" };
  const wikiUrl = `https://starcitizen.tools/${patch.title.replace(/ /g, "_")}`;
  const sourceUrl = HISTORICAL_SHORT_RELEASES[patch.version]?.sourceUrl || historicalOfficialLink(html) || wikiUrl;
  const sourceType = /\/spectrum\/community\/SC\/forum\/\d+\/thread\//i.test(sourceUrl) || /\/comm-link\/Patch-Notes\/\d+-/i.test(sourceUrl) || patch.version === "Alpha 3.0.0" ? "Patch Notes" :
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
    if (!old) { map.set(key, item); continue; }
    const verified = publishablePatch(item.version, item.content);
    const oldVerified = publishablePatch(old.version, old.content);
    if (verified !== oldVerified) { if (verified) map.set(key, item); continue; }
    if (Boolean(item.curated) !== Boolean(old.curated)) { if (item.curated) map.set(key, item); continue; }
    if ((item.content.length >= 500 && old.content.length < 500) ||
        ((item.content.length >= 500) === (old.content.length >= 500) && Number(item.sourceId||0) > Number(old.sourceId||0))) map.set(key, item);
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
    if (shortRelease.marker && !shortRelease.marker.test(content)) return [];
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
  if (version === "Alpha 4.10.2" && (!/4\.10\.2/.test(content) || !/\b(?:release notes|patch notes|build information)\b/i.test(content))) return false;
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
  const bytes = content instanceof Uint8Array ? content : new TextEncoder().encode(content);
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
