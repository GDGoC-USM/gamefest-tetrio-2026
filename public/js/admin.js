import {
  auth, db, signIn, signInWithEmailAndPassword, signOut, onAuthStateChanged,
  isAdmin, collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc,
  serverTimestamp, escapeHTML, showMessage, query, where
} from "./shared.js";

const ROOM_CONFIG = [
  { id:"A", name:"Preliminary Room A", stage:"Preliminary", stageId:"preliminary", size:8 },
  { id:"B", name:"Preliminary Room B", stage:"Preliminary", stageId:"preliminary", size:8 },
  { id:"C", name:"Preliminary Room C", stage:"Preliminary", stageId:"preliminary", size:8 },
  { id:"D", name:"Preliminary Room D", stage:"Preliminary", stageId:"preliminary", size:8 },
  { id:"SF1", name:"Semi-final Room 1", stage:"Semi-final", stageId:"semifinal", size:4 },
  { id:"SF2", name:"Semi-final Room 2", stage:"Semi-final", stageId:"semifinal", size:4 },
  { id:"FINAL", name:"Grand Final", stage:"Grand Final", stageId:"final", size:4 }
];

const STAGES = [
  { id:"preliminary", name:"Preliminary" },
  { id:"semifinal", name:"Semi-final" },
  { id:"final", name:"Grand Final" }
];

const $ = id => document.getElementById(id);

const adminLogin = $("adminLogin");
const adminContent = $("adminContent");
const adminMessage = $("adminMessage");
const dashboardMessage = $("dashboardMessage");
const authBtn = $("authBtn");
const adminStatus = $("adminStatus");

const loginBtn = $("loginBtn");
const adminEmail = $("adminEmail");
const adminPassword = $("adminPassword");

const roomsContainer = $("roomsContainer");
const matchesContainer = $("matchesContainer");
const unpublishRoomBtn = $("unpublishRoomBtn");
const stagePredictionControls = $("stagePredictionControls");

let roomsCache = {};

// ==========================================
// MESSAGE HANDLING
// ==========================================

function notify(message, type = "info") {
  showMessage(
    adminContent.hidden ? adminMessage : dashboardMessage,
    message,
    type
  );
}

function errorMessage(error) {
  console.error(error);
  return error?.message || "Something went wrong. Please try again.";
}

// ==========================================
// NAVIGATION
// ==========================================

function showAdminSection(sectionId) {
  document.querySelectorAll(".nav-btn").forEach(button => {
    button.classList.toggle("active", button.dataset.section === sectionId);
  });

  document.querySelectorAll(".admin-section").forEach(section => {
    section.hidden = section.id !== sectionId;
  });

  if (sectionId === "rooms") loadRooms();
  if (sectionId === "matches") loadMatches();
  if (sectionId === "settings") loadSettings();
}

document.querySelectorAll(".nav-btn").forEach(button => {
  button.addEventListener("click", () => {
    showAdminSection(button.dataset.section);
  });
});

// ==========================================
// ADMIN LOGIN
// ==========================================

loginBtn?.addEventListener("click", async () => {
  const email = adminEmail.value.trim();
  const password = adminPassword.value;

  if (!email || !password) {
    notify("Please enter your administrator email and password.", "error");
    return;
  }

  loginBtn.disabled = true;
  loginBtn.textContent = "LOGGING IN...";

  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (error) {
    notify(errorMessage(error), "error");
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = "Sign in to dashboard";
  }
});

[adminEmail, adminPassword].forEach(input => {
  input?.addEventListener("keydown", event => {
    if (event.key === "Enter") loginBtn.click();
  });
});

// ==========================================
// GOOGLE SIGN-IN / ADMIN LOGOUT
// ==========================================

authBtn?.addEventListener("click", async () => {
  try {
    if (auth.currentUser) {
      await signOut(auth);
    } else {
      await signIn();
    }
  } catch (error) {
    notify(errorMessage(error), "error");
  }
});

// ==========================================
// AUTHENTICATION STATE
// ==========================================

onAuthStateChanged(auth, async user => {
  adminLogin.hidden = true;
  adminContent.hidden = true;
  authBtn.hidden = true;

  if (adminStatus) {
    adminStatus.textContent = user
      ? "Checking account..."
      : "Not signed in";
  }

  if (!user) {
    adminLogin.hidden = false;
    adminPassword.value = "";
    authBtn.hidden = false;
    authBtn.textContent = "SIGN IN WITH GOOGLE";

    if (adminStatus) {
      adminStatus.textContent = "Not signed in";
    }

    notify("Please log in using your administrator account.");
    return;
  }

  try {
    const authorized = await isAdmin(user);

    if (!authorized) {
      notify(
        "Access denied. This account is not registered as an administrator.",
        "error"
      );

      await signOut(auth);
      return;
    }

    adminLogin.hidden = true;
    adminContent.hidden = false;
    authBtn.hidden = false;
    authBtn.textContent = "SIGN OUT";

    if (adminStatus) {
      adminStatus.textContent = user.email || "Administrator";
    }

    notify(`Welcome, ${user.email}. Admin access verified.`, "success");

    await loadAll();

  } catch (error) {
    adminContent.hidden = true;
    adminLogin.hidden = false;
    notify(errorMessage(error), "error");
  }
});

// ==========================================
// LOAD DASHBOARD
// ==========================================

async function loadAll() {
  try {

    await Promise.all([
      loadRooms(),
      loadMatches(),
      loadSettings()
    ]);

    await recalculateLeaderboard();

    console.log(
      "Leaderboard updated automatically."
    );

  } catch (error) {

    notify(
      `Unable to load dashboard: ${errorMessage(error)}`,
      "error"
    );

    console.error(
      "Dashboard / leaderboard error:",
      error
    );

  }
}

// ==========================================
// ROOM HELPERS
// ==========================================

function getRoomConfig(id) {
  return ROOM_CONFIG.find(room => room.id === id);
}

function parsePlayers(value) {
  return value
    .split(/\r?\n/)
    .map(name => name.trim())
    .filter(Boolean);
}

function playerOptions(players, selected = "") {
  return `
    <option value="">Select player</option>
    ${players.filter(Boolean).map(player => `
      <option
        value="${escapeHTML(player)}"
        ${player === selected ? "selected" : ""}
      >
        ${escapeHTML(player)}
      </option>
    `).join("")}
  `;
}

function roomStatus(room = {}) {
  if (room.resultsPublished === true || room.status === "completed") {
    return "completed";
  }

  return room.status === "live" ? "live" : "upcoming";
}

async function fetchRooms() {
  const snapshot = await getDocs(collection(db, "rooms"));

  roomsCache = {};

  snapshot.forEach(roomSnapshot => {
    roomsCache[roomSnapshot.id] = roomSnapshot.data();
  });

  return roomsCache;
}

// ==========================================
// ROOM MANAGEMENT
// READ-ONLY ROOM OVERVIEW
// ==========================================

async function loadRooms() {
  try {
    await fetchRooms();

    roomsContainer.innerHTML = ROOM_CONFIG.map(config => {
      const room = roomsCache[config.id] || {};

      const players = Array.isArray(room.players)
        ? room.players
        : [];

      const status = roomStatus(room);
      const resultsPublished = room.resultsPublished === true;

      const resultMarkup = config.stageId === "final"
        ? (
            resultsPublished
              ? `
                <div class="room-result">
                  <b>Champion:</b>
                  ${escapeHTML(room.champion || "TBC")}
                  <br>
                  <b>1st Runner-up:</b>
                  ${escapeHTML(room.runnerUp || "TBC")}
                  <br>
                  <b>2nd Runner-up:</b>
                  ${escapeHTML(room.secondRunnerUp || "TBC")}
                </div>
              `
              : ""
          )
        : (
            resultsPublished
              ? `
                <div class="room-result">
                  <b>Official qualifiers:</b>
                  ${escapeHTML(
                    (room.qualifiers || []).join(" · ") || "TBC"
                  )}
                </div>
              `
              : ""
          );

      return `
        <article class="admin-card room-overview-card">

          <span class="room-tag">
            ${escapeHTML(config.stage)}
            &middot; ROOM ${escapeHTML(config.id)}
          </span>

          <h3>${escapeHTML(config.name)}</h3>

          <p class="muted">
            ${config.size} players
            &middot;
            <span class="status-${status}">
              ${status.toUpperCase()}
            </span>
          </p>

          <div class="room-player-list">
            ${
              players.length
                ? players.map((player, index) => `
                    <div class="room-player">
                      <span>${String(index + 1).padStart(2, "0")}</span>
                      <strong>${escapeHTML(player)}</strong>
                    </div>
                  `).join("")
                : `
                    <p class="muted">
                      Players not entered yet.
                    </p>
                  `
            }
          </div>

          ${resultMarkup}

        </article>
      `;
    }).join("");

  } catch (error) {
    roomsContainer.innerHTML = `
      <div class="notice error">
        ${escapeHTML(errorMessage(error))}
      </div>
    `;
  }
}

// ==========================================
// MATCHES MANAGEMENT
// SELECT ROOM / ENTER PLAYERS / RESULTS
// ==========================================

function updateRoomSelector() {
  const select = $("room");

  if (!select) return;

  const current = select.value;

  select.innerHTML = `
    <option value="">Select stage / room</option>
    ${ROOM_CONFIG.map(room => `
      <option value="${room.id}">
        ${escapeHTML(room.stage)} — ${escapeHTML(room.name)}
      </option>
    `).join("")}
  `;

  if (current) {
    select.value = current;
  }
}

function loadRoomEditor(roomId) {
  const config = getRoomConfig(roomId);
  const room = roomsCache[roomId] || {};

  if (!config) return;

  const players = Array.isArray(room.players)
    ? room.players
    : [];

  $("roomPlayers").value = players.join("\n");

  $("roomStatus").value =
    room.resultsPublished === true
      ? "completed"
      : room.status === "live"
        ? "live"
        : "upcoming";

  const resultFields = $("roomResultFields");

  if (config.stageId === "final") {
    resultFields.innerHTML = `
      <div class="field">
        <label for="champion">Champion</label>
        <select id="champion">
          ${playerOptions(players, room.champion || "")}
        </select>
      </div>

      <div class="field">
        <label for="runnerUp">1st Runner-up</label>
        <select id="runnerUp">
          ${playerOptions(players, room.runnerUp || "")}
        </select>
      </div>

      <div class="field">
        <label for="secondRunnerUp">2nd Runner-up</label>
        <select id="secondRunnerUp">
          ${playerOptions(players, room.secondRunnerUp || "")}
        </select>
      </div>
    `;
  } else {
    const qualifiers = room.qualifiers || [];

    resultFields.innerHTML = `
      <div class="field">
        <label for="qualifier1">First qualifier</label>
        <select id="qualifier1">
          ${playerOptions(players, qualifiers[0] || "")}
        </select>
      </div>

      <div class="field">
        <label for="qualifier2">Second qualifier</label>
        <select id="qualifier2">
          ${playerOptions(players, qualifiers[1] || "")}
        </select>
      </div>
    `;
  }

  $("roomPlayers").oninput = () => {
    refreshRoomResultOptions(roomId);
  };

  $("roomFormTitle").textContent = `Manage ${config.name}`;
  $("roomEditorCard").hidden = false;
  resultFields.dataset.room = roomId;

  // Only show the reopen control after official results have been published.
  if (unpublishRoomBtn) {
    unpublishRoomBtn.hidden = room.resultsPublished !== true;
  }
}

function refreshRoomResultOptions(roomId) {
  const config = getRoomConfig(roomId);
  const players = parsePlayers($("roomPlayers").value);

  if (!config) return;

  const firstId = config.stageId === "final"
    ? "champion"
    : "qualifier1";

  const secondId = config.stageId === "final"
    ? "runnerUp"
    : "qualifier2";

  const previousFirst = $(firstId)?.value || "";
  const previousSecond = $(secondId)?.value || "";
  const previousThird = $("secondRunnerUp")?.value || "";

  const resultFields = $("roomResultFields");

  if (config.stageId === "final") {
    resultFields.innerHTML = `
      <div class="field">
        <label for="champion">Champion</label>
        <select id="champion">
          ${playerOptions(players, previousFirst)}
        </select>
      </div>

      <div class="field">
        <label for="runnerUp">1st Runner-up</label>
        <select id="runnerUp">
          ${playerOptions(players, previousSecond)}
        </select>
      </div>

      <div class="field">
        <label for="secondRunnerUp">2nd Runner-up</label>
        <select id="secondRunnerUp">
          ${playerOptions(players, previousThird)}
        </select>
      </div>
    `;
  } else {
    resultFields.innerHTML = `
      <div class="field">
        <label for="qualifier1">First qualifier</label>
        <select id="qualifier1">
          ${playerOptions(players, previousFirst)}
        </select>
      </div>

      <div class="field">
        <label for="qualifier2">Second qualifier</label>
        <select id="qualifier2">
          ${playerOptions(players, previousSecond)}
        </select>
      </div>
    `;
  }
}

$("room")?.addEventListener("change", async () => {
  const id = $("room").value;

  if (!id) {
    $("roomEditorCard").hidden = true;
    return;
  }

  await fetchRooms();
  loadRoomEditor(id);
});

$("saveRoomBtn")?.addEventListener("click", saveRoom);
$("publishRoomBtn")?.addEventListener("click", publishResults);
unpublishRoomBtn?.addEventListener("click", unpublishRoom);

$("cancelRoomBtn")?.addEventListener("click", () => {
  $("room").value = "";
  $("roomEditorCard").hidden = true;
});

// ==========================================
// VALIDATE ROOM PLAYERS
// ==========================================

function validateRoomPlayers(config, players) {
  if (players.length !== config.size) {
    throw new Error(
      `${config.id} must have exactly ${config.size} players.`
    );
  }

  if (players.some(player => player.length > 60)) {
    throw new Error("Player names must not exceed 60 characters.");
  }

  if (
    new Set(players.map(player => player.toLowerCase())).size
    !== players.length
  ) {
    throw new Error("Duplicate player names are not allowed in a room.");
  }
}

// ==========================================
// SAVE ROOM PLAYERS AND STATUS
// ==========================================

async function saveRoom() {
  const id = $("room").value;
  const config = getRoomConfig(id);

  if (!config) return;

  const players = parsePlayers($("roomPlayers").value);

  try {
    validateRoomPlayers(config, players);

    const existing = await getDoc(doc(db, "rooms", id));
    const previous = existing.exists()
      ? existing.data()
      : {};

    const playersChanged =
      JSON.stringify(previous.players || []) !==
      JSON.stringify(players);

    await setDoc(
      doc(db, "rooms", id),
      {
        name: config.name,
        stage: config.stage,
        stageId: config.stageId,
        players,
        status: $("roomStatus").value,

        qualifiers: playersChanged
          ? []
          : (previous.qualifiers || []),

        champion: playersChanged
          ? ""
          : (previous.champion || ""),

        runnerUp: playersChanged
          ? ""
          : (previous.runnerUp || ""),

        secondRunnerUp: playersChanged
          ? ""
          : (previous.secondRunnerUp || ""),

        resultsPublished: playersChanged
          ? false
          : (previous.resultsPublished === true),

        updatedAt: serverTimestamp()
      },
      { merge: true }
    );

    await fetchRooms();
    loadRoomEditor(id);
    await loadRooms();

    notify(
      `${config.name} saved. Players and room status updated.`,
      "success"
    );

  } catch (error) {
    notify(errorMessage(error), "error");
  }
}

// ==========================================
// PUBLISH ROOM RESULTS
// ==========================================

async function publishResults() {
  const id = $("room").value;
  const config = getRoomConfig(id);

  if (!config) return;

  const players = parsePlayers($("roomPlayers").value);

  try {
    validateRoomPlayers(config, players);

    const existing = await getDoc(doc(db, "rooms", id));

    if (
      !existing.exists() ||
      JSON.stringify(existing.data().players || []) !==
      JSON.stringify(players)
    ) {
      throw new Error(
        "Save the room's player list before publishing results."
      );
    }

    let result = {};

    if (config.stageId === "final") {
      const champion = $("champion")?.value;
      const runnerUp = $("runnerUp")?.value;
      const secondRunnerUp = $("secondRunnerUp")?.value;

      const podium = [
        champion,
        runnerUp,
        secondRunnerUp
      ];

      if (
        podium.some(player => !player) ||
        new Set(podium).size !== 3
      ) {
        throw new Error(
          "Choose three different finalists for Champion, 1st Runner-up and 2nd Runner-up."
        );
      }

      result = {
        champion,
        runnerUp,
        secondRunnerUp
      };

    } else {
      const first = $("qualifier1")?.value;
      const second = $("qualifier2")?.value;

      if (!first || !second || first === second) {
        throw new Error("Choose two different qualifiers.");
      }

      result = {
        qualifiers: [first, second]
      };
    }

    if (!confirm(`Publish official results for ${config.name}?`)) {
      return;
    }

    const official = config.stageId === "final"
      ? [
          result.champion,
          result.runnerUp,
          result.secondRunnerUp
        ]
      : result.qualifiers;

    if (!official.every(player => players.includes(player))) {
      throw new Error(
        "Published results must be players in this room."
      );
    }

    await updateDoc(
      doc(db, "rooms", id),
      {
        ...result,
        resultsPublished: true,
        resultsPublishedAt: serverTimestamp(),
        status: "completed",
        updatedAt: serverTimestamp()
      }
    );

    await fetchRooms();
    loadRoomEditor(id);
    await loadRooms();

    notify(`${config.name} results published.`, "success");

    await recalculateLeaderboard();

  } catch (error) {
    notify(errorMessage(error), "error");
  }
}


// ==========================================
// REOPEN / UNPUBLISH ROOM RESULTS
// ==========================================

// These rooms depend on qualifiers from the room being reopened.
const ROOM_DEPENDENCIES = {
  A: ["SF1"],
  B: ["SF1"],
  C: ["SF2"],
  D: ["SF2"],
  SF1: ["FINAL"],
  SF2: ["FINAL"],
  FINAL: []
};

function getDependentRoomIds(roomId) {
  const result = [];
  const visited = new Set();

  function visit(id) {
    for (const dependentId of ROOM_DEPENDENCIES[id] || []) {
      if (visited.has(dependentId)) continue;
      visited.add(dependentId);
      result.push(dependentId);
      visit(dependentId);
    }
  }

  visit(roomId);
  return result;
}

async function deletePredictionsForRooms(roomIds) {
  let deletedCount = 0;

  for (const roomId of roomIds) {
    const predictionQuery = query(
      collection(db, "predictions"),
      where("roomId", "==", roomId)
    );

    const snapshot = await getDocs(predictionQuery);

    for (const prediction of snapshot.docs) {
      await deleteDoc(prediction.ref);
      deletedCount++;
    }
  }

  return deletedCount;
}

async function unpublishRoom() {
  const id = $("room").value;
  const config = getRoomConfig(id);

  if (!config) return;

  if (unpublishRoomBtn) {
    unpublishRoomBtn.disabled = true;
  }

  try {
    const sourceSnapshot = await getDoc(doc(db, "rooms", id));

    if (!sourceSnapshot.exists()) {
      throw new Error("This room has not been saved yet.");
    }

    const sourceRoom = sourceSnapshot.data();

    if (sourceRoom.resultsPublished !== true) {
      throw new Error("This room does not have published results to reopen.");
    }

    const dependentIds = getDependentRoomIds(id);
    const dependentNames = dependentIds.map(dependentId => {
      const dependentConfig = getRoomConfig(dependentId);
      return dependentConfig ? dependentConfig.name : dependentId;
    });

    let confirmation =
      `Unpublish the official results for ${config.name} and reopen it?\n\n` +
      `The room's player names and its users' predictions will be kept. ` +
      `Its results will be removed and its status will return to Upcoming.`;

    if (dependentNames.length) {
      confirmation +=
        `\n\nIMPORTANT: The following dependent room(s) will also be reset: ` +
        `${dependentNames.join(", ")}. Their generated players and published results ` +
        `will be cleared, and predictions saved for those dependent rooms will be deleted ` +
        `because their player lists may no longer be valid.`;
    }

    confirmation += "\n\nDo you want to continue?";

    if (!confirm(confirmation)) return;

    // Reset downstream stages first so the source result is not unpublished
    // while an existing dependent bracket is still marked as valid.
    for (const dependentId of dependentIds) {
      const dependentRef = doc(db, "rooms", dependentId);
      const dependentSnapshot = await getDoc(dependentRef);

      if (!dependentSnapshot.exists()) continue;

      await updateDoc(dependentRef, {
        players: [],
        qualifiers: [],
        champion: "",
        runnerUp: "",
        secondRunnerUp: "",
        resultsPublished: false,
        resultsPublishedAt: null,
        status: "upcoming",
        updatedAt: serverTimestamp()
      });
    }

    // Remove predictions belonging to dependent rooms only. The source room's
    // predictions are deliberately preserved so they can be scored again.
    const deletedPredictions = await deletePredictionsForRooms(dependentIds);

    await updateDoc(doc(db, "rooms", id), {
      qualifiers: [],
      champion: "",
      runnerUp: "",
      secondRunnerUp: "",
      resultsPublished: false,
      resultsPublishedAt: null,
      status: "upcoming",
      updatedAt: serverTimestamp()
    });

    await fetchRooms();
    loadRoomEditor(id);
    await loadRooms();
    await loadMatches();
    await recalculateLeaderboard();

    const dependentMessage = dependentIds.length
      ? ` Dependent rooms reset: ${dependentIds.join(", ")}.`
      : "";

    notify(
      `${config.name} has been reopened. Its players and predictions were kept.` +
      dependentMessage +
      ` ${deletedPredictions} dependent-room prediction(s) were removed.`,
      "success"
    );

  } catch (error) {
    notify(
      `Unable to reopen room: ${errorMessage(error)}. If this happened during the reset, review the dependent rooms before continuing.`,
      "error"
    );
  } finally {
    if (unpublishRoomBtn) {
      unpublishRoomBtn.disabled = false;
    }
  }
}

// ==========================================
// GENERATE SEMI-FINALS
// ==========================================

$("generateSemifinalsBtn")?.addEventListener("click", async () => {
  if (!confirm(
    "Generate SF1 from A+B and SF2 from C+D published qualifiers?"
  )) {
    return;
  }

  try {
    const [semi1Players, semi2Players] = await Promise.all([
      getPublishedQualifiers(["A", "B"]),
      getPublishedQualifiers(["C", "D"])
    ]);

    await Promise.all([
      setDoc(doc(db, "rooms", "SF1"), {
        name: "Semi-final Room 1",
        stage: "Semi-final",
        stageId: "semifinal",
        players: semi1Players,
        qualifiers: [],
        resultsPublished: false,
        status: "upcoming",
        updatedAt: serverTimestamp()
      }),

      setDoc(doc(db, "rooms", "SF2"), {
        name: "Semi-final Room 2",
        stage: "Semi-final",
        stageId: "semifinal",
        players: semi2Players,
        qualifiers: [],
        resultsPublished: false,
        status: "upcoming",
        updatedAt: serverTimestamp()
      })
    ]);

    await fetchRooms();
    await loadRooms();

    notify("Semi-final rooms generated.", "success");

  } catch (error) {
    notify(errorMessage(error), "error");
  }
});

// ==========================================
// GENERATE GRAND FINAL
// ==========================================

$("generateFinalBtn")?.addEventListener("click", async () => {
  if (!confirm(
    "Generate Grand Final from SF1 and SF2 published qualifiers?"
  )) {
    return;
  }

  try {
    const finalists = await getPublishedQualifiers(["SF1", "SF2"]);

    await setDoc(doc(db, "rooms", "FINAL"), {
      name: "Grand Final",
      stage: "Grand Final",
      stageId: "final",
      players: finalists,
      qualifiers: [],
      champion: "",
      runnerUp: "",
      secondRunnerUp: "",
      resultsPublished: false,
      status: "upcoming",
      updatedAt: serverTimestamp()
    });

    await fetchRooms();
    await loadRooms();

    notify("Grand Final room generated.", "success");

  } catch (error) {
    notify(errorMessage(error), "error");
  }
});

async function getPublishedQualifiers(roomIds) {
  const result = [];

  for (const id of roomIds) {
    const snapshot = await getDoc(doc(db, "rooms", id));

    if (!snapshot.exists()) {
      throw new Error(`Room ${id} has not been configured.`);
    }

    const data = snapshot.data();
    const qualifiers = data.qualifiers || [];
    const players = data.players || [];

    if (data.resultsPublished !== true) {
      throw new Error(`Publish Room ${id} results first.`);
    }

    if (
      qualifiers.length !== 2 ||
      qualifiers[0] === qualifiers[1] ||
      !qualifiers.every(player => players.includes(player))
    ) {
      throw new Error(`${id} needs two valid published qualifiers.`);
    }

    result.push(...qualifiers);
  }

  if (
    new Set(result.map(player => player.toLowerCase())).size
    !== result.length
  ) {
    throw new Error("A player cannot qualify more than once.");
  }

  return result;
}

// ==========================================
// MATCHES MANAGEMENT - ROOM SUMMARY
// ==========================================

async function loadMatches() {
  updateRoomSelector();

  try {
    await fetchRooms();

    matchesContainer.innerHTML = ROOM_CONFIG.map(config => {
      const room = roomsCache[config.id] || {};
      const players = room.players || [];
      const published = room.resultsPublished === true;

      const result = config.stageId === "final"
        ? (
            published
              ? `Champion: ${escapeHTML(room.champion || "—")} · 1st Runner-up: ${escapeHTML(room.runnerUp || "—")} · 2nd Runner-up: ${escapeHTML(room.secondRunnerUp || "—")}`
              : "Results not published"
          )
        : (
            published
              ? `Qualifiers: ${escapeHTML((room.qualifiers || []).join(" · ") || "—")}`
              : "Results not published"
          );

      return `
        <div class="match-row">
          <div>
            <b>
              ${escapeHTML(config.stage)}
              / ${escapeHTML(config.id)}
            </b>

            <div class="muted">
              ${players.length}/${config.size} players
              · ${escapeHTML(room.status || "upcoming")}
            </div>

            <small class="score">${result}</small>
          </div>

          <div class="actions">
            <button type="button"
              class="btn secondary edit-room"
              data-room="${config.id}">
              Manage room
            </button>
          </div>
        </div>
      `;
    }).join("");

    matchesContainer.querySelectorAll(".edit-room").forEach(button => {
      button.addEventListener("click", async () => {
        const id = button.dataset.room;

        $("room").value = id;

        await fetchRooms();
        loadRoomEditor(id);

        $("roomEditorCard").scrollIntoView({
          behavior: "smooth",
          block: "start"
        });
      });
    });

  } catch (error) {
    matchesContainer.innerHTML = `
      <div class="notice error">
        ${escapeHTML(errorMessage(error))}
      </div>
    `;
  }
}

// ==========================================
// LEADERBOARD CALCULATION
// ==========================================

async function recalculateLeaderboard() {

  const [
    predictionSnapshot,
    roomSnapshot,
    leaderboardSnapshot
  ] = await Promise.all([

    getDocs(collection(db, "predictions")),

    getDocs(collection(db, "rooms")),

    getDocs(collection(db, "leaderboard"))

  ]);

  // ========================================
  // LOAD OFFICIAL ROOM RESULTS
  // ========================================

  const rooms = {};

  roomSnapshot.forEach(item => {

    rooms[item.id] = item.data();

  });

  // ========================================
  // PREPARE PARTICIPANTS
  // ========================================

  const people = {};

  function getPerson(prediction) {

    if (!prediction.uid) return null;

    if (!people[prediction.uid]) {

      people[prediction.uid] = {

        uid: prediction.uid,

        displayName:
          prediction.displayName || "Player",

        correct: 0,

        points: 0

      };

    }

    return people[prediction.uid];

  }

  // ========================================
  // CALCULATE EACH PREDICTION
  // ========================================

  predictionSnapshot.forEach(item => {

    const prediction = item.data();

    // Ignore old match-based predictions.
    if (prediction.matchId) return;

    const person = getPerson(prediction);

    if (!person) return;

    const room = rooms[prediction.roomId];

    // Only calculate rooms with published results.
    if (
      !room ||
      room.resultsPublished !== true
    ) {
      return;
    }

    // ======================================
    // PRELIMINARY / SEMI-FINAL TOP 2
    // ======================================

    if (
      prediction.stageId === "preliminary" ||
      prediction.stageId === "semifinal"
    ) {

      const predicted = Array.isArray(
        prediction.selectedPlayers
      )
        ? prediction.selectedPlayers
        : [];

      const official = Array.isArray(
        room.qualifiers
      )
        ? room.qualifiers
        : [];

      if (
        predicted.length !== 2 ||
        official.length !== 2
      ) {
        return;
      }

      // Order does not matter.
      const correctCount = predicted.filter(
        player => official.includes(player)
      ).length;

      person.correct += correctCount;
      person.points += correctCount * 10;

    }

    // ======================================
    // GRAND FINAL
    // ======================================

    if (prediction.stageId === "final") {

      // Champion must match Champion.
      if (
        prediction.champion &&
        prediction.champion === room.champion
      ) {

        person.correct += 1;
        person.points += 10;

      }

      // 1st Runner-up must match 1st Runner-up.
      if (
        prediction.runnerUp &&
        prediction.runnerUp === room.runnerUp
      ) {

        person.correct += 1;
        person.points += 10;

      }

      // 2nd Runner-up must match 2nd Runner-up.
      if (
        prediction.secondRunnerUp &&
        prediction.secondRunnerUp === room.secondRunnerUp
      ) {

        person.correct += 1;
        person.points += 10;

      }

    }

  });

  // ========================================
  // SORT PARTICIPANTS
  // ========================================

  const rows = Object.values(people).sort(

    (a, b) =>

      b.points - a.points ||

      b.correct - a.correct ||

      a.displayName.localeCompare(b.displayName)

  );

  // ========================================
  // SAVE CALCULATED SCORES TO FIRESTORE
  // ========================================

  const updatedIds = new Set();

  for (
    let index = 0;
    index < rows.length;
    index++
  ) {

    const person = rows[index];

    updatedIds.add(person.uid);

    await setDoc(

      doc(
        db,
        "leaderboard",
        person.uid
      ),

      {

        uid: person.uid,

        displayName: person.displayName,

        correct: person.correct,

        points: person.points,

        rank: index + 1,

        updatedAt: serverTimestamp()

      }

    );

  }

  // ========================================
  // REMOVE OLD LEADERBOARD ENTRIES
  // ========================================

  for (const item of leaderboardSnapshot.docs) {

    if (!updatedIds.has(item.id)) {

      await deleteDoc(
        doc(db, "leaderboard", item.id)
      );

    }

  }

  console.log(
    "LEADERBOARD SUCCESSFULLY RECALCULATED:",
    rows
  );

  return rows;

}

// ==========================================
// PREDICTION SETTINGS
// ==========================================

function stageSettingsRef(stageId) {
  return doc(db, "settings", `rounds_${stageId}`);
}

async function loadSettings() {
  const snapshots = await Promise.all(
    STAGES.map(stage => getDoc(stageSettingsRef(stage.id)))
  );

  stagePredictionControls.innerHTML = STAGES.map((stage, index) => {
    const data = snapshots[index].exists()
      ? snapshots[index].data()
      : {};

    const open = data.predictionsOpen === true;

    return `
      <article class="admin-card">
        <h3>${escapeHTML(stage.name)}</h3>

        <p class="muted">
          Predictions are ${open ? "OPEN" : "CLOSED"}.
        </p>

        <button
          type="button"
          class="btn ${open ? "red" : ""} stage-toggle"
          data-stage="${stage.id}"
          data-open="${open}"
        >
          ${open ? "CLOSE" : "OPEN"} PREDICTIONS
        </button>
      </article>
    `;
  }).join("");

  stagePredictionControls.querySelectorAll(".stage-toggle").forEach(button => {
    button.addEventListener("click", () => toggleStage(button));
  });
}

async function toggleStage(button) {
  const stageId = button.dataset.stage;
  const currentlyOpen = button.dataset.open === "true";
  const nextOpen = !currentlyOpen;

  button.disabled = true;

  try {
    await setDoc(
      stageSettingsRef(stageId),
      {
        predictionsOpen: nextOpen,
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );

    await loadSettings();

    notify(
      `${stageId} predictions are now ${nextOpen ? "OPEN" : "CLOSED"}.`,
      "success"
    );

  } catch (error) {
    button.disabled = false;
    notify(errorMessage(error), "error");
  }
}