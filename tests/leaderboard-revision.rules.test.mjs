import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

// Synthetic credentials must never reach a remote backend.
const emulator = process.env.FIRESTORE_EMULATOR_HOST;
if (emulator && !/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(emulator)) {
  throw new Error('Leaderboard revision tests require a loopback Firestore emulator.');
}

test('leaderboard revision rules protect readiness without changing existing permissions', {
  skip: !emulator && 'Set FIRESTORE_EMULATOR_HOST to run isolated security-rule checks.'
}, async t => {
  const project = `demo-revision-${randomUUID().slice(0, 12)}`;
  const origin = `http://${emulator}`;
  const database = `projects/${project}/databases/(default)`;
  const documents = `${origin}/v1/${database}/documents`;
  const revisionPath = 'settings/leaderboardRevision';
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
  const token = (uid, extra = {}) => {
    const now = Math.floor(Date.now() / 1000);
    const claims = { aud: project, iss: `https://securetoken.google.com/${project}`, sub: uid,
      user_id: uid, email: `${uid}@example.test`, iat: now, exp: now + 3600, auth_time: now,
      firebase: { sign_in_provider: 'custom', identities: {} }, ...extra };
    return `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.`;
  };
  const admin = token('organiser');
  const alice = token('alice');
  const claimedAdmin = token('pretender', { admin: true, role: 'admin' });
  async function request(method, path, body, credential, expected = 200) {
    const response = await fetch(`${documents}${path}`, {
      method, headers: { 'Content-Type': 'application/json', ...(credential ? { Authorization: `Bearer ${credential}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await response.text();
    assert.equal(response.status, expected, `${method} ${path}: ${text}`);
    return text ? JSON.parse(text) : null;
  }
  // Owner is used only to install isolated authority and private-profile fixtures.
  const seed = (path, value) => request('PATCH', `/${path}`, { fields: fields(value) }, 'owner');
  const get = (path, credential, expected = 200) => request('GET', `/${path}`, undefined, credential, expected);
  const remove = (path, credential, expected = 200) => request('DELETE', `/${path}`, undefined, credential, expected);
  const save = (path, value, credential, expected = 200, serverTime = true) => request('POST', ':commit', {
    writes: [{
      update: { name: `${database}/documents/${path}`, fields: fields(value) },
      ...(serverTime ? { updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }] } : {})
    }]
  }, credential, expected);
  const query = (collectionId, credential, expected = 200) => request('POST', ':runQuery', {
    structuredQuery: { from: [{ collectionId }] }
  }, credential, expected);
  const validRevision = { version: 'revision-1', ready: false, cleanupPending: false };
  const malformed = [
    ['missing version', { ready: false, cleanupPending: false }],
    ['empty version', { ...validRevision, version: '' }],
    ['numeric version', { ...validRevision, version: 1 }],
    ['null version', { ...validRevision, version: null }],
    ['missing ready', { version: 'revision-1', cleanupPending: false }],
    ['string ready', { ...validRevision, ready: 'true' }],
    ['numeric ready', { ...validRevision, ready: 1 }],
    ['null ready', { ...validRevision, ready: null }],
    ['missing cleanup status', { version: 'revision-1', ready: false }],
    ['string cleanup status', { ...validRevision, cleanupPending: 'false' }],
    ['numeric cleanup status', { ...validRevision, cleanupPending: 0 }],
    ['null cleanup status', { ...validRevision, cleanupPending: null }],
    ['ready while cleanup pending', { ...validRevision, ready: true, cleanupPending: true }],
    ['extra field', { ...validRevision, owner: 'organiser' }],
    ['missing timestamp', validRevision, false],
    ['stale timestamp', { ...validRevision, updatedAt: new Date('2020-01-01T00:00:00Z') }, false],
    ['string timestamp', { ...validRevision, updatedAt: '2020-01-01T00:00:00Z' }, false],
    ['numeric timestamp', { ...validRevision, updatedAt: 0 }, false],
    ['null timestamp', { ...validRevision, updatedAt: null }, false]
  ];

  try {
    const loaded = await fetch(`${origin}/emulator/v1/projects/${project}:securityRules`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rules: { files: [{ name: 'firestore.rules',
        content: await readFile(new URL('../public/firestore.rules', import.meta.url), 'utf8') }] } })
    });
    assert.equal(loaded.status, 200, await loaded.text());
    await seed('admins/organiser', { role: 'admin' });
    await seed('admins/pretender', { role: 'viewer' });
    await seed('profiles/alice', { username: 'Alice Player', updatedAt: new Date() });
    await seed('profiles/bob', { username: 'Bravo Player', updatedAt: new Date() });
    await seed('settings/rounds_preliminary', { predictionsOpen: false });

    await t.test('anonymous users and non-admins cannot create or read a missing revision', async () => {
      for (const credential of [undefined, alice, claimedAdmin]) {
        await get(revisionPath, credential, 403);
        await save(revisionPath, validRevision, credential, 403);
      }
    });

    await t.test('admin malformed creates cannot bypass revision validation through settings wildcard', async child => {
      for (const [label, value, serverTime = true] of malformed) {
        await child.test(label, () => save(revisionPath, value, admin, 403, serverTime));
      }
      await get(revisionPath, admin, 404);
    });

    await t.test('admin creates dirty revisions, publishes ready revisions, and invalidates them again', async () => {
      await save(revisionPath, validRevision, admin);
      let stored = await get(revisionPath, admin);
      assert.deepEqual(Object.keys(stored.fields).sort(), ['cleanupPending', 'ready', 'updatedAt', 'version']);
      assert.equal(stored.fields.version.stringValue, 'revision-1');
      assert.equal(stored.fields.ready.booleanValue, false);
      assert.equal(stored.fields.cleanupPending.booleanValue, false);
      assert.ok(Number.isFinite(Date.parse(stored.fields.updatedAt.timestampValue)));

      await save(revisionPath, { ...validRevision, cleanupPending: true }, admin);
      stored = await get(revisionPath, admin);
      assert.equal(stored.fields.ready.booleanValue, false);
      assert.equal(stored.fields.cleanupPending.booleanValue, true);
      await save(revisionPath, validRevision, admin);
      await save(revisionPath, { ...validRevision, ready: true }, admin);
      stored = await get(revisionPath, admin);
      assert.equal(stored.fields.version.stringValue, 'revision-1');
      assert.equal(stored.fields.ready.booleanValue, true);
      assert.equal(stored.fields.cleanupPending.booleanValue, false);

      await save(revisionPath, { ...validRevision, version: 'revision-2' }, admin);
      stored = await get(revisionPath, admin);
      assert.equal(stored.fields.version.stringValue, 'revision-2');
      assert.equal(stored.fields.ready.booleanValue, false);
    });

    await t.test('admin malformed updates are denied and leave the revision unchanged', async child => {
      const before = await get(revisionPath, admin);
      for (const [label, value, serverTime = true] of malformed) {
        await child.test(label, () => save(revisionPath, value, admin, 403, serverTime));
      }
      assert.deepEqual(await get(revisionPath, admin), before);
    });

    await t.test('revision stays admin-get-only and cannot be deleted by any client', async () => {
      for (const credential of [undefined, alice, claimedAdmin]) {
        await get(revisionPath, credential, 403);
        await save(revisionPath, { ...validRevision, version: 'forged', ready: true }, credential, 403);
      }
      for (const credential of [undefined, alice, claimedAdmin, admin]) {
        await remove(revisionPath, credential, 403);
        await query('settings', credential, 403);
      }
      assert.equal((await get(revisionPath, admin)).fields.version.stringValue, 'revision-2');
    });

    await t.test('ordinary settings stay public and admin-writable', async () => {
      for (const credential of [undefined, alice, admin]) {
        assert.equal((await get('settings/rounds_preliminary', credential)).fields.predictionsOpen.booleanValue, false);
      }
      await save('settings/rounds_preliminary', { predictionsOpen: true }, alice, 403, false);
      await save('settings/rounds_preliminary', { predictionsOpen: true }, undefined, 403, false);
      await save('settings/rounds_preliminary', { predictionsOpen: true }, admin, 200, false);
      assert.equal((await get('settings/rounds_preliminary')).fields.predictionsOpen.booleanValue, true);
    });

    await t.test('admin authority cannot be gained through claims, admin documents, or profile fields', async () => {
      for (const credential of [undefined, alice, claimedAdmin, admin]) {
        await save('admins/alice', { role: 'admin' }, credential, 403, false);
      }
      await save('admins/pretender', { role: 'admin' }, claimedAdmin, 403, false);
      await save('profiles/alice', { username: 'Alice Player', role: 'admin' }, alice, 403);
      await save('profiles/alice', { username: 'Alice Player', admin: true }, alice, 403);
      await get(revisionPath, alice, 403);
      await get(revisionPath, claimedAdmin, 403);
    });

    await t.test('private profile reads and validated profile writes retain their permissions', async () => {
      assert.equal((await get('profiles/alice', alice)).fields.username.stringValue, 'Alice Player');
      await get('profiles/alice', undefined, 403);
      await get('profiles/bob', alice, 403);
      await get('profiles/alice', claimedAdmin, 403);
      await get('profiles/bob', admin);
      await query('profiles', undefined, 403);
      await query('profiles', alice, 403);
      await query('profiles', claimedAdmin, 403);
      const listed = await query('profiles', admin);
      assert.equal(listed.filter(item => item.document).length, 2);
      await save('profiles/alice', { username: 'Alice Renamed' }, alice);
      await save('profiles/bob', { username: 'Hijacked Player' }, alice, 403);
      await save('profiles/bob', { username: 'Admin Renamed' }, admin, 403);
      await save('profiles/bob', { username: 'Participant' }, admin);
      await save('profiles/new-player', { username: 'Participant' }, admin);
      await save('profiles/alice', { username: 'bad@example.test' }, alice, 403);
      await remove('profiles/alice', alice, 403);
      await remove('profiles/bob', admin, 403);
      assert.equal((await get('profiles/alice', alice)).fields.username.stringValue, 'Alice Renamed');
    });

    await t.test('trusted room writes and validated public leaderboard rows do not require revision mutations', async () => {
      const before = await get(revisionPath, admin);
      await save('rooms/A', { players: ['Alpha', 'Bravo'], resultsPublished: true }, admin, 200, false);
      await get('rooms/A', undefined);
      await save('rooms/A', { resultsPublished: false }, alice, 403, false);
      const row = { uid: 'alice', displayName: 'Alice Renamed', correct: 2, points: 2, pending: 1, rank: 1 };
      await save('leaderboard/alice', row, admin);
      await get('leaderboard/alice', undefined);
      await save('leaderboard/alice', { ...row, points: 3 }, admin, 403);
      await save('leaderboard/alice', row, alice, 403);
      await save('leaderboard/alice', row, undefined, 403);
      await remove('leaderboard/alice', alice, 403);
      await remove('leaderboard/alice', admin);
      assert.deepEqual(await get(revisionPath, admin), before);
    });
  } finally {
    const cleaned = await fetch(`${origin}/emulator/v1/${database}/documents`, { method: 'DELETE' });
    assert.equal(cleaned.status, 200, 'Clean up isolated emulator documents');
  }
});
