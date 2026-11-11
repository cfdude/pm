// scripts/lib/set-boards.mjs
// `set-boards <on|off>` -- the switch for the project boards (change project-boards, spec feature-switches).
//
// DEFAULT ON, AND AN ABSENT KEY. `off` records `state.boards = {enabled: false}`; `on` removes the key, so the pair are exact
// inverses and a repeat of either writes nothing (boards-switch.mjs). The switch removes the `## Boards` rules-block section and
// the brief's boards line and nothing else: `board --json` is a read and keeps working whatever the switch says, and the
// boards already published stay where they are (an artifact is the user's to delete).
//
// Like the tracker verbs, this one rewrites the managed block itself: `## Boards` is outside CONDITIONAL_SECTIONS (design D15).

import { isInitialized, loadState, saveState } from "./state.mjs";
import { reportSave, STATE_UNCHANGED } from "./save-report.mjs";
import { checkedPositionals } from "./argv-surface.mjs";
import { die } from "./command-exit.mjs";
import { writeRules } from "./rules.mjs";
import { resolvePlatform } from "./platform.mjs";
import { render } from "./render.mjs";
import { boardsEnabled } from "./boards-switch.mjs";

/** Apply one `on|off` to `state`. Pure: no disk, no output. `off` records the setting and `on` removes it, so each undoes the other
 *  exactly. Returns whether the record changed, so a repeat is a no-op the tests can see without a file. */
export function applyBoards(state, arg) {
  const before = JSON.stringify(state.boards ?? null);
  if (arg === "off") state.boards = { enabled: false };
  else delete state.boards;
  return JSON.stringify(state.boards ?? null) !== before;
}

/** `set-boards <on|off>`. */
export function setBoards() {
  if (!isInitialized()) { die("conductor: run /pm:init first\n"); }
  const [arg] = checkedPositionals("set-boards");
  if (arg !== "on" && arg !== "off") {
    die("usage: conductor.mjs set-boards <on|off>\n");
  }
  const state = loadState();
  applyBoards(state, arg);
  const saved = saveState(state);
  // After the save, so the block and PROJECT.md (which embeds the brief) are rendered from the NEW state. Both are re-rendered
  // on a repeat too, as `set-spend-tracking` does: the call is idempotent and the files then agree with the record.
  writeRules(resolvePlatform({}, state));
  render();
  reportSave(saved, {
    changed: `conductor: boards ${arg}${arg === "off"
      ? " — the `## Boards` rules-block section and the brief's boards line are gone. `board --json` still works; `set-boards on` puts them back."
      : " — the `## Boards` rules-block section and the brief's boards line are back."}`,
    unchanged: `conductor: boards were already ${boardsEnabled(state) ? "on" : "off"} — ${STATE_UNCHANGED} (the rules block was re-rendered)`,
  });
}
