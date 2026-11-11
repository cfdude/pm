// scripts/lib/boards-switch.mjs
// project-boards -- the ONE predicate for "are the boards on in this record", and the two texts the switch adds.
//
// A LEAF, on purpose: it imports nothing. The rules block (rules.mjs) and the brief (briefing.mjs) both need the answer, and
// `set-boards` (set-boards.mjs) needs rules.mjs to refresh CLAUDE.md after a toggle, so the predicate cannot live in any of
// them without a cycle.
//
// DEFAULT ON (design D14). An absent setting reads as on, and `init` never writes it: only `set-boards off` records
// `state.boards = {enabled: false}`, and `set-boards on` removes that key again, so each is the other's inverse and a
// record that never touched the switch is byte-identical to one that turned it off and on. No MIGRATIONS entry is needed.

/** The release that adds the switch. `upgrade` announces default-on boards when it moves a repo from below this. */
export const BOARDS_RELEASE = "0.55.0";

/** The most the `## Boards` section may weigh, heading included (managed-rules-block). */
export const BOARDS_SECTION_MAX_BYTES = 280;
/** The most the brief's boards line may weigh (feature-switches). */
export const BOARDS_BRIEF_LINE_MAX_BYTES = 160;

/** Are the boards on in this record? True unless they are recorded off. */
export function boardsEnabled(state) {
  return !(state && state.boards && typeof state.boards === "object" && state.boards.enabled === false);
}

/** The `## Boards` section, a pointer and never the procedure (the `project-boards` skill carries that). Every code span in it
 *  must run as written: `board --json` and `set-boards off` are engine invocations, the rest name a skill and slash commands.
 *  The slash commands are `{{pm:<name>}}` placeholders, which rulesBlock() resolves to the platform's own form (pmCmd), so the
 *  block's body stays platform-neutral. */
export const BOARDS_SECTION = [
  "## Boards",
  "",
  "The `project-boards` skill and `{{pm:boards}}` draw the backlog and release boards from `board --json`. Refresh them after",
  "`{{pm:sync}}`, a status change, a release or mission write, or a gate record. `set-boards off` turns them off.",
].join("\n");

/** The brief's one boards line. A plain string among the obligations, so fitBrief() never shortens it. */
export const BOARDS_BRIEF_LINE =
  "BOARDS: on. Refresh them with the project-boards skill after a sync, a status change or a gate record; set-boards off turns them off.";

/** The `## Boards` text for `state`, or "" while the boards are off. */
export const boardsSectionText = (state) => (boardsEnabled(state) ? BOARDS_SECTION : "");

/** The brief's boards line for `state`, or "" while the boards are off. */
export const boardsBriefLine = (state) => (boardsEnabled(state) ? BOARDS_BRIEF_LINE : "");
