import { publicUsername } from './usernames.js';

const ROW_FIELDS = ['uid', 'displayName', 'correct', 'points', 'pending', 'rank'];
const STORED_FIELDS = [...ROW_FIELDS, 'updatedAt'];

export function rankLeaderboardRows(scores, usernames = new Map()) {
  return scores.map(score => ({
    uid: score.uid,
    displayName: publicUsername(usernames.get(score.uid)),
    correct: score.correct,
    points: score.correct,
    pending: score.pending
  })).sort((a, b) => b.correct - a.correct || a.displayName.localeCompare(b.displayName))
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

function hasTimestamp(value) {
  if (!value || typeof value.toMillis !== 'function') return false;
  try {
    return Number.isFinite(value.toMillis());
  } catch {
    return false;
  }
}

export function planLeaderboardChanges(rows, existing) {
  const upserts = [];
  const currentUids = new Set();
  for (const row of rows) {
    currentUids.add(row.uid);
    const stored = existing.get(row.uid);
    if (stored && Object.keys(stored).length === STORED_FIELDS.length
        && STORED_FIELDS.every(field => Object.hasOwn(stored, field))
        && ROW_FIELDS.every(field => stored[field] === row[field])
        && hasTimestamp(stored.updatedAt)) continue;
    upserts.push({
      uid: row.uid,
      displayName: row.displayName,
      correct: row.correct,
      points: row.points,
      pending: row.pending,
      rank: row.rank
    });
  }
  return { upserts, deletes: [...existing.keys()].filter(uid => !currentUids.has(uid)) };
}
