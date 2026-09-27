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

stateWriteFailure = true;
assert.equal((await request('/run/patches?key=private')).status, 500);
assert.equal(stored.get(patchesPath).data.length, 5);
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
assert.equal(second.count, 6);
assert.equal(second.newItems, 1);
assert.equal(second.backfillComplete, true);
assert.equal(second.items.at(-1).previous, null);
assert.equal(second.items[0].summary, 'Geprüft 4.10.1');
assert.deepEqual(writes(), []);

const final = await (await request('/run/patches?key=private')).json();
assert.equal(final.published, true);
assert.equal(stored.get(patchesPath).data.length, 6);
assert.equal(stored.get(statePath).data.complete, true);
assert.equal(stored.get(patchesPath).data[0].summary, 'Geprüft 4.10.1');

console.log('Patch-Archiv: Vorschau, Nachladen, Fehlerschutz und Cursor-Recovery: OK');
