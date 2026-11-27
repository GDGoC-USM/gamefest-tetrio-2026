// Pure preview/planning helpers for Lucky Draw manual participant imports.
// They never write data; lucky-draw.js saves the whole preview in one
// transaction through the existing draw store.

export const MAX_BULK_PARTICIPANTS = 200;
export const MAX_PARTICIPANT_NAME_LENGTH = 60;

const lineBreak = /\r\n|\n|\r/;

export function normalizeParticipantName(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/gu, " ")
    .toLowerCase();
}

export function manualDisplayName(value) {
  return String(value ?? "").trim() || "Participant";
}

export function createManualParticipantId(existingIds = [], now = Date.now, random = Math.random) {
  const used = existingIds instanceof Set
    ? existingIds
    : new Set(existingIds);

  for (let attempt = 0; attempt < 1000; attempt++) {
    const id = `manual-${now()}-${random().toString(36).slice(2, 8)}`;
    if (!used.has(id)) return id;
  }

  throw new Error("Unable to allocate a unique participant ID. Try again.");
}

export function parseBulkParticipants(text, existingNames = []) {
  const rows = [];
  const lines = String(text ?? "").split(lineBreak);

  lines.forEach((line, index) => {
    const name = line.trim();
    if (name) rows.push({ line: index + 1, name });
  });

  if (!rows.length) {
    return {
      entries: [],
      total: 0,
      duplicateCount: 0,
      errors: ["Paste at least one participant name."],
      canImport: false
    };
  }

  if (rows.length > MAX_BULK_PARTICIPANTS) {
    return {
      entries: [],
      total: rows.length,
      duplicateCount: 0,
      errors: [
        `Import at most ${MAX_BULK_PARTICIPANTS} participants at a time. ` +
        `This list contains ${rows.length} names.`
      ],
      canImport: false
    };
  }

  const counts = new Map();
  for (const row of rows) {
    const key = normalizeParticipantName(row.name);
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  const existing = new Set(
    existingNames
      .map(normalizeParticipantName)
      .filter(Boolean)
  );

  const entries = rows.map(row => {
    const key = normalizeParticipantName(row.name);
    const length = [...row.name].length;
    const error = length > MAX_PARTICIPANT_NAME_LENGTH
      ? `Line ${row.line}: names must be ${MAX_PARTICIPANT_NAME_LENGTH} characters or fewer; this one has ${length}.`
      : "";
    const duplicateInPaste = counts.get(key) > 1;
    const duplicateExisting = existing.has(key);

    return {
      line: row.line,
      name: row.name,
      normalizeKey: key,
      duplicateInPaste,
      duplicateExisting,
      duplicate: duplicateInPaste || duplicateExisting,
      error
    };
  });

  const errors = entries
    .map(entry => entry.error)
    .filter(Boolean);

  return {
    entries,
    total: entries.length,
    duplicateCount: entries.filter(entry => entry.duplicate).length,
    errors,
    canImport: errors.length === 0
  };
}
