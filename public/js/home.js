
import {
  auth,
  db,
  signIn,
  signOut,
  onAuthStateChanged,
  collection,
  doc,
  getDoc,
  getDocs
} from "./shared.js";

import {
  escapeHTML,
  showMessage
} from "./shared.js";

const authBtn = document.getElementById("authBtn");
const welcome = document.getElementById("welcomeText");

authBtn.addEventListener("click", async () => {
  try {
    if (auth.currentUser) {
      await signOut(auth);
    } else {
      await signIn();
    }
  } catch (e) {
    alert(e.message);
  }
});

onAuthStateChanged(auth, user => {
  authBtn.textContent = user
    ? "Sign out"
    : "Sign in with Google";

  welcome.textContent = user
    ? `Signed in as ${user.displayName || user.email}`
    : "Sign in with Google to save your predictions.";
});

async function loadHome() {
  const grid = document.getElementById("roomGrid");

  try {
    const [roomsSnap, settingsSnap] = await Promise.all([
      getDocs(collection(db, "rooms")),
      getDoc(doc(db, "settings", "main"))
    ]);

    const rooms = roomsSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => a.id.localeCompare(b.id));

    grid.innerHTML = rooms.length
      ? rooms.map(room => {

          // Preliminary rooms have 8 players.
          // Semi-final and Grand Final rooms have 4 players.
          const expectedPlayers = ["SF1", "SF2", "FINAL"].includes(room.id)
            ? 4
            : 8;

          const registeredPlayers = (room.players || []).length;

          return `
            <article class="card">
              <span class="room-tag">
                ROOM ${escapeHTML(room.id)}
              </span>

              <h3>
                ${escapeHTML(room.name || `Room ${room.id}`)}
              </h3>

              <p class="muted">
                ${registeredPlayers} / ${expectedPlayers} players registered
              </p>

              <p>
                ${(room.players || []).map(escapeHTML).join(" · ") || "Players to be announced"}
              </p>
            </article>
          `;

        }).join("")
      : '<div class="empty">The organiser has not added rooms yet.</div>';

    const open = settingsSnap.exists() &&
      settingsSnap.data().predictionsOpen === true;

    document.getElementById("predictionStatus").textContent =
      open ? "PREDICTIONS OPEN" : "PREDICTIONS CLOSED";

  } catch (e) {
    grid.innerHTML = `
      <div class="notice error">
        ${escapeHTML(e.message)}
      </div>
    `;
  }
}

loadHome();
