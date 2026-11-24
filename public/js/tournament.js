// Player strings are immutable storage keys. Display metadata never changes a pick.
export const ROOM_CONFIG = [
  ...["A", "B", "C", "D"].map(id => ({ id, name: `Group ${id}`, stage: "preliminary", size: 8, kind: "group" })),
  { id: "QF1", name: "Quarter-final 1", stage: "quarterfinal", size: 2, kind: "series", target: 7, feeders: ["A1", "B2"] },
  { id: "QF2", name: "Quarter-final 2", stage: "quarterfinal", size: 2, kind: "series", target: 7, feeders: ["C1", "D2"] },
  { id: "QF3", name: "Quarter-final 3", stage: "quarterfinal", size: 2, kind: "series", target: 7, feeders: ["B1", "A2"] },
  { id: "QF4", name: "Quarter-final 4", stage: "quarterfinal", size: 2, kind: "series", target: 7, feeders: ["D1", "C2"] },
  { id: "SF1", name: "Semi-final 1", stage: "semifinal", size: 2, kind: "series", target: 9, feeders: ["Winner of QF1", "Winner of QF2"] },
  { id: "SF2", name: "Semi-final 2", stage: "semifinal", size: 2, kind: "series", target: 9, feeders: ["Winner of QF3", "Winner of QF4"] },
  { id: "FINAL", name: "Grand Final", stage: "final", size: 2, kind: "series", target: 11, feeders: ["Winner of SF1", "Winner of SF2"] },
  { id: "THIRD", name: "3rd/4th Place", stage: "final", size: 2, kind: "series", target: 9, feeders: ["Loser of SF1", "Loser of SF2"] },
  { id: "PLACEMENT", name: "5th–8th Battle", stage: "placement", size: 4, kind: "ffa", feeders: ["Loser of QF1", "Loser of QF2", "Loser of QF3", "Loser of QF4"] }
];
export const STAGES = [
  { id: "preliminary", name: "Group stage" },
  { id: "quarterfinal", name: "Quarter-finals" },
  { id: "semifinal", name: "Semi-finals" },
  { id: "final", name: "Final and 3rd/4th" }
];
const configOf = id => ROOM_CONFIG.find(config => config.id === id);
export const isPlayer = key => typeof key === "string" && key.trim() !== "" && key.trim().toUpperCase() !== "TBD";
export function playerLabel(room, key) {
  if (!isPlayer(key)) return "TBD";
  const detail = room?.playerDetails?.[key];
  return `${String(detail?.participantId || "ID pending").trim()} · ${String(detail?.username || key).trim()}`;
}
export function roomReady(id, room) {
  const config = configOf(id);
  if (!config || !Array.isArray(room?.players) || room.players.length !== config.size) return false;
  const players = room.players.filter(isPlayer);
  if (new Set(players).size !== players.length) return false;
  return config.kind === "group" ? players.length >= 2 : room.formatVersion === 2 && players.length === config.size;
}
function requireMembers(room, keys, count) {
  if (!Array.isArray(keys) || keys.length !== count || new Set(keys).size !== count ||
      !keys.every(key => isPlayer(key) && room.players.includes(key))) {
    throw new Error(`Select ${count} distinct confirmed players.`);
  }
}
export function validateGroupResult(room, qualifiers) {
  requireMembers(room, qualifiers, 2);
  return { qualifiers: [...qualifiers], resultsPublished: true, status: "completed", formatVersion: 2 };
}
export function validateSeriesResult(id, room, scores) {
  const config = configOf(id);
  if (config?.kind !== "series" || !roomReady(id, room)) throw new Error("Both series players must be confirmed first.");
  if (!Array.isArray(scores) || scores.length !== 2 || !scores.every(score => Number.isInteger(score) && score >= 0) ||
      scores.filter(score => score === config.target).length !== 1 || scores.some(score => score > config.target)) {
    throw new Error(`A finished FT${config.target} series needs one score of ${config.target} and one integer score below ${config.target}.`);
  }
  const winnerIndex = scores[0] === config.target ? 0 : 1;
  return { scores: [...scores], winner: room.players[winnerIndex], loser: room.players[1 - winnerIndex], resultsPublished: true, status: "completed", formatVersion: 2 };
}
export function validateFFAResult(room, rounds, decision = []) {
  if (!roomReady("PLACEMENT", room)) throw new Error("All four quarter-final losers must be confirmed first.");
  if (!Array.isArray(rounds) || rounds.length !== 5) throw new Error("Enter all five FFA rounds.");
  const totals = Object.fromEntries(room.players.map(key => [key, 0]));
  rounds.forEach(order => {
    requireMembers(room, order, 4);
    order.forEach((key, index) => { totals[key] += 4 - index; });
  });
  const sorted = [...room.players].sort((a, b) => totals[b] - totals[a]);
  const tied = new Set(Object.values(totals)).size !== 4;
  let placings = tied ? [] : sorted;
  if (decision.length) {
    requireMembers(room, decision, 4);
    if (decision.some((key, index) => index && totals[decision[index - 1]] < totals[key])) {
      throw new Error("An organiser decision may break ties but cannot reverse unequal point totals.");
    }
    placings = [...decision];
  }
  // Firestore permits arrays inside map fields, not arrays inside arrays.
  return { rounds: Object.fromEntries(rounds.map((order, index) => [index, [...order]])), totals, placings, tied, resultsPublished: true, status: "completed", formatVersion: 2 };
}
function sourceOf(feeder) {
  const seed = /^([A-D])([12])$/.exec(feeder);
  return seed ? { id: seed[1], index: Number(seed[2]) - 1 } : {
    id: feeder.replace(/^(Winner|Loser) of /, ""), field: feeder.startsWith("Winner") ? "winner" : "loser"
  };
}
function confirmedKey(source, room) {
  if (!room?.resultsPublished) return "";
  if (source.index !== undefined) {
    const qualifiers = room.qualifiers;
    if (!Array.isArray(qualifiers) || qualifiers.length !== 2 || new Set(qualifiers).size !== 2 ||
        !qualifiers.every(key => isPlayer(key) && room.players?.includes(key))) return "";
    return qualifiers[source.index];
  }
  if (room.formatVersion !== 2 || !roomReady(source.id, room)) return "";
  try {
    const result = validateSeriesResult(source.id, room, room.scores);
    return result.winner === room.winner && result.loser === room.loser ? result[source.field] : "";
  } catch { return ""; }
}
export function deriveRooms(rooms) {
  const derived = {};
  for (const config of ROOM_CONFIG.filter(config => config.feeders)) {
    const playerDetails = {};
    const players = config.feeders.map(feeder => {
      const source = sourceOf(feeder);
      const upstream = rooms[source.id];
      const key = confirmedKey(source, upstream);
      if (key && upstream.playerDetails?.[key]) playerDetails[key] = { ...upstream.playerDetails[key] };
      return key;
    });
    derived[config.id] = { name: config.name, stage: config.stage, players, playerDetails, feeders: [...config.feeders], formatVersion: 2, status: "upcoming", resultsPublished: false };
  }
  return derived;
}
export function dependentRoomIds(id) {
  const found = new Set();
  const visit = upstream => {
    for (const config of ROOM_CONFIG) {
      if (config.feeders?.some(feeder => sourceOf(feeder).id === upstream) && !found.has(config.id)) {
        found.add(config.id);
        visit(config.id);
      }
    }
  };
  visit(id);
  return ROOM_CONFIG.filter(config => found.has(config.id)).map(config => config.id);
}
function predictedKeys(prediction, config) {
  if (config.kind === "group") return [...new Set((prediction.selectedPlayers || []).filter(isPlayer))].slice(0, 2);
  // Historical final podiums contribute only their champion pick to the new winner result.
  if (config.id === "FINAL" && prediction.formatVersion !== 2 && isPlayer(prediction.champion)) return [prediction.champion];
  if (!prediction.selectedPlayers && isPlayer(prediction.pick)) return [prediction.pick];
  return [...new Set((prediction.selectedPlayers || []).filter(isPlayer))].slice(0, prediction.formatVersion === 2 ? 1 : 2);
}
export function scorePrediction(prediction, rooms) {
  const config = configOf(prediction.roomId || prediction.matchId);
  if (!config || config.kind === "ffa") return { correct: 0, pending: 0 };
  const keys = predictedKeys(prediction, config);
  const room = rooms[config.id];
  if (!room?.resultsPublished || (config.kind === "series" && room.formatVersion !== 2)) return { correct: 0, pending: config.kind === "series" ? Math.min(1, keys.length) : keys.length };
  if (config.kind === "group") {
    try { validateGroupResult(room, room.qualifiers); } catch { return { correct: 0, pending: keys.length }; }
    return { correct: keys.filter(key => room.qualifiers.includes(key)).length, pending: 0 };
  }
  try {
    const result = validateSeriesResult(config.id, room, room.scores);
    if (result.winner !== room.winner || result.loser !== room.loser) return { correct: 0, pending: Math.min(1, keys.length) };
    return { correct: keys.includes(result.winner) ? 1 : 0, pending: 0 };
  } catch { return { correct: 0, pending: Math.min(1, keys.length) }; }
}
function timestamp(value) { return value?.toMillis?.() ?? ((value?.seconds || 0) * 1000) ?? 0; }
export function calculateLeaderboard(predictions, rooms) {
  const latest = new Map();
  for (const prediction of predictions) {
    const id = prediction.roomId || prediction.matchId;
    if (!prediction.uid || !configOf(id) || configOf(id).kind === "ffa") continue;
    const key = `${prediction.uid}/${id}`;
    const previous = latest.get(key);
    if (!previous || (prediction.formatVersion === 2 && previous.formatVersion !== 2) ||
        (prediction.formatVersion === previous.formatVersion && timestamp(prediction.updatedAt) >= timestamp(previous.updatedAt))) latest.set(key, prediction);
  }
  const people = new Map();
  for (const prediction of latest.values()) {
    const person = people.get(prediction.uid) || { uid: prediction.uid, displayName: prediction.displayName || "Player", correct: 0, points: 0, pending: 0 };
    const score = scorePrediction(prediction, rooms);
    person.correct += score.correct;
    person.points = person.correct;
    person.pending += score.pending;
    people.set(person.uid, person);
  }
  return [...people.values()];
}
