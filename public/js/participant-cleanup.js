// The durable job and the leaderboard revision fence every cleanup/recovery worker.
// Selected owners cannot write predictions until the final recalculation commits.
export function createParticipantCleanupStore({ db, doc, collection, query, where,
  getDoc, getDocs, runTransaction, serverTimestamp, revisions, recalculate }) {
  const jobRef = doc(db, 'settings', 'participantCleanup');
  const revisionRef = doc(db, 'settings', 'leaderboardRevision');
  const drawRef = doc(db, 'ticketAwards', 'currentDraw');
  const value = snapshot => snapshot.exists() ? snapshot.data() : null;
  const active = job => job && job.phase !== 'complete';
  const changed = () => new Error('Cleanup data changed. Load participants and preview again. No further records were deleted.');
  const canonical = item => JSON.stringify(item, (_key, part) =>
    part && typeof part === 'object' && !Array.isArray(part)
      ? Object.fromEntries(Object.keys(part).sort().map(key => [key, part[key]])) : part);
  const same = (a, b) => canonical(a) === canonical(b);
  const excluded = (draw, uids) => uids.filter(uid =>
    (draw?.excludedUids || []).includes(uid) || draw?.lastWinner?.uid === uid);
  const conflict = uids => new Error(`Removal blocked by Lucky Draw awards or winner exclusions: ${uids.join(', ')}. Award history and exclusions were not changed.`);

  async function readByUid(path, uids) {
    const documents = [];
    for (let index = 0; index < uids.length; index += 30) {
      const snapshot = await getDocs(query(collection(db, path), where('uid', 'in', uids.slice(index, index + 30))));
      documents.push(...snapshot.docs);
    }
    return documents;
  }

  async function preview(selection) {
    const uids = [...new Set(selection)].sort();
    if (!uids.length || uids.some(uid => typeof uid !== 'string' || !uid || uid.includes('/'))) {
      throw new Error('Select at least one participant by UID.');
    }
    const [job, revision, draw, predictions, awards, rows] = await Promise.all([
      getDoc(jobRef).then(value), getDoc(revisionRef).then(value), getDoc(drawRef).then(value),
      readByUid('predictions', uids), readByUid('ticketAwards', uids),
      Promise.all(uids.map(uid => getDoc(doc(db, 'leaderboard', uid))))
    ]);
    if (active(job) && !same(job.uids, uids)) {
      throw new Error('Another selection has unfinished cleanup. Load participants and preview the interrupted cleanup first.');
    }
    const records = predictions.map(item => ['predictions', item.id, item.data()]);
    rows.filter(item => item.exists()).forEach(item => records.push(['leaderboard', item.id, item.data()]));
    records.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
    const conflicts = [...new Set([...awards.map(item => item.data().uid), ...excluded(draw, uids)])].sort();
    return { uids, job, revisionVersion: revision?.version || null,
      fingerprint: canonical(records), conflicts, predictions, rows: rows.filter(item => item.exists()),
      participants: uids.map(uid => ({ uid, predictions: predictions.filter(item => item.data().uid === uid).length,
        row: rows.find(item => item.id === uid)?.exists() || false })) };
  }

  async function assertWorker(transaction, version, phase) {
    const [jobSnapshot, revisionSnapshot, drawSnapshot] = await Promise.all([
      transaction.get(jobRef), transaction.get(revisionRef), transaction.get(drawRef)
    ]);
    const job = value(jobSnapshot);
    const revision = value(revisionSnapshot);
    if (!active(job) || job.version !== version || revision?.version !== version ||
        revision.ready !== false || revision.cleanupPending !== true || (phase && job.phase !== phase)) throw changed();
    const conflicts = excluded(value(drawSnapshot), job.uids);
    if (conflicts.length) throw conflict(conflicts);
    return job;
  }

  async function run(prepared) {
    if (prepared.conflicts.length) throw conflict(prepared.conflicts);
    // Claim before re-querying: rules freeze owner writes and spins now observe a
    // dirty revision. A retry claims a new version, superseding interrupted workers.
    const version = await runTransaction(db, async transaction => {
      const [saved, revisionSnapshot, drawSnapshot] = await Promise.all([
        transaction.get(jobRef), transaction.get(revisionRef), transaction.get(drawRef)
      ]);
      const job = value(saved);
      const revision = value(revisionSnapshot);
      if ((job?.version || null) !== (prepared.job?.version || null) ||
          (revision?.version || null) !== prepared.revisionVersion ||
          (active(job) && (!same(job.uids, prepared.uids) || job.version !== revision?.version ||
            revision?.cleanupPending !== true || revision?.ready !== false))) throw changed();
      if (!active(job) && revision?.cleanupPending === true) {
        throw new Error('Other prediction cleanup is pending. Resolve it before participant removal.');
      }
      const conflicts = excluded(value(drawSnapshot), prepared.uids);
      if (conflicts.length) throw conflict(conflicts);
      const next = revisions.invalidate(transaction, { cleanupPending: true });
      transaction.set(jobRef, { id: active(job) ? job.id : crypto.randomUUID(), version: next,
        uids: prepared.uids, phase: 'review',
        deletedPredictions: active(job) ? job.deletedPredictions : 0,
        deletedRows: active(job) ? job.deletedRows : 0, updatedAt: serverTimestamp() });
      return next;
    });
    const fresh = await preview(prepared.uids);
    if (fresh.conflicts.length) throw conflict(fresh.conflicts);
    if (fresh.fingerprint !== prepared.fingerprint) throw changed();
    await runTransaction(db, async transaction => {
      const job = await assertWorker(transaction, version, 'review');
      transaction.set(jobRef, { ...job, phase: 'deleting', updatedAt: serverTimestamp() });
    });
    const operations = [
      ...fresh.predictions.map(item => ({ ref: item.ref, prediction: true })),
      ...fresh.rows.map(item => ({ ref: item.ref, prediction: false }))
    ];
    for (let index = 0; index < operations.length; index += 450) {
      const chunk = operations.slice(index, index + 450);
      await runTransaction(db, async transaction => {
        const job = await assertWorker(transaction, version, 'deleting');
        chunk.forEach(item => transaction.delete(item.ref));
        transaction.set(jobRef, { ...job,
          deletedPredictions: job.deletedPredictions + chunk.filter(item => item.prediction).length,
          deletedRows: job.deletedRows + chunk.filter(item => !item.prediction).length,
          updatedAt: serverTimestamp() });
      });
    }
    await runTransaction(db, async transaction => {
      const job = await assertWorker(transaction, version, 'deleting');
      transaction.set(jobRef, { ...job, phase: 'recalculating', updatedAt: serverTimestamp() });
    });
    // Reuse the normal scorer, name queries, delta planner and chunk writer with
    // an owning fence that never releases cleanupPending between deletion/sync.
    let completed;
    const fence = {
      begin: async () => version,
      assert: transaction => assertWorker(transaction, version, 'recalculating'),
      finish: async () => runTransaction(db, async transaction => {
        const job = await assertWorker(transaction, version, 'recalculating');
        transaction.set(revisionRef, { version, ready: true, cleanupPending: false, updatedAt: serverTimestamp() });
        completed = { ...job, phase: 'complete' };
        transaction.set(jobRef, { ...completed, updatedAt: serverTimestamp() });
      })
    };
    await recalculate(version, fence);
    return completed;
  }

  return { preview, run, load: async () => value(await getDoc(jobRef)) };
}
