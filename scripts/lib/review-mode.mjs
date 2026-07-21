// scripts/lib/review-mode.mjs
// The set-review-mode verb: the repo-global review-intensity dial. One-directional
// dependency on lib/rules.mjs's writeRules() -- NOT circular, see the design doc.

import { isInitialized, loadState, saveState } from "./state.mjs";
import { parseFlags } from "./add-epic.mjs";
import { writeRules } from "./rules.mjs";
import { render } from "./render.mjs";
import { KNOWN_REVIEW_MODES } from "./constants.mjs";

/** `set-review-mode --mode off|standard|thorough` — the repo-level dial, mirroring Comet's
 *  review_mode: bounds how many fresh-context reviewer passes run and when, replacing an
 *  ad-hoc judgment call with an explicit, dedup'd budget. Pure local state write — no
 *  external calls. A single epic can escalate ABOVE this dial via
 *  `update-epic <id> --review-mode <mode>` (never below it) — see currentReviewMode(epicId). */
export function setReviewMode() {
  if (!isInitialized()) { process.stderr.write("conductor: run /pm:init first\n"); process.exit(1); }
  const f = parseFlags(process.argv.slice(3));
  const mode = typeof f.mode === "string" ? f.mode : undefined;
  if (!mode || !KNOWN_REVIEW_MODES.includes(mode)) {
    process.stderr.write(`conductor: set-review-mode requires --mode, one of ${KNOWN_REVIEW_MODES.join("|")}\n`);
    process.exit(1);
  }
  const state = loadState();
  state.reviewMode = mode;
  saveState(state);
  writeRules();   // refresh CLAUDE.md so the agent sees the new active mode
  render();
  process.stderr.write(`conductor: review mode is now '${mode}'\n`);
}
