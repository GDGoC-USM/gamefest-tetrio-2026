import { publicUsername } from './usernames.js';

const newVersion = () => crypto.randomUUID();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const list = value => Array.isArray(value) ? value : [];

// All writers share currentDraw: a stale editor, refresh, spin or undo cannot
// overwrite another administrator's exclusions or winner history.
export function createDrawStore({ db, doc, collection, getDoc, getDocs, runTransaction, serverTimestamp }) {
  const drawRef = doc(db, 'ticketAwards', 'currentDraw');
  const revisionRef = doc(db, 'settings', 'leaderboardRevision');
  const awardsRef = collection(db, 'ticketAwards');
  const revision = snapshot => {
    const value = snapshot.exists() && snapshot.data();
    if (!value || value.ready !== true || value.cleanupPending === true || typeof value.version !== 'string' || !value.version) {
      throw new Error('Leaderboard synchronization is incomplete. Recalculate the leaderboard before refreshing entries.');
    }
    return value.version;
  };
  const checkVersion = (draw, expected) => {
    if ((draw.version || null) !== expected) {
      throw new Error('The draw changed in another operation. Refresh Latest Entries and try again.');
    }
  };
  const MANUAL_UID_PREFIX = 'manual:';
  const MAX_MANUAL_TICKETS = 10000;
  const manualDisplayName = value => {
    const name = typeof value === 'string' ? value.trim() : '';
    return name || 'Participant';
  };
  const entriesFor = (rows, draw) => {
    const excluded = new Set([...list(draw.excludedUids), ...list(draw.removedUids)]);
    const entries = [];
    const leaderboardUids = new Set();

    // Leaderboard prizes come from correct predictions. Custom quantities that
    // differ from the authoritative count remain uncertifiable.
    for (const row of rows) {
      const correct = row.correct;
      if (!Number.isSafeInteger(correct) || correct < 0) {
        throw new Error('Invalid leaderboard ticket count. Recalculate the leaderboard before spinning.');
      }
      leaderboardUids.add(row.uid);
      if (Object.hasOwn(draw.ticketOverrides || {}, row.uid) && draw.ticketOverrides[row.uid] !== correct) {
        throw new Error('Custom ticket quantities differ from prediction awards. Use Reset Edits before spinning.');
      }
      if (excluded.has(row.uid)) continue;
      const displayName = publicUsername(draw.nameOverrides?.[row.uid] ?? row.displayName);
      for (let count = 0; count < correct + 1; count++) entries.push({ uid: row.uid, displayName });
    }

    // Manual participants are an explicit administrator-configured source, not
    // prediction awards. Certify them only when their identity and tickets are
    // unambiguous so same-name people and concurrent edits cannot merge.
    if (draw.manualParticipants !== undefined && !Array.isArray(draw.manualParticipants)) {
      throw new Error('Invalid manual participant list. Fix it before refreshing.');
    }
    const manualIds = new Set();
    for (const participant of list(draw.manualParticipants)) {
      if (!participant || typeof participant !== 'object' || Array.isArray(participant)) {
        throw new Error('Invalid manual participant record. Remove or fix it before refreshing.');
      }
      const id = participant.id;
      if (typeof id !== 'string' || !id.trim()) {
        throw new Error('Manual participant ID is missing or invalid. Remove or fix it before refreshing.');
      }
      if (manualIds.has(id)) {
        throw new Error('Duplicate manual participant ID. Remove or fix it before refreshing.');
      }
      manualIds.add(id);
      const uid = `${MANUAL_UID_PREFIX}${id}`;
      if (leaderboardUids.has(uid)) {
        throw new Error('Manual participant ID collides with a leaderboard UID. Fix it before refreshing.');
      }
      if (typeof participant.displayName !== 'string' || !participant.displayName.trim()) {
        throw new Error('Manual participant name is missing or invalid. Remove or fix it before refreshing.');
      }
      const tickets = participant.tickets;
      if (!Number.isSafeInteger(tickets) || tickets < 0 || tickets > MAX_MANUAL_TICKETS) {
        throw new Error(`Invalid manual participant ticket count. Use 0-${MAX_MANUAL_TICKETS} whole tickets before refreshing.`);
      }
      if (Object.hasOwn(draw.ticketOverrides || {}, uid)) {
        throw new Error('Manual participant ticket overrides are ambiguous. Edit the participant tickets instead.');
      }
      if (excluded.has(uid)) continue;
      const displayName = manualDisplayName(participant.displayName);
      for (let count = 0; count < tickets; count++) entries.push({ uid, displayName });
    }

    return entries;
  };

  async function refresh() {
    // Bracket the collection read with revision reads: partial/replaced syncs
    // cannot certify a mixed leaderboard snapshot.
    const expected = revision(await getDoc(revisionRef));
    const snapshot = await getDocs(collection(db, 'leaderboard'));
    const rows = snapshot.docs.map(item => ({ ...item.data(), uid: item.id }));
    const draw = await runTransaction(db, async transaction => {
      const [revisionSnapshot, saved] = await Promise.all([
        transaction.get(revisionRef), transaction.get(drawRef)
      ]);
      if (revision(revisionSnapshot) !== expected) {
        throw new Error('Leaderboard changed during refresh. Refresh Latest Entries again.');
      }
      const current = saved.exists() ? saved.data() : {};
      const entries = entriesFor(rows, current);
      if (current.version && current.leaderboardVersion === expected && same(current.entries, entries)) return current;
      const updated = { ...current, entries, excludedUids: list(current.excludedUids),
        leaderboardVersion: expected, version: newVersion(), updatedAt: serverTimestamp() };
      transaction.set(drawRef, updated);
      return updated;
    });
    return { draw, rows };
  }

  async function save(expected, settings) {
    return runTransaction(db, async transaction => {
      const snapshot = await transaction.get(drawRef);
      const current = snapshot.exists() ? snapshot.data() : {};
      checkVersion(current, expected);
      const updated = { ...current, ...settings, leaderboardVersion: null,
        version: newVersion(), updatedAt: serverTimestamp() };
      transaction.set(drawRef, updated);
      return updated;
    });
  }

  async function spin(expected) {
    const historyRef = doc(awardsRef);
    // Keep the random sample fixed if Firestore retries this callback.
    const random = crypto.getRandomValues(new Uint32Array(1))[0] / 0x100000000;
    return runTransaction(db, async transaction => {
      const [revisionSnapshot, saved] = await Promise.all([
        transaction.get(revisionRef), transaction.get(drawRef)
      ]);
      const current = saved.exists() ? saved.data() : {};
      checkVersion(current, expected);
      if (revision(revisionSnapshot) !== current.leaderboardVersion) {
        throw new Error('Tickets are outdated. Refresh Latest Entries before spinning.');
      }
      const entries = list(current.entries);
      const exclusions = list(current.excludedUids);
      if (!entries.length || entries.some(entry => !entry.uid || exclusions.includes(entry.uid))) {
        throw new Error('No valid eligible tickets. Refresh Latest Entries before spinning.');
      }
      const winningIndex = Math.floor(random * entries.length);
      const selected = entries[winningIndex];
      const winner = { uid: selected.uid, displayName: manualDisplayName(selected.displayName),
        ticketsAtWin: entries.filter(entry => entry.uid === selected.uid).length,
        drawnAt: serverTimestamp() };
      const updated = { ...current, entries: entries.filter(entry => entry.uid !== selected.uid),
        excludedUids: [...exclusions, selected.uid], lastWinner: winner,
        lastWinnerHistoryId: historyRef.id, version: newVersion(), updatedAt: serverTimestamp() };
      transaction.set(historyRef, { type: 'winner', ...winner });
      transaction.set(drawRef, updated);
      return { draw: updated, entries, winningIndex, winner, historyId: historyRef.id };
    });
  }

  async function undo(historyId) {
    if (!historyId || historyId === 'currentDraw') throw new Error('Invalid winner record.');
    const historyRef = doc(db, 'ticketAwards', historyId);
    return runTransaction(db, async transaction => {
      const [saved, history] = await Promise.all([transaction.get(drawRef), transaction.get(historyRef)]);
      if (!saved.exists() || !history.exists()) throw new Error('Winner already undone or unavailable. Refresh entries.');
      const current = saved.data();
      const winner = history.data();
      if (winner.type !== 'winner' || !list(current.excludedUids).includes(winner.uid)
          || !Number.isSafeInteger(winner.ticketsAtWin) || winner.ticketsAtWin <= 0) {
        throw new Error('Winner record is inconsistent. Refresh entries before trying again.');
      }
      const entries = list(current.entries).filter(entry => entry.uid !== winner.uid);
      for (let count = 0; count < winner.ticketsAtWin; count++) {
        entries.push({ uid: winner.uid, displayName: manualDisplayName(winner.displayName) });
      }
      const updated = { ...current, entries,
        excludedUids: current.excludedUids.filter(uid => uid !== winner.uid),
        // Show historical tickets immediately, but certify current counts only
        // on refresh. Undo must not pin old weights with a ticket override.
        leaderboardVersion: null, version: newVersion(), updatedAt: serverTimestamp() };
      if (current.lastWinnerHistoryId === historyId || (!current.lastWinnerHistoryId && current.lastWinner?.uid === winner.uid)) {
        updated.lastWinner = null;
        updated.lastWinnerHistoryId = null;
      }
      transaction.delete(historyRef);
      transaction.set(drawRef, updated);
      return updated;
    });
  }

  return { refresh, save, spin, undo };
}
