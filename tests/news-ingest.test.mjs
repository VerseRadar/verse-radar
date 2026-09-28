import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../worker/index.js", import.meta.url), "utf8");
const worker = (await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`)).default;
const placeholder = "Offizieller RSI Comm-Link-Beitrag. Öffne die Originalquelle für den vollständigen Inhalt.";
const url = (id, slug) => `https://robertsspaceindustries.com/en/comm-link/transmission/${id}-${slug}`;
const hash = value => { let h = 2166136261; for (let i = 0; i < value.length; i++) h = Math.imul(h ^ value.charCodeAt(i), 16777619); return (h >>> 0).toString(16); };
const archive = [
  [21339, "This Week in Star Citizen", "2026-09-21"],
  [21332, "Aegis Sabre Raven EX | Star Citizen", "2026-09-16"],
  [21330, "Star Citizen Alpha 4.10.1", "2026-09-16"],
  [21329, "Q&A: Aegis Sabre Raven EX and Argo ATLS IKTI Akuma", "2026-09-16"],
  [21328, "R-PU-ORS-HeavyArmour-6", "2026-09-16"],
  [21314, "Roadmap Roundup - August 26, 2026", "2026-09-09"],
  [21318, "This Week in Star Citizen", "2026-09-14"],
  [21307, "Star Citizen Monthly Report: August 2026", "2026-09-02"],
  [21299, "Roadmap Roundup - August 26, 2026", "2026-08-26"],
  [21301, "Letter From The Chairman", "2026-08-27"]
].map(([id, title, created_at]) => ({ id, title, created_at,
  rsi_url: id === 21330
    ? 'https://robertsspaceindustries.com/en/comm-link/Patch-Notes/21330-Star-Citizen-Alpha-4101'
    : url(id, title.toLowerCase().replace(/[^a-z0-9]+/g, '-')) }));
archive.push({ id: 21340, title: 'Star Citizen Alpha 4.10.2', created_at: '2026-09-22', rsi_url: 'https://robertsspaceindustries.com/comm-link/SCW/21340-API' });
archive.push({ id: 21341, title: 'Star Citizen Alpha 4.10.3', created_at: '2026-09-22', rsi_url: 'https://robertsspaceindustries.com/en/comm-link/transmission/20000-wrong-article' });
archive.find(x => x.id === 21314).published_at = "2026-09-09T20:00:00.000Z";

const oldUrl = url(21339, "this-week-in-star-citizen");
const oldNews = [
  { id: hash(oldUrl), title: "This Week in Star Citizen", summary: placeholder, sourceUrl: oldUrl, date: "2026-09-21" },
  { id: "technical", title: "R-PU-ORS-HeavyArmour-6", summary: placeholder, sourceUrl: url(21328, "r-pu-ors-heavyarmour-6"), date: "2026-09-16" },
  { title: "Alpha 4.10: Siege of Orison", summary: "Beispieltext", sourceUrl: "https://robertsspaceindustries.com/en/comm-link", date: "2026-08-26" },
  { id: hash(url(21314, 'Roadmap-Roundup-September-9-2026')), title: 'Roadmap Roundup - September 9, 2026', summary: 'Allgemeine Titelbeschreibung.', summaryBasis: 'Titel', sourceUrl: url(21314, 'Roadmap-Roundup-September-9-2026'), date: '2026-09-09' },
  { id: "valid-old", title: "Ship Showdown 2956 Winners", summary: "RSI hat die Sieger bekannt gegeben.", sourceUrl: url(21308, "ship-showdown-2956-winners"), date: "2026-09-07" }
];

const calls = [];
let failNewsRead = false;
globalThis.fetch = async (target, options = {}) => {
  const address = String(target);
  calls.push({ address, method: options.method || "GET" });
  if (address.startsWith("https://robertsspaceindustries.com/en/comm-link?")) {
    const html = `<a href="/en/comm-link/transmission/21328-r-pu-ors-heavyarmour-6">R-PU-ORS-HeavyArmour-6</a><a href="/en/comm-link/transmission/21339-this-week-in-star-citizen">This Week in Star Citizen</a>`;
    return new Response(html);
  }
  if (address.startsWith("https://api.star-citizen.wiki/api/comm-links?")) return Response.json({ data: archive });
  if (address.includes("/contents/public/data/news.json?ref=main")) return failNewsRead ? new Response("Unavailable", { status: 503 }) : Response.json({ sha: "news-sha", content: Buffer.from(JSON.stringify(oldNews)).toString("base64") });
  if (address.includes("/contents/public/data/patches.json?ref=main")) {
    const patches = [{ sourceUrl: "https://robertsspaceindustries.com/en/comm-link/Patch-Notes/21330-Star-Citizen-Alpha-4101", summaryVersion: "0.6.8", summary: "Alpha 4.10.1 bringt Orison Relief Support. Der Patch enthält weitere Änderungen an Aufträgen und Fahrzeugen. Noch ein dritter Satz." }];
    return Response.json({ sha: "patch-sha", content: Buffer.from(JSON.stringify(patches)).toString("base64") });
  }
  if (address.includes("/contents/public/data/news.json") && options.method === "PUT") return Response.json({ ok: true });
  if (address.includes("/contents/public/data/meta.json") && options.method === "PUT") return Response.json({ ok: true });
  if (address.includes("/contents/")) return new Response("Not found", { status: 404 });
  throw new Error(`Unexpected request: ${address}`);
};

const env = { GITHUB_TOKEN: "test-token", GITHUB_REPO: "example/verse-radar", GITHUB_BRANCH: "main" };
const health = await worker.fetch(new Request("https://example.com/health"), env);
assert.equal((await health.json()).version, "0.12.2");
const patchApi = await worker.fetch(new Request("https://example.com/api/patches"), env);
assert.equal(patchApi.headers.get("x-verse-radar-patches-source"), "github");

calls.length = 0;
await worker.scheduled(null, env, { waitUntil: () => { throw new Error("Cron should remain paused until enabled"); } });
assert.equal(calls.length, 0);

const preview = await worker.fetch(new Request("https://example.com/preview/news"), env);
assert.equal(preview.status, 200);
const body = await preview.json();
assert.equal(body.published, false);
assert.equal(body.fetchedItems, 9);
assert.equal(body.count, 10);
assert.equal(body.refreshedItems, 2);
assert.equal(body.aiItems, 0);
assert.equal(body.newItems, 7);
assert.equal(body.items.filter(x => x.title.startsWith("This Week in Star Citizen - ")).length, 2);
assert.equal(body.items.filter(x => x.title.startsWith("Roadmap Roundup")).length, 2);
assert.equal(body.items.find(x => x.title === 'Roadmap Roundup - September 9, 2026').date, "2026-09-09T20:00:00.000Z");
assert.match(body.items.find(x => x.title === 'Roadmap Roundup - September 9, 2026').sourceUrl, /21314-Roadmap-Roundup-September-9-2026/);
assert.match(body.items.find(x => x.title === 'Roadmap Roundup - September 9, 2026').summary, /Orison Relief Support/);
assert.equal(body.items.find(x => x.title === 'Roadmap Roundup - September 9, 2026').summaryBasis, 'Quelltext');
assert.equal(body.items.some(x => x.title.startsWith("R-PU-ORS-")), false);
assert.equal(body.items.some(x => x.title === "Star Citizen Alpha 4.10.2" || x.title === "Star Citizen Alpha 4.10.3"), false);
assert.equal(body.items.find(x => x.title === 'Star Citizen Alpha 4.10.1').sourceUrl, archive.find(x => x.id === 21330).rsi_url);
assert.equal(body.items.some(x => x.sourceUrl === "https://robertsspaceindustries.com/en/comm-link"), false);
assert.equal(body.items.some(x => x.summary === placeholder), false);
assert.ok(body.items.find(x => x.id === hash(oldUrl)).summary.includes("Wochenüberblick"));
assert.match(body.items.find(x => x.id === hash(oldUrl)).title, /September 21, 2026/);
assert.equal(body.items.find(x => x.title === "Star Citizen Alpha 4.10.1").summary, "Alpha 4.10.1 bringt Orison Relief Support.");
assert.equal(body.items.find(x => x.title === "Star Citizen Alpha 4.10.1").summaryBasis, "Patch Notes");
assert.ok(body.items.some(x => x.id === "valid-old"));
assert.equal(calls.some(x => x.method === "PUT"), false);

const blocked = await worker.fetch(new Request("https://example.com/run/news"), { ...env, RUN_SECRET: "private" });
assert.equal(blocked.status, 401);
assert.equal(calls.some(x => x.method === "PUT"), false);
const manual = await worker.fetch(new Request("https://example.com/run/news?key=private"), { ...env, RUN_SECRET: "private" });
assert.equal((await manual.json()).published, true);
assert.deepEqual(calls.filter(x => x.method === "PUT").map(x => x.address.split("/contents/")[1]), ["public/data/news.json", "public/data/meta.json"]);

calls.length = 0;
let scheduled;
await worker.scheduled(null, { ...env, NEWS_AUTO_PUBLISH: "true" }, { waitUntil: promise => { scheduled = promise; } });
await scheduled;
assert.deepEqual(calls.filter(x => x.method === "PUT").map(x => x.address.split("/contents/")[1]), ["public/data/news.json", "public/data/meta.json"]);

calls.length = 0;
failNewsRead = true;
const failedPreview = await worker.fetch(new Request("https://example.com/preview/news"), env);
assert.equal(failedPreview.status, 502);
const failedRun = await worker.fetch(new Request("https://example.com/run/news?key=private"), { ...env, RUN_SECRET: "private" });
assert.equal(failedRun.status, 500);
assert.equal(calls.some(x => x.method === "PUT"), false);

console.log("News-Vorschau, Filter, Auffrischung, Archiv und Veröffentlichungs-Schalter: OK");
