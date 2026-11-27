
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
import { createDrawStore, ticketCount } from "./lucky-draw-sync.js?v=60bf4d6";
import {
  createManualParticipantId,
  manualDisplayName,
  normalizeParticipantName,
  parseBulkParticipants
} from "./lucky-draw-import.js";

import {
  labelRadiusFor,
  segmentCenterAngle,
  targetRotationForWinner
} from "./lucky-wheel-geometry.js";

import { launchConfetti } from "./lucky-confetti.js";

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
const presentationBtn = $("ldPresentationBtn");

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
const removedList = $("ldRemovedList");
const removedCount = $("ldRemovedCount");
const resetEditsBtn = $("ldResetEditsBtn");

// Bulk import elements.
const bulkNamesInput = $("ldBulkNames");
const bulkPreviewBtn = $("ldBulkPreviewBtn");
const bulkPreview = $("ldBulkPreview");
const bulkSummary = $("ldBulkSummary");
const bulkPreviewList = $("ldBulkPreviewList");
const bulkImportBtn = $("ldBulkImportBtn");

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
let bulkPreviewState = null;
let bulkPreviewText = "";
let bulkPreviewExistingSignature = "";

// ==========================================
// PRESENTATION MODE
// ==========================================

function setPresentationMode(enabled) {
  document.body.classList.toggle(
    "ld-presentation-mode",
    enabled
  );

  if (presentationBtn) {
    presentationBtn.setAttribute(
      "aria-pressed",
      String(enabled)
    );

    presentationBtn.textContent = enabled
      ? "EXIT PRESENTATION MODE"
      : "ENTER PRESENTATION MODE";
  }

  // The wheel resizes with the presentation class. Realign labels without
  // rebuilding segments, which would move the frozen winning segment.
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(positionWheelLabels);
  }
}

if (presentationBtn) {
  presentationBtn.addEventListener("click", () => {
    const isActive = document.body.classList.contains(
      "ld-presentation-mode"
    );

    setPresentationMode(!isActive);
  });
}

document.addEventListener("admin-section-change", event => {
  if (event.detail?.sectionId !== "luckydraw") {
    setPresentationMode(false);
  }
});

// ==========================================
// MESSAGE
// ==========================================

function message(text, type = "info") {
  if (!messageElement) return;

  messageElement.textContent = text;
  messageElement.className = `notice ${type}`;
}

// Manual entries are administrator-entered text, not profile names. Keep their
// spelling and case, and render them only through textContent/escapeHTML.
function entryDisplayName(entry) {
  return String(entry?.uid || "").startsWith("manual:")
    ? manualDisplayName(entry.displayName)
    : publicUsername(entry.displayName);
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
  clearBulkPreview();
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
    const hiddenUids = new Set([...excludedUids, ...removedUids]);
    currentEntries = Array.isArray(data.entries)
      ? data.entries
        .filter(entry => !hiddenUids.has(entry.uid))
        .map(entry => ({ ...entry, displayName: entryDisplayName(entry) }))
      : [];
    winnerElement.innerHTML = data.lastWinner
      ? `<span>LAST WINNER</span><strong>${escapeHTML(entryDisplayName(data.lastWinner))}</strong>`
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

async function refreshTickets({ allowDuringOperation = false } = {}) {
  if (!isAuthorized || (isSpinning && !allowDuringOperation)) return false;
  clearBulkPreview();
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
    message(
      `${currentEntries.length} eligible ${
        currentEntries.length === 1 ? "ticket" : "tickets"
      } ready for the draw.`,
      "success"
    );
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
        displayName: entryDisplayName(entry),
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

      const originalTickets = ticketCount(person.correct);

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
    .filter(person => {
      const uid = `manual:${person.id}`;
      return !excludedUids.includes(uid) && !removedUids.includes(uid);
    })
    .map(person => ({
      uid: `manual:${person.id}`,
      displayName: manualDisplayName(person.displayName),
      tickets: Math.max(0, Math.floor(Number(person.tickets) || 0))
    }));

  return [...leaderboardPeople, ...manualPeople];
}

// Resolve a persisted participant key to its current lottery source. A
// leaderboard removal must keep using the authoritative ticket count, while a
// manual participant keeps the administrator-configured count and name.
function currentParticipant(uid) {
  if (String(uid).startsWith("manual:")) {
    const manualId = uid.substring("manual:".length);
    const person = manualParticipants.find(item => item.id === manualId);

    return person
      ? {
        uid,
        displayName: manualDisplayName(person.displayName),
        tickets: Math.max(0, Math.floor(Number(person.tickets) || 0)),
        kind: "manual"
      }
      : null;
  }

  const person = leaderboardParticipants.find(item => item.uid === uid);

  if (!person) return null;

  return {
    uid,
    displayName: Object.prototype.hasOwnProperty.call(nameOverrides, uid)
      ? publicUsername(nameOverrides[uid])
      : publicUsername(person.displayName),
    tickets: ticketCount(person.correct),
    kind: "leaderboard"
  };
}

function participantIdentity(uid) {
  return String(uid).startsWith("manual:")
    ? `Manual ID ${uid.substring("manual:".length)}`
    : `UID ${uid}`;
}

function getRemovedParticipants() {
  return [...new Set(removedUids)]
    .filter(uid => !excludedUids.includes(uid))
    .map(uid => {
      const person = currentParticipant(uid);

      if (person) return person;

      // Keep stale exclusions visible so a maintainer can clear them, even if
      // participant cleanup already removed the underlying leaderboard row.
      return {
        uid,
        displayName: Object.prototype.hasOwnProperty.call(nameOverrides, uid)
          ? publicUsername(nameOverrides[uid])
          : "Participant",
        tickets: 0,
        kind: String(uid).startsWith("manual:") ? "manual" : "leaderboard",
        unavailable: true
      };
    });
}

function renderRemovedParticipants() {
  if (!removedList) return;

  const people = getRemovedParticipants();

  if (removedCount) {
    removedCount.textContent = people.length;
  }

  if (!people.length) {
    removedList.innerHTML = `
      <p class="muted">
        No removed participants. Remove someone from Edit Entries to exclude
        all of their tickets.
      </p>
    `;
    return;
  }

  removedList.innerHTML = people.map(person => {
    const plural = person.tickets === 1 ? "entry" : "entries";
    const identity = escapeHTML(participantIdentity(person.uid));
    const status = person.unavailable
      ? `${identity} · no current ticket source`
      : `${identity} · ${person.tickets} ${plural}`;

    return `
      <div class="ld-removed-row" data-removed-uid="${escapeHTML(person.uid)}">

        <div class="ld-removed-info">
          <strong>${escapeHTML(person.displayName)}</strong>
          <span>${status}</span>
        </div>

        <button
          type="button"
          class="btn secondary ld-restore-btn"
          data-restore-participant
        >
          RESTORE
        </button>

      </div>
    `;
  }).join("");
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

        <span class="ld-editor-id">
          ${escapeHTML(participantIdentity(person.uid))}
        </span>

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

function renderParticipants({ preserveWheel = false } = {}) {
  const groups = getParticipantGroups();

  const totalTickets = currentEntries.length;

  participantsElement.textContent = groups.length;
  ticketsElement.textContent = totalTickets;
  winnersElement.textContent = previousWinners.length;

  spinBtn.disabled =
    isSpinning || totalTickets === 0;

  renderEditor();
  renderRemovedParticipants();

  if (!groups.length) {
    participantsList.innerHTML = `
      <p class="muted">
        No eligible participants.
        Refresh the latest leaderboard to check entries.
      </p>
    `;

    if (!preserveWheel) {
      renderWheel();
    }

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

  if (!preserveWheel) {
    renderWheel();
  }
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

  const safeName = uid.startsWith("manual:")
    ? manualDisplayName(cleanName)
    : publicUsername(cleanName);

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

  const ticketText = `${person.tickets} ${
    person.tickets === 1 ? "entry" : "entries"
  }`;

  const confirmed = confirm(
    `Remove ${person.displayName} (${participantIdentity(uid)}) from this Lucky Draw?\n\n` +
    `All ${ticketText} will be excluded. Their leaderboard score, predictions ` +
    `and account are not changed. You can restore them later.`
  );

  if (!confirmed) return;

  const previousRemoved = [...removedUids];
  const previousEntries = currentEntries;

  if (!removedUids.includes(uid)) {
    removedUids.push(uid);
  }

  currentEntries = currentEntries.filter(
    entry => entry.uid !== uid
  );

  try {
    await saveDrawSettings();
  } catch (error) {
    removedUids = previousRemoved;
    currentEntries = previousEntries;
    throw error;
  }

  renderParticipants();

  message(
    `${person.displayName} has been removed. ${ticketText} excluded; ` +
    `restore them from Removed Participants if needed.`,
    "success"
  );
}

// ==========================================
// RESTORE REMOVED PARTICIPANT
// ==========================================

async function restoreParticipant(uid) {
  if (!uid) return;

  const person = getRemovedParticipants().find(
    item => item.uid === uid
  );

  if (!person) return;

  const confirmed = confirm(
    `Restore ${person.displayName} (${participantIdentity(uid)}) to this Lucky Draw?\n\n` +
    `Their current ticket eligibility will be recalculated from the ` +
    `leaderboard or manual participant settings.`
  );

  if (!confirmed) return;

  const previousRemoved = [...removedUids];

  removedUids = removedUids.filter(item => item !== uid);

  try {
    await saveDrawSettings();
  } catch (error) {
    removedUids = previousRemoved;
    throw error;
  }

  // Saving invalidates the certified pool. Refresh now so restored tickets
  // use the current leaderboard counts instead of a stale snapshot.
  const refreshed = await refreshTickets({ allowDuringOperation: true });

  if (!refreshed) return;

  const restored = currentParticipant(uid);

  if (!restored) {
    message(
      `${participantIdentity(uid)} was restored, but no current ticket source was found.`,
      "info"
    );
    return;
  }

  message(
    `${restored.displayName} has been restored with ${restored.tickets} ${
      restored.tickets === 1 ? "entry" : "entries"
    }.`,
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

  const id = createManualParticipantId(
    manualParticipants.map(person => person.id)
  );

  const participant = {
    id,
    displayName: manualDisplayName(displayName),
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
// BULK MANUAL IMPORT
// ==========================================

function bulkExistingSignature() {
  return getEditorParticipants()
    .map(person => normalizeParticipantName(person.displayName))
    .sort()
    .join("\n");
}

function clearBulkPreview() {
  bulkPreviewState = null;
  bulkPreviewText = "";
  bulkPreviewExistingSignature = "";

  if (bulkPreview) bulkPreview.hidden = true;
  if (bulkPreviewList) bulkPreviewList.replaceChildren();

  if (bulkSummary) {
    bulkSummary.textContent = "";
    bulkSummary.className = "ld-bulk-summary";
  }

  if (bulkImportBtn) {
    bulkImportBtn.disabled = true;
    bulkImportBtn.textContent = "IMPORT PARTICIPANTS";
  }
}

function renderBulkPreview(result) {
  if (!bulkPreview) return;

  bulkPreview.hidden = false;
  const plural = result.total === 1 ? "" : "s";

  if (!result.entries.length) {
    if (bulkSummary) {
      bulkSummary.textContent = result.errors[0] || "No names to preview.";
      bulkSummary.className = "ld-bulk-summary ld-bulk-error";
    }
    if (bulkPreviewList) bulkPreviewList.replaceChildren();
  } else {
    const errorCount = result.errors.length;
    const warning = result.duplicateCount === 1
      ? "1 duplicate warning"
      : `${result.duplicateCount} duplicate warnings`;
    const errorNote = errorCount
      ? ` · ${errorCount} name${errorCount === 1 ? "" : "s"} too long`
      : "";

    if (bulkSummary) {
      bulkSummary.textContent =
        `${result.total} participant${plural} · ${warning}${errorNote}`;
      bulkSummary.className = errorCount
        ? "ld-bulk-summary ld-bulk-error"
        : "ld-bulk-summary";
    }

    const rows = result.entries.map(entry => {
      const row = document.createElement("div");
      row.className = "ld-bulk-row";

      if (entry.duplicate) row.classList.add("ld-bulk-duplicate");
      if (entry.error) row.classList.add("ld-bulk-invalid");

      const name = document.createElement("span");
      name.className = "ld-bulk-name";
      name.textContent = entry.name;

      const meta = document.createElement("span");
      meta.className = "ld-bulk-meta";

      if (entry.error) {
        meta.textContent = entry.error;
      } else if (entry.duplicate) {
        const reasons = [];
        if (entry.duplicateInPaste) reasons.push("duplicate in list");
        if (entry.duplicateExisting) reasons.push("already in wheel");
        meta.textContent = reasons.join(" · ");
      }

      row.append(name, meta);
      return row;
    });

    if (bulkPreviewList) bulkPreviewList.replaceChildren(...rows);
  }

  if (bulkImportBtn) {
    bulkImportBtn.disabled = !result.canImport;
    bulkImportBtn.textContent = result.canImport
      ? `IMPORT ${result.total} PARTICIPANT${plural.toUpperCase()}`
      : "FIX VALIDATION ERRORS";
  }
}

function previewBulkImport() {
  if (!isAuthorized || isSpinning || !bulkNamesInput) return;

  const text = bulkNamesInput.value;
  const result = parseBulkParticipants(
    text,
    getEditorParticipants().map(person => person.displayName)
  );

  bulkPreviewState = result;
  bulkPreviewText = text;
  bulkPreviewExistingSignature = bulkExistingSignature();

  renderBulkPreview(result);
}

async function importBulkPreview(operationStarted = false) {
  if (!isAuthorized || (isSpinning && !operationStarted)) return;
  if (!bulkPreviewState?.canImport) return;

  if ((bulkNamesInput?.value || "") !== bulkPreviewText) {
    clearBulkPreview();
    message("The participant list changed after preview. Preview it again before importing.", "error");
    return;
  }

  if (bulkPreviewExistingSignature !== bulkExistingSignature()) {
    clearBulkPreview();
    message("Participant names changed after preview. Preview the list again before importing.", "error");
    return;
  }

  const imported = [];
  const usedIds = new Set(manualParticipants.map(person => person.id));

  for (const entry of bulkPreviewState.entries) {
    const id = createManualParticipantId(usedIds);
    usedIds.add(id);
    imported.push({ id, displayName: entry.name, tickets: 1 });
  }

  const previousParticipants = manualParticipants;
  const previousEntries = currentEntries;

  manualParticipants = [...manualParticipants, ...imported];
  currentEntries = [
    ...currentEntries,
    ...imported.map(person => ({
      uid: `manual:${person.id}`,
      displayName: person.displayName
    }))
  ];

  try {
    // One transaction persists every imported participant and invalidates the
    // certified ticket pool with the existing draw-version fence.
    await saveDrawSettings();
  } catch (error) {
    manualParticipants = previousParticipants;
    currentEntries = previousEntries;
    renderParticipants();
    throw error;
  }

  const duplicateCount = bulkPreviewState.duplicateCount;
  const totalPeople = getEditorParticipants().length;

  clearBulkPreview();

  if (bulkNamesInput) {
    bulkNamesInput.value = "";
  }

  renderParticipants();

  message(
    `Imported ${imported.length} participant${imported.length === 1 ? "" : "s"}` +
    `${duplicateCount ? ` with ${duplicateCount} duplicate warning${duplicateCount === 1 ? "" : "s"}` : ""}. ` +
    `Duplicates remain separate participants. The wheel now lists ${totalPeople} participants.`,
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
    "- Restore removed participants\n\n" +
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

// Above this many tickets, radial labels cannot stay readable, so the wheel
// falls back to a participant legend instead of overlapping text.
const MAX_WHEEL_LABELS = 40;

function renderWheel() {
  wheel.querySelectorAll(".ld-wheel-label").forEach(label => {
    label.remove();
  });

  if (!currentEntries.length) {
    wheel.style.background =
      "conic-gradient(#292346, #17142b, #292346)";
    renderWheelLegend([]);

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

  if (total > MAX_WHEEL_LABELS) {
    // Dense pool: keep every segment but move identity into a readable legend.
    renderWheelLegend(currentEntries);
  } else {
    renderWheelLegend([]);

    // One label for every ticket, so the label under the pointer matches the
    // announced winner at rest.
    currentEntries.forEach(entry => {
      const label = document.createElement("span");

      label.className = "ld-wheel-label";
      label.textContent = entryDisplayName(entry);
      label.title = label.textContent;

      wheel.appendChild(label);
    });

    positionWheelLabels();
  }

  const center = wheel.querySelector(".luckydraw-wheel-center");

  if (center) {
    center.style.zIndex = "2";
  }
}

// Re-place existing labels for the current wheel size without rebuilding the
// segments, so resizing or presentation mode cannot change the frozen winner.
function positionWheelLabels() {
  const labels = wheel.querySelectorAll(".ld-wheel-label");

  if (!labels.length) return;

  const total = Number(labels[0].dataset.total) || labels.length;
  const labelRadius = labelRadiusFor(wheel.clientWidth);
  // Scale with the actual rendered wheel, including presentation/viewport
  // changes. Narrow ticket arcs still need smaller text.
  const density = labels.length === 1 ? 1 : total > 30 ? 0.6 : total > 20 ? 0.7 : total > 12 ? 0.8 : 1;
  const fontSize = Math.max(6, wheel.clientWidth * 0.04 * density);

  labels.forEach((label, index) => {
    const angle = segmentCenterAngle(Number(label.dataset.index ?? index), total);
    label.style.fontSize = `${fontSize}px`;

    label.style.transform =
      `translate(-50%, -50%) rotate(${angle}deg) translateY(-${labelRadius}px) rotate(-90deg)`;
  });
}

function renderWheelLegend(entries) {
  const legend = $("ldWheelLegend");

  if (!legend) return;

  if (!entries.length) {
    legend.hidden = true;
    legend.textContent = "";

    return;
  }

  const groups = new Map();

  entries.forEach((entry, index) => {
    if (!groups.has(entry.uid)) {
      groups.set(entry.uid, {
        displayName: entryDisplayName(entry),
        tickets: 0,
        ranges: []
      });
    }

    groups.get(entry.uid).tickets++;
    const ranges = groups.get(entry.uid).ranges;
    const last = ranges[ranges.length - 1];
    if (last && last[1] === index) last[1] = index + 1;
    else ranges.push([index + 1, index + 1]);
  });

  legend.innerHTML = [...groups.values()].map(person => `
    <span class="ld-wheel-legend-item">
      <span class="ld-wheel-legend-name">${escapeHTML(person.displayName)}</span>
      <span class="ld-wheel-legend-count">#${person.ranges.map(([start, end]) => start === end ? start : `${start}–${end}`).join(", ")} · ${person.tickets}</span>
    </span>
  `).join("");

  legend.hidden = false;
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
    // Use the transaction-based draw store to select and save the winner.
    const result = await drawStore.spin(drawVersion);
    committed = true;

    const { entries, winningIndex, winner, draw } = result;
    const winnerName = entryDisplayName(winner);

    currentEntries = entries;
    renderWheel();

    winnerElement.innerHTML = `
      <span>GOOD LUCK!</span>
      <strong>SPINNING...</strong>
    `;

    // Rotate the wheel so the winning segment's centre stops under the top
    // pointer, continuing forward from the current rotation.
    currentRotation = targetRotationForWinner(
      currentRotation,
      winningIndex,
      entries.length,
      6
    );

    wheel.style.transform = `rotate(${currentRotation}deg)`;

    await new Promise(resolve => {
      setTimeout(resolve, 5200);
    });

    // Update the saved draw information.
    loadDrawSettings(draw);
    drawVersion = draw.version;
    currentEntries = draw.entries;
    // A numbered marker maps the dense wheel's resting pointer to its legend.
    if (entries.length > MAX_WHEEL_LABELS) {
      const marker = document.createElement("span");
      marker.className = "ld-wheel-label";
      marker.textContent = `#${winningIndex + 1}`;
      marker.dataset.index = winningIndex;
      marker.dataset.total = entries.length;
      wheel.appendChild(marker);
      positionWheelLabels();
    }

    // Display the winner.
    winnerElement.innerHTML = `
      <span>🎉 CONGRATULATIONS! 🎉</span>
      <strong>${escapeHTML(winnerName)}</strong>
      <small>
        Selected from ${winner.ticketsAtWin} ${
          winner.ticketsAtWin === 1 ? "entry" : "entries"
        }!
      </small>
    `;

    // Celebrate and update the participant information.
    launchConfetti();

    renderParticipants({ preserveWheel: true });

    await loadHistory();

    message(
      `${winnerName} has won! Their entries are excluded and the winner is saved.`,
      "success"
    );

  } catch (error) {
    drawVersion = null;
    currentEntries = [];

    renderParticipants();

    message(
      `${
        committed
          ? "Winner saved; reload the draw to recover its display"
          : "Draw not confirmed; refresh entries and history before retrying"
      }: ${error.message}`,
      "error"
    );

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
  const winnerName = entryDisplayName(selectedWinner);
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
      ? `<span>LAST WINNER</span><strong>${escapeHTML(entryDisplayName(draw.lastWinner))}</strong>`
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
          displayName: entryDisplayName(data)
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
          UNDO
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
          `Unable to remove participant: ${error.message} ` +
          `The draw will be reloaded; refresh entries before retrying.`,
          "error"
        );

        isSpinning = false;
        await loadSavedDraw();

      } finally {
        isSpinning = false;
        removeButton.disabled = false;
      }
    }
  });
}

// ==========================================
// REMOVED PARTICIPANT RESTORE EVENTS
// ==========================================

if (removedList) {
  removedList.addEventListener("click", async event => {
    if (!isAuthorized || isSpinning) return;

    const restoreButton = event.target.closest("[data-restore-participant]");
    const row = event.target.closest("[data-removed-uid]");

    if (!restoreButton || !row) return;

    const uid = row.dataset.removedUid;

    if (!uid) return;

    try {
      isSpinning = true;
      restoreButton.disabled = true;
      await restoreParticipant(uid);

    } catch (error) {
      console.error("Restore participant error:", error);

      message(
        `Unable to restore participant: ${error.message} ` +
        `The draw will be reloaded; refresh entries before retrying.`,
        "error"
      );

      isSpinning = false;
      await loadSavedDraw();

    } finally {
      isSpinning = false;
      restoreButton.disabled = false;
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
// BULK IMPORT EVENTS
// ==========================================

if (bulkPreviewBtn) {
  bulkPreviewBtn.addEventListener("click", previewBulkImport);
}

if (bulkNamesInput) {
  bulkNamesInput.addEventListener("input", clearBulkPreview);
}

if (bulkImportBtn) {
  bulkImportBtn.addEventListener("click", async () => {
    if (!isAuthorized || isSpinning) return;

    try {
      isSpinning = true;
      bulkImportBtn.disabled = true;
      await importBulkPreview(true);
    } catch (error) {
      console.error("Bulk import error:", error);
      message(
        `Unable to import participants: ${error.message} The draw will be reloaded; preview the list again before retrying.`,
        "error"
      );
      isSpinning = false;
      await loadSavedDraw();
    } finally {
      isSpinning = false;
      if (bulkImportBtn) {
        bulkImportBtn.disabled = !bulkPreviewState?.canImport;
      }
      spinBtn.disabled = !isAuthorized || currentEntries.length === 0;
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

refreshBtn.addEventListener("click", () => refreshTickets());
spinBtn.addEventListener("click", spinWheel);

// Keep radial labels centred in their segments when the viewport or
// presentation mode changes the wheel size. Only labels move; the wheel
// background and rotation (including a frozen result) stay untouched.
if (wheel && typeof ResizeObserver !== "undefined") {
  new ResizeObserver(() => positionWheelLabels()).observe(wheel);
}

// ==========================================
// ADMIN AUTHENTICATION
// ==========================================

onAuthStateChanged(auth, async user => {
  isAuthorized = false;
  setPresentationMode(false);

  drawVersion = null;
  currentEntries = [];
  previousWinners = [];
  clearBulkPreview();
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
