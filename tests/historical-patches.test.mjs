import { importWorker } from "./import-worker.mjs";
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workerSource = await readFile(new URL('../worker/index.js', import.meta.url), 'utf8');
const worker = (await importWorker(workerSource)).default;
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
  if (url.host === 'api.star-citizen.wiki' && url.pathname === '/api/comm-links/18804') {
    return Response.json({ data: { content: ('Star Citizen Patch 3.17.2a Major Bug Fixes Combat Assistance Service Beacons. Changed MAX Button on Shop Kiosks to +10. Reduced the HP of Multiple Parts on the Esperia Blade. Fixed 8 Client Crashes Fixed 9 Server Crashes. ').repeat(5) + 'Back to top Star Citizen Patch 3.17.2 Alpha Patch 3.17.2 and Siege of Orison.' } });
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
    const shortNotes = {
      '3.0.0': 'Star Citizen Alpha Patch 3.0.0 is now available! Players will have access to planetary surfaces for the first time on 3 moons (Yela, Daymar, and Cellin) along with an asteroid (Delamar). These new surfaces are dotted with surface outposts and derelict ships. We have added 4 new ships, our first dedicated ground vehicle (Ursa) Explorer, the foundation of our revamped mission system with new missions, and a completely new launcher and patcher system. New features General content Breathing, Stamina & Heart Rate Oxygen Supply is consumed. Planetary bodies now have rotational motion complete with dynamic day/night cycles.',
      '3.1.3': 'Alpha Patch 3.1.3 has been released and is now available! Patch should now show: LIVE-746975. Bug fixes Fix for AI pilots occasionally going into idle states. The larger Revel and York personal hangar for size 5+ ships will now load again. Technical Fixed 3 client crashes. Fixed 9 potential server crash causes. Fixed 2 fatal error crashes. Fixed a memory crash.',
      '3.17.5': 'Alpha Patch 3.17.5 LIVE Feature Updates. The Lunar New Year envelope (Year of the Rooster for 2953) returns for the Red Festival.',
      '3.17.4': 'Alpha Patch 3.17.4 LIVE New features. Added New Ship: Drake Corsair. Technical: Fixed 1 Server Crash. Known issues with unrelated ships remain.',
      '3.11.1a': 'Fixed an issue causing ships to fall through planet surfaces when powered off. Female Characters should now have correct sit animations for the under counter seat in the Nomad. Paints should now be able to be applied to the Sabre Comet. Illegal Cargo text will no longer show up in trading kiosks without illegal cargo. Fixed a Server Deadlock. Fixed a Backend Service Crash.'
    };
    if (Object.hasOwn(shortNotes, version)) {
      const releaseDate = { '3.0.0': '2017-12-23', '3.1.3': '2018-04-20', '3.17.5': '2023-01-18', '3.17.4': '2022-11-17', '3.11.1a': '2020-11-19' }[version];
      const header = version === '3.0.0' || version === '3.1.3' ? '' : 'Delete the USER folder if display issues occur after updating. Database Reset: No. Long Term Persistence: Enabled. Starting aUEC: 20000. ';
      return Response.json({ parse: { title, text: { '*': `<div>Star Citizen build released on ${releaseDate}. ${version === '3.11.1a' ? 'Hot Fix 3.11.1a' : ''}</div><h2>Patch notes <span>edit</span></h2><p>${header.repeat(3)}${shortNotes[version]}</p>` } } });
    }
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
assert.equal(preview.historicalCandidates, 81);
assert.equal(preview.historicalDeferredItems, 73);
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
assert.equal(first.patchHistoricalDeferredItems, 73);
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
assert.equal(second.historicalDeferredItems, 65);
assert.equal(second.historicalDiagnostics.length, 8);
assert.equal(second.historicalDiagnostics.find(item => item.version === 'Alpha 3.22.1').sourceType, 'Community Archive');
assert.ok(calls.length < 50);

// The unlisted Spectrum hotfix must be importable independently, and its
// archived text must not include the following 3.17.2 release notes.
const versions = [...workerSource.match(/const HISTORICAL_VERSIONS = \[([\s\S]*?)\];/)[1].matchAll(/"(3\.[^"]+)"/g)].map(m => m[1]);
const alreadyStored = new Set(saved.get(archivePath).data.map(item => item.version));
saved.get(archivePath).data.push(...versions.filter(v => v !== '3.17.2a' && !alreadyStored.has(`Alpha ${v}`)).map(v => ({ version: `Alpha ${v}`, sourceUrl: 'https://example.test/already-archived', summary: 'Bestehend' })));
const special = await invoke('/preview/patches');
assert.equal(special.newItems, 1);
const hotfix = special.items.find(item => item.version === 'Alpha 3.17.2a');
assert.equal(hotfix.date, '2022-08-31T00:00:00.000Z');
assert.match(hotfix.sourceUrl, /robertsspaceindustries\.com\/spectrum\/.*3-17-2a/);
assert.ok(hotfix.changes.some(change => change.title === 'Combat Assistance Beacons'));
assert.doesNotMatch(hotfix.summary, /Siege of Orison/i);

// The archived short releases use different headings and can be missed by
// generic feature rules. They must retain their own facts and source links.
saved.get(archivePath).data.push({ version: 'Alpha 3.17.2a', sourceUrl: hotfix.sourceUrl });
for (const v of ['3.17.5', '3.17.4', '3.11.1a']) {
  saved.get(archivePath).data = saved.get(archivePath).data.filter(item => item.version !== `Alpha ${v}`);
}
saved.get(statePath).data.historicalNextIndex = 70;
calls = [];
const shortPreview = await invoke('/preview/patches?diagnostic=1');
assert.equal(shortPreview.newItems, 3);
assert.equal(shortPreview.historicalUnusableItems, 0);
assert.equal(shortPreview.historicalDiagnostics.length, 3);
assert.ok(shortPreview.historicalDiagnostics.every(item => item.eligible && item.sourceType === 'Patch Notes'));
assert.ok(calls.length < 50);
const fullShort = await invoke('/preview/patches');
for (const version of ['3.17.5', '3.17.4', '3.11.1a']) {
  const item = fullShort.items.find(i => i.version === `Alpha ${version}`);
  assert.ok(item, version);
  assert.match(item.sourceUrl, /robertsspaceindustries\.com\/spectrum/);
  assert.equal(item.summaryVersion, '0.13.11');
  assert.ok(item.changes.length >= 1);
}
assert.ok(fullShort.items.find(i => i.version === 'Alpha 3.17.5').changes.some(c => c.title === 'Red Festival 2953'));
assert.ok(fullShort.items.find(i => i.version === 'Alpha 3.17.4').changes.some(c => c.title === 'Drake Corsair'));
assert.ok(fullShort.items.find(i => i.version === 'Alpha 3.11.1a').changes.some(c => c.title === 'Sabre-Comet-Lackierung'));
saved.get(archivePath).data.push(...fullShort.items.filter(item => ['Alpha 3.17.5', 'Alpha 3.17.4', 'Alpha 3.11.1a'].includes(item.version)));

// The final two missing archive entries have genuinely different formats: one
// is shorter than 500 characters; the other has a long "New features" section.
for (const version of ['3.0.0', '3.1.3']) {
  saved.get(archivePath).data = saved.get(archivePath).data.filter(item => item.version !== `Alpha ${version}`);
}
calls = [];
const finalPreview = await invoke('/preview/patches?diagnostic=1');
assert.equal(finalPreview.newItems, 2);
assert.equal(finalPreview.historicalUnusableItems, 0);
assert.ok(finalPreview.historicalDiagnostics.every(item => item.eligible && item.sourceType === 'Patch Notes'));
assert.ok(calls.length < 50);
const finalItems = (await invoke('/preview/patches')).items;
const major = finalItems.find(item => item.version === 'Alpha 3.0.0');
const minor = finalItems.find(item => item.version === 'Alpha 3.1.3');
assert.equal(major.date, '2017-12-23T00:00:00.000Z');
assert.match(major.sourceUrl, /robertsspaceindustries\.com\/en\/comm-link\/transmission\/16349/);
assert.ok(major.changes.length >= 5);
assert.ok(major.changes.some(change => change.title === 'Erkundbare Oberflächen'));
assert.ok(major.changes.some(change => change.title === 'Neues Missionssystem'));
assert.match(major.summary, /Delamar/);
assert.equal(minor.date, '2018-04-20T00:00:00.000Z');
assert.match(minor.sourceUrl, /robertsspaceindustries\.com\/spectrum\/.*3-1-3/);
assert.ok(minor.changes.some(change => change.title === 'Revel-and-York-Hangar'));
assert.ok(minor.changes.some(change => change.title === 'Abstürze'));
assert.equal(major.summaryVersion, '0.13.11');
assert.equal(minor.summaryVersion, '0.13.11');

console.log('Historische 3.x-Versionen, Quelllink-Prüfung, Suffixe und Worker-Limit: OK');
