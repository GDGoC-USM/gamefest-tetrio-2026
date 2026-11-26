import {
  db,
  collection, doc, onSnapshot, escapeHTML
} from "./shared.js";
import { ROOM_CONFIG, STAGES, deriveRooms, isPlayer, playerLabel, roomReady } from "./tournament.js";
import { initPublicAuth } from "./auth-ui.js";

const grid = document.getElementById("roomGrid");
const availability = {};

initPublicAuth();

STAGES.forEach(stage => {
  onSnapshot(doc(db, "settings", `rounds_${stage.id}`), snapshot => {
    availability[stage.id] = snapshot.exists() && snapshot.data().predictionsOpen === true;
    const open = STAGES.filter(item => availability[item.id]).map(item => item.name);
    document.getElementById("predictionStatus").textContent = open.length
      ? `${open.join(" / ")} PREDICTIONS OPEN`
      : "PREDICTIONS CLOSED";
  }, () => {
    availability[stage.id] = false;
    document.getElementById("predictionStatus").textContent = "PREDICTION STATUS UNAVAILABLE";
  });
});

onSnapshot(collection(db, "rooms"), snapshot => {
  const rooms = Object.fromEntries(snapshot.docs.map(document => [document.id, document.data()]));
  const derived = deriveRooms(rooms);
  grid.innerHTML = ROOM_CONFIG.map(config => {
    const stored = rooms[config.id] || {};
    const expected = config.kind === "group" ? stored : derived[config.id] || {};
    const room = { ...stored, ...expected, playerDetails: { ...stored.playerDetails, ...expected.playerDetails } };
    const confirmed = config.kind === "group" || (roomReady(config.id, stored) &&
      expected.players?.every((key, index) => isPlayer(key) && key === stored.players[index]));
    const published = confirmed && stored.resultsPublished === true;
    const status = stored.status === "completed" || published ? "completed"
      : confirmed && stored.status === "live" ? "live" : "upcoming";
    const players = Array.from({ length: config.size }, (_, index) => room.players?.[index] || "");
    return `<article class="card home-room-card">
      <span class="room-tag">${escapeHTML(config.id)}</span>
      <span class="match-status status-${status}">${status === "completed" ? "ENDED" : status.toUpperCase()}</span>
      <h3>${escapeHTML(config.name)}</h3>
      <p class="muted">${players.filter(isPlayer).length} / ${config.size} confirmed players
        · ${config.kind === "group" ? "Top 2 advance" : config.kind === "series" ? `First to ${config.target}` : "Five rounds · places 5–8"}</p>
      <ul class="home-player-list">${players.map((key, index) => `<li>
        ${escapeHTML(playerLabel(room, key))}${!isPlayer(key) && config.feeders?.[index] ? `<small>${escapeHTML(config.feeders[index])}</small>` : ""}
      </li>`).join("")}</ul>
      ${status === "completed" && !published ? '<p class="muted">Ended — results pending</p>' : ""}
      <a class="room-details-link" href="matches.html#room-${config.id}">View ${escapeHTML(config.id)} results →</a>
    </article>`;
  }).join("");
}, error => {
  grid.innerHTML = `<div class="notice error">Unable to load rooms: ${escapeHTML(error.message)}</div>`;
});
