import { importWorker } from "./import-worker.mjs";
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../worker/index.js', import.meta.url), 'utf8');
const worker = (await importWorker(source.replace('const HISTORICAL_PATCHES_PER_IMPORT = 8;', 'const HISTORICAL_PATCHES_PER_IMPORT = 0;'))).default;
const versions = ['4.10.1', '4.10', '4.9', '4.8.3', '4.8.1', '4.8', '4.7', '4.6', '4.5', '4.4', '4.3.2', '4.3.1', '4.3'];
const archive = 'public/data/patches.json';
const state = 'public/data/patch-archive-state.json';
const stored = new Map([
  [archive, { sha: 'initial', data: versions.map(version => ({ version: `Alpha ${version}`, sourceUrl: 'https://example.test/official', summary: 'Bestehender Text' })) }],
  [state, { sha: 'cursor', data: { nextPage: 9, complete: false } }]
]);
let requests = [];
let failCursorOnce = true;

globalThis.fetch = async (input, options = {}) => {
  const url = new URL(String(input));
  const method = options.method || 'GET';
  requests.push({ url: url.href, method });
  if (requests.length > 50) throw Error('Too many subrequests by single Worker invocation');
  if (url.host === 'api.github.com') {
    const path = url.pathname.split('/contents/')[1];
    if (method === 'GET') {
      const file = stored.get(path);
      return file ? Response.json({ sha: file.sha, content: Buffer.from(JSON.stringify(file.data)).toString('base64') }) : new Response('', { status: 404 });
    }
    if (path === state && failCursorOnce) {
      failCursorOnce = false;
      return new Response('', { status: 500 });
    }
    const payload = JSON.parse(options.body);
    assert.equal(payload.sha || null, stored.get(path)?.sha || null);
    stored.set(path, { sha: `sha-${requests.length}`, data: JSON.parse(Buffer.from(payload.content, 'base64').toString()) });
    return Response.json({ ok: true });
  }
  if (url.host === 'api.star-citizen.wiki' && url.pathname === '/api/comm-links') {
    const page = Number(url.searchParams.get('page[number]'));
    return Response.json({ data: page === 1 ? [
      { id: 21330, title: 'Star Citizen Alpha 4.10.1', rsi_url: 'https://robertsspaceindustries.com/en/comm-link/Patch-Notes/21330-Star-Citizen-Alpha-4101' }
    ] : [{ id: page * 100, title: 'Community Update' }], meta: { current_page: page, last_page: 61 } });
  }
  if (url.host === 'api.star-citizen.wiki' && url.pathname === '/api/comm-links/20702') {
    return Response.json({ data: { content: 'New Time-Limited Event: Resource Drive New Mission Type: Ship Escort Wikelo Recipe Updates Ship Flight Tuning Changes New FPS Weapon: Volt Pulse Laser Pistol nearly 160 bugfixes. '.repeat(6) } });
  }
  if (url.host === 'starcitizen.tools' && url.pathname === '/api.php') {
    const page = url.searchParams.get('page');
    const content = page?.endsWith('4.8.2')
      ? 'Patch notes edit New ships and many bugfixes Characters being unstowed Escort missions. '.repeat(12)
      : page?.endsWith('4.7.2')
      ? 'Patch notes edit Nyx Mission Pack 2 Delivery: Courier Delivery: Recover Cargo Combat: Ship Wave Attack Bounty (Kill Ship) Combat: Bombing Run Salvage: Paid Salvage. '.repeat(7)
      : page?.endsWith('4.7.1')
      ? 'Patch notes edit New Ship: MISC Hull B New Vehicle: Greycat UTV Breaker Stations Updates Fixed 9 client crashes Fixed 14 server crashes. '.repeat(7)
      : '';
    return Response.json({ parse: { text: { '*': content } } });
  }
  throw Error(`Unexpected source request ${url}`);
};

const env = { GITHUB_TOKEN: 'test', GITHUB_REPO: 'example/radar' };
const request = async path => worker.fetch(new Request(`https://example.test${path}`), env);

let preview = await (await request('/preview/patches?diagnostic=1')).json();
assert.equal(preview.count, 15);
assert.equal(preview.newItems, 2);
assert.equal(preview.deferredSeedItems, 8);
assert.equal(preview.seedDiagnostics.find(item => item.version === 'Alpha 4.10').alreadyStored, true);
assert.equal(requests.some(item => item.url.endsWith('/api/comm-links/21293')), false);
assert.ok(requests.length < 50);

requests = [];
const interrupted = await (await request('/run/patches')).json();
assert.equal(interrupted.ok, false);
assert.equal(stored.get(archive).data.length, 15);
assert.equal(stored.get(state).data.nextPage, 9);
assert.ok(requests.length < 50);

requests = [];
const resumed = await (await request('/run/patches')).json();
assert.equal(resumed.ok, true);
assert.equal(resumed.patchItems, 17);
assert.equal(resumed.patchNewItems, 2);
assert.equal(resumed.patchDeferredSeedItems, 6);
assert.equal(stored.get(state).data.nextPage, 11);
assert.ok(requests.length < 50);

requests = [];
let patchCron;
await worker.scheduled({ cron: '30 */2 * * *' }, env, { waitUntil: promise => { patchCron = promise; } });
await patchCron;
assert.ok(requests.length < 50);
assert.equal(requests.some(item => item.url.startsWith('https://robertsspaceindustries.com/en/comm-link?')), false);
requests = [];
await worker.scheduled({ cron: '30 */2 * * *' }, { ...env, PATCH_AUTO_PUBLISH: 'false' }, { waitUntil: () => { throw Error('Patch-Cron ausdrücklich pausiert'); } });
assert.equal(requests.length, 0);

console.log('Worker-Budget und Teilveröffentlichung mit anschließendem Fortsetzen: OK');
