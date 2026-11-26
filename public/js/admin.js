import {
  auth, db, signIn, signInWithEmailAndPassword, signOut, onAuthStateChanged,
  isAdmin, collection, doc, getDoc, getDocs, setDoc, writeBatch,
  serverTimestamp, escapeHTML, showMessage, query, where
} from "./shared.js";
import {
  ROOM_CONFIG, STAGES, isPlayer, playerLabel, roomReady,
  validateGroupResult, validateSeriesResult, validateFFAResult,
  deriveRooms, dependentRoomIds, calculateLeaderboard,
  hasPublishedResults as completed, publishedDependentIds
} from "./tournament.js";
import { parseRosterCSV, prepareRosterImport } from "./roster-import.js";
import { DEFAULT_USERNAME, publicUsername } from "./usernames.js";
import { rankLeaderboardRows, planLeaderboardChanges } from "./leaderboard-sync.js";

const $ = id => document.getElementById(id);
const adminLogin = $("adminLogin");
const adminContent = $("adminContent");
const adminEmail = $("adminEmail");
const adminPassword = $("adminPassword");
const authBtn = $("authBtn");
let roomsCache = {};
let editorRoom = null;
let editorId = "";
let busy = false;
let authorized = false;
let rosterPreview = null;
let adminAuthEpoch = 0;
let moderationProfiles = new Map();
const configFor = id => ROOM_CONFIG.find(config => config.id === id);
const stableJSON = value => JSON.stringify(value, (_key, item) =>
  item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const same = (left, right) => stableJSON(left) === stableJSON(right);

function notify(message, type = "info") {
  showMessage(adminContent.hidden ? $("adminMessage") : $("dashboardMessage"), message, type);
}

async function persist(action) {
  if (busy || !authorized) return;
  busy = true;
  const controls = [...adminContent.querySelectorAll("button, input, select")].filter(
    element => !element.closest("#luckydraw")
  );
  const previous = controls.map(element => element.disabled);
  controls.forEach(element => { element.disabled = true; });
  adminContent.setAttribute("aria-busy", "true");
  adminContent.inert = true;
  authBtn.disabled = true;
  try {
    await action();
  } catch (error) {
    console.error(error);
    notify(error.message || "Unable to save. Please try again.", "error");
  } finally {
    busy = false;
    controls.forEach((element, index) => { element.disabled = previous[index]; });
    adminContent.removeAttribute("aria-busy");
    adminContent.inert = false;
    authBtn.disabled = false;
    $("saveRoomBtn").disabled = completed(editorRoom);
    $("roomStatus").disabled = completed(editorRoom);
    $("saveRosterImportBtn").disabled = !rosterPreview?.plan.changedRoomIds.length;
    $("resetUsernameBtn").disabled = !authorized || !moderationProfiles.has($("moderationUid").value);
  }
}

function showAdminSection(sectionId) {
  if (busy) return;
  document.querySelectorAll(".nav-btn").forEach(button => {
    button.classList.toggle("active", button.dataset.section === sectionId);
  });
  document.querySelectorAll(".admin-section").forEach(section => {
    section.hidden = section.id !== sectionId;
  });
}

document.querySelectorAll(".nav-btn").forEach(button => {
  button.addEventListener("click", () => showAdminSection(button.dataset.section));
});

$("loginBtn").addEventListener("click", async () => {
  const email = adminEmail.value.trim();
  if (!email || !adminPassword.value) {
    notify("Enter your administrator email and password.", "error");
    return;
  }
  $("loginBtn").disabled = true;
  try {
    await signInWithEmailAndPassword(auth, email, adminPassword.value);
  } catch (error) {
    notify(error.message, "error");
  } finally {
    $("loginBtn").disabled = false;
  }
});
[adminEmail, adminPassword].forEach(input => {
  input.addEventListener("keydown", event => {
    if (event.key === "Enter") $("loginBtn").click();
  });
});
authBtn.addEventListener("click", async () => {
  if (busy) return;
  authBtn.disabled = true;
  try {
    if (auth.currentUser) await signOut(auth);
    else await signIn();
  } catch (error) {
    notify(error.message, "error");
  } finally {
    authBtn.disabled = false;
  }
});

onAuthStateChanged(auth, async user => {
  const epoch = ++adminAuthEpoch;
  authorized = false;
  clearRosterPreview();
  clearUsernameModeration();
  adminLogin.hidden = true;
  adminContent.hidden = true;
  authBtn.hidden = false;
  authBtn.textContent = user ? "SIGN OUT" : "SIGN IN WITH GOOGLE";
  if (!user) {
    adminLogin.hidden = false;
    adminPassword.value = "";
    roomsCache = {};
    editorRoom = null;
    $("roomEditorCard").hidden = true;
    notify("Sign in using your administrator account.");
    return;
  }
  try {
    const permitted = await isAdmin(user);
    if (epoch !== adminAuthEpoch || auth.currentUser?.uid !== user.uid) return;
    if (!permitted) {
      await signOut(auth);
      notify("Access denied. This account is not an administrator.", "error");
      return;
    }
    authorized = true;
    adminContent.hidden = false;
    await persist(async () => {
      await Promise.all([fetchRooms(), loadSettings()]);
      if (epoch !== adminAuthEpoch || !authorized) return;
      renderRooms();
      notify("Admin access verified. Rooms and leaderboard are unchanged. Use Prediction Settings → Recalculate leaderboard when needed.", "success");
    });
  } catch (error) {
    if (epoch !== adminAuthEpoch) return;
    authorized = false;
    adminContent.hidden = true;
    adminLogin.hidden = false;
    notify(error.message, "error");
  }
});

async function fetchRooms() {
  const snapshot = await getDocs(collection(db, "rooms"));
  roomsCache = Object.fromEntries(snapshot.docs.map(item => [item.id, item.data()]));
  return roomsCache;
}

function emptyResult(room) {
  const clean = { ...room, status: "upcoming", resultsPublished: false };
  for (const field of [
    "qualifiers", "scores", "winner", "loser", "rounds", "totals", "placings",
    "tied", "decision", "champion", "runnerUp", "secondRunnerUp", "resultsPublishedAt"
  ]) delete clean[field];
  return clean;
}

function baseRoom(config) {
  return {
    name: config.name, stage: config.stage, stageId: config.stage,
    formatVersion: 2, players: Array(config.size).fill(""), playerDetails: {},
    status: "upcoming", resultsPublished: false, predictionsLocked: false
  };
}

function resultText(config, room) {
  if (!room.resultsPublished) return "Results pending";
  const label = key => playerLabel(room, key);
  if (config.kind === "group") {
    return (room.qualifiers || []).map((key, index) => `${index + 1}. ${label(key)}`).join(" / ");
  }
  if (config.kind === "series") {
    if (room.formatVersion !== 2) return "Legacy result — migrate before continuing";
    return `${label(room.winner)} wins ${(room.scores || []).join("–")}`;
  }
  if (!room.placings?.length) return "Totals tied — placings pending organiser decision";
  return room.placings.map((key, index) => `${index + 5}. ${label(key)}`).join(" / ");
}

function renderRooms() {
  $("roomsContainer").innerHTML = ROOM_CONFIG.map(config => {
    const room = roomsCache[config.id] || baseRoom(config);
    return `<article class="admin-card room-overview-card">
      <span class="room-tag">${escapeHTML(config.stage)} · ${escapeHTML(config.id)}</span>
      <h3>${escapeHTML(config.name)}</h3>
      <p class="muted">${escapeHTML(room.status || "upcoming")}${config.target ? ` · FT${config.target}` : ""}</p>
      <div class="room-player-list">${Array.from({ length: config.size }, (_, index) =>
        `<div class="room-player"><span>${index + 1}</span><strong>${escapeHTML(playerLabel(room, room.players?.[index] || ""))}</strong></div>`
      ).join("")}</div>
      <div class="room-result">${escapeHTML(resultText(config, room))}</div>
      ${config.kind !== "ffa" ? `<p class="muted">Room prediction lock: <strong>${room.predictionsLocked === true ? "LOCKED" : "UNLOCKED"}</strong></p>
      <button type="button" class="btn ${room.predictionsLocked === true ? "secondary" : "red"} room-prediction-toggle"
        data-room="${config.id}" data-locked="${room.predictionsLocked === true}"
        aria-label="${room.predictionsLocked === true ? "Unlock" : "Lock"} predictions for ${escapeHTML(config.name)}"
        ${!roomsCache[config.id] ? "disabled" : ""}>${room.predictionsLocked === true ? "Unlock" : "Lock"} predictions</button>` : ""}
    </article>`;
  }).join("");
  $("roomsContainer").querySelectorAll(".room-prediction-toggle").forEach(button => {
    button.addEventListener("click", () => persist(async () => {
      const id = button.dataset.room;
      const locked = button.dataset.locked !== "true";
      const reference = doc(db, "rooms", id);
      const snapshot = await getDoc(reference);
      if (!snapshot.exists()) throw new Error("Initialize the tournament before changing a room lock.");
      await setDoc(reference, {
        predictionsLocked: locked, updatedAt: serverTimestamp()
      }, { merge: true });
      await fetchRooms();
      renderRooms();
      notify(`${configFor(id).name}: predictions ${locked ? "locked" : "unlocked"}. Saved picks are retained. Stage and result restrictions still apply.`, "success");
    }));
  });
  const current = $("room").value;
  $("room").innerHTML = '<option value="">Select stage / room</option>' +
    ROOM_CONFIG.map(config =>
      `<option value="${config.id}">${escapeHTML(config.name)}${config.target ? ` · FT${config.target}` : ""}</option>`
    ).join("");
  $("room").value = current;
  $("matchesContainer").innerHTML = ROOM_CONFIG.map(config => {
    const room = roomsCache[config.id] || {};
    return `<div class="match-row"><div><b>${escapeHTML(config.name)}</b>
      <p class="muted">${escapeHTML(resultText(config, room))}</p></div>
      <button type="button" class="btn secondary edit-room" data-room="${config.id}">Manage room</button></div>`;
  }).join("");
  $("matchesContainer").querySelectorAll(".edit-room").forEach(button => {
    button.addEventListener("click", () => {
      if (busy) return;
      $("room").value = button.dataset.room;
      loadRoomEditor(button.dataset.room);
      $("roomEditorCard").scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

// Option values are slot indexes, never player keys: legacy whitespace is preserved exactly.
function playerOptions(room, selected = "") {
  return '<option value="">Select participant</option>' + (room.players || []).map((key, index) =>
    isPlayer(key) ? `<option value="${index}"${key === selected ? " selected" : ""}>${escapeHTML(playerLabel(room, key))}</option>` : ""
  ).join("");
}

function selectedPlayer(id, room = editorRoom) {
  const value = $(id).value;
  return value === "" ? "" : room.players[Number(value)];
}

function rankField(id, title, room, selected = "") {
  return `<div class="field"><label for="${id}">${escapeHTML(title)}</label>
    <select id="${id}">${playerOptions(room, selected)}</select></div>`;
}

function loadRoomEditor(id) {
  const config = configFor(id);
  if (!config) return;
  editorId = id;
  editorRoom = roomsCache[id] || baseRoom(config);
  const room = editorRoom;
  const locked = config.kind !== "group" || completed(room);
  $("roomEditorCard").hidden = false;
  $("roomFormTitle").textContent = config.name;
  $("roomStatus").value = room.status === "live" ? "live" : "upcoming";
  $("roomStatus").disabled = completed(room);
  $("saveRoomBtn").disabled = completed(room);
  $("publishRoomBtn").textContent = room.resultsPublished ? "Correct published results" : "Publish Results";
  $("unpublishRoomBtn").hidden = !completed(room);
  $("roomPlayers").innerHTML = Array.from({ length: config.size }, (_, index) => {
    const key = room.players?.[index] || "";
    const detail = isPlayer(key) ? room.playerDetails?.[key] || {} : {};
    if (config.kind !== "group") {
      return `<div class="feeder-slot"><strong>Slot ${index + 1}: ${escapeHTML(playerLabel(room, key))}</strong>
        <p class="muted">Read-only · ${escapeHTML(config.feeders?.[index] || "confirmed feeder result")}</p></div>`;
    }
    return `<fieldset class="participant-slot"${locked ? " disabled" : ""}>
      <legend>Slot ${index + 1}</legend>
      <div class="field"><label for="participantId${index}">Participant ID</label>
        <input type="text" id="participantId${index}" value="${escapeHTML(detail.participantId || "")}" placeholder="GF001"></div>
      <div class="field"><label for="username${index}">Username</label>
        <input type="text" id="username${index}" value="${escapeHTML(isPlayer(key) ? detail.username || key.trim() : "")}" placeholder="TBD"></div>
      <label class="empty-slot-label"><input type="checkbox" id="emptySlot${index}"${!isPlayer(key) ? " checked" : ""}> Empty slot</label>
      <small class="muted">${isPlayer(key) ? "Existing player key is retained when editing details." : "No participant ID is saved for a blank slot."}</small>
    </fieldset>`;
  }).join("");
  if (config.kind === "group") {
    for (let index = 0; index < config.size; index++) {
      const toggle = () => {
        const empty = $(`emptySlot${index}`).checked;
        $(`participantId${index}`).disabled = locked || empty;
        $(`username${index}`).disabled = locked || empty;
      };
      $(`emptySlot${index}`).addEventListener("change", toggle);
      toggle();
    }
  }
  if (config.kind === "group") {
    $("roomResultFields").innerHTML = `<p class="muted">After 5 FFA rounds, enter cumulative group ranks manually. These ordered seeds determine the quarterfinal bracket.</p>` +
      rankField("qualifier1", "1st place qualifier", room, room.qualifiers?.[0]) +
      rankField("qualifier2", "2nd place qualifier", room, room.qualifiers?.[1]);
  } else if (config.kind === "series") {
    $("roomResultFields").innerHTML = `<h3>First to ${config.target}</h3><p class="muted">Exactly one score must be ${config.target}; the losing score must be lower.</p>` +
      (room.players || []).map((key, index) => `<div class="field">
        <label for="seriesScore${index}">${escapeHTML(playerLabel(room, key))}</label>
        <input type="number" id="seriesScore${index}" min="0" max="${config.target}" step="1" value="${Number.isInteger(room.scores?.[index]) ? room.scores[index] : ""}"></div>`).join("");
  } else {
    $("roomResultFields").innerHTML = `<h3>Five-round placement FFA</h3>
      <p class="muted">Enter each round’s finishing order. Points: 1st = 4, 2nd = 3, 3rd = 2, 4th = 1. Final ranks are 5th–8th. No audience predictions.</p>` +
      Array.from({ length: 5 }, (_, round) => `<fieldset class="ffa-round"><legend>Round ${round + 1}</legend><div class="ffa-order">` +
        Array.from({ length: 4 }, (_, place) => rankField(`ffa${round}_${place}`, `${place + 1}${["st", "nd", "rd", "th"][place]}`, room, room.rounds?.[round]?.[place])).join("") +
        "</div></fieldset>").join("") +
      `<div id="ffaTotals" class="room-result" role="status" aria-live="polite"></div>
      <label class="empty-slot-label"><input type="checkbox" id="useTieDecision"${room.decision?.length ? " checked" : ""}> Apply explicit organiser ranking for tied totals</label>
      <p class="muted">Leave unchecked to publish totals with tied placings pending. A decision must rank all players and preserve the order of unequal totals.</p>
      <div class="ffa-order" id="tieDecisionFields">` +
      Array.from({ length: 4 }, (_, index) => rankField(`decision${index}`, `${index + 5}th overall`, room, room.decision?.[index])).join("") + "</div>";
    $("roomResultFields").querySelectorAll("select, input").forEach(input => {
      input.addEventListener("change", renderFFATotals);
    });
    renderFFATotals();
  }
}

function readFFA(room) {
  const rounds = Array.from({ length: 5 }, (_, round) =>
    Array.from({ length: 4 }, (_, place) => selectedPlayer(`ffa${round}_${place}`, room)));
  const decision = $("useTieDecision").checked
    ? Array.from({ length: 4 }, (_, index) => selectedPlayer(`decision${index}`, room))
    : [];
  return { rounds, decision };
}

function renderFFATotals() {
  $("tieDecisionFields").hidden = !$("useTieDecision").checked;
  try {
    const { rounds, decision } = readFFA(editorRoom);
    const result = validateFFAResult(editorRoom, rounds, decision);
    $("ffaTotals").textContent = editorRoom.players.map(key =>
      `${playerLabel(editorRoom, key)}: ${result.totals[key]} points`
    ).join(" / ") + (result.placings.length ? " · Ranking confirmed" : " · Tied placings pending organiser decision");
  } catch (error) {
    $("ffaTotals").textContent = error.message;
  }
}

function readRoster() {
  const config = configFor(editorId);
  if (config.kind !== "group") {
    return { players: editorRoom.players, playerDetails: editorRoom.playerDetails || {} };
  }
  const players = [];
  const playerDetails = Object.create(null);
  for (let index = 0; index < config.size; index++) {
    if ($(`emptySlot${index}`).checked) {
      players.push("");
      continue;
    }
    const username = $(`username${index}`).value.trim();
    const participantId = $(`participantId${index}`).value.trim();
    if (!username) {
      if (participantId) throw new Error(`Slot ${index + 1}: enter a username or clear the slot.`);
      players.push("");
      continue;
    }
    const originalKey = editorRoom.players?.[index];
    if (!isPlayer(originalKey) && !participantId) {
      throw new Error(`Slot ${index + 1}: enter a Participant ID for the new participant.`);
    }
    const key = isPlayer(originalKey) ? originalKey : username;
    if (!isPlayer(key)) throw new Error("TBD is reserved for empty slots.");
    players.push(key);
    const previousDetail = editorRoom.playerDetails?.[key];
    if (previousDetail || participantId || username !== key.trim()) {
      playerDetails[key] = { participantId, username };
    } else if (!isPlayer(originalKey)) {
      playerDetails[key] = { participantId, username };
    }
  }
  const actual = players.filter(isPlayer);
  if (new Set(actual).size !== actual.length) throw new Error("Each participant must have a distinct player key.");
  for (const config of ROOM_CONFIG.filter(item => item.kind === "group" && item.id !== editorId)) {
    const other = roomsCache[config.id]?.players || [];
    if (actual.some(key => other.includes(key))) throw new Error("A participant cannot appear in two groups.");
  }
  return { players, playerDetails };
}

async function freshEditor() {
  await fetchRooms();
  const fresh = roomsCache[editorId] || baseRoom(configFor(editorId));
  if (!same(fresh, editorRoom)) {
    throw new Error("This room changed since you opened it. Select the room again before saving.");
  }
  return fresh;
}

function requireInitialized() {
  if (ROOM_CONFIG.some(config => !roomsCache[config.id] ||
    (config.kind !== "group" && roomsCache[config.id].formatVersion !== 2))) {
    throw new Error("Use Rooms → Initialize / migrate format before changing the bracket.");
  }
}

function dependencyWarning(id, verb) {
  const ids = dependentRoomIds(id);
  return `${verb} ${configFor(id).name}?\n\n` +
    (ids.length ? `Reset dependent rooms: ${ids.join(", ")}. Their results will be cleared and ALL their predictions deleted.\n\n` : "") +
    "This room’s predictions are retained. Continue?";
}

// A feeder result may only change while every downstream room is unpublished;
// otherwise changing it would silently discard official downstream results.
function assertNoPublishedDependents(id, action) {
  const blockers = publishedDependentIds(id, roomsCache);
  if (!blockers.length) return;
  const names = blockers.map(dependentId => configFor(dependentId).name);
  throw new Error(`${action} is blocked: ${names.join(", ")} ${names.length === 1 ? "still has" : "still have"} ` +
    `published results. Reopen ${names.length === 1 ? "that room" : "those rooms"} first, in this order: ` +
    `${names.join(" → ")}. Nothing was changed.`);
}

function reopenWarning(id) {
  const ids = dependentRoomIds(id);
  return `Unpublish results for ${configFor(id).name}?\n\n` +
    "Its published result is removed and the room returns to an editable state. Its players and its own predictions are kept; prediction scores are recalculated from the remaining published results.\n\n" +
    (ids.length ? `Reset dependent rooms: ${ids.join(", ")}. Their results are cleared and their predictions are deleted.\n\n` : "") +
    "Unrelated tournament data is not affected. Continue?";
}

// Predictions for reset rooms only: two `in` queries instead of a full collection scan.
async function predictionsForRooms(roomIds) {
  const ids = [...new Set(roomIds)];
  const references = new Map();
  if (!ids.length) return [];
  for (const field of ["roomId", "matchId"]) {
    for (let index = 0; index < ids.length; index += 30) {
      const snapshot = await getDocs(query(collection(db, "predictions"),
        where(field, "in", ids.slice(index, index + 30))));
      snapshot.docs.forEach(item => references.set(item.ref.path, item.ref));
    }
  }
  return [...references.values()];
}

// Source, transitive resets and feeder metadata commit atomically before prediction
// cleanup, which is chunked because one batch cannot exceed 500 writes.
async function writeRoomChanges(sources, resetIds) {
  const working = { ...roomsCache, ...Object.fromEntries(sources) };
  resetIds.forEach(dependentId => {
    working[dependentId] = emptyResult(working[dependentId] || baseRoom(configFor(dependentId)));
  });
  const derived = deriveRooms(working);
  const updates = new Map(sources);
  resetIds.forEach(dependentId => {
    updates.set(dependentId, {
      ...derived[dependentId], predictionsLocked: working[dependentId].predictionsLocked === true
    });
  });
  // Metadata changes also reach unchanged feeder rosters without overwriting their results.
  for (const [dependentId, expected] of Object.entries(derived)) {
    if (updates.has(dependentId)) continue;
    const current = working[dependentId];
    if (current && same(current.players, expected.players) &&
      !same(current.playerDetails || {}, expected.playerDetails || {})) {
      updates.set(dependentId, { ...current, playerDetails: expected.playerDetails });
    }
  }
  const predictionRefs = resetIds.length ? await predictionsForRooms(resetIds) : [];
  const batch = writeBatch(db);
  updates.forEach((room, roomId) => {
    batch.set(doc(db, "rooms", roomId), { ...room, updatedAt: serverTimestamp() });
  });
  await batch.commit();
  let deleted = 0;
  for (let index = 0; index < predictionRefs.length; index += 450) {
    const chunk = predictionRefs.slice(index, index + 450);
    const deletion = writeBatch(db);
    chunk.forEach(reference => deletion.delete(reference));
    try {
      await deletion.commit();
    } catch (error) {
      throw new Error(`Room results were saved, but only ${deleted} of ${predictionRefs.length} dependent predictions could be deleted: ${error.message}. Reload the dashboard and recalculate the leaderboard.`);
    }
    deleted += chunk.length;
  }
  return deleted;
}

async function writeRoomChange(id, source, resetDependents) {
  const deleted = await writeRoomChanges(new Map([[id, source]]), resetDependents ? dependentRoomIds(id) : []);
  await refreshAfterWrite(id, resetDependents);
  return deleted;
}

async function refreshAfterWrite(id, recalculate = true) {
  await fetchRooms();
  renderRooms();
  if (id) loadRoomEditor(id);
  if (!recalculate) return;
  try {
    await recalculateLeaderboard();
  } catch (error) {
    throw new Error(`Room changes were saved, but leaderboard recalculation failed: ${error.message}. Use Recalculate leaderboard before the Lucky Draw.`);
  }
}

$("room").addEventListener("change", async () => {
  if (busy) return;
  const id = $("room").value;
  if (!id) {
    $("roomEditorCard").hidden = true;
    return;
  }
  try {
    await fetchRooms();
    loadRoomEditor(id);
  } catch (error) {
    notify(error.message, "error");
  }
});
$("cancelRoomBtn").addEventListener("click", () => {
  $("room").value = "";
  $("roomEditorCard").hidden = true;
  editorRoom = null;
  editorId = "";
});

function clearRosterPreview() {
  rosterPreview = null;
  $("rosterImportPreview").hidden = true;
  $("rosterImportPreview").replaceChildren();
  $("rosterImportMessage").textContent = "";
  $("saveRosterImportBtn").disabled = true;
}

$("rosterCSV").addEventListener("change", clearRosterPreview);

$("previewRosterImportBtn").addEventListener("click", () => persist(async () => {
  clearRosterPreview();
  const file = $("rosterCSV").files[0];
  if (!file) throw new Error("Choose a roster CSV file first.");
  const entries = parseRosterCSV(await file.text());
  await fetchRooms();
  requireInitialized();
  const plan = prepareRosterImport(entries, roomsCache);
  rosterPreview = { entries, plan, rooms: roomsCache };
  $("rosterImportPreview").innerHTML = Object.entries(plan.rosters).map(([id, roster]) => {
    const players = roster.players.filter(isPlayer);
    return `<section class="roster-preview-group"><h4>Group ${escapeHTML(id)}</h4>
      <p>${players.length} participant${players.length === 1 ? "" : "s"} · ${roster.players.length - players.length} empty slot${roster.players.length - players.length === 1 ? "" : "s"}</p>
      <ol>${players.map(key => `<li>${escapeHTML(playerLabel(roster, key))}</li>`).join("")}</ol></section>`;
  }).join("");
  $("rosterImportPreview").hidden = false;
  showMessage($("rosterImportMessage"), plan.changedRoomIds.length
    ? `${entries.length} participants validated. Change groups: ${plan.changedRoomIds.join(", ")}. Reset dependent rooms: ${plan.resetRoomIds.join(", ") || "none"}. Saving deletes predictions for those dependent rooms; predictions for the listed groups are retained.`
    : "This CSV already matches the saved rosters. No changes to save.", "info");
}));

$("saveRosterImportBtn").addEventListener("click", () => persist(async () => {
  const preview = rosterPreview;
  if (!preview) throw new Error("Preview a roster CSV before saving.");
  await fetchRooms();
  requireInitialized();
  if (!same(roomsCache, preview.rooms)) {
    clearRosterPreview();
    throw new Error("Tournament rooms changed after the preview. Preview the CSV again before saving.");
  }
  const plan = prepareRosterImport(preview.entries, roomsCache);
  if (!plan.changedRoomIds.length) return;
  plan.changedRoomIds.forEach(id =>
    assertNoPublishedDependents(id, `Importing the roster for ${configFor(id).name}`));
  if (!confirm(`Import roster for groups ${plan.changedRoomIds.join(", ")}?\n\n` +
    "Replace their entire rosters in file order and leave unused slots empty. Groups absent from the CSV are unchanged.\n\n" +
    `Reset dependent rooms: ${plan.resetRoomIds.join(", ") || "none"}. Their results will be cleared and ALL their predictions deleted.\n\n` +
    "Predictions for the imported groups are retained. Continue?")) return;
  const sources = new Map(plan.changedRoomIds.map(id => [id, {
    ...emptyResult(roomsCache[id]), ...plan.rosters[id],
    name: configFor(id).name, stage: configFor(id).stage,
    stageId: configFor(id).stage, formatVersion: 2,
    status: roomsCache[id].status === "live" ? "live" : "upcoming"
  }]));
  const deleted = await writeRoomChanges(sources, plan.resetRoomIds);
  clearRosterPreview();
  $("rosterCSV").value = "";
  await refreshAfterWrite(editorId);
  notify(`Roster imported for groups ${plan.changedRoomIds.join(", ")}. ${deleted} dependent prediction(s) deleted; group predictions retained.`, "success");
}));

$("saveRoomBtn").addEventListener("click", () => persist(async () => {
  const previous = await freshEditor();
  requireInitialized();
  if (completed(previous)) throw new Error("Reopen this room explicitly before editing its roster or status.");
  const roster = readRoster();
  const changed = !same(previous.players, roster.players) || !same(previous.playerDetails || {}, roster.playerDetails);
  if (changed) assertNoPublishedDependents(editorId, `Saving roster changes for ${configFor(editorId).name}`);
  if (changed && !confirm(dependencyWarning(editorId, "Save roster changes for"))) return;
  const source = {
    ...(changed ? emptyResult(previous) : previous), ...roster,
    name: configFor(editorId).name, stage: configFor(editorId).stage,
    stageId: configFor(editorId).stage, formatVersion: 2, status: $("roomStatus").value
  };
  await writeRoomChange(editorId, source, changed);
  notify(changed ? "Room saved. Dependent feeders and leaderboard are up to date."
    : "Room status saved. Scores are unchanged; use Recalculate leaderboard to refresh public usernames.", "success");
}));

$("publishRoomBtn").addEventListener("click", () => persist(async () => {
  const room = await freshEditor();
  requireInitialized();
  assertNoPublishedDependents(editorId, `Publishing results for ${configFor(editorId).name}`);
  const config = configFor(editorId);
  const roster = readRoster();
  if (!same(room.players, roster.players) || !same(room.playerDetails || {}, roster.playerDetails)) {
    throw new Error("Save participant details before publishing results. Completed rosters must be reopened first.");
  }
  if (!roomReady(editorId, room)) throw new Error("This room does not have enough confirmed, distinct participants.");
  let result;
  if (config.kind === "group") {
    result = validateGroupResult(room, [selectedPlayer("qualifier1"), selectedPlayer("qualifier2")]);
  } else if (config.kind === "series") {
    const scores = [0, 1].map(index => {
      const value = $(`seriesScore${index}`).value;
      if (value === "") throw new Error("Enter both series scores, including zero.");
      return Number(value);
    });
    result = validateSeriesResult(editorId, room, scores);
  } else {
    const { rounds, decision } = readFFA(room);
    result = { ...validateFFAResult(room, rounds, decision), decision };
  }
  const unchanged = room.resultsPublished === true && Object.entries(result).every(([field, value]) =>
    ["status", "resultsPublished", "formatVersion"].includes(field) ||
    same(field === "decision" ? room.decision || [] : room[field], value));
  if (unchanged) {
    await recalculateLeaderboard();
    notify("Results unchanged. Dependent rooms and all predictions were retained; leaderboard recalculated.", "success");
    return;
  }
  if (!confirm(dependencyWarning(editorId, room.resultsPublished ? "Correct results for" : "Publish results for"))) return;
  const deleted = await writeRoomChange(editorId, {
    ...emptyResult(room), ...result, resultsPublishedAt: serverTimestamp()
  }, true);
  notify(`Results published. ${deleted} dependent prediction(s) deleted; this room’s predictions retained.`, "success");
}));

$("unpublishRoomBtn").addEventListener("click", () => persist(async () => {
  const room = await freshEditor();
  requireInitialized();
  if (!completed(room)) throw new Error("This room is already open.");
  assertNoPublishedDependents(editorId, `Reopening ${configFor(editorId).name}`);
  if (!confirm(reopenWarning(editorId))) return;
  const deleted = await writeRoomChange(editorId, emptyResult(room), true);
  notify(`Room reopened. Its roster and predictions were retained; ${deleted} dependent prediction(s) deleted.`, "success");
}));

$("initializeTournamentBtn").addEventListener("click", () => persist(async () => {
  await fetchRooms();
  const working = { ...roomsCache };
  const resetIds = new Set();
  const updates = new Map();
  for (const config of ROOM_CONFIG) {
    if (config.kind === "group") {
      if (!working[config.id]) {
        working[config.id] = baseRoom(config);
        updates.set(config.id, working[config.id]);
      }
      continue;
    }
    const current = working[config.id];
    if (!current || current.formatVersion !== 2 || !Array.isArray(current.players) || current.players.length !== config.size) {
      resetIds.add(config.id);
      dependentRoomIds(config.id).forEach(id => resetIds.add(id));
    }
  }
  resetIds.forEach(id => {
    working[id] = { ...baseRoom(configFor(id)), predictionsLocked: roomsCache[id]?.predictionsLocked === true };
  });
  const derived = deriveRooms(working);
  // An explicit migration also repairs feeder drift, resetting all affected descendants.
  for (const config of ROOM_CONFIG.filter(item => item.kind !== "group")) {
    if (!same(working[config.id]?.players, derived[config.id].players)) {
      resetIds.add(config.id);
      dependentRoomIds(config.id).forEach(id => resetIds.add(id));
    }
  }
  resetIds.forEach(id => {
    working[id] = { ...baseRoom(configFor(id)), predictionsLocked: roomsCache[id]?.predictionsLocked === true };
  });
  const finalDerived = deriveRooms(working);
  resetIds.forEach(id => updates.set(id, {
    ...finalDerived[id], predictionsLocked: working[id].predictionsLocked === true
  }));
  for (const [id, expected] of Object.entries(finalDerived)) {
    if (!resetIds.has(id) && !same(working[id]?.playerDetails || {}, expected.playerDetails || {})) {
      updates.set(id, { ...working[id], playerDetails: expected.playerDetails });
    }
  }
  if (!confirm("Initialize / migrate this tournament?\n\n" +
    `Reset rooms: ${[...resetIds].join(", ") || "none"}.\n` +
    "All predictions for reset rooms will be deleted. Group players, metadata, results and predictions are retained exactly. Existing compatible rooms retain their results.\n\nContinue?")) return;
  const predictions = await getDocs(collection(db, "predictions"));
  const batch = writeBatch(db);
  updates.forEach((room, id) => batch.set(doc(db, "rooms", id), {
    ...room, updatedAt: serverTimestamp()
  }));
  predictions.docs.forEach(item => {
    if (resetIds.has(item.data().roomId || item.data().matchId)) batch.delete(item.ref);
  });
  await batch.commit();
  await refreshAfterWrite(editorId);
  notify("Tournament format initialized. Group data and group predictions were retained.", "success");
}));

function clearUsernameModeration() {
  moderationProfiles = new Map();
  $("moderationUid").innerHTML = '<option value="">Load usernames first</option>';
  $("resetUsernameBtn").disabled = true;
  $("moderationMessage").textContent = "";
}

function renderUsernameModeration(selected = "") {
  const profiles = [...moderationProfiles].sort((left, right) =>
    left[1].localeCompare(right[1]) || left[0].localeCompare(right[0]));
  $("moderationUid").innerHTML = '<option value="">Select a public username</option>' +
    profiles.map(([uid, username]) =>
      `<option value="${escapeHTML(uid)}">${escapeHTML(username)} · ${escapeHTML(uid)}</option>`).join("");
  $("moderationUid").value = moderationProfiles.has(selected) ? selected : "";
  $("resetUsernameBtn").disabled = !moderationProfiles.has($("moderationUid").value);
}

$("moderationUid").addEventListener("change", () => {
  $("resetUsernameBtn").disabled = !authorized || !moderationProfiles.has($("moderationUid").value);
});

$("loadUsernamesBtn").addEventListener("click", () => persist(async () => {
  const epoch = adminAuthEpoch;
  showMessage($("moderationMessage"), "Loading public usernames…");
  const snapshot = await getDocs(collection(db, "profiles"));
  if (epoch !== adminAuthEpoch || !authorized) return;
  moderationProfiles = new Map(snapshot.docs.map(item => [item.id, publicUsername(item.data().username)]));
  renderUsernameModeration();
  showMessage($("moderationMessage"), moderationProfiles.size
    ? "Select a username to reset. UIDs distinguish accounts with duplicate names."
    : "No saved usernames yet.");
}));

$("resetUsernameBtn").addEventListener("click", () => persist(async () => {
  const uid = $("moderationUid").value;
  if (!moderationProfiles.has(uid)) return;
  if (!confirm(`Reset ${moderationProfiles.get(uid)} (${uid}) to ${DEFAULT_USERNAME}?\n\n` +
    "Predictions, points and Lucky Draw tickets will not change. The user may choose a new name later.")) return;
  const epoch = adminAuthEpoch;
  await setDoc(doc(db, "profiles", uid), { username: DEFAULT_USERNAME, updatedAt: serverTimestamp() });
  if (epoch !== adminAuthEpoch || !authorized) return;
  moderationProfiles.set(uid, DEFAULT_USERNAME);
  renderUsernameModeration(uid);
  showMessage($("moderationMessage"),
    "Username reset. It will appear on the leaderboard after the next successful recalculation.", "success");
}));

async function readLeaderboardUsernames(uids) {
  const usernames = new Map();
  for (let index = 0; index < uids.length; index += 30) {
    const snapshot = await getDocs(query(collection(db, "profiles"),
      where("__name__", "in", uids.slice(index, index + 30))));
    snapshot.docs.forEach(item => usernames.set(item.id, publicUsername(item.data().username)));
  }
  return usernames;
}

async function recalculateLeaderboard() {
  const [predictionSnapshot, roomSnapshot, leaderboardSnapshot] = await Promise.all([
    getDocs(collection(db, "predictions")), getDocs(collection(db, "rooms")),
    getDocs(collection(db, "leaderboard"))
  ]);
  const rooms = Object.fromEntries(roomSnapshot.docs.map(item => [item.id, item.data()]));
  const predictions = predictionSnapshot.docs.map(item => ({ ...item.data(), id: item.id }));
  const scores = calculateLeaderboard(predictions, rooms);
  const usernames = await readLeaderboardUsernames(scores.map(row => row.uid));
  const rows = rankLeaderboardRows(scores, usernames);
  const existing = new Map(leaderboardSnapshot.docs.map(item => [item.id, item.data()]));
  const changes = planLeaderboardChanges(rows, existing);
  // Full replacement repairs obsolete fields; unchanged rows retain their timestamps.
  const operations = changes.upserts.map(row => batch => batch.set(doc(db, "leaderboard", row.uid), {
    ...row, updatedAt: serverTimestamp()
  }));
  changes.deletes.forEach(uid => operations.push(batch => batch.delete(doc(db, "leaderboard", uid))));
  for (let index = 0; index < operations.length; index += 450) {
    const batch = writeBatch(db);
    operations.slice(index, index + 450).forEach(operation => operation(batch));
    await batch.commit();
  }
  return { written: changes.upserts.length, deleted: changes.deletes.length };
}

$("recalculateLeaderboardBtn").addEventListener("click", () => persist(async () => {
  const result = await recalculateLeaderboard();
  notify(`Leaderboard updated: ${result.written} written, ${result.deleted} deleted. Refresh Lucky Draw tickets before spinning.`, "success");
}));

async function loadSettings() {
  const snapshots = await Promise.all(STAGES.map(stage =>
    getDoc(doc(db, "settings", `rounds_${stage.id}`))));
  $("stagePredictionControls").innerHTML = STAGES.map((stage, index) => {
    const open = snapshots[index].exists() && snapshots[index].data().predictionsOpen === true;
    return `<article class="admin-card"><h3>${escapeHTML(stage.name)}</h3>
      <p class="muted">Predictions are ${open ? "OPEN" : "CLOSED"}.</p>
      <button type="button" class="btn ${open ? "red" : ""} stage-toggle"
        data-stage="${stage.id}" data-open="${open}">${open ? "CLOSE" : "OPEN"} PREDICTIONS</button></article>`;
  }).join("");
  $("stagePredictionControls").querySelectorAll(".stage-toggle").forEach(button => {
    button.addEventListener("click", () => persist(async () => {
      const open = button.dataset.open !== "true";
      await setDoc(doc(db, "settings", `rounds_${button.dataset.stage}`), {
        predictionsOpen: open, updatedAt: serverTimestamp()
      }, { merge: true });
      await loadSettings();
      notify(`${button.dataset.stage} predictions are now ${open ? "OPEN" : "CLOSED"}.`, "success");
    }));
  });
}