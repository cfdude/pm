// scripts/lib/update-epic.mjs
// The update-epic write-back verb: title/status/priority/links/story mutations on an
// existing epic. One-directional dependencies only.

import { KNOWN_STATUSES, KNOWN_REVIEW_MODES, REVIEW_MODE_RANK, epicFlagsFor } from "./constants.mjs";
import { activate } from "./active-pointer.mjs";
import { globalReviewMode } from "./rules.mjs";
import { isInitialized, loadState, saveState } from "./state.mjs";
import { noteEntry, parentError, parseFlags, parseLinkFlags } from "./add-epic.mjs";
import { render } from "./render.mjs";
import { archiveGate } from "./archive-gate.mjs";
import { deferralAssertion } from "./disposition.mjs";

// The flags update-epic recognizes. Anything else is a rejected error, not a
// silent no-op — an unrecognized flag (e.g. a typo) used to parse, run, and
// print "updated" with nothing actually changed.
//
// A PROJECTION of the shared EPIC_FLAGS registry, never a literal: this list, add-epic's and
// add-many's all have to grow for every flag this release adds, and a literal here is exactly
// the copy that would reject another capability's flag by name. Registering a flag on
// `update-epic` in EPIC_FLAGS is the whole edit; nothing changes in this file.
export const UPDATE_EPIC_FLAGS = epicFlagsFor("update-epic");

/** Update an EXISTING epic's title/externalId/externalUrl/parent/status/priority/links.
 *  The id is POSITIONAL (parseFlags skips non-`--` tokens). Closes the tracker
 *  sync loop: after the agent creates an issue it records the key here.
 *  --link REPLACES the links array wholesale (unlike the other flags, which patch single
 *  fields) — this is the CLI path to fix a malformed link without hand-editing state.json;
 *  "fixing" means replacing the bad entry, not layering a new one on top of it. */
export function updateEpic() {
  if (!isInitialized()) { process.stderr.write("conductor: run /pm:init first\n"); process.exit(1); }
  const argv = process.argv.slice(3);
  const id = argv[0] && !argv[0].startsWith("--") ? argv[0] : undefined;
  if (!id) { process.stderr.write("usage: conductor.mjs update-epic <id> [--title T] [--external-id X] [--external-url U] [--parent P] [--status S] [--priority P] [--link \"<type>:<epic>[:<reason>]\"] [--review-mode off|standard|thorough] [--add-story \"<title>\"] [--story <n> --done] [--attribute-commit <sha>] [--outcome delivered|killed|superseded|abandoned] [--reason \"<why>\"] [--carried-to <epicId>] [--deferral \"<epicId>:<section>\"] [--declined-deferral \"<what>:<why not>\"] [--no-deferrals] [--description D] [--notes \"<text>\"] [--external-updated-at <iso>]\n"); process.exit(1); }
  const f = parseFlags(argv.slice(1));
  const unknown = Object.keys(f).filter(k => !UPDATE_EPIC_FLAGS.includes(k));
  if (unknown.length) {
    process.stderr.write(`conductor: update-epic: unknown flag(s) --${unknown.join(", --")} ` +
      `(known: ${UPDATE_EPIC_FLAGS.map(k => `--${k}`).join(", ")})\n`);
    process.exit(1);
  }
  const str = (v) => (typeof v === "string" ? v : undefined);
  const state = loadState();
  const epic = state.epics.find(e => e.id === id);
  if (!epic) { process.stderr.write(`conductor: epic '${id}' not found\n`); process.exit(1); }

  const parent = str(f.parent);
  if (parent !== undefined) {
    const perr = parentError(state.epics, id, parent);
    if (perr) { process.stderr.write(`conductor: ${perr}\n`); process.exit(1); }
  }
  const status = str(f.status);
  if (status !== undefined && !KNOWN_STATUSES.includes(status)) {
    process.stderr.write(`conductor: --status must be one of ${KNOWN_STATUSES.join("|")}\n`); process.exit(1);
  }
  let links;
  if (f.link !== undefined) {
    try {
      links = parseLinkFlags(f.link, new Set(state.epics.map(e => e.id)));
    } catch (e) {
      process.stderr.write(`conductor: ${e.message}\n`); process.exit(1);
    }
  }

  // --review-mode: a per-epic escalation-only override of the repo-global review-mode dial
  // (set-review-mode). It must never be usable to quietly de-escalate below the global dial —
  // that would let one epic silently weaken review rigor a human explicitly raised repo-wide.
  const reviewMode = str(f["review-mode"]);
  if (reviewMode !== undefined) {
    if (!KNOWN_REVIEW_MODES.includes(reviewMode)) {
      process.stderr.write(`conductor: --review-mode must be one of ${KNOWN_REVIEW_MODES.join("|")}\n`);
      process.exit(1);
    }
    const global = globalReviewMode(state);
    if (REVIEW_MODE_RANK[reviewMode] < REVIEW_MODE_RANK[global]) {
      process.stderr.write(
        `conductor: --review-mode '${reviewMode}' would de-escalate below the repo-global dial ` +
        `('${global}') — an epic-level override may only escalate above the global dial, never below it\n`);
      process.exit(1);
    }
  }

  // A valueless --description / --notes would be dropped by str() and exit 0 having written
  // nothing — the #79 shape. Refuse it before any write.
  for (const flag of ["description", "notes"]) {
    if (f[flag] === true) {
      process.stderr.write(`conductor: --${flag} requires a value\n`); process.exit(1);
    }
  }
  const description = str(f.description);
  const note = str(f.notes);

  // --add-story "<title>" appends { title, done: false } to the epic's inline stories[]
  // (creating the array if this is its first inline story) -- closes the recurring
  // hand-edit-of-state.json risk (a naive JSON re-escape of an em dash has corrupted the
  // file before). --story <n> --done marks an existing story done; <n> is 1-indexed (the
  // natural reading for a human-facing CLI flag: "--story 1" means the first story).
  const addStoryTitle = str(f["add-story"]);
  if (addStoryTitle !== undefined && !addStoryTitle.trim()) {
    process.stderr.write("conductor: --add-story requires a non-empty title\n"); process.exit(1);
  }
  let storyIndex;
  if (f.story !== undefined) {
    if (f.done !== true) {
      process.stderr.write("conductor: --story <n> currently requires --done (the only supported story mutation besides --add-story)\n");
      process.exit(1);
    }
    const n = Number(f.story);
    const stories = Array.isArray(epic.stories) ? epic.stories : [];
    if (!Number.isInteger(n) || n < 1 || n > stories.length) {
      process.stderr.write(`conductor: --story ${f.story} is out of range — '${id}' has ${stories.length} stor${stories.length === 1 ? "y" : "ies"} (1-indexed)\n`);
      process.exit(1);
    }
    storyIndex = n - 1;
  } else if (f.done === true) {
    process.stderr.write("conductor: --done requires --story <n>\n"); process.exit(1);
  }

  // --attribute-commit <sha>: append, in the order given, the commits this epic's work landed
  // in. The last entry is the endpoint a recorded Gate 2 `headSha` is compared against, so the
  // ORDER is the meaning and the engine appends exactly what it is handed.
  const attributed = f["attribute-commit"] === undefined
    ? [] : [].concat(f["attribute-commit"]).filter(v => typeof v === "string" && v.trim());
  if (f["attribute-commit"] !== undefined && !attributed.length) {
    process.stderr.write("conductor: --attribute-commit requires a commit sha\n"); process.exit(1);
  }

  // The archive transition's conditions live in archive-gate.mjs, which every path that can
  // leave an epic at `archived` imports. They were inline here, which is precisely how they
  // came to bind this one path and none of the other four. The gate returns a refusal; this
  // command owns the exit code and the stderr, as it does for every other validation above.
  //
  // This command therefore holds NO lane test of its own. The one it used to hold compared
  // `epic.lane === "openspec"` strictly, so a lane-less epic — openspec-lane on every rendered
  // surface since resolveEpics() started normalizing it — slipped the gate entirely. The gate
  // now decides membership through constants.mjs's isOpenspecLane, the single predicate every
  // such site goes through.
  // The deferral assertion is BUILT here and validated by the gate: three flags, one record.
  // `--no-deferrals` makes "there are none" sayable, which is the whole point — an absence is
  // otherwise indistinguishable from never having looked.
  const pairs = (raw, a, b) => [].concat(raw === undefined ? [] : raw)
    .filter(v => typeof v === "string")
    .map(v => { const i = v.indexOf(":"); return i === -1
      ? { [a]: v.trim(), [b]: "" } : { [a]: v.slice(0, i).trim(), [b]: v.slice(i + 1).trim() }; });
  const asserted = f.deferral !== undefined || f["declined-deferral"] !== undefined || f["no-deferrals"] === true
    ? deferralAssertion({
        deferrals: pairs(f.deferral, "epic", "section"),
        declined: pairs(f["declined-deferral"], "what", "reason"),
      })
    : undefined;

  if (status === "archived") {
    const verdict = archiveGate(epic, {
      outcome: str(f.outcome), reason: str(f.reason),
      carriedTo: str(f["carried-to"]), deferralAssertion: asserted,
    });
    if (!verdict.ok) { process.stderr.write(`conductor: ${verdict.message}\n`); process.exit(1); }
    // The gate BUILDS the record and this command writes it, so the disposition an epic ends
    // with is the one the gate validated — there is no second construction site to drift.
    if (verdict.disposition) epic.disposition = verdict.disposition;
    if (verdict.deferralAssertion) epic.deferralAssertion = verdict.deferralAssertion;
  }

  if (str(f.title) !== undefined) epic.title = str(f.title);
  if (str(f["external-id"]) !== undefined) epic.externalId = str(f["external-id"]);
  if (str(f["external-url"]) !== undefined) epic.externalUrl = str(f["external-url"]);
  if (str(f["external-updated-at"]) !== undefined) epic.externalUpdatedAt = str(f["external-updated-at"]);
  if (parent !== undefined) epic.parent = parent;
  if (status !== undefined) epic.status = status;
  if (str(f.priority) !== undefined) epic.priority = str(f.priority);
  if (links !== undefined) epic.links = links;
  if (reviewMode !== undefined) epic.reviewMode = reviewMode;
  if (attributed.length) {
    if (!Array.isArray(epic.attributedCommits)) epic.attributedCommits = [];
    epic.attributedCommits.push(...attributed.map(v => v.trim()));
  }
  // `--description` REPLACES (durable rationale, one value); `--notes` APPENDS (an activity
  // trail). Writing either never touches the other, and an earlier note is never rewritten or
  // dropped — the two readings are both wanted, so neither may be collapsed into the other.
  if (description !== undefined) epic.description = description;
  if (note !== undefined) {
    if (!Array.isArray(epic.notes)) epic.notes = [];
    epic.notes.push(noteEntry(note));
  }
  if (addStoryTitle !== undefined) {
    if (!Array.isArray(epic.stories)) epic.stories = [];
    epic.stories.push({ title: addStoryTitle, done: false });
  }
  if (storyIndex !== undefined) epic.stories[storyIndex].done = true;

  // Stamp completedAt the moment an epic transitions TO archived (not merely re-saved
  // while already archived) — supports velocity tracking off startedAt/completedAt.
  if (status === "archived" && !epic.completedAt) epic.completedAt = new Date().toISOString();

  // Keep .active consistent with status — the two must never disagree.
  if (epic.status === "active") activate(state, id);
  else if (state.active === id) state.active = null;

  saveState(state);
  render();
  process.stderr.write(`conductor: updated '${id}'\n`);
}
