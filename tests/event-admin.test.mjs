import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../worker/index.js", import.meta.url), "utf8");
const worker = (await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`)).default;
const data = {
  "public/data/freefly.json": { active: false, title: "Kein Free Fly aktiv" },
  "public/data/events.json": []
};
const sha = { "public/data/freefly.json": "sha-free-1", "public/data/events.json": "sha-events-1" };
const imageFiles=new Map();
let writes = 0;
globalThis.fetch = async (target, options = {}) => {
  const imagePath=String(target).match(/\/contents\/(public\/event-images\/[a-f0-9]{64}\.(?:png|jpg|webp))/)?.[1];
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
  const path = String(target).match(/\/contents\/(public\/data\/(?:events|freefly)\.json)/)?.[1];
  if (!path) throw Error(`Unexpected URL ${target}`);
  if (options.method === "PUT") {
    assert.equal(JSON.parse(options.body).sha, sha[path]);
    data[path] = JSON.parse(Buffer.from(JSON.parse(options.body).content, "base64").toString("utf8"));
    sha[path] = `sha-${++writes}`;
    return Response.json({ content: { sha: sha[path] } });
  }
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
assert.equal((await worker.fetch(new Request("https://example.com/manage/events/state",{headers:{cookie:cookie.replace(/.$/,"X")}}),env)).status,401);
const req = (path, payload, key = "private", origin = "https://example.com") => new Request(`https://example.com${path}`, { method: payload ? "POST" : "GET", headers: { cookie:key==="private"?cookie:"vr_admin=wrong", origin }, body: payload ? JSON.stringify(payload) : undefined });
const official = "https://robertsspaceindustries.com/en/comm-link/transmission/21300-Test";
const start = "2030-06-01T12:00:00.000Z", end = "2030-06-03T12:00:00.000Z";

assert.equal((await (await worker.fetch(new Request("https://example.com/health"), env)).json()).version, "0.13.3");
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
assert.match(pageHtml, /Free Fly & Events pflegen/);
assert.doesNotMatch(pageHtml,/id="secret"/);
assert.match(pageHtml,/Eigenes Community Event/);
assert.equal(pageHtml, await readFile(new URL("../worker/pages/event-admin.html", import.meta.url), "utf8"));
assert.match(page.headers.get("content-security-policy"), /connect-src 'self'/);
assert.doesNotMatch(await readFile(new URL("../worker/pages/event-admin.html", import.meta.url), "utf8"), /href="\/styles\.css"/);
assert.equal((await worker.fetch(new Request("https://example.com/event-admin.html"),env)).status,302);
assert.equal((await worker.fetch(new Request("https://example.com/manage/events/image",{method:"POST",headers:{origin:"https://example.com"},body:"fake"}),env)).status,401);
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
const uploadRequest=(body,auth=cookie)=>new Request("https://example.com/manage/events/image",{method:"POST",headers:{origin:"https://example.com",cookie:auth,"content-type":"image/png"},body});
assert.equal((await worker.fetch(uploadRequest("<svg onload=alert(1)>"),env)).status,413);
const upload=await (await worker.fetch(uploadRequest(png),env)).json();
assert.match(upload.imageUrl,/^\/event-image\/[a-f0-9]{64}\.png$/);
assert.equal(imageFiles.size,1);
const image=await worker.fetch(new Request("https://example.com"+upload.imageUrl),env);
assert.equal(image.headers.get("content-type"),"image/png");
assert.deepEqual(Buffer.from(await image.arrayBuffer()),png);
const community={kind:"community",action:"set",data:{name:"Spieler-Turnier",organizer:"Community Team",start,end,sourceUrl:"https://community.example.org/turnier",summary:"Ingame-Turnier mit Anmeldung.",prize:"Geldpreise laut Veranstalter",imageUrl:upload.imageUrl}};
assert.equal((await (await worker.fetch(req("/manage/events/preview",{...community,data:{...community.data,imageUrl:"https://evil.example/a.png"}}),env)).json()).ok,false);
const communityPreview=await (await worker.fetch(req("/manage/events/preview",community),env)).json();
assert.equal(communityPreview.ok,true,JSON.stringify(communityPreview));
assert.equal(communityPreview.proposal[0].type,"Community Event");
assert.equal((await (await worker.fetch(req("/manage/events/publish",{...community,expectedSha:communityPreview.expectedSha}),env)).json()).published,true);
assert.equal((await (await worker.fetch(new Request("https://example.com/api/events"),env)).json())[0].imageUrl,upload.imageUrl);
const dashboard=await worker.fetch(req("/manage"),env);
assert.match(await dashboard.text(),/Game Packages pflegen/);
const logout=await worker.fetch(new Request("https://example.com/manage/logout",{method:"POST",headers:{origin:"https://example.com",cookie}}),env);
assert.match(logout.headers.get("set-cookie"),/Max-Age=0/);
console.log("Terminpflege: Admin-Sitzung, Bild-Upload, Community Event und GitHub-Veröffentlichung: OK");
