import { ROOM_CONFIG, dependentRoomIds, isPlayer } from "./tournament.js";

const groups = ROOM_CONFIG.filter(config => config.kind === "group");
const normalized = value => String(value || "").trim().toLowerCase();

export function parseRosterCSV(text) {
  const records = [];
  let row = [], field = "", quoted = false, closed = false;
  const endField = () => {
    row.push(field.trim());
    field = "";
    closed = false;
  };
  const endRow = () => {
    endField();
    if (row.some(value => value !== "")) records.push(row);
    row = [];
  };
  text = text.replace(/^\uFEFF/, "");
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char !== '"') field += char;
      else if (text[index + 1] === '"') { field += '"'; index++; }
      else { quoted = false; closed = true; }
    } else if (char === ",") endField();
    else if (char === "\n" || char === "\r") {
      endRow();
      if (char === "\r" && text[index + 1] === "\n") index++;
    } else if (closed) {
      if (!/\s/.test(char)) throw new Error("Invalid CSV: unexpected text after a closing quote.");
    } else if (char === '"') {
      if (field.trim()) throw new Error("Invalid CSV: quotes must surround the entire field.");
      field = "";
      quoted = true;
    } else field += char;
  }
  if (quoted) throw new Error("Invalid CSV: a quoted field was not closed.");
  endRow();
  const header = records.shift();
  if (header?.length !== 3 || header.join(",") !== "room,participantId,username") {
    throw new Error("CSV header must be room,participantId,username (in that order).");
  }
  if (!records.length) throw new Error("The CSV has no participants.");
  const ids = new Set(), usernames = new Set(), counts = new Map();
  return records.map((values, index) => {
    const [room, participantId, username] = values;
    const prefix = `CSV record ${index + 2}`;
    if (values.length !== 3 || values.some(value => !value)) {
      throw new Error(`${prefix}: enter a room, Participant ID and username.`);
    }
    const config = groups.find(config => config.id === room);
    if (!config) throw new Error(`${prefix}: room must be A, B, C or D.`);
    if (!isPlayer(username)) throw new Error(`${prefix}: TBD is reserved for empty slots.`);
    if (ids.has(normalized(participantId))) throw new Error(`${prefix}: duplicate Participant ID ${participantId}.`);
    if (usernames.has(normalized(username))) throw new Error(`${prefix}: duplicate username ${username}.`);
    ids.add(normalized(participantId));
    usernames.add(normalized(username));
    const count = (counts.get(room) || 0) + 1;
    counts.set(room, count);
    if (count > config.size) throw new Error(`Group ${room} has more than ${config.size} participants.`);
    return { room, participantId, username };
  });
}

// Resolve identities before changing rosters: saved predictions refer to immutable keys.
export function prepareRosterImport(entries, rooms) {
  const existing = [];
  for (const config of groups) {
    const room = rooms[config.id];
    for (const key of room?.players || []) {
      if (!isPlayer(key)) continue;
      const detail = Object.hasOwn(room.playerDetails || {}, key) ? room.playerDetails[key] : {};
      existing.push({ room: config.id, key, participantId: detail.participantId || "", username: detail.username || key });
    }
  }
  const rosters = Object.create(null);
  for (const entry of entries) {
    const { room, participantId, username } = entry;
    if (!rooms[room]) throw new Error("Initialize the tournament before importing a roster.");
    let matches = existing.filter(person => normalized(person.participantId) === normalized(participantId));
    if (!matches.length) matches = existing.filter(person => person.room === room &&
      (normalized(person.username) === normalized(username) || normalized(person.key) === normalized(username)));
    if (matches.length > 1) throw new Error(`Participant ${participantId} matches multiple existing players. Fix their IDs before importing.`);
    const match = matches[0];
    if (match && match.room !== room) {
      throw new Error(`Participant ${participantId} already belongs to group ${match.room}. Clear the old slot before moving them.`);
    }
    if (match?.participantId && normalized(match.participantId) !== normalized(participantId)) {
      throw new Error(`Username ${username} belongs to another Participant ID. Clear the old slot before replacing them.`);
    }
    const key = match?.key || username;
    const roster = rosters[room] ||= { players: [], playerDetails: Object.create(null) };
    roster.players.push(key);
    roster.playerDetails[key] = { participantId, username };
  }
  const changedRoomIds = [];
  for (const [id, roster] of Object.entries(rosters)) {
    const config = groups.find(config => config.id === id);
    while (roster.players.length < config.size) roster.players.push("");
    const previous = rooms[id];
    const unchanged = Array.isArray(previous.players) && previous.players.length === roster.players.length &&
      roster.players.every((key, index) => key === previous.players[index]) &&
      Object.keys(previous.playerDetails || {}).length === Object.keys(roster.playerDetails).length &&
      Object.entries(roster.playerDetails).every(([key, detail]) =>
        previous.playerDetails?.[key]?.participantId === detail.participantId &&
        previous.playerDetails?.[key]?.username === detail.username);
    if (unchanged) continue;
    if (previous.resultsPublished === true || previous.status === "completed") {
      throw new Error(`Group ${id} has published results. Reopen it explicitly before changing its roster.`);
    }
    changedRoomIds.push(id);
  }
  const ids = new Set(), usernames = new Set(), keys = new Set();
  for (const config of groups) {
    const roster = rosters[config.id] || rooms[config.id];
    for (const key of roster?.players || []) {
      if (!isPlayer(key)) continue;
      const detail = Object.hasOwn(roster.playerDetails || {}, key) ? roster.playerDetails[key] : {};
      const id = normalized(detail.participantId), username = normalized(detail.username || key);
      if ((id && ids.has(id)) || usernames.has(username) || keys.has(key)) {
        throw new Error(`Group ${config.id}: a participant appears more than once across the final group rosters.`);
      }
      if (id) ids.add(id);
      usernames.add(username);
      keys.add(key);
    }
  }
  const resetIds = new Set(changedRoomIds.flatMap(dependentRoomIds));
  return { rosters, changedRoomIds, resetRoomIds: ROOM_CONFIG.filter(config => resetIds.has(config.id)).map(config => config.id) };
}
