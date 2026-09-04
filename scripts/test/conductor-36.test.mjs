// 0.38.0 — the record says what actually happened.
//
// Three defects, one invariant: a write must be readable back, and a reported write must have
// happened. Grouped because a reviewer holds one idea across all three rather than three.
//
// #165a — `--declined-deferral "<what>:<why not>"` split on the FIRST colon, so a colon inside
//   <what> silently truncated it and dumped the remainder into the reason. Measured in the wild:
//   "Set alwaysLoad:false to reclaim RAM:declined because X" recorded what="Set alwaysLoad",
//   which reads as an instruction to DO the thing being declined — the opposite of the record's
//   meaning — and renders that way in PROJECT.md.
//
//   NEITHER split is safe for two free-text halves: first-colon breaks on a colon in <what>,
//   last-colon breaks on a colon in the reason, and reasons are sentences so they carry colons
//   MORE often. So the fix is not a better guess. `::` is the explicit separator, a single colon
//   keeps working unchanged, and an ambiguous value is REFUSED rather than truncated.
//
//   `--deferral` is deliberately NOT changed: its left half is an epic id, which cannot contain
//   a colon, so first-colon is correct there and the same rule would refuse valid input whose
//   <section> carries one. Verified before writing: `--deferral "t2:design.md § Deferred: the
//   tricky part"` already splits correctly.
//
// #165b — supplying a deferral flag WITHOUT archiving computed the assertion, dropped it, and
//   printed "updated". The assertion is written only inside the `status === "archived"` branch.
//   It is NOT immutable — verified: --status archived + --correct-disposition + the flags
//   overwrites it cleanly — the correction path was merely undiscoverable. So this refuses and
//   names that path, rather than inventing a second correction mechanism.
//
// #159 — `set-gate-guard` writes and nothing reads. `gate-guard` is the PreToolUse HOOK, whose
//   silence is the allow signal; printing a report on its stdout would corrupt the protocol.
//   The reader goes on the toggle instead, bare.
//
// #163 — a gate verdict was recordable only on an openspec-lane epic, while set-review-mode is
//   lane-agnostic and names "a Superpowers task review" in its own table. So pm told every lane
//   to run reviews and could record the verdict for one. The ARCHIVE GATE stays openspec-only.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRepo, run, readState, expectFail } from "./helpers.mjs";

/** The stderr of a refusal, plus an assertion that it WAS one. expectFail() returns the Error
 *  object execFileSync throws, not a string — matching a regex against that object silently
 *  fails, which cost a debugging round here. This also asserts a non-zero exit, so a refusal
 *  that printed its message and exited 0 could not pass. */
function refusal(fn) {
  const e = expectFail(fn);
  assert.ok(e, "expected a refusal, got a successful run");
  assert.notEqual(e.status, 0, "a refusal must exit non-zero");
  return (e.stderr || "") + (e.stdout || "");
}

const archived = (cwd, id, extra = []) =>
  run(["update-epic", id, "--status", "archived", "--outcome", "killed", "--reason", "r", ...extra], { cwd });

function repoWithEpic(id = "t1", lane = "claude-code") {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", id, "--title", "T", "--lane", lane], { cwd });
  return cwd;
}
const assertionOf = (cwd, id) => readState(cwd).epics.find(e => e.id === id).deferralAssertion;

// ═══════════════ #165a — the separator ═══════════════

test("a single colon still splits exactly as it always did", () => {
  const cwd = repoWithEpic();
  archived(cwd, "t1", ["--declined-deferral", "prose help per flag:not worth ~100 rows"]);
  assert.deepEqual(assertionOf(cwd, "t1").declined,
    [{ what: "prose help per flag", reason: "not worth ~100 rows" }]);
});

test("a colon inside <what> is REFUSED, not silently truncated", () => {
  const cwd = repoWithEpic();
  const err = refusal(() => archived(cwd, "t1",
    ["--declined-deferral", "Set alwaysLoad:false to reclaim RAM:declined because X"]));
  assert.match(err, /ambiguous/i, "the refusal must name the ambiguity");
  assert.match(err, /::/, "and must show the explicit separator");
  assert.equal(readState(cwd).epics.find(e => e.id === "t1").deferralAssertion, undefined,
    "a refusal must write nothing at all");
});

test("`::` is the explicit separator and keeps every colon in <what>", () => {
  const cwd = repoWithEpic();
  archived(cwd, "t1",
    ["--declined-deferral", "Set alwaysLoad:false to reclaim RAM::declined because X"]);
  assert.deepEqual(assertionOf(cwd, "t1").declined,
    [{ what: "Set alwaysLoad:false to reclaim RAM", reason: "declined because X" }]);
});

test("`::` splits on the FIRST `::`, so a reason may contain one", () => {
  const cwd = repoWithEpic();
  archived(cwd, "t1", ["--declined-deferral", "a:b::because c::d"]);
  assert.deepEqual(assertionOf(cwd, "t1").declined,
    [{ what: "a:b", reason: "because c::d" }]);
});

test("a value with no separator at all is refused rather than recorded reasonless", () => {
  // A declined deferral with no reason is the silence the record exists to remove — it was
  // previously accepted with reason: "".
  const cwd = repoWithEpic();
  const err = refusal(() => archived(cwd, "t1", ["--declined-deferral", "no separator here"]));
  assert.match(err, /separator|:/, "the refusal must name what is missing");
});

test("--deferral is UNCHANGED — its left half is an epic id and cannot carry a colon", () => {
  const cwd = repoWithEpic();
  run(["add-epic", "--id", "t2", "--title", "T2", "--lane", "claude-code"], { cwd });
  archived(cwd, "t1", ["--deferral", "t2:design.md § Deferred: the tricky part"]);
  assert.deepEqual(assertionOf(cwd, "t1").deferrals,
    [{ epic: "t2", section: "design.md § Deferred: the tricky part" }],
    "a colon in <section> is part of the section, not an ambiguity");
});

// ═══════════════ #165b — the silent no-op ═══════════════

test("a deferral flag without archiving is REFUSED, not reported as updated", () => {
  const cwd = repoWithEpic();
  archived(cwd, "t1", ["--no-deferrals"]);
  const before = JSON.stringify(assertionOf(cwd, "t1"));
  const err = refusal(() => run(["update-epic", "t1", "--declined-deferral", "a:b"], { cwd }));
  assert.match(err, /archiv/i, "the refusal must say when an assertion is recorded");
  assert.match(err, /correct-disposition/,
    "and must name the correction path, which exists and was merely undiscoverable");
  assert.equal(JSON.stringify(assertionOf(cwd, "t1")), before, "and must write nothing");
});

test("the correction path still works — this refusal must not close the only door", () => {
  const cwd = repoWithEpic();
  archived(cwd, "t1", ["--declined-deferral", "wrong what:wrong why"]);
  const first = assertionOf(cwd, "t1").assertedAt;
  run(["update-epic", "t1", "--status", "archived", "--outcome", "killed", "--reason", "r",
       "--correct-disposition", "the what half was wrong",
       "--declined-deferral", "right what:right why"], { cwd });
  const after = assertionOf(cwd, "t1");
  assert.deepEqual(after.declined, [{ what: "right what", reason: "right why" }]);
  assert.notEqual(after.assertedAt, first, "a correction re-asserts, so the timestamp moves");
});

// ═══════════════ #159 — the missing reader ═══════════════

test("bare `set-gate-guard` REPORTS the state instead of printing usage", () => {
  const cwd = repoWithEpic();
  run(["set-gate-guard", "on"], { cwd });
  const out = run(["set-gate-guard"], { cwd });
  assert.match(out, /on/i, "it must say what the flag is");
  assert.doesNotMatch(out, /^usage:/m, "a read is not a usage error");
});

test("the reader states what the value MEANS, and what it cannot tell you", () => {
  // `owners` is the model: state the value AND its limits. The non-obvious one here is that the
  // flag being on does not mean anything is currently blocked — which is exactly the conclusion
  // #159's reporter drew from `gateGuard: true` plus silence.
  const cwd = repoWithEpic();
  run(["set-gate-guard", "on"], { cwd });
  const out = run(["set-gate-guard"], { cwd });
  assert.match(out, /reconcile/i, "it must say which obligation the guard enforces");
  assert.match(out, /not|no epic|nothing/i,
    "it must say that 'on' alone does not mean something is currently blocked");
});

test("both values read back, and reading never writes", () => {
  const cwd = repoWithEpic();
  run(["set-gate-guard", "off"], { cwd });
  const before = fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8");
  const out = run(["set-gate-guard"], { cwd });
  assert.match(out, /off/i);
  assert.equal(fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8"), before,
    "the read surface must not write state");
});

test("an unknown argument is still refused — the reader must not swallow a typo", () => {
  const cwd = repoWithEpic();
  const err = refusal(() => run(["set-gate-guard", "maybe"], { cwd }));
  assert.match(err, /on\|off/);
});

// ═══════════════ #163 — verdicts beyond one lane ═══════════════

test("a gate verdict records on a non-openspec lane", () => {
  // The commit range is REQUIRED for a pass and always was (0.27.0's checkable-evidence rule).
  // That rule is lane-agnostic already, which is half the argument for this change: the engine
  // demanded verifiable evidence from a verdict it then refused to accept outside one lane.
  const cwd = repoWithEpic("sp1", "superpowers");
  run(["record-gate-review", "sp1", "--gate", "2", "--verdict", "pass",
       "--base-sha", "aaaaaaa", "--head-sha", "bbbbbbb",
       "--reviewer", "two fresh-context lenses"], { cwd });
  const g = readState(cwd).epics.find(e => e.id === "sp1").gateReview.gate2;
  assert.equal(g.verdict, "pass");
  assert.equal(g.reviewer, "two fresh-context lenses");
});

test("evidence shas record on a non-openspec lane too — the point is checkability", () => {
  const cwd = repoWithEpic("sp1", "superpowers");
  run(["record-gate-review", "sp1", "--gate", "2", "--verdict", "pass",
       "--base-sha", "aaaaaaa", "--head-sha", "bbbbbbb", "--reviewer", "r"], { cwd });
  const g = readState(cwd).epics.find(e => e.id === "sp1").gateReview.gate2;
  assert.equal(g.baseSha, "aaaaaaa");
  assert.equal(g.headSha, "bbbbbbb");
});

test("the ARCHIVE GATE stays openspec-only — recording a verdict must not add an obligation", () => {
  // The whole point of #163 is to let evidence be recorded where reviews happen, NOT to make a
  // superpowers epic un-archivable without one. A claude-code epic with no verdict at all must
  // archive exactly as it does today.
  const cwd = repoWithEpic("cc1", "claude-code");
  run(["update-epic", "cc1", "--status", "archived", "--outcome", "delivered",
       "--no-deferrals"], { cwd });
  assert.equal(readState(cwd).epics.find(e => e.id === "cc1").status, "archived");
});

test("an openspec-lane epic still cannot be delivered without a passing Gate 2", () => {
  const cwd = repoWithEpic("os1", "openspec");
  const err = refusal(() => run(["update-epic", "os1", "--status", "archived",
    "--outcome", "delivered", "--no-deferrals"], { cwd }));
  assert.match(err, /Gate 2/);
});

// ═══════════════ #166 — withdrawing an attribution ═══════════════

test("--withdraw-commit removes a sha the epic attributed, with a required reason", () => {
  // Found the hard way: a commit was attributed, then correctly undone with `git reset` because
  // its message described work it did not contain. `integrity` then reported a dangling sha
  // forever, and every escape was worse than the problem — hand-edit state.json (forbidden), tag
  // the orphan (makes a false record permanent and reachable), or remove-epic (destroys the
  // disposition, links and stories). A reset is a NORMAL git operation, and attributing at the
  // moment of each commit means an attribution can outlive its commit through no error of
  // process.
  const cwd = repoWithEpic();
  run(["update-epic", "t1", "--attribute-commit", "aaaaaaa"], { cwd });
  run(["update-epic", "t1", "--attribute-commit", "bbbbbbb"], { cwd });
  run(["update-epic", "t1", "--withdraw-commit", "aaaaaaa",
       "--reason", "the commit was reset; its message described work it did not contain"], { cwd });
  const e = readState(cwd).epics.find(x => x.id === "t1");
  assert.deepEqual(e.attributedCommits, ["bbbbbbb"], "the withdrawn sha is gone");
});

test("the withdrawal is RECORDED, not erased — a correction is a judgment", () => {
  const cwd = repoWithEpic();
  run(["update-epic", "t1", "--attribute-commit", "aaaaaaa"], { cwd });
  run(["update-epic", "t1", "--withdraw-commit", "aaaaaaa", "--reason", "reset away"], { cwd });
  const e = readState(cwd).epics.find(x => x.id === "t1");
  assert.equal(e.withdrawnCommits.length, 1);
  assert.equal(e.withdrawnCommits[0].sha, "aaaaaaa");
  assert.equal(e.withdrawnCommits[0].reason, "reset away");
  assert.ok(e.withdrawnCommits[0].withdrawnAt, "and when");
});

test("it lands in a SIBLING field, so the last attributed entry stays the Gate 2 endpoint", () => {
  // attributedCommits is append-only because ORDER carries meaning: the last entry is what a
  // recorded Gate 2 headSha is compared against. A withdrawn entry left in the array would move
  // that endpoint, so the record of the withdrawal goes beside it rather than inside it.
  const cwd = repoWithEpic();
  for (const sha of ["aaaaaaa", "bbbbbbb", "ccccccc"]) {
    run(["update-epic", "t1", "--attribute-commit", sha], { cwd });
  }
  run(["update-epic", "t1", "--withdraw-commit", "bbbbbbb", "--reason", "wrong epic"], { cwd });
  const e = readState(cwd).epics.find(x => x.id === "t1");
  assert.deepEqual(e.attributedCommits, ["aaaaaaa", "ccccccc"], "order of the survivors is kept");
  assert.equal(e.attributedCommits.at(-1), "ccccccc", "and the endpoint is unmoved");
});

test("withdrawing a sha the epic never attributed is REFUSED, not a silent no-op", () => {
  const cwd = repoWithEpic();
  run(["update-epic", "t1", "--attribute-commit", "aaaaaaa"], { cwd });
  const err = refusal(() => run(["update-epic", "t1", "--withdraw-commit", "ddddddd",
    "--reason", "r"], { cwd }));
  assert.match(err, /ddddddd/, "the refusal must name the sha it could not find");
  assert.deepEqual(readState(cwd).epics.find(x => x.id === "t1").attributedCommits, ["aaaaaaa"]);
});

test("a withdrawal without a reason is REFUSED — the same rule as every other correction", () => {
  const cwd = repoWithEpic();
  run(["update-epic", "t1", "--attribute-commit", "aaaaaaa"], { cwd });
  const err = refusal(() => run(["update-epic", "t1", "--withdraw-commit", "aaaaaaa"], { cwd }));
  assert.match(err, /reason/i);
  assert.deepEqual(readState(cwd).epics.find(x => x.id === "t1").attributedCommits, ["aaaaaaa"]);
});

test("--withdraw-commit repeats, so one reset can be undone across its epics in one call", () => {
  const cwd = repoWithEpic();
  for (const sha of ["aaaaaaa", "bbbbbbb", "ccccccc"]) {
    run(["update-epic", "t1", "--attribute-commit", sha], { cwd });
  }
  run(["update-epic", "t1", "--withdraw-commit", "aaaaaaa", "--withdraw-commit", "ccccccc",
       "--reason", "both reset away"], { cwd });
  assert.deepEqual(readState(cwd).epics.find(x => x.id === "t1").attributedCommits, ["bbbbbbb"]);
});
