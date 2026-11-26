import {
  auth, db, collection, doc,
  onSnapshot, setDoc, deleteDoc, serverTimestamp, escapeHTML, query, where
} from "./shared.js";
import {
  ROOM_CONFIG, STAGES, deriveRooms, isPlayer, playerLabel, roomReady, scorePrediction
} from "./tournament.js";
import { DEFAULT_USERNAME, normalizeUsername, isValidUsername, USERNAME_HINT } from "./usernames.js";
import { initializeUsernameProfile } from "./profiles.js";
import { initPublicAuth } from "./auth-ui.js";

const host = document.getElementById("predictionList");
const notice = document.getElementById("predictNotice");
const usernameEditor = document.getElementById("usernameEditor");
const usernameForm = document.getElementById("usernameForm");
const usernameInput = document.getElementById("usernameInput");
const usernameHint = document.getElementById("usernameHint");
const usernameError = document.getElementById("usernameError");
const usernameNotice = document.getElementById("usernameNotice");
const currentUsernameRow = document.getElementById("currentUsernameRow");
const currentUsername = document.getElementById("currentUsername");
const saveUsernameBtn = document.getElementById("saveUsernameBtn");
const retryUsernameBtn = document.getElementById("retryUsernameBtn");
const configurations = ROOM_CONFIG.filter(config => config.kind !== "ffa");
const configById = Object.fromEntries(configurations.map(config => [config.id, config]));
let rooms = {};
let derived = {};
let settings = {};
let currentUser = null;
let saved = {};
let savedDocumentIds = {};
let picks = {};
let dirty = new Set();
let operations = new Map();
let authEpoch = 0;
let authRestored = false;
let loadingPredictions = false;
let unsubscribePredictions = null;
let usernameLoaded = false;
let usernameBusy = false;

usernameHint.textContent = USERNAME_HINT;

function showUsernameNotice(message, type = "info") {
  usernameNotice.textContent = message;
  usernameNotice.className = `notice ${type}`;
  usernameNotice.hidden = !message;
}

function clearUsernameError() {
  usernameInput.setAttribute("aria-invalid", "false");
  usernameError.textContent = "";
  usernameError.hidden = true;
}

function setUsernameBusy(busy) {
  usernameBusy = busy;
  usernameForm.setAttribute("aria-busy", String(busy));
  usernameInput.disabled = busy || !usernameLoaded;
  saveUsernameBtn.disabled = busy || !usernameLoaded;
  retryUsernameBtn.disabled = busy;
}

function resetUsernameEditor(user) {
  usernameEditor.hidden = !user;
  usernameForm.hidden = true;
  currentUsernameRow.hidden = true;
  currentUsername.textContent = "";
  usernameInput.value = "";
  usernameLoaded = false;
  retryUsernameBtn.hidden = true;
  clearUsernameError();
  showUsernameNotice("");
  setUsernameBusy(false);
}

async function loadUsernameProfile(user, epoch) {
  if (epoch !== authEpoch || currentUser?.uid !== user.uid || usernameBusy || usernameLoaded) return;
  setUsernameBusy(true);
  retryUsernameBtn.hidden = true;
  showUsernameNotice("Loading your full name…");
  try {
    const profile = await initializeUsernameProfile(user,
      () => epoch === authEpoch && currentUser?.uid === user.uid);
    if (!profile || epoch !== authEpoch || currentUser?.uid !== user.uid) return;
    currentUsername.textContent = profile.username;
    const googleName = normalizeUsername(user.displayName);
    usernameInput.value = profile.needsFullName
      ? isValidUsername(googleName) && googleName !== DEFAULT_USERNAME ? googleName : ""
      : profile.username;
    usernameLoaded = true;
    currentUsernameRow.hidden = false;
    usernameForm.hidden = false;
    showUsernameNotice(profile.needsFullName
      ? "Please enter and save your full name. Until then, your public name is Participant."
      : profile.initialize
        ? "Your Google full name is saved. You can edit it below; it will appear after the next leaderboard update."
        : "", profile.needsFullName ? "info" : "success");
  } catch (error) {
    if (epoch !== authEpoch || currentUser?.uid !== user.uid) return;
    showUsernameNotice("Unable to load or initialize your full name. Retry loading it before editing.", "error");
    retryUsernameBtn.hidden = false;
  } finally {
    if (epoch === authEpoch && currentUser?.uid === user.uid) {
      setUsernameBusy(false);
    }
  }
}

usernameInput.addEventListener("input", clearUsernameError);

retryUsernameBtn.addEventListener("click", () => {
  if (currentUser) void loadUsernameProfile(currentUser, authEpoch);
});

usernameForm.addEventListener("submit", async event => {
  event.preventDefault();
  if (!currentUser || !usernameLoaded || usernameBusy) return;
  const user = currentUser;
  const epoch = authEpoch;
  const username = normalizeUsername(usernameInput.value);
  clearUsernameError();
  if (!isValidUsername(username)) {
    showUsernameNotice("");
    usernameInput.setAttribute("aria-invalid", "true");
    usernameError.textContent = USERNAME_HINT;
    usernameError.hidden = false;
    usernameInput.focus();
    return;
  }
  setUsernameBusy(true);
  showUsernameNotice("Saving your full name…");
  try {
    await setDoc(doc(db, "profiles", user.uid), { username, updatedAt: serverTimestamp() });
    if (epoch !== authEpoch || currentUser?.uid !== user.uid) return;
    currentUsername.textContent = username;
    usernameInput.value = username;
    showUsernameNotice("Full name saved. Your new name will appear on the leaderboard after the next leaderboard update.", "success");
  } catch (error) {
    if (epoch !== authEpoch || currentUser?.uid !== user.uid) return;
    showUsernameNotice("Unable to save your full name. Try saving again.", "error");
  } finally {
    if (epoch === authEpoch && currentUser?.uid === user.uid) {
      setUsernameBusy(false);
    }
  }
});

function showNotice(message, type = "info") {
  notice.textContent = message;
  notice.className = `notice ${type}`;
}

function currentRoom(config) {
  const stored = rooms[config.id] || {};
  if (config.kind === "group") return stored;
  const expected = derived[config.id] || {};
  return {
    ...stored,
    players: expected.players || [],
    playerDetails: { ...stored.playerDetails, ...expected.playerDetails }
  };
}

function ready(config) {
  const stored = rooms[config.id] || {};
  return roomReady(config.id, stored) && (config.kind === "group" ||
    derived[config.id]?.players?.every((key, index) => isPlayer(key) && key === stored.players[index]));
}

function closed(config) {
  const room = rooms[config.id] || {};
  return !currentUser || loadingPredictions || !settings[config.stage] ||
    room.predictionsLocked === true || room.resultsPublished === true || room.status === "completed" || !ready(config);
}

function savedSelection(prediction) {
  if ((prediction?.roomId || prediction?.matchId) === "FINAL" && prediction.formatVersion !== 2 && isPlayer(prediction.champion)) {
    return [prediction.champion];
  }
  if (Array.isArray(prediction?.selectedPlayers) && prediction.selectedPlayers.length) {
    return prediction.selectedPlayers.filter(isPlayer);
  }
  return prediction?.formatVersion !== 2 && isPlayer(prediction?.pick) ? [prediction.pick] : [];
}

function validSelection(config) {
  const selected = picks[config.id] || [];
  const players = currentRoom(config).players || [];
  return selected.length === (config.kind === "group" ? 2 : 1) &&
    new Set(selected).size === selected.length &&
    selected.every(key => isPlayer(key) && players.includes(key));
}

function roomSignature(config) {
  return JSON.stringify([rooms[config.id]?.formatVersion, currentRoom(config).players || []]);
}

function pruneDraft(config) {
  const players = currentRoom(config).players || [];
  const selected = picks[config.id] || [];
  const remaining = selected.filter(key => isPlayer(key) && players.includes(key));
  if (remaining.length !== selected.length) {
    picks[config.id] = remaining;
    dirty.add(config.id);
  }
}

async function savePrediction(id) {
  const config = configById[id];
  if (!config || closed(config) || operations.has(id) || !validSelection(config)) {
    showNotice("Sign in, choose the required players, and save while predictions are open.", "error");
    return;
  }
  const user = currentUser;
  const epoch = authEpoch;
  const signature = roomSignature(config);
  const selectedPlayers = [...picks[id]];
  const operation = {};
  const payload = {
    uid: user.uid, roomId: id, stageId: config.stage, formatVersion: 2,
    displayName: DEFAULT_USERNAME,
    selectedPlayers, updatedAt: serverTimestamp()
  };
  operations.set(id, operation);
  render();
  try {
    await setDoc(doc(db, "predictions", `${user.uid}_${id}`), payload);
    if (authEpoch !== epoch || currentUser?.uid !== user.uid) return;
    if (roomSignature(config) !== signature || !ready(config)) {
      pruneDraft(config);
      showNotice("The players changed while saving. Review the updated room before choosing again.", "info");
      return;
    }
    saved[id] = payload;
    picks[id] = selectedPlayers;
    dirty.delete(id);
    showNotice(`${config.name}: prediction saved.`, "success");
  } catch (error) {
    if (authEpoch === epoch && currentUser?.uid === user.uid) {
      showNotice(`Unable to save prediction: ${error.message}`, "error");
    }
  } finally {
    if (authEpoch === epoch && operations.get(id) === operation) {
      operations.delete(id);
      render();
    }
  }
}

async function resetPrediction(id) {
  const config = configById[id];
  if (!config || closed(config) || operations.has(id)) return;
  const user = currentUser;
  const epoch = authEpoch;
  const operation = {};
  operations.set(id, operation);
  render();
  try {
    const ids = savedDocumentIds[id] || (saved[id] ? [`${user.uid}_${id}`] : []);
    await Promise.all(ids.map(documentId => deleteDoc(doc(db, "predictions", documentId))));
    if (authEpoch !== epoch || currentUser?.uid !== user.uid) return;
    delete saved[id];
    delete savedDocumentIds[id];
    picks[id] = [];
    dirty.delete(id);
    showNotice(`${config.name}: prediction reset.`, "success");
  } catch (error) {
    if (authEpoch === epoch && currentUser?.uid === user.uid) {
      showNotice(`Unable to reset prediction: ${error.message}`, "error");
    }
  } finally {
    if (authEpoch === epoch && operations.get(id) === operation) {
      operations.delete(id);
      render();
    }
  }
}

function savedFeedback(config, room) {
  const prediction = saved[config.id];
  if (!prediction) return "";
  const score = scorePrediction(prediction, rooms);
  const selected = savedSelection(prediction);
  const labelRoom = { playerDetails: Object.assign({}, ...Object.values(rooms).map(item => item.playerDetails), room.playerDetails) };
  const labels = selected.map(key => playerLabel(labelRoom, key)).join(" · ") || "No valid selection";
  return `<div class="saved-prediction">
    <strong>Saved${prediction.formatVersion !== 2 ? " legacy" : ""} pick:</strong> ${escapeHTML(labels)}
    <p>${score.pending ? "Result pending — not scored yet." : `${score.correct} correct · ${score.correct} point${score.correct === 1 ? "" : "s"} · ${score.correct} Lucky Draw ${score.correct === 1 ? "entry" : "entries"}`}</p>
    ${prediction.formatVersion !== 2 && config.kind === "series" ? '<small>Legacy picks are rescored against the confirmed winner only. No podium or semi-final bonus.</small>' : ""}
  </div>`;
}

function roomCard(config) {
  const id = config.id;
  const room = currentRoom(config);
  const stored = rooms[id] || {};
  const selected = picks[id] || [];
  const busy = operations.has(id);
  const disabled = closed(config) || busy;
  const needed = config.kind === "group" ? 2 : 1;
  const published = stored.resultsPublished === true && (config.kind === "group" || ready(config));
  const official = published
    ? config.kind === "group"
      ? (room.qualifiers || []).map((key, index) => `${id}${index + 1}: ${playerLabel(room, key)}`).join(" · ")
      : `Winner: ${playerLabel(room, room.winner)}`
    : "Official result pending";
  let message = !authRestored ? "Restoring your session…"
    : !currentUser ? "Sign in with Google to save predictions."
    : loadingPredictions ? "Loading your saved predictions…"
    : busy ? "Saving changes…"
    : published ? "Results published. Predictions are locked."
    : stored.status === "completed" ? "Ended — results pending. Predictions are closed."
    : stored.predictionsLocked === true ? "Predictions are locked for this room. Saved picks are retained."
    : !ready(config) ? "Waiting for confirmed players."
    : !settings[config.stage] ? "Predictions are closed."
    : !dirty.has(id) && saved[id] ? "Your saved prediction is shown below."
    : "Choose your players, then save your prediction.";
  return `<article class="card prediction-card" id="prediction-${id}">
    <div class="prediction-card-top"><span class="room-tag">${escapeHTML(config.name)}</span>
      <span class="pill">${published || stored.status === "completed" ? "ENDED" : stored.status === "live" ? "LIVE" : "UPCOMING"}</span>
      ${stored.predictionsLocked === true ? '<span class="pill">PREDICTIONS LOCKED</span>' : ""}</div>
    <h3 class="prediction-title">${escapeHTML(config.name)}</h3>
    <p class="muted">${config.kind === "group"
      ? "Choose two qualifiers. Their order does not affect your score."
      : `Choose one series winner. First to ${config.target} wins; the match score does not affect prediction points.`}</p>
    <div class="room-prediction-players">${Array.from({ length: config.size }, (_, index) => {
      const key = room.players?.[index] || "";
      return `<button type="button" class="btn secondary prediction-player ${selected.includes(key) && isPlayer(key) ? "selected" : ""}"
        data-action="pick" data-room="${id}" data-player="${escapeHTML(key)}"
        aria-pressed="${selected.includes(key) && isPlayer(key)}" ${disabled || !isPlayer(key) ? "disabled" : ""}>
        <span>${config.kind === "group" ? `Slot ${index + 1}` : escapeHTML(config.feeders?.[index] || "TBD")}</span>
        <strong>${escapeHTML(playerLabel(room, key))}</strong></button>`;
    }).join("")}</div>
    <div class="prediction-footer"><span>${selected.length}/${needed} selected</span>
      <div class="prediction-actions">
        <button type="button" class="btn secondary" data-action="reset" data-room="${id}"
          ${disabled || (!selected.length && !saved[id]) ? "disabled" : ""}>Reset</button>
        <button type="button" class="btn" data-action="save" data-room="${id}"
          ${disabled || !validSelection(config) || (!dirty.has(id) && saved[id]?.formatVersion === 2) ? "disabled" : ""}>Save prediction</button>
      </div></div>
    <p class="muted prediction-result">${escapeHTML(message)}</p>
    <p class="tournament-result">${escapeHTML(official)}</p>
    ${savedFeedback(config, room)}
  </article>`;
}

function render() {
  const active = document.activeElement;
  const focused = host.contains(active) ? { ...active.dataset } : null;
  host.innerHTML = configurations.map(roomCard).join("");
  if (focused?.action) {
    const replacement = Array.from(host.querySelectorAll("button[data-action]")).find(button =>
      button.dataset.action === focused.action && button.dataset.room === focused.room &&
      button.dataset.player === focused.player && !button.disabled);
    replacement?.focus({ preventScroll: true });
  }
}

host.addEventListener("click", event => {
  const button = event.target.closest("button[data-action]");
  if (!button || button.disabled) return;
  const id = button.dataset.room;
  const config = configById[id];
  if (button.dataset.action === "save") return void savePrediction(id);
  if (button.dataset.action === "reset") return void resetPrediction(id);
  if (!config || closed(config) || operations.has(id)) return;
  const key = button.dataset.player;
  if (!isPlayer(key) || !currentRoom(config).players?.includes(key)) return;
  const selected = picks[id] || [];
  if (selected.includes(key)) {
    picks[id] = selected.filter(player => player !== key);
  } else if (config.kind === "series") {
    picks[id] = [key];
  } else if (selected.length < 2) {
    picks[id] = [...selected, key];
  } else {
    showNotice("Choose two qualifiers only. Deselect a player to change your pick.", "info");
    return;
  }
  dirty.add(id);
  render();
});

initPublicAuth({ initializeProfile: false, onUserChanged: user => {
  authRestored = true;
  const epoch = ++authEpoch;
  unsubscribePredictions?.();
  unsubscribePredictions = null;
  currentUser = user;
  resetUsernameEditor(user);
  saved = {};
  savedDocumentIds = {};
  picks = {};
  dirty = new Set();
  operations = new Map();
  loadingPredictions = Boolean(user);
  showNotice(user ? "Loading your saved predictions…" : "Sign in with Google to save predictions.");
  render();
  if (!user) return;
  void loadUsernameProfile(user, epoch);
  unsubscribePredictions = onSnapshot(query(collection(db, "predictions"), where("uid", "==", user.uid)), snapshot => {
    if (epoch !== authEpoch || currentUser?.uid !== user.uid) return;
    const next = {};
    const documentIds = {};
    snapshot.docs.forEach(document => {
      const prediction = document.data();
      const id = prediction.roomId || prediction.matchId;
      if (prediction.uid !== user.uid || !configById[id]) return;
      (documentIds[id] ||= []).push(document.id);
      const previous = next[id];
      const newer = (prediction.updatedAt?.toMillis?.() || 0) >= (previous?.updatedAt?.toMillis?.() || 0);
      const priority = prediction.formatVersion === 2 ? 1 : 0;
      const previousPriority = previous?.formatVersion === 2 ? 1 : 0;
      if (!previous || priority > previousPriority || (priority === previousPriority && newer)) {
        next[id] = prediction;
      }
    });
    saved = next;
    savedDocumentIds = documentIds;
    configurations.forEach(config => {
      if (!dirty.has(config.id) && !operations.has(config.id)) {
        picks[config.id] = savedSelection(saved[config.id]);
        if (config.kind === "series" && picks[config.id].length !== 1) picks[config.id] = [];
      }
      if (Object.hasOwn(rooms, config.id)) pruneDraft(config);
    });
    loadingPredictions = false;
    showNotice("Your saved predictions are up to date.", "success");
    render();
  }, error => {
    if (epoch !== authEpoch || currentUser?.uid !== user.uid) return;
    showNotice(`Unable to load saved predictions: ${error.message}`, "error");
  });
} });

STAGES.forEach(stage => {
  onSnapshot(doc(db, "settings", `rounds_${stage.id}`), snapshot => {
    settings[stage.id] = snapshot.exists() && snapshot.data().predictionsOpen === true;
    render();
  }, error => {
    settings[stage.id] = false;
    showNotice(`Unable to load prediction availability: ${error.message}`, "error");
    render();
  });
});

onSnapshot(collection(db, "rooms"), snapshot => {
  rooms = Object.fromEntries(snapshot.docs.map(document => [document.id, document.data()]));
  derived = deriveRooms(rooms);
  configurations.forEach(pruneDraft);
  render();
}, error => {
  rooms = {};
  derived = {};
  showNotice(`Unable to load tournament rooms: ${error.message}`, "error");
  render();
});