// Optional Playwright check against disposable Auth/Firestore/Hosting emulators.
// Prepare a demo-only Hosting copy: node tests/lucky-draw.browser.mjs --prepare
// Then use the README emulators:exec command. Never point this at a preview host.
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { entryIndexAtPointer } from '../public/js/lucky-wheel-geometry.js';

const project = 'demo-pr51';
const scratch = resolve('.local/pr51');
if (process.argv.includes('--prepare')) {
  mkdirSync(scratch, { recursive: true });
  rmSync(`${scratch}/public`, { recursive: true, force: true });
  cpSync('public', `${scratch}/public`, { recursive: true });
  writeFileSync(`${scratch}/public/js/firebase-config.js`, `export const firebaseConfig = ${JSON.stringify({
    apiKey: 'fake-api-key', authDomain: `${project}.firebaseapp.com`, projectId: project,
    appId: '1:123:web:synthetic'
  })};\n`);
  writeFileSync(`${scratch}/firebase.json`, JSON.stringify({
    hosting: { public: 'public' }, firestore: { rules: resolve('public/firestore.rules') },
    emulators: { auth: { host: '127.0.0.1', port: 9099 }, firestore: { host: '127.0.0.1', port: 8080 },
      hosting: { host: '127.0.0.1', port: 5000 }, ui: { enabled: false }, singleProjectMode: true }
  }, null, 2));
  console.log('Prepared ignored demo-pr51 Hosting copy; tracked Firebase configuration untouched.');
  process.exit(0);
}
assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(localhost|127\.0\.0\.1):8080$/);
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = `http://127.0.0.1:8080/v1/projects/${project}/databases/(default)/documents`;
const authBase = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';
const encode = value => typeof value === 'string' ? { stringValue: value }
  : typeof value === 'boolean' ? { booleanValue: value }
  : typeof value === 'number' ? { integerValue: String(value) }
  : value === null ? { nullValue: null }
  : Array.isArray(value) ? { arrayValue: { values: value.map(encode) } }
  : { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encode(item)])) } };
const decode = value => 'stringValue' in value ? value.stringValue : 'integerValue' in value ? Number(value.integerValue)
  : 'booleanValue' in value ? value.booleanValue : 'nullValue' in value ? null
  : 'arrayValue' in value ? (value.arrayValue.values || []).map(decode)
  : 'mapValue' in value ? Object.fromEntries(Object.entries(value.mapValue.fields || {}).map(([k, v]) => [k, decode(v)]))
  : value.timestampValue;
async function request(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json();
  assert.ok(response.ok, `${response.status} ${JSON.stringify(data)}`);
  return data;
}
async function put(path, data) {
  return request(`${base}/${path}`, { method: 'PATCH', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: encode(data).mapValue.fields }) });
}
async function get(path) {
  const response = await request(`${base}/${path}`, { headers: { Authorization: 'Bearer owner' } });
  return decode({ mapValue: { fields: response.fields } });
}
const email = `operator-${Date.now()}@example.test`;
const password = 'Synthetic-browser-only-123';
const account = await request(`${authBase}/accounts:signUp?key=fake-api-key`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password, returnSecureToken: true }) });
await put(`admins/${account.localId}`, { role: 'admin' });
await put('settings/leaderboardRevision', { version: 'browser-v1', ready: true, cleanupPending: false, updatedAt: new Date().toISOString() });
for (const [uid, correct] of [['synthetic-zero', 0], ['synthetic-one', 1], ['synthetic-five', 5]]) {
  await put(`leaderboard/${uid}`, { uid, displayName: `Audience ${correct}`,
    correct, points: correct, pending: 0, rank: 1, updatedAt: new Date().toISOString() });
}
const names = ['Same Name', 'Same Name', '李小龙', 'Émile', 'Long synthetic participant name with a distinguishing suffix One'];
const people = names.map((displayName, index) => ({ id: `person-${index}`, displayName, tickets: index + 1 }));
await put('ticketAwards/currentDraw', { version: 'browser-start', entries: [], excludedUids: [], manualParticipants: people });
const browser = await chromium.launch({ headless: true });
const errors = [], forbidden = [], checks = [];
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.route('**/*', async route => {
  const url = new URL(route.request().url());
  // CDN modules/fonts are allowed; every application backend stays loopback.
  if (!['localhost', '127.0.0.1', '[::1]', 'www.gstatic.com', 'fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname)) {
    forbidden.push(url.origin); await route.abort();
  } else await route.continue();
});
const page = await context.newPage();
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
page.on('dialog', dialog => dialog.accept());
async function refresh() {
  await page.locator('#ldRefreshBtn').click();
  await page.locator('#ldMessage').filter({ hasText: /eligible tickets? ready for the draw/ }).waitFor();
  await page.waitForFunction(() => !document.querySelector('#ldRefreshBtn').disabled);
  const text = (await page.locator('#ldMessage').textContent()).trim();
  assert.match(text, /^\d+ eligible (ticket|tickets) ready for the draw\.$/);
  assert.doesNotMatch(text, /prediction awards|manual tickets|duplicate|Previous winners/i);
}
async function layout(label, width, height, screenshot = false) {
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(100);
  const bounds = await page.evaluate(() => {
    const selectors = ['.luckydraw-main', '#ldWheel', '.luckydraw-pointer', '#ldWinner', '#ldSpinBtn', '#ldRefreshBtn', '#ldPresentationBtn', '#ldWheelLegend', '#ldMessage'];
    const boxes = Object.fromEntries(selectors.filter(s => !document.querySelector(s).hidden).map(s => {
      const element = document.querySelector(s);
      const r = element.getBoundingClientRect();
      // A rotated circle's DOMRect includes invisible square corners.
      const width = s === '#ldWheel' ? element.offsetWidth : r.width;
      const height = s === '#ldWheel' ? element.offsetHeight : r.height;
      const x = r.x + (r.width - width) / 2;
      const y = r.y + (r.height - height) / 2;
      return [s, { x, y, right: x + width, bottom: y + height, width, height }];
    }));
    return { boxes, width: innerWidth, height: innerHeight,
      scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight,
      zoom: visualViewport.scale,
      legendWidth: document.querySelector('#ldWheelLegend').clientWidth,
      legendScroll: document.querySelector('#ldWheelLegend').scrollWidth,
      messageClient: { width: document.querySelector('#ldMessage').clientWidth, height: document.querySelector('#ldMessage').clientHeight },
      messageScroll: { width: document.querySelector('#ldMessage').scrollWidth, height: document.querySelector('#ldMessage').scrollHeight },
      font: parseFloat(getComputedStyle(document.querySelector('.ld-wheel-label') || document.querySelector('#ldWheel')).fontSize) };
  });
  assert.equal(bounds.zoom, 1);
  assert.ok(bounds.scrollWidth <= width + 1, `${label}: page horizontal overflow`);
  assert.ok(bounds.scrollHeight <= height + 1, `${label}: page vertical overflow ${bounds.scrollHeight}`);
  for (const [selector, r] of Object.entries(bounds.boxes)) {
    assert.ok(r.x >= -1 && r.y >= -1 && r.right <= width + 1 && r.bottom <= height + 1, `${label} ${selector}: ${JSON.stringify(r)}`);
  }
  assert.ok(bounds.boxes['#ldWheel'].width >= 70, `${label}: wheel collapsed`);
  assert.ok(bounds.legendScroll <= bounds.legendWidth + 1, `${label}: legend horizontal overflow`);
  assert.ok(bounds.messageScroll.width <= bounds.messageClient.width + 1,
    `${label}: status message clipped horizontally`);
  assert.ok(bounds.messageScroll.height <= bounds.messageClient.height + 1,
    `${label}: status message clipped vertically`);
  if (screenshot) await page.screenshot({ path: `${scratch}/${label}.png` });
  checks.push({ label, wheel: Math.round(bounds.boxes['#ldWheel'].width), font: bounds.font });
  return bounds;
}
async function spin() {
  const before = await get('ticketAwards/currentDraw');
  await page.locator('#ldSpinBtn').click();
  await page.waitForFunction(() => document.querySelector('#ldWinner').textContent.includes('CONGRATULATIONS'));
  await page.waitForFunction(() => !document.querySelector('#ldRefreshBtn').disabled);
  const after = await get('ticketAwards/currentDraw');
  const history = await get(`ticketAwards/${after.lastWinnerHistoryId}`);
  const rotation = await page.locator('#ldWheel').evaluate(el => Number(el.style.transform.match(/rotate\(([-\d.]+)deg\)/)[1]));
  const index = entryIndexAtPointer(rotation, before.entries.length);
  assert.equal(before.entries[index].uid, history.uid);
  assert.equal(history.uid, after.lastWinner.uid);
  assert.equal(await page.locator('#ldWinner strong').textContent(), history.displayName);
  assert.ok(after.excludedUids.includes(history.uid));
  assert.ok(after.entries.every(entry => entry.uid !== history.uid));
  if (before.entries.length > 40) {
    assert.equal(await page.locator('.ld-wheel-label').textContent(), `#${index + 1}`);
  }
  checks.push({ label: 'spin pointer/announcement/history/exclusion', pool: before.entries.length, uid: history.uid });
  return after;
}
try {
  await page.goto('http://127.0.0.1:5000/admin/index.html', { waitUntil: 'networkidle' });
  await page.locator('#adminEmail').fill(email);
  await page.locator('#adminPassword').fill(password);
  await page.locator('#loginBtn').click();
  await page.locator('#adminContent').waitFor({ state: 'visible' });
  await page.locator('[data-section="luckydraw"]').click();
  await refresh();
  const certified = await get('ticketAwards/currentDraw');
  for (const [uid, correct] of [['synthetic-zero', 0], ['synthetic-one', 1], ['synthetic-five', 5]]) {
    const shown = Number(await page.locator(`[data-editor-uid="${uid}"] [data-edit-tickets]`).inputValue());
    assert.equal(shown, correct + 1);
    assert.equal(certified.entries.filter(entry => entry.uid === uid).length, shown);
    assert.equal((await get(`leaderboard/${uid}`)).points, correct);
  }
  checks.push({ label: 'editor/authoritative base tickets agree for zero, one and five correct; points unchanged' });
  // Saving an unchanged base-inclusive quantity must not block certification.
  await page.locator('[data-editor-uid="synthetic-zero"] [data-save-participant]').click();
  await page.locator('#ldMessage').filter({ hasText: /details have been saved/ }).waitFor();
  await refresh();
  assert.equal((await get('ticketAwards/currentDraw')).entries
    .filter(entry => entry.uid === 'synthetic-zero').length, 1);
  checks.push({ label: 'unchanged participant save certifies the same base ticket' });

  // Issue #55: individual removal persists across refresh/reload and can be
  // restored from current leaderboard eligibility.
  const leaderboardBefore = await get('leaderboard/synthetic-one');
  const entriesBefore = (await get('ticketAwards/currentDraw')).entries.length;
  await page.locator('[data-editor-uid="synthetic-one"] [data-remove-participant]').click();
  await page.locator('#ldMessage').filter({ hasText: /has been removed/ }).waitFor();
  let drawState = await get('ticketAwards/currentDraw');
  assert.ok(drawState.removedUids.includes('synthetic-one'));
  assert.equal(drawState.entries.some(entry => entry.uid === 'synthetic-one'), false);
  assert.equal(Number(await page.locator('#ldTickets').textContent()), entriesBefore - 2);
  assert.equal(await page.locator('[data-editor-uid="synthetic-one"]').count(), 0);
  assert.equal(await page.locator('[data-removed-uid="synthetic-one"]').count(), 1);
  assert.deepEqual(await get('leaderboard/synthetic-one'), leaderboardBefore);
  await refresh();
  drawState = await get('ticketAwards/currentDraw');
  assert.ok(drawState.removedUids.includes('synthetic-one'));
  assert.equal(drawState.entries.some(entry => entry.uid === 'synthetic-one'), false);
  checks.push({ label: 'leaderboard participant removal persists across refresh' });

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('#adminContent').waitFor({ state: 'visible' });
  await page.locator('[data-section="luckydraw"]').click();
  await page.locator('[data-removed-uid="synthetic-one"]').waitFor();
  assert.equal(await page.locator('[data-editor-uid="synthetic-one"]').count(), 0);
  await page.locator('[data-removed-uid="synthetic-one"] [data-restore-participant]').click();
  await page.locator('#ldMessage').filter({ hasText: /has been restored/ }).waitFor();
  await page.waitForFunction(() => !document.querySelector('#ldRefreshBtn').disabled);
  drawState = await get('ticketAwards/currentDraw');
  assert.ok(!drawState.removedUids.includes('synthetic-one'));
  assert.equal(drawState.entries.filter(entry => entry.uid === 'synthetic-one').length, 2);
  assert.deepEqual(await get('leaderboard/synthetic-one'), leaderboardBefore);
  checks.push({ label: 'removed participant restores current leaderboard tickets after reload' });

  // Duplicate display names remain separate manual identities.
  await page.locator('[data-editor-uid="manual:person-0"] [data-remove-participant]').click();
  await page.locator('#ldMessage').filter({ hasText: /has been removed/ }).waitFor();
  drawState = await get('ticketAwards/currentDraw');
  assert.ok(drawState.removedUids.includes('manual:person-0'));
  assert.equal(drawState.entries.some(entry => entry.uid === 'manual:person-0'), false);
  assert.equal(drawState.entries.filter(entry => entry.uid === 'manual:person-1').length, 2);
  assert.equal(drawState.manualParticipants.filter(person => person.displayName === 'Same Name').length, 2);
  assert.equal(await page.locator('[data-removed-uid="manual:person-0"]').count(), 1);
  await refresh();
  assert.equal((await get('ticketAwards/currentDraw')).entries.some(entry => entry.uid === 'manual:person-0'), false);
  await page.locator('[data-removed-uid="manual:person-0"] [data-restore-participant]').click();
  await page.locator('#ldMessage').filter({ hasText: /has been restored/ }).waitFor();
  drawState = await get('ticketAwards/currentDraw');
  assert.equal(drawState.entries.filter(entry => entry.uid === 'manual:person-0').length, 1);
  assert.equal(drawState.entries.filter(entry => entry.uid === 'manual:person-1').length, 2);
  checks.push({ label: 'duplicate manual names are removed and restored independently' });

  // Keep one participant removed through the later bulk import.
  await page.locator('[data-editor-uid="synthetic-five"] [data-remove-participant]').click();
  await page.locator('#ldMessage').filter({ hasText: /has been removed/ }).waitFor();
  assert.ok((await get('ticketAwards/currentDraw')).removedUids.includes('synthetic-five'));
  await refresh();

  const normalGrid = await page.locator('#adminContent').evaluate(el => getComputedStyle(el).gridTemplateColumns);
  assert.match(normalGrid, /^230px /);
  const normalWidth = await page.locator('#ldWheel').evaluate(el => el.clientWidth);
  const normalFont = await page.locator('.ld-wheel-label').first().evaluate(el => parseFloat(getComputedStyle(el).fontSize));
  await page.locator('#ldPresentationBtn').click();
  for (const [w, h] of [[3840,2160],[1920,1080],[1440,900],[1366,768],[1024,600],[844,390],[390,844],[320,568]]) {
    await layout(`sparse-${w}x${h}`, w, h, w === 3840 || w === 1920 || w === 390 || w === 844);
  }
  await layout('large-labels', 1920, 1080);
  const largeWidth = await page.locator('#ldWheel').evaluate(el => el.clientWidth);
  const largeFont = await page.locator('.ld-wheel-label').first().evaluate(el => parseFloat(getComputedStyle(el).fontSize));
  assert.ok(Math.abs(largeFont / normalFont - largeWidth / normalWidth) < 0.02, 'label size must scale with wheel');
  await spin();
  assert.equal(await page.locator('.ld-confetti').count(), 1);
  await page.waitForFunction(() => !document.querySelector('.ld-confetti'), null, { timeout: 4500 });
  const background = await page.locator('#ldWheel').evaluate(el => el.style.background);
  await layout('frozen-mobile', 390, 844);
  assert.equal(await page.locator('#ldWheel').evaluate(el => el.style.background), background);
  await page.locator('#ldPresentationBtn').click();
  await page.setViewportSize({ width: 1440, height: 900 });
  assert.equal(await page.locator('#adminContent').evaluate(el => getComputedStyle(el).gridTemplateColumns), normalGrid);

  // Removing and restoring another participant must not disturb the winner
  // exclusion or its history record.
  const winnerBefore = await get('ticketAwards/currentDraw');
  const candidates = await page.locator('[data-editor-uid]').evaluateAll(
    nodes => nodes.map(node => node.dataset.editorUid)
  );
  const target = candidates.find(uid => uid !== winnerBefore.lastWinner.uid);
  assert.ok(target, 'another participant must remain available');
  await page.locator(`[data-editor-uid="${target}"] [data-remove-participant]`).click();
  await page.locator('#ldMessage').filter({ hasText: /has been removed/ }).waitFor();
  let afterRemoval = await get('ticketAwards/currentDraw');
  assert.ok(afterRemoval.excludedUids.includes(winnerBefore.lastWinner.uid));
  assert.equal((await get(`ticketAwards/${winnerBefore.lastWinnerHistoryId}`)).uid, winnerBefore.lastWinner.uid);
  assert.equal(afterRemoval.lastWinnerHistoryId, winnerBefore.lastWinnerHistoryId);
  await page.locator(`[data-removed-uid="${target}"] [data-restore-participant]`).click();
  await page.locator('#ldMessage').filter({ hasText: /has been restored/ }).waitFor();
  afterRemoval = await get('ticketAwards/currentDraw');
  assert.ok(afterRemoval.excludedUids.includes(winnerBefore.lastWinner.uid));
  assert.ok(!afterRemoval.removedUids.includes(target));
  checks.push({ label: 'winner exclusion and history survive unrelated removal/restore' });

  await spin();
  // Firestore's streaming listener is intentionally never network-idle.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('#adminContent').waitFor({ state: 'visible' });
  await page.locator('[data-section="luckydraw"]').click();
  await page.locator('#ldHistory button').first().waitFor();
  await page.waitForFunction(() => !document.querySelector('#ldRefreshBtn').disabled);
  await page.locator('#ldHistory button').first().click();
  await page.locator('#ldMessage').filter({ hasText: /was undone/ }).waitFor();
  const undone = await get('ticketAwards/currentDraw');
  assert.equal(undone.leaderboardVersion, null);
  await refresh();
  assert.ok((await get('ticketAwards/currentDraw')).entries.length > 0);
  // Exercise the real bulk-import preview/confirmation controls.
  await page.locator('#ldBulkNames').fill(Array.from({length: 45}, (_, i) => `Synthetic Dense Participant ${i} suffix`).join('\n'));
  await page.locator('#ldBulkPreviewBtn').click();
  await page.locator('#ldBulkImportBtn').click();
  await page.locator('#ldMessage').filter({ hasText: /^Imported 45 participants/ }).waitFor();
  await refresh();
  let importedState = await get('ticketAwards/currentDraw');
  assert.ok(importedState.entries.length > 40);
  assert.ok(importedState.removedUids.includes('synthetic-five'));
  assert.equal(importedState.entries.some(entry => entry.uid === 'synthetic-five'), false);
  await page.locator('[data-removed-uid="synthetic-five"] [data-restore-participant]').click();
  await page.locator('#ldMessage').filter({ hasText: /has been restored/ }).waitFor();
  importedState = await get('ticketAwards/currentDraw');
  assert.equal(importedState.entries.filter(entry => entry.uid === 'synthetic-five').length, 6);
  assert.ok(!importedState.removedUids.includes('synthetic-five'));
  checks.push({ label: 'bulk import preserves removals; restoration recalculates tickets' });
  await page.locator('#ldPresentationBtn').click();
  for (const [w,h] of [[3840,2160],[1920,1080],[1366,768],[844,390],[390,844],[320,568]]) {
    await layout(`dense-${w}x${h}`, w,h, true);
  }
  assert.equal(await page.locator('.ld-wheel-label').count(), 0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await spin();
  assert.equal(await page.locator('.ld-confetti').count(), 0);
  await layout('dense-winner', 1366,768,true);

  // A stale wheel snapshot must reject a removal instead of clearing a
  // concurrent administrator's exclusions.
  await page.locator('#ldPresentationBtn').click();
  await page.waitForTimeout(100);
  const stale = await get('ticketAwards/currentDraw');
  await put('ticketAwards/currentDraw', { ...stale, version: 'browser-stale' });
  const staleCandidates = await page.locator('[data-editor-uid]').evaluateAll(
    nodes => nodes.map(node => node.dataset.editorUid)
  );
  const staleTarget = staleCandidates[0];
  assert.ok(staleTarget, 'an eligible participant is required');
  const errorStart = errors.length;
  await page.locator(`[data-editor-uid="${staleTarget}"] [data-remove-participant]`).click();
  await page.locator('#ldMessage').filter({ hasText: /Unable to remove participant/ }).waitFor();
  await page.waitForFunction(() => !document.querySelector('#ldRefreshBtn').disabled);
  await page.waitForTimeout(100);
  const staleAfter = await get('ticketAwards/currentDraw');
  assert.equal(staleAfter.version, 'browser-stale');
  assert.ok(!(staleAfter.removedUids || []).includes(staleTarget));
  assert.equal(errors.length, errorStart + 1);
  assert.match(errors[errorStart], /Remove participant error:.*draw changed/);
  errors.splice(errorStart, 1);
  checks.push({ label: 'stale editor removal is rejected and reloads the draw' });

  // Server revision changes must reject a saved pool without an award.
  const saved = await get('ticketAwards/currentDraw');
  await put('settings/leaderboardRevision', { version: 'browser-v2', ready: false, cleanupPending: false, updatedAt: new Date().toISOString() });
  await page.locator('#ldSpinBtn').click();
  await page.locator('#ldMessage').filter({hasText: /Draw not confirmed/}).waitFor();
  assert.equal((await get('ticketAwards/currentDraw')).lastWinnerHistoryId, saved.lastWinnerHistoryId);
  assert.equal(forbidden.length, 0, 'no non-loopback backend requests');
  assert.equal(errors.length, 0, `browser errors: ${errors.join('; ')}`);
  writeFileSync(`${scratch}/results.json`, JSON.stringify({ checks, errors, forbidden, namespace: project }, null, 2));
  console.log(JSON.stringify({ passed: checks.length, errors, forbidden, namespace: project }));
} finally {
  await browser.close();
}
