import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../worker/index.js', import.meta.url), 'utf8');
const worker = (await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)).default;
const env = { GITHUB_TOKEN: 'test', GITHUB_REPO: 'example/radar', RUN_SECRET: 'private' };
const patchesPath = 'public/data/patches.json';
const statePath = 'public/data/patch-archive-state.json';
const origin = 'https://example.test';
const sourceText = 'Gameplay mission balance improvements, cargo, ships and bug fixes. '.repeat(15);
const entry = (id, version, channel = 'Patch-Notes') => ({ id, title: `Star Citizen Alpha ${version}`, created_at: '2026-01-01', content: sourceText, channel, rsi_url: `https://robertsspaceindustries.com/en/comm-link/${channel}/${id}-Star-Citizen-Alpha-${version}` });
const pages = {
  1: [entry(501, '4.10.1'), entry(500, '4.10')],
  2: [entry(490, '4.9'), entry(480, '4.8'), entry(472, '4.7.2', 'transmission')],
  3: [entry(470, '4.7')]
};
const stored = new Map([
  [patchesPath, { sha: 'sha-1', data: [
    { version: 'Alpha 4.10.1', previous: 'Alpha 4.10', sourceUrl: 'https://robertsspaceindustries.com/first', summary: 'Geprüft 4.10.1' },
    { version: 'Alpha 4.10', previous: null, sourceUrl: 'https://robertsspaceindustries.com/second', summary: 'Geprüft 4.10' },
    { version: 'Alpha 4.8.1', previous: null, sourceUrl: 'https://robertsspaceindustries.com/en/comm-link/Patch-Notes/21177-Star-Citizen-Alpha-4.8.1', summary: 'Bestehende Update-Meldung' }
  ] }]
]);
const calls = [];
let sourceFailure = false;
let githubFailure = false;
let stateWriteFailure = false;
let repeatFirstPage = false;
let missingSourceUrl = false;
let archiveConflictOnce = false;
let archiveConflictAlways = false;
let alpha47DetailAvailable = false;
let archiveSeedDetailsAvailable = false;
const externalPatch = { version: 'Alpha 4.6', previous: null, sourceUrl: 'https://robertsspaceindustries.com/external', summary: 'Parallel gespeicherter Patch' };

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  const method = init.method || 'GET';
  calls.push({ url: url.href, method });
  if (url.host === 'api.star-citizen.wiki' && url.pathname === '/api/comm-links') {
    const page = Number(url.searchParams.get('page[number]'));
    if (sourceFailure && page === 2) return new Response('', { status: 503 });
    const records = repeatFirstPage && page === 2 ? pages[1] : pages[page] || [];
    return Response.json({ data: missingSourceUrl && page === 2 ? [{ ...records[0], rsi_url: '' }, ...records.slice(1)] : records, meta: { current_page: page, last_page: 3 } });
  }
  if (alpha47DetailAvailable && url.host === 'api.star-citizen.wiki' && url.pathname === '/api/comm-links/21070') {
    return Response.json({ data: { content: ('Operation Breaker Stations Inventory Rework Two-Panel Layout Nearby Inventories Search, Sort, and Filter Crafting, Fabricator, and Blueprints Material Quality and Mining Updates New Ship: RSI Aurora Mk II Shield Balance Armor Balance Radar-Based Aim Assist People\'s Service Stations Virtual Reality Updates over 150 bug and crash fixes. ').repeat(4) } });
  }
  if (archiveSeedDetailsAvailable && url.host === 'api.star-citizen.wiki' && /^\/api\/comm-links\/(20969|20934|20899)$/.test(url.pathname)) {
    const content = {
      20969: 'Clearing The Air: Alliance Aid Missions Kel-To Ship Supply Kiosks Lamp: Light Amplification System Engineering and Ship Armor Gameplay Updates Aurora Series Update Virtual Reality Updates over 160 bug and crash fixes.',
      20934: 'Engineering Gameplay Ship Armor Fire Hazards Loot Refresh & Collector Updates Ore Refining Economic Balance Physicalized Helmets Virtual Reality Support (Experimental) Vulkan Graphics and Settings Overhaul over 150 bug and crash fixes.',
      20899: 'Welcome To Nyx The Return to Levski Sworn Enemies Operation Interstellar Hauling Nyx Mission Pack External Station Freight Elevators TripleDown Boomtube Streaming Improvements and Environment Performance Optimizations over 180 bug and crash fixes.'
    }[Number(url.pathname.split('/').at(-1))];
    return Response.json({ data: { content: content.repeat(4) } });
  }
  if (url.host === 'api.github.com' && url.pathname.includes('/contents/')) {
    const path = url.pathname.split('/contents/')[1];
    if (githubFailure && path === patchesPath) return new Response('', { status: 503 });
    if (method === 'GET') {
      const file = stored.get(path);
      return file ? Response.json({ sha: file.sha, content: Buffer.from(JSON.stringify(file.data)).toString('base64') }) : new Response('', { status: 404 });
    }
    if (method === 'PUT') {
      if (stateWriteFailure && path === statePath) return new Response('', { status: 500 });
      const body = JSON.parse(init.body);
      const old = stored.get(path);
      assert.equal(body.sha || null, old?.sha || null, `SHA mismatch for ${path}`);
      if (path === patchesPath && archiveConflictAlways) return new Response('', { status: 409 });
      if (path === patchesPath && archiveConflictOnce) {
        archiveConflictOnce = false;
        stored.set(path, { sha: `sha-parallel-${calls.length}`, data: [...old.data, externalPatch] });
        return new Response('', { status: 409 });
      }
      stored.set(path, { sha: `sha-${calls.length}`, data: JSON.parse(Buffer.from(body.content, 'base64').toString('utf8')) });
      return Response.json({ ok: true });
    }
  }
  throw Error(`Unmocked URL ${url.href}`);
};

const request = async path => worker.fetch(new Request(`${origin}${path}`), env);
const writes = () => calls.filter(c => c.method === 'PUT').map(c => c.url.split('/contents/')[1]);

assert.equal((await request('/run/patches')).status, 401);
assert.deepEqual(writes(), []);
const diagnostic = await (await request('/preview/patches?diagnostic=1')).json();
assert.equal(diagnostic.published, false);
assert.equal(diagnostic.items, undefined);
assert.deepEqual(diagnostic.pageDiagnostics.map(p => p.page), [1, 2]);
assert.equal(diagnostic.pageDiagnostics[1].alphaRecords.find(p => p.title === 'Star Citizen Alpha 4.7.2').accepted, false);
assert.equal(diagnostic.pageDiagnostics[1].alphaRecords.find(p => p.title === 'Star Citizen Alpha 4.9').accepted, true);
assert.deepEqual(diagnostic.seedDiagnostics.find(p => p.version === 'Alpha 4.7'),
  { version: 'Alpha 4.7', sourceId: 21070, sourceContentLength: 0, eligible: false });
assert.deepEqual(writes(), []);
const first = await (await request('/preview/patches')).json();
assert.equal(first.published, false);
assert.equal(first.count, 5);
assert.equal(first.newItems, 2);
assert.equal(first.items.some(p => p.version === 'Alpha 4.7.2'), false);
assert.equal(first.items.find(p => p.version === 'Alpha 4.8.1').sourceType, 'Release Info');
assert.match(first.items.find(p => p.version === 'Alpha 4.8.1').sourceUrl, /\/transmission\/21177-/);
assert.deepEqual(first.scannedPages, [1, 2]);
assert.equal(first.nextPage, 3);
assert.equal(first.items.find(p => p.version === 'Alpha 4.10').summary, 'Geprüft 4.10');
assert.deepEqual(writes(), []);

sourceFailure = true;
assert.equal((await request('/run/patches?key=private')).status, 500);
assert.deepEqual(writes(), []);
sourceFailure = false;
githubFailure = true;
assert.equal((await request('/run/patches?key=private')).status, 500);
assert.deepEqual(writes(), []);
githubFailure = false;
repeatFirstPage = true;
assert.equal((await request('/run/patches?key=private')).status, 500);
assert.deepEqual(writes(), []);
repeatFirstPage = false;
missingSourceUrl = true;
assert.equal((await request('/run/patches?key=private')).status, 500);
assert.deepEqual(writes(), []);
missingSourceUrl = false;

archiveConflictAlways = true;
assert.equal((await request('/run/patches?key=private')).status, 500);
assert.equal(stored.get(patchesPath).data.length, 3);
assert.equal(stored.has(statePath), false);
archiveConflictAlways = false;
calls.length = 0;

archiveConflictOnce = true;
stateWriteFailure = true;
assert.equal((await request('/run/patches?key=private')).status, 500);
assert.equal(stored.get(patchesPath).data.length, 6);
assert.equal(stored.get(patchesPath).data.find(p => p.version === 'Alpha 4.6').summary, externalPatch.summary);
assert.equal(stored.has(statePath), false);
stateWriteFailure = false;

calls.length = 0;
const retry = await (await request('/run/patches?key=private')).json();
assert.equal(retry.published, true);
assert.equal(retry.patchNewItems, 0);
assert.deepEqual(writes(), [patchesPath, statePath, 'public/data/meta.json']);
assert.equal(stored.get(statePath).data.nextPage, 3);

calls.length = 0;
const second = await (await request('/preview/patches')).json();
assert.deepEqual(second.scannedPages, [1, 3]);
assert.deepEqual(second.pageDiagnostics.map(p => p.page), [1, 3]);
assert.equal(second.count, 7);
assert.equal(second.newItems, 1);
assert.equal(second.backfillComplete, true);
assert.equal(second.items.at(-1).previous, null);
assert.equal(second.items[0].summary, 'Geprüft 4.10.1');
assert.deepEqual(writes(), []);

const final = await (await request('/run/patches?key=private')).json();
assert.equal(final.published, true);
assert.equal(stored.get(patchesPath).data.length, 7);
assert.equal(stored.get(statePath).data.complete, true);
assert.equal(stored.get(patchesPath).data[0].summary, 'Geprüft 4.10.1');

alpha47DetailAvailable = true;
stored.get(patchesPath).data = stored.get(patchesPath).data.filter(p => p.version !== 'Alpha 4.7');
const alpha47Preview = await (await request('/preview/patches')).json();
const alpha47 = alpha47Preview.items.find(p => p.version === 'Alpha 4.7');
assert.equal(alpha47Preview.newItems, 1);
assert.equal(alpha47.date, '2026-03-25T00:00:00.000Z');
assert.equal(alpha47.sourceUrl, 'https://robertsspaceindustries.com/en/comm-link/Patch-Notes/21070-Star-Citizen-Alpha-47');
assert.match(alpha47.summary, /Crafting/);
assert.match(alpha47.fullSummary, /Inventar/);
assert.ok(alpha47.changes.length >= 7);
assert.equal(stored.get(patchesPath).data.some(p => p.version === 'Alpha 4.7'), false);

archiveSeedDetailsAvailable = true;
stored.get(patchesPath).data = stored.get(patchesPath).data.filter(p => p.version !== 'Alpha 4.6');
const archivePreview = await (await request('/preview/patches?diagnostic=1')).json();
assert.equal(archivePreview.newItems, 4);
for (const version of ['Alpha 4.6','Alpha 4.5','Alpha 4.4']) {
  assert.equal(archivePreview.seedDiagnostics.find(p => p.version === version).eligible, true);
}
const archiveEntries = await (await request('/preview/patches')).json();
for (const [version, date, suffix] of [
  ['Alpha 4.6','2026-01-28T00:00:00.000Z','20969-Star-Citizen-Alpha-46'],
  ['Alpha 4.5','2025-12-17T00:00:00.000Z','20934-Star-Citizen-Alpha-450'],
  ['Alpha 4.4','2025-11-19T00:00:00.000Z','20899-Star-Citizen-Alpha-440']
]) {
  const item = archiveEntries.items.find(p => p.version === version);
  assert.equal(item.date, date);
  assert.ok(item.sourceUrl.endsWith(suffix));
  assert.ok(item.changes.length >= 4);
}

console.log('Patch-Archiv: Vorschau, Nachladen, Fehlerschutz und Cursor-Recovery: OK');
