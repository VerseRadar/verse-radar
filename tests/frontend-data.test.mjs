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
function fakeContact(left,top){
  const classes=new Set();
  return {classList:{contains:name=>classes.has(name),toggle(name,on){on?classes.add(name):classes.delete(name)},remove:name=>classes.delete(name)},getBoundingClientRect(){return {left,top,width:13,height:13}}};
}
const contactNodes=[fakeContact(293.5,193.5),fakeContact(193.5,293.5)];
const sweep={};
const panel={offsetWidth:400,querySelector:()=>sweep,getBoundingClientRect:()=>({left:0,top:0,width:400,height:400})};
const nodes = { "#radar-contacts": { innerHTML: "",closest:()=>panel,querySelectorAll:()=>contactNodes } };
let beamAngle=0,nextFrameId=0;
const pendingFrames=new Map();
ctx.requestAnimationFrame=callback=>{pendingFrames.set(++nextFrameId,callback);return nextFrameId};
ctx.cancelAnimationFrame=id=>pendingFrames.delete(id);
ctx.getComputedStyle=()=>({transform:`matrix(${Math.cos(beamAngle*Math.PI/180)}, ${Math.sin(beamAngle*Math.PI/180)}, 0, 0, 0, 0)`});
function frame(angle){beamAngle=angle;const callbacks=[...pendingFrames.values()];pendingFrames.clear();callbacks.forEach(callback=>callback())}
ctx.document.querySelector = selector => nodes[selector] || null;
ctx.radarContacts(news, Array.from({ length: 4 }, () => ({ name: "Event" })));
assert.equal((nodes["#radar-contacts"].innerHTML.match(/class="radar-contact/g)||[]).length,10);
frame(0);
assert.equal(contactNodes[0].classList.contains("is-scanned"),true);
assert.equal(contactNodes[1].classList.contains("is-scanned"),false);
frame(85);
assert.equal(contactNodes[1].classList.contains("is-scanned"),false);
frame(90);
assert.equal(contactNodes[1].classList.contains("is-scanned"),true);
frame(112);
assert.equal(contactNodes[1].classList.contains("is-scanned"),false);
assert.match(await read("../public/styles.css"),/\.radar-contact\.is-scanned\{/);
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
const community={name:"Ingame Turnier",type:"Community Event",organizer:"Spielergruppe",start:yesterday,end:tomorrow,summary:"Wettbewerb",prize:"Geldpreis laut Veranstalter",sourceUrl:"https://community.example.org/event",imageUrl:"/event-image/"+"a".repeat(64)+".png"};
assert.equal(ctx.activeEvents([community],now).length,1);
assert.match(ctx.renderConfirmedEvents([community],now),/keine offizielle RSI-Veranstaltung/);
assert.match(ctx.renderConfirmedEvents([community],now),/Veranstalterseite und Bedingungen/);
assert.equal(ctx.activeEvents([{...community,sourceUrl:"javascript:alert(1)"}],now).length,0);
assert.equal(ctx.activeEvents([{...community,imageUrl:"https://evil.example/image.png"}],now).length,0);
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
