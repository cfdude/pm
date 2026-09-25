// scripts/lib/runtime-support.mjs
// 0.49.0 (runtime-support, design D1 and D6) — THE SUPPORT FLOOR, declared ONCE, and the one line the
// SessionStart brief prints below it.
//
// THE POLICY. pm supports exactly the Node long-term-support lines that are not end-of-life: a major
// whose schedule entry carries an `lts` date, whose `start` is on or before today and whose `end` is
// after today — the same set CI computes for its matrix (`scripts/test/node-majors.mjs`). The SUPPORT
// FLOOR is the lowest of them. It is always called the support floor, never "the floor", because the
// suite's gates already have a test-COUNT floor.
//
// ONE CONSTANT, UPDATED AT RELEASE TIME. The engine never fetches the schedule, or anything else — it
// opens no network connection, and this module is no exception (`assert/conductor-35`'s no-network
// walk reads every `scripts/lib/*.mjs`). Holding only the constant, the engine can tell a Node BELOW
// the support floor from one at or above it, and cannot tell a supported major from an unsupported one
// above it (25, say); so it warns only below, and says nothing it cannot know. The constant is kept
// true by the release checklist's support-floor step, by `assert/ci-workflow.test.mjs` (the minimum of
// CI's committed fallback list equals it) and by `assert/support-floor.test.mjs` (every documented
// copy of the support floor equals it).
//
// ONE IMPORT, deliberately: the escaper. The running version is interpolated into engine output, and
// a second copy of `escapeControls` would be a second implementation of an output-integrity rule.

import { escapeControls } from "./constants.mjs";

/** The lowest supported Node major. 22 until 2027-04-30, when Node 22 reaches end-of-life. */
export const NODE_FLOOR_MAJOR = 22;

/** The one line the SessionStart brief prints when `version` (a `process.version`-shaped string) is
 *  below the support floor, or `null` when it is not — at or above the floor, or unparseable: "cannot
 *  tell" is not "below", the rule `tool-currency.mjs` already follows. Pure. */
export function supportFloorLine(version) {
  const m = /^v?(\d+)\./.exec(String(version ?? ""));
  if (!m) return null;
  if (Number(m[1]) >= NODE_FLOOR_MAJOR) return null;
  return `⚠ Node ${escapeControls(version)} is below pm's support floor (Node ${NODE_FLOOR_MAJOR}, the oldest ` +
    "supported LTS line) — pm still runs, but this Node no longer receives security fixes; upgrade it.";
}
