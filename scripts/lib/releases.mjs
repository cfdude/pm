// scripts/lib/releases.mjs
// Release planning: the `release` verb, and the two readings every surface renders from.
//
// A release is a NAMED GROUPING the agent declares — an id, intent prose, an optional target,
// and the epics deliberately cut from it. The engine records and renders it and proposes
// nothing: no epic is ever auto-assigned, and no membership changes because an epic was added,
// re-prioritized or archived. That restraint is the requirement, not an implementation detail —
// a grouping the engine guesses at is a second opinion about scope, and the scope judgment is
// exactly what this capability exists to preserve.
//
// Membership is recorded ONE-WAY, as `epic.release` (at most one). A member list on the release
// PLUS a pointer on the epic is two records of one fact, and two records of one fact disagree;
// there is only one here, so the disagreement is not expressible.
//
// One-directional dependencies only: constants → disposition → (add-epic's parseFlags, state,
// render), the same chain update-epic.mjs walks.

import { epicFlagsFor } from "./constants.mjs";
import { isInitialized, loadState, saveState } from "./state.mjs";
import { parseFlags } from "./add-epic.mjs";
import { render } from "./render.mjs";
import { releaseDeferral, releaseDeferralError } from "./disposition.mjs";

/** The flags `release` recognizes — a PROJECTION of the shared EPIC_FLAGS registry, never a
 *  second literal. Registering a flag on `release` in that registry is the whole edit. */
export const RELEASE_FLAGS = epicFlagsFor("release");

const str = (v) => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined);

/** The LAST string value of a flag that may have parsed as an array.
 *
 *  `--intent` is in parseFlags' repeatable set because it is ALSO set-tracker's flag, and that
 *  set is a global union across every subcommand rather than a per-verb list. So `--intent`
 *  arrives here as `["…"]` whatever this verb wants. A release has one intent, so the last
 *  value wins — which is also what a non-repeatable flag would have done. */
const lastStr = (v) => {
  const all = [].concat(v === undefined ? [] : v).filter(x => typeof x === "string");
  return all.length ? str(all[all.length - 1]) : undefined;
};

/** The release named `id`, or null. THE lookup — every reader goes through it so "which
 *  release is this" has one answer. */
export const findRelease = (state, id) =>
  (Array.isArray(state && state.releases) ? state.releases : []).find(r => r && r.id === id) || null;

/** The epics that are IN `release`, read from the one-way membership pointer. */
export const releaseMembers = (epics, releaseId) =>
  (epics || []).filter(e => e && e.release === releaseId);

/** Every release with its two counts, in declaration order — the ONE computation PROJECT.md and
 *  the briefing both render from, so the two surfaces cannot report different numbers for the
 *  same release. `deferred` is carried whole (not just counted) because each entry's reason is
 *  what makes the exclusion legible. */
export function releaseSummaries(state, epics) {
  const releases = Array.isArray(state && state.releases) ? state.releases : [];
  return releases.filter(r => r && r.id).map(r => ({
    id: r.id,
    intent: r.intent || "",
    target: r.target,
    members: releaseMembers(epics, r.id).length,
    deferred: Array.isArray(r.deferred) ? r.deferred : [],
  }));
}

/** The ONE wording for a release line, shared by both surfaces exactly as gateSummary() is. */
export const releaseLine = (s) =>
  `\`${s.id}\`: ${s.members} epic${s.members === 1 ? "" : "s"}, ${s.deferred.length} deferred`;

/** `release <id> --intent "<prose>" [--target <t>] [--member <epicId>]… [--defer <epicId>
 *  --reason "<why>"]` — create or amend a release, associate epics with it, and record an
 *  exclusion with its required reason. */
export function release() {
  if (!isInitialized()) { process.stderr.write("conductor: run /pm:init first\n"); process.exit(1); }
  const argv = process.argv.slice(3);
  const id = argv[0] && !argv[0].startsWith("--") ? argv[0] : undefined;
  if (!id) {
    process.stderr.write("conductor: release requires a release id as its first POSITIONAL argument\n");
    process.stderr.write("usage: conductor.mjs release <id> [--intent \"<what this release is for>\"] [--target <t>] [--member <epicId>]... [--defer <epicId> --reason \"<why it was cut>\"]\n");
    process.exit(1);
  }
  const f = parseFlags(argv.slice(1));
  const unknown = Object.keys(f).filter(k => !RELEASE_FLAGS.includes(k));
  if (unknown.length) {
    process.stderr.write(`conductor: release: unknown flag(s) --${unknown.join(", --")} ` +
      `(known: ${RELEASE_FLAGS.map(k => `--${k}`).join(", ")})\n`);
    process.exit(1);
  }

  const state = loadState();
  if (!Array.isArray(state.releases)) state.releases = [];
  const intent = lastStr(f.intent);
  const target = str(f.target);

  let rel = findRelease(state, id);
  if (!rel) {
    // A release with no intent prose is an id nobody can read six months later, which is the
    // failure this whole capability exists to end. So creation DEMANDS it, and the same refusal
    // covers "you named a release that does not exist" — those are one condition, not two.
    if (intent === undefined) {
      process.stderr.write(
        `conductor: release '${id}' does not exist — create it first with ` +
        `\`release ${id} --intent "<what this release is for>"\`. Nothing was written.\n`);
      process.exit(1);
    }
    rel = { id, intent, deferred: [] };
    if (target !== undefined) rel.target = target;
    state.releases.push(rel);
  } else {
    if (intent !== undefined) rel.intent = intent;
    if (target !== undefined) rel.target = target;
    if (!Array.isArray(rel.deferred)) rel.deferred = [];
  }

  const knownEpic = (epicId) => state.epics.find(e => e.id === epicId) || null;

  // --member: associate epics, one-way. Validated against the real epic list — a membership
  // pointer to an id that does not exist renders as a member of nothing and is unfindable.
  const members = [].concat(f.member === undefined ? [] : f.member).filter(v => typeof v === "string");
  if (f.member !== undefined && !members.length) {
    process.stderr.write("conductor: --member requires an epic id\n"); process.exit(1);
  }
  for (const epicId of members) {
    if (!knownEpic(epicId)) {
      process.stderr.write(`conductor: --member '${epicId}' is not a known epic id. Nothing was written.\n`);
      process.exit(1);
    }
  }

  // --defer: the exclusion, carrying the reason-bearing record of group 2 — the SAME required
  // reason, validated by disposition.mjs and not by a second rule written here. An epic may not
  // be both a member of and deferred from one release, so each write clears the other; clearing
  // an exclusion SAYS SO on stderr, because a recorded judgment must never disappear silently.
  const deferEpic = str(f.defer);
  if (f.defer !== undefined && deferEpic === undefined) {
    process.stderr.write("conductor: --defer requires an epic id\n"); process.exit(1);
  }
  if (deferEpic !== undefined) {
    if (!knownEpic(deferEpic)) {
      process.stderr.write(`conductor: --defer '${deferEpic}' is not a known epic id. Nothing was written.\n`);
      process.exit(1);
    }
    if (members.includes(deferEpic)) {
      process.stderr.write(
        `conductor: '${deferEpic}' cannot be both a member of and deferred from '${id}' in one ` +
        "invocation — say which one it is. Nothing was written.\n");
      process.exit(1);
    }
    const derr = releaseDeferralError({ epic: deferEpic, reason: str(f.reason) });
    if (derr) { process.stderr.write(`conductor: ${derr}\n`); process.exit(1); }
  }

  // Validate EVERY member and the deferral before writing ANY of them, so a typo in the third
  // `--member` cannot leave the first two associated and the command reporting a failure.
  for (const epicId of members) {
    const wasDeferred = rel.deferred.find(d => d && d.epic === epicId);
    if (wasDeferred) {
      rel.deferred = rel.deferred.filter(d => !d || d.epic !== epicId);
      process.stderr.write(
        `conductor: '${epicId}' was deferred from '${id}' — that record is now removed ` +
        `(it read: ${wasDeferred.reason})\n`);
    }
    knownEpic(epicId).release = id;
  }

  if (deferEpic !== undefined) {
    // An excluded epic stays in the backlog. Exclusion is a scoping call about THIS release and
    // never an ending: nothing here touches the epic's status or writes it a disposition. What
    // it does clear is membership — an epic cannot be in a release it was cut from.
    const epic = knownEpic(deferEpic);
    if (epic.release === id) delete epic.release;
    const record = releaseDeferral({ epic: deferEpic, reason: str(f.reason) });
    const at = rel.deferred.findIndex(d => d && d.epic === deferEpic);
    if (at === -1) rel.deferred.push(record); else rel.deferred[at] = record;
  }

  saveState(state);
  render();
  process.stderr.write(`conductor: release '${id}' — ${releaseLine(releaseSummaries(state, state.epics).find(s => s.id === id))}\n`);
}
