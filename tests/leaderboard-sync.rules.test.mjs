import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { calculateLeaderboard } from '../public/js/tournament.js';
import { rankLeaderboardRows, planLeaderboardChanges } from '../public/js/leaderboard-sync.js';

// Unsigned synthetic credentials and fixtures must never reach a remote backend.
const emulator = process.env.FIRESTORE_EMULATOR_HOST;
if (emulator && !/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(emulator)) {
  throw new Error('Leaderboard sync tests require a loopback Firestore emulator.');
}

test('leaderboard delta sync persists private-profile names and absolute ticket totals', {
  skip: !emulator && 'Set FIRESTORE_EMULATOR_HOST to run isolated security-rule checks.'
}, async t => {
  const project = `demo-lb-sync-${process.pid}-${Date.now()}`;
  const origin = `http://${emulator}`;
  const database = `projects/${project}/databases/(default)`;
  const documents = `${origin}/v1/${database}/documents`;
  const name = path => `${database}/documents/${path}`;
  const fields = value => Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encode(item)]));
  const encode = value => {
    if (value === null) return { nullValue: null };
    if (value instanceof Date) return { timestampValue: value.toISOString() };
    if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } };
    if (typeof value === 'boolean') return { booleanValue: value };
    if (typeof value === 'number') return Number.isInteger(value)
      ? { integerValue: String(value) } : { doubleValue: value };
    if (typeof value === 'string') return { stringValue: value };
    return { mapValue: { fields: fields(value) } };
  };
  // REST carries timestamps as strings; expose the same finite toMillis contract
  // used by the browser SDK without replacing any emulator reads or writes.
  const decode = value => {
    if ('timestampValue' in value) return { toMillis: () => Date.parse(value.timestampValue) };
    if ('nullValue' in value) return null;
    if ('integerValue' in value) return Number(value.integerValue);
    if ('doubleValue' in value) return value.doubleValue;
    if ('booleanValue' in value) return value.booleanValue;
    if ('stringValue' in value) return value.stringValue;
    if ('arrayValue' in value) return (value.arrayValue.values || []).map(decode);
    return data(value.mapValue.fields || {});
  };
  const data = storedFields => Object.fromEntries(Object.entries(storedFields).map(([key, value]) => [key, decode(value)]));
  const uidOf = document => document.name.slice(document.name.lastIndexOf('/') + 1);
  const token = uid => {
    const now = Math.floor(Date.now() / 1000);
    const claims = { aud: project, iss: `https://securetoken.google.com/${project}`, sub: uid,
      user_id: uid, email: `${uid}@example.test`, iat: now, exp: now + 3600, auth_time: now,
      firebase: { sign_in_provider: 'custom', identities: {} } };
    return `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.`;
  };
  const admin = token('organiser');
  const alice = token('alice');
  async function request(method, path, body, credential, expected = 200) {
    const response = await fetch(`${documents}${path}`, {
      method, headers: { 'Content-Type': 'application/json', ...(credential ? { Authorization: `Bearer ${credential}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await response.text();
    assert.equal(response.status, expected, `${method} ${path}: ${text}`);
    return text ? JSON.parse(text) : null;
  }
  // Owner is used only to install deliberately synthetic or legacy fixtures.
  const seed = (path, value) => request('PATCH', `/${path}`, { fields: fields(value) }, 'owner');
  const get = (path, credential = admin, expected = 200) => request('GET', `/${path}`, undefined, credential, expected);
  const remove = (path, credential = admin) => request('DELETE', `/${path}`, undefined, credential);
  const replacement = (path, value) => ({
    update: { name: name(path), fields: fields(value) },
    updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }]
  });
  const save = (path, value, credential = admin, expected = 200) =>
    request('POST', ':commit', { writes: [replacement(path, value)] }, credential, expected);
  const query = async (collectionId, credential = admin, extra = {}, expected = 200) => {
    const response = await request('POST', ':runQuery', {
      structuredQuery: { from: [{ collectionId }], ...extra }
    }, credential, expected);
    return expected === 200 ? response.filter(item => item.document).map(item => item.document) : [];
  };
  const publicKeys = ['correct', 'displayName', 'pending', 'points', 'rank', 'uid', 'updatedAt'];
  const summary = rows => rows.map(({ uid, displayName, correct, points, pending, rank }) =>
    ({ uid, displayName, correct, points, pending, rank })).sort((a, b) => a.rank - b.rank);
  const row = (uid, displayName, correct, pending, rank) => ({ uid, displayName, correct, points: correct, pending, rank });
  const totals = { writes: 0, deletes: 0, commits: 0, profileQueries: 0, profileDocuments: 0 };
  let privatePredictions;
  let privateAwards;

  async function assertPrivateDocumentsUnchanged() {
    assert.deepEqual(await query('predictions'), privatePredictions, 'Recalculation must not mutate private prediction fields or updateTimes');
    assert.deepEqual(await query('ticketAwards'), privateAwards, 'Username changes and recalculation must not mutate ticket awards');
  }

  async function synchronize(label, expected, { needed, returned, chunks = [needed] }) {
    const predictions = (await query('predictions')).map(document => data(document.fields));
    const rooms = Object.fromEntries((await query('rooms')).map(document => [uidOf(document), data(document.fields)]));
    const scores = calculateLeaderboard(predictions, rooms);
    const neededUIDs = [...new Set(scores.map(score => score.uid))];
    assert.equal(neededUIDs.length, needed, 'Only distinct scored participants need profiles');
    const usernames = new Map();
    let profileQueries = 0;
    let profileDocuments = 0;
    const chunkSizes = [];
    for (let start = 0; start < neededUIDs.length; start += 30) {
      const chunk = neededUIDs.slice(start, start + 30);
      chunkSizes.push(chunk.length);
      const profiles = await query('profiles', admin, {
        where: { fieldFilter: { field: { fieldPath: '__name__' }, op: 'IN',
          value: { arrayValue: { values: chunk.map(uid => ({ referenceValue: name(`profiles/${uid}`) })) } } } }
      });
      profileQueries++;
      profileDocuments += profiles.length;
      for (const document of profiles) {
        const uid = uidOf(document);
        assert.ok(neededUIDs.includes(uid), 'Unrelated profiles must not be retrieved');
        assert.ok(!usernames.has(uid), 'Each existing needed profile is retrieved once');
        usernames.set(uid, data(document.fields).username);
      }
    }
    assert.deepEqual(chunkSizes, chunks);
    assert.equal(profileDocuments, returned);
    const ranked = rankLeaderboardRows(scores, usernames);
    const before = new Map((await query('leaderboard')).map(document => [uidOf(document), document]));
    const existing = new Map([...before].map(([uid, document]) => [uid, data(document.fields)]));
    const delta = planLeaderboardChanges(ranked, existing);
    assert.equal(delta.upserts.length, expected.writes, `${label}: planned replacements`);
    assert.equal(delta.deletes.length, expected.deletes, `${label}: planned deletions`);
    const operations = [
      ...delta.upserts.map(value => replacement(`leaderboard/${value.uid}`, value)),
      ...delta.deletes.map(uid => ({ delete: name(`leaderboard/${uid}`) }))
    ];
    let successfulWrites = 0;
    let successfulDeletes = 0;
    let commits = 0;
    for (let start = 0; start < operations.length; start += 450) {
      const chunk = operations.slice(start, start + 450);
      const result = await request('POST', ':commit', { writes: chunk }, admin);
      assert.equal(result.writeResults.length, chunk.length, 'Every counted operation was accepted by the emulator');
      successfulWrites += chunk.filter(operation => operation.update).length;
      successfulDeletes += chunk.filter(operation => operation.delete).length;
      commits++;
    }
    assert.equal(successfulWrites, expected.writes);
    assert.equal(successfulDeletes, expected.deletes);
    assert.equal(commits, expected.writes + expected.deletes === 0 ? 0 : 1);
    const after = new Map((await query('leaderboard', null)).map(document => [uidOf(document), document]));
    assert.equal(after.size, ranked.length);
    for (const value of ranked) {
      const stored = after.get(value.uid);
      assert.ok(stored, `Public consumer can retrieve ${value.uid}`);
      assert.deepEqual(Object.keys(stored.fields).sort(), publicKeys);
      const { updatedAt, ...persisted } = data(stored.fields);
      assert.deepEqual(persisted, value, 'Stored public fields, not just write counts, match calculated absolute values');
      assert.ok(Number.isFinite(updatedAt.toMillis()), 'Every stored updatedAt is a real REST timestamp');
      if (delta.upserts.some(upsert => upsert.uid === value.uid)) {
        if (before.has(value.uid)) assert.notEqual(stored.updateTime, before.get(value.uid).updateTime, 'Changed rows have a new document updateTime');
      } else {
        assert.deepEqual(stored, before.get(value.uid), 'Unchanged rows preserve exact fields, server timestamp and document updateTime');
      }
    }
    for (const uid of delta.deletes) {
      assert.ok(!after.has(uid));
      await get(`leaderboard/${uid}`, null, 404);
    }
    totals.writes += successfulWrites;
    totals.deletes += successfulDeletes;
    totals.commits += commits;
    totals.profileQueries += profileQueries;
    totals.profileDocuments += profileDocuments;
    t.diagnostic(`${label}: successful emulator REST leaderboard replacements=${successfulWrites}, deletes=${successfulDeletes}, commits=${commits}; profile queries=${profileQueries}, returned documents=${profileDocuments}, needed UIDs=${needed}, IN chunk sizes=${chunkSizes.join(',')}. Fixture setup and denied requests excluded; not production billing.`);
    return summary([...after.values()].map(document => data(document.fields)));
  }

  const group = (id, qualifiers, published = true) => ({
    players: Array.from({ length: 8 }, (_, index) => `${id}${index + 1}`),
    qualifiers, resultsPublished: published, status: published ? 'completed' : 'upcoming'
  });
  const prediction = (uid, roomId, selectedPlayers, extra = {}) => ({
    uid, roomId, stageId: 'preliminary', formatVersion: 2, selectedPlayers,
    displayName: `${uid}@example.test`, email: `private-${uid}@example.test`,
    updatedAt: new Date('2025-01-01T00:00:00Z'), ...extra
  });

  try {
    const loaded = await fetch(`${origin}/emulator/v1/projects/${project}:securityRules`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rules: { files: [{ name: 'firestore.rules',
        content: await readFile(new URL('../public/firestore.rules', import.meta.url), 'utf8') }] } })
    });
    assert.equal(loaded.status, 200, await loaded.text());
    await seed('admins/organiser', { role: 'admin' });
    await seed('settings/rounds_preliminary', { predictionsOpen: false });
    await seed('rooms/A', group('A', ['A1', 'A2']));
    await seed('rooms/B', group('B', ['B1', 'B3']));
    await seed('rooms/C', group('C', [], false));
    await seed('profiles/alice', { username: 'Alpha', updatedAt: new Date() });
    await seed('profiles/bob', { username: 'Bravo', updatedAt: new Date() });
    await seed('profiles/email-profile', { username: 'stale@example.test', updatedAt: new Date() });
    await seed('profiles/unrelated', { username: 'Not A Participant', updatedAt: new Date() });
    await seed('predictions/alice_A', prediction('alice', 'A', ['A1', 'A2']));
    await seed('predictions/alice_B', prediction('alice', 'B', ['B1', 'B3']));
    await seed('predictions/alice_legacy', prediction('alice', 'A', ['A3', 'A4'], {
      formatVersion: 1, updatedAt: new Date('2025-02-01T00:00:00Z')
    }));
    await seed('predictions/bob_A', prediction('bob', 'A', ['A1', 'A3']));
    await seed('predictions/bob_B', prediction('bob', 'B', ['B2', 'B4']));
    await seed('predictions/missing-profile_A', prediction('missing-profile', 'A', ['A3', 'A4']));
    await seed('predictions/missing-profile_C', prediction('missing-profile', 'C', ['C1', 'C2']));
    await seed('predictions/email-profile_A', prediction('email-profile', 'A', ['A3', 'A4']));
    await seed('ticketAwards/alice-prize', { uid: 'alice', prize: 'Synthetic prize', ticketNumber: 4, email: 'private-alice@example.test' });
    privatePredictions = await query('predictions');
    privateAwards = await query('ticketAwards');

    await t.test('initial add uses admin profile get/list, safe fallbacks, deduplication and one point per ticket', async () => {
      assert.equal((await get('profiles/alice')).fields.username.stringValue, 'Alpha');
      const rows = await synchronize('initial add', { writes: 4, deletes: 0 }, { needed: 4, returned: 3 });
      assert.deepEqual(rows, [
        row('alice', 'Alpha', 4, 0, 1), row('bob', 'Bravo', 1, 0, 2),
        row('email-profile', 'Participant', 0, 0, 3), row('missing-profile', 'Participant', 0, 2, 4)
      ]);
      assert.equal(rows.reduce((tickets, value) => tickets + value.points, 0), 5);
      assert.ok(rows.every(value => !JSON.stringify(value).includes('@')), 'Neither legacy prediction email nor invalid profile email becomes a public name');
      await assertPrivateDocumentsUnchanged();
    });

    await t.test('unchanged recalculation performs no commit and preserves exact timestamps', async () => {
      await synchronize('unchanged', { writes: 0, deletes: 0 }, { needed: 4, returned: 3 });
      await assertPrivateDocumentsUnchanged();
    });

    await t.test('username-only change replaces one public row without changing ranks or private data', async () => {
      const before = await get('leaderboard/alice', null);
      await save('profiles/alice', { username: 'Alpha Renamed' }, alice);
      const rows = await synchronize('username only', { writes: 1, deletes: 0 }, { needed: 4, returned: 3 });
      assert.deepEqual(rows[0], row('alice', 'Alpha Renamed', 4, 0, 1));
      const after = await get('leaderboard/alice', null);
      assert.notEqual(after.fields.updatedAt.timestampValue, before.fields.updatedAt.timestampValue);
      await assertPrivateDocumentsUnchanged();
    });

    await t.test('correcting a published result replaces only affected scores and shifted ranks, repeatably', async () => {
      await request('PATCH', '/rooms/B', { fields: fields(group('B', ['B2', 'B4'])) }, admin);
      const rows = await synchronize('result correction', { writes: 2, deletes: 0 }, { needed: 4, returned: 3 });
      assert.deepEqual(rows.slice(0, 2), [row('bob', 'Bravo', 3, 0, 1), row('alice', 'Alpha Renamed', 2, 0, 2)]);
      assert.equal(rows.find(value => value.uid === 'alice').points, 2, 'Correction reduces absolute tickets rather than accumulating awards');
      await synchronize('repeat correction', { writes: 0, deletes: 0 }, { needed: 4, returned: 3 });
      await assertPrivateDocumentsUnchanged();
    });

    await t.test('unpublishing reduces totals, restores pending picks and stays unchanged when repeated or reopened', async () => {
      await request('PATCH', '/rooms/B', { fields: fields(group('B', ['B2', 'B4'], false)) }, admin);
      const rows = await synchronize('unpublish', { writes: 2, deletes: 0 }, { needed: 4, returned: 3 });
      assert.deepEqual(rows.slice(0, 2), [row('alice', 'Alpha Renamed', 2, 2, 1), row('bob', 'Bravo', 1, 2, 2)]);
      assert.equal(rows.reduce((tickets, value) => tickets + value.points, 0), 3);
      await synchronize('repeat unpublish', { writes: 0, deletes: 0 }, { needed: 4, returned: 3 });
      await request('PATCH', '/settings/rounds_preliminary', { fields: fields({ predictionsOpen: true }) }, admin);
      await synchronize('reopen stage', { writes: 0, deletes: 0 }, { needed: 4, returned: 3 });
      await assertPrivateDocumentsUnchanged();
    });

    await t.test('new and removed participants produce a real add, necessary rank update and real delete', async () => {
      await seed('profiles/newcomer', { username: 'Zulu', updatedAt: new Date() });
      await seed('predictions/newcomer_A', prediction('newcomer', 'A', ['A3', 'A4']));
      const added = await synchronize('new participant', { writes: 1, deletes: 0 }, { needed: 5, returned: 4 });
      assert.deepEqual(added[4], row('newcomer', 'Zulu', 0, 0, 5));
      await remove('predictions/email-profile_A');
      const removed = await synchronize('removed participant', { writes: 2, deletes: 1 }, { needed: 4, returned: 3 });
      assert.deepEqual(removed, [
        row('alice', 'Alpha Renamed', 2, 2, 1), row('bob', 'Bravo', 1, 2, 2),
        row('missing-profile', 'Participant', 0, 2, 3), row('newcomer', 'Zulu', 0, 0, 4)
      ]);
      privatePredictions = privatePredictions.filter(document => uidOf(document) !== 'email-profile_A');
      const newcomer = await get('predictions/newcomer_A');
      privatePredictions.push(newcomer);
      privatePredictions.sort((a, b) => a.name.localeCompare(b.name));
      await assertPrivateDocumentsUnchanged();
    });

    await t.test('replacement repairs sensitive extras, missing timestamps and malformed timestamps instead of merging', async () => {
      const stored = new Map((await query('leaderboard')).map(document => [uidOf(document), document]));
      const aliceFields = { ...stored.get('alice').fields, email: encode('leaked@example.test'), privateNote: encode('remove me') };
      await request('PATCH', '/leaderboard/alice', { fields: aliceFields }, 'owner');
      const bobFields = { ...stored.get('bob').fields };
      delete bobFields.updatedAt;
      await request('PATCH', '/leaderboard/bob', { fields: bobFields }, 'owner');
      await request('PATCH', '/leaderboard/missing-profile', {
        fields: { ...stored.get('missing-profile').fields, updatedAt: encode('not a timestamp') }
      }, 'owner');
      await synchronize('repair legacy rows', { writes: 3, deletes: 0 }, { needed: 4, returned: 3 });
      const publicAlice = await get('leaderboard/alice', null);
      assert.ok(!('email' in publicAlice.fields) && !('privateNote' in publicAlice.fields));
      await synchronize('repeat repair', { writes: 0, deletes: 0 }, { needed: 4, returned: 3 });
      await assertPrivateDocumentsUnchanged();
    });

    await t.test('nonadmin cannot change an existing public score or delete it', async () => {
      const before = await get('leaderboard/alice', null);
      await save('leaderboard/alice', row('alice', 'Alpha Renamed', 999, 0, 1), alice, 403);
      await request('DELETE', '/leaderboard/alice', undefined, alice, 403);
      assert.deepEqual(await get('leaderboard/alice', null), before);
    });

    await t.test('more than thirty distinct UIDs use bounded document-ID IN queries without retrieving unrelated profiles', async () => {
      for (let index = 0; index < 31; index++) {
        const uid = `chunk-${String(index).padStart(2, '0')}`;
        await seed(`profiles/${uid}`, { username: `Zzz Player ${String(index).padStart(2, '0')}`, updatedAt: new Date() });
        await seed(`predictions/${uid}_A`, prediction(uid, 'A', ['A3', 'A4']));
      }
      // Multiple predictions for the same UID must not cause repeated profile reads.
      await seed('predictions/chunk-00_B', prediction('chunk-00', 'B', ['B1', 'B3']));
      const rows = await synchronize('profile IN boundary', { writes: 31, deletes: 0 }, {
        needed: 35, returned: 34, chunks: [30, 5]
      });
      assert.equal(rows.length, 35);
      assert.deepEqual(rows.slice(0, 4), [
        row('alice', 'Alpha Renamed', 2, 2, 1), row('bob', 'Bravo', 1, 2, 2),
        row('missing-profile', 'Participant', 0, 2, 3), row('newcomer', 'Zulu', 0, 0, 4)
      ]);
      assert.deepEqual(rows[4], row('chunk-00', 'Zzz Player 00', 0, 2, 5));
      assert.deepEqual(rows[34], row('chunk-30', 'Zzz Player 30', 0, 0, 35));
      await synchronize('repeat IN boundary', { writes: 0, deletes: 0 }, { needed: 35, returned: 34, chunks: [30, 5] });
      assert.deepEqual(await query('ticketAwards'), privateAwards);
    });
    t.diagnostic(`TOTAL successful emulator REST sync operations: replacements=${totals.writes}, deletes=${totals.deletes}, commits=${totals.commits}; profile queries=${totals.profileQueries}, returned documents=${totals.profileDocuments}. These are measured test operations, not production billing estimates.`);
  } finally {
    const cleaned = await fetch(`${origin}/emulator/v1/${database}/documents`, { method: 'DELETE' });
    assert.equal(cleaned.status, 200, 'Clean up isolated emulator documents');
  }
});
