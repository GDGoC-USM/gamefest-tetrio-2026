import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Opt in explicitly; never send fixtures or unsigned test tokens to a remote backend.
const emulator = process.env.FIRESTORE_EMULATOR_HOST;
if (emulator && !/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(emulator)) {
  throw new Error('Prediction lock tests require a loopback Firestore emulator.');
}

test('room prediction locks enforce allowed and denied Firestore requests', {
  skip: !emulator && 'Set FIRESTORE_EMULATOR_HOST to run isolated security-rule checks.'
}, async t => {
  const project = `demo-room-lock-${process.pid}-${Date.now()}`;
  const origin = `http://${emulator}`;
  const database = `projects/${project}/databases/(default)`;
  const documents = `${origin}/v1/${database}/documents`;
  const encode = value => {
    if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } };
    if (typeof value === 'boolean') return { booleanValue: value };
    if (typeof value === 'number') return { integerValue: String(value) };
    if (typeof value === 'string') return { stringValue: value };
    return { mapValue: { fields: fields(value) } };
  };
  const fields = value => Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encode(item)]));
  const token = uid => {
    const now = Math.floor(Date.now() / 1000);
    const claims = { aud: project, iss: `https://securetoken.google.com/${project}`, sub: uid,
      user_id: uid, iat: now, exp: now + 3600, auth_time: now,
      firebase: { sign_in_provider: 'custom', identities: {} } };
    return `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.`;
  };
  const user = token('audience');
  const newcomer = token('newcomer');
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
  const patch = (path, data, credential = 'owner', expected = 200) => request('PATCH',
    `/${path}?${Object.keys(data).map(key => `updateMask.fieldPaths=${key}`).join('&')}`,
    { fields: fields(data) }, credential, expected);
  async function pick(uid, roomId, selectedPlayers, credential, expected = 200) {
    return request('POST', ':commit', { writes: [{
      update: { name: `${database}/documents/predictions/${uid}_${roomId}`, fields: fields({
        uid, roomId, stageId: roomId.startsWith('QF') ? 'quarterfinal' : 'preliminary',
        formatVersion: 2, displayName: 'Synthetic audience', selectedPlayers
      }) },
      updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }]
    }] }, credential, expected);
  }
  const room = id => ({ name: `Synthetic ${id}`, players: Array.from({ length: 8 }, (_, i) => `${id}${i + 1}`),
    formatVersion: 2, resultsPublished: false, status: 'upcoming' });

  try {
    const loaded = await fetch(`${origin}/emulator/v1/projects/${project}:securityRules`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rules: { files: [{ name: 'firestore.rules',
        content: await readFile(new URL('../public/firestore.rules', import.meta.url), 'utf8') }] } })
    });
    assert.equal(loaded.status, 200, await loaded.text());
    await put('admins/organiser', { role: 'admin' });
    await put('settings/rounds_preliminary', { predictionsOpen: true });
    await put('settings/rounds_quarterfinal', { predictionsOpen: true });
    await put('rooms/A', room('A'));
    await put('rooms/B', room('B'));

    await t.test('legacy rooms without a lock allow valid saves and updates', async () => {
      await pick('audience', 'A', ['A1', 'A2'], user);
      await pick('audience', 'A', ['A2', 'A3'], user);
      await put('predictions/legacy-audience', { uid: 'audience', matchId: 'A', pick: 'A1' });
    });
    await t.test('only an administrator can change the room lock', async () => {
      await patch('rooms/A', { predictionsLocked: true }, null, 403);
      await patch('rooms/A', { predictionsLocked: true }, user, 403);
      await patch('rooms/A', { predictionsLocked: true }, admin);
    });
    await t.test('locked rooms deny creates, edits and current or legacy user resets without erasing picks', async () => {
      const before = await request('GET', '/predictions/audience_A', undefined, user);
      await pick('newcomer', 'A', ['A1', 'A2'], newcomer, 403);
      await pick('audience', 'A', ['A1', 'A3'], user, 403);
      await request('DELETE', '/predictions/audience_A', undefined, user, 403);
      await request('DELETE', '/predictions/legacy-audience', undefined, user, 403);
      assert.deepEqual(await request('GET', '/predictions/audience_A', undefined, user), before);
      await pick('audience', 'B', ['B1', 'B2'], user);
    });
    await t.test('closing and reopening a stage does not override a room lock', async () => {
      await patch('settings/rounds_preliminary', { predictionsOpen: false }, admin);
      await pick('audience', 'B', ['B2', 'B3'], user, 403);
      await patch('settings/rounds_preliminary', { predictionsOpen: true }, admin);
      await pick('audience', 'A', ['A1', 'A3'], user, 403);
      await pick('audience', 'B', ['B2', 'B3'], user);
    });
    await t.test('unlock restores edits and resets but does not override other restrictions', async () => {
      await patch('rooms/A', { predictionsLocked: false }, admin);
      await pick('audience', 'A', ['A1', 'A3'], user);
      await request('DELETE', '/predictions/audience_A', undefined, user);
      await request('DELETE', '/predictions/legacy-audience', undefined, user);
      await patch('settings/rounds_preliminary', { predictionsOpen: false }, admin);
      await pick('audience', 'A', ['A1', 'A2'], user, 403);
      await patch('settings/rounds_preliminary', { predictionsOpen: true }, admin);
      for (const restriction of [{ resultsPublished: true }, { status: 'completed' }, { players: [] }]) {
        await put('rooms/A', { ...room('A'), predictionsLocked: false, ...restriction });
        await pick('audience', 'A', ['A1', 'A2'], user, 403);
      }
    });
    await t.test('head-to-head rooms enforce the same lock with confirmed feeders', async () => {
      for (const id of ['A', 'B']) await put(`rooms/${id}`, {
        ...room(id), resultsPublished: true, qualifiers: [`${id}1`, `${id}2`]
      });
      await put('rooms/QF1', { players: ['A1', 'B2'], formatVersion: 2, status: 'upcoming',
        resultsPublished: false, predictionsLocked: false });
      await pick('audience', 'QF1', ['A1'], user);
      await patch('rooms/QF1', { predictionsLocked: true }, admin);
      await pick('audience', 'QF1', ['B2'], user, 403);
      await request('DELETE', '/predictions/audience_QF1', undefined, user, 403);
      await patch('rooms/QF1', { predictionsLocked: false }, admin);
      await pick('audience', 'QF1', ['B2'], user);
    });
  } finally {
    const cleaned = await fetch(`${origin}/emulator/v1/${database}/documents`, { method: 'DELETE' });
    assert.equal(cleaned.status, 200, 'Clean up isolated emulator documents');
  }
});
