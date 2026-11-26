import test from 'node:test';
import assert from 'node:assert/strict';
import { ROOM_CONFIG, deriveRooms, dependentRoomIds, validateGroupResult, validateSeriesResult, validateFFAResult, calculateLeaderboard, scorePrediction, roomReady, playerLabel, isPlayer } from '../public/js/tournament.js';

function sample() {
  const rooms = {};
  for (const id of ['A', 'B', 'C', 'D']) {
    const players = Array.from({ length: 8 }, (_, index) => `${id}-player-${index}`);
    const playerDetails = Object.fromEntries(players.map((key, index) => [key, { participantId: `TEST${String(index).padStart(3, '0')}`, username: key }]));
    rooms[id] = { players, playerDetails, status: 'upcoming', resultsPublished: false };
    Object.assign(rooms[id], validateGroupResult(rooms[id], [players[4], players[1]]));
  }
  const update = () => {
    for (const [id, derived] of Object.entries(deriveRooms(rooms))) {
      if (!rooms[id]?.resultsPublished) rooms[id] = derived;
    }
  };
  update();
  for (const config of ROOM_CONFIG.filter(config => config.kind === 'series')) {
    Object.assign(rooms[config.id], validateSeriesResult(config.id, rooms[config.id], [config.target, 2]));
    update();
  }
  return rooms;
}

test('ordered qualifiers, not roster positions, drive every knockout and placement feeder', () => {
  const rooms = sample();
  assert.deepEqual(rooms.QF1.players, ['A-player-4', 'B-player-1']);
  assert.deepEqual(rooms.QF3.players, ['B-player-4', 'A-player-1']);
  assert.deepEqual(rooms.PLACEMENT.players, ['QF1', 'QF2', 'QF3', 'QF4'].map(id => rooms[id].loser));
  assert.deepEqual(rooms.THIRD.players, ['SF1', 'SF2'].map(id => rooms[id].loser));
  assert.deepEqual(rooms.FINAL.players, ['SF1', 'SF2'].map(id => rooms[id].winner));
  assert.equal(playerLabel(rooms.QF1, rooms.QF1.players[0]), 'TEST004 · A-player-4');
  const partial = deriveRooms({ A: rooms.A });
  assert.deepEqual(partial.QF1.players, ['A-player-4', '']);
});

test('points and Lucky Draw tickets are absolute 2, 2, then 1 after one correction', () => {
  const rooms = sample();
  const predictions = ['QF1', 'FINAL'].map(roomId => ({ uid: 'viewer', displayName: 'Viewer', roomId, formatVersion: 2, selectedPlayers: [rooms[roomId].winner] }));
  assert.equal(calculateLeaderboard(predictions, rooms)[0].points, 2);
  Object.assign(rooms.FINAL, validateSeriesResult('FINAL', rooms.FINAL, [11, 2]));
  assert.deepEqual(calculateLeaderboard(predictions, rooms)[0], { uid: 'viewer', displayName: 'Participant', correct: 2, points: 2, pending: 0 });
  Object.assign(rooms.FINAL, validateSeriesResult('FINAL', rooms.FINAL, [2, 11]));
  assert.equal(calculateLeaderboard(predictions, rooms)[0].points, 1);
  const legacy = { uid: 'old', roomId: 'FINAL', champion: rooms.FINAL.winner, runnerUp: rooms.FINAL.loser, secondRunnerUp: 'other' };
  assert.equal(calculateLeaderboard([legacy], rooms)[0].points, 1);
  assert.equal(calculateLeaderboard([...predictions, { ...predictions[0], formatVersion: undefined }], rooms)[0].points, 1);
  rooms.FINAL.resultsPublished = false;
  assert.deepEqual(scorePrediction(predictions[1], rooms), { correct: 0, pending: 1 });
});

test('prediction identity, including legacy emails, is never published as a leaderboard name', () => {
  const rooms = sample();
  const predictions = ['student@example.invalid', 'Google Identity', '<img src=x onerror=alert(1)>', '', undefined]
    .map((displayName, index) => ({
      uid: `synthetic-${index}`, displayName, email: 'private@example.invalid',
      roomId: 'A', formatVersion: 2, selectedPlayers: rooms.A.qualifiers
    }));
  const before = structuredClone(predictions);
  const rows = calculateLeaderboard(predictions, rooms);
  assert.deepEqual(rows, predictions.map(prediction => ({
    uid: prediction.uid, displayName: 'Participant', correct: 2, points: 2, pending: 0
  })));
  assert.deepEqual(predictions, before);
});

test('series reject ties, over-target, unfinished, negative, and fractional scores', () => {
  const room = sample().QF1;
  for (const scores of [[7, 7], [8, 1], [6, 5], [-1, 7], [7, 1.5], ['7', 2]]) {
    assert.throws(() => validateSeriesResult('QF1', room, scores));
  }
  assert.throws(() => validateSeriesResult('QF1', { ...room, players: [room.players[0], ''] }, [7, 0]));
});

test('FFA sums all five rounds and does not silently break tied totals', () => {
  const room = sample().PLACEMENT;
  const [a, b, c, d] = room.players;
  const ranked = validateFFAResult(room, Array.from({ length: 5 }, () => [a, b, c, d]));
  assert.deepEqual(ranked.totals, { [a]: 20, [b]: 15, [c]: 10, [d]: 5 });
  assert.deepEqual(ranked.placings, [a, b, c, d]);
  const rounds = [[a,b,c,d], [b,a,c,d], [a,b,c,d], [b,a,c,d], [c,d,a,b]];
  const tied = validateFFAResult(room, rounds);
  assert.equal(tied.totals[a], tied.totals[b] + 1);
  // A three-player cycle yields equal top-three totals after five rounds.
  const tieRounds = [[a,b,c,d], [b,c,a,d], [c,a,b,d], [a,b,c,d], [c,b,a,d]];
  const tie = validateFFAResult(room, tieRounds);
  assert.equal(tie.tied, true);
  assert.deepEqual(tie.placings, []);
  assert.deepEqual(validateFFAResult(room, tieRounds, [a,b,c,d]).placings, [a,b,c,d]);
  assert.throws(() => validateFFAResult(room, tieRounds, [d,a,b,c]));
  assert.throws(() => validateFFAResult(room, [[a,a,c,d], ...tieRounds.slice(1)]));
});

test('stable raw keys, leading-zero IDs and unpickable empty slots', () => {
  const room = { players: [' key ', 'other', '', '', '', '', '', ''], playerDetails: { ' key ': { participantId: 'TEST001', username: ' trimmed ' } } };
  assert.equal(roomReady('A', room), true);
  assert.equal(playerLabel(room, ' key '), 'TEST001 · trimmed');
  assert.deepEqual(validateGroupResult(room, [' key ', 'other']).qualifiers, [' key ', 'other']);
  for (const blank of ['', '   ', 'TBD', ' tbd ']) {
    assert.equal(isPlayer(blank), false);
    assert.throws(() => validateGroupResult(room, [' key ', blank]));
  }
  assert.equal(roomReady('SF1', { players: ['one', 'two'] }), false);
});

test('reopening traverses winner and loser dependencies without unrelated matches', () => {
  assert.deepEqual(dependentRoomIds('SF1'), ['FINAL', 'THIRD']);
  assert.deepEqual(dependentRoomIds('QF1'), ['SF1', 'FINAL', 'THIRD', 'PLACEMENT']);
  assert.deepEqual(dependentRoomIds('B'), ['QF1', 'QF3', 'SF1', 'SF2', 'FINAL', 'THIRD', 'PLACEMENT']);
  assert.deepEqual(dependentRoomIds('PLACEMENT'), []);
});
