import {
  auth, db, collection, doc, getDoc, onSnapshot, query, where, escapeHTML
} from "./shared.js";
import { publicUsername } from "./usernames.js";
import { ROOM_CONFIG } from "./tournament.js";
import { initPublicAuth } from "./auth-ui.js";

const body = document.getElementById("leaderboardBody");
const note = document.getElementById("leaderboardNote");

const personalSummary = document.getElementById("personalLeaderboardSummary");
const personalName = document.getElementById("personalLeaderboardName");
const personalRank = document.getElementById("personalLeaderboardRank");
const personalTickets = document.getElementById("personalLeaderboardTickets");
const personalCorrect = document.getElementById("personalLeaderboardCorrect");
const personalPoints = document.getElementById("personalLeaderboardPoints");
const personalStatus = document.getElementById("personalLeaderboardStatus");
const findMyPositionButton = document.getElementById("findMyPosition");

const eligibleRoomIds = new Set(
  ROOM_CONFIG.filter(config => config.kind !== "ffa").map(config => config.id)
);

let leaderboardRows = [];
let currentUser = null;
let currentPublicName = "Participant";
let personalTicketCount = null;
let personalTicketState = "signed-out";
let unsubscribePredictions = null;
let authEpoch = 0;
let leaderboardAvailable = false;

function setPersonalValues({ rank = "—", tickets = "—", correct = "—", points = "—" } = {}) {
  personalRank.textContent = String(rank);
  personalTickets.textContent = String(tickets);
  personalCorrect.textContent = String(correct);
  personalPoints.textContent = String(points);
}

function renderPersonalSummary() {
  if (!currentUser) {
    personalSummary.hidden = true;
    findMyPositionButton.hidden = true;
    return;
  }

  personalSummary.hidden = false;
  personalName.textContent = currentPublicName;

  const currentRow = leaderboardRows.find(person => person.uid === currentUser.uid);
  if (currentRow) {
    setPersonalValues({
      rank: `#${currentRow.rank}`,
      tickets: personalTicketState === "ready" ? personalTicketCount : "—",
      correct: currentRow.correct,
      points: `${currentRow.points} PTS`
    });
  } else if (leaderboardAvailable) {
    setPersonalValues({
      rank: "Not ranked",
      tickets: personalTicketState === "ready" ? personalTicketCount : "—",
      correct: "0",
      points: "0 PTS"
    });
  } else {
    setPersonalValues({
      rank: "—",
      tickets: personalTicketState === "ready" ? personalTicketCount : "—",
      correct: "—",
      points: "—"
    });
  }

  if (personalTicketState === "loading") {
    personalStatus.textContent = "Loading your saved prediction tickets…";
  } else if (personalTicketState === "unavailable") {
    personalStatus.textContent =
      "Your saved-ticket count is temporarily unavailable. Your public leaderboard figures remain visible when available.";
  } else if (!leaderboardAvailable) {
    personalStatus.textContent =
      "The public leaderboard is temporarily unavailable. Your saved-ticket count is shown independently.";
  } else if (currentRow) {
    personalStatus.textContent =
      "Your ticket count uses your unique saved prediction rooms. Correct picks and points use the published leaderboard score.";
  } else if (personalTicketCount === 0) {
    personalStatus.textContent =
      "No saved prediction tickets yet. Submit a prediction to get started; your rank appears after scores are published.";
  } else {
    personalStatus.textContent =
      "Your predictions are saved. Your leaderboard position will appear after your scores are published and recalculated.";
  }

  findMyPositionButton.hidden = !currentRow;
}

function countUniqueTickets(snapshot, uid) {
  const latestByRoom = new Map();

  for (const predictionDoc of snapshot.docs) {
    const prediction = predictionDoc.data();
    if (prediction.uid !== uid) continue;

    const roomId = prediction.roomId || prediction.matchId;
    if (!eligibleRoomIds.has(roomId)) continue;

    const previous = latestByRoom.get(roomId);
    const isNewFormat = prediction.formatVersion === 2;
    const previousIsNewFormat = previous?.formatVersion === 2;
    const updatedAt = prediction.updatedAt?.toMillis?.() || 0;
    const previousUpdatedAt = previous?.updatedAt?.toMillis?.() || 0;

    // Match Predict's legacy/new-format deduplication precedence.
    if (!previous ||
        (isNewFormat && !previousIsNewFormat) ||
        (isNewFormat === previousIsNewFormat && updatedAt >= previousUpdatedAt)) {
      latestByRoom.set(roomId, prediction);
    }
  }

  return latestByRoom.size;
}

function renderLeaderboard() {
  if (!leaderboardAvailable) {
    renderPersonalSummary();
    return;
  }

  if (!leaderboardRows.length) {
    body.innerHTML =
      '<tr><td colspan="4">No scored predictions yet. Rankings appear after results are published and scores recalculated.</td></tr>';
    note.textContent =
      "Each correct group qualifier or series winner earns 1 point and 1 Lucky Draw entry.";
    renderPersonalSummary();
    return;
  }

  body.innerHTML = leaderboardRows.map(person => {
    const isCurrentUser = currentUser?.uid === person.uid;
    const rankClass = person.rank === 1 ? "top-rank"
      : person.rank === 2 ? "second-rank"
        : person.rank === 3 ? "third-rank" : "";

    return `<tr${isCurrentUser ? ' class="current-user-row" data-current-user="true" aria-current="true"' : ""}>
      <td><span class="rank ${rankClass}">${person.rank}</span></td>
      <td><strong>${escapeHTML(person.displayName)}</strong>${isCurrentUser ? ' <span class="you-indicator">YOU</span>' : ""}</td>
      <td>${person.correct}</td>
      <td><strong class="score">${person.points} PTS</strong></td>
    </tr>`;
  }).join("");

  note.textContent =
    "1 point and 1 Lucky Draw entry per correct qualifier or series winner, regardless of match score. Pending results earn no points yet. Rankings update when the organiser recalculates; tied totals share a rank.";
  renderPersonalSummary();
}

// Public rankings use organiser-recomputed totals, never other users' private predictions.
onSnapshot(collection(db, "leaderboard"), snapshot => {
  const rows = snapshot.docs.map(document => {
    const data = document.data();
    const correct = Number.isInteger(data.correct) && data.correct >= 0 ? data.correct : 0;
    return {
      uid: document.id,
      displayName: publicUsername(data.displayName),
      correct,
      points: correct
    };
  });

  // Keep the public table's established sort order and competition ranking.
  rows.sort((a, b) =>
    b.points - a.points ||
    a.displayName.localeCompare(b.displayName) ||
    a.uid.localeCompare(b.uid)
  );

  let rank = 0;
  leaderboardRows = rows.map((person, index) => {
    if (index === 0 || rows[index - 1].points !== person.points) rank = index + 1;
    return { ...person, rank };
  });

  leaderboardAvailable = true;
  renderLeaderboard();
}, error => {
  console.error("Leaderboard error:", error);
  leaderboardAvailable = false;
  body.innerHTML = '<tr><td colspan="4">Unable to load leaderboard. Refresh to try again.</td></tr>';
  note.textContent = "The public leaderboard is temporarily unavailable.";
  leaderboardRows = [];
  renderPersonalSummary();
});

initPublicAuth({
  onUserChanged: user => {
    const epoch = ++authEpoch;

    // Stop the previous account's private listener and clear its data immediately.
    unsubscribePredictions?.();
    unsubscribePredictions = null;
    currentUser = user;
    currentPublicName = user ? publicUsername(user.displayName) : "Participant";
    personalTicketCount = null;
    personalTicketState = user ? "loading" : "signed-out";
    renderLeaderboard();

    if (!user) return;

    // Read only this account's own public-name profile; never use email or prediction names.
    void getDoc(doc(db, "profiles", user.uid)).then(profile => {
      if (epoch !== authEpoch || currentUser?.uid !== user.uid || auth.currentUser?.uid !== user.uid) return;
      if (profile.exists()) currentPublicName = publicUsername(profile.data().username);
      renderPersonalSummary();
    }).catch(error => {
      if (epoch === authEpoch && currentUser?.uid === user.uid) {
        console.warn("Unable to load your public-name profile:", error);
        renderPersonalSummary();
      }
    });

    unsubscribePredictions = onSnapshot(
      query(collection(db, "predictions"), where("uid", "==", user.uid)),
      snapshot => {
        if (epoch !== authEpoch || currentUser?.uid !== user.uid || auth.currentUser?.uid !== user.uid) return;
        personalTicketCount = countUniqueTickets(snapshot, user.uid);
        personalTicketState = "ready";
        renderPersonalSummary();
      },
      error => {
        if (epoch !== authEpoch || currentUser?.uid !== user.uid) return;
        console.error("Personal prediction statistics error:", error);
        personalTicketState = "unavailable";
        renderPersonalSummary();
      }
    );
  }
});

findMyPositionButton.addEventListener("click", () => {
  const row = body.querySelector('[data-current-user="true"]');
  if (!row) return;
  row.scrollIntoView({
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    block: "center"
  });
  row.setAttribute("tabindex", "-1");
  row.focus({ preventScroll: true });
});
