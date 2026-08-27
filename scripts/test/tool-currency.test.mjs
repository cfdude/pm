// gh#128 — is the OpenSpec CLI current, and is THIS PROJECT current with it?
//
// `pm` and `superpowers` are plugins that auto-update; OpenSpec is a CLI the user upgrades by
// hand, and `openspec update` — which regenerates the per-project instruction files and slash
// commands the whole OpenSpec lane runs on — is a separate manual per-project step nothing
// anywhere asks about. This suite pins the nudge that asks.
//
// Every test here sets PM_OPENSPEC_VERSION explicitly. It is the test seam for the installed
// CLI version (same shape as PM_CACHE_ROOT is for newestInstalledVersion), and leaving it unset
// would make the result depend on whether the machine running the suite happens to have
// `openspec` on PATH.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { run, runCombined, tmpRepo } from "./helpers.mjs";

/** helpers.mjs's parseBrief() takes no env; this suite needs one on every call, so it composes
 *  run() directly rather than widening a helper every other suite shares. */
function parseBrief(cwd, { env } = {}) {
  const out = run(["brief"], { cwd, env });
  return out.trim() ? JSON.parse(out).hookSpecificOutput.additionalContext : "";
}

/** Scaffold the artifacts `openspec init/update` generates for the `claude` tool.
 *
 *  `stamps` is one version per generated skill, so a PARTIAL update (some files rewritten,
 *  some not) is expressible — the case where the six files disagree. */
function withOpenspecArtifacts(cwd, { stamps = ["1.6.0"], changes = [], commands = true } = {}) {
  fs.mkdirSync(path.join(cwd, "openspec"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "openspec", "config.yaml"), "schema: spec-driven\n");
  for (const id of changes) {
    fs.mkdirSync(path.join(cwd, "openspec", "changes", id), { recursive: true });
    fs.writeFileSync(path.join(cwd, "openspec", "changes", id, "tasks.md"), "- [ ] one\n");
  }
  stamps.forEach((v, i) => {
    const dir = path.join(cwd, ".claude", "skills", `openspec-fixture-${i}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "SKILL.md"),
      `---\nname: openspec-fixture-${i}\nmetadata:\n  author: openspec\n  generatedBy: "${v}"\n---\n\nbody\n`);
  });
  if (commands) {
    fs.mkdirSync(path.join(cwd, ".claude", "commands", "opsx"), { recursive: true });
    fs.writeFileSync(path.join(cwd, ".claude", "commands", "opsx", "apply.md"), "# apply\n");
  }
}

const OPENSPEC_NUDGE = /OpenSpec/;

test("gh#128: brief nudges when the project's generated artifacts lag the installed CLI", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  withOpenspecArtifacts(cwd, { stamps: ["1.6.0"] });
  const brief = parseBrief(cwd, { env: { PM_OPENSPEC_VERSION: "1.10.0" } });
  assert.match(brief, OPENSPEC_NUDGE);
  assert.match(brief, /1\.6\.0/);
  assert.match(brief, /1\.10\.0/);
  assert.match(brief, /openspec update/);
});

/** Assert the nudge is ABSENT for a reason, not by accident.
 *
 *  Every negative below would also pass against an engine that emits no nudge at all — a
 *  deleted import, a renamed key, a guard that returns early always. So each one re-runs the
 *  SAME fixture with only the thing under test changed back, and requires the nudge to appear:
 *  that pins the absence to the condition rather than to the machinery being dead. */
function assertAbsentThenReachable(cwd, absentEnv, reachable) {
  assert.doesNotMatch(parseBrief(cwd, { env: absentEnv }), OPENSPEC_NUDGE);
  const brief = reachable();
  assert.match(brief, OPENSPEC_NUDGE,
    "the nudge never appears even under the drifting variant of this fixture, so the absence " +
    "assertion above proves nothing about the condition it names");
}

test("gh#128: brief says nothing when the project is already current", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  withOpenspecArtifacts(cwd, { stamps: ["1.10.0"] });
  assertAbsentThenReachable(cwd, { PM_OPENSPEC_VERSION: "1.10.0" },
    () => parseBrief(cwd, { env: { PM_OPENSPEC_VERSION: "1.11.0" } }));
});

test("gh#128: brief says nothing when the project stamp is NEWER than the CLI reading", () => {
  // Not a stale project — a stale reading, or a downgraded CLI. Either way there is nothing to
  // tell the user to run, and `openspec update` would move the project BACKWARDS.
  const cwd = tmpRepo();
  run(["init"], { cwd });
  withOpenspecArtifacts(cwd, { stamps: ["1.10.0"] });
  assertAbsentThenReachable(cwd, { PM_OPENSPEC_VERSION: "1.6.0" },
    () => parseBrief(cwd, { env: { PM_OPENSPEC_VERSION: "1.11.0" } }));
});

test("gh#128: an undeterminable installed version is CANNOT-TELL, never stale", () => {
  // The third answer, exactly as git.mjs's isAncestor() returns null rather than false. An empty
  // PM_OPENSPEC_VERSION forces the branch deterministically even on a machine that has the CLI.
  const cwd = tmpRepo();
  run(["init"], { cwd });
  withOpenspecArtifacts(cwd, { stamps: ["1.6.0"] });
  assertAbsentThenReachable(cwd, { PM_OPENSPEC_VERSION: "" },
    () => parseBrief(cwd, { env: { PM_OPENSPEC_VERSION: "1.10.0" } }));
});

test("gh#128: an undeterminable project version is CANNOT-TELL, never stale", () => {
  // No `generatedBy` stamp anywhere — a host tool other than `claude`, or artifacts predating
  // the stamp. Claiming staleness here would assert a comparison that never happened.
  const cwd = tmpRepo();
  run(["init"], { cwd });
  fs.mkdirSync(path.join(cwd, "openspec"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "openspec", "config.yaml"), "schema: spec-driven\n");
  assertAbsentThenReachable(cwd, { PM_OPENSPEC_VERSION: "1.10.0" }, () => {
    withOpenspecArtifacts(cwd, { stamps: ["1.6.0"] });
    return parseBrief(cwd, { env: { PM_OPENSPEC_VERSION: "1.10.0" } });
  });
});

test("gh#128: no openspec/ directory means the check does not apply at all", () => {
  // The preflight's existing shape: absent `openspec/` is "run `openspec init`", which is a
  // different message owned elsewhere. A stale-artifacts nudge here would be nonsense.
  const cwd = tmpRepo();
  run(["init"], { cwd });
  withOpenspecArtifacts(cwd, { stamps: ["1.6.0"] });
  fs.rmSync(path.join(cwd, "openspec"), { recursive: true, force: true });
  assertAbsentThenReachable(cwd, { PM_OPENSPEC_VERSION: "1.10.0" }, () => {
    fs.mkdirSync(path.join(cwd, "openspec"), { recursive: true });
    return parseBrief(cwd, { env: { PM_OPENSPEC_VERSION: "1.10.0" } });
  });
});

test("gh#128: when the generated files disagree, the OLDEST governs", () => {
  // A partial update leaves a mix. The agent reads all of them, so the oldest artifact is what
  // actually governs its behavior — reporting the newest would understate the drift.
  const cwd = tmpRepo();
  run(["init"], { cwd });
  withOpenspecArtifacts(cwd, { stamps: ["1.10.0", "1.6.0", "1.9.0"] });
  const brief = parseBrief(cwd, { env: { PM_OPENSPEC_VERSION: "1.10.0" } });
  assert.match(brief, OPENSPEC_NUDGE);
  assert.match(brief, /1\.6\.0/);
});

// ─────────── Decision 1: do not tell the user to run it mid-change ───────────

test("gh#128: with a change in flight the nudge HOLDS and names the change", () => {
  // `openspec update` rewrites the instruction files an in-flight change is being authored
  // against. Downgrade, don't suppress: the drift is still reported (pm's own repo nearly
  // always has a change open, so a suppressed nudge is a nudge that never fires), but the
  // imperative becomes "after archiving".
  const cwd = tmpRepo();
  run(["init"], { cwd });
  withOpenspecArtifacts(cwd, { stamps: ["1.6.0"], changes: ["add-widget"] });
  const brief = parseBrief(cwd, { env: { PM_OPENSPEC_VERSION: "1.10.0" } });
  assert.match(brief, OPENSPEC_NUDGE);
  assert.match(brief, /1\.6\.0/);
  assert.match(brief, /add-widget/);
  assert.match(brief, /HOLD/i);
});

test("gh#128: with no change in flight the nudge is an imperative, with no hold", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  withOpenspecArtifacts(cwd, { stamps: ["1.6.0"] });
  const brief = parseBrief(cwd, { env: { PM_OPENSPEC_VERSION: "1.10.0" } });
  assert.match(brief, OPENSPEC_NUDGE);
  assert.doesNotMatch(brief, /HOLD/i);
});

test("gh#128: an ARCHIVED change is not a change in flight", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  withOpenspecArtifacts(cwd, { stamps: ["1.6.0"] });
  fs.mkdirSync(path.join(cwd, "openspec", "changes", "archive", "2026-06-25-old"), { recursive: true });
  const brief = parseBrief(cwd, { env: { PM_OPENSPEC_VERSION: "1.10.0" } });
  assert.match(brief, OPENSPEC_NUDGE);
  assert.doesNotMatch(brief, /HOLD/i);
});

// ─────────── Decision 2: a diff is not optional, and may not exist ───────────

test("gh#128: untracked artifacts get COPY-ASIDE, because there is no diff to review", () => {
  // The discriminating case. `openspec update` rewrote 12 files in the repo that raised this;
  // where those files are untracked or git-ignored, `git diff` afterwards shows NOTHING and
  // local edits vanish with no trace. Telling that user to "review the diff" is vacuous advice.
  const cwd = tmpRepo();
  run(["init"], { cwd });
  withOpenspecArtifacts(cwd, { stamps: ["1.6.0"] });
  const brief = parseBrief(cwd, { env: { PM_OPENSPEC_VERSION: "1.10.0" } });
  assert.match(brief, OPENSPEC_NUDGE);
  assert.match(brief, /copy .*aside|aside/i);
  assert.doesNotMatch(brief, /`git diff` after/);
});

test("gh#128: tracked artifacts get REVIEW-THE-DIFF", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  withOpenspecArtifacts(cwd, { stamps: ["1.6.0"] });
  gitTrack(cwd);
  const brief = parseBrief(cwd, { env: { PM_OPENSPEC_VERSION: "1.10.0" } });
  assert.match(brief, OPENSPEC_NUDGE);
  assert.match(brief, /git diff/);
});

test("gh#128: the nudge always says pm will not run it", () => {
  // The architectural law, stated where the user reads it: pm emits the instruction, the user
  // runs the terminal command, exactly as with `openspec init`.
  const cwd = tmpRepo();
  run(["init"], { cwd });
  withOpenspecArtifacts(cwd, { stamps: ["1.6.0"] });
  const brief = parseBrief(cwd, { env: { PM_OPENSPEC_VERSION: "1.10.0" } });
  assert.match(brief, /run it for you|in a terminal/i);
});

// ─────────── /pm:upgrade emits the same finding ───────────

test("gh#128: upgrade reports the same drift the brief does", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  withOpenspecArtifacts(cwd, { stamps: ["1.6.0"] });
  const out = runCombined(["upgrade"], { cwd, env: { PM_OPENSPEC_VERSION: "1.10.0" } });
  assert.match(out, OPENSPEC_NUDGE);
  assert.match(out, /1\.6\.0/);
  assert.match(out, /openspec update/);
});

test("gh#128: upgrade says nothing about OpenSpec when the project is current", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  withOpenspecArtifacts(cwd, { stamps: ["1.10.0"] });
  assert.doesNotMatch(runCombined(["upgrade"], { cwd, env: { PM_OPENSPEC_VERSION: "1.10.0" } }),
    OPENSPEC_NUDGE);
  // Non-vacuity: the same fixture, one version further on, must speak.
  assert.match(runCombined(["upgrade"], { cwd, env: { PM_OPENSPEC_VERSION: "1.11.0" } }),
    OPENSPEC_NUDGE);
});

// ─────────── the engine must never mutate through the CLI ───────────

test("gh#128: no engine source runs `openspec` with anything but a read-only flag", () => {
  // pm is an INSTRUCTION layer, never an INTEGRATION layer. Reading a local version is a read;
  // `openspec update`/`init`/`archive` are mutations, and the engine emits those as text for
  // the user to run. A source scan rather than a behavioral assertion, because the failure this
  // guards is a NEW call site in a file no future test would think to look at.
  const libDir = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "lib");
  const offenders = [];
  for (const f of fs.readdirSync(libDir)) {
    if (!f.endsWith(".mjs")) continue;
    const src = fs.readFileSync(path.join(libDir, f), "utf8");
    // Any exec* whose argv[0] is the openspec binary must pass exactly ["--version"].
    const re = /exec(?:File)?Sync\(\s*"openspec"\s*,\s*(\[[^\]]*\])/g;
    let m;
    while ((m = re.exec(src))) {
      if (m[1].replace(/\s/g, "") !== '["--version"]') offenders.push(`${f}: ${m[1]}`);
    }
    if (/exec(?:File)?Sync\(\s*[`"'][^`"']*\bopenspec\b/.test(src.replace(/execFileSync\(\s*"openspec"/g, "")))
      offenders.push(`${f}: openspec inside a shell command string`);
  }
  assert.deepEqual(offenders, [],
    "the engine may only ever ask openspec for its version — every mutation is emitted as an " +
    "instruction for the user to run");
});

/** A git repo with the generated artifacts actually COMMITTED — the only state in which
 *  `git diff` after `openspec update` shows anything at all. */
function gitTrack(cwd) {
  execFileSync("git", ["init", "-q"], { cwd });
  execFileSync("git", ["config", "user.email", "t@e.com"], { cwd });
  execFileSync("git", ["config", "user.name", "T"], { cwd });
  execFileSync("git", ["add", "-A"], { cwd });
  execFileSync("git", ["commit", "-q", "-m", "baseline"], { cwd });
}
