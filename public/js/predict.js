import {
  auth,
  db,
  signIn,
  signOut,
  onAuthStateChanged,
  collection,
  doc,
  getDoc,
  onSnapshot,
  setDoc,
  deleteDoc,
  serverTimestamp,
  escapeHTML
} from "./shared.js";

const $ = id => document.getElementById(id);

const authBtn = $("authBtn");
const notice = $("predictNotice");
const host = $("predictionList");

const ROOM_ORDER = ["A", "B", "C", "D", "SF1", "SF2", "FINAL"];

const ROOM_META = {
  A: {
    stage: "Preliminary",
    stageId: "preliminary",
    name: "Preliminary – Room A",
    size: 8
  },
  B: {
    stage: "Preliminary",
    stageId: "preliminary",
    name: "Preliminary – Room B",
    size: 8
  },
  C: {
    stage: "Preliminary",
    stageId: "preliminary",
    name: "Preliminary – Room C",
    size: 8
  },
  D: {
    stage: "Preliminary",
    stageId: "preliminary",
    name: "Preliminary – Room D",
    size: 8
  },
  SF1: {
    stage: "Semi-final",
    stageId: "semifinal",
    name: "Semi-final – SF1",
    size: 4
  },
  SF2: {
    stage: "Semi-final",
    stageId: "semifinal",
    name: "Semi-final – SF2",
    size: 4
  },
  FINAL: {
    stage: "Grand Final",
    stageId: "final",
    name: "Grand Final",
    size: 4
  }
};

// ==========================================
// GLOBAL STATE
// ==========================================

let rooms = {};
let settings = {};
let currentUser = null;
let picks = {};
let savingRooms = new Set();
let savedRooms = new Set();

let authRequestId = 0;

// ==========================================
// NOTICE
// ==========================================

function showNotice(message, type = "info") {
  if (!notice) return;

  notice.textContent = message;
  notice.className = `notice ${type}`;
}

// ==========================================
// HELPERS
// ==========================================

function statusOf(room) {
  return room.resultsPublished || room.status === "completed"
    ? "COMPLETED"
    : room.status === "live"
      ? "LIVE"
      : "UPCOMING";
}

function isOpen(stageId) {
  return settings[stageId] === true;
}

function predictionDocId(roomId) {
  if (!currentUser) {
    throw new Error("User is not signed in.");
  }

  return `${currentUser.uid}_${roomId}`;
}

function predictionRef(roomId) {
  return doc(
    db,
    "predictions",
    predictionDocId(roomId)
  );
}

function isRoomReady(roomId) {
  const room = rooms[roomId] || {};
  const meta = ROOM_META[roomId];

  return Boolean(
    meta &&
    Array.isArray(room.players) &&
    room.players.length === meta.size &&
    new Set(room.players).size === meta.size
  );
}

function roomIsClosed(roomId) {
  const room = rooms[roomId] || {};
  const meta = ROOM_META[roomId];

  if (!currentUser || !meta) return true;

  return (
    !isOpen(meta.stageId) ||
    room.resultsPublished === true ||
    room.status === "completed" ||
    !isRoomReady(roomId)
  );
}

// ==========================================
// VALIDATE SELECTION
// ==========================================

function isValidSelection(roomId) {
  const room = rooms[roomId] || {};
  const players = room.players || [];
  const current = picks[roomId];

  if (roomId === "FINAL") {
    return Boolean(
      current &&
      current.champion &&
      current.runnerUp &&
      current.secondRunnerUp &&
      new Set([
        current.champion,
        current.runnerUp,
        current.secondRunnerUp
      ]).size === 3 &&
      players.includes(current.champion) &&
      players.includes(current.runnerUp) &&
      players.includes(current.secondRunnerUp)
    );
  }

  return Boolean(
    Array.isArray(current) &&
    current.length === 2 &&
    current[0] !== current[1] &&
    players.includes(current[0]) &&
    players.includes(current[1])
  );
}

// ==========================================
// FIRESTORE SAVE
// ==========================================

async function savePrediction(roomId) {

  if (!currentUser) {
    showNotice(
      "Please sign in with Google before submitting predictions.",
      "error"
    );

    return false;
  }

  if (!ROOM_META[roomId]) {
    showNotice("Invalid prediction room.", "error");
    return false;
  }

  if (roomIsClosed(roomId)) {
    showNotice(
      "Predictions are closed or the room is not ready.",
      "error"
    );

    return false;
  }

  if (!isValidSelection(roomId)) {
    savedRooms.delete(roomId);

    if (roomId === "FINAL") {
      showNotice(
        "Please select Champion, 1st Runner-up and 2nd Runner-up.",
        "info"
      );
    } else {
      showNotice(
        "Please select exactly 2 players to submit your prediction.",
        "info"
      );
    }

    render();
    return false;
  }

  if (savingRooms.has(roomId)) {
    return false;
  }

  const meta = ROOM_META[roomId];
  const current = picks[roomId];

  let payload;

  // ========================================
  // GRAND FINAL
  // ========================================

  if (roomId === "FINAL") {

    payload = {
      uid: currentUser.uid,
      roomId: "FINAL",
      stageId: "final",

      displayName:
        currentUser.displayName ||
        currentUser.email ||
        "Participant",

      selectedPlayers: [],

      champion: current.champion,
      runnerUp: current.runnerUp,
      secondRunnerUp: current.secondRunnerUp,

      updatedAt: serverTimestamp()
    };

  }

  // ========================================
  // PRELIMINARY / SEMI-FINAL
  // ========================================

  else {

    payload = {
      uid: currentUser.uid,
      roomId: roomId,
      stageId: meta.stageId,

      displayName:
        currentUser.displayName ||
        currentUser.email ||
        "Participant",

      selectedPlayers: [...current],

      champion: "",
      runnerUp: "",
      secondRunnerUp: "",

      updatedAt: serverTimestamp()
    };

  }

  savingRooms.add(roomId);
  render();

  try {

    const ref = predictionRef(roomId);

    await setDoc(ref, payload);

    const confirmation = await getDoc(ref);

    if (!confirmation.exists()) {
      throw new Error(
        "Firestore did not confirm the saved prediction."
      );
    }

    const savedData = confirmation.data();

    if (savedData.uid !== currentUser.uid) {
      throw new Error(
        "Saved prediction ownership verification failed."
      );
    }

    if (roomId === "FINAL") {

      if (
        savedData.champion !== current.champion ||
        savedData.runnerUp !== current.runnerUp ||
        savedData.secondRunnerUp !== current.secondRunnerUp
      ) {
        throw new Error(
          "Saved Grand Final podium positions do not match."
        );
      }

    } else {

      if (
        !Array.isArray(savedData.selectedPlayers) ||
        savedData.selectedPlayers.length !== 2 ||
        savedData.selectedPlayers[0] !== current[0] ||
        savedData.selectedPlayers[1] !== current[1]
      ) {
        throw new Error(
          "Saved player selections do not match."
        );
      }

    }

    savedRooms.add(roomId);

    showNotice(
      `✓ ${meta.name}: prediction successfully saved to Firebase Firestore.`,
      "success"
    );

    console.log(
      "FIRESTORE SAVE SUCCESS",
      {
        collection: "predictions",
        documentId: predictionDocId(roomId),
        savedData: savedData
      }
    );

    return true;

  } catch (error) {

    console.error(
      "FIRESTORE SAVE FAILED:",
      error
    );

    savedRooms.delete(roomId);

    showNotice(
      `Firebase save failed: ${error.code || ""} ${error.message}`,
      "error"
    );

    return false;

  } finally {

    savingRooms.delete(roomId);
    render();

  }

}

// ==========================================
// RESET PREDICTION
// ==========================================

async function resetPrediction(roomId) {

  if (
    !currentUser ||
    roomIsClosed(roomId) ||
    savingRooms.has(roomId)
  ) {

    showNotice(
      "Sign in and make sure predictions are open before resetting.",
      "error"
    );

    return;
  }

  const oldPicks = picks[roomId];

  picks[roomId] = roomId === "FINAL"
    ? {
        champion: "",
        runnerUp: "",
        secondRunnerUp: ""
      }
    : [];

  savingRooms.add(roomId);
  render();

  try {

    if (savedRooms.has(roomId)) {

      await deleteDoc(predictionRef(roomId));

      savedRooms.delete(roomId);

    }

    showNotice(
      `${ROOM_META[roomId].name} prediction has been reset.`,
      "success"
    );

  } catch (error) {

    picks[roomId] = oldPicks;

    console.error("RESET FAILED:", error);

    showNotice(
      `Unable to reset prediction: ${error.message}`,
      "error"
    );

  } finally {

    savingRooms.delete(roomId);
    render();

  }

}

// ==========================================
// ROOM CARD
// ==========================================

function roomCard(id) {

  const room = rooms[id] || {};
  const meta = ROOM_META[id];

  const players = Array.isArray(room.players)
    ? room.players
    : [];

  const status = statusOf(room);
  const closed = roomIsClosed(id);

  const current = picks[id] ||
    (id === "FINAL"
      ? {
          champion: "",
          runnerUp: "",
          secondRunnerUp: ""
        }
      : []);

  const saving = savingRooms.has(id);

  let content = "";

  // ========================================
  // GRAND FINAL CARD
  // ========================================

  if (id === "FINAL") {

    content = `
      <div class="final-prediction-fields">

        <div class="field">

          <label for="championPick-${id}">
            Champion prediction
          </label>

          <select
            class="final-pick"
            data-room="${id}"
            data-position="champion"
            id="championPick-${id}"
            ${closed || saving ? "disabled" : ""}
          >

            <option value="">
              Select Champion
            </option>

            ${players.map(player => `
              <option
                value="${escapeHTML(player)}"
                ${current.champion === player ? "selected" : ""}
                ${[current.runnerUp, current.secondRunnerUp].includes(player) ? "disabled" : ""}
              >
                ${escapeHTML(player)}
              </option>
            `).join("")}

          </select>

        </div>

        <div class="field">

          <label for="runnerPick-${id}">
            1st Runner-up prediction
          </label>

          <select
            class="final-pick"
            data-room="${id}"
            data-position="runnerUp"
            id="runnerPick-${id}"
            ${closed || saving ? "disabled" : ""}
          >

            <option value="">
              Select 1st Runner-up
            </option>

            ${players.map(player => `
              <option
                value="${escapeHTML(player)}"
                ${current.runnerUp === player ? "selected" : ""}
                ${[current.champion, current.secondRunnerUp].includes(player) ? "disabled" : ""}
              >
                ${escapeHTML(player)}
              </option>
            `).join("")}

          </select>

        </div>

        <div class="field">

          <label for="secondRunnerPick-${id}">
            2nd Runner-up prediction
          </label>

          <select
            class="final-pick"
            data-room="${id}"
            data-position="secondRunnerUp"
            id="secondRunnerPick-${id}"
            ${closed || saving ? "disabled" : ""}
          >

            <option value="">
              Select 2nd Runner-up
            </option>

            ${players.map(player => `
              <option
                value="${escapeHTML(player)}"
                ${current.secondRunnerUp === player ? "selected" : ""}
                ${[current.champion, current.runnerUp].includes(player) ? "disabled" : ""}
              >
                ${escapeHTML(player)}
              </option>
            `).join("")}

          </select>

        </div>

      </div>

      <div class="prediction-footer">

        <span class="muted">
          Select all 3 positions to submit your prediction.
        </span>

        <button
          type="button"
          class="btn secondary reset-pick"
          data-room="${id}"
          ${
            (current.champion || current.runnerUp || current.secondRunnerUp) &&
            !closed &&
            !saving
              ? ""
              : "disabled"
          }
        >
          Reset
        </button>

      </div>
    `;

  }

  // ========================================
  // PRELIMINARY / SEMI-FINAL CARD
  // ========================================

  else {

    content = `
      <div class="room-prediction-players">

        ${players.map((player, index) => {

          const selected = current.includes(player);

          return `

            <button
              type="button"
              class="btn secondary prediction-player ${
                selected ? "selected" : ""
              }"

              aria-pressed="${selected}"

              data-room="${id}"

              data-player="${escapeHTML(player)}"

              ${closed || saving ? "disabled" : ""}

            >

              <span>
                PLAYER ${index + 1}
              </span>

              <strong>
                ${escapeHTML(player)}
              </strong>

            </button>

          `;

        }).join("")}

      </div>

      <div class="prediction-footer">

        <span class="muted">
          ${current.length}/2 selected
        </span>

        <button
          type="button"
          class="btn secondary reset-pick"
          data-room="${id}"
          ${
            current.length > 0 && !closed && !saving
              ? ""
              : "disabled"
          }
        >
          Reset
        </button>

      </div>
    `;

  }

  // ========================================
  // OFFICIAL RESULT
  // ========================================

  const result = id === "FINAL"

    ? (
        room.resultsPublished

          ? `Official: Champion ${
              escapeHTML(room.champion || "TBC")
            } · 1st Runner-up ${
              escapeHTML(room.runnerUp || "TBC")
            } · 2nd Runner-up ${
              escapeHTML(room.secondRunnerUp || "TBC")
            }`

          : "Final positions not published yet"
      )

    : (
        room.resultsPublished

          ? `Official qualifiers: ${
              escapeHTML(
                (room.qualifiers || []).join(" · ") || "TBC"
              )
            }`

          : "Results not published yet"
      );

  // ========================================
  // SAVE STATUS
  // ========================================

  const complete = isValidSelection(id);

  let saveStatus;

  if (saving) {

    saveStatus = "Saving prediction to Firebase...";

  } else if (!currentUser) {

    saveStatus = "Sign in with Google to submit a prediction.";

  } else if (closed) {

    saveStatus = room.resultsPublished
      ? "This room is completed."
      : "Predictions are closed or player list is incomplete.";

  } else if (complete && savedRooms.has(id)) {

    saveStatus = "✓ Prediction confirmed in Firebase Firestore.";

  } else if (complete) {

    saveStatus = "Selection complete. Please submit your prediction.";

  } else if (id === "FINAL") {

    saveStatus = "Select Champion, 1st Runner-up and 2nd Runner-up to submit.";

  } else {

    saveStatus = "Select exactly 2 players to submit.";

  }

  return `

    <article class="card prediction-card">

      <div class="prediction-card-top">

        <span class="room-tag">
          ${escapeHTML(meta.stage)} · ROOM ${escapeHTML(id)}
        </span>

        <span class="pill">
          ${status}
        </span>

      </div>

      <h3 class="prediction-title">
        ${escapeHTML(meta.name)}
      </h3>

      <p class="muted">

        ${
          id === "FINAL"

            ? "Predict Champion, 1st Runner-up and 2nd Runner-up from 4 finalists."

            : "Choose exactly 2 players to advance."
        }

      </p>

      ${content}

      <p class="muted prediction-result">
        ${saveStatus}
      </p>

      ${
        room.resultsPublished

          ? `
              <div class="match-card-bottom">

                <span class="match-result">
                  ${result}
                </span>

              </div>
            `

          : ""
      }

    </article>

  `;

}

// ==========================================
// LOAD SAVED PREDICTIONS FROM FIRESTORE
// ==========================================

async function loadUserPredictions(requestId = authRequestId) {

  if (!currentUser) {

    picks = {};
    savedRooms = new Set();

    render();

    return;

  }

  const user = currentUser;

  const userPicks = {};
  const userSavedRooms = new Set();

  try {

    const snapshots = await Promise.all(

      ROOM_ORDER.map(roomId =>

        getDoc(
          doc(
            db,
            "predictions",
            `${user.uid}_${roomId}`
          )
        )

      )

    );

    if (
      requestId !== authRequestId ||
      !currentUser ||
      currentUser.uid !== user.uid
    ) {
      return;
    }

    snapshots.forEach((snapshot, index) => {

      if (!snapshot.exists()) return;

      const roomId = ROOM_ORDER[index];
      const data = snapshot.data();

      if (data.uid !== user.uid) return;
      if (data.roomId !== roomId) return;

      const roomPlayers = rooms[roomId]?.players || [];

      if (roomId === "FINAL") {

        if (
          typeof data.champion !== "string" ||
          typeof data.runnerUp !== "string" ||
          typeof data.secondRunnerUp !== "string" ||
          new Set([
            data.champion,
            data.runnerUp,
            data.secondRunnerUp
          ]).size !== 3 ||
          !roomPlayers.includes(data.champion) ||
          !roomPlayers.includes(data.runnerUp) ||
          !roomPlayers.includes(data.secondRunnerUp)
        ) {
          return;
        }

        userPicks[roomId] = {
          champion: data.champion,
          runnerUp: data.runnerUp,
          secondRunnerUp: data.secondRunnerUp
        };

      } else {

        if (
          !Array.isArray(data.selectedPlayers) ||
          data.selectedPlayers.length !== 2 ||
          data.selectedPlayers[0] === data.selectedPlayers[1] ||
          !roomPlayers.includes(data.selectedPlayers[0]) ||
          !roomPlayers.includes(data.selectedPlayers[1])
        ) {
          return;
        }

        userPicks[roomId] = [
          ...data.selectedPlayers
        ];

      }

      userSavedRooms.add(roomId);

    });

    picks = userPicks;
    savedRooms = userSavedRooms;

    render();

    showNotice(
      "Your saved predictions have been loaded from Firebase.",
      "success"
    );

    console.log(
      "FIRESTORE LOAD SUCCESS:",
      userPicks
    );

  } catch (error) {

    console.error(
      "FIRESTORE LOAD FAILED:",
      error
    );

    showNotice(
      `Unable to load saved predictions: ${
        error.code || ""
      } ${error.message}`,
      "error"
    );

  }

}

// ==========================================
// RENDER
// ==========================================

function render() {

  if (!host) return;

  host.innerHTML = ROOM_ORDER
    .map(roomCard)
    .join("");

  // ========================================
  // PLAYER SELECTION
  // ========================================

  host.querySelectorAll(".prediction-player")
    .forEach(button => {

      button.addEventListener("click", async () => {

        const roomId = button.dataset.room;
        const player = button.dataset.player;

        if (!currentUser) {

          showNotice(
            "Please sign in with Google before submitting predictions.",
            "error"
          );

          return;

        }

        if (
          savingRooms.has(roomId) ||
          roomIsClosed(roomId)
        ) {
          return;
        }

        const selected = Array.isArray(picks[roomId])
          ? picks[roomId]
          : [];

        if (selected.includes(player)) {

          picks[roomId] = selected.filter(
            item => item !== player
          );

        } else if (selected.length < 2) {

          picks[roomId] = [
            ...selected,
            player
          ];

        } else {

          showNotice(
            "You can select exactly 2 players for this room.",
            "error"
          );

          return;

        }

        savedRooms.delete(roomId);

        render();

        if (isValidSelection(roomId)) {

          await savePrediction(roomId);

        } else {

          showNotice(
            `${ROOM_META[roomId].name}: select one more player to submit.`,
            "info"
          );

        }

      });

    });

  // ========================================
  // RESET BUTTONS
  // ========================================

  host.querySelectorAll(".reset-pick")
    .forEach(button => {

      button.addEventListener("click", () => {

        resetPrediction(button.dataset.room);

      });

    });

  // ========================================
  // GRAND FINAL SELECTION
  // ========================================

  host.querySelectorAll(".final-pick")
    .forEach(select => {

      select.addEventListener("change", async () => {

        const roomId = select.dataset.room;
        const position = select.dataset.position;
        const value = select.value;

        if (!currentUser) {

          showNotice(
            "Please sign in with Google before submitting predictions.",
            "error"
          );

          render();

          return;

        }

        if (
          savingRooms.has(roomId) ||
          roomIsClosed(roomId)
        ) {
          return;
        }

        const previous = {
          ...(picks[roomId] || {
            champion: "",
            runnerUp: "",
            secondRunnerUp: ""
          })
        };

        const updated = {
          ...previous,
          [position]: value
        };

        const selectedPositions = [
          updated.champion,
          updated.runnerUp,
          updated.secondRunnerUp
        ].filter(Boolean);

        if (
          new Set(selectedPositions).size !==
          selectedPositions.length
        ) {

          showNotice(
            "Champion, 1st Runner-up and 2nd Runner-up must be different players.",
            "error"
          );

          render();

          return;

        }

        picks[roomId] = updated;
        savedRooms.delete(roomId);

        render();

        if (isValidSelection(roomId)) {

          await savePrediction(roomId);

        } else {

          showNotice(
            "Select all three Grand Final positions to submit.",
            "info"
          );

        }

      });

    });

  // ========================================
  // SIGN-IN MESSAGE
  // ========================================

  if (!currentUser) {

    showNotice(
      "Sign in with Google before submitting predictions."
    );

  }

}

// ==========================================
// LOAD SETTINGS
// ==========================================

async function loadSettings() {

  const stageIds = [
    "preliminary",
    "semifinal",
    "final"
  ];

  const snapshots = await Promise.all(

    stageIds.map(stage =>

      getDoc(
        doc(
          db,
          "settings",
          `rounds_${stage}`
        )
      )

    )

  );

  const newSettings = {};

  stageIds.forEach((stage, index) => {

    newSettings[stage] =
      snapshots[index].exists() &&
      snapshots[index].data().predictionsOpen === true;

  });

  settings = newSettings;

}

// ==========================================
// GOOGLE SIGN-IN / SIGN-OUT
// ==========================================

authBtn?.addEventListener("click", async () => {

  try {

    if (auth.currentUser) {

      await signOut(auth);

    } else {

      await signIn();

    }

  } catch (error) {

    console.error(
      "GOOGLE AUTH ERROR:",
      error
    );

    showNotice(
      `Google sign-in failed: ${error.message}`,
      "error"
    );

  }

});

// ==========================================
// AUTH STATE LISTENER
// ==========================================

onAuthStateChanged(auth, async user => {

  const requestId = ++authRequestId;

  currentUser = user;

  picks = {};
  savedRooms = new Set();
  savingRooms = new Set();

  if (authBtn) {

    authBtn.textContent = user
      ? "SIGN OUT"
      : "SIGN IN WITH GOOGLE";

  }

  render();

  if (user) {

    showNotice(
      `Signed in as ${user.displayName || user.email}. Loading your predictions...`,
      "info"
    );

    await loadUserPredictions(requestId);

  } else {

    showNotice(
      "Sign in with Google before submitting predictions.",
      "info"
    );

  }

});

// ==========================================
// LIVE ROOM DATA
// ==========================================

onSnapshot(

  collection(db, "rooms"),

  async snapshot => {

    const newRooms = {};

    snapshot.forEach(document => {

      newRooms[document.id] = document.data();

    });

    rooms = newRooms;

    try {

      await loadSettings();

      render();

      if (currentUser) {

        await loadUserPredictions(authRequestId);

      }

    } catch (error) {

      console.error(
        "ROOM / SETTINGS LOAD ERROR:",
        error
      );

      showNotice(
        `Unable to load room or settings data: ${error.message}`,
        "error"
      );

    }

  },

  error => {

    console.error(
      "ROOM LISTENER ERROR:",
      error
    );

    showNotice(
      `Unable to load room data: ${error.message}`,
      "error"
    );

  }

);