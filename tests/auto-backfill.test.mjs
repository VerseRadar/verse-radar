import { importWorker } from "./import-worker.mjs";
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../worker/index.js', import.meta.url), 'utf8');
const worker = (await importWorker(source)).default;
const versions = [...source.match(/const HISTORICAL_VERSIONS = \[([\s\S]*?)\];/)[1].matchAll(/"(3\.[^"]+)"/g)].map(m => m[1]);
const archivePath = 'public/data/patches.json', statePath = 'public/data/patch-archive-state.json';
const controlPath = 'public/data/patch-backfill-control.json';
const modernVersions = ['4.10.1','4.10','4.9','4.8.3','4.8.2','4.8.1','4.8','4.7.2','4.7.1','4.7','4.6','4.5','4.4','4.3.2','4.3.1','4.3','4.2.1','4.2','4.1.1','4.1','4.0.2','4.0.1','4.0'];
const saved = new Map([
  [archivePath, { sha: 'archive', data: [...versions.filter(v => v !== '3.17.2a'), ...modernVersions].map(v => ({ version: `Alpha ${v}`, sourceUrl: 'https://example.test/existing' })) }],
  [statePath, { sha: 'state', data: { nextPage: 19, complete: false, historicalNextIndex: 30 } }]
]);
let requests = [], failPage = false, failHotfix = false;
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(String(input));
  const method = options.method || 'GET';
  requests.push({ url: url.href, method });
  if (requests.length > 50) throw Error('Too many subrequests by single Worker invocation');
  if (url.host === 'api.github.com') {
    const path = url.pathname.split('/contents/')[1]?.split('?')[0];
    if (method === 'GET') {
      const file = saved.get(path);
      return file ? Response.json({ sha: file.sha, content: Buffer.from(JSON.stringify(file.data)).toString('base64') }) : new Response('', { status: 404 });
    }
    const payload = JSON.parse(options.body);
    if ((payload.sha || null) !== (saved.get(path)?.sha || null)) return new Response('', { status: 409 });
    saved.set(path, { sha: `sha-${crypto.randomUUID()}`, data: JSON.parse(Buffer.from(payload.content, 'base64').toString()) });
    return Response.json({ ok: true });
  }
  if (url.host === 'api.star-citizen.wiki' && url.pathname === '/api/comm-links/18804') {
    if (failHotfix) return new Response('', { status: 503 });
    return Response.json({ data: { content: ('Star Citizen Patch 3.17.2a Major Bug Fixes Combat Assistance Service Beacons. Changed MAX Button on Shop Kiosks to +10. Reduced the HP of Multiple Parts on the Esperia Blade. Fixed 8 Client Crashes Fixed 9 Server Crashes. ').repeat(5) + 'Back to top Star Citizen Patch 3.17.2 Alpha Patch 3.17.2 and Siege of Orison.' } });
  }
  if (url.host === 'api.star-citizen.wiki' && url.pathname === '/api/comm-links') {
    const page = Number(url.searchParams.get('page[number]'));
    if (failPage && page === 21) return new Response('', { status: 503 });
    return Response.json({ meta: { current_page: page, last_page: 61 }, data: page === 1
      ? [{ id: 21330, title: 'Star Citizen Alpha 4.10.1', rsi_url: 'https://robertsspaceindustries.com/en/comm-link/Patch-Notes/21330-Star-Citizen-Alpha-4101' }]
      : [{ id: page * 100, title: 'Other Comm-Link' }] });
  }
  throw Error(`Unexpected fetch ${url}`);
};

const env = { GITHUB_TOKEN: 'test', GITHUB_REPO: 'example/radar', RUN_SECRET: 'private' };
const req = async (path, method = 'GET', secret = 'private') => (await worker.fetch(new Request(`https://example.test${path}`, { method, headers: { 'x-run-secret': secret } }), env)).json();
assert.equal((await req('/backfill/start', 'POST', 'wrong')).ok, false);
assert.equal(saved.has(controlPath), false);
assert.equal((await req('/backfill/start', 'POST')).status, 'running');
requests = [];
await worker.scheduled({ cron: '*/2 * * * *' }, env, {});
assert.ok(requests.length < 50);
assert.equal(saved.get(archivePath).data.some(p => p.version === 'Alpha 3.17.2a'), true);
assert.equal(saved.get(controlPath).data.status, 'running');
assert.equal(saved.get(controlPath).data.lastRun.historicalMissingItems, 0);

const before = saved.get(statePath).data.nextPage;
assert.equal((await req('/backfill/stop', 'POST')).status, 'paused');
requests = [];
await worker.scheduled({ cron: '*/2 * * * *' }, env, {});
assert.equal(saved.get(statePath).data.nextPage, before);
assert.equal(requests.filter(r => r.method === 'PUT').length, 0);

saved.get(statePath).data.nextPage = 61;
assert.equal((await req('/backfill/start', 'POST')).status, 'running');
requests = [];
await worker.scheduled({ cron: '*/2 * * * *' }, env, {});
assert.ok(requests.length < 50);
assert.equal((await req('/backfill/status')).status, 'completed', JSON.stringify(saved.get(controlPath).data));
assert.equal(saved.get(statePath).data.complete, true);

saved.get(statePath).data = { nextPage: 21, complete: false, historicalNextIndex: 30 };
assert.equal((await req('/backfill/start', 'POST')).status, 'running');
failPage = true;
await assert.rejects(worker.scheduled({ cron: '*/2 * * * *' }, env, {}), /503/);
assert.equal((await req('/backfill/status')).status, 'paused');
assert.match(saved.get(controlPath).data.lastError, /503/);

// A bad historical source must remain visible after pausing. An earlier gap
// before the saved cursor is retried first when its source recovers.
failPage = false;
failHotfix = true;
saved.get(archivePath).data = saved.get(archivePath).data.filter(p => p.version !== 'Alpha 3.17.2a');
saved.get(statePath).data = { nextPage: 23, complete: false, historicalNextIndex: 50 };
assert.equal((await req('/backfill/start', 'POST')).status, 'running');
await worker.scheduled({ cron: '*/2 * * * *' }, env, {});
assert.equal(saved.get(controlPath).data.status, 'paused');
assert.match(saved.get(controlPath).data.lastError, /unbrauchbar/);
assert.equal(saved.get(controlPath).data.lastRun.historicalUnusableVersions[0].version, 'Alpha 3.17.2a');
const reason = saved.get(controlPath).data.lastError;
assert.equal((await req('/backfill/stop', 'POST')).lastError, reason);
failHotfix = false;
assert.equal((await req('/backfill/start', 'POST')).status, 'running');
requests = [];
await worker.scheduled({ cron: '*/2 * * * *' }, env, {});
assert.ok(requests.length < 50);
assert.equal(saved.get(controlPath).data.lastRun.historicalUnusableItems, 0);
assert.equal(saved.get(controlPath).data.lastRun.newItems, 1);
assert.ok(saved.get(archivePath).data.some(p => p.version === 'Alpha 3.17.2a'));
console.log('Automatischer Import: Authentifizierung, Fortschritt, Pause, Abschluss, Fehlerhalt und Worker-Budget: OK');
