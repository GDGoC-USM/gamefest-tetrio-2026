import { db, collection, onSnapshot, escapeHTML } from "./shared.js";
import { publicUsername } from "./usernames.js";
import { initPublicAuth } from "./auth-ui.js";

initPublicAuth();

const body = document.getElementById("leaderboardBody");
const note = document.getElementById("leaderboardNote");

// Public rankings use organiser-recomputed totals, never other users' private predictions.
onSnapshot(collection(db, "leaderboard"), snapshot => {
  const rows = snapshot.docs.map(document => {
    const data = document.data();
    const correct = Number.isInteger(data.correct) && data.correct >= 0 ? data.correct : 0;
    return { uid: document.id, displayName: publicUsername(data.displayName), correct, points: correct };
  });
  rows.sort((a, b) => b.points - a.points || a.displayName.localeCompare(b.displayName) || a.uid.localeCompare(b.uid));
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="4">No scored predictions yet. Rankings appear after results are published and scores recalculated.</td></tr>';
    note.textContent = "Each correct group qualifier or series winner earns 1 point and 1 Lucky Draw entry.";
    return;
  }
  let rank = 0;
  body.innerHTML = rows.map((person, index) => {
    if (index === 0 || rows[index - 1].points !== person.points) rank = index + 1;
    const rankClass = rank === 1 ? "top-rank" : rank === 2 ? "second-rank" : rank === 3 ? "third-rank" : "";
    return `<tr>
      <td><span class="rank ${rankClass}">${rank}</span></td>
      <td><strong>${escapeHTML(person.displayName)}</strong></td>
      <td>${person.correct}</td>
      <td><strong class="score">${person.points} PTS</strong></td>
    </tr>`;
  }).join("");
  note.textContent = "1 point and 1 Lucky Draw entry per correct qualifier or series winner, regardless of match score. Pending results earn no points yet. Rankings update when the organiser recalculates; tied totals share a rank.";
}, error => {
  console.error("Leaderboard error:", error);
  body.innerHTML = '<tr><td colspan="4">Unable to load leaderboard. Refresh to try again.</td></tr>';
  note.textContent = error.message;
});
