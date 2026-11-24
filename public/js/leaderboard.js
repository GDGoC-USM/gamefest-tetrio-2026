
import {
  db,
  collection,
  getDocs
} from "./shared.js";

import { escapeHTML } from "./shared.js";

// ==========================================
// LOAD PUBLIC LEADERBOARD
// ==========================================

async function loadLeaderboard() {
  const body = document.getElementById("leaderboardBody");
  const note = document.getElementById("leaderboardNote");

  if (!body || !note) return;

  try {
    body.innerHTML = `
      <tr>
        <td colspan="4">Loading leaderboard...</td>
      </tr>
    `;

    // Read PUBLIC leaderboard documents only.
    const snapshot = await getDocs(
      collection(db, "leaderboard")
    );

    const rows = snapshot.docs.map(document => ({
      uid: document.id,
      ...document.data()
    }));

    // ======================================
    // SORT BY POINTS
    // ======================================

    rows.sort((a, b) =>
      (b.points || 0) - (a.points || 0) ||
      (b.correct || 0) - (a.correct || 0) ||
      (a.displayName || "Player").localeCompare(
        b.displayName || "Player"
      )
    );

    // ======================================
    // EMPTY LEADERBOARD
    // ======================================

    if (!rows.length) {
      body.innerHTML = `
        <tr>
          <td colspan="4">
            No predictions have been submitted yet.
          </td>
        </tr>
      `;

      note.textContent =
        "Be the first to join the prediction challenge!";

      return;
    }

    // ======================================
    // DISPLAY LEADERBOARD
    // ======================================

    body.innerHTML = rows.map((person, index) => {

      const rank = index + 1;
      const correct = person.correct || 0;
      const points = person.points || 0;

      let rankClass = "";

      if (rank === 1) rankClass = "top-rank";
      else if (rank === 2) rankClass = "second-rank";
      else if (rank === 3) rankClass = "third-rank";

      return `
        <tr>
          <td>
            <span class="rank ${rankClass}">
              ${rank}
            </span>
          </td>

          <td>
            <strong>
              ${escapeHTML(person.displayName || "Player")}
            </strong>
          </td>

          <td>
            ${correct}
          </td>

          <td>
            <strong class="score">
              ${points} PTS
            </strong>
          </td>
        </tr>
      `;
    }).join("");

    note.textContent =
      "Scores are calculated from completed matches with published winners. Every correct prediction earns 10 points.";

  } catch (error) {
    console.error("Leaderboard error:", error);

    body.innerHTML = `
      <tr>
        <td colspan="4">
          Unable to load leaderboard.
        </td>
      </tr>
    `;

    note.textContent = error.message;
  }
}

// ==========================================
// INITIALISE
// ==========================================

loadLeaderboard();
