import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_BULK_PARTICIPANTS,
  MAX_PARTICIPANT_NAME_LENGTH,
  createManualParticipantId,
  normalizeParticipantName,
  parseBulkParticipants
} from '../public/js/lucky-draw-import.js';

test('bulk preview trims edges, ignores empty lines and preserves spelling', () => {
  const result = parseBulkParticipants(
    '\r\n  Alice  \n\n Bob  Smith \r\n\t\n   \n',
    []
  );

  assert.equal(result.total, 2);
  assert.equal(result.duplicateCount, 0);
  assert.equal(result.canImport, true);
  assert.deepEqual(result.entries.map(entry => entry.name), ['Alice', 'Bob  Smith']);
  assert.deepEqual(result.entries.map(entry => entry.line), [2, 4]);
  assert.equal(result.entries[1].normalizeKey, 'bob smith');
});

test('duplicates compare case-insensitively with collapsed internal spaces', () => {
  assert.equal(normalizeParticipantName('  ALICE   Smith  '), 'alice smith');

  const result = parseBulkParticipants(
    'Alice Smith\nALICE  SMITH\nalice smith\nZoe\nzoe\nBob',
    ['  alice   smith ', 'ZOE']
  );

  assert.equal(result.total, 6);
  assert.equal(result.duplicateCount, 5);
  assert.equal(result.canImport, true, 'duplicates must never block importing');

  assert.deepEqual(
    result.entries.map(entry => entry.name),
    ['Alice Smith', 'ALICE  SMITH', 'alice smith', 'Zoe', 'zoe', 'Bob']
  );
  assert.deepEqual(
    result.entries.map(entry => [entry.duplicateInPaste, entry.duplicateExisting]),
    [[true, true], [true, true], [true, true], [true, true], [true, true], [false, false]]
  );
});

test('an existing wheel name is highlighted without becoming a list duplicate', () => {
  const result = parseBulkParticipants('Mallory', ['  MALLORY  ']);

  assert.equal(result.duplicateCount, 1);
  assert.equal(result.canImport, true);
  assert.equal(result.entries[0].duplicateInPaste, false);
  assert.equal(result.entries[0].duplicateExisting, true);
});

test('row-count and name-length limits produce clear validation errors', () => {
  const atLimit = Array.from({ length: MAX_BULK_PARTICIPANTS }, (_, index) => `Player ${index}`);
  const accepted = parseBulkParticipants(atLimit.join('\n'));
  assert.equal(accepted.total, MAX_BULK_PARTICIPANTS);
  assert.equal(accepted.canImport, true);

  const overLimit = parseBulkParticipants([...atLimit, 'One Too Many'].join('\n'));
  assert.equal(overLimit.total, MAX_BULK_PARTICIPANTS + 1);
  assert.equal(overLimit.canImport, false);
  assert.equal(overLimit.entries.length, 0);
  assert.match(overLimit.errors[0], /at most 200 participants/i);

  const longest = parseBulkParticipants('A'.repeat(MAX_PARTICIPANT_NAME_LENGTH));
  assert.equal(longest.canImport, true);
  assert.equal(longest.entries[0].name.length, MAX_PARTICIPANT_NAME_LENGTH);

  const tooLong = parseBulkParticipants(
    `Alice\n${'B'.repeat(MAX_PARTICIPANT_NAME_LENGTH + 1)}`
  );
  assert.equal(tooLong.canImport, false);
  assert.equal(tooLong.duplicateCount, 0);
  assert.match(tooLong.errors[0], /Line 2: names must be 60 characters or fewer; this one has 61\./);
  assert.match(tooLong.entries[1].error, /61/);
});

test('empty paste is rejected with an actionable message', () => {
  const result = parseBulkParticipants('\n  \r\n\t');

  assert.equal(result.total, 0);
  assert.equal(result.canImport, false);
  assert.deepEqual(result.errors, ['Paste at least one participant name.']);
});

test('manual IDs are generated from the existing mechanism and stay unique', () => {
  let counter = 0;
  const ids = new Set(['manual-1000-i']);
  const random = [0.5, 0.25];

  const first = createManualParticipantId(ids, () => 1000, () => random.shift());
  assert.equal(first, 'manual-1000-9');
  ids.add(first);

  for (let index = 0; index < 500; index++) {
    const id = createManualParticipantId(ids, () => 1000, () => {
      counter += 1;
      return counter / 1000;
    });
    assert.match(id, /^manual-1000-/);
    assert.equal(ids.has(id), false);
    ids.add(id);
  }

  assert.equal(ids.size, 502);
});
