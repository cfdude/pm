// scripts/lib/refusal.mjs
// What conductor.mjs's top-level catch does with a thrown error: the exit status and what is
// printed, or null to re-throw it unchanged so a real crash keeps its stack.
//
// A FUNCTION, not inline in the catch, for the reason conflictExitCode() is one: the mapping is
// testable without a subprocess and without a hidden self-test verb in the shipped CLI.

import { conflictExitCode, StateUnreadableError, unreadableStateMessage } from "./state.mjs";
import { UNREADABLE_INPUT_EXIT_CODE } from "./constants.mjs";

/** `{ exitCode, stdout, stderr }` for an error the engine refuses on, or null to re-throw.
 *
 *  - a write conflict → the conflict exit code: retryable;
 *  - an unreadable state file → UNREADABLE_INPUT_EXIT_CODE: a human fixes the file. */
export function refusalFor(verb, err) {
  const conflict = conflictExitCode(err);
  if (conflict !== null) return { exitCode: conflict, stdout: "", stderr: `conductor: ${err.message}\n` };
  if (err instanceof StateUnreadableError) {
    return { exitCode: UNREADABLE_INPUT_EXIT_CODE, stdout: "", stderr: unreadableStateMessage(err) };
  }
  return null;
}
