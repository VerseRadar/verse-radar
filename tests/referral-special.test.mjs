import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { importWorker } from "./import-worker.mjs";

const source = await readFile(new URL("../worker/index.js", import.meta.url), "utf8");
const worker = (await importWorker(source)).default;
const specialPath = "public/data/referral-special.json";
let stored = null, sha = null, writes = 0;
globalThis.fetch = async (target, options = {}) => {
  if (!String(target).includes(`/contents/${specialPath}`)) throw Error(`Unexpected URL: ${target}`);
  if (options.method === "PUT") {
    const submitted = JSON.parse(options.body);
    assert.equal(submitted.sha || null, sha);
    stored = JSON.parse(Buffer.from(submitted.content, "base64").toString());
    sha = `sha-${++writes}`;
    return Response.json({ content: { sha } });
  }
  if (!sha) return Response.json({ message: "Not Found" }, { status: 404 });
  return Response.json({ sha, content: Buffer.from(JSON.stringify(stored)).toString("base64") });
};
const env = { RUN_SECRET: "private", GITHUB_TOKEN: "github", GITHUB_REPO: "owner/repo", GITHUB_BRANCH: "main" };
const login = await worker.fetch(new Request("https://example.com/manage/login", { method: "POST", headers: { origin: "https://example.com" }, body: JSON.stringify({ secret: "private" }) }), env);
const cookie = login.headers.get("set-cookie").split(";")[0];
const req = (path, body, origin = "https://example.com") => new Request(`https://example.com${path}`, { method: body ? "POST" : "GET", headers: { cookie, origin }, body: body ? JSON.stringify(body) : undefined });
const now = Date.now(), date = offset => new Date(now+offset).toISOString();
const proposal = { action: "set", data: {
  title: "Referral-Aktion Test", sourceUrl: "https://robertsspaceindustries.com/en/comm-link/transmission/21300-Test",
  imageUrl: "https://robertsspaceindustries.com/i/abc/source.webp", start: date(-3600000), end: date(3600000),
  rewards: "Schiff für neue Spieler\nPaint für den Werber", note: "Offizielle Quelle prüfen"
} };
assert.equal((await worker.fetch(new Request("https://example.com/manage/referral"), env)).status, 302);
assert.equal((await worker.fetch(new Request("https://example.com/manage/referral/state"), env)).status, 401);
assert.deepEqual(await (await worker.fetch(new Request("https://example.com/api/referral-special"), env)).json(), { active: false });
const page = await worker.fetch(req("/manage/referral"), env);
assert.equal(page.status, 200);
assert.match(await page.text(), /Direkter Bildlink von RSI/);
assert.match(page.headers.get("content-security-policy"), /img-src https:\/\/robertsspaceindustries\.com/);
assert.equal((await (await worker.fetch(req("/manage/referral/state"), env)).json()).special, null);
assert.equal((await worker.fetch(req("/manage/referral/preview", proposal, "https://evil.example"), env)).status, 403);
for (const changed of [
  { sourceUrl: "https://evil.example/action" }, { imageUrl: "https://evil.example/image.webp" },
  { imageUrl: "javascript:alert(1)" }, { rewards: "" }, { end: date(-1000) }, { end: date(-7200000) }
]) {
  const bad = await worker.fetch(req("/manage/referral/preview", { ...proposal, data: { ...proposal.data, ...changed } }), env);
  assert.equal((await bad.json()).ok, false);
}
assert.equal(writes, 0);
const preview = await (await worker.fetch(req("/manage/referral/preview", proposal), env)).json();
assert.equal(preview.published, false);
assert.deepEqual(preview.proposal.rewards, ["Schiff für neue Spieler", "Paint für den Werber"]);
assert.equal(preview.expectedSha, null);
assert.equal((await worker.fetch(req("/manage/referral/publish", { ...proposal, expectedSha: "wrong" }), env)).status, 409);
assert.equal(writes, 0);
const saved = await (await worker.fetch(req("/manage/referral/publish", { ...proposal, expectedSha: null }), env)).json();
assert.equal(saved.published, true);
assert.equal(writes, 1);
assert.equal((await (await worker.fetch(new Request("https://example.com/api/referral-special"), env)).json()).active, true);
const future = { ...proposal, data: { ...proposal.data, start: date(7200000), end: date(10800000) } };
assert.equal((await (await worker.fetch(req("/manage/referral/publish", { ...future, expectedSha: sha }), env)).json()).published, true);
assert.deepEqual(await (await worker.fetch(new Request("https://example.com/api/referral-special"), env)).json(), { active: false });
stored = { ...stored, start: date(-10800000), end: date(-7200000) };
assert.deepEqual(await (await worker.fetch(new Request("https://example.com/api/referral-special"), env)).json(), { active: false });
const disabled = await (await worker.fetch(req("/manage/referral/publish", { action: "disable", expectedSha: sha }), env)).json();
assert.equal(disabled.published, true);
assert.deepEqual(await (await worker.fetch(new Request("https://example.com/api/referral-special"), env)).json(), { active: false });
assert.equal((await (await worker.fetch(new Request("https://example.com/api/referral"), env)).json()).enabled, true);
const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
const ctx = { document: { addEventListener() {} }, Intl, Date, URL, encodeURIComponent };
vm.createContext(ctx);vm.runInContext(app, ctx);
assert.equal(ctx.renderReferralSpecial(preview.proposal, Date.parse(preview.proposal.start)-1), "");
assert.equal(ctx.renderReferralSpecial(preview.proposal, Date.parse(preview.proposal.end)), "");
assert.match(ctx.renderReferralSpecial(preview.proposal, now), /Schiff für neue Spieler/);
assert.match(ctx.renderReferralSpecial(preview.proposal, now), /Was erhält der neue Spieler zusätzlich\?/);
assert.match(ctx.renderReferralSpecial(preview.proposal, now), /innerhalb von 24 Stunden/);
assert.match(ctx.renderReferralSpecial(preview.proposal, now), /Game Package/);
assert.match(ctx.renderReferralSpecial(preview.proposal, now), /40-USD-Grenze erst währenddessen/);
assert.equal(ctx.renderReferralSpecial({ ...preview.proposal, title: "<script>" }, now).includes("<script>"), false);
