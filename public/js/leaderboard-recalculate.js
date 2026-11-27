import { calculateLeaderboard } from './tournament.js';
import { rankLeaderboardRows, planLeaderboardChanges } from './leaderboard-sync.js';
import { publicUsername } from './usernames.js';

// Cleanup supplies its owning fence; ordinary recalculation uses the shared revision store.
export function createLeaderboardRecalculator({ db, doc, collection, query, where,
  getDocs, runTransaction, serverTimestamp, revisions }) {
  return async function recalculateLeaderboard(expectedVersion, fence = revisions) {
    const version = await fence.begin(expectedVersion);
    const [predictionSnapshot, roomSnapshot, leaderboardSnapshot] = await Promise.all([
      getDocs(collection(db, 'predictions')), getDocs(collection(db, 'rooms')),
      getDocs(collection(db, 'leaderboard'))
    ]);
    const rooms = Object.fromEntries(roomSnapshot.docs.map(item => [item.id, item.data()]));
    const predictions = predictionSnapshot.docs.map(item => ({ ...item.data(), id: item.id }));
    const scores = calculateLeaderboard(predictions, rooms);
    const uids = scores.map(row => row.uid);
    const usernames = new Map();
    for (let index = 0; index < uids.length; index += 30) {
      const snapshot = await getDocs(query(collection(db, 'profiles'),
        where('__name__', 'in', uids.slice(index, index + 30))));
      snapshot.docs.forEach(item => usernames.set(item.id, publicUsername(item.data().username)));
    }
    const rows = rankLeaderboardRows(scores, usernames);
    const existing = new Map(leaderboardSnapshot.docs.map(item => [item.id, item.data()]));
    const changes = planLeaderboardChanges(rows, existing);
    const operations = changes.upserts.map(row => transaction => transaction.set(doc(db, 'leaderboard', row.uid), {
      ...row, updatedAt: serverTimestamp()
    }));
    changes.deletes.forEach(uid => operations.push(transaction => transaction.delete(doc(db, 'leaderboard', uid))));
    for (let index = 0; index < operations.length; index += 450) {
      await runTransaction(db, async transaction => {
        await fence.assert(transaction, version);
        operations.slice(index, index + 450).forEach(operation => operation(transaction));
      });
    }
    await fence.finish(version);
    return { written: changes.upserts.length, deleted: changes.deletes.length };
  };
}
