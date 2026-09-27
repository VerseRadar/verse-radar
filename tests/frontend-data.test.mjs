import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const read = async path => readFile(new URL(path, import.meta.url), "utf8");
const news = JSON.parse(await read("../public/data/news.json"));
const patches = JSON.parse(await read("../public/data/patches.json"));
const page = await read("../public/patches.html");
const ctx = {
  document: { addEventListener() {} },
  Intl, Date, encodeURIComponent,
  fetch: async () => ({ ok: true, headers: { get: () => "static-fallback" }, json: async () => news })
};
vm.createContext(ctx);
vm.runInContext(await read("../public/app.js"), ctx);

assert.equal(news.length, 13);
assert.equal(patches.length, 6);
assert.ok(news.every(x => x.sourceUrl?.includes("/en/comm-link/") && x.summary && !x.summary.startsWith("Offizieller RSI Comm-Link-Beitrag.")));
assert.ok(news.every(x => !/^R-PU-ORS-/i.test(x.title)));
assert.ok(patches.every((x, i) => x.summary && x.fullSummary && x.changes?.length && x.sourceUrl?.startsWith("https://") && x.previous === (patches[i+1]?.version || null)));
assert.ok(page.includes('loadJSON("patches.json")'));
const latest = ctx.renderPatches(patches);
const history = ctx.renderPatchHistory(patches);
assert.equal((latest.match(/class="article patch-card"/g) || []).length, 5);
assert.equal((history.match(/<article class="article"/g) || []).length, 6);
assert.ok(history.includes('id="Alpha%204.8"'));
assert.ok(history.includes("<details>"));
assert.ok(latest.includes("UPDATE-MELDUNG"));
assert.ok(history.includes('href="https://robertsspaceindustries.com/en/comm-link/transmission/21206-Star-Citizen-Alpha-483"'));
assert.equal(history.includes('href="/patches.html#Alpha%204.8"'), false);
assert.ok(ctx.renderNews(news, 1).includes("Kurzbeschreibung anhand des Titels"));
const nodes = { "#radar-contacts": { innerHTML: "" }, "#radar-count": { textContent: "" } };
ctx.document.querySelector = selector => nodes[selector] || null;
ctx.radarContacts(news, Array.from({ length: 4 }, () => ({ name: "Event" })));
assert.equal(nodes["#radar-count"].textContent, "10 Kontakte");
assert.equal(nodes["#radar-contacts"].innerHTML.includes("undefined%"), false);
const tomorrow = new Date(Date.now() + 86400000).toISOString();
const yesterday = new Date(Date.now() - 86400000).toISOString();
assert.equal(ctx.activeEvents([{ name: "Ohne Datum" }, { name: "Vergangen", start: yesterday }, { name: "Bestätigt", start: tomorrow }]).length, 1);
await ctx.loadJSON("news.json");
assert.equal(vm.runInContext("usingStaticData", ctx), true);
console.log("Statischer Datenstand, fünf Patch Notes, sechs History-Einträge und Rückfallkennzeichnung: OK");
