// scripts/lib/update-epic.mjs
// The update-epic write-back verb: title/status/priority/links/story mutations on an
// existing epic. One-directional dependencies only.

import { KNOWN_STATUSES, KNOWN_REVIEW_MODES, REVIEW_MODE_RANK } from "./constants.mjs";
import { activate } from "./active-pointer.mjs";
import { globalReviewMode } from "./rules.mjs";
import { isInitialized, loadState, saveState } from "./state.mjs";
import { parentError, parseFlags, parseLinkFlags } from "./add-epic.mjs";
import { render } from "./render.mjs";

// The flags update-epic recognizes. Anything else is a rejected error, not a
// silent no-op — an unrecognized flag (e.g. a typo) used to parse, run, and
// print "updated" with nothing actually changed.
export const UPDATE_EPIC_FLAGS = ["external-id", "external-url", "parent", "status", "priority", "title", "link", "review-mode", "add-story", "story", "done"];

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
  if (!id) { process.stderr.write("usage: conductor.mjs update-epic <id> [--title T] [--external-id X] [--external-url U] [--parent P] [--status S] [--priority P] [--link \"<type>:<epic>[:<reason>]\"] [--review-mode off|standard|thorough] [--add-story \"<title>\"] [--story <n> --done]\n"); process.exit(1); }
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

  // openspec-lane epics may not be archived without a passing Gate 2 (implementation review)
  // verdict — see CLAUDE.md "OpenSpec build — TWO mandatory gates" and recordGateReview()
  // above. Gate 1 (spec review) gates code, which already happened earlier in the workflow;
  // only Gate 2 blocks archiving. Non-openspec-lane epics are completely unaffected.
  if (status === "archived" && epic.lane === "openspec") {
    const gate2 = epic.gateReview && epic.gateReview.gate2;
    if (!gate2 || gate2.verdict !== "pass") {
      process.stderr.write(
        `conductor: cannot archive openspec-lane epic '${id}' — missing a passing Gate 2 ` +
        `(implementation review) verdict. Run 'record-gate-review ${id} --gate 2 --verdict pass' ` +
        `after a real fresh-context implementation review before archiving.\n`);
      process.exit(1);
    }
  }

  if (str(f.title) !== undefined) epic.title = str(f.title);
  if (str(f["external-id"]) !== undefined) epic.externalId = str(f["external-id"]);
  if (str(f["external-url"]) !== undefined) epic.externalUrl = str(f["external-url"]);
  if (parent !== undefined) epic.parent = parent;
  if (status !== undefined) epic.status = status;
  if (str(f.priority) !== undefined) epic.priority = str(f.priority);
  if (links !== undefined) epic.links = links;
  if (reviewMode !== undefined) epic.reviewMode = reviewMode;
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
