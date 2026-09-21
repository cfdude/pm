// scripts/test/verb-surface-answers-back.test.mjs
// gh#177 · gh#178 · gh#179 · gh#181 — "the verb surface answers back".
//
// Four reported gaps of ONE shape: a write the engine accepts and cannot read back, undo, or
// spell consistently. They are one change because they are one registry — every flag below is a
// row in `EPIC_FLAGS`, and the projections that build the allowlists and the help surface read
// that registry and nothing else.
//
// The sweeps here are driven from the registry (and from state.mjs's TIMEKEEPING_FIELDS) rather
// than from lists typed into this file, for the reason nullable-clearing.test.mjs states: a list
// transcribed into a test simply does not mention the row that was added without its rule.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { run, tmpRepo, readState, expectFail, ENGINE, EMPTY_CACHE, fixtureCommits } from "../fixtures/functional-harness.mjs";

const CONSTANTS = new URL("../../lib/constants.mjs", import.meta.url).href;
const STATE = new URL("../../lib/state.mjs", import.meta.url).href;

/** stdout+stderr of an invocation that MUST succeed — the same local helper
 *  nullable-clearing.test.mjs uses, and for the same reason: `runCombined()` ignores the exit
 *  code, so a crash would read as "no such message" rather than as a failure. */
function combined(cwd, args) {
  const r = spawnSync("node", [ENGINE, ...args], {
    cwd, encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: cwd, PM_CACHE_ROOT: EMPTY_CACHE },
  });
  assert.equal(r.status, 0, `expected success: ${r.stderr}`);
  return (r.stdout || "") + (r.stderr || "");
}
const stateBytes = (cwd) => fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8");
const epicOf = (cwd, id) => readState(cwd).epics.find(e => e.id === id);

function repo() {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "one", "--lane", "openspec"], { cwd });
  run(["add-epic", "--id", "two", "--lane", "openspec"], { cwd });
  return cwd;
}

// ════════════════ gh#181 — a recovered createdAt cannot be corrected ════════════════

test("gh-181: `--clear created-at` returns the registration date to ABSENT", () => {
  const cwd = repo();
  assert.ok("createdAt" in epicOf(cwd, "one"), "the engine stamps createdAt at registration");
  const out = combined(cwd, ["update-epic", "one", "--clear", "created-at"]);
  assert.ok(!("createdAt" in epicOf(cwd, "one")),
    "--clear created-at left the date on the record — absence is the legal 'unknown' state");
  assert.match(out, /recover-created-at/,
    "the clearNote must name the recovery verb: clear-then-recover IS the correction path");
});

test("gh-181: the cleared date is recoverable again — the never-overwrite rule is untouched", () => {
  const cwd = repo();
  // A real checkout, so `recover-created-at` has history to read. Without it the verb correctly
  // reports 'unrecoverable' and this test would pass against an engine that recovers nothing.
  const git = (...args) => spawnSync("git", args, { cwd, encoding: "utf8" });
  git("init", "-q");
  git("config", "user.email", "t@example.test");
  git("config", "user.name", "t");
  git("add", "-A");
  git("commit", "-qm", "register epics");
  run(["update-epic", "one", "--clear", "created-at"], { cwd });
  assert.ok(!("createdAt" in epicOf(cwd, "one")));
  const out = combined(cwd, ["recover-created-at"]);
  assert.match(out, /recover-created-at: 1 recovered/,
    `the recovery must fill the cleared date back in from history — got: ${out}`);
  assert.ok("createdAt" in epicOf(cwd, "one"));
});

test("gh-181: `created-at` is NOT a settable flag — the registry row is clearing-only", () => {
  const cwd = repo();
  const err = expectFail(() => run(["update-epic", "one", "--created-at", "2020-01-01T00:00:00Z"], { cwd }));
  assert.ok(err, "a settable --created-at would be accepted by the allowlist and written by nothing");
  assert.match(String(err.stderr || err.message), /created-at/);
  const help = run(["update-epic", "--help"], { cwd });
  assert.doesNotMatch(help, /--created-at </,
    "help must not advertise a flag the parser refuses — the invariant #158 exists for");
});

test("gh-181: `--clear touched-at` is refused, carrying the registry's own reason", () => {
  const cwd = repo();
  const err = expectFail(() => run(["update-epic", "one", "--clear", "touched-at"], { cwd }));
  assert.ok(err, "touchedAt is engine-maintained — clearing it answers no question");
  const msg = String(err.stderr || err.message);
  assert.match(msg, /touched-at/, "the refusal names the field");
  assert.match(msg, /re-stamp|next write|engine/i, "and gives the declared reason, not a generic one");
});

test("gh-181: every engine-written timekeeping field DECLARES its clearability", async () => {
  // The population is derived from state.mjs's own list, never transcribed: a third timekeeping
  // field added there with no declaration here is exactly the silence this requirement removes.
  const { TIMEKEEPING_FIELDS } = await import(STATE);
  const { EPIC_FLAGS } = await import(CONSTANTS);
  assert.ok(TIMEKEEPING_FIELDS.length >= 2, "the export is the population — it must not be empty");
  for (const key of TIMEKEEPING_FIELDS) {
    const row = EPIC_FLAGS.find(r => r.key === key);
    assert.ok(row, `'${key}' is engine-written and has no registry row, so nothing declares ` +
      "whether it can be cleared or why not");
    assert.equal(row.engineWritten, true,
      `'${key}' must be marked engineWritten — no caller may type --${row.flag} to set it`);
    const declared = row.nullable === true ? !!row.clearNote : typeof row.setOnly === "string";
    assert.ok(declared,
      `'${key}' declares neither 'nullable: true' with a clearNote nor a setOnly reason`);
  }
});

test("gh-181: an engineWritten row appears in no allowlist and no help surface", async () => {
  const { EPIC_FLAGS, flagsFor, cliFlagsFor, valueBearingFlagsFor, settableEpicFlags } =
    await import(CONSTANTS);
  const rows = EPIC_FLAGS.filter(r => r.engineWritten);
  assert.ok(rows.length >= 2, "the marker must actually be in use, or this sweep proves nothing");
  for (const row of rows) {
    for (const command of row.commands) {
      assert.equal(flagsFor(command).includes(row.flag), false,
        `--${row.flag} is engine-written and must not be a known flag on ${command}`);
      assert.equal(cliFlagsFor(command).includes(row.flag), false,
        `--${row.flag} must not reach help on ${command}`);
      assert.equal(valueBearingFlagsFor(command).some(f => f.flag === row.flag), false,
        `--${row.flag} must not be swept by the value-bearing guard — it is not typeable`);
      assert.equal(settableEpicFlags(command).some(f => f.flag === row.flag), false,
        `--${row.flag} is not settable, so the settable population must not claim it`);
    }
  }
});

// ════════════════ gh#177 — Gate 1 reviews artifacts, not a SHA range ════════════════

test("gh-177: a Gate 1 pass records the ARTIFACTS it reviewed, with no SHA range", () => {
  const cwd = repo();
  const spec = path.join(cwd, "openspec", "changes", "c", "specs", "a.md");
  fs.mkdirSync(path.dirname(spec), { recursive: true });
  fs.writeFileSync(spec, "# a spec\n");
  const err = expectFail(() => run(["record-gate-review", "one", "--gate", "1", "--verdict", "pass",
    "--artifact", "openspec/changes/c/specs/a.md", "--artifact", "openspec/changes/c/proposal.md",
    "--reviewer", "a fresh-context subagent"], { cwd }));
  assert.equal(err, null,
    `Gate 1 reviews artifacts by path, before code exists: ${err && String(err.stderr || err.message)}`);
  const g1 = epicOf(cwd, "one").gateReview.gate1;
  assert.deepEqual(g1.artifacts,
    ["openspec/changes/c/specs/a.md", "openspec/changes/c/proposal.md"]);
  assert.ok(!("baseSha" in g1) && !("headSha" in g1),
    "no range was supplied, so none may be invented");
});

test("gh-177: a Gate 2 pass STILL requires the range it covered", () => {
  const cwd = repo();
  const err = expectFail(() => run(["record-gate-review", "one", "--gate", "2", "--verdict", "pass",
    "--artifact", "openspec/changes/c/specs/a.md"], { cwd }));
  assert.ok(err, "Gate 2 reviews an implementation range — artifacts are not a substitute");
  assert.match(String(err.stderr || err.message), /--base-sha|--head-sha/);
  assert.ok(!epicOf(cwd, "one").gateReview, "a refused verdict writes nothing");
});

test("gh-177: a Gate 1 pass with NO evidence of either kind is refused", () => {
  const cwd = repo();
  const err = expectFail(() => run(["record-gate-review", "one", "--gate", "1", "--verdict", "pass"], { cwd }));
  assert.ok(err, "a pass carrying no evidence at all is the record this whole field exists against");
  assert.match(String(err.stderr || err.message), /--artifact/,
    "the refusal must name the evidence a spec review actually has");
});

test("gh-177: a Gate 1 FAIL needs no evidence, exactly as a Gate 2 fail does not", () => {
  const cwd = repo();
  const err = expectFail(() => run(["record-gate-review", "one", "--gate", "1", "--verdict", "fail"], { cwd }));
  assert.equal(err, null, `a failed review must not be harder to record than a passing one: ${err && String(err.stderr)}`);
  assert.equal(epicOf(cwd, "one").gateReview.gate1.verdict, "fail");
});

test("gh-177: a Gate 1 pass carrying a SHA range STILL records — and says it is the wrong kind", () => {
  const cwd = repo();
  const [base, head] = fixtureCommits(cwd, ["base", "head"]);
  const out = combined(cwd, ["record-gate-review", "one", "--gate", "1", "--verdict", "pass",
    "--base-sha", base, "--head-sha", head]);
  const g1 = epicOf(cwd, "one").gateReview.gate1;
  assert.equal(g1.baseSha, base, "every form that worked before must still work");
  assert.equal(g1.headSha, head);
  assert.match(out, /--artifact/,
    "recording it is right; saying nothing about an implementation range on a spec review is not");
});

test("gh-177: gateHasEvidence still means A COMMIT RANGE, and nothing else", async () => {
  const { gateHasEvidence } = await import(CONSTANTS);
  assert.equal(gateHasEvidence({ verdict: "pass", artifacts: ["a.md"] }), false,
    "archive-gate and integrity dereference entry.headSha the line after this guard — widening " +
    "it to admit artifacts hands both of them `undefined`");
  assert.equal(gateHasEvidence({ baseSha: "a", headSha: "b" }), true);
});

test("gh-177: an artifact-evidenced verdict renders as its artifacts, not as '⚠ no checkable evidence'", () => {
  const cwd = repo();
  run(["record-gate-review", "one", "--gate", "1", "--verdict", "pass",
    "--artifact", "openspec/changes/c/specs/a.md"], { cwd });
  const md = fs.readFileSync(path.join(cwd, "PROJECT.md"), "utf8");
  assert.match(md, /1 artifact/,
    "a correct Gate 1 pass must not render as a warning — that moves the wrong record one step on");
});

test("gh-177: a Gate 1 verdict recorded before this change loads unchanged and is not rewritten", () => {
  const cwd = repo();
  const [base, head] = fixtureCommits(cwd, ["base", "head"]);
  run(["record-gate-review", "one", "--gate", "1", "--verdict", "pass",
    "--base-sha", base, "--head-sha", head], { cwd });
  const before = JSON.stringify(epicOf(cwd, "one").gateReview.gate1);
  // Any later write re-serializes the whole record; the prior verdict must survive it verbatim.
  run(["update-epic", "one", "--notes", "unrelated"], { cwd });
  assert.equal(JSON.stringify(epicOf(cwd, "one").gateReview.gate1), before,
    "an existing recorded Gate 1 verdict must load and must not be rewritten");
});

// ════════════════ gh#178 — a release object cannot be read back ════════════════

function releaseRepo() {
  const cwd = repo();
  run(["add-epic", "--id", "three", "--lane", "openspec"], { cwd });
  run(["release", "1.0.0", "--intent", "the first cut", "--target", "friday",
    "--member", "one", "--member", "two"], { cwd });
  run(["release", "1.0.0", "--defer", "three", "--reason", "not ready"], { cwd });
  return cwd;
}

test("gh-178: `release show <id>` renders intent, target, DERIVED members, deferrals and the verdict", () => {
  const cwd = releaseRepo();
  const out = run(["release", "show", "1.0.0"], { cwd });
  assert.match(out, /1\.0\.0/);
  assert.match(out, /the first cut/, "intent");
  assert.match(out, /friday/, "target");
  assert.match(out, /\bone\b/, "a derived member");
  assert.match(out, /\btwo\b/, "the other derived member");
  assert.match(out, /three/, "the deferral");
  assert.match(out, /not ready/, "and the reason that makes the exclusion legible");
});

test("gh-178: `release show` is a pure READ — it writes nothing", () => {
  const cwd = releaseRepo();
  const before = stateBytes(cwd);
  const md = fs.readFileSync(path.join(cwd, "PROJECT.md"), "utf8");
  run(["release", "show", "1.0.0"], { cwd });
  assert.equal(stateBytes(cwd), before, "a read must not save state");
  assert.equal(fs.readFileSync(path.join(cwd, "PROJECT.md"), "utf8"), md, "nor re-render");
});

test("gh-178: `release show` with no id lists every release", () => {
  const cwd = releaseRepo();
  run(["release", "2.0.0", "--intent", "the next one"], { cwd });
  const out = run(["release", "show"], { cwd });
  assert.match(out, /1\.0\.0/);
  assert.match(out, /2\.0\.0/);
});

test("gh-178: `release show <unknown>` fails rather than rendering an empty object", () => {
  const cwd = releaseRepo();
  const err = expectFail(() => run(["release", "show", "9.9.9"], { cwd }));
  assert.ok(err, "a release that does not exist is not a release with nothing in it");
  assert.match(String(err.stderr || err.message), /9\.9\.9/);
});

test("gh-178: `--unmember` removes the membership pointer and RECORDS why", () => {
  const cwd = releaseRepo();
  const out = combined(cwd, ["release", "1.0.0", "--unmember", "two", "--reason", "registered in error"]);
  assert.equal(epicOf(cwd, "two").release, undefined, "the one-way pointer is gone");
  assert.match(out, /two/);
  const rel = readState(cwd).releases.find(r => r.id === "1.0.0");
  assert.ok(Array.isArray(rel.amendments) && rel.amendments.length === 1,
    "a reason demanded and then discarded is worse than a reason not demanded");
  assert.equal(rel.amendments[0].op, "unmember");
  assert.equal(rel.amendments[0].epic, "two");
  assert.equal(rel.amendments[0].reason, "registered in error");
  assert.match(run(["release", "show", "1.0.0"], { cwd }), /registered in error/,
    "and the read-back is where it has to be visible");
});

test("gh-178: `--unmember` requires its reason", () => {
  const cwd = releaseRepo();
  const err = expectFail(() => run(["release", "1.0.0", "--unmember", "two"], { cwd }));
  assert.ok(err, "every terminal write here carries its reason");
  assert.equal(epicOf(cwd, "two").release, "1.0.0", "and a refusal writes nothing");
});

test("gh-178: `--unmember` refuses an unknown epic, and one belonging to ANOTHER release", () => {
  const cwd = releaseRepo();
  const unknown = expectFail(() => run(["release", "1.0.0", "--unmember", "nope:why"], { cwd }));
  assert.ok(unknown, "an unknown epic id is refused exactly as --member refuses one");

  run(["release", "2.0.0", "--intent", "the next one", "--member", "three"], { cwd });
  const other = expectFail(() => run(["release", "1.0.0", "--unmember", "three:why"], { cwd }));
  assert.ok(other, "silently deleting another release's pointer is the sibling-site defect");
  assert.equal(epicOf(cwd, "three").release, "2.0.0", "and it must survive the refusal");
});

test("gh-178: `--undefer` removes the exclusion, keeping what it used to say", () => {
  const cwd = releaseRepo();
  combined(cwd, ["release", "1.0.0", "--undefer", "three:back in scope after all"]);
  const rel = readState(cwd).releases.find(r => r.id === "1.0.0");
  assert.equal(rel.deferred.length, 0, "the exclusion is gone");
  const amendment = rel.amendments.find(a => a.op === "undefer");
  assert.ok(amendment, "a recorded judgment must never disappear silently");
  assert.equal(amendment.reason, "back in scope after all");
  assert.equal(amendment.was, "not ready", "the judgment it replaced stays readable");
});

test("gh-178: `--undefer` refuses an epic this release never deferred", () => {
  const cwd = releaseRepo();
  const err = expectFail(() => run(["release", "1.0.0", "--undefer", "one:why"], { cwd }));
  assert.ok(err, "an inverse applied to something absent means the caller believes something false");
});

test("gh-178: the IMPLICIT undefer `--member` already performed is recorded the same way", () => {
  // The sibling call site. `--member` has cleared a deferral and announced it since the verb
  // shipped; recording the explicit one and not this one is the absent-edit-at-a-sibling-site
  // class this repository names as its dominant defect.
  const cwd = releaseRepo();
  combined(cwd, ["release", "1.0.0", "--member", "three"]);
  const rel = readState(cwd).releases.find(r => r.id === "1.0.0");
  const amendment = (rel.amendments || []).find(a => a.op === "undefer" && a.epic === "three");
  assert.ok(amendment, "the same removal through a different flag must leave the same record");
  assert.equal(amendment.was, "not ready");
  assert.equal(amendment.via, "member", "and say which path performed it, since no reason was given");
});

test("gh-178: one epic may not be both added and removed in ONE invocation", () => {
  const cwd = releaseRepo();
  const err = expectFail(() => run(["release", "1.0.0", "--member", "three", "--unmember", "three:why"], { cwd }));
  assert.ok(err, "the same refusal --member/--defer already carries, at the new pair");
});

test("gh-178: a release may not be named `show`, which the read form reserves", () => {
  const cwd = repo();
  const err = expectFail(() => run(["release", "show", "--intent", "an ambiguous name"], { cwd }));
  assert.ok(err, "an id that collides with the read keyword must be refused, not resolved by guesswork");
  assert.match(String(err.stderr || err.message), /reserved|read form/i);
});

// ════════════════ gh#179 — one concept, one separator ════════════════

test("gh-179: `--defer <epicId>:<reason>` carries its reason inline", () => {
  const cwd = releaseRepo();
  run(["release", "1.0.0", "--defer", "two:cut for time"], { cwd });
  const rel = readState(cwd).releases.find(r => r.id === "1.0.0");
  const d = rel.deferred.find(x => x.epic === "two");
  assert.ok(d, "the inline form must record an exclusion");
  assert.equal(d.reason, "cut for time");
  assert.equal(epicOf(cwd, "two").release, undefined, "and clear membership exactly as before");
});

test("gh-179: the out-of-band `--defer <id> --reason \"<why>\"` form still works", () => {
  const cwd = releaseRepo();
  run(["release", "1.0.0", "--defer", "two", "--reason", "cut for time"], { cwd });
  const rel = readState(cwd).releases.find(r => r.id === "1.0.0");
  assert.equal(rel.deferred.find(x => x.epic === "two").reason, "cut for time");
});

test("gh-179: supplying the reason BOTH ways in one invocation is refused, not resolved", () => {
  const cwd = releaseRepo();
  const err = expectFail(() => run(
    ["release", "1.0.0", "--defer", "two:inline", "--reason", "out of band"], { cwd }));
  assert.ok(err, "two reasons for one record: say which, rather than letting last-wins decide");
  const rel = readState(cwd).releases.find(r => r.id === "1.0.0");
  assert.equal(rel.deferred.find(x => x.epic === "two"), undefined, "and nothing is written");
});

test("gh-179: `--deferral` accepts `::` as well as `:`, and `::` wins where both appear", () => {
  const cwd = repo();
  // A claude-code epic: the archive gate's Gate 2 requirement is openspec-lane only, and this
  // test is about the SEPARATOR, not about the gate.
  run(["add-epic", "--id", "arch", "--lane", "claude-code"], { cwd });
  run(["update-epic", "arch", "--status", "archived", "--outcome", "delivered",
    "--deferral", "one::design.md § Deferred: the tricky part"], { cwd });
  assert.deepEqual(epicOf(cwd, "arch").deferralAssertion.deferrals,
    [{ epic: "one", section: "design.md § Deferred: the tricky part" }],
    "the stricter separator is accepted everywhere, which is always safe");
});

test("gh-179: `--deferral`'s single-colon form is unchanged", () => {
  const cwd = repo();
  run(["add-epic", "--id", "arch", "--lane", "claude-code"], { cwd });
  run(["update-epic", "arch", "--status", "archived", "--outcome", "delivered",
    "--deferral", "one:design.md § Deferred: the tricky part"], { cwd });
  assert.deepEqual(epicOf(cwd, "arch").deferralAssertion.deferrals,
    [{ epic: "one", section: "design.md § Deferred: the tricky part" }]);
});

test("gh-179: help SAYS why `--declined-deferral` takes a double colon", () => {
  const cwd = repo();
  const help = run(["update-epic", "--help"], { cwd });
  const line = help.split("\n").find(l => l.includes("--declined-deferral"));
  assert.ok(line, "the flag must still be advertised");
  assert.match(line, /::/, "the separator is the thing a caller gets wrong");
  assert.match(line, /colon/i,
    "the reasoning was sound and invisible at the call site — that is the whole report");
});

test("gh-179: every deferral-shaped flag names WHAT it wants, not `<a value>`", async () => {
  // Derived from the registry: a fourth flag joining this family with a bare placeholder fails
  // here rather than shipping as the fourth shape of one concept.
  const { EPIC_FLAGS } = await import(CONSTANTS);
  for (const flag of ["defer", "deferral", "declined-deferral", "unmember", "undefer"]) {
    const row = EPIC_FLAGS.find(r => r.flag === flag);
    assert.ok(row, `--${flag} must be declared in the shared registry`);
    assert.equal(typeof row.placeholder, "string",
      `--${flag} renders as <a value>, which says nothing about the pair it wants`);
    assert.match(row.placeholder, /epicId|what/,
      `--${flag}'s placeholder must name its left half`);
  }
});

// ───────── the DATA half of the call-site sweep: amendments[] holds an epic id ─────────

test("gh-178: removing an epic sweeps the amendment that names it — no dangling pointer", () => {
  const cwd = releaseRepo();
  run(["release", "1.0.0", "--unmember", "two:registered in error"], { cwd });
  const before = readState(cwd).releases.find(r => r.id === "1.0.0").amendments;
  assert.equal(before.length, 1, "the fixture must actually record the amendment");
  run(["remove-epic", "two"], { cwd });
  const rel = readState(cwd).releases.find(r => r.id === "1.0.0");
  assert.deepEqual(rel.amendments || [], [],
    "an amendment naming an epic that no longer exists renders a pointer to nothing — the same " +
    "dangling reference a release's deferred[] and disposition.superseded.carriedTo are swept for");
});

test("gh-178: amendments[] is enumerated by epicReferences(), not by a second removal rule", async () => {
  const { epicReferences } = await import(new URL("../../lib/links.mjs", import.meta.url).href);
  const state = {
    epics: [{ id: "gone" }],
    releases: [{ id: "1.0.0", deferred: [], amendments: [{ op: "unmember", epic: "gone", reason: "why" }] }],
  };
  const where = epicReferences(state).map(r => r.where);
  assert.ok(where.some(w => /amendments/.test(w)),
    "every field holding another record's id belongs to THE enumeration — a second removal rule " +
    "written beside remove-epic is how the first five came to be unswept");
});

// ───────── the read form has to be VISIBLE on the surface a reader looks at ─────────

test("gh-178: `release --help` names the read form, not only the seven flags", () => {
  const cwd = repo();
  const help = run(["release", "--help"], { cwd });
  assert.match(help, /release show/,
    "a verb whose surface is partly POSITIONAL needs help that says what the positionals are — " +
    "#159's complaint was answered by a release whose own --help never named the read form it " +
    "had just added");
});

test("gh-178: `release show` renders the cross-spec ⚠ in the SHARED wording, exactly once", () => {
  // A release the gate BINDS (two spec files) with nothing recorded — the branch where silence
  // and reviewed-and-clean must not look the same. The fixture is the one cross-spec-review's own
  // tests use: an openspec change carrying specs, registered as a member.
  const cwd = tmpRepo();
  const base = path.join(cwd, "openspec", "changes", "big-change");
  for (const cap of ["alpha", "beta"]) {
    fs.mkdirSync(path.join(base, "specs", cap), { recursive: true });
    fs.writeFileSync(path.join(base, "specs", cap, "spec.md"), "# spec\n");
  }
  fs.writeFileSync(path.join(base, "tasks.md"), "- [x] one\n");
  run(["init"], { cwd });
  run(["release", "rel", "--intent", "the release under test", "--member", "big-change"], { cwd });

  const out = run(["release", "show", "rel"], { cwd });
  assert.match(out, /⚠ no cross-spec review \(2 specs\)/,
    "the release-scope gate applies here and nothing was recorded — that must say so");
  assert.doesNotMatch(out, /cross-spec review:\s*·/,
    "a stray separator means the shared helper's output was string-stripped by a pattern that " +
    "matched only one of its three shapes");
  assert.equal((out.match(/cross-spec/g) || []).length, 1,
    "the label must not be rendered twice — one wording, one line");
});
