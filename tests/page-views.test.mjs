import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { importWorker } from "./import-worker.mjs";

const source = await readFile(new URL("../worker/index.js", import.meta.url), "utf8");
const { default: worker, PageViewCounter } = await importWorker(source);
const db = new DatabaseSync(":memory:");
const state = { storage: { sql: { exec(sql, ...args) {
  const statement = db.prepare(sql);
  if (/^SELECT/i.test(sql)) return { toArray: () => statement.all(...args) };
  statement.run(...args);
  return { toArray: () => [] };
} } } };
const counter = new PageViewCounter(state, {});
const env = { RUN_SECRET: "private-test-secret", PAGE_VIEWS: { getByName(name) {
  assert.equal(name, "verse-radar");
  return counter;
} } };
const url = "https://example.com/api/page-view";
const post = headers => worker.fetch(new Request(url, { method: "POST", headers }), env);
assert.equal((await worker.fetch(new Request(url), env)).status, 405);
assert.equal((await post({ origin: "https://other.example" })).status, 403);
assert.equal((await post({ origin: "https://example.com", "sec-fetch-site": "cross-site" })).status, 403);
assert.equal((await post({ origin: "https://example.com" })).status, 204);
assert.equal((await post({ origin: "https://example.com" })).status, 204);
assert.equal(counter.monthFor(new Date("2026-09-30T22:30:00Z")), "2026-10");
assert.deepEqual(db.prepare("PRAGMA table_info(monthly_views)").all().map(row => row.name), ["month", "views"]);

const anonymous = await worker.fetch(new Request("https://example.com/manage/stats"), env);
assert.equal(anonymous.status, 401);
const login = await worker.fetch(new Request("https://example.com/manage/login", {
  method: "POST", headers: { origin: "https://example.com" }, body: JSON.stringify({ secret: env.RUN_SECRET })
}), env);
assert.equal(login.status, 200);
const cookie = login.headers.get("set-cookie").split(";")[0];
const stats = await worker.fetch(new Request("https://example.com/manage/stats", { headers: { cookie } }), env);
assert.equal(stats.status, 200);
assert.equal(stats.headers.get("set-cookie"), null);
const data = await stats.json();
assert.equal(data.metric, "page_views");
assert.equal(data.months.length, 6);
assert.equal(data.months[0].views, 2);
assert.equal(data.months.slice(1).every(row => row.views === 0), true);
const dashboard = await worker.fetch(new Request("https://example.com/manage", { headers: { cookie } }), env);
assert.match(await dashboard.text(), /Seitenaufrufe pro Monat/);
assert.equal((await worker.fetch(new Request("https://example.com/manage/stats", { method: "POST", headers: { cookie } }), env)).status, 405);
console.log("Monatliche Aufrufe und geschütztes Admin-Dashboard geprüft.");
