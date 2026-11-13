// scripts/lib/epic-summary.mjs
// An epic's one-line `summary` and `whyNow` (change project-boards, spec epic-annotation).
//
// `description` is multi-paragraph rationale and a board needs ONE line, so these are separate fields beside it,
// never a truncation of it. Two things live here so every epic-writing surface shares them:
//   * the VALUE rule (one line, a character limit), used by add-epic, update-epic and add-many;
//   * the WARNING when an epic leaves `untriaged` (or is registered) into a live status without them. It is a
//     warning and never a refusal in this release (design D8); a later epic turns it into one.

import { escapeControls } from "./constants.mjs";
import { errStream } from "./invocation.mjs";

/** A line break of any kind: CR, LF, and the two Unicode separators. Built from code points so no raw one sits here. */
const NEWLINE = new RegExp("[\\r\\n" + String.fromCharCode(0x2028, 0x2029) + "]");

/** The limits, in characters. */
export const SUMMARY_MAX = 200;
export const WHY_NOW_MAX = 300;

/** The two fields: the flag that sets each, the state key, and its limit. */
export const SUMMARY_FIELDS = [
  { flag: "summary", key: "summary", max: SUMMARY_MAX },
  { flag: "why-now", key: "whyNow", max: WHY_NOW_MAX },
];

const FLAG_SPELLINGS = { summary: "--summary", "why-now": "--why-now" };
const flagSpelling = (flag) => FLAG_SPELLINGS[flag];

/** The refusal for a value that is not one line within the limit, or null when it is acceptable. `where`
 *  prefixes a batch entry's id. Pure. */
export function lineFieldError({ flag, max }, value, where = flagSpelling(flag)) {
  if (typeof value !== "string" || value.trim() === "") {
    return escapeControls(`${where} requires one line of at most ${max} characters (got an empty or non-text value)`);
  }
  if (NEWLINE.test(value)) {
    return escapeControls(`${where} must be one line of at most ${max} characters (it contains a newline)`);
  }
  if ([...value].length > max) {
    return escapeControls(`${where} must be one line of at most ${max} characters (got ${[...value].length})`);
  }
  return null;
}

/** The fields an epic is missing: each `{flag}` whose key is absent or blank. */
export function missingSummaryFields(epic) {
  return SUMMARY_FIELDS.filter(f => typeof (epic && epic[f.key]) !== "string" || epic[f.key].trim() === "");
}

/** Does a write that took an epic from `before` to `after` owe the warning? It does when the epic LEFT `untriaged`
 *  (or is newly registered: `before` is null) into any status other than `untriaged` or `archived`. A write that
 *  leaves the status unchanged, or ends the epic, owes nothing. */
export const owesSummaryWarning = (before, after) =>
  (before === null || before === "untriaged") && after !== "untriaged" && after !== "archived";

/** The one stderr line, or null when nothing is owed or nothing is missing. */
export function summaryWarning(epic, before) {
  if (!epic || !owesSummaryWarning(before === undefined ? null : before, epic.status)) return null;
  const missing = missingSummaryFields(epic);
  if (!missing.length) return null;
  return escapeControls(
    `conductor: epic '${epic.id}' is ${epic.status} without ` +
    `${missing.map(f => f.key).join(" and ")} — set ${missing.map(f => `--${f.flag} "<one line>"`).join(" and ")} ` +
    "with update-epic (a warning only; nothing was refused)") + "\n";
}

/** Print the warning for one epic to the invocation's stderr. */
export function warnSummary(epic, before) {
  const line = summaryWarning(epic, before);
  if (line) errStream().write(line);
}
