import test from 'node:test';
import assert from 'node:assert/strict';
import { rankLeaderboardRows, planLeaderboardChanges } from '../public/js/leaderboard-sync.js';
import { calculateLeaderboard } from '../public/js/tournament.js';

const timestamp = Object.freeze({ toMillis() { return 1234; } });
const score = (uid, correct = 1, pending = 0) => ({ uid, displayName: 'Stale prediction name', correct, points: 999, pending });
const storedRows = rows => new Map(rows.map(row => [row.uid, Object.freeze({ ...row, updatedAt: timestamp })]));
const ids = plan => plan.upserts.map(row => row.uid);

function report(t, label, plan) {
  t.diagnostic(`${label}: ${plan.upserts.length} upserts, ${plan.deletes.length} deletes`);
}

test('initial calculation adds exact rows without mutating scores or profile data', () => {
  const scores = Object.freeze([Object.freeze(score('b', 2)), Object.freeze(score('a', 3, 1))]);
  const names = new Map([['a', 'Alice'], ['b', 'Bobby']]);
  const rows = rankLeaderboardRows(scores, names);
  assert.deepEqual(rows, [
    { uid: 'a', displayName: 'Alice', correct: 3, points: 3, pending: 1, rank: 1 },
    { uid: 'b', displayName: 'Bobby', correct: 2, points: 2, pending: 0, rank: 2 }
  ]);
  assert.deepEqual(planLeaderboardChanges(rows, new Map()), { upserts: rows, deletes: [] });
  assert.equal(scores[0].points, 999);
  assert.equal(scores[0].displayName, 'Stale prediction name');
  assert.deepEqual([...names], [['a', 'Alice'], ['b', 'Bobby']]);
  assert.notEqual(rows[0], scores[1]);
});

test('unchanged recalculation preserves stored objects and timestamp references', t => {
  const rows = rankLeaderboardRows([score('a')]);
  const existing = storedRows(rows);
  const original = existing.get('a');
  const plan = planLeaderboardChanges(rankLeaderboardRows([score('a')]), existing);
  assert.deepEqual(plan, { upserts: [], deletes: [] });
  assert.equal(existing.get('a'), original);
  assert.equal(existing.get('a').updatedAt, timestamp);
  report(t, 'unchanged', plan);
});

test('only persisted score, pending, name or rank changes produce replacements', () => {
  const rows = rankLeaderboardRows([score('a', 8), score('b', 4), score('c', 1)]);
  for (const change of [{ correct: 7, points: 7 }, { pending: 2 }, { displayName: 'Alice' }, { rank: 9 }]) {
    const changed = rows.map(row => row.uid === 'a' ? { ...row, ...change } : row);
    const plan = planLeaderboardChanges(changed, storedRows(rows));
    assert.deepEqual(ids(plan), ['a']);
    assert.deepEqual(plan.upserts[0], changed[0]);
    assert.deepEqual(plan.deletes, []);
  }
});

test('alphabetical tied reordering updates affected sequential stored ranks only', t => {
  const scores = [score('z', 5), score('a', 5), score('c', 1)];
  const names = new Map([['z', 'Alpha'], ['a', 'Bravo'], ['c', 'Charlie']]);
  const before = rankLeaderboardRows(scores, names);
  const after = rankLeaderboardRows(scores, new Map([...names, ['z', 'Zulu']]));
  const plan = planLeaderboardChanges(after, storedRows(before));
  assert.deepEqual(ids(plan), ['a', 'z']);
  assert.deepEqual(after.map(row => [row.uid, row.rank]), [['a', 1], ['z', 2], ['c', 3]]);
  for (const row of plan.upserts) {
    assert.equal(row.correct, 5);
    assert.equal(row.points, 5);
  }
  report(t, 'legitimate tied rank shuffle', plan);
});

test('identical names and totals retain source order, not UID order', () => {
  const rows = rankLeaderboardRows([score('z'), score('a')]);
  assert.deepEqual(rows.map(row => [row.uid, row.rank]), [['z', 1], ['a', 2]]);
});

test('obsolete document IDs are deleted, including mismatched stored UID values', () => {
  const rows = rankLeaderboardRows([score('a')]);
  const existing = storedRows(rows);
  existing.set('obsolete', { ...rows[0], uid: 'a', updatedAt: timestamp });
  assert.deepEqual(planLeaderboardChanges(rows, existing), { upserts: [], deletes: ['obsolete'] });
  assert.deepEqual(planLeaderboardChanges([], existing), { upserts: [], deletes: ['a', 'obsolete'] });
});

test('only valid public full names can supply names, never predictions or profile objects', () => {
  for (const value of ['viewer@example.com', '<img src=x onerror=alert(1)>', { username: 'Alice', email: 'private@example.com' }, null, 42, ' Alice', 'ab']) {
    const rows = rankLeaderboardRows([score('a')], new Map([['a', value]]));
    assert.equal(rows[0].displayName, 'Participant');
    assert.deepEqual(Object.keys(rows[0]), ['uid', 'displayName', 'correct', 'points', 'pending', 'rank']);
  }
  assert.equal(rankLeaderboardRows([score('a')])[0].displayName, 'Participant');
  for (const name of ['Valid_User-9', 'José O’Neill', '李 小龍', 'محمد أحمد', '𐐀'.repeat(80)]) {
    assert.equal(rankLeaderboardRows([score('a')], new Map([['a', name]]))[0].displayName, name);
  }
});

test('full-name changes replace only the named row without changing UID or score totals', () => {
  const scores = Object.freeze([Object.freeze(score('a', 3, 2)), Object.freeze(score('b', 1, 4))]);
  const before = rankLeaderboardRows(scores, new Map([['a', 'Existing Name'], ['b', 'Preserved Name']]));
  const after = rankLeaderboardRows(scores, new Map([['a', 'José O’Neill'], ['b', 'Preserved Name']]));
  const plan = planLeaderboardChanges(after, storedRows(before));
  assert.deepEqual(ids(plan), ['a']);
  assert.deepEqual(plan.deletes, []);
  assert.deepEqual(plan.upserts[0], { uid: 'a', displayName: 'José O’Neill', correct: 3, points: 3, pending: 2, rank: 1 });
  assert.deepEqual(planLeaderboardChanges(after, storedRows(after)), { upserts: [], deletes: [] });
  assert.equal(scores[0].displayName, 'Stale prediction name');
  assert.equal(scores[0].points, 999);
});

test('legacy extra fields and every missing schema field require full replacement', () => {
  const rows = rankLeaderboardRows([score('a')]);
  const original = { ...rows[0], updatedAt: timestamp };
  for (const [field, value] of Object.entries({ email: 'private@example.com', auth: { email: 'private@example.com' }, profile: { username: 'Alice' }, obsolete: true })) {
    const stale = Object.freeze({ ...original, [field]: value });
    const plan = planLeaderboardChanges(rows, new Map([['a', stale]]));
    assert.deepEqual(plan.upserts, rows);
    assert.equal(Object.hasOwn(plan.upserts[0], field), false);
    assert.equal(stale[field], value);
  }
  for (const field of Object.keys(original)) {
    const incomplete = { ...original };
    delete incomplete[field];
    assert.deepEqual(planLeaderboardChanges(rows, new Map([['a', incomplete]])).upserts, rows);
  }
});

test('missing, malformed, throwing or nonfinite timestamps are repaired', () => {
  const rows = rankLeaderboardRows([score('a')]);
  for (const updatedAt of [undefined, null, 1234, new Date(1234), {}, { seconds: 1 }, { toMillis: 1234 }, { toMillis: () => NaN }, { toMillis: () => Infinity }, { toMillis: () => '1234' }, { toMillis() { throw new Error('bad timestamp'); } }]) {
    assert.deepEqual(planLeaderboardChanges(rows, new Map([['a', { ...rows[0], updatedAt }]])).upserts, rows);
  }
  for (const millis of [0, -1, 9876]) {
    const updatedAt = { toMillis: () => millis };
    const existing = new Map([['a', { ...rows[0], updatedAt }]]);
    assert.deepEqual(planLeaderboardChanges(rows, existing), { upserts: [], deletes: [] });
    assert.equal(existing.get('a').updatedAt, updatedAt);
  }
});

test('corrected and unpublished results replace absolute totals without duplicate legacy points', () => {
  const room = { players: ['Alpha', 'Bravo'], formatVersion: 2, resultsPublished: true, scores: [11, 2], winner: 'Alpha', loser: 'Bravo' };
  const predictions = [
    { uid: 'a', roomId: 'FINAL', formatVersion: 2, selectedPlayers: ['Alpha'], displayName: 'private@example.com' },
    { uid: 'a', matchId: 'FINAL', champion: 'Alpha', displayName: '<b>Private</b>' }
  ];
  const calculate = currentRoom => rankLeaderboardRows(calculateLeaderboard(predictions, { FINAL: currentRoom }));
  const initial = calculate(room);
  assert.deepEqual(initial[0], { uid: 'a', displayName: 'Participant', correct: 1, points: 1, pending: 0, rank: 1 });
  assert.deepEqual(planLeaderboardChanges(calculate(room), storedRows(initial)), { upserts: [], deletes: [] });
  const corrected = calculate({ ...room, scores: [2, 11], winner: 'Bravo', loser: 'Alpha' });
  assert.equal(corrected[0].correct, 0);
  assert.equal(corrected[0].points, 0);
  assert.deepEqual(planLeaderboardChanges(corrected, storedRows(initial)).upserts, corrected);
  const unpublished = calculate({ ...room, resultsPublished: false });
  assert.deepEqual(unpublished[0], { uid: 'a', displayName: 'Participant', correct: 0, points: 0, pending: 1, rank: 1 });
  assert.deepEqual(planLeaderboardChanges(unpublished, storedRows(corrected)).upserts, unpublished);
  assert.deepEqual(planLeaderboardChanges(calculate({ ...room, resultsPublished: false }), storedRows(unpublished)), { upserts: [], deletes: [] });
});

test('150-user synthetic plans illustrate actual delta counts without a storage API', t => {
  const scores = Array.from({ length: 150 }, (_, i) => score(`user-${i}`, (150 - i) * 10));
  const names = new Map(scores.map((row, i) => [row.uid, `Player ${String(i).padStart(3, '0')}`]));
  const baseline = rankLeaderboardRows(scores, names);
  const existing = storedRows(baseline);
  const unchanged = planLeaderboardChanges(rankLeaderboardRows(scores, names), existing);
  assert.deepEqual(unchanged, { upserts: [], deletes: [] });
  report(t, '150 users unchanged', unchanged);
  const renamed = planLeaderboardChanges(rankLeaderboardRows(scores, new Map([...names, ['user-75', 'Renamed Player']])), existing);
  assert.deepEqual(ids(renamed), ['user-75']);
  report(t, '150 users name-only', renamed);
  const fiveChanged = scores.map((row, i) => i < 5 ? { ...row, correct: row.correct - 1 } : row);
  const five = planLeaderboardChanges(rankLeaderboardRows(fiveChanged, names), existing);
  assert.deepEqual(ids(five), ['user-0', 'user-1', 'user-2', 'user-3', 'user-4']);
  assert.deepEqual(five.upserts.map(row => row.rank), [1, 2, 3, 4, 5]);
  report(t, '150 users five changed without rank shift', five);
  const shuffled = scores.map(row => row.uid === 'user-10' ? { ...row, correct: 1501 } : row);
  const shuffle = planLeaderboardChanges(rankLeaderboardRows(shuffled, names), existing);
  assert.equal(shuffle.upserts.length, 11);
  assert.equal(shuffle.deletes.length, 0);
  assert.equal(shuffle.upserts[0].uid, 'user-10');
  assert.equal(shuffle.upserts[0].rank, 1);
  assert.equal(shuffle.upserts.at(-1).uid, 'user-9');
  report(t, '150 users legitimate score rank shuffle', shuffle);
});
