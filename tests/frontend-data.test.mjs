import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const read = async path => readFile(new URL(path, import.meta.url), "utf8");
const news = JSON.parse(await read("../public/data/news.json"));
const patches = JSON.parse(await read("../public/data/patches.json"));
const page = await read("../public/patches.html");
const ctx = {
  document: { addEventListener() {} },
  Intl, Date, URL, encodeURIComponent,
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
assert.equal(ctx.patchIsAnnouncement({ sourceType: 'Patch Notes', sourceUrl: 'https://robertsspaceindustries.com/en/comm-link/transmission/16349-Star-Citizen-Alpha-300' }), false);
assert.equal(ctx.patchIsAnnouncement({ sourceType: 'RSI Release Info', sourceUrl: 'https://robertsspaceindustries.com/en/comm-link/transmission/21206-Star-Citizen-Alpha-483' }), true);
assert.ok(history.includes('href="https://robertsspaceindustries.com/en/comm-link/transmission/21206-Star-Citizen-Alpha-483"'));
assert.equal(history.includes('href="/patches.html#Alpha%204.8"'), false);
const renderedNews=ctx.renderNews(news,1);
assert.match(renderedNews, /<details class="news-card"/);
assert.match(renderedNews, /<summary class="news-teaser"/);
assert.match(renderedNews, /Einordnung nur anhand des Titels/);
assert.match(renderedNews, /Kurzüberblick anzeigen/);
assert.ok(!ctx.renderNews([{...news[0],title:'<img src=x onerror=alert(1)>',summary:'<script>alert(1)</script>'}],1).includes('<script>'));
const contactNodes=[
  {style:{setProperty(name,value){this[name]=value},removeProperty(name){delete this[name]}},getBoundingClientRect(){return {left:293.5,top:193.5,width:13,height:13}}},
  {style:{setProperty(name,value){this[name]=value},removeProperty(name){delete this[name]}},getBoundingClientRect(){return {left:193.5,top:293.5,width:13,height:13}}}
];
const sweep={style:{removeProperty(name){delete this[name]}}};
const panel={offsetWidth:400,querySelector:()=>sweep,getBoundingClientRect:()=>({left:0,top:0,width:400,height:400})};
const nodes = { "#radar-contacts": { innerHTML: "",closest:()=>panel,querySelectorAll:()=>contactNodes } };
ctx.document.querySelector = selector => nodes[selector] || null;
ctx.radarContacts(news, Array.from({ length: 4 }, () => ({ name: "Event" })));
assert.equal((nodes["#radar-contacts"].innerHTML.match(/class="radar-contact/g)||[]).length,10);
assert.equal(contactNodes[0].style["--echo-delay"],"0.000s");
assert.equal(contactNodes[1].style["--echo-delay"],"1.500s");
assert.match(await read("../public/styles.css"),/\.radar-contact\{[^}]*animation-delay:var\(--echo-delay,0s\)/);
assert.ok(!(await read('../public/index.html')).includes('id="radar-count"'));
assert.equal(nodes["#radar-contacts"].innerHTML.includes("undefined%"), false);
const now = Date.parse("2026-09-28T12:00:00Z");
const yesterday = "2026-09-27T12:00:00Z", tomorrow = "2026-09-29T12:00:00Z", nextWeek = "2026-10-05T12:00:00Z";
const official = "https://robertsspaceindustries.com/en/comm-link/transmission/21339-example";
const scheduled = { name: "Bestätigt", start: tomorrow, end: nextWeek, sourceUrl: official };
assert.equal(ctx.activeEvents([{ name: "Ohne Datum" }, { name: "Abgelaufen", start: yesterday, end: now-1, sourceUrl: official }, { name: "Ohne Ende", start: tomorrow, sourceUrl: official }, { ...scheduled, sourceUrl: "javascript:alert(1)" }, scheduled],now).length, 1);
assert.equal(ctx.activeEvents([scheduled],now)[0].name,"Bestätigt");
const realEvent={name:"Pirate Week 2026 | Star Citizen",type:"Event",start:"2026-09-29T07:25:00.000Z",end:"2026-09-30T07:24:00.000Z",sourceUrl:official};
const duringEvent=Date.parse("2026-09-29T07:35:00.000Z");
assert.equal(ctx.activeEvents([realEvent],duringEvent).length,1);
assert.match(ctx.renderConfirmedEvents(ctx.activeEvents([realEvent],duringEvent),duringEvent),/JETZT AKTIV/);
assert.match(ctx.renderConfirmedEvents([scheduled],now),/BESTÄTIGT · DEMNÄCHST/);
const freeFly = { active: true, title: "Test Free Fly", start: yesterday, end: tomorrow, sourceUrl: official, summary: "Bestätigter Test." };
assert.equal(ctx.freeFlyState(freeFly,now).status,"active");
assert.equal(ctx.freeFlyState({...freeFly,start:realEvent.start,end:realEvent.end},duringEvent).status,"active");
assert.equal(ctx.freeFlyState({ ...freeFly, start: tomorrow, end: nextWeek },now).status,"upcoming");
assert.equal(ctx.freeFlyState(freeFly,Date.parse(nextWeek)).status,"inactive");
assert.equal(ctx.freeFlyState({ ...freeFly, end: null },now).status,"inactive");
assert.equal(ctx.freeFlyState({ ...freeFly, sourceUrl: "https://example.com/event" },now).status,"inactive");
assert.equal(ctx.eventNews([{ title: "Pirate Week", date: yesterday, category: "EVENT", sourceUrl: official }, { title: "Alte News", date: "2026-01-01T12:00:00Z", category: "EVENT", sourceUrl: official }, { title: "Falsche Quelle", date: yesterday, category: "FREE FLY", sourceUrl: "https://example.com/" }],now).length,1);
assert.match(ctx.renderConfirmedEvents([scheduled],now),/BESTÄTIGT/);
assert.match(ctx.renderEventNews([{ title: "Pirate Week",date:yesterday,category:"EVENT",sourceUrl:official }]),/MELDUNG VOM/);
assert.ok((await read("../public/free-fly.html")).includes('id="event-news"'));
await ctx.loadJSON("news.json");
assert.equal(vm.runInContext("usingStaticData", ctx), true);
console.log("Statischer Datenstand, fünf Patch Notes, sechs History-Einträge und Rückfallkennzeichnung: OK");
