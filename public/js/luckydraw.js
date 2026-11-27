import {
  auth,
  db,
  isAdmin,
  onAuthStateChanged,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  deleteDoc,
  serverTimestamp,
  escapeHTML
} from "./shared.js";
import { publicUsername } from "./usernames.js";

// ==========================================
// LUCKY DRAW CONFIGURATION
// ==========================================

const DRAW_REF = doc(db, "ticketAwards", "currentDraw");
const AWARDS_REF = collection(db, "ticketAwards");
const LEADERBOARD_REF = collection(db, "leaderboard");

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
}

if (presentationBtn) {
  presentationBtn.addEventListener("click", () => {
    const isActive = document.body.classList.contains(
      "ld-presentation-mode"
    );

    setPresentationMode(!isActive);
  });
}

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

async function saveDrawSettings(extraData = {}) {
  await setDoc(DRAW_REF, {

    entries: currentEntries,
    excludedUids,
    removedUids,
    nameOverrides,
    ticketOverrides,
    manualParticipants,

    updatedAt: serverTimestamp(),

    ...extraData

  }, { merge: true });
}

// ==========================================
// LOAD SAVED DRAW
// ==========================================

async function loadSavedDraw() {
  const [snapshot, leaderboardSnapshot] = await Promise.all([
    getDoc(DRAW_REF),
    getDocs(LEADERBOARD_REF)
  ]);

  if (!snapshot.exists()) {
    await refreshTickets();
    return;
  }

  const data = snapshot.data();

  loadDrawSettings(data);

  leaderboardParticipants = leaderboardSnapshot.docs.map(item => ({
    uid: item.id,
    ...item.data()
  }));

  currentEntries = Array.isArray(data.entries)
    ? data.entries.map(entry => ({
        ...entry,
        displayName: publicUsername(entry.displayName)
      }))
    : [];

  if (data.lastWinner) {
    winnerElement.innerHTML = `
      <span>LAST WINNER</span>
      <strong>
        ${escapeHTML(publicUsername(data.lastWinner.displayName))}
      </strong>
    `;
  } else {
    winnerElement.innerHTML = `
      <span>WAITING FOR THE DRAW</span>
      <strong>GOOD LUCK!</strong>
    `;
  }

  renderParticipants();
  await loadHistory();
}

// ==========================================
// BUILD LEADERBOARD ENTRIES
// ==========================================

function buildLeaderboardEntries(leaderboard) {
  const entries = [];

  leaderboard.forEach(person => {
    const uid = person.uid;

    // Do not include previous winners.
    if (excludedUids.includes(uid)) return;

    // Do not include manually removed participants.
    if (removedUids.includes(uid)) return;

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

    // One separate wheel entry for every ticket.
    for (let i = 0; i < tickets; i++) {
      entries.push({
        uid,
        displayName
      });
    }
  });

  return entries;
}

// ==========================================
// REFRESH FROM LATEST LEADERBOARD
// ==========================================

async function refreshTickets() {
  if (!isAuthorized || isSpinning) return;

  refreshBtn.disabled = true;

  message("Loading latest leaderboard entries...");

  try {
    const [leaderboardSnapshot, drawSnapshot] =
      await Promise.all([
        getDocs(LEADERBOARD_REF),
        getDoc(DRAW_REF)
      ]);

    // Load existing custom settings before rebuilding entries.
    if (drawSnapshot.exists()) {
      loadDrawSettings(drawSnapshot.data());
    }

    const leaderboard = leaderboardSnapshot.docs.map(item => ({
      uid: item.id,
      ...item.data()
    }));

    leaderboardParticipants = [...leaderboard];

    // Sort according to latest leaderboard points.
    leaderboard.sort((a, b) =>
      (Number(b.points) || 0) -
      (Number(a.points) || 0)
    );

    // Rebuild leaderboard entries while preserving custom edits.
    const entries = buildLeaderboardEntries(leaderboard);

    // Add manually created participants.
    manualParticipants.forEach(person => {
      const uid = `manual:${person.id}`;

      if (excludedUids.includes(uid)) return;

      const tickets = Math.max(
        0,
        Math.floor(Number(person.tickets) || 0)
      );

      const displayName = publicUsername(person.displayName);

      for (let i = 0; i < tickets; i++) {
        entries.push({
          uid,
          displayName
        });
      }
    });

    currentEntries = entries;

    await saveDrawSettings();

    renderParticipants();

    await loadHistory();

    message(
      `Successfully loaded ${currentEntries.length} ${
        currentEntries.length === 1 ? "entry" : "entries"
      }. Your saved edits have been preserved.`,
      "success"
    );

  } catch (error) {
    console.error("Lucky Draw refresh error:", error);

    message(
      `Unable to load entries: ${error.message}`,
      "error"
    );

  } finally {
    refreshBtn.disabled = false;
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

function renderParticipants({ preserveWheel = false } = {}) {
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

async function addManualParticipant(event) {
  event.preventDefault();

  if (!isAuthorized || isSpinning) return;

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
    nameOverrides = {};
    ticketOverrides = {};
    manualParticipants = [];
    removedUids = [];

    await saveDrawSettings();

    await refreshTickets();

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

    // Position each label proportionally to the wheel size.
    const labelRadius = wheel.clientWidth * 0.34;

    label.style.transform =
      `translate(-50%, -50%) rotate(${angle}deg) translateY(-${labelRadius}px) rotate(-90deg)`;

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
// WINNER CONFETTI EFFECT
// ==========================================

function launchConfetti() {
  // Respect reduced-motion accessibility settings.
  if (window.matchMedia(
    "(prefers-reduced-motion: reduce)"
  ).matches) {
    return;
  }

  const colors = [
    "#8a4bd8",
    "#d94c70",
    "#a66be8",
    "#ffcc70",
    "#ffffff",
    "#c6a1ff"
  ];

  const confetti = document.createElement("div");
  confetti.className = "ld-confetti";

  const particleCount = 45;

  for (let i = 0; i < particleCount; i++) {
    const particle = document.createElement("span");

    particle.className = "ld-confetti-piece";

    particle.style.setProperty(
      "--x",
      `${Math.random() * 100}%`
    );

    particle.style.setProperty(
      "--drift",
      `${Math.random() * 300 - 150}px`
    );

    particle.style.setProperty(
      "--rotation",
      `${Math.random() * 1080}deg`
    );

    particle.style.setProperty(
      "--duration",
      `${2.2 + Math.random() * 1.2}s`
    );

    particle.style.setProperty(
      "--delay",
      `${Math.random() * 0.5}s`
    );

    particle.style.setProperty(
      "--color",
      colors[Math.floor(Math.random() * colors.length)]
    );

    confetti.appendChild(particle);
  }

  document.body.appendChild(confetti);

  // Remove the effect after the animation.
  setTimeout(() => {
    confetti.remove();
  }, 4000);
}

// ==========================================
// SPIN WHEEL
// ==========================================

async function spinWheel() {
  if (!isAuthorized || isSpinning) return;

  if (!currentEntries.length) {
    message("There are no eligible entries.", "error");
    return;
  }

  isSpinning = true;

  spinBtn.disabled = true;
  refreshBtn.disabled = true;

  message("The wheel is spinning...");

  winnerElement.innerHTML = `
    <span>GOOD LUCK!</span>
    <strong>SPINNING...</strong>
  `;

  try {
    // Rebuild the wheel using the latest eligible entries.
    // This keeps the displayed segments aligned with the selection.
    renderWheel();

    const total = currentEntries.length;

    // Randomly select one ticket.
    const winningIndex = Math.floor(
      Math.random() * total
    );

    const winningEntry = currentEntries[winningIndex];

    const winnerUid = winningEntry.uid;
    const winnerName = publicUsername(winningEntry.displayName);

    // Calculate the centre of the winning segment.
    const segmentAngle = 360 / total;
    const winningCenter = (winningIndex + 0.5) * segmentAngle;

    // Calculate the required final wheel orientation.
    const targetAngle = (360 - winningCenter + 360) % 360;

    // Normalise the wheel's current orientation.
    const currentAngle = ((currentRotation % 360) + 360) % 360;

    // Calculate the clockwise rotation needed to reach the winner.
    const rotationDelta =
      (targetAngle - currentAngle + 360) % 360;

    // Add six complete rotations before reaching the winner.
    const extraSpins = 360 * 6;

    const targetRotation =
      currentRotation + extraSpins + rotationDelta;

    wheel.style.transform =
      `rotate(${targetRotation}deg)`;

    currentRotation = targetRotation;

    // Wait for the wheel animation to finish.
    await new Promise(resolve => {
      setTimeout(resolve, 5200);
    });

    const winnerTicketCount = currentEntries.filter(
      entry => entry.uid === winnerUid
    ).length;

    // Remove all tickets belonging to the winner.
    currentEntries = currentEntries.filter(
      entry => entry.uid !== winnerUid
    );

    if (!excludedUids.includes(winnerUid)) {
      excludedUids.push(winnerUid);
    }

    const winnerData = {
      uid: winnerUid,
      displayName: winnerName,
      ticketsAtWin: winnerTicketCount,
      drawnAt: new Date().toISOString()
    };

    await saveDrawSettings({
      lastWinner: winnerData,
      lastWinnerHistoryId: null
    });

    // Save winner history.
    try {
      const historyRef = await addDoc(AWARDS_REF, {
        type: "winner",
        uid: winnerUid,
        displayName: winnerName,
        ticketsAtWin: winnerTicketCount,
        drawnAt: serverTimestamp()
      });

      await setDoc(DRAW_REF, {
        lastWinnerHistoryId: historyRef.id
      }, { merge: true });

    } catch (historyError) {
      console.error(
        "Winner history saving error:",
        historyError
      );
    }

    winnerElement.innerHTML = `
      <span>🎉 CONGRATULATIONS! 🎉</span>

      <strong>
        ${escapeHTML(winnerName)}
      </strong>

      <small>
        Selected from ${winnerTicketCount} ${
          winnerTicketCount === 1 ? "entry" : "entries"
        }!
      </small>
    `;
    launchConfetti();

    renderParticipants({ preserveWheel: true });
    await loadHistory();

    message(
      `${winnerName} has won! All their entries have been removed.`,
      "success"
    );

  } catch (error) {
    console.error("Spin error:", error);

    message(
      `Unable to complete the draw: ${error.message}`,
      "error"
    );

  } finally {
    isSpinning = false;

    refreshBtn.disabled = false;

    spinBtn.disabled =
      currentEntries.length === 0;
  }
}

// ==========================================
// UNDO ANY SELECTED WINNER
// ==========================================

async function undoSelectedWinner(historyId) {
  if (!isAuthorized || isSpinning) return;

  const selectedWinner = previousWinners.find(
    winner => winner.id === historyId
  );

  if (!selectedWinner) {
    message("Winner record not found. Refresh and try again.", "error");
    return;
  }

  const winnerName = publicUsername(selectedWinner.displayName);
  const winnerUid = selectedWinner.uid;

  const ticketCount = Math.max(
    0,
    Math.floor(Number(selectedWinner.ticketsAtWin) || 0)
  );

  if (!winnerUid || ticketCount <= 0) {
    message("The winner's original entry information is unavailable.", "error");
    return;
  }

  const confirmed = confirm(
    `Undo ${winnerName}'s win?\n\n` +
    `${ticketCount} ${ticketCount === 1 ? "entry will" : "entries will"} be restored and this winner record will be deleted.`
  );

  if (!confirmed) return;

  spinBtn.disabled = true;
  refreshBtn.disabled = true;

  historyElement.querySelectorAll("[data-undo-winner]").forEach(button => {
    button.disabled = true;
  });

  message(`Restoring ${winnerName}'s entries...`);

  try {
    const drawSnapshot = await getDoc(DRAW_REF);

    if (!drawSnapshot.exists()) {
      throw new Error("The saved draw could not be found.");
    }

    const drawData = drawSnapshot.data();

    loadDrawSettings(drawData);

    const savedEntries = Array.isArray(drawData.entries)
      ? drawData.entries.map(entry => ({
          ...entry,
          displayName: publicUsername(entry.displayName)
        }))
      : [];

    // Remove the winner from the excluded list.
    excludedUids = excludedUids.filter(
      uid => uid !== winnerUid
    );

    // Preserve the winner's restored ticket quantity after refresh.
    if (winnerUid.startsWith("manual:")) {
      const manualId = winnerUid.substring("manual:".length);

      manualParticipants = manualParticipants.map(person =>
        person.id === manualId
          ? { ...person, tickets: ticketCount }
          : person
      );

    } else {
      ticketOverrides[winnerUid] = ticketCount;
    }

    // Use the saved custom name if one exists.
    let restoredName = winnerName;

    if (!winnerUid.startsWith("manual:") &&
        Object.prototype.hasOwnProperty.call(nameOverrides, winnerUid)) {
      restoredName = publicUsername(nameOverrides[winnerUid]);
    }

    if (winnerUid.startsWith("manual:")) {
      const manualId = winnerUid.substring("manual:".length);
      const manualPerson = manualParticipants.find(
        person => person.id === manualId
      );

      if (manualPerson) {
        restoredName = publicUsername(manualPerson.displayName);
      }
    }

    // Remove any existing entries for this winner before restoring.
    const updatedEntries = savedEntries.filter(
      entry => entry.uid !== winnerUid
    );

    for (let i = 0; i < ticketCount; i++) {
      updatedEntries.push({
        uid: winnerUid,
        displayName: restoredName
      });
    }

    currentEntries = updatedEntries;

    const remainingWinners = previousWinners.filter(
      winner => winner.id !== historyId
    );

    const latestRemainingWinner = remainingWinners.length
      ? remainingWinners[0]
      : null;

    const isUndoingLastWinner =
      drawData.lastWinnerHistoryId === historyId ||
      (
        !drawData.lastWinnerHistoryId &&
        drawData.lastWinner?.uid === winnerUid
      );

    // Save the restored entries and all custom settings.
    const extraData = {};

    if (isUndoingLastWinner) {
      extraData.lastWinner = latestRemainingWinner
        ? {
            uid: latestRemainingWinner.uid,
            displayName: publicUsername(latestRemainingWinner.displayName),
            ticketsAtWin: latestRemainingWinner.ticketsAtWin,
            drawnAt: latestRemainingWinner.drawnAt
          }
        : null;

      extraData.lastWinnerHistoryId =
        latestRemainingWinner?.id || null;
    }

    await saveDrawSettings(extraData);

    // Delete the selected winner's history record.
    await deleteDoc(doc(db, "ticketAwards", historyId));

    if (isUndoingLastWinner) {
      if (latestRemainingWinner) {
        winnerElement.innerHTML = `
          <span>LAST WINNER</span>
          <strong>
            ${escapeHTML(publicUsername(latestRemainingWinner.displayName))}
          </strong>
        `;
      } else {
        winnerElement.innerHTML = `
          <span>WAITING FOR THE DRAW</span>
          <strong>GOOD LUCK!</strong>
        `;
      }
    }

    await loadHistory();
    renderParticipants();

    message(
      `${winnerName}'s ${ticketCount} ${
        ticketCount === 1 ? "entry has" : "entries have"
      } been restored. They can now win again!`,
      "success"
    );

  } catch (error) {
    console.error("Undo selected winner error:", error);

    try {
      await loadSavedDraw();
    } catch (reloadError) {
      console.error("Reload error:", reloadError);
    }

    message(
      `Unable to undo winner: ${error.message}`,
      "error"
    );

  } finally {
    refreshBtn.disabled = false;

    spinBtn.disabled =
      currentEntries.length === 0;
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
        saveButton.disabled = false;
      }

      return;
    }

    if (removeButton) {
      try {
        removeButton.disabled = true;
        await removeParticipant(uid);

      } catch (error) {
        console.error("Remove participant error:", error);

        message(
          `Unable to remove participant: ${error.message}`,
          "error"
        );

      } finally {
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
    try {
      await addManualParticipant(event);
    } catch (error) {
      console.error("Add participant error:", error);

      message(
        `Unable to add participant: ${error.message}`,
        "error"
      );
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
  setPresentationMode(false);

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

    await loadSavedDraw();
  });
});