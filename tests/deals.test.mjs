import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../worker/index.js", import.meta.url), "utf8");
const worker = (await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`)).default;
const path = "public/data/deals.json";
let deals = [], sha = "deals-sha-1", writes = 0;
globalThis.fetch = async (target, options = {}) => {
  if (!String(target).includes(`/contents/${path}`)) throw Error(`Unexpected URL: ${target}`);
  if (options.method === "PUT") {
    assert.equal(JSON.parse(options.body).sha, sha);
    deals = JSON.parse(Buffer.from(JSON.parse(options.body).content, "base64").toString());
    sha = `sha-${++writes}`;
    return Response.json({ content: { sha } });
  }
  return Response.json({ sha, content: Buffer.from(JSON.stringify(deals)).toString("base64") });
};
const env = { RUN_SECRET: "private", GITHUB_TOKEN: "github-key", GITHUB_REPO: "example/repo", GITHUB_BRANCH: "main" };
const request = (path, body, key = "private") => new Request(`https://example.com${path}`, { method: body ? "POST" : "GET", headers: { "x-run-secret": key, origin: "https://example.com" }, body: body ? JSON.stringify(body) : undefined });
const shop = "https://robertsspaceindustries.com/pledge/Packages/Test-Game-Package";
const future = "2030-10-01T12:00:00.000Z";
const picture = "https://media.robertsspaceindustries.com/package/aurora.jpg?size=large";
const proposal = { action: "set", data: { name: "Test Game Package", type: "Game Package", sourceUrl: shop, imageUrl: picture, price: "45.00", oldPrice: "50.00", currency: "USD", usdBeforeTax: "45.00", ship: "Aurora", gameAccess: "Star Citizen Digital Download", extras: "3 Monate Versicherung\nSkin Blau", validUntil: future, note: "Manuell geprüft." } };

assert.equal((await worker.fetch(new Request("https://example.com/manage/deals/state"), env)).status, 401);
const page = await worker.fetch(new Request("https://example.com/manage/deals"), env);
assert.equal(page.status, 200);
assert.equal(await page.text(), await readFile(new URL("../public/deal-admin.html", import.meta.url), "utf8"));
assert.equal((await (await worker.fetch(request("/manage/deals/state"), env)).json()).deals.length, 0);
assert.equal((await worker.fetch(request("/manage/deals/preview", proposal, "bad"), env)).status, 401);
for (const changed of [ { sourceUrl: "https://evil.example/pledge/Packages/X" }, { sourceUrl: "https://robertsspaceindustries.com/en/comm-link/transmission/21339-X" }, { sourceUrl: "https://robertsspaceindustries.com/pledge/Standalone-Ships/Aurora" }, { imageUrl: "" }, { imageUrl: "https://evil.example/ship.jpg" }, { imageUrl: "https://robertsspaceindustries.com.evil.example/ship.png" }, { imageUrl: "javascript:alert(1)" }, { imageUrl: "https://media.robertsspaceindustries.com/page.html" }, { type: "Sonstiges Angebot" }, { oldPrice: "40" }, { usdBeforeTax: "39" }, { ship: "" }, { gameAccess: "" }, { extras: "" }, { validUntil: "2020-01-01T00:00:00.000Z" } ]) {
  assert.equal((await (await worker.fetch(request("/manage/deals/preview", { ...proposal, data: { ...proposal.data, ...changed } }), env)).json()).ok, false);
}
assert.equal(writes, 0);
const preview = await (await worker.fetch(request("/manage/deals/preview", proposal), env)).json();
assert.equal(preview.published, false);
assert.equal(preview.proposal[0].price, 45);
assert.equal(preview.proposal[0].imageUrl, picture);
assert.deepEqual(preview.proposal[0].contents.extras, ["3 Monate Versicherung", "Skin Blau"]);
assert.equal(preview.proposal[0].officialEndProvided, true);
const withoutEnd = await (await worker.fetch(request("/manage/deals/preview", { ...proposal, data: { ...proposal.data, validUntil: "" } }), env)).json();
assert.equal(withoutEnd.proposal[0].officialEndProvided, false);
assert.ok(Date.parse(withoutEnd.proposal[0].validUntil)-Date.parse(withoutEnd.proposal[0].checkedAt) === 48*3600000);
assert.equal(writes, 0);
assert.equal((await worker.fetch(request("/manage/deals/publish", { ...proposal, expectedSha: "stale" }), env)).status, 409);
const saved = await (await worker.fetch(request("/manage/deals/publish", { ...proposal, expectedSha: preview.expectedSha }), env)).json();
assert.equal(saved.published, true);
assert.equal(writes, 1);
assert.equal((await (await worker.fetch(new Request("https://example.com/api/deals"), env)).json())[0].name, "Test Game Package");
const providedReferral = "https://www.robertsspaceindustries.com/enlist?referral=STAR-6KT2-XJBC";
assert.deepEqual(await (await worker.fetch(new Request("https://example.com/api/referral"), env)).json(), { enabled: true, url: providedReferral });
assert.deepEqual(await (await worker.fetch(new Request("https://example.com/api/referral"), { ...env, REFERRAL_URL: "https://robertsspaceindustries.com/enlist?referral=DEINCODE" })).json(), { enabled: true, url: providedReferral });
assert.equal((await (await worker.fetch(new Request("https://example.com/api/referral"), { ...env, REFERRAL_URL: "https://robertsspaceindustries.com/enlist?referral=ABCDE123" })).json()).enabled, true);

const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
const context = { document: { addEventListener() {} }, Intl, Date, URL, encodeURIComponent };
vm.createContext(context); vm.runInContext(app, context);
const now = Date.now();
assert.equal(context.liveDeals(deals, now).length, 1);
assert.equal(context.liveDeals([{ ...deals[0], imageUrl: "" }], now).length, 0);
assert.equal(context.liveDeals([{ ...deals[0], type: "Sonstiges Angebot" }], now).length, 0);
assert.equal(context.liveDeals([{ ...deals[0], contents: undefined }], now).length, 0);
assert.equal(context.isOfficialSource(providedReferral), true);
assert.equal(context.liveDeals([{ ...deals[0], checkedAt: new Date(now-49*3600000).toISOString() }], now).length, 0);
assert.equal(context.liveDeals([{ ...deals[0], validUntil: new Date(now-1).toISOString() }], now).length, 0);
assert.equal(context.liveDeals([{ ...deals[0], sourceUrl: "javascript:alert(1)" }], now).length, 0);
assert.match(context.renderDeals(deals), /Test Game Package/);
assert.match(context.renderDeals(deals), /<img src="https:\/\/media\.robertsspaceindustries\.com\/package\/aurora\.jpg\?size=large"/);
assert.match(context.renderDeals(deals), /Referral-Preisgrenze \(40 USD vor Steuern\): <strong>Ja<\/strong>/);
assert.match(context.renderDeals([{ ...deals[0], usdBeforeTax: 39.99 }]), /Referral-Preisgrenze \(40 USD vor Steuern\): <strong>Nein<\/strong>/);
assert.match(context.renderDeals(deals), /Skin Blau/);
assert.ok(!context.renderDeals([{ ...deals[0], contents: { ...deals[0].contents, extras: ["<script>alert(1)</script>"] } }]).includes("<script>"));
assert.ok(!context.renderDeals([{ ...deals[0], name: "<script>alert(1)</script>" }]).includes("<script>"));
assert.equal((await readFile(new URL("../public/referral.html", import.meta.url), "utf8")).includes("DEINCODE"), false);
const remove = { action: "remove", data: { sourceUrl: shop } };
const removePreview = await (await worker.fetch(request("/manage/deals/preview", remove), env)).json();
assert.equal(removePreview.proposal.length, 0);
assert.equal((await (await worker.fetch(request("/manage/deals/publish", { ...remove, expectedSha: removePreview.expectedSha }), env)).json()).published, true);
assert.equal(writes, 2);
console.log("Deals: Preisvalidierung, 48h-Ablauf, Quellenlink, Secret, Vorschau und Live-Veröffentlichung: OK");
