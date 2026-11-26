import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_USERNAME, normalizeUsername, isValidUsername, publicUsername, usernameProfileState } from '../public/js/usernames.js';
import { VALID_USERNAMES, INVALID_USERNAMES, NORMALIZATION_CASES } from './username-cases.mjs';

test('valid stored full names retain exact spelling, spacing and case', () => {
  for (const value of VALID_USERNAMES) {
    assert.equal(isValidUsername(value), true, JSON.stringify(value));
    assert.equal(publicUsername(value), value);
  }
});

test('invalid stored full names use the safe fallback without normalization', () => {
  assert.equal(DEFAULT_USERNAME, 'Participant');
  for (const value of [...INVALID_USERNAMES, undefined, 'A\ud800B', 'A\udfffB']) {
    assert.equal(isValidUsername(value), false, JSON.stringify(value));
    assert.equal(publicUsername(value), DEFAULT_USERNAME);
  }
  assert.equal(publicUsername(' Abc '), DEFAULT_USERNAME);
});

test('input normalization removes only ordinary ASCII edge spaces', () => {
  for (const [value, expected] of NORMALIZATION_CASES) {
    assert.equal(normalizeUsername(value), expected, JSON.stringify(value));
  }
  assert.equal(isValidUsername(normalizeUsername(' Abc ')), true);
  assert.equal(isValidUsername(normalizeUsername(' Abc\n ')), false);
});

test('missing owner profiles initialize once from a valid Google display name', () => {
  const user = Object.freeze({ uid: 'owner', displayName: '  José O’Neill  ', email: 'unrelated@example.test' });
  const initial = usernameProfileState(undefined, user);
  assert.deepEqual(initial, { username: 'José O’Neill', initialize: true, needsFullName: false });
  const persisted = Object.freeze({ username: initial.username, updatedAt: Object.freeze({ seconds: 123 }) });
  assert.deepEqual(usernameProfileState(persisted, { ...user, displayName: 'Changed Google Name' }),
    { username: 'José O’Neill', initialize: false, needsFullName: false });
  assert.equal(user.displayName, '  José O’Neill  ');
});

test('existing valid owner names survive Google changes without initialization writes', () => {
  for (const username of VALID_USERNAMES.filter(value => value !== DEFAULT_USERNAME)) {
    for (const profile of [{ username }, { username, updatedAt: { seconds: 123 } }]) {
      assert.deepEqual(usernameProfileState(Object.freeze(profile), { displayName: 'Different Google Name' }),
        { username, initialize: false, needsFullName: false });
    }
  }
});

test('unsafe or unavailable Google names never fall back to email or its local part', () => {
  const unsafeGoogleNames = INVALID_USERNAMES.filter(value => !isValidUsername(normalizeUsername(value)));
  for (const displayName of [...unsafeGoogleNames, DEFAULT_USERNAME]) {
    const user = { uid: 'owner', displayName, email: 'EmailLocalPart@example.test',
      providerData: [{ providerId: 'google.com', email: 'ProviderLocalPart@example.test' }] };
    assert.deepEqual(usernameProfileState(undefined, user),
      { username: DEFAULT_USERNAME, initialize: false, needsFullName: true }, JSON.stringify(displayName));
  }
  assert.deepEqual(usernameProfileState(undefined, undefined),
    { username: DEFAULT_USERNAME, initialize: false, needsFullName: true });
});

test('only legacy Participant without a timestamp is eligible for lazy owner repair', () => {
  const user = { displayName: '李 小龍', email: 'private@example.test' };
  assert.deepEqual(usernameProfileState(Object.freeze({ username: DEFAULT_USERNAME }), user),
    { username: '李 小龍', initialize: true, needsFullName: false });
  for (const updatedAt of [{ seconds: 123 }, null, undefined]) {
    assert.deepEqual(usernameProfileState(Object.freeze({ username: DEFAULT_USERNAME, updatedAt }), user),
      { username: DEFAULT_USERNAME, initialize: false, needsFullName: true });
  }
  assert.deepEqual(usernameProfileState({ username: DEFAULT_USERNAME }, { displayName: 'private@example.test' }),
    { username: DEFAULT_USERNAME, initialize: false, needsFullName: true });
});

test('invalid existing profiles prompt correction without automatic replacement', () => {
  for (const username of INVALID_USERNAMES) {
    const profile = Object.freeze({ username, updatedAt: { seconds: 123 } });
    assert.deepEqual(usernameProfileState(profile, { displayName: 'Valid Google Name' }),
      { username: DEFAULT_USERNAME, initialize: false, needsFullName: true }, JSON.stringify(username));
  }
});
