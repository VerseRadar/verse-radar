import { importWorker } from "./import-worker.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../worker/index.js", import.meta.url), "utf8");
const worker = (await importWorker(source)).default;
const data = {
  "public/data/freefly.json": { active: false, title: "Kein Free Fly aktiv" },
  "public/data/events.json": []
};
const sha = { "public/data/freefly.json": "sha-free-1", "public/data/events.json": "sha-events-1" };
const imageFiles=new Map();
let writes = 0;
globalThis.fetch = async (target, options = {}) => {
  const imagePath=String(target).match(/\/contents\/(public\/activity-images\/[a-f0-9]{64}\.(?:png|jpg|webp))/)?.[1];
  if (imagePath) {
    if(options.method==="PUT"){
      const bytes=Buffer.from(JSON.parse(options.body).content,"base64");
      imageFiles.set(imagePath,bytes);
      return Response.json({content:{sha:"image-sha"}});
    }
    if (!imageFiles.has(imagePath)) return Response.json({message:"Not Found"},{status:404});
    const bytes=imageFiles.get(imagePath);
    return Response.json({sha:"image-sha",size:bytes.length,content:bytes.toString("base64")});
  }
  const path = String(target).match(/\/contents\/(public\/data\/(?:events|freefly|activities)\.json)/)?.[1];
  if (!path) throw Error(`Unexpected URL ${target}`);
  if (options.method === "PUT") {
    assert.equal(JSON.parse(options.body).sha||null, sha[path]||null);
    data[path] = JSON.parse(Buffer.from(JSON.parse(options.body).content, "base64").toString("utf8"));
    sha[path] = `sha-${++writes}`;
    return Response.json({ content: { sha: sha[path] } });
  }
  if(!(path in data))return Response.json({message:"Not Found"},{status:404});
  return Response.json({ sha: sha[path], content: Buffer.from(JSON.stringify(data[path])).toString("base64") });
};
const env = { RUN_SECRET: "private", GITHUB_TOKEN: "github-key", GITHUB_REPO: "example/verse-radar", GITHUB_BRANCH: "main",
  ASSETS: { fetch: async () => new Response("<h1>Terminpflege</h1>", { headers: { "content-type": "text/html" } }) } };
const login = await worker.fetch(new Request("https://example.com/manage/login", {method:"POST",headers:{origin:"https://example.com","content-type":"application/json"},body:JSON.stringify({secret:"private"})}), env);
assert.equal(login.status,200);
const cookie = login.headers.get("set-cookie").split(";")[0];
assert.match(login.headers.get("set-cookie"),/HttpOnly; Secure; SameSite=Strict/);
assert.equal((await worker.fetch(new Request("https://example.com/manage/login",{method:"POST",headers:{origin:"https://example.com"},body:JSON.stringify({secret:"wrong"})}),env)).status,401);
assert.equal((await worker.fetch(new Request("https://example.com/manage/login",{method:"POST",headers:{origin:"https://evil.example"},body:JSON.stringify({secret:"private"})}),env)).status,403);
assert.equal((await worker.fetch(new Request("https://example.com/manage/events/state",{headers:{"x-run-secret":"private"}}),env)).status,401);
assert.equal((await worker.fetch(new Request("https://example.com/manage/events/state",{headers:{cookie:cookie.replace(/\.([A-Za-z0-9_-]{43})$/,(_,signature)=>"."+(signature[0]==="A"?"B":"A")+signature.slice(1))}}),env)).status,401);
const req = (path, payload, key = "private", origin = "https://example.com") => new Request(`https://example.com${path}`, { method: payload ? "POST" : "GET", headers: { cookie:key==="private"?cookie:"vr_admin=wrong", origin }, body: payload ? JSON.stringify(payload) : undefined });
const official = "https://robertsspaceindustries.com/en/comm-link/transmission/21300-Test";
const start = "2030-06-01T12:00:00.000Z", end = "2030-06-03T12:00:00.000Z";

assert.equal((await (await worker.fetch(new Request("https://example.com/health"), env)).json()).version, "0.13.10");
assert.equal((await worker.fetch(new Request("https://example.com/manage/events/state"), env)).status, 401);
const initial = await (await worker.fetch(req("/manage/events/state"), env)).json();
assert.deepEqual(initial.events, []);
assert.equal(initial.freeFly.active, false);
assert.equal((await worker.fetch(new Request("https://example.com/manage/events"),env)).status,302);
assert.equal((await worker.fetch(new Request("https://example.com/manage"),env)).status,302);
assert.equal((await worker.fetch(new Request("https://example.com/manage/session",{headers:{cookie}}),env)).status,200);
const page = await worker.fetch(req("/manage/events"), { ...env, ASSETS: undefined });
assert.equal(page.status, 200);
const pageHtml = await page.text();
assert.match(pageHtml, /Free Fly, Events & Ingame-Aktionen pflegen/);
assert.doesNotMatch(pageHtml,/id="secret"/);
assert.match(pageHtml,/Offizielle Ingame-Aktion/);
assert.equal(pageHtml, await readFile(new URL("../worker/pages/event-admin.html", import.meta.url), "utf8"));
assert.match(page.headers.get("content-security-policy"), /connect-src 'self'/);
assert.doesNotMatch(await readFile(new URL("../worker/pages/event-admin.html", import.meta.url), "utf8"), /href="\/styles\.css"/);
assert.equal((await worker.fetch(new Request("https://example.com/event-admin.html"),env)).status,302);
assert.equal((await worker.fetch(new Request("https://example.com/manage/activities/image",{method:"POST",headers:{origin:"https://example.com"},body:"fake"}),env)).status,401);
const proposal = { kind: "freefly", action: "set", data: { title: "Test Free Fly", sourceUrl: official, start, end, summary: "Bestätigter Zeitraum." } };
assert.equal((await worker.fetch(req("/manage/events/preview", proposal, "wrong"), env)).status, 401);
assert.equal((await worker.fetch(req("/manage/events/preview", proposal, "private", "https://evil.example"), env)).status, 403);
let invalid = await (await worker.fetch(req("/manage/events/preview", { ...proposal, data: { ...proposal.data, sourceUrl: "https://evil.example/" } }), env)).json();
assert.equal(invalid.ok, false);
invalid = await (await worker.fetch(req("/manage/events/preview", { ...proposal, data: { ...proposal.data, end: start } }), env)).json();
assert.equal(invalid.ok, false);
assert.equal(writes, 0);
const preview = await (await worker.fetch(req("/manage/events/preview", proposal), env)).json();
assert.equal(preview.published, false);
assert.equal(preview.proposal.active, true);
assert.equal(writes, 0);
assert.equal((await worker.fetch(req("/manage/events/publish", { ...proposal, expectedSha: "stale-sha" }), env)).status, 409);
const saved = await (await worker.fetch(req("/manage/events/publish", { ...proposal, expectedSha: preview.expectedSha }), env)).json();
assert.equal(saved.published, true);
assert.equal(writes, 1);
assert.equal((await (await worker.fetch(new Request("https://example.com/api/freefly"), env)).json()).title, "Test Free Fly");

const event = { kind: "event", action: "set", data: { name: "Test Event", start, end, sourceUrl: official } };
const eventPreview = await (await worker.fetch(req("/manage/events/preview", event), env)).json();
assert.equal(eventPreview.proposal.length, 1);
assert.equal(writes, 1);
assert.equal((await (await worker.fetch(req("/manage/events/publish", { ...event, expectedSha: eventPreview.expectedSha }), env)).json()).published, true);
assert.equal((await (await worker.fetch(new Request("https://example.com/api/events"), env)).json()).length, 1);
const removal = { kind: "event", action: "remove", data: { sourceUrl: official, start } };
const removePreview = await (await worker.fetch(req("/manage/events/preview", removal), env)).json();
assert.equal(removePreview.proposal.length, 0);
assert.equal((await (await worker.fetch(req("/manage/events/publish", { ...removal, expectedSha: removePreview.expectedSha }), env)).json()).published, true);
assert.equal((await (await worker.fetch(new Request("https://example.com/api/events"), env)).json()).length, 0);
const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9ZcwYc8AAAAASUVORK5CYII=","base64");
const uploadRequest=(body,auth=cookie)=>new Request("https://example.com/manage/activities/image",{method:"POST",headers:{origin:"https://example.com",cookie:auth,"content-type":"image/png"},body});
assert.equal((await worker.fetch(uploadRequest("<svg onload=alert(1)>"),env)).status,413);
assert.equal((await worker.fetch(uploadRequest(Buffer.alloc(1024*1024+1)),env)).status,413);
const upload=await (await worker.fetch(uploadRequest(png),env)).json();
assert.match(upload.imageUrl,/^\/activity-image\/[a-f0-9]{64}\.png$/);
assert.equal(imageFiles.size,1);
assert.equal((await (await worker.fetch(uploadRequest(png),env)).json()).imageUrl,upload.imageUrl);
assert.equal(imageFiles.size,1);
const image=await worker.fetch(new Request("https://example.com"+upload.imageUrl),env);
assert.equal(image.headers.get("content-type"),"image/png");
assert.deepEqual(Buffer.from(await image.arrayBuffer()),png);
const activity={kind:"activity",action:"set",data:{name:"Orison Relief Support",sourceUrl:"https://robertsspaceindustries.com/spectrum/community/SC/forum/3/thread/orison-relief-support-faq",tasks:"Material laut RSI abgeben",rewards:"Dauerhafte Account-Belohnung laut RSI",summary:"Aufträge mit persönlichem Fortschritt",imageUrl:upload.imageUrl}};
assert.equal((await (await worker.fetch(req("/manage/events/preview",{...activity,data:{...activity.data,sourceUrl:"https://community.example.org/turnier"}}),env)).json()).ok,false);
assert.equal((await (await worker.fetch(req("/manage/events/preview",{...activity,data:{...activity.data,imageUrl:"https://evil.example/a.png"}}),env)).json()).ok,false);
assert.equal((await (await worker.fetch(req("/manage/events/preview",{...activity,data:{...activity.data,groupGoals:"Gemeinsam abgeben"}}),env)).json()).ok,false);
const activityWithGoals={...activity,data:{...activity.data,groupGoals:"10.000 SCU abgeben\n20.000 SCU abgeben",groupRewards:"Erste Belohnung\nZweite Belohnung"}};
const activityPreview=await (await worker.fetch(req("/manage/events/preview",activityWithGoals),env)).json();
assert.equal(activityPreview.ok,true,JSON.stringify(activityPreview));
assert.equal(activityPreview.proposal[0].type,"Ingame Activity");
assert.equal(activityPreview.proposal[0].end,null);
assert.deepEqual(activityPreview.proposal[0].tasks,["Material laut RSI abgeben"]);
assert.deepEqual(activityPreview.proposal[0].groupGoals,["10.000 SCU abgeben","20.000 SCU abgeben"]);
assert.deepEqual(activityPreview.proposal[0].groupRewards,["Erste Belohnung","Zweite Belohnung"]);
assert.equal((await (await worker.fetch(req("/manage/events/publish",{...activityWithGoals,expectedSha:activityPreview.expectedSha}),env)).json()).published,true);
assert.equal((await (await worker.fetch(new Request("https://example.com/api/activities"),env)).json())[0].imageUrl,upload.imageUrl);
const removeActivity={kind:"activity",action:"remove",data:{sourceUrl:activity.data.sourceUrl}};
const removalPreview=await (await worker.fetch(req("/manage/events/preview",removeActivity),env)).json();
assert.equal((await (await worker.fetch(req("/manage/events/publish",{...removeActivity,expectedSha:removalPreview.expectedSha}),env)).json()).published,true);
assert.deepEqual(await (await worker.fetch(new Request("https://example.com/api/activities"),env)).json(),[]);
const dashboard=await worker.fetch(req("/manage"),env);
assert.match(await dashboard.text(),/Game Packages pflegen/);
const logout=await worker.fetch(new Request("https://example.com/manage/logout",{method:"POST",headers:{origin:"https://example.com",cookie}}),env);
assert.match(logout.headers.get("set-cookie"),/Max-Age=0/);
console.log("Terminpflege: Admin-Sitzung, Bild-Upload, offizielle Ingame-Aktion und GitHub-Veröffentlichung: OK");
