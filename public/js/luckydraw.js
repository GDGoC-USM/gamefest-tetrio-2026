
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

const participantsElement = $("ldParticipants");
const ticketsElement = $("ldTickets");
const winnersElement = $("ldWinners");

const participantsList = $("ldParticipantsList");
const historyElement = $("ldHistory");
const winnerElement = $("ldWinner");
const messageElement = $("ldMessage");

let currentEntries = [];
let excludedUids = [];
let previousWinners = [];

let isSpinning = false;
let isAuthorized = false;
let currentRotation = 0;

// ==========================================
// MESSAGE
// ==========================================

function message(text, type = "info") {
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
// LOAD SAVED DRAW
// ==========================================

async function loadSavedDraw() {

  const snapshot = await getDoc(DRAW_REF);

  if (!snapshot.exists()) {
    await refreshTickets();
    return;
  }

  const data = snapshot.data();

  currentEntries = Array.isArray(data.entries)
    ? data.entries
    : [];

  excludedUids = Array.isArray(data.excludedUids)
    ? data.excludedUids
    : [];

  if (data.lastWinner) {

    winnerElement.innerHTML = `
      <span>LAST WINNER</span>
      <strong>
        ${escapeHTML(data.lastWinner.displayName)}
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
// REFRESH FROM LATEST LEADERBOARD
// ==========================================

async function refreshTickets() {

  if (!isAuthorized) return;

  refreshBtn.disabled = true;

  message("Loading latest leaderboard tickets...");

  try {

    const [leaderboardSnapshot, drawSnapshot] =
      await Promise.all([
        getDocs(LEADERBOARD_REF),
        getDoc(DRAW_REF)
      ]);

    // Preserve previous winners.
    if (drawSnapshot.exists()) {

      const data = drawSnapshot.data();

      excludedUids = Array.isArray(data.excludedUids)
        ? data.excludedUids
        : [];

    }

    const leaderboard = leaderboardSnapshot.docs.map(item => ({
      uid: item.id,
      ...item.data()
    }));

    // Sort according to latest leaderboard.
    leaderboard.sort((a, b) =>
      (Number(b.points) || 0) -
      (Number(a.points) || 0)
    );

    // Create weighted ticket entries.
    const entries = [];

    leaderboard.forEach(person => {

      const uid = person.uid;

      const tickets = Math.max(
        0,
        Math.floor(Number(person.correct) || 0)
      );

      // Skip users with zero tickets.
      if (tickets === 0) return;

      // Skip previous winners.
      if (excludedUids.includes(uid)) return;

      const displayName = person.displayName || "Player";

      // Four tickets = four wheel entries.
      for (let i = 0; i < tickets; i++) {
        entries.push({
          uid,
          displayName
        });
      }

    });

    currentEntries = entries;

    // Save entries so refreshing the page
    // does not restore previous winners.
    await setDoc(DRAW_REF, {

      entries: currentEntries,
      excludedUids,
      updatedAt: serverTimestamp()

    }, { merge: true });

    renderParticipants();

    await loadHistory();

    message(
      `Successfully loaded ${currentEntries.length} tickets.`,
      "success"
    );

  } catch (error) {

    console.error("Lucky Draw refresh error:", error);

    message(
      `Unable to load tickets: ${error.message}`,
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
        displayName: entry.displayName,
        tickets: 0
      });

    }

    groups.get(entry.uid).tickets++;

  });

  return [...groups.values()];
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

  if (!groups.length) {

    participantsList.innerHTML = `
      <p class="muted">
        No eligible participants.
        Refresh the latest leaderboard to check tickets.
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
            ${person.tickets} tickets
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
// RENDER WHEEL WITH PARTICIPANT NAMES
// ==========================================

function renderWheel() {

  // Remove old labels before rendering again.
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

    segments.push(
      `${color} ${start}deg ${end}deg`
    );

  });

  wheel.style.background =
    `conic-gradient(${segments.join(",")})`;

  // Add participant names directly onto the wheel.
  currentEntries.forEach((entry, index) => {

    const angle = (index + 0.5) * (360 / total);

    const label = document.createElement("span");

    label.className = "ld-wheel-label";
    label.textContent = entry.displayName;
    label.title = entry.displayName;

    label.style.transform =
      `translate(-50%, -50%) rotate(${angle}deg) translateY(-108px) rotate(${-angle}deg)`;

    if (total > 20) {
      label.style.fontSize = "7px";
    } else if (total > 12) {
      label.style.fontSize = "8px";
    } else {
      label.style.fontSize = "10px";
    }

    wheel.appendChild(label);

  });

  // Keep the wheel centre above the labels.
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

  if (!currentEntries.length) {
    message("There are no eligible tickets.", "error");
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

    const total = currentEntries.length;

    // Randomly select one ticket.
    const winningIndex = Math.floor(
      Math.random() * total
    );

    const winningEntry = currentEntries[winningIndex];

    const winnerUid = winningEntry.uid;
    const winnerName = winningEntry.displayName;

    // Calculate wheel rotation.
    const segmentAngle = 360 / total;

    const winningCenter =
      (winningIndex + 0.5) * segmentAngle;

    const extraSpins = 360 * 6;

    const targetRotation =
      currentRotation +
      extraSpins +
      (360 - winningCenter);

    wheel.style.transform =
      `rotate(${targetRotation}deg)`;

    currentRotation = targetRotation;

    // Wait for wheel animation.
    await new Promise(resolve => {
      setTimeout(resolve, 5200);
    });

    // Count tickets before removing winner.
    const winnerTicketCount =
      currentEntries.filter(
        entry => entry.uid === winnerUid
      ).length;

    // Remove ALL tickets belonging to winner.
    currentEntries = currentEntries.filter(
      entry => entry.uid !== winnerUid
    );

    // Exclude winner from this draw.
    if (!excludedUids.includes(winnerUid)) {
      excludedUids.push(winnerUid);
    }

    const winnerData = {

      uid: winnerUid,
      displayName: winnerName,
      ticketsAtWin: winnerTicketCount,
      drawnAt: new Date().toISOString()

    };

    // Save current draw first.
    await setDoc(DRAW_REF, {

      entries: currentEntries,
      excludedUids,
      lastWinner: winnerData,
      lastWinnerHistoryId: null,
      updatedAt: serverTimestamp()

    }, { merge: true });

    // Save winner history.
    try {

      const historyRef = await addDoc(AWARDS_REF, {

        type: "winner",
        uid: winnerUid,
        displayName: winnerName,
        ticketsAtWin: winnerTicketCount,
        drawnAt: serverTimestamp()

      });

      // Save the exact history document ID.
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
        Selected from ${winnerTicketCount} tickets!
      </small>
    `;

    renderParticipants();

    await loadHistory();

    message(
      `${winnerName} has won! All their tickets have been removed.`,
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

  const winnerName = selectedWinner.displayName || "Player";

  const winnerUid = selectedWinner.uid;

  const ticketCount = Math.max(
    0,
    Math.floor(Number(selectedWinner.ticketsAtWin) || 0)
  );

  if (!winnerUid || ticketCount <= 0) {

    message("The winner's original ticket information is unavailable.", "error");
    return;

  }

  const confirmed = confirm(
    `Undo ${winnerName}'s win?\n\n` +
    `${ticketCount} tickets will be restored and this winner record will be deleted.`
  );

  if (!confirmed) return;

  spinBtn.disabled = true;
  refreshBtn.disabled = true;

  historyElement.querySelectorAll("[data-undo-winner]").forEach(button => {
    button.disabled = true;
  });

  message(`Restoring ${winnerName}'s tickets...`);

  try {

    // Get the latest saved draw.
    const drawSnapshot = await getDoc(DRAW_REF);

    if (!drawSnapshot.exists()) {
      throw new Error("The saved draw could not be found.");
    }

    const drawData = drawSnapshot.data();

    const savedEntries = Array.isArray(drawData.entries)
      ? drawData.entries
      : [];

    const savedExcluded = Array.isArray(drawData.excludedUids)
      ? drawData.excludedUids
      : [];

    // Remove this winner from the excluded list.
    const updatedExcluded = savedExcluded.filter(
      uid => uid !== winnerUid
    );

    // Remove any existing entries for this UID first,
    // then restore the exact number of tickets at win.
    const updatedEntries = savedEntries.filter(
      entry => entry.uid !== winnerUid
    );

    for (let i = 0; i < ticketCount; i++) {

      updatedEntries.push({

        uid: winnerUid,
        displayName: winnerName

      });

    }

    // Find the latest remaining winner record.
    const remainingWinners = previousWinners
      .filter(winner => winner.id !== historyId);

    const latestRemainingWinner = remainingWinners.length
      ? remainingWinners[0]
      : null;

    const isUndoingLastWinner =
      drawData.lastWinnerHistoryId === historyId ||
      (
        !drawData.lastWinnerHistoryId &&
        drawData.lastWinner?.uid === winnerUid
      );

    // Delete the selected winner history document.
    await deleteDoc(
      doc(db, "ticketAwards", historyId)
    );

    // Save restored tickets and updated exclusions.
    const updatedDraw = {

      entries: updatedEntries,
      excludedUids: updatedExcluded,
      updatedAt: serverTimestamp()

    };

    // If the selected winner was the latest winner,
    // update the displayed last winner as well.
    if (isUndoingLastWinner) {

      updatedDraw.lastWinner = latestRemainingWinner
        ? {
            uid: latestRemainingWinner.uid,
            displayName: latestRemainingWinner.displayName,
            ticketsAtWin: latestRemainingWinner.ticketsAtWin,
            drawnAt: latestRemainingWinner.drawnAt
          }
        : null;

      updatedDraw.lastWinnerHistoryId =
        latestRemainingWinner?.id || null;

    }

    await setDoc(DRAW_REF, updatedDraw, { merge: true });

    // Update local data.
    currentEntries = updatedEntries;
    excludedUids = updatedExcluded;

    // Update winner display.
    if (isUndoingLastWinner) {

      if (latestRemainingWinner) {

        winnerElement.innerHTML = `
          <span>LAST WINNER</span>
          <strong>
            ${escapeHTML(latestRemainingWinner.displayName)}
          </strong>
        `;

      } else {

        winnerElement.innerHTML = `
          <span>WAITING FOR THE DRAW</span>
          <strong>GOOD LUCK!</strong>
        `;

      }

    }

    // Reload history and participant information.
    await loadHistory();

    renderParticipants();

    message(
      `${winnerName}'s ${ticketCount} tickets have been restored. They can now win again!`,
      "success"
    );

  } catch (error) {

    console.error("Undo selected winner error:", error);

    // Reload saved draw to keep the page in sync.
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

      .map(item => ({

        id: item.id,
        ...item.data()

      }))

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

    historyElement.innerHTML = history.map((person, index) => {

      return `
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
            ${Number(person.ticketsAtWin) || 0} tickets
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
      `;

    }).join("");

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
// BUTTON EVENTS
// ==========================================

refreshBtn.addEventListener(
  "click",
  refreshTickets
);

spinBtn.addEventListener(
  "click",
  spinWheel
);

// ==========================================
// ADMIN AUTHENTICATION
// ==========================================

onAuthStateChanged(auth, async user => {

  isAuthorized = false;

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
