// scripts/test/detached-warning.test.mjs
// gh#175 group 3 — a write into a tree a deploy can discard says so.
//
// WARN AND STILL WRITE. pm reports; it does not decide. Detachment is a deliberately cheap signal
// with accepted false positives — a bisect, an old-tag review, and EVERY CI checkout, since
// `actions/checkout` leaves HEAD detached at the sha — so refusing would break legitimate work.
// And since no override ships, a refusal would be unescapable, which is strictly worse.
//
// THE GATE IS REUSED, NOT REBUILT. 0.40.0 stopped the sibling WRITING-A-DIFFERENT-REPOSITORY
// warning crying wolf on the 17 read-only verbs; a warning built beside it must inherit that gate.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { tmpRepo, run, runCombined, readState } from "../fixtures/functional-harness.mjs";

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" });

function workspace() {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  git(cwd, "init", "-q", "-b", "main");
  git(cwd, "config", "user.email", "t@example.com");
  git(cwd, "config", "user.name", "t");
  git(cwd, "add", "-A");
  git(cwd, "commit", "-q", "-m", "one");
  return cwd;
}
function deployed({ tag } = {}) {
  const cwd = workspace();
  if (tag) git(cwd, "tag", "-a", tag, "-m", tag);
  git(cwd, "checkout", "-q", "--detach", git(cwd, "rev-parse", "HEAD").trim());
  return cwd;
}
const DETACHED = /DETACHED CHECKOUT/;

test("a mutating verb warns AND still writes — both halves, since a refusal would pass a warn-only check", () => {
  const cwd = deployed();
  const out = runCombined(["add-epic", "--id", "e1", "--title", "t", "--lane", "claude-code",
                           "--priority", "P2"], { cwd });
  assert.match(out, DETACHED, "it warns");
  const epic = readState(cwd).epics.find(e => e.id === "e1");
  assert.ok(epic, "AND it writes — pm reports, it does not decide");
});

test("the warning names the tag when HEAD is exactly at one", () => {
  const cwd = deployed({ tag: "v2.11.0" });
  const out = runCombined(["add-epic", "--id", "e1", "--title", "t", "--lane", "claude-code",
                           "--priority", "P2"], { cwd });
  assert.match(out, /at v2\.11\.0/,
    "`detached at v2.11.0` identifies a deployment to a reader; `detached` alone does not");
});

test("the warning omits the tag when HEAD is not at one, and still warns", () => {
  const cwd = deployed();
  const out = runCombined(["add-epic", "--id", "e1", "--title", "t", "--lane", "claude-code",
                           "--priority", "P2"], { cwd });
  assert.match(out, DETACHED, "a sha-based deploy is ordinary and must still be caught");
  assert.doesNotMatch(out, /\(at \)/, "no empty parenthetical");
});

test("the warning NAMES WHAT IS WRITTEN, not a generic 'the write'", () => {
  const cwd = deployed();
  const out = runCombined(["add-epic", "--id", "e1", "--title", "t", "--lane", "claude-code",
                           "--priority", "P2"], { cwd });
  assert.match(out, /about to write: .*state\.json/,
    "the sibling suppression removes some writes, so a generic message would point at one that " +
    "no longer happens");
});

test("EVERY read-only verb is silent — the defect 0.40.0 removed must not return", async () => {
  const { VERB_EFFECTS } = await import("../../lib/verb-effects.mjs");
  const readOnly = Object.entries(VERB_EFFECTS)
    .filter(([, v]) => v.effect === "read-only").map(([k]) => k);
  assert.ok(readOnly.length > 10, `expected a real population of read-only verbs, got ${readOnly.length}`);
  const cwd = deployed();
  // ITERATE THE DECLARED SET, not a typed sample. A typed list of four would leave a verb
  // reclassified to read-only later uncovered — the staleness shape this change's own design
  // rejects, and task 4.3 claims the declared set is what is used, so it must be.
  for (const verb of readOnly) {
    assert.doesNotMatch(runCombined([verb], { cwd }), DETACHED,
      `${verb} is read-only — reading a deployed checkout's record is a legitimate thing to want`);
  }
});

test("a tree on a branch produces no warning", () => {
  const cwd = workspace();
  const out = runCombined(["add-epic", "--id", "e1", "--title", "t", "--lane", "claude-code",
                           "--priority", "P2"], { cwd });
  assert.doesNotMatch(out, DETACHED, "every managed repo is here — this is the regression that matters");
});

test("a tree git cannot answer about produces no warning", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const out = runCombined(["add-epic", "--id", "e1", "--title", "t", "--lane", "claude-code",
                           "--priority", "P2"], { cwd });
  assert.doesNotMatch(out, DETACHED, "`unknown` is not detachment");
});

test("an UNRECOGNISED verb in a detached tree warns — the spec scenario that had no assertion", () => {
  // `!== "read-only"` and not `=== "mutates"`: a verb nobody declared is not evidence that it is
  // safe, and reading an absent declaration as read-only would make every new verb silently exempt
  // until someone remembered to add a row.
  const cwd = deployed();
  const out = runCombined(["no-such-verb"], { cwd });
  assert.match(out, DETACHED, "an undeclared verb warns, mirroring the divergence warning beside it");
});

test("commit-nudge does NOT warn — it writes nothing here, and it runs on every Bash call", () => {
  // Warning about a discarded write would be false, and this verb is PostToolUse-wired: three
  // stderr lines and a `git describe` spawn per tool call, in a deployed checkout, for a no-op.
  const cwd = deployed();
  const out = runCombined(["commit-nudge"], { cwd, input: JSON.stringify({ tool_input: { command: "ls" } }) });
  assert.doesNotMatch(out, DETACHED, "nothing is written, so there is no discarded write to warn about");
});

test("a hook in a detached repository pm never initialised prints NOTHING — dormant means silent", () => {
  // hooks-not-silent-before-init (code review 0.43.0, C1). snapshot is PreCompact-wired in every
  // repository on the machine; in a detached non-pm checkout it printed a four-line "about to write
  // .conductor/brief.txt" and then, dormant, wrote nothing. hooks/README.md says silent until /pm:init.
  const cwd = tmpRepo();
  fs.writeFileSync(path.join(cwd, "f.txt"), "x\n");
  git(cwd, "init", "-q", "-b", "main");
  git(cwd, "config", "user.email", "t@example.com");
  git(cwd, "config", "user.name", "t");
  git(cwd, "add", "-A");
  git(cwd, "commit", "-q", "-m", "one");
  git(cwd, "checkout", "-q", "--detach", git(cwd, "rev-parse", "HEAD").trim());
  for (const hook of ["snapshot", "brief"]) {
    const out = runCombined([hook], { cwd, input: "{}" });
    assert.doesNotMatch(out, DETACHED, `${hook}: no detached warning in a repository pm never initialised`);
  }
  assert.ok(!fs.existsSync(path.join(cwd, ".conductor")), "and nothing was written");
});

test("the warning says that session bookkeeping will not happen", () => {
  const cwd = deployed();
  const out = runCombined(["snapshot"], { cwd });
  assert.match(out, /session bookkeeping is NOT written here/,
    "some of the writes it names are suppressed by the sibling requirement — saying only what the " +
    "verb declares would point at writes that no longer happen");
});
