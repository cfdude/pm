// scripts/test/assert/conductor-11.test.mjs
// 5.3's ASSERTION TWIN of scripts/test/functional/conductor-11.test.mjs — same id, same subject.
//
// THE FUNCTIONAL FILE'S SUBJECT is gh#65/gh#68: `commit-nudge` (PostToolUse) must log a detour entry
// only for a commit that actually LANDED IN THIS REPOSITORY, and it decides that by OBSERVING HEAD
// and the reflog — which needs a real repository, so its cases all land real commits (design D5).
//
// WHAT THIS HALF CAN PROVE IS THE OTHER SIDE OF THE SAME GUARD, and it is the stronger side: with no
// repository at all, nothing can be observed to have landed, so NO entry may be written — not a
// wrong one, not a stale-HEAD one. The functional file's own note applies verbatim: the negative
// assertions must not be vacuous, so each is paired with the proof that the hook RAN.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRepo, run, writeState, detourLog, autoDetourState, expectFail } from "../fixtures/assert-harness.mjs";

/** Run commit-nudge and require that it ran to completion. `commit-nudge` emits a PostToolUse
 *  payload on its completing paths, so this is the non-vacuity proof the absence assertions need —
 *  a bare `detourLog(cwd) === ""` also passes when the hook never ran at all. */
function nudge(cwd, command) {
  const out = run(["commit-nudge"], { cwd, input: JSON.stringify({ tool_input: { command } }) });
  assert.ok(out.includes("hookSpecificOutput"),
    `commit-nudge emitted no context payload, so it did not run to completion: ${JSON.stringify(out)}`);
  return out;
}

test("no entry is written when no commit can be observed to have landed (gh#65/#68)", () => {
  const cwd = tmpRepo(); run(["init"], { cwd }); autoDetourState(cwd);
  nudge(cwd, 'git commit -m "fix: rejected by pre-commit, never landed"');
  assert.equal(detourLog(cwd), "",
    "with nothing observed to have landed there is nothing to attribute — no row at all");
});

test("a command that merely mentions a commit changes nothing either", () => {
  const cwd = tmpRepo(); run(["init"], { cwd }); autoDetourState(cwd);
  nudge(cwd, 'echo "run git commit -m ok"');
  assert.equal(detourLog(cwd), "");
});

test("a commit aimed at ANOTHER repository writes nothing here — in either direction", () => {
  const cwd = tmpRepo(); run(["init"], { cwd }); autoDetourState(cwd);
  // `git -C ../other commit …` is a commit this repository could not have observed, and the hook
  // emits NOTHING for it at all: the text heuristic keys on a bare `git commit`, so a redirected
  // form reaches neither rung. (The functional file's own gh#65 bug-2 control uses the bare form
  // and lands a real commit in the other repo; this is the same rule from the unobservable side.)
  const out = run(["commit-nudge"], { cwd, input: JSON.stringify({ tool_input: { command: 'git -C ../other commit -m "fix: belongs to the paired repo"' } }) });
  assert.equal(out.trim(), "", "a redirected commit is not a commit to THIS repository");
  assert.equal(detourLog(cwd), "");
  assert.doesNotMatch(detourLog(cwd), /paired/);
});

test("the hook degrades to doing nothing without a repository rather than throwing", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  assert.doesNotThrow(() => nudge(cwd, "git commit -m x"), "no repository at all");
});

test("an unreadable state.json is REPORTED with exit 2 and writes nothing — not a silent degradation", () => {
  // The unreadable-state rung is the one place exit 0 is wrong (state-file-refuses-to-guess): it
  // used to re-render PROJECT.md from an empty guess of the record, which is the defect itself.
  const cwd = tmpRepo(); run(["init"], { cwd }); autoDetourState(cwd);
  fs.writeFileSync(path.join(cwd, ".conductor", "state.json"), "{ not json");
  const watched = [".conductor/state.json", "PROJECT.md", ".conductor/detours.log"].map(f => path.join(cwd, f));
  const before = watched.map(f => (fs.existsSync(f) ? fs.readFileSync(f, "utf8") : null));
  const refused = expectFail(() => run(["commit-nudge"], { cwd, input: JSON.stringify({ tool_input: { command: "git commit -m x" } }) }));
  assert.equal(refused && refused.status, 2, "unreadable state.json: the hook must report with exit 2");
  watched.forEach((f, i) => assert.equal(fs.existsSync(f) ? fs.readFileSync(f, "utf8") : null, before[i],
    `${path.basename(f)} must be unchanged`));
});

// ───────────────────────── the deliberate omissions ─────────────────────────
//
// The functional file's POSITIVE controls — "commit-nudge still logs a genuine landed commit", its
// body/`-F`/`$(...)`/trailing-space variants, and the DETOUR-COMMIT positive control — each require
// a real commit whose landing the hook can OBSERVE, so they are functional-only (design D5).
// scripts/test/assert/conductor-08.test.mjs proves the DETOUR-COMMIT path this half CAN reach, in
// the no-repository world, where its sha field is the literal `-` ("cannot tell").
