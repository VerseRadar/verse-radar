import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workerSource = await readFile(new URL('../worker/index.js', import.meta.url), 'utf8');
const worker = (await import(`data:text/javascript;base64,${Buffer.from(workerSource).toString('base64')}`)).default;
const archivePath = 'public/data/patches.json';
const statePath = 'public/data/patch-archive-state.json';
const existingVersions = ['4.10.1','4.10','4.9','4.8.3','4.8.2','4.8.1','4.8','4.7.2','4.7.1','4.7','4.6','4.5','4.4','4.3.2','4.3.1','4.3','4.2.1','4.2','4.1.1','4.1','4.0.2','4.0.1','4.0'];
const saved = new Map([
  [archivePath, { sha: 'archive-1', data: existingVersions.map(version => ({ version: `Alpha ${version}`, sourceUrl: 'https://example.test/official', summary: 'Bestehender Inhalt' })) }],
  [statePath, { sha: 'state-1', data: { nextPage: 13, complete: false } }]
]);
let calls = [];
let brokenVersion = null;
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(String(input));
  const method = options.method || 'GET';
  calls.push({ url: url.href, method });
  if (calls.length > 50) throw Error('Too many subrequests by single Worker invocation');
  if (url.host === 'api.github.com') {
    const path = url.pathname.split('/contents/')[1];
    if (method === 'GET') {
      const file = saved.get(path);
      return file ? Response.json({ sha: file.sha, content: Buffer.from(JSON.stringify(file.data)).toString('base64') }) : new Response('', { status: 404 });
    }
    const payload = JSON.parse(options.body);
    assert.equal(payload.sha || null, saved.get(path)?.sha || null);
    saved.set(path, { sha: `sha-${calls.length}`, data: JSON.parse(Buffer.from(payload.content, 'base64').toString()) });
    return Response.json({ ok: true });
  }
  if (url.host === 'api.star-citizen.wiki') {
    const page = Number(url.searchParams.get('page[number]'));
    return Response.json({ meta: { current_page: page, last_page: 61 }, data: page === 1 ?
      [{ id: 21330, title: 'Star Citizen Alpha 4.10.1', rsi_url: 'https://robertsspaceindustries.com/en/comm-link/Patch-Notes/21330-Star-Citizen-Alpha-4101' }]
      : [{ id: page * 100, title: 'Other Comm-Link' }] });
  }
  if (url.host === 'starcitizen.tools' && url.pathname === '/api.php' && url.searchParams.get('action') === 'query') {
    // Regression for the observed empty categorymembers response in 0.9.4.
    return Response.json({ query: { categorymembers: [] } });
  }
  if (url.host === 'starcitizen.tools' && url.pathname === '/api.php' && url.searchParams.get('action') === 'parse') {
    const title = url.searchParams.get('page');
    const version = title?.match(/Alpha (3\.\d+(?:\.\d+)?[a-z]?)/)?.[1];
    if (!version) throw Error(`Unexpected title ${title}`);
    if (version === brokenVersion) return Response.json({ error: { code: 'missingtitle' } });
    const official = version === '3.22.1'
      ? 'https://robertsspaceindustries.com/comm-link//19783-Star-Citizen-Alpha-3221'
      : `https://robertsspaceindustries.com/en/comm-link/Patch-Notes/20001-Star-Citizen-Alpha-${version.replaceAll('.', '')}`;
    const body = `<p>Star Citizen build released on 2024-10-18</p><a href="${official}">Full patch notes</a><h2>Patch notes edit</h2><h3>Features and gameplay</h3>${
      'New Hair and Beard Styles Character Creator DNA New Caves and Quantum Travel Polish. Vehicle HUD & MFD Rework Master Modes. ' .repeat(9)
    }<h2>Bug Fixes</h2>Fixed client crashes.`;
    return Response.json({ parse: { text: { '*': body } } });
  }
  throw Error(`Unexpected fetch ${url.href}`);
};

const env = { GITHUB_TOKEN: 'test', GITHUB_REPO: 'example/radar' };
const invoke = async path => (await worker.fetch(new Request(`https://example.test${path}`), env)).json();
const preview = await invoke('/preview/patches?diagnostic=1');
assert.equal(preview.ok, true);
assert.equal(preview.count, 31);
assert.equal(preview.newItems, 8);
assert.equal(preview.historicalCandidates, 80);
assert.equal(preview.historicalDeferredItems, 72);
assert.equal(preview.historicalUnusableItems, 0);
assert.equal(calls.some(c => new URL(c.url).searchParams.get('action') === 'query'), false);
assert.ok(calls.length < 50);
assert.equal(preview.historicalDiagnostics.find(p => p.version === 'Alpha 3.22.1'), undefined);
assert.equal(saved.get(archivePath).data.length, 23);

calls = [];
const first = await invoke('/run/patches');
assert.equal(first.ok, true);
assert.equal(first.patchItems, 31);
assert.equal(first.patchNewItems, 8);
assert.equal(first.patchHistoricalDeferredItems, 72);
assert.ok(calls.length < 50);
assert.equal(saved.get(statePath).data.historicalNextIndex, 8);
assert.ok(saved.get(archivePath).data.some(item => item.version === 'Alpha 3.23.1a'));
assert.ok(saved.get(archivePath).data.some(item => item.version === 'Alpha 3.23.1'));
assert.equal(saved.get(archivePath).data.find(item => item.version === 'Alpha 3.24.2').sourceType, 'Patch Notes');

calls = [];
brokenVersion = '3.22.1';
const badSource = await invoke('/preview/patches?diagnostic=1');
assert.equal(badSource.ok, true);
assert.equal(badSource.historicalUnusableItems, 1);
assert.match(badSource.historicalDiagnostics.find(item => item.version === 'Alpha 3.22.1').reason, /missingtitle/);
assert.equal(saved.get(statePath).data.historicalNextIndex, 8);

calls = [];
brokenVersion = null;
const second = await invoke('/preview/patches?diagnostic=1');
assert.equal(second.count, 39);
assert.equal(second.newItems, 8);
assert.equal(second.historicalDeferredItems, 64);
assert.equal(second.historicalDiagnostics.length, 8);
assert.equal(second.historicalDiagnostics.find(item => item.version === 'Alpha 3.22.1').sourceType, 'Community Archive');
assert.ok(calls.length < 50);

console.log('Historische 3.x-Versionen, Quelllink-Prüfung, Suffixe und Worker-Limit: OK');
