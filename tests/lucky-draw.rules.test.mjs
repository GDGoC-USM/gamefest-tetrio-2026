import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createDrawStore } from '../public/js/lucky-draw-sync.js';
import { createLeaderboardRevisionStore } from '../public/js/leaderboard-revision.js';
import { calculateLeaderboard } from '../public/js/tournament.js';
import { rankLeaderboardRows } from '../public/js/leaderboard-sync.js';

const host = process.env.FIRESTORE_EMULATOR_HOST;
if (host && !/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(host)) throw new Error('Loopback emulator required.');

test('authoritative draw transactions and revision fencing', { skip: !host && 'Firestore emulator required' }, async t => {
  const project = `demo-draw-${process.pid}-${Date.now()}`;
  const origin = `http://${host}`;
  const database = `projects/${project}/databases/(default)`;
  const base = `${origin}/v1/${database}/documents`;
  const fields = object => Object.fromEntries(Object.entries(object).map(([key, value]) => [key, encode(value)]));
  const stamp = Symbol('serverTimestamp');
  const encode = value => {
    if (value === null) return { nullValue: null };
    if (value === stamp) return { timestampValue: new Date().toISOString() };
    if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } };
    if (typeof value === 'string') return { stringValue: value };
    if (typeof value === 'boolean') return { booleanValue: value };
    if (typeof value === 'number') return { integerValue: String(value) };
    return { mapValue: { fields: fields(value) } };
  };
  const decode = value => {
    if ('nullValue' in value) return null;
    if ('stringValue' in value) return value.stringValue;
    if ('timestampValue' in value) return value.timestampValue;
    if ('integerValue' in value) return Number(value.integerValue);
    if ('booleanValue' in value) return value.booleanValue;
    if ('arrayValue' in value) return (value.arrayValue.values || []).map(decode);
    return object(value.mapValue.fields || {});
  };
  const object = value => Object.fromEntries(Object.entries(value).map(([key, item]) => [key, decode(item)]));
  const token = uid => {
    const now = Math.floor(Date.now() / 1000);
    return `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({
      aud: project, iss: `https://securetoken.google.com/${project}`, sub: uid, user_id: uid,
      iat: now, exp: now + 3600, firebase: { sign_in_provider: 'custom', identities: {} }
    })).toString('base64url')}.`;
  };
  const admin = token('organiser');
  const request = async (path, body, credential = admin, method = 'POST') => {
    const response = await fetch(`${base}${path}`, { method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${credential}` },
      signal: AbortSignal.timeout(5000),
      body: body === undefined ? undefined : JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) throw Object.assign(new Error(result.error?.message || JSON.stringify(result)), { status: response.status, code: result.error?.status });
    return result;
  };
  const snapshot = (path, result) => ({ id: path.split('/').at(-1), version: result?.updateTime || null,
    exists: () => Boolean(result?.fields), data: () => object(result.fields) });
  const get = async path => {
    try {
      return snapshot(String(path), await request(`/${path}`, undefined, admin, 'GET'));
    } catch (error) {
      if (error.status === 404) return snapshot(String(path), null);
      throw error;
    }
  };
  const replacement = (path, value) => {
    const updatedAt = value.updatedAt === stamp;
    const drawnAt = value.drawnAt === stamp;
    const data = { ...value };
    if (updatedAt) delete data.updatedAt;
    if (drawnAt) delete data.drawnAt;
    return { update: { name: `${database}/documents/${path}`, fields: fields(data) },
      ...((updatedAt || drawnAt) ? { updateTransforms: [
        ...(updatedAt ? [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }] : []),
        ...(drawnAt ? [{ fieldPath: 'drawnAt', setToServerValue: 'REQUEST_TIME' }] : [])
      ] } : {}) };
  };
  const metrics = { reads: 0, queries: 0, writes: 0 };
  let failCommit = false;
  let beforeCommit;
  const firebase = {
    db: {}, doc: (...args) => {
      const path = args.length === 1 ? `${args[0]}/${crypto.randomUUID()}` : args.slice(1).join('/');
      return Object.assign(new String(path), { id: path.split('/').at(-1) });
    },
    collection: (_db, path) => path, serverTimestamp: () => stamp,
    getDoc: async path => { metrics.reads++; return get(path); },
    getDocs: async path => {
      metrics.queries++;
      const result = await request(':runQuery', { structuredQuery: { from: [{ collectionId: path }] } });
      return { docs: result.filter(item => item.document).map(item => snapshot(item.document.name.split('/documents/')[1], item.document)) };
    },
    // Match the browser SDK's optimistic read-version preconditions, including
    // verify writes for read-only documents (notably the leaderboard revision).
    runTransaction: async (_db, callback) => {
      for (let attempt = 0; attempt < 5; attempt++) {
        const reads = new Map();
        const writes = [];
        try {
          const result = await callback({
            get: async path => {
              metrics.reads++;
              const saved = await get(path);
              reads.set(`${database}/documents/${path}`, saved.version);
              return saved;
            },
            set: (path, value) => writes.push(replacement(path, value)),
            delete: path => writes.push({ delete: `${database}/documents/${path}` })
          });
          const count = writes.length;
          const condition = version => version ? { updateTime: version } : { exists: false };
          for (const write of writes) {
            const name = write.update?.name || write.delete;
            if (reads.has(name)) {
              write.currentDocument = condition(reads.get(name));
              reads.delete(name);
            }
          }
          for (const [name, version] of reads) writes.push({ verify: name, currentDocument: condition(version) });
          if (beforeCommit) { const hook = beforeCommit; beforeCommit = null; await hook(); }
          if (failCommit) throw new Error('Synthetic synchronization failure');
          await request(':commit', { writes });
          metrics.writes += count;
          return result;
        } catch (error) {
          if (['ABORTED', 'FAILED_PRECONDITION'].includes(error.code) && attempt < 4) continue;
          throw error;
        }
      }
    }
  };
  const store = createDrawStore(firebase);
  const revisions = createLeaderboardRevisionStore(firebase);
  const seed = (path, value) => request(`/${path}`, { fields: fields(value) }, 'owner', 'PATCH');
  const persistRows = async rows => {
    const version = await revisions.begin();
    await firebase.runTransaction(firebase.db, async tx => {
      await revisions.assert(tx, version);
      for (const row of rows) tx.set(`leaderboard/${row.uid}`, { ...row, updatedAt: stamp });
    });
    await revisions.finish(version);
    return version;
  };
  const row = (uid, correct, rank = 1) => ({ uid, displayName: uid === 'alice' ? 'Alice' : 'Bobby', correct, points: correct, pending: 0, rank });
  try {
    const response = await fetch(`${origin}/emulator/v1/projects/${project}:securityRules`, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rules: { files: [{ name: 'firestore.rules', content: await readFile(new URL('../public/firestore.rules', import.meta.url), 'utf8') }] } }) });
    assert.equal(response.status, 200, await response.text());
    await seed('admins/organiser', { role: 'admin' });

    await t.test('missing, dirty or failed synchronization blocks selection with no award writes', async () => {
      await assert.rejects(store.refresh(), /synchronization/);
      const version = await revisions.begin();
      await assert.rejects(store.refresh(), /synchronization/);
      failCommit = true;
      await assert.rejects(revisions.finish(version), /Synthetic/);
      failCommit = false;
      await assert.rejects(store.spin(null), /synchronization/);
      assert.equal((await get('ticketAwards/currentDraw')).exists(), false);
    });
    await t.test('refresh certifies exact positive counts and repeated refresh adds no writes', async () => {
      await persistRows([row('alice', 2), row('bob', 0, 2)]);
      const { draw } = await store.refresh();
      assert.deepEqual(draw.entries.map(entry => entry.uid), ['alice', 'alice']);
      const before = metrics.writes;
      await store.refresh();
      assert.equal(metrics.writes, before);
    });
    await t.test('concurrent spins select once, read two documents and atomically persist history/exclusion', async () => {
      const { draw } = await store.refresh();
      const results = await Promise.allSettled([store.spin(draw.version), store.spin(draw.version)]);
      assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
      const winner = results.find(result => result.status === 'fulfilled').value;
      assert.equal(winner.winner.uid, 'alice');
      assert.equal(winner.winner.ticketsAtWin, 2);
      assert.deepEqual((await get('ticketAwards/currentDraw')).data().excludedUids, ['alice']);
      assert.equal((await get(`ticketAwards/${winner.historyId}`)).data().uid, 'alice');
      assert.equal((await store.refresh()).draw.entries.length, 0);
    });
    await t.test('concurrent undo restores historical tickets once; refresh replaces them with current counts', async () => {
      const current = (await get('ticketAwards/currentDraw')).data();
      const results = await Promise.allSettled([store.undo(current.lastWinnerHistoryId), store.undo(current.lastWinnerHistoryId)]);
      assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
      const undone = (await get('ticketAwards/currentDraw')).data();
      assert.equal(undone.entries.length, 2);
      assert.deepEqual(undone.excludedUids, []);
      await assert.rejects(store.spin(undone.version), /outdated/);
      await persistRows([row('alice', 1), row('bob', 0, 2)]);
      assert.equal((await store.refresh()).draw.entries.length, 1);
    });
    await t.test('corrected and unpublished results invalidate the pool before recalculation', async () => {
      const predictions = [{ uid: 'alice', roomId: 'A', selectedPlayers: ['A1', 'A2'], formatVersion: 2 }];
      const group = { players: ['A1', 'A2', 'A3', '', '', '', '', ''], qualifiers: ['A1', 'A3'], resultsPublished: true };
      const score = rooms => rankLeaderboardRows(calculateLeaderboard(predictions, rooms), new Map([['alice', 'Alice']]));
      for (const room of [group, { ...group, resultsPublished: false }]) {
        const { draw } = await store.refresh();
        const version = await firebase.runTransaction(firebase.db, async tx => {
          await revisions.assertIdle(tx);
          tx.set('rooms/A', room);
          return revisions.invalidate(tx);
        });
        await assert.rejects(store.spin(draw.version), /synchronization/);
        await firebase.runTransaction(firebase.db, async tx => {
          await revisions.assert(tx, version);
          for (const value of score({ A: room })) tx.set(`leaderboard/${value.uid}`, { ...value, updatedAt: stamp });
        });
        await revisions.finish(version);
        await assert.rejects(store.spin(draw.version), /outdated/);
        const refreshed = (await store.refresh()).draw;
        assert.equal(refreshed.entries.length, room.resultsPublished ? 1 : 0);
      }
    });
    await t.test('cleanup revision bump defeats an in-flight spin and partial/overlapping recalculation', async () => {
      await persistRows([row('alice', 2), row('bob', 0, 2)]);
      const { draw } = await store.refresh();
      beforeCommit = () => firebase.runTransaction(firebase.db, async tx => { revisions.invalidate(tx); });
      await assert.rejects(store.spin(draw.version), /synchronization/);
      const first = await revisions.begin();
      const second = await revisions.begin();
      await assert.rejects(revisions.finish(first), /changed|superseded|synchroniz|another/i);
      await revisions.finish(second);
      const pending = await firebase.runTransaction(firebase.db, async tx => revisions.invalidate(tx, { cleanupPending: true }));
      await assert.rejects(revisions.begin(), /cleanup|cleaning|pending/i);
      await assert.rejects(store.refresh(), /synchronization/);
      await revisions.settleCleanup(pending);
      await persistRows([row('alice', 2), row('bob', 0, 2)]);
    });
    await t.test('stale editors and non-authoritative overrides cannot restore exclusions or award tickets', async () => {
      const { draw } = await store.refresh();
      await store.save(draw.version, { ticketOverrides: { alice: 100 } });
      await assert.rejects(store.save(draw.version, { removedUids: [] }), /changed/);
      await assert.rejects(store.refresh(), /Custom ticket/);
      let current = (await get('ticketAwards/currentDraw')).data();
      await store.save(current.version, { ticketOverrides: {}, manualParticipants: [{ id: 'x', tickets: 1 }] });
      await assert.rejects(store.refresh(), /Manual tickets/);
      current = (await get('ticketAwards/currentDraw')).data();
      await store.save(current.version, { manualParticipants: [] });
      const refreshed = (await store.refresh()).draw;
      const before = { ...metrics };
      const selected = await store.spin(refreshed.version);
      assert.equal(metrics.reads - before.reads, 2);
      assert.equal(metrics.queries - before.queries, 0);
      assert.equal(metrics.writes - before.writes, 2);
      await assert.rejects(store.save(refreshed.version, { removedUids: [] }), /changed/);
      assert.ok((await store.refresh()).draw.excludedUids.includes(selected.winner.uid));
    });
    await t.test('failed spin/undo commits leave both history and exclusions unchanged', async () => {
      const saved = (await get('ticketAwards/currentDraw')).data();
      failCommit = true;
      await assert.rejects(store.undo(saved.lastWinnerHistoryId), /Synthetic/);
      failCommit = false;
      assert.deepEqual((await get('ticketAwards/currentDraw')).data(), saved);
      assert.equal((await get(`ticketAwards/${saved.lastWinnerHistoryId}`)).exists(), true);
      await store.undo(saved.lastWinnerHistoryId);
      const { draw } = await store.refresh();
      failCommit = true;
      await assert.rejects(store.spin(draw.version), /Synthetic/);
      failCommit = false;
      assert.deepEqual((await get('ticketAwards/currentDraw')).data(), (await store.refresh()).draw);
      assert.deepEqual((await get('ticketAwards/currentDraw')).data().excludedUids, []);
    });
  } finally {
    const response = await fetch(`${origin}/emulator/v1/${database}/documents`, { method: 'DELETE' });
    assert.equal(response.status, 200);
  }
});
