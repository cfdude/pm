// scripts/lib/epic-number.mjs
// Epic numbers and the Jira-style key (change project-boards, spec board-export "Board redesign").
//
// WHAT IS STORED is only a number. An epic carries an integer `number`; the project carries `projectKey` (`set-project`) and a
// counter `nextEpicNumber`. The DISPLAYED key is `projectKey + "-" + number` and is derived on read (epicKey), so changing the key
// renames every epic at once and nothing is rewritten.
//
// THE RULE, in the one creation sink (state.mjs pushEpic, through assignEpicNumber), so every path that registers an epic is bound
// to it and a sixth path cannot omit it:
//   * an epic whose `externalId` is a plain positive integer string, and whose number no other epic holds, takes that integer
//     (issue #256 reads PM-256);
//   * every other epic takes the counter, skipping any number already held.
// Either way the counter ends up one past the number taken, so it only ever moves forward. A number is never reassigned: nothing
// rewrites it after registration (a changed `--external-id` does not renumber), an archived epic keeps its own, and removing an
// epic does not free its number for a plain registration, because the counter does not go back. The ONE way a freed number returns
// is an epic registered later with that externalId, which is the tracker's own number and so the honest reading of it.
//
// stampEpicNumbers() is the migration body (0.55.0): the same rule applied once over a record that predates the field. Pure over
// `state`: it reads nothing else.

/** A plain positive integer: no sign, no leading zero, no fraction, and small enough to be exact. */
const POSITIVE_INTEGER_TEXT = /^[1-9][0-9]*$/;

/** The number an epic's tracker id names, or null. Only the string form the tracker verbs write counts. */
export function externalNumberOf(epic) {
  const id = epic && epic.externalId;
  if (typeof id !== "string" || !POSITIVE_INTEGER_TEXT.test(id)) return null;
  const n = Number(id);
  return Number.isSafeInteger(n) ? n : null;
}

/** A stored number that may be kept: a positive safe integer. */
const validNumber = (n) => Number.isSafeInteger(n) && n > 0;

/** Every number currently held by an epic of `state`. */
function heldNumbers(state) {
  const held = new Set();
  for (const e of Array.isArray(state && state.epics) ? state.epics : []) {
    if (e && validNumber(e.number)) held.add(e.number);
  }
  return held;
}

/** The counter as stored: a positive integer, or null when absent or damaged. */
const counterOf = (state) => (validNumber(state && state.nextEpicNumber) ? state.nextEpicNumber : null);

/** One past the largest number held, or 1. */
const afterLargest = (held) => (held.size ? Math.max(...held) + 1 : 1);

/** Give `epic` its number under the rule above and advance `state.nextEpicNumber`. `epic` is not yet in `state.epics` (pushEpic
 *  calls this before the append), so the held set is everyone else's. An epic that already carries a valid number keeps it: a
 *  replayed record is not renumbered, and a number handed in by a caller is only honoured here when it is valid, never invented. */
export function assignEpicNumber(state, epic) {
  const held = heldNumbers(state);
  let n;
  if (validNumber(epic.number) && !held.has(epic.number)) {
    n = epic.number;
  } else {
    const ext = externalNumberOf(epic);
    if (ext !== null && !held.has(ext)) {
      n = ext;
    } else {
      n = counterOf(state) ?? afterLargest(held);
      while (held.has(n)) n++;
    }
  }
  epic.number = n;
  state.nextEpicNumber = Math.max(counterOf(state) ?? 1, n + 1, afterLargest(held));
  return n;
}

/** `PM-256`, or null while the project key or the number is missing or invalid. */
export function epicKey(state, epic) {
  const key = state && state.projectKey;
  if (typeof key !== "string" || !/^[A-Z]{2,3}$/.test(key)) return null;
  return validNumber(epic && epic.number) ? `${key}-${epic.number}` : null;
}

const time = (v) => (typeof v === "string" && Number.isFinite(Date.parse(v)) ? Date.parse(v) : null);

/** createdAt ascending with an absent date last, then id: the order both passes below walk in. */
function byCreation(a, b) {
  const ta = time(a.createdAt), tb = time(b.createdAt);
  if (ta !== tb) {
    if (ta === null) return 1;
    if (tb === null) return -1;
    return ta - tb;
  }
  return String(a.id).localeCompare(String(b.id));
}

/** MIGRATION BODY, and also run on every `upgrade` (an older engine can register an un-numbered epic after the stamp). Gives every
 *  epic that carries no valid number its number: tracker-linked epics first, keyed to their issue number, then the rest from the
 *  counter, each pass in createdAt-then-id order. Additive (it only fills what is absent), idempotent (a second run finds nothing to
 *  fill and leaves the counter alone) and absent-tolerant. Returns how many epics were numbered. */
export function stampEpicNumbers(state) {
  const epics = Array.isArray(state && state.epics) ? state.epics.filter(e => e && typeof e === "object") : [];
  const held = new Set();
  const pending = [];
  for (const e of epics) {
    if (validNumber(e.number) && !held.has(e.number)) held.add(e.number);
    else pending.push(e);
  }
  if (!pending.length) {
    // Nothing to fill. Only repair a counter that has fallen behind a number it should be past.
    if (held.size && (counterOf(state) ?? 0) < afterLargest(held)) state.nextEpicNumber = afterLargest(held);
    return 0;
  }
  pending.sort(byCreation);
  const took = new Set();
  for (const e of pending) {
    const ext = externalNumberOf(e);
    if (ext !== null && !held.has(ext)) { e.number = ext; held.add(ext); took.add(e); }
  }
  let counter = Math.max(counterOf(state) ?? 1, afterLargest(held));
  for (const e of pending) {
    if (took.has(e)) continue;
    while (held.has(counter)) counter++;
    e.number = counter; held.add(counter); counter++;
  }
  state.nextEpicNumber = Math.max(counter, afterLargest(held));
  return pending.length;
}
