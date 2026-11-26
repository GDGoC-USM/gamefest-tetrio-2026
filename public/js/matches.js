import { db, collection, onSnapshot, escapeHTML } from "./shared.js";
import { ROOM_CONFIG, deriveRooms, isPlayer, playerLabel, roomReady } from "./tournament.js";
import { initPublicAuth } from "./auth-ui.js";

initPublicAuth();

const host = document.getElementById("matchList");
let rooms = {};
let derived = {};
let currentFilter = "all";

function currentRoom(config) {
  const stored = rooms[config.id] || {};
  if (config.kind === "group") return stored;
  const expected = derived[config.id] || {};
  const confirmed = roomReady(config.id, stored) &&
    expected.players?.every((key, index) => isPlayer(key) && key === stored.players[index]);
  return {
    ...stored,
    players: expected.players || [],
    playerDetails: { ...stored.playerDetails, ...expected.playerDetails },
    resultsPublished: confirmed && stored.resultsPublished === true,
    status: stored.status === "completed" ? "completed" : confirmed ? stored.status : "upcoming"
  };
}

function statusOf(room) {
  return room.resultsPublished === true || room.status === "completed" ? "completed" : room.status === "live" ? "live" : "upcoming";
}

function resultText(config, room) {
  if (!room.resultsPublished) return room.status === "completed" ? "Ended — results pending" : "Results not yet published";
  if (config.kind === "group") {
    return (room.qualifiers || []).map((key, index) =>
      `${config.id}${index + 1}: ${playerLabel(room, key)}`).join(" · ") || "Qualifiers pending";
  }
  if (config.kind === "series") {
    return isPlayer(room.winner) ? `Winner: ${playerLabel(room, room.winner)}` : "Winner pending";
  }
  return room.tied && !room.placings?.length
    ? "Tied totals — organiser decision pending"
    : "Official 5th–8th placings";
}

function card(config, bracket = false) {
  const room = currentRoom(config);
  const status = statusOf(room);
  const filtered = currentFilter !== "all" && status !== currentFilter;
  const players = Array.from({ length: config.size }, (_, index) => room.players?.[index] || "");
  return `<article class="match-card tournament-card ${bracket ? "bracket-card" : ""} ${filtered ? "filter-muted" : ""}"
      id="room-${config.id}" aria-label="${escapeHTML(config.name)}">
    <div class="match-card-top">
      <span class="match-number">${escapeHTML(config.id)}</span>
      <span class="match-status status-${status}">${status === "completed" ? "ENDED" : status.toUpperCase()}</span>
    </div>
    <h3>${escapeHTML(config.name)}</h3>
    <p class="series-target">${config.kind === "series" ? `First to ${config.target} wins` : "8 slots · 2 ordered qualifiers"}</p>
    <div class="tournament-players">${players.map((key, index) => `
      <div class="tournament-player ${room.resultsPublished && room.winner === key ? "is-winner" : ""}">
        <span class="slot-label">${config.kind === "group" ? `Slot ${index + 1}` : escapeHTML(config.feeders?.[index] || "TBD")}</span>
        <strong>${escapeHTML(playerLabel(room, key))}</strong>
        ${config.kind === "series" ? `<b class="series-score">${room.resultsPublished && Number.isInteger(room.scores?.[index]) ? room.scores[index] : "—"}</b>` : ""}
      </div>`).join("")}</div>
    <p class="tournament-result">${escapeHTML(resultText(config, room))}</p>
  </article>`;
}

function placementTable(config) {
  const room = currentRoom(config);
  const published = room.resultsPublished === true;
  const placings = published && Array.isArray(room.placings) ? room.placings : [];
  const players = placings.length ? placings : Array.from({ length: 4 }, (_, index) => room.players?.[index] || "");
  const filtered = currentFilter !== "all" && statusOf(room) !== currentFilter;
  return `<section class="placement-section ${filtered ? "filter-muted" : ""}" id="room-PLACEMENT">
    <div class="match-group-heading"><div><span class="match-group-label">PLACEMENT</span><h3>5TH–8TH PLAYOFF</h3></div>
      <span class="pill status-${statusOf(room)}">${statusOf(room) === "completed" ? "ENDED" : statusOf(room).toUpperCase()}</span></div>
    <p class="muted">Four quarter-final losers · five free-for-all rounds · 4 / 3 / 2 / 1 points per round. No audience predictions.</p>
    <div class="table-wrap"><table class="placement-table">
      <thead><tr><th>Place</th><th>Participant</th>${[1, 2, 3, 4, 5].map(round => `<th>R${round}</th>`).join("")}<th>Total</th></tr></thead>
      <tbody>${players.map((key, index) => {
        const total = published && isPlayer(key) ? room.totals?.[key] : undefined;
        return `<tr><td>${placings.length ? index + 5 : "Pending"}</td>
          <td><strong>${escapeHTML(playerLabel(room, key))}</strong>${!isPlayer(key) ? `<small>${escapeHTML(config.feeders?.[index] || "TBD")}</small>` : ""}</td>
          ${[0, 1, 2, 3, 4].map(round => {
            const finish = published && isPlayer(key) && Array.isArray(room.rounds?.[round]) ? room.rounds[round].indexOf(key) : -1;
            return `<td>${finish >= 0 ? 4 - finish : "—"}</td>`;
          }).join("")}<td><strong>${Number.isFinite(total) ? total : "—"}</strong></td></tr>`;
      }).join("")}</tbody>
    </table></div>
    <p class="tournament-result" role="status">${escapeHTML(resultText(config, room))}</p>
  </section>`;
}

function renderRooms() {
  const configurations = ROOM_CONFIG;
  const counts = { live: 0, upcoming: 0, completed: 0 };
  configurations.forEach(config => counts[statusOf(currentRoom(config))]++);
  document.getElementById("totalMatches").textContent = configurations.length;
  document.getElementById("liveMatches").textContent = counts.live;
  document.getElementById("upcomingMatches").textContent = counts.upcoming;
  document.getElementById("completedMatches").textContent = counts.completed;
  const find = id => configurations.find(config => config.id === id);
  const groups = configurations.filter(config => config.kind === "group" &&
    (currentFilter === "all" || statusOf(currentRoom(config)) === currentFilter));
  host.innerHTML = `
    <section class="match-group"><div class="match-group-heading"><div>
      <span class="match-group-label">GROUP STAGE</span><h3>32 PLAYERS. EIGHT QUALIFIERS.</h3>
    </div></div><p class="muted">Slots are roster positions, not standings. Only published A1–D2 qualifiers determine the bracket.</p>
      <div class="match-grid">${groups.map(config => card(config)).join("") || '<p class="muted">No groups match this filter.</p>'}</div>
    </section>
    <section class="match-group"><div class="match-group-heading"><div>
      <span class="match-group-label">KNOCKOUT BRACKET</span><h3>THE ROAD TO THE TITLE</h3>
    </div></div><p class="muted">Follow each connecting line to the next series. ${currentFilter !== "all" ? "Other statuses are dimmed to preserve the bracket." : "Seeds and feeder labels remain visible until players are confirmed."}</p>
      <div class="knockout-bracket" aria-label="Quarter-finals feed semi-finals, then the grand final">
        <section class="bracket-round round-quarterfinal"><h4>QUARTER-FINALS <span>First to 7</span></h4>
          <div class="bracket-matches">${["QF1", "QF2", "QF3", "QF4"].map(id => card(find(id), true)).join("")}</div></section>
        <section class="bracket-round round-semifinal"><h4>SEMI-FINALS <span>First to 9</span></h4>
          <div class="bracket-matches">${["SF1", "SF2"].map(id => card(find(id), true)).join("")}</div></section>
        <section class="bracket-round round-final"><h4>GRAND FINAL <span>First to 11</span></h4>
          <div class="bracket-matches">${card(find("FINAL"), true)}</div></section>
      </div>
      <section class="third-place-section"><div><span class="match-group-label">A SEPARATE DECIDER</span><h3>THIRD PLACE</h3>
        <p class="muted">The two semi-final losers play for third. First to 9 wins.</p></div>${card(find("THIRD"))}</section>
    </section>
    ${placementTable(find("PLACEMENT"))}`;
}

document.querySelectorAll(".match-filter").forEach(button => {
  button.addEventListener("click", () => {
    currentFilter = button.dataset.filter;
    document.querySelectorAll(".match-filter").forEach(item => {
      item.classList.toggle("active", item === button);
      item.setAttribute("aria-pressed", String(item === button));
    });
    renderRooms();
  });
});

onSnapshot(collection(db, "rooms"), snapshot => {
  rooms = Object.fromEntries(snapshot.docs.map(document => [document.id, document.data()]));
  derived = deriveRooms(rooms);
  renderRooms();
}, error => {
  console.error("Unable to load rooms:", error);
  host.innerHTML = '<div class="notice error">Unable to load tournament rooms. Refresh to try again.</div>';
});