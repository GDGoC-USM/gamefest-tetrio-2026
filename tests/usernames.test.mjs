import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_USERNAME, normalizeUsername, isValidUsername, publicUsername } from '../public/js/usernames.js';
import { VALID_USERNAMES, INVALID_USERNAMES, NORMALIZATION_CASES } from './username-cases.mjs';

test('valid stored usernames retain exact spelling, spacing and case', () => {
  for (const value of VALID_USERNAMES) {
    assert.equal(isValidUsername(value), true, JSON.stringify(value));
    assert.equal(publicUsername(value), value);
  }
});

test('invalid stored usernames use the safe fallback without normalization', () => {
  assert.equal(DEFAULT_USERNAME, 'Participant');
  for (const value of [...INVALID_USERNAMES, undefined]) {
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

