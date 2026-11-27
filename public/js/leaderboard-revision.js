export function createLeaderboardRevisionStore({ db, doc, runTransaction, serverTimestamp }) {
  const reference = doc(db, "settings", "leaderboardRevision");
  const superseded = () => new Error("The tournament or leaderboard changed during this operation. Recalculate the leaderboard before using Lucky Draw.");

  function invalidate(writer, { cleanupPending = false } = {}) {
    const version = globalThis.crypto.randomUUID();
    writer.set(reference, { version, ready: false, cleanupPending, updatedAt: serverTimestamp() });
    return version;
  }

  async function assertIdle(transaction, { requireReady = false } = {}) {
    const snapshot = await transaction.get(reference);
    const revision = snapshot.exists() ? snapshot.data() : null;
    if (revision?.cleanupPending === true) {
      throw new Error("Dependent prediction cleanup is still pending. Resolve the cleanup before changing rooms or recalculating the leaderboard.");
    }
    if (requireReady && revision && revision.ready !== true) {
      throw new Error("The leaderboard is already stale. Resolve any leftover prediction cleanup, then explicitly recalculate the leaderboard before changing room scores or rosters.");
    }
    return revision;
  }

  async function begin(expectedVersion) {
    return runTransaction(db, async transaction => {
      const revision = await assertIdle(transaction);
      if (expectedVersion !== undefined && revision?.version !== expectedVersion) throw superseded();
      return invalidate(transaction);
    });
  }

  async function assert(transaction, version) {
    const snapshot = await transaction.get(reference);
    const revision = snapshot.exists() ? snapshot.data() : null;
    if (revision?.version !== version || revision.ready !== false || revision.cleanupPending === true) {
      throw superseded();
    }
    return revision;
  }

  async function finish(version) {
    await runTransaction(db, async transaction => {
      await assert(transaction, version);
      transaction.set(reference, { version, ready: true, cleanupPending: false, updatedAt: serverTimestamp() });
    });
  }

  async function settleCleanup(version) {
    await runTransaction(db, async transaction => {
      const snapshot = await transaction.get(reference);
      const revision = snapshot.exists() ? snapshot.data() : null;
      if (revision?.version !== version || revision.ready !== false || revision.cleanupPending !== true) {
        throw superseded();
      }
      transaction.set(reference, { version, ready: false, cleanupPending: false, updatedAt: serverTimestamp() });
    });
  }

  return { invalidate, assertIdle, begin, assert, finish, settleCleanup };
}
