import {
  db,
  collection,
  onSnapshot,
  escapeHTML
} from "./shared.js";

const host = document.getElementById("matchList");

const totalEl = document.getElementById("totalMatches");
const liveEl = document.getElementById("liveMatches");
const upcomingEl = document.getElementById("upcomingMatches");
const completedEl = document.getElementById("completedMatches");

const ROOM_ORDER = [
  "A", "B", "C", "D", "SF1", "SF2", "FINAL"
];

const ROOM_META = {
  A: {
    stage: "Preliminary",
    name: "Preliminary Room A",
    size: 8
  },
  B: {
    stage: "Preliminary",
    name: "Preliminary Room B",
    size: 8
  },
  C: {
    stage: "Preliminary",
    name: "Preliminary Room C",
    size: 8
  },
  D: {
    stage: "Preliminary",
    name: "Preliminary Room D",
    size: 8
  },
  SF1: {
    stage: "Semi-final",
    name: "Semi-final SF1",
    size: 4
  },
  SF2: {
    stage: "Semi-final",
    name: "Semi-final SF2",
    size: 4
  },
  FINAL: {
    stage: "Grand Final",
    name: "Grand Final",
    size: 4
  }
};

let rooms = {};
let currentFilter = "all";

// ==========================================
// ROOM STATUS
// ==========================================

function getStatus(room = {}) {
  if (
    room.resultsPublished === true ||
    room.status === "completed"
  ) {
    return "completed";
  }

  if (room.status === "live") {
    return "live";
  }

  return "upcoming";
}

// ==========================================
// ROOM RESULTS
// ==========================================

function getRoomResult(room, roomId) {
  if (!room.resultsPublished) {
    return "RESULTS NOT YET PUBLISHED";
  }

  if (roomId === "FINAL") {
    return `
      CHAMPION: ${escapeHTML(room.champion || "TBC")}
      · RUNNER-UP: ${escapeHTML(room.runnerUp || "TBC")}
    `;
  }

  return `
    OFFICIAL QUALIFIERS:
    ${escapeHTML((room.qualifiers || []).join(" · ") || "TBC")}
  `;
}

// ==========================================
// CREATE ROOM CARD
// ==========================================

function createRoomCard(roomId) {
  const room = rooms[roomId] || {};
  const config = ROOM_META[roomId];

  const status = getStatus(room);

  const players = Array.isArray(room.players)
    ? room.players
    : [];

  return `
    <article class="match-card room-card">

      <div class="match-card-top">
        <span class="match-number">
          ${escapeHTML(config.stage)}
          · ROOM ${escapeHTML(roomId)}
        </span>

        <span class="match-status status-${status}">
          ${status.toUpperCase()}
        </span>
      </div>

      <div class="room-public-players">
        <h3>${escapeHTML(config.name)}</h3>

        ${
          players.length
            ? players.map((player, index) => `
                <div class="room-player">
                  <span>PLAYER ${String(index + 1).padStart(2, "0")}</span>
                  <strong>${escapeHTML(player)}</strong>
                </div>
              `).join("")
            : `
                <p class="muted">
                  Players to be announced.
                </p>
              `
        }
      </div>

      <div class="match-card-bottom">
        <span class="match-result">
          ${getRoomResult(room, roomId)}
        </span>
      </div>

    </article>
  `;
}

// ==========================================
// DISPLAY ROOMS
// ==========================================

function renderRooms() {
  const filteredRoomIds = ROOM_ORDER.filter(roomId => {
    if (currentFilter === "all") {
      return true;
    }

    return getStatus(rooms[roomId] || {}) === currentFilter;
  });

  totalEl.textContent = ROOM_ORDER.length;

  liveEl.textContent = ROOM_ORDER.filter(
    roomId => getStatus(rooms[roomId] || {}) === "live"
  ).length;

  upcomingEl.textContent = ROOM_ORDER.filter(
    roomId => getStatus(rooms[roomId] || {}) === "upcoming"
  ).length;

  completedEl.textContent = ROOM_ORDER.filter(
    roomId => getStatus(rooms[roomId] || {}) === "completed"
  ).length;

  if (!filteredRoomIds.length) {
    host.innerHTML = `
      <div class="matches-empty-state">
        <h3>NO ROOMS FOUND</h3>
        <p>No rooms match this status filter.</p>
      </div>
    `;
    return;
  }

  const groups = {};

  filteredRoomIds.forEach(roomId => {
    const stage = ROOM_META[roomId].stage;

    if (!groups[stage]) {
      groups[stage] = [];
    }

    groups[stage].push(roomId);
  });

  host.innerHTML = Object.entries(groups).map(([stage, roomIds]) => `
    <section class="match-group">

      <div class="match-group-heading">
        <div>
          <span class="match-group-label">
            ${escapeHTML(stage)}
          </span>

          <h3>ROOM OVERVIEW</h3>
        </div>

        <span class="match-group-count">
          ${roomIds.length}
          ${roomIds.length === 1 ? "ROOM" : "ROOMS"}
        </span>
      </div>

      <div class="match-grid">
        ${roomIds.map(createRoomCard).join("")}
      </div>

    </section>
  `).join("");
}

// ==========================================
// FILTER BUTTONS
// ==========================================

document.querySelectorAll(".match-filter").forEach(button => {
  button.addEventListener("click", () => {
    currentFilter = button.dataset.filter;

    document.querySelectorAll(".match-filter").forEach(item => {
      item.classList.remove("active");
    });

    button.classList.add("active");

    renderRooms();
  });
});

// ==========================================
// FIREBASE LIVE ROOM UPDATES
// ==========================================

onSnapshot(
  collection(db, "rooms"),

  snapshot => {
    rooms = {};

    snapshot.forEach(document => {
      rooms[document.id] = document.data();
    });

    renderRooms();
  },

  error => {
    console.error("Unable to load rooms:", error);

    host.innerHTML = `
      <div class="notice error">
        Unable to load room information.
        Please refresh the page and try again.
      </div>
    `;
  }
);