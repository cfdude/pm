// scripts/lib/refusal.mjs
// What conductor.mjs's top-level catch does with a thrown error: the exit status and what is
// printed, or null to re-throw it unchanged so a real crash keeps its stack.
//
// A FUNCTION, not inline in the catch, for the reason conflictExitCode() is one: the mapping is
// testable without a subprocess and without a hidden self-test verb in the shipped CLI.

import { conflictExitCode, StateUnreadableError, unreadableStateMessage } from "./state.mjs";
import { UNREADABLE_INPUT_EXIT_CODE } from "./constants.mjs";
import { VERB_EFFECTS } from "./verb-effects.mjs";
import { RulesBlockAmbiguousError, rulesBlockAmbiguousMessage } from "./rules.mjs";

/** What each HOOK verb does on an unreadable state file, decided by what its hook EVENT does with
 *  an exit status (state-file-refuses-to-guess design D3, against Claude Code's hook docs):
 *
 *  - `gate-guard` (PreToolUse) → exit 2, BLOCK. Any other status on PreToolUse lets the tool call
 *    proceed, which would silently disable the unconditional reconcile block exactly when the
 *    record saying whether one is owed cannot be read. Not a wedge: Bash is not matched by it.
 *  - `commit-nudge` (PostToolUse) → exit 2, which there shows stderr to Claude — the actor who can
 *    run the remedy — and cannot block anything.
 *  - `brief` (SessionStart) → exit 0 with the warning as the ONLY additional context. SessionStart
 *    shows a non-zero hook's stderr to the human only, so that channel would miss the agent.
 *
 *  Every other hook verb — `snapshot` (PreCompact, where exit 2 BLOCKS compaction) and
 *  `lesson-advice` (which never reads state) — takes the default, the unreadable-input code. That
 *  default is FAIL-OPEN for a PreToolUse hook, so a hook verb added later must be added here.
 *
 *  Selected by the `hook: true` marker in VERB_EFFECTS first, so a non-hook verb that happened to
 *  share a name could never inherit a hook's status. */
export const HOOK_ON_UNREADABLE = { "gate-guard": "block", "commit-nudge": "block", brief: "warn" };

/** The hook verbs that deliberately take the DEFAULT, each for a stated reason. Exported with the
 *  table so a test can hold the two together against VERB_EFFECTS's `hook: true` set — the default
 *  is fail-open on PreToolUse, so a hook verb in neither list is a failure, not a silent 11. */
export const HOOK_DEFAULT_ON_UNREADABLE = {
  snapshot: "PreCompact: exit 2 would block compaction, so it takes the unreadable-input code",
  "lesson-advice": "PreToolUse, but reads only whether state.json exists and never raises the refusal",
};

function hookUnreadableStatus(verb) {
  const row = Object.prototype.hasOwnProperty.call(VERB_EFFECTS, verb) ? VERB_EFFECTS[verb] : null;
  return row && row.hook === true && Object.prototype.hasOwnProperty.call(HOOK_ON_UNREADABLE, verb)
    ? HOOK_ON_UNREADABLE[verb] : null;
}

/** `{ exitCode, stdout, stderr }` for an error the engine refuses on, or null to re-throw.
 *
 *  - a write conflict → the conflict exit code: retryable;
 *  - an ambiguous rules-block arrangement → UNREADABLE_INPUT_EXIT_CODE;
 *  - an unreadable state file → the hook's status (above), or UNREADABLE_INPUT_EXIT_CODE for every
 *    other verb: a human fixes the file. However the refusal was raised during the invocation —
 *    from the hook's own load or from anything it calls — it lands here, which is what makes the
 *    hook's status a guarantee rather than a property of one call site. */
export function refusalFor(verb, err) {
  const conflict = conflictExitCode(err);
  if (conflict !== null) return { exitCode: conflict, stdout: "", stderr: `conductor: ${err.message}\n` };
  // A rules file whose managed-block markers are ambiguous: the same "a human fixes the file" code.
  // No hook writes the rules block, so no hook status applies.
  if (err instanceof RulesBlockAmbiguousError) {
    return { exitCode: UNREADABLE_INPUT_EXIT_CODE, stdout: "", stderr: rulesBlockAmbiguousMessage(err) };
  }
  if (!(err instanceof StateUnreadableError)) return null;
  const message = unreadableStateMessage(err);
  switch (hookUnreadableStatus(verb)) {
    case "block":
      return {
        exitCode: 2, stdout: "",
        stderr: message + (verb === "gate-guard"
          ? "  gate guard: Edit/Write/NotebookEdit stay blocked until the file is fixed — whether a " +
            "reconcile is owed cannot be read. Bash is not blocked: run one of the commands above.\n"
          : ""),
      };
    case "warn":
      return {
        exitCode: 0, stderr: "",
        stdout: JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "SessionStart",
            additionalContext:
              "⚠ pm conductor: THE CONDUCTOR IS TRACKING NOTHING in this repository until " +
              ".conductor/state.json is fixed. No briefing follows, because the " +
              "record it would be built from cannot be read.\n\n" + message,
          },
        }),
      };
    default:
      return { exitCode: UNREADABLE_INPUT_EXIT_CODE, stdout: "", stderr: message };
  }
}
