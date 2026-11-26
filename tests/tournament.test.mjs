import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { ROOM_CONFIG, deriveRooms, dependentRoomIds, publishedDependentIds, dependentResets, withoutResults, validateGroupResult, validateSeriesResult, validateFFAResult, calculateLeaderboard, scorePrediction, roomReady, playerLabel, isPlayer } from '../public/js/tournament.js';

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

test('points and Lucky Draw entries are absolute 2, 2, then 1 after one correction', () => {
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

test('published downstream rooms block reopening and are listed deepest first', () => {
  const rooms = sample();
  assert.deepEqual(publishedDependentIds('PLACEMENT', rooms), []);
  assert.deepEqual(publishedDependentIds('A', rooms),
    ['THIRD', 'FINAL', 'SF2', 'SF1', 'QF3', 'QF1']);
  // Only published (or legacy completed) downstream rooms block; unrelated rooms never do.
  for (const id of ['QF1', 'QF3', 'SF1', 'SF2', 'FINAL', 'THIRD', 'PLACEMENT']) {
    rooms[id] = { ...rooms[id], resultsPublished: false, status: 'upcoming' };
  }
  assert.deepEqual(publishedDependentIds('A', rooms), []);
  rooms.QF1 = { ...rooms.QF1, status: 'completed' };
  rooms.PLACEMENT = { ...rooms.PLACEMENT, resultsPublished: true };
  assert.deepEqual(publishedDependentIds('A', rooms), ['PLACEMENT', 'QF1']);
  assert.deepEqual(publishedDependentIds('C', rooms), ['PLACEMENT', 'QF4', 'QF2']);
});

test('resets follow changed feeder players, preserving unchanged results and picks', () => {
  const rooms = sample();
  assert.deepEqual(dependentResets(rooms, {}), []);
  // Identical republish and a correction that keeps the same winner change no progression.
  assert.deepEqual(dependentResets(rooms, { QF1: { ...rooms.QF1 } }), []);
  assert.deepEqual(dependentResets(rooms, { QF1: { ...rooms.QF1, scores: [7, 2] } }), []);
  assert.deepEqual(dependentResets(rooms, { PLACEMENT: { ...rooms.PLACEMENT, resultsPublished: true } }), []);
  // Flipping the winner changes SF1, then FINAL/THIRD, and PLACEMENT via the loser.
  const flipped = { ...rooms.QF1, scores: [2, 7], winner: rooms.QF1.loser, loser: rooms.QF1.winner };
  assert.deepEqual(dependentResets(rooms, { QF1: flipped }), ['SF1', 'FINAL', 'THIRD', 'PLACEMENT']);
  // Reopening a group clears its seeds, so its whole subtree changes.
  assert.deepEqual(dependentResets(rooms, { A: withoutResults(rooms.A) }),
    ['QF1', 'QF3', 'SF1', 'SF2', 'FINAL', 'THIRD', 'PLACEMENT']);
  const reopened = withoutResults(rooms.A);
  assert.equal(reopened.status, 'upcoming');
  assert.equal(reopened.resultsPublished, false);
  assert.deepEqual(reopened.players, rooms.A.players);
  assert.equal(reopened.qualifiers, undefined);
});

test('ended groups keep picks pending and advance nobody until results are published', () => {
  const rooms = sample();
  rooms.A.resultsPublished = false;
  rooms.A.predictionsLocked = true;
  const before = structuredClone(rooms);
  const prediction = { uid: 'viewer', roomId: 'A', formatVersion: 2, selectedPlayers: rooms.A.qualifiers };
  assert.equal(rooms.A.status, 'completed');
  assert.deepEqual(scorePrediction(prediction, rooms), { correct: 0, pending: 2 });
  assert.deepEqual(calculateLeaderboard([prediction], rooms)[0],
    { uid: 'viewer', displayName: 'Participant', correct: 0, points: 0, pending: 2 });
  const derived = deriveRooms(rooms);
  assert.deepEqual(derived.QF1.players, ['', rooms.B.qualifiers[1]]);
  assert.deepEqual(derived.QF3.players, [rooms.B.qualifiers[0], '']);
  assert.deepEqual(derived.QF2.players, before.QF2.players);
  assert.deepEqual(rooms, before);
  Object.assign(rooms.A, validateGroupResult(rooms.A, rooms.A.qualifiers));
  assert.equal(rooms.A.predictionsLocked, true);
  assert.deepEqual(scorePrediction(prediction, rooms), { correct: 2, pending: 0 });
  assert.deepEqual(deriveRooms(rooms).QF1.players, before.QF1.players);
});

test('ended series do not feed winners or losers, or score current and legacy picks, before publication', () => {
  const rooms = sample();
  rooms.QF1.resultsPublished = false;
  const current = { uid: 'viewer', roomId: 'QF1', formatVersion: 2, selectedPlayers: [rooms.QF1.winner] };
  const legacy = { uid: 'legacy', matchId: 'QF1', pick: rooms.QF1.winner };
  for (const prediction of [current, legacy]) {
    assert.deepEqual(scorePrediction(prediction, rooms), { correct: 0, pending: 1 });
  }
  const derived = deriveRooms(rooms);
  assert.deepEqual(derived.SF1.players, ['', rooms.QF2.winner]);
  assert.deepEqual(derived.PLACEMENT.players, ['', rooms.QF2.loser, rooms.QF3.loser, rooms.QF4.loser]);
  assert.deepEqual(derived.SF2.players, rooms.SF2.players);
  Object.assign(rooms.QF1, validateSeriesResult('QF1', rooms.QF1, rooms.QF1.scores));
  assert.deepEqual(scorePrediction(current, rooms), { correct: 1, pending: 0 });
  assert.deepEqual(deriveRooms(rooms).SF1.players, rooms.SF1.players);
});

test('admin status saves remain separate from publishing and reopening official results', async () => {
  const source = await readFile(new URL('../public/js/admin.js', import.meta.url), 'utf8');
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      value: '', hidden: false, disabled: false, checked: false, innerHTML: '', textContent: '',
      listeners: {}, addEventListener(type, handler) { this.listeners[type] = handler; },
      querySelectorAll() { return []; }, setAttribute() {}, removeAttribute() {}
    });
    return elements.get(id);
  };
  const writes = [];
  const errors = [];
  let recalculations = 0;
  const context = {
    ROOM_CONFIG, STAGES: [], isPlayer, playerLabel, roomReady, validateGroupResult,
    validateSeriesResult, validateFFAResult, deriveRooms, dependentRoomIds, calculateLeaderboard,
    publishedDependentIds, dependentResets, withoutResults,
    document: { getElementById: element, querySelectorAll() { return []; } },
    auth: {}, onAuthStateChanged() {}, escapeHTML: value => String(value),
    showMessage() {}, confirm: () => true, serverTimestamp: () => 'server-time',
    console: { error: error => errors.push(error.message) },
    recordWrite(sources, resetIds) {
      writes.push({ sources: [...sources].map(([id, room]) => [id, structuredClone(room)]), resetIds: [...resetIds] });
    },
    recordRecalculation() { recalculations++; }
  };
  // Run the actual page handlers without Firebase imports or a browser/network dependency.
  runInNewContext(source.replace(/^import[\s\S]*?from "[^"]+";\r?\n/gm, '') + `
    authorized = true;
    freshEditor = async () => editorRoom;
    readRoster = () => ({ players: editorRoom.players, playerDetails: editorRoom.playerDetails || {} });
    writeRoomChanges = async (sources, resetIds) => {
      recordWrite(sources, resetIds);
      sources.forEach((room, id) => { roomsCache[id] = room; });
      return 0;
    };
    recalculateLeaderboard = async () => { recordRecalculation(); };
    refreshAfterWrite = async (id, recalculate = true) => {
      loadRoomEditor(id);
      if (recalculate) await recalculateLeaderboard();
    };
    globalThis.openTestRoom = room => {
      roomsCache = Object.fromEntries(ROOM_CONFIG.map(config => [config.id, baseRoom(config)]));
      roomsCache.A = room;
      loadRoomEditor("A");
    };
  `, context);
  const original = sample().A;
  context.openTestRoom({ ...original, status: 'upcoming', resultsPublished: false, predictionsLocked: true });
  element('roomStatus').value = 'completed';
  assert.equal(writes.length, 0, 'Selecting a status alone must not persist');
  await element('saveRoomBtn').listeners.click();
  assert.deepEqual(errors, []);
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].resetIds, []);
  assert.equal(writes[0].sources[0][1].status, 'completed');
  assert.equal(writes[0].sources[0][1].resultsPublished, false);
  assert.equal(writes[0].sources[0][1].predictionsLocked, true);
  assert.equal(recalculations, 0);
  assert.equal(element('roomStatus').value, 'completed');
  assert.equal(element('roomStatus').disabled, false);
  assert.equal(element('saveRoomBtn').disabled, false);
  assert.equal(element('unpublishRoomBtn').hidden, true);
  assert.equal(element('publishRoomBtn').textContent, 'Publish Results');
  element('roomStatus').value = 'upcoming';
  await element('saveRoomBtn').listeners.click();
  assert.equal(writes[1].sources[0][1].status, 'upcoming');
  assert.deepEqual(writes[1].resetIds, []);
  assert.equal(recalculations, 0);
  element('roomStatus').value = 'completed';
  await element('saveRoomBtn').listeners.click();
  element('qualifier1').value = '4';
  element('qualifier2').value = '1';
  await element('publishRoomBtn').listeners.click();
  assert.deepEqual(errors, []);
  assert.equal(writes[3].sources[0][1].resultsPublished, true);
  assert.equal(writes[3].sources[0][1].status, 'completed');
  // Targeted resets: only feeders whose players actually change (QF1/QF3 scaffold slots).
  assert.deepEqual(writes[3].resetIds, ['QF1', 'QF3']);
  assert.equal(recalculations, 1);
  assert.equal(element('saveRoomBtn').disabled, true);
  assert.equal(element('roomStatus').disabled, true);
  assert.equal(element('unpublishRoomBtn').hidden, false);
  await element('saveRoomBtn').listeners.click();
  assert.equal(writes.length, 4, 'Published rooms reject even a direct save-handler call');
  assert.match(errors.pop(), /Reopen this room explicitly/);
  await element('unpublishRoomBtn').listeners.click();
  assert.deepEqual(errors, []);
  assert.equal(writes[4].sources[0][1].status, 'upcoming');
  assert.equal(writes[4].sources[0][1].resultsPublished, false);
  assert.equal(writes[4].sources[0][1].predictionsLocked, true);
  assert.equal('qualifiers' in writes[4].sources[0][1], false);
  // Reopening clears A's qualifiers; downstream scaffolds here were already empty, so nothing changes.
  assert.deepEqual(writes[4].resetIds, []);
  assert.equal(recalculations, 2);
  assert.equal(element('unpublishRoomBtn').hidden, true);
});

test('public room boards preserve Ended and pending results when derived feeders are not ready', async () => {
  const rooms = sample();
  rooms.A.resultsPublished = false;
  rooms.B.resultsPublished = false;
  rooms.B.status = 'live';
  rooms.QF1.resultsPublished = false;
  rooms.PLACEMENT.status = 'completed';
  const snapshot = { docs: Object.entries(rooms).map(([id, room]) => ({ id, data: () => room })) };
  for (const page of ['matches', 'home']) {
    const source = await readFile(new URL(`../public/js/${page}.js`, import.meta.url), 'utf8');
    const elements = new Map();
    const element = id => {
      if (!elements.has(id)) elements.set(id, { innerHTML: '', textContent: '', addEventListener() {} });
      return elements.get(id);
    };
    let roomListener;
    const context = {
      ROOM_CONFIG, STAGES: [], deriveRooms, isPlayer, playerLabel, roomReady,
      document: { getElementById: element, querySelectorAll() { return []; } },
      db: {}, initPublicAuth() {}, collection: () => 'rooms',
      onSnapshot(_reference, listener) { roomListener = listener; },
      escapeHTML: value => String(value), console
    };
    runInNewContext(source.replace(/^import[\s\S]*?from "[^"]+";\r?\n/gm, ''), context);
    roomListener(snapshot);
    const html = element(page === 'matches' ? 'matchList' : 'roomGrid').innerHTML;
    for (const name of ['Group A', 'Quarter-final 1']) {
      const card = html.match(/<article\b[\s\S]*?<\/article>/g).find(value => value.includes(`<h3>${name}</h3>`));
      assert.match(card, /status-completed">ENDED</, `${page}: ${name} has an Ended badge`);
      assert.match(card, /Ended — results pending/, `${page}: ${name} keeps its results pending`);
      assert.doesNotMatch(card, /status-(?:live|upcoming)"/);
    }
    assert.match(html, /<h3>Group B<\/h3>/);
    if (page === 'matches') {
      assert.equal(element('liveMatches').textContent, 1);
      assert.equal(element('upcomingMatches').textContent, 0);
      assert.equal(element('completedMatches').textContent, ROOM_CONFIG.length - 1);
      assert.match(html, /id="room-PLACEMENT"[\s\S]*?status-completed">ENDED</);
    }
  }
});
