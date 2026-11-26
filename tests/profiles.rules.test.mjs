import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { VALID_USERNAMES, INVALID_USERNAMES } from './username-cases.mjs';

// Fixtures and unsigned tokens must never reach a remote backend.
const emulator = process.env.FIRESTORE_EMULATOR_HOST;
if (emulator && !/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(emulator)) {
  throw new Error('Profile tests require a loopback Firestore emulator.');
}

test('profiles and public leaderboard enforce full-name safety and ownership', {
  skip: !emulator && 'Set FIRESTORE_EMULATOR_HOST to run isolated security-rule checks.'
}, async t => {
  const project = `demo-profiles-${process.pid}-${Date.now()}`;
  const origin = `http://${emulator}`;
  const database = `projects/${project}/databases/(default)`;
  const documents = `${origin}/v1/${database}/documents`;
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
  const fields = value => Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encode(item)]));
  const token = uid => {
    const now = Math.floor(Date.now() / 1000);
    const claims = { aud: project, iss: `https://securetoken.google.com/${project}`, sub: uid,
      user_id: uid, iat: now, exp: now + 3600, auth_time: now,
      email: `${uid}@example.test`,
      firebase: { sign_in_provider: 'custom', identities: {} } };
    return `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.`;
  };
  const user = token('audience');
  const other = token('other');
  const admin = token('organiser');
  async function request(method, path, body, credential = 'owner', expected = 200) {
    const response = await fetch(`${documents}${path}`, {
      method, headers: { 'Content-Type': 'application/json', ...(credential ? { Authorization: `Bearer ${credential}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await response.text();
    assert.equal(response.status, expected, `${method} ${path}: ${text}`);
    return text ? JSON.parse(text) : null;
  }
  const put = (path, data, credential = 'owner', expected = 200) =>
    request('PATCH', `/${path}`, { fields: fields(data) }, credential, expected);
  const get = (path, credential, expected = 200) => request('GET', `/${path}`, undefined, credential, expected);
  async function save(path, data, credential, expected = 200, { timestamp = true, mask } = {}) {
    const write = { update: { name: `${database}/documents/${path}`, fields: fields(data) } };
    if (timestamp) write.updateTransforms = [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }];
    if (mask) write.updateMask = { fieldPaths: mask };
    return request('POST', ':commit', { writes: [write] }, credential, expected);
  }
  const profile = (uid, username, credential, expected = 200, options) =>
    save(`profiles/${uid}`, { username }, credential, expected, options);
  const row = (uid, overrides = {}) => ({ uid, displayName: 'Public Player', correct: 2, points: 2, pending: 1, rank: 1, ...overrides });
  const query = (collectionId, credential, expected = 200, extra = {}) => request('POST', ':runQuery', {
    structuredQuery: { from: [{ collectionId }], ...extra }
  }, credential, expected);
  const equal = (fieldPath, value) => ({ fieldFilter: { field: { fieldPath }, op: 'EQUAL', value } });

  try {
    const loaded = await fetch(`${origin}/emulator/v1/projects/${project}:securityRules`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rules: { files: [{ name: 'firestore.rules',
        content: await readFile(new URL('../public/firestore.rules', import.meta.url), 'utf8') }] } })
    });
    assert.equal(loaded.status, 200, await loaded.text());
    await put('admins/organiser', { role: 'admin' });

    await t.test('owners create and update only their own exact full-name profile and may share names', async () => {
      await get('profiles/audience', user, 404);
      await profile('audience', 'First Player', user);
      await profile('audience', 'Second Player', user);
      await profile('other', 'Second Player', other);
      const saved = await get('profiles/audience', user);
      assert.deepEqual(Object.keys(saved.fields).sort(), ['updatedAt', 'username']);
      assert.equal(saved.fields.username.stringValue, 'Second Player');
      assert.ok(saved.fields.updatedAt.timestampValue);
      await save('profiles/audience', { username: 'Partial Save' }, user, 200, { mask: ['username'] });
      assert.equal((await get('profiles/audience', user)).fields.username.stringValue, 'Partial Save');
    });

    await t.test('ordinary users cannot list profiles even when constrained to their own document', async () => {
      await get('profiles', user, 403);
      await query('profiles', user, 403);
      await query('profiles', user, 403, { limit: 1 });
      await query('profiles', user, 403, {
        where: equal('__name__', { referenceValue: `${database}/documents/profiles/audience` })
      });
      await query('profiles', user, 403, { where: equal('username', encode('Partial Save')) });
      await query('profiles', user, 403, { where: equal('uid', encode('audience')) });
    });

    await t.test('other accounts and signed-out clients cannot read or write private profiles', async () => {
      for (const credential of [other, null]) {
        await get('profiles/audience', credential, 403);
        await get('profiles', credential, 403);
        await query('profiles', credential, 403);
        await profile('audience', 'Participant', credential, 403);
        await profile('someone-new', 'Participant', credential, 403);
        await request('DELETE', '/profiles/audience', undefined, credential, 403);
      }
      await get('profiles/missing-other', user, 403);
      await request('DELETE', '/profiles/audience', undefined, user, 403);
    });

    await t.test('admins may get, list and reset others, but never arbitrarily rename or delete them', async () => {
      await get('profiles/audience', admin);
      await get('profiles', admin);
      await query('profiles', admin);
      await profile('audience', 'Admin Chosen Name', admin, 403);
      await profile('missing-profile', 'Admin Chosen Name', admin, 403);
      await profile('audience', 'Participant', admin);
      await profile('missing-profile', 'Participant', admin);
      assert.equal((await get('profiles/audience', user)).fields.username.stringValue, 'Participant');
      assert.equal((await get('profiles/missing-profile', admin)).fields.username.stringValue, 'Participant');
      await request('DELETE', '/profiles/audience', undefined, admin, 403);
      await profile('organiser', 'Own Admin Name', admin);
      await profile('organiser', 'Changed Admin Name', admin);
      await profile('audience', 'Owner Restored Name', user);
    });

    await t.test('JS and RE2 rules share Unicode full-name and unsafe-input vectors on create and update', async () => {
      for (const [index, username] of VALID_USERNAMES.entries()) {
        const uid = `valid-${index}`;
        const credential = token(uid);
        await profile(uid, username, credential);
        await profile(uid, username, credential);
        await save(`leaderboard/${uid}`, row(uid, { displayName: username }), admin);
        await save(`leaderboard/${uid}`, row(uid, { displayName: username }), admin);
      }
      for (const [index, username] of INVALID_USERNAMES.entries()) {
        const uid = `invalid-${index}`;
        const credential = token(uid);
        await profile(uid, username, credential, 403);
        await profile(uid, 'Valid Player', credential);
        await profile(uid, username, credential, 403);
        assert.equal((await get(`profiles/${uid}`, credential)).fields.username.stringValue, 'Valid Player');
        await save(`leaderboard/${uid}`, row(uid, { displayName: username }), admin, 403);
        await save(`leaderboard/${uid}`, row(uid), admin);
        await save(`leaderboard/${uid}`, row(uid, { displayName: username }), admin, 403);
      }
    });

    await t.test('Unicode owner defaults and later edits retain the exact private profile schema', async () => {
      const uid = 'google-default';
      const credential = token(uid);
      await profile(uid, 'José O’Neill', credential);
      const initial = await get(`profiles/${uid}`, credential);
      assert.equal(initial.fields.username.stringValue, 'José O’Neill');
      assert.deepEqual(Object.keys(initial.fields).sort(), ['updatedAt', 'username']);
      await profile(uid, '李 小龍', credential);
      assert.equal((await get(`profiles/${uid}`, credential)).fields.username.stringValue, '李 小龍');
      await profile(uid, 'private@example.test', credential, 403);
      assert.equal((await get(`profiles/${uid}`, credential)).fields.username.stringValue, '李 小龍');
    });

    await t.test('profile schemas, timestamps and partial updates cannot bypass create or update validation', async () => {
      const invalid = [
        {}, { username: 'Valid Player', uid: 'audience' },
        { username: 'Valid Player', email: 'private@example.test' },
        { username: 'Valid Player', displayName: 'Other Name' },
        { username: 'Valid Player', role: 'admin' },
        { username: 'Valid Player', isAdmin: true },
        { username: 'Valid Player', predictions: {} },
        { username: 'Valid Player', points: 100 }
      ];
      for (const [index, data] of invalid.entries()) {
        const uid = `schema-${index}`;
        await save(`profiles/${uid}`, data, token(uid), 403);
        await profile(uid, 'Before Update', token(uid));
        await save(`profiles/${uid}`, data, token(uid), 403);
      }
      for (const [index, updatedAt] of [null, false, 123, 'now', new Date(0), new Date('2100-01-01')].entries()) {
        const uid = `time-${index}`;
        const data = { username: 'Valid Player', updatedAt };
        await save(`profiles/${uid}`, data, token(uid), 403, { timestamp: false });
        await profile(uid, 'Before Update', token(uid));
        await save(`profiles/${uid}`, data, token(uid), 403, { timestamp: false });
      }
      await profile('missing-time', 'Valid Player', token('missing-time'), 403, { timestamp: false });
      await profile('audience', 'Valid Player', user, 403, { timestamp: false });
      await save('profiles/audience', { username: 'Valid Player' }, user, 403, { timestamp: false, mask: ['username'] });
      await save('profiles/audience', {}, user, 403, { mask: ['username'] });
      await save('profiles/audience', {}, user, 403, { timestamp: false, mask: ['updatedAt'] });
      await save('profiles/audience', { role: 'admin' }, user, 403, { mask: ['role'] });
      await save('profiles/audience', { username: 'Participant', email: 'private@example.test' }, admin, 403);
      await save('profiles/admin-invalid-create', { username: 'Participant', role: 'admin' }, admin, 403);
      await save('profiles/admin-time-create', { username: 'Participant', updatedAt: new Date(0) }, admin, 403, { timestamp: false });
      await save('profiles/audience', { username: 'Participant', updatedAt: new Date(0) }, admin, 403, { timestamp: false });
      for (const credential of [user, admin, null]) {
        await put('admins/audience', { role: 'admin' }, credential, 403);
        await put('admins/organiser', { role: 'admin' }, credential, 403);
      }
    });

    await t.test('public leaderboard exposes only safe fields to signed-out and signed-in readers', async () => {
      await save('leaderboard/audience', row('audience'), admin);
      for (const credential of [null, user, other, admin]) {
        const saved = await get('leaderboard/audience', credential);
        assert.deepEqual(Object.keys(saved.fields).sort(), ['correct', 'displayName', 'pending', 'points', 'rank', 'uid', 'updatedAt']);
        assert.equal(saved.fields.displayName.stringValue, 'Public Player');
        assert.equal(saved.fields.points.integerValue, saved.fields.correct.integerValue);
        await get('leaderboard', credential);
        await query('leaderboard', credential);
      }
      for (const credential of [user, other, null]) {
        await save('leaderboard/new-row', row('new-row'), credential, 403);
        await save('leaderboard/audience', row('audience'), credential, 403);
        await request('DELETE', '/leaderboard/audience', undefined, credential, 403);
      }
    });

    await t.test('admin leaderboard writes reject unsafe fields, malformed scores and missing or stale timestamps', async () => {
      const invalid = [
        { uid: 'another-user' }, { uid: 123 }, { correct: -1, points: -1 },
        { correct: 1.5, points: 1.5 }, { correct: '2' }, { points: 3 },
        { points: '2' }, { correct: false, points: false }, { pending: -1 },
        { pending: 0.5 }, { pending: '1' }, { rank: 0 }, { rank: 1.5 }, { rank: '1' },
        { email: 'private@example.test' }, { authEmail: 'private@example.test' },
        { username: 'Hidden Name' }, { role: 'admin' }, { selectedPlayers: ['A1', 'A2'] }
      ];
      for (const [index, overrides] of invalid.entries()) {
        const uid = `bad-row-${index}`;
        await save(`leaderboard/${uid}`, row(uid, overrides), admin, 403);
        await save(`leaderboard/${uid}`, row(uid), admin);
        await save(`leaderboard/${uid}`, row(uid, overrides), admin, 403);
      }
      for (const key of ['uid', 'displayName', 'correct', 'points', 'pending', 'rank']) {
        const uid = `missing-${key}`;
        const data = row(uid);
        delete data[key];
        await save(`leaderboard/${uid}`, data, admin, 403);
        await save(`leaderboard/${uid}`, row(uid), admin);
        await save(`leaderboard/${uid}`, data, admin, 403);
      }
      for (const [index, updatedAt] of [null, false, 123, 'now', new Date(0), new Date('2100-01-01')].entries()) {
        const uid = `row-time-${index}`;
        await save(`leaderboard/${uid}`, row(uid, { updatedAt }), admin, 403, { timestamp: false });
        await save(`leaderboard/${uid}`, row(uid), admin);
        await save(`leaderboard/${uid}`, row(uid, { updatedAt }), admin, 403, { timestamp: false });
      }
      await save('leaderboard/no-time', row('no-time'), admin, 403, { timestamp: false });
      await save('leaderboard/audience', row('audience'), admin, 403, { timestamp: false });
      await save('leaderboard/audience', { email: 'private@example.test' }, admin, 403, { mask: ['email'] });
      await save('leaderboard/audience', { points: 999 }, admin, 403, { mask: ['points'] });
      await save('leaderboard/audience', {}, admin, 403, { mask: ['displayName'] });
      await save('leaderboard/zero-score', row('zero-score', { correct: 0, points: 0, pending: 0 }), admin);
      await request('DELETE', '/leaderboard/zero-score', undefined, admin);
    });

    await t.test('full-name saves leave private predictions and locked-room snapshots unchanged', async () => {
      await put('settings/rounds_preliminary', { predictionsOpen: true });
      await put('rooms/A', { players: Array.from({ length: 8 }, (_, index) => `A${index + 1}`),
        formatVersion: 2, resultsPublished: false, status: 'upcoming', predictionsLocked: false });
      const pick = { uid: 'audience', roomId: 'A', stageId: 'preliminary', formatVersion: 2,
        displayName: 'private@example.test', selectedPlayers: ['A1', 'A2'] };
      await save('predictions/audience_A', pick, user);
      const before = await get('predictions/audience_A', user);
      for (const credential of [other, null]) {
        await get('predictions/audience_A', credential, 403);
        await query('predictions', credential, 403);
        await query('predictions', credential, 403, { where: equal('uid', encode('audience')) });
      }
      await query('predictions', user, 403);
      await query('predictions', user, 200, { where: equal('uid', encode('audience')) });
      await get('predictions/audience_A', admin);
      await query('predictions', admin);
      await profile('audience', 'José O’Neill', user);
      assert.deepEqual(await get('predictions/audience_A', user), before);
      await put('rooms/A', { players: Array.from({ length: 8 }, (_, index) => `A${index + 1}`),
        formatVersion: 2, resultsPublished: false, status: 'upcoming', predictionsLocked: true }, admin);
      const locked = await get('rooms/A', user);
      await profile('audience', '李 小龍', user);
      await profile('audience', 'Participant', admin);
      await save('predictions/audience_A', { ...pick, selectedPlayers: ['A3', 'A4'] }, user, 403);
      await request('DELETE', '/predictions/audience_A', undefined, user, 403);
      assert.deepEqual(await get('predictions/audience_A', user), before);
      assert.deepEqual(await get('rooms/A', user), locked);
      await get('predictions/audience_A', other, 403);
      await query('predictions', null, 403);
    });
  } finally {
    const cleaned = await fetch(`${origin}/emulator/v1/${database}/documents`, { method: 'DELETE' });
    assert.equal(cleaned.status, 200, 'Clean up isolated emulator documents');
  }
});
