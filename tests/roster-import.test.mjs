import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRosterCSV, prepareRosterImport } from '../public/js/roster-import.js';
import { ROOM_CONFIG, deriveRooms } from '../public/js/tournament.js';

const header = 'room,participantId,username\n';
const parse = rows => parseRosterCSV(header + rows);
function emptyRooms() {
  const rooms = Object.fromEntries(ROOM_CONFIG.filter(config => config.kind === 'group').map(config => [config.id, {
    players: Array(8).fill(''), playerDetails: {}, status: 'upcoming', resultsPublished: false, formatVersion: 2
  }]));
  return { ...rooms, ...deriveRooms(rooms) };
}
function putPlayer(rooms, room, key, participantId, username) {
  rooms[room].players[0] = key;
  rooms[room].playerDetails[key] = { participantId, username };
}

test('CSV exports preserve leading zeros, quoted commas, escaped quotes and CRLF records', () => {
  const rows = parseRosterCSV('\uFEFFroom,participantId,username\r\n A , 0001 , "Example, One"\r\nB,0002,"Example ""Two"""\r\n\r\n');
  assert.deepEqual(rows, [
    { room: 'A', participantId: '0001', username: 'Example, One' },
    { room: 'B', participantId: '0002', username: 'Example "Two"' }
  ]);
  assert.equal(parse('A,0003,"Line\nbreak"')[0].username, 'Line\nbreak');
});

test('invalid headers, missing fields, invalid groups and broken quoting cannot import', () => {
  for (const input of [
    '', 'username,participantId,room\nExample,1,A', header,
    '"room,participantId,username"\nA,001,Example',
    header + 'A,001,', header + 'A,,Example', header + 'A,001,Example,extra',
    header + 'SF1,001,Example', header + 'A,001,TBD',
    header + 'A,001,"Unclosed', header + 'A,001,un"quoted', header + 'A,001,"Quoted"tail'
  ]) assert.throws(() => parseRosterCSV(input), /CSV|participants|username|room|TBD/);
});

test('duplicate IDs and usernames are rejected case-insensitively across groups', () => {
  assert.throws(() => parse('A,TEST001,ExampleOne\nB,test001,ExampleTwo'), /duplicate Participant ID/);
  assert.throws(() => parse('A,TEST001,ExampleOne\nB,TEST002,exampleone'), /duplicate username/);
  assert.throws(() => parse(Array.from({ length: 9 }, (_, index) => `A,TEST${index},Example${index}`).join('\n')), /more than 8/);
});

test('29-player imports keep file order and blank spare slots without touching omitted groups', () => {
  const rows = ['A', 'B', 'C', 'D'].flatMap((room, groupIndex) =>
    Array.from({ length: groupIndex ? 7 : 8 }, (_, index) => `${room},TEST${room}${index},Example${room}${index}`));
  const rooms = emptyRooms();
  const original = structuredClone(rooms);
  const plan = prepareRosterImport(parse(rows.join('\n')), rooms);
  assert.deepEqual(plan.rosters.A.players, Array.from({ length: 8 }, (_, index) => `ExampleA${index}`));
  for (const id of ['B', 'C', 'D']) {
    assert.deepEqual(plan.rosters[id].players, [...Array.from({ length: 7 }, (_, index) => `Example${id}${index}`), '']);
    assert.equal(Object.keys(plan.rosters[id].playerDetails).length, 7);
  }
  assert.deepEqual(rooms, original);
  const partial = prepareRosterImport(parse('A,0001,ExampleOne'), rooms);
  assert.deepEqual(Object.keys(partial.rosters), ['A']);
  assert.deepEqual(partial.resetRoomIds, ['QF1', 'QF3', 'SF1', 'SF2', 'FINAL', 'THIRD', 'PLACEMENT']);
});

test('matching IDs retain raw keys on rename and legacy names can gain an ID', () => {
  const rooms = emptyRooms();
  putPlayer(rooms, 'A', ' immutable-key ', '0001', 'OldExample');
  putPlayer(rooms, 'B', ' LegacyExample ', '', 'LegacyExample');
  const plan = prepareRosterImport(parse('A,0001,RenamedExample\nB,0002,LegacyExample'), rooms);
  assert.equal(plan.rosters.A.players[0], ' immutable-key ');
  assert.deepEqual(plan.rosters.A.playerDetails[' immutable-key '], { participantId: '0001', username: 'RenamedExample' });
  assert.equal(plan.rosters.B.players[0], ' LegacyExample ');
  assert.equal(plan.rosters.B.playerDetails[' LegacyExample '].participantId, '0002');
  const feed = deriveRooms({ ...rooms, A: { ...rooms.A, ...plan.rosters.A } });
  assert.deepEqual(feed.QF1.players, ['', '']);
});

test('published rosters reject changes, while identical reimports leave results intact', () => {
  const rooms = emptyRooms();
  putPlayer(rooms, 'A', 'StableExample', '0001', 'ExampleOne');
  rooms.A.resultsPublished = true;
  rooms.A.status = 'completed';
  assert.throws(() => prepareRosterImport(parse('A,0001,NewExample'), rooms), /Reopen it explicitly/);
  const plan = prepareRosterImport(parse('A,0001,ExampleOne'), rooms);
  assert.deepEqual(plan.changedRoomIds, []);
  assert.deepEqual(plan.resetRoomIds, []);
  assert.equal(rooms.A.resultsPublished, true);
});

test('ended unpublished groups accept roster corrections without publishing or reopening', () => {
  const rooms = emptyRooms();
  putPlayer(rooms, 'A', 'StableExample', '0001', 'ExampleOne');
  rooms.A.status = 'completed';
  const original = structuredClone(rooms);
  const plan = prepareRosterImport(parse('A,0001,CorrectedExample'), rooms);
  assert.deepEqual(plan.changedRoomIds, ['A']);
  assert.equal(plan.rosters.A.players[0], 'StableExample');
  assert.equal(plan.rosters.A.playerDetails.StableExample.username, 'CorrectedExample');
  assert.deepEqual(rooms, original);
});

test('existing identity conflicts cannot be hidden by partial imports or reassignment', () => {
  const rooms = emptyRooms();
  putPlayer(rooms, 'B', 'ExistingExample', '0001', 'ExampleOne');
  assert.throws(() => prepareRosterImport(parse('A,0001,ExampleOne'), rooms), /already belongs to group B/);
  assert.throws(() => prepareRosterImport(parse('A,0002,exampleone'), rooms), /more than once/);
  assert.throws(() => prepareRosterImport(parse('B,0002,ExampleOne'), rooms), /another Participant ID/);
  assert.throws(() => prepareRosterImport(parse('A,0003,ExampleThree'), {}), /Initialize/);
});
