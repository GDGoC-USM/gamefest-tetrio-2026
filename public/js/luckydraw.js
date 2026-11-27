import {
  auth,
  db,
  isAdmin,
  onAuthStateChanged,
  collection,
  doc,
  getDocFromServer as getDoc,
  getDocsFromServer as getDocs,
  runTransaction,
  serverTimestamp,
  escapeHTML
} from "./shared.js";
import { publicUsername } from "./usernames.js";
import { createDrawStore } from "./lucky-draw-sync.js";

// ==========================================
// LUCKY DRAW CONFIGURATION
// ==========================================

const DRAW_REF = doc(db, "ticketAwards", "currentDraw");
const AWARDS_REF = collection(db, "ticketAwards");
const LEADERBOARD_REF = collection(db, "leaderboard");
const drawStore = createDrawStore({ db, doc, collection, getDoc, getDocs, runTransaction, serverTimestamp });
let drawVersion = null;

const $ = id => document.getElementById(id);

const wheel = $("ldWheel");
const spinBtn = $("ldSpinBtn");
const refreshBtn = $("ldRefreshBtn");

const participantsElement = $("ldParticipants");
const ticketsElement = $("ldTickets");
const winnersElement = $("ldWinners");

const participantsList = $("ldParticipantsList");
const historyElement = $("ldHistory");
const winnerElement = $("ldWinner");
const messageElement = $("ldMessage");

// Editor elements (will be added to admin/index.html).
const addEntryForm = $("ldAddEntryForm");
const newNameInput = $("ldNewName");
const newTicketsInput = $("ldNewTickets");
const editorList = $("ldEditorList");
const editorCount = $("ldEditorCount");
const resetEditsBtn = $("ldResetEditsBtn");

// ==========================================
// DRAW STATE
// ==========================================

let currentEntries = [];
let leaderboardParticipants = [];

let excludedUids = [];
let removedUids = [];

let nameOverrides = {};
let ticketOverrides = {};
let manualParticipants = [];

let previousWinners = [];

let isSpinning = false;
let isAuthorized = false;
let currentRotation = 0;

// ==========================================
// MESSAGE
// ==========================================

function message(text, type = "info") {
  if (!messageElement) return;

  messageElement.textContent = text;
  messageElement.className = `notice ${type}`;
}

// ==========================================
// DATE FORMAT
// ==========================================

function formatDate(value) {
  if (!value) return "Date unavailable";

  const date = value.toDate
    ? value.toDate()
    : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Date unavailable";
  }

  return date.toLocaleString();
}

// ==========================================
// NORMALIZE SAVED SETTINGS
// ==========================================

function loadDrawSettings(data = {}) {
  excludedUids = Array.isArray(data.excludedUids)
    ? data.excludedUids
    : [];

  removedUids = Array.isArray(data.removedUids)
    ? data.removedUids
    : [];

  nameOverrides =
    data.nameOverrides &&
    typeof data.nameOverrides === "object"
      ? data.nameOverrides
      : {};

  ticketOverrides =
    data.ticketOverrides &&
    typeof data.ticketOverrides === "object"
      ? data.ticketOverrides
      : {};

  manualParticipants = Array.isArray(data.manualParticipants)
    ? data.manualParticipants
    : [];
}

// ==========================================
// SAVE DRAW SETTINGS
// ==========================================

async function saveDrawSettings() {
  try {
    const saved = await drawStore.save(drawVersion, {
      removedUids, nameOverrides, ticketOverrides, manualParticipants
    });
    drawVersion = saved.version;
  } catch (error) {
    drawVersion = null;
    currentEntries = [];
    renderParticipants();
    throw error;
  }
}

// ==========================================
// LOAD SAVED DRAW
// ==========================================

async function loadSavedDraw() {
  if (!isAuthorized || isSpinning) return;
  isSpinning = true;
  spinBtn.disabled = true;
  refreshBtn.disabled = true;
  try {
    const [snapshot, leaderboardSnapshot] = await Promise.all([
      getDoc(DRAW_REF), getDocs(LEADERBOARD_REF)
    ]);
    if (!isAuthorized) return;
    if (!snapshot.exists()) {
      isSpinning = false;
      await refreshTickets();
      return;
    }
    const data = snapshot.data();
    drawVersion = data.version || null;
    loadDrawSettings(data);
    leaderboardParticipants = leaderboardSnapshot.docs.map(item => ({ ...item.data(), uid: item.id }));
    currentEntries = Array.isArray(data.entries)
      ? data.entries.map(entry => ({ ...entry, displayName: publicUsername(entry.displayName) }))
      : [];
    winnerElement.innerHTML = data.lastWinner
      ? `<span>LAST WINNER</span><strong>${escapeHTML(publicUsername(data.lastWinner.displayName))}</strong>`
      : `<span>WAITING FOR THE DRAW</span><strong>GOOD LUCK!</strong>`;
    renderParticipants();
    await loadHistory();
  } catch (error) {
    drawVersion = null;
    currentEntries = [];
    renderParticipants();
    message(`Unable to load the draw. Refresh before retrying: ${error.message}`, "error");
  } finally {
    isSpinning = false;
    refreshBtn.disabled = !isAuthorized;
    spinBtn.disabled = !isAuthorized || currentEntries.length === 0;
  }
}

// ==========================================
// REFRESH FROM LATEST LEADERBOARD
// ==========================================

async function refreshTickets() {
  if (!isAuthorized || isSpinning) return;
  isSpinning = true;
  spinBtn.disabled = true;
  refreshBtn.disabled = true;
  message("Validating prediction awards and manual tickets...");
  try {
    const { draw, rows } = await drawStore.refresh();
    loadDrawSettings(draw);
    drawVersion = draw.version;
    leaderboardParticipants = rows;
    currentEntries = draw.entries;
    renderParticipants();
    await loadHistory();
    message(`Validated ${currentEntries.length} entries from prediction awards and manual tickets. Previous winners remain excluded.`, "success");
    return true;
  } catch (error) {
    currentEntries = [];
    renderParticipants();
    message(`Unable to validate entries: ${error.message}`, "error");
    return false;
  } finally {
    isSpinning = false;
    refreshBtn.disabled = !isAuthorized;
    spinBtn.disabled = !isAuthorized || currentEntries.length === 0;
  }
}

// ==========================================
// GROUP TICKETS BY PARTICIPANT
// ==========================================

function getParticipantGroups() {
  const groups = new Map();

  currentEntries.forEach(entry => {
    if (!groups.has(entry.uid)) {
      groups.set(entry.uid, {
        uid: entry.uid,
        displayName: publicUsername(entry.displayName),
        tickets: 0
      });
    }

    groups.get(entry.uid).tickets++;
  });

  return [...groups.values()];
}

// ==========================================
// RENDER PARTICIPANT EDITOR
// ==========================================

function getEditorParticipants() {
  const leaderboardPeople = leaderboardParticipants
    .filter(person =>
      !excludedUids.includes(person.uid) &&
      !removedUids.includes(person.uid)
    )
    .map(person => {
      const uid = person.uid;

      const originalTickets = Math.max(
        0,
        Math.floor(Number(person.correct) || 0)
      );

      const tickets = Object.prototype.hasOwnProperty.call(
        ticketOverrides,
        uid
      )
        ? Math.max(0, Math.floor(Number(ticketOverrides[uid]) || 0))
        : originalTickets;

      const originalName = publicUsername(person.displayName);

      const displayName = Object.prototype.hasOwnProperty.call(
        nameOverrides,
        uid
      )
        ? publicUsername(nameOverrides[uid])
        : originalName;

      return { uid, displayName, tickets };
    });

  const manualPeople = manualParticipants
    .filter(person => !excludedUids.includes(`manual:${person.id}`))
    .map(person => ({
      uid: `manual:${person.id}`,
      displayName: publicUsername(person.displayName),
      tickets: Math.max(0, Math.floor(Number(person.tickets) || 0))
    }));

  return [...leaderboardPeople, ...manualPeople];
}

function renderEditor() {
  if (!editorList) return;

  const people = getEditorParticipants();

  if (editorCount) {
    editorCount.textContent = people.length;
  }

  if (!people.length) {
    editorList.innerHTML = `
      <p class="muted">
        No participants available to edit.
      </p>
    `;
    return;
  }

  editorList.innerHTML = people.map(person => `
    <div class="ld-editor-row" data-editor-uid="${escapeHTML(person.uid)}">

      <div class="ld-editor-fields">

        <label>
          <span>Participant name</span>
          <input
            type="text"
            data-edit-name
            value="${escapeHTML(person.displayName)}"
            maxlength="60"
          >
        </label>

        <label>
          <span>Tickets</span>
          <input
            type="number"
            data-edit-tickets
            value="${person.tickets}"
            min="0"
            max="10000"
            step="1"
          >
        </label>

      </div>

      <div class="ld-editor-actions">
        <button
          type="button"
          class="btn secondary"
          data-save-participant
        >
          SAVE
        </button>

        <button
          type="button"
          class="btn secondary ld-remove-btn"
          data-remove-participant
        >
          REMOVE
        </button>
      </div>

    </div>
  `).join("");
}

// ==========================================
// RENDER PARTICIPANTS
// ==========================================

function renderParticipants() {
  const groups = getParticipantGroups();

  const totalTickets = currentEntries.length;

  participantsElement.textContent = groups.length;
  ticketsElement.textContent = totalTickets;
  winnersElement.textContent = previousWinners.length;

  spinBtn.disabled =
    isSpinning || totalTickets === 0;

  renderEditor();

  if (!groups.length) {
    participantsList.innerHTML = `
      <p class="muted">
        No eligible participants.
        Refresh the latest leaderboard to check entries.
      </p>
    `;

    renderWheel();
    return;
  }

  participantsList.innerHTML = groups.map(person => {
    const percentage = totalTickets
      ? (person.tickets / totalTickets) * 100
      : 0;

    return `
      <div class="ld-participant-row">

        <div class="ld-participant-info">

          <strong>
            ${escapeHTML(person.displayName)}
          </strong>

          <span>
            ${person.tickets} ${
              person.tickets === 1 ? "entry" : "entries"
            }
          </span>

        </div>

        <div class="ld-progress">
          <div
            class="ld-progress-fill"
            style="width:${percentage}%"
          ></div>
        </div>

      </div>
    `;
  }).join("");

  renderWheel();
}

// ==========================================
// UPDATE PARTICIPANT ENTRIES
// ==========================================

function replaceParticipantEntries(uid, displayName, tickets) {
  currentEntries = currentEntries.filter(
    entry => entry.uid !== uid
  );

  for (let i = 0; i < tickets; i++) {
    currentEntries.push({
      uid,
      displayName
    });
  }
}

// ==========================================
// EDIT PARTICIPANT DETAILS
// ==========================================

async function updateParticipant(uid, displayName, tickets) {
  const cleanName = String(displayName || "").trim();

  if (!cleanName) {
    message("Please enter a participant name.", "error");
    return;
  }

  const cleanTickets = Math.max(
    0,
    Math.min(10000, Math.floor(Number(tickets) || 0))
  );

  const safeName = publicUsername(cleanName);

  if (uid.startsWith("manual:")) {
    const manualId = uid.substring("manual:".length);

    manualParticipants = manualParticipants.map(person => {
      if (person.id !== manualId) return person;

      return {
        ...person,
        displayName: safeName,
        tickets: cleanTickets
      };
    });

  } else {
    nameOverrides[uid] = safeName;
    ticketOverrides[uid] = cleanTickets;
  }

  replaceParticipantEntries(uid, safeName, cleanTickets);

  await saveDrawSettings();

  renderParticipants();

  message(
    `${safeName}'s details have been saved.`,
    "success"
  );
}

// ==========================================
// REMOVE PARTICIPANT FROM LUCKY DRAW
// ==========================================

async function removeParticipant(uid) {
  if (!uid) return;

  const person = getEditorParticipants().find(
    item => item.uid === uid
  );

  if (!person) return;

  const confirmed = confirm(
    `Remove ${person.displayName} from this Lucky Draw?\n\n` +
    `Their leaderboard record will not be deleted.`
  );

  if (!confirmed) return;

  if (uid.startsWith("manual:")) {
    const manualId = uid.substring("manual:".length);

    manualParticipants = manualParticipants.filter(
      person => person.id !== manualId
    );

  } else if (!removedUids.includes(uid)) {
    removedUids.push(uid);
  }

  currentEntries = currentEntries.filter(
    entry => entry.uid !== uid
  );

  await saveDrawSettings();

  renderParticipants();

  message(
    `${person.displayName} has been removed from the Lucky Draw.`,
    "success"
  );
}

// ==========================================
// ADD MANUAL PARTICIPANT
// ==========================================

async function addManualParticipant(event, operationStarted = false) {
  event.preventDefault();

  if (!isAuthorized || (isSpinning && !operationStarted)) return;

  const displayName = String(newNameInput?.value || "").trim();

  const tickets = Math.max(
    1,
    Math.min(10000, Math.floor(Number(newTicketsInput?.value) || 1))
  );

  if (!displayName) {
    message("Please enter a participant name.", "error");
    return;
  }

  const id = `manual-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;

  const participant = {
    id,
    displayName: publicUsername(displayName),
    tickets
  };

  manualParticipants.push(participant);

  const uid = `manual:${id}`;

  for (let i = 0; i < tickets; i++) {
    currentEntries.push({
      uid,
      displayName: participant.displayName
    });
  }

  await saveDrawSettings();

  addEntryForm.reset();

  if (newTicketsInput) {
    newTicketsInput.value = "1";
  }

  renderParticipants();

  message(
    `${participant.displayName} has been added with ${tickets} ${
      tickets === 1 ? "ticket" : "tickets"
    }.`,
    "success"
  );
}

// ==========================================
// RESET CUSTOM EDITS
// ==========================================

async function resetEdits() {
  if (!isAuthorized || isSpinning) return;

  const confirmed = confirm(
    "Reset all Lucky Draw edits?\n\n" +
    "This will:\n" +
    "- Remove custom name changes\n" +
    "- Restore original leaderboard ticket quantities\n" +
    "- Remove manually added participants\n" +
    "- Restore manually removed leaderboard participants\n\n" +
    "Previous winners and winner history will remain unchanged."
  );

  if (!confirmed) return;

  try {
    isSpinning = true;
    nameOverrides = {};
    ticketOverrides = {};
    manualParticipants = [];
    removedUids = [];

    await saveDrawSettings();

    isSpinning = false;
    if (!await refreshTickets()) return;

    message(
      "Lucky Draw edits have been reset to the latest leaderboard data.",
      "success"
    );

  } catch (error) {
    console.error("Reset edits error:", error);

    message(
      `Unable to reset edits: ${error.message}`,
      "error"
    );
  } finally {
    isSpinning = false;
  }
}

// ==========================================
// RENDER WHEEL WITH PARTICIPANT NAMES
// ==========================================

function renderWheel() {
  wheel.querySelectorAll(".ld-wheel-label").forEach(label => {
    label.remove();
  });

  if (!currentEntries.length) {
    wheel.style.background =
      "conic-gradient(#292346, #17142b, #292346)";

    return;
  }

  const colors = [
    "#8a4bd8",
    "#d94c70",
    "#5140a0",
    "#a66be8",
    "#6c367f",
    "#c34b91",
    "#493b85",
    "#b35ac6"
  ];

  const total = currentEntries.length;
  const segments = [];

  currentEntries.forEach((entry, index) => {
    const start = index / total * 360;
    const end = (index + 1) / total * 360;
    const color = colors[index % colors.length];

    segments.push(`${color} ${start}deg ${end}deg`);
  });

  wheel.style.background =
    `conic-gradient(${segments.join(",")})`;

  // One label for every ticket.
  currentEntries.forEach((entry, index) => {
    const angle = (index + 0.5) * (360 / total);

    const label = document.createElement("span");

    label.className = "ld-wheel-label";
    label.textContent = publicUsername(entry.displayName);
    label.title = label.textContent;

    // Position each label along its ticket's radial line.
    label.style.transform =
      `translate(-50%, -50%) rotate(${angle}deg) translateY(-108px) rotate(-90deg)`;

    if (total > 30) {
      label.style.fontSize = "6px";
    } else if (total > 20) {
      label.style.fontSize = "7px";
    } else if (total > 12) {
      label.style.fontSize = "8px";
    } else {
      label.style.fontSize = "10px";
    }

    wheel.appendChild(label);
  });

  const center = wheel.querySelector(".luckydraw-wheel-center");

  if (center) {
    center.style.zIndex = "2";
  }
}

// ==========================================
// SPIN WHEEL
// ==========================================

async function spinWheel() {
  if (!isAuthorized || isSpinning) return;
  isSpinning = true;
  spinBtn.disabled = true;
  refreshBtn.disabled = true;
  message("Validating tickets and saving the winner...");
  let committed = false;
  try {
    const result = await drawStore.spin(drawVersion);
    committed = true;
    const { entries, winningIndex, winner, draw } = result;
    const winnerName = publicUsername(winner.displayName);
    currentEntries = entries;
    renderWheel();
    winnerElement.innerHTML = `<span>GOOD LUCK!</span><strong>SPINNING...</strong>`;
    const winningCenter = (winningIndex + 0.5) * (360 / entries.length);
    const normalizedRotation = ((currentRotation % 360) + 360) % 360;
    const offset = ((360 - winningCenter - normalizedRotation) % 360 + 360) % 360;
    currentRotation += 360 * 6 + offset;
    wheel.style.transform = `rotate(${currentRotation}deg)`;
    await new Promise(resolve => setTimeout(resolve, 5200));
    loadDrawSettings(draw);
    drawVersion = draw.version;
    currentEntries = draw.entries;
    winnerElement.innerHTML = `
      <span>WINNER!</span><strong>${escapeHTML(winnerName)}</strong>
      <small>Selected from ${winner.ticketsAtWin} ${winner.ticketsAtWin === 1 ? "entry" : "entries"}!</small>`;
    renderParticipants();
    await loadHistory();
    message(`${winnerName} has won! Their entries are excluded and the winner is saved.`, "success");
  } catch (error) {
    drawVersion = null;
    currentEntries = [];
    renderParticipants();
    message(`${committed ? "Winner saved; reload the draw to recover its display" : "Draw not confirmed; refresh entries and history before retrying"}: ${error.message}`, "error");
  } finally {
    isSpinning = false;
    refreshBtn.disabled = !isAuthorized;
    spinBtn.disabled = !isAuthorized || currentEntries.length === 0;
  }
}

// ==========================================
// UNDO ANY SELECTED WINNER
// ==========================================

async function undoSelectedWinner(historyId) {
  if (!isAuthorized || isSpinning) return;
  const selectedWinner = previousWinners.find(winner => winner.id === historyId);
  if (!selectedWinner) {
    message("Winner record not found. Refresh and try again.", "error");
    return;
  }
  const winnerName = publicUsername(selectedWinner.displayName);
  if (!confirm(`Undo ${winnerName}'s win? Historical entries will be restored. Refresh Latest Entries to validate current weights before spinning again.`)) return;
  isSpinning = true;
  spinBtn.disabled = true;
  refreshBtn.disabled = true;
  message(`Restoring ${winnerName}'s eligibility...`);
  try {
    const draw = await drawStore.undo(historyId);
    loadDrawSettings(draw);
    drawVersion = draw.version;
    currentEntries = draw.entries;
    winnerElement.innerHTML = draw.lastWinner
      ? `<span>LAST WINNER</span><strong>${escapeHTML(publicUsername(draw.lastWinner.displayName))}</strong>`
      : `<span>WAITING FOR THE DRAW</span><strong>GOOD LUCK!</strong>`;
    renderParticipants();
    await loadHistory();
    message(`${winnerName}'s win was undone. Refresh Latest Entries before spinning.`, "success");
  } catch (error) {
    drawVersion = null;
    currentEntries = [];
    renderParticipants();
    message(`Undo not confirmed. Refresh entries and history before retrying: ${error.message}`, "error");
  } finally {
    isSpinning = false;
    refreshBtn.disabled = !isAuthorized;
    spinBtn.disabled = !isAuthorized || currentEntries.length === 0;
  }
}

// ==========================================
// LOAD WINNER HISTORY
// ==========================================

async function loadHistory() {
  if (!isAuthorized) return;

  try {
    const snapshot = await getDocs(AWARDS_REF);

    const history = snapshot.docs
      .filter(item => {
        const data = item.data();

        return (
          item.id !== "currentDraw" &&
          data.type === "winner"
        );
      })
      .map(item => {
        const data = item.data();

        return {
          id: item.id,
          ...data,
          displayName: publicUsername(data.displayName)
        };
      })
      .sort((a, b) => {
        const dateA = a.drawnAt?.toMillis
          ? a.drawnAt.toMillis()
          : new Date(a.drawnAt || 0).getTime();

        const dateB = b.drawnAt?.toMillis
          ? b.drawnAt.toMillis()
          : new Date(b.drawnAt || 0).getTime();

        return dateB - dateA;
      });

    previousWinners = history;

    winnersElement.textContent = history.length;

    if (!history.length) {
      historyElement.innerHTML = `
        <p class="muted">
          No winners yet.
        </p>
      `;

      return;
    }

    historyElement.innerHTML = history.map((person, index) => `
      <div class="ld-history-row">

        <div class="ld-history-rank">
          ${index + 1}
        </div>

        <div class="ld-history-info">

          <strong>
            ${escapeHTML(person.displayName)}
          </strong>

          <span>
            ${formatDate(person.drawnAt)}
          </span>

        </div>

        <span class="ld-history-ticket">
          ${Number(person.ticketsAtWin) || 0} ${
            Number(person.ticketsAtWin) === 1 ? "entry" : "entries"
          }
        </span>

        <button
          type="button"
          class="btn secondary"
          data-undo-winner="${escapeHTML(person.id)}"
          style="min-width:auto;padding:7px 12px;font-size:11px;"
        >
          ↩ UNDO
        </button>

      </div>
    `).join("");

  } catch (error) {
    console.error("Winner history error:", error);

    historyElement.innerHTML = `
      <p class="muted">
        Unable to load winner history.
      </p>
    `;
  }
}

// ==========================================
// WINNER HISTORY UNDO BUTTON EVENTS
// ==========================================

historyElement.addEventListener("click", event => {
  const button = event.target.closest("[data-undo-winner]");

  if (!button) return;

  const historyId = button.dataset.undoWinner;

  if (!historyId) return;

  undoSelectedWinner(historyId);
});

// ==========================================
// PARTICIPANT EDITOR EVENTS
// ==========================================

if (editorList) {
  editorList.addEventListener("click", async event => {
    if (!isAuthorized || isSpinning) return;
    const saveButton = event.target.closest("[data-save-participant]");
    const removeButton = event.target.closest("[data-remove-participant]");

    const row = event.target.closest("[data-editor-uid]");

    if (!row) return;

    const uid = row.dataset.editorUid;

    if (!uid) return;

    if (saveButton) {
      const nameInput = row.querySelector("[data-edit-name]");
      const ticketsInput = row.querySelector("[data-edit-tickets]");

      if (!nameInput || !ticketsInput) return;

      try {
        isSpinning = true;
        saveButton.disabled = true;

        await updateParticipant(
          uid,
          nameInput.value,
          ticketsInput.value
        );

      } catch (error) {
        console.error("Participant update error:", error);

        message(
          `Unable to save participant changes: ${error.message}`,
          "error"
        );

      } finally {
        isSpinning = false;
        saveButton.disabled = false;
      }

      return;
    }

    if (removeButton) {
      try {
        isSpinning = true;
        removeButton.disabled = true;
        await removeParticipant(uid);

      } catch (error) {
        console.error("Remove participant error:", error);

        message(
          `Unable to remove participant: ${error.message}`,
          "error"
        );

      } finally {
        isSpinning = false;
        removeButton.disabled = false;
      }
    }
  });
}

// ==========================================
// ADD PARTICIPANT FORM
// ==========================================

if (addEntryForm) {
  addEntryForm.addEventListener("submit", async event => {
    event.preventDefault();
    if (!isAuthorized || isSpinning) return;
    try {
      isSpinning = true;
      await addManualParticipant(event, true);
    } catch (error) {
      console.error("Add participant error:", error);

      message(
        `Unable to add participant: ${error.message}`,
        "error"
      );
    } finally {
      isSpinning = false;
    }
  });
}

// ==========================================
// RESET EDITS BUTTON
// ==========================================

if (resetEditsBtn) {
  resetEditsBtn.addEventListener("click", resetEdits);
}

// ==========================================
// BUTTON EVENTS
// ==========================================

refreshBtn.addEventListener("click", refreshTickets);
spinBtn.addEventListener("click", spinWheel);

// ==========================================
// ADMIN AUTHENTICATION
// ==========================================

onAuthStateChanged(auth, async user => {
  isAuthorized = false;
  drawVersion = null;
  currentEntries = [];
  previousWinners = [];
  renderParticipants();

  spinBtn.disabled = true;
  refreshBtn.disabled = true;

  if (!user) {
    message("Administrator sign-in required.", "error");
    return;
  }

  try {
    const authorized = await isAdmin(user);

    if (!authorized) {
      message(
        "You do not have permission to access Lucky Draw.",
        "error"
      );

      return;
    }

    isAuthorized = true;

    refreshBtn.disabled = false;

    await loadSavedDraw();

  } catch (error) {
    console.error(error);

    message(
      "Unable to verify administrator access.",
      "error"
    );
  }
});

// ==========================================
// ADMIN NAVIGATION
// ==========================================

document.querySelectorAll(".nav-btn").forEach(button => {
  if (button.dataset.section !== "luckydraw") return;

  button.addEventListener("click", async () => {
    if (!isAuthorized) return;
    if (isSpinning) return;

    await loadSavedDraw();
  });
});