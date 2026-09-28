import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../worker/index.js", import.meta.url), "utf8");
const worker = (await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`)).default;
const data = {
  "public/data/freefly.json": { active: false, title: "Kein Free Fly aktiv" },
  "public/data/events.json": []
};
const sha = { "public/data/freefly.json": "sha-free-1", "public/data/events.json": "sha-events-1" };
let writes = 0;
globalThis.fetch = async (target, options = {}) => {
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
const req = (path, payload, key = "private", origin = "https://example.com") => new Request(`https://example.com${path}`, { method: payload ? "POST" : "GET", headers: { "x-run-secret": key, origin }, body: payload ? JSON.stringify(payload) : undefined });
const official = "https://robertsspaceindustries.com/en/comm-link/transmission/21300-Test";
const start = "2030-06-01T12:00:00.000Z", end = "2030-06-03T12:00:00.000Z";

assert.equal((await (await worker.fetch(new Request("https://example.com/health"), env)).json()).version, "0.11.1");
assert.equal((await worker.fetch(new Request("https://example.com/manage/events/state"), env)).status, 401);
const initial = await (await worker.fetch(req("/manage/events/state"), env)).json();
assert.deepEqual(initial.events, []);
assert.equal(initial.freeFly.active, false);
assert.equal((await worker.fetch(new Request("https://example.com/manage/events"), env)).status, 200);
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
console.log("Terminpflege: Secret, Quellprüfung, Vorschau, GitHub-SHA und Live-Endpunkte: OK");
