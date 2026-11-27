import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createParticipantCleanupStore } from '../public/js/participant-cleanup.js';
import { createLeaderboardRecalculator } from '../public/js/leaderboard-recalculate.js';
import { createLeaderboardRevisionStore } from '../public/js/leaderboard-revision.js';
import { createDrawStore } from '../public/js/lucky-draw-sync.js';

const host = process.env.FIRESTORE_EMULATOR_HOST;
if (host && !/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(host)) throw new Error('Loopback emulator required.');

test('participant cleanup authorization, revision fencing and durable recovery', {
  skip: !host && 'Firestore emulator required'
}, async t => {
  const project = `demo-cleanup-${process.pid}-${Date.now()}`;
  const origin = `http://${host}`;
  const database = `projects/${project}/databases/(default)`;
  const base = `${origin}/v1/${database}/documents`;
  const stamp = Symbol('serverTimestamp');
  const encode = value => {
    if (value === null) return { nullValue: null };
    if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } };
    if (typeof value === 'string') return { stringValue: value };
    if (typeof value === 'boolean') return { booleanValue: value };
    if (typeof value === 'number') return { integerValue: String(value) };
    return { mapValue: { fields: fields(value) } };
  };
  const fields = value => Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encode(item)]));
  const decode = value => {
    if ('nullValue' in value) return null;
    if ('stringValue' in value) return value.stringValue;
    if ('timestampValue' in value) return { toMillis: () => Date.parse(value.timestampValue), toJSON: () => value.timestampValue };
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
      headers: { 'Content-Type': 'application/json', ...(credential ? { Authorization: `Bearer ${credential}` } : {}) },
      signal: AbortSignal.timeout(5000), body: body === undefined ? undefined : JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) throw Object.assign(new Error(result.error?.message || JSON.stringify(result)), { status: response.status, code: result.error?.status });
    return result;
  };
  const snapshot = (path, result) => ({ id: String(path).split('/').at(-1), ref: path,
    version: result?.updateTime || null, exists: () => Boolean(result?.fields), data: () => object(result.fields) });
  const get = async path => {
    try { return snapshot(path, await request(`/${path}`, undefined, admin, 'GET')); }
    catch (error) { if (error.status === 404) return snapshot(path, null); throw error; }
  };
  const replacement = (path, value) => {
    const transforms = Object.entries(value).filter(([, item]) => item === stamp).map(([fieldPath]) => ({ fieldPath, setToServerValue: 'REQUEST_TIME' }));
    return { update: { name: `${database}/documents/${path}`,
      fields: fields(Object.fromEntries(Object.entries(value).filter(([, item]) => item !== stamp))) },
      ...(transforms.length ? { updateTransforms: transforms } : {}) };
  };
  // Same optimistic read-version/verify adapter as the existing draw rule tests.
  let beforeCommit;
  let afterCommit;
  let failQuery;
  const commits = [];
  const firebase = {
    db: {}, doc: (...args) => {
      const path = args.length === 1 ? `${args[0]}/${crypto.randomUUID()}` : args.slice(1).join('/');
      return Object.assign(new String(path), { id: path.split('/').at(-1) });
    },
    collection: (_db, path) => path, serverTimestamp: () => stamp,
    where: (field, op, values) => ({ field, op, values }), query: (path, filter) => ({ path, filter }),
    getDoc: get,
    getDocs: async source => {
      const { path, filter } = typeof source === 'string' ? { path: source } : source;
      if (failQuery?.(path)) throw new Error('Synthetic query failure');
      const result = await request(':runQuery', { structuredQuery: { from: [{ collectionId: path }],
        ...(filter ? { where: { fieldFilter: { field: { fieldPath: filter.field }, op: 'IN', value: { arrayValue: {
          values: filter.values.map(value => filter.field === '__name__'
            ? { referenceValue: `${database}/documents/${path}/${value}` } : encode(value))
        } } } } } : {}) } });
      return { docs: result.filter(item => item.document).map(item => snapshot(item.document.name.split('/documents/')[1], item.document)) };
    },
    runTransaction: async (_db, callback) => {
      for (let attempt = 0; attempt < 5; attempt++) {
        const reads = new Map();
        const writes = [];
        try {
          const result = await callback({
            get: async path => { const saved = await get(path); reads.set(`${database}/documents/${path}`, saved.version); return saved; },
            set: (path, value) => writes.push(replacement(path, value)),
            delete: path => writes.push({ delete: `${database}/documents/${path}` })
          });
          const condition = version => version ? { updateTime: version } : { exists: false };
          for (const write of writes) {
            const name = write.update?.name || write.delete;
            if (reads.has(name)) { write.currentDocument = condition(reads.get(name)); reads.delete(name); }
          }
          for (const [name, version] of reads) writes.push({ verify: name, currentDocument: condition(version) });
          if (beforeCommit) await beforeCommit(writes);
          await request(':commit', { writes });
          commits.push(writes);
          if (afterCommit) await afterCommit(writes);
          return result;
        } catch (error) {
          if (['ABORTED', 'FAILED_PRECONDITION'].includes(error.code) && attempt < 4) continue;
          throw error;
        }
      }
    }
  };
  const revisions = createLeaderboardRevisionStore(firebase);
  const recalculate = createLeaderboardRecalculator({ ...firebase, revisions });
  const makeStore = () => createParticipantCleanupStore({ ...firebase, revisions, recalculate });
  const store = makeStore();
  const draw = createDrawStore(firebase);
  const seed = (path, data) => request(':commit', { writes: [replacement(path, data)] }, 'owner');
  const pick = uid => ({ uid, roomId: 'A', stageId: 'preliminary', displayName: 'Participant', selectedPlayers: ['Red', 'Blue'], formatVersion: 2, updatedAt: stamp });
  const job = () => store.load();
  const saved = async path => (await get(path)).data();
  const blocked = action => assert.rejects(action, error => error.status === 403);
  const write = (path, data, credential) => request(':commit', { writes: [replacement(path, data)] }, credential);
  const remove = (path, credential) => request(`/${path}`, undefined, credential, 'DELETE');
  const reset = async () => {
    beforeCommit = afterCommit = failQuery = null;
    const response = await fetch(`${origin}/emulator/v1/${database}/documents`, { method: 'DELETE' });
    assert.equal(response.status, 200);
    await seed('admins/organiser', { role: 'admin' });
    await seed('rooms/A', { players: ['Red', 'Blue', '', '', '', '', '', ''], qualifiers: ['Red', 'Blue'], resultsPublished: true, status: 'completed', formatVersion: 2 });
    await seed('rooms/B', { players: ['Red', 'Blue', '', '', '', '', '', ''], resultsPublished: false, status: 'upcoming', formatVersion: 2 });
    await seed('settings/rounds_preliminary', { predictionsOpen: true });
    for (const uid of ['alice', 'bobby', 'charlie']) {
      await seed(`profiles/${uid}`, { username: 'Same Name', updatedAt: stamp });
      await seed(`predictions/${uid}_A`, pick(uid));
    }
    await seed('predictions/legacy-alice', { ...pick('alice'), formatVersion: 1 });
    await recalculate();
    await draw.refresh();
    commits.length = 0;
  };
  try {
    const response = await fetch(`${origin}/emulator/v1/projects/${project}:securityRules`, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rules: { files: [{ name: 'firestore.rules', content: await readFile(new URL('../public/firestore.rules', import.meta.url), 'utf8') }] } }) });
    assert.equal(response.status, 200, await response.text());

    await t.test('single UID cleanup preserves profiles, awards, rooms, unrelated picks and scores', async () => {
      await reset();
      const preserved = ['profiles/alice', 'profiles/bobby', 'predictions/bobby_A', 'rooms/A', 'rooms/B', 'settings/rounds_preliminary', 'ticketAwards/currentDraw'];
      const before = await Promise.all(preserved.map(path => get(path)));
      const preview = await store.preview(['alice']);
      assert.equal(commits.length, 0, 'Preview never writes');
      assert.equal(preview.predictions.length, 2);
      const result = await store.run(preview);
      assert.equal(result.phase, 'complete');
      assert.equal(result.deletedPredictions, 2);
      assert.equal(result.deletedRows, 1);
      assert.equal((await get('leaderboard/alice')).exists(), false);
      assert.equal((await get('predictions/legacy-alice')).exists(), false);
      for (let index = 0; index < preserved.length; index++) assert.equal((await get(preserved[index])).version, before[index].version, preserved[index]);
      assert.equal((await saved('leaderboard/bobby')).correct, 2);
      await assert.rejects(draw.spin((await saved('ticketAwards/currentDraw')).version), /outdated/);
      await recalculate();
      assert.equal((await get('leaderboard/alice')).exists(), false, 'Recalculation cannot resurrect deleted sources');
    });
    await t.test('bulk selection distinguishes duplicate names and preserves unrelated participant', async () => {
      await reset();
      await store.run(await store.preview(['alice', 'bobby']));
      assert.equal((await get('leaderboard/alice')).exists(), false);
      assert.equal((await get('leaderboard/bobby')).exists(), false);
      assert.equal((await saved('leaderboard/charlie')).correct, 2);
      assert.equal((await job()).deletedPredictions, 3);
    });
    await t.test('any award or exclusion blocks the entire selection without writes', async () => {
      await reset();
      await seed('ticketAwards/historical', { uid: 'alice', type: 'winner', ticketsAtWin: 2 });
      let preview = await store.preview(['alice', 'charlie']);
      await assert.rejects(store.run(preview), /blocked/);
      assert.equal(commits.length, 0);
      await seed('ticketAwards/currentDraw', { excludedUids: ['bobby'] });
      preview = await store.preview(['bobby', 'charlie']);
      await assert.rejects(store.run(preview), /blocked/);
      assert.equal((await get('predictions/charlie_A')).exists(), true);
    });
    await t.test('changed predictions and newly added awards are revalidated before deletion', async () => {
      await reset();
      const prepared = await store.preview(['alice']);
      await seed('predictions/new-legacy', pick('alice'));
      await assert.rejects(store.run(prepared), /changed/);
      assert.equal((await job()).phase, 'review');
      assert.equal((await get('predictions/alice_A')).exists(), true);
      await assert.rejects(recalculate(), /pending/);
      await store.run(await store.preview(['alice']));
      assert.equal((await job()).deletedPredictions, 3);
      await reset();
      const beforeAward = await store.preview(['alice']);
      await seed('ticketAwards/new-award', { uid: 'alice', type: 'winner' });
      await assert.rejects(store.run(beforeAward), /blocked/);
      assert.equal((await job()).deletedPredictions, 0);
    });
    await t.test('a racing spin prevents cleanup from deleting its winner', async () => {
      await reset();
      await seed('ticketAwards/currentDraw', { version: 'only-alice', leaderboardVersion: (await saved('settings/leaderboardRevision')).version,
        entries: [{ uid: 'alice', displayName: 'Same Name' }], excludedUids: [] });
      const prepared = await store.preview(['alice']);
      beforeCommit = async writes => {
        if (!writes.some(item => item.update?.name.endsWith('/settings/participantCleanup'))) return;
        beforeCommit = null;
        await draw.spin('only-alice');
      };
      await assert.rejects(store.run(prepared), /blocked/);
      assert.equal((await get('predictions/alice_A')).exists(), true);
      assert.deepEqual((await saved('ticketAwards/currentDraw')).excludedUids, ['alice']);
    });
    await t.test('partial chunk failure survives a new store and retry deletes only remaining sources', async () => {
      await reset();
      const writes = Array.from({ length: 451 }, (_, index) => replacement(`predictions/bulk-${index}`, pick('alice')));
      await request(':commit', { writes }, 'owner');
      let chunks = 0;
      beforeCommit = async writes => {
        if (writes.some(item => item.delete?.includes('/predictions/')) && ++chunks === 2) throw new Error('Synthetic second chunk failure');
      };
      await assert.rejects(store.run(await store.preview(['alice'])), /second chunk/);
      assert.equal((await job()).deletedPredictions, 450);
      assert.equal((await saved('settings/leaderboardRevision')).cleanupPending, true);
      await assert.rejects(draw.refresh(), /synchronization/);
      beforeCommit = null;
      const recovered = makeStore();
      const result = await recovered.run(await recovered.preview((await recovered.load()).uids));
      assert.equal(result.deletedPredictions, 453);
      assert.equal(result.deletedRows, 1);
      assert.equal((await get('leaderboard/alice')).exists(), false);
      assert.ok(commits.every(writes => writes.filter(item => !item.verify).length <= 451));
    });
    await t.test('recalculation failure retains pending fence and owner-write freeze until retry completes', async () => {
      await reset();
      failQuery = path => path === 'rooms';
      await assert.rejects(store.run(await store.preview(['alice'])), /query failure/);
      assert.equal((await job()).phase, 'recalculating');
      assert.equal((await saved('settings/leaderboardRevision')).cleanupPending, true);
      await assert.rejects(recalculate(), /pending/);
      await assert.rejects(draw.spin((await saved('ticketAwards/currentDraw')).version), /synchronization/);
      const newPick = uid => ({ ...pick(uid), roomId: 'B' });
      await blocked(write('predictions/alice_B', newPick('alice'), token('alice')));
      await write('predictions/bobby_B', newPick('bobby'), token('bobby'));
      await write('profiles/alice', { username: 'Kept Name', updatedAt: stamp }, token('alice'));
      failQuery = null;
      await makeStore().run(await store.preview(['alice']));
      assert.equal((await saved('settings/leaderboardRevision')).ready, true);
      await write('predictions/alice_B', newPick('alice'), token('alice'));
      assert.equal((await saved('profiles/alice')).username, 'Kept Name');
    });
    await t.test('stale admin and superseded recovery workers cannot write or certify completion', async () => {
      await reset();
      const stale = await store.preview(['alice']);
      const fresh = await store.preview(['alice']);
      await store.run(fresh);
      await assert.rejects(store.run(stale), /changed/);
      await reset();
      beforeCommit = async writes => {
        if (!writes.some(item => item.delete?.includes('/predictions/'))) return;
        beforeCommit = null;
        await makeStore().run(await store.preview(['alice']));
      };
      await assert.rejects(store.run(await store.preview(['alice'])), /changed/);
      assert.equal((await job()).phase, 'complete');
      assert.equal((await job()).deletedPredictions, 2);
      assert.equal((await saved('settings/leaderboardRevision')).ready, true);
    });
    await t.test('lost final acknowledgement leaves durable proof of completed recalculation', async () => {
      await reset();
      afterCommit = async writes => {
        if (writes.some(item => item.update?.name.endsWith('/settings/participantCleanup') && item.update.fields.phase.stringValue === 'complete')) {
          afterCommit = null;
          throw new Error('Synthetic lost acknowledgement');
        }
      };
      await assert.rejects(store.run(await store.preview(['alice'])), /acknowledgement/);
      assert.equal((await makeStore().load()).phase, 'complete');
      assert.equal((await saved('settings/leaderboardRevision')).ready, true);
      assert.equal((await get('leaderboard/alice')).exists(), false);
    });
    await t.test('rules deny unauthorized cleanup, hide jobs and preserve profile/account boundaries', async () => {
      await reset();
      const prepared = await store.preview(['alice']);
      await seed('predictions/newer', pick('alice'));
      await assert.rejects(store.run(prepared), /changed/);
      const pending = { ...(await job()), updatedAt: stamp };
      for (const credential of ['', token('alice'), token('pretender')]) {
        await blocked(request('/settings/participantCleanup', undefined, credential, 'GET'));
        await blocked(write('settings/participantCleanup', pending, credential));
        await blocked(remove('leaderboard/bobby', credential));
        await blocked(remove('predictions/bobby_A', credential));
      }
      await blocked(remove('profiles/alice', admin));
      await blocked(remove('settings/participantCleanup', admin));
      await blocked(write('settings/participantCleanup', { ...pending, phase: 'invalid' }, admin));
      await blocked(remove('predictions/alice_A', token('alice')));
      await blocked(write('predictions/alice_B', { ...pick('alice'), roomId: 'B' }, token('alice')));
      await seed('predictions/alice_B', { ...pick('alice'), roomId: 'B' });
      await blocked(write('predictions/alice_B', { ...pick('alice'), roomId: 'B' }, token('alice')));
      await request('/predictions/alice_B', undefined, token('alice'), 'GET');
      await write('predictions/bobby_B', { ...pick('bobby'), roomId: 'B' }, token('bobby'));
      await remove('predictions/bobby_B', token('bobby'));
      await makeStore().run(await store.preview(['alice']));
      await write('predictions/alice_B', { ...pick('alice'), roomId: 'B' }, token('alice'));
    });
  } finally {
    const response = await fetch(`${origin}/emulator/v1/${database}/documents`, { method: 'DELETE' });
    assert.equal(response.status, 200);
  }
});
