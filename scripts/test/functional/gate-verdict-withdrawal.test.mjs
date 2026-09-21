// gate-verdict-withdrawal — `update-epic <id> --withdraw-gate-review <1|2> --withdrawal-reason
// "<why>"` moves a recorded verdict out of `gateReview.gateN` into `withdrawnGateReviews[]`, and
// the WITHDRAWN state is reported as withdrawn on every surface, never as absent.
//
// Every refusal here asserts `state.json` BYTE-IDENTICAL and the refusal's CAUSE, never only a
// non-zero exit: an unknown-flag refusal would satisfy an exit-code assertion as well.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import * as constants from "../../lib/constants.mjs";
import { ENGINE, EMPTY_CACHE, tmpRepo, run, readState, parseBrief, gitInitWithCommit, commitFiles, fixtureCommits } from "../fixtures/functional-harness.mjs";

const stateFile = (cwd) => path.join(cwd, ".conductor", "state.json");
const stateBytes = (cwd) => fs.readFileSync(stateFile(cwd));
const epicOf = (cwd, id) => readState(cwd).epics.find(e => e.id === id);

/** Run the engine WITHOUT throwing, so a test can read the exit code and both streams. */
function attempt(cwd, args) {
  const r = spawnSync("node", [ENGINE, ...args], {
    cwd, encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: cwd, PM_CACHE_ROOT: EMPTY_CACHE },
  });
  return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}

/** Assert a refusal that wrote nothing, and hand back what it printed. */
function refused(cwd, args) {
  const before = stateBytes(cwd);
  const r = attempt(cwd, args);
  assert.notEqual(r.status, 0, `expected a refusal, got exit 0.\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
  assert.ok(stateBytes(cwd).equals(before), "a refused invocation must leave state.json byte-identical");
  return r;
}

/** Assert an accepted invocation, and hand back what it printed. */
function accepted(cwd, args) {
  const r = attempt(cwd, args);
  assert.equal(r.status, 0, `expected exit 0.\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
  return r;
}

// ═══════════════ withdrawnGate(epic, n) — the one definition of the withdrawn state ═══════════════

const withdrawal = (gate, reason, at = "2026-09-14T00:00:00.000Z") =>
  ({ gate, entry: { verdict: "pass", reviewedAt: "2026-09-13T00:00:00.000Z" }, reason, withdrawnAt: at });

test("2.2 withdrawnGate: an absent entry with a withdrawal answers the LATEST withdrawal", () => {
  const e = { id: "e", gateReview: {}, withdrawnGateReviews: [
    withdrawal(2, "first", "2026-09-14T00:00:00.000Z"),
    withdrawal(1, "gate one"),
    withdrawal(2, "second", "2026-09-14T01:00:00.000Z"),
  ] };
  assert.equal(constants.withdrawnGate(e, 2).reason, "second");
  assert.equal(constants.withdrawnGate(e, 1).reason, "gate one");
  assert.equal(constants.withdrawnGate({ id: "e", withdrawnGateReviews: [withdrawal(2, "no gateReview object")] }, 2).reason,
    "no gateReview object", "an epic with no gateReview object at all has no stored verdict");
});

test("2.2 withdrawnGate: a stored pass with a withdrawal in its history is NOT withdrawn", () => {
  const e = { id: "e", gateReview: { gate2: { verdict: "pass", reviewedAt: "x" } }, withdrawnGateReviews: [withdrawal(2, "r")] };
  assert.equal(constants.withdrawnGate(e, 2), null);
});

test("2.2 withdrawnGate: a stored ungated with a withdrawal in its history is NOT withdrawn", () => {
  const e = { id: "e", gateReview: { gate2: { verdict: "ungated", reviewedAt: "x" } }, withdrawnGateReviews: [withdrawal(2, "r")] };
  assert.equal(constants.withdrawnGate(e, 2), null);
});

test("2.2 withdrawnGate: no withdrawal is not withdrawn", () => {
  assert.equal(constants.withdrawnGate({ id: "e" }, 2), null);
  assert.equal(constants.withdrawnGate({ id: "e", gateReview: {}, withdrawnGateReviews: [] }, 1), null);
  assert.equal(constants.withdrawnGate({ id: "e", withdrawnGateReviews: [withdrawal(1, "other gate")] }, 2), null);
});

// ═══════════════ the withdrawal write ═══════════════

/** A Gate 2 pass over a real base..head pair. --base-sha/--head-sha resolve at write time, so the
 *  pair is a linear chain of fixture commits made once per repository and reused on every
 *  re-recording there — the same two values each time, as the former literal pair was. */
const pass2Commits = new Map();
function pass2(cwd) {
  if (!pass2Commits.has(cwd)) pass2Commits.set(cwd, fixtureCommits(cwd, ["gate-2 base", "gate-2 head"]));
  const [base, head] = pass2Commits.get(cwd);
  return ["--gate", "2", "--verdict", "pass", "--base-sha", base, "--head-sha", head];
}
const PASS1 = ["--gate", "1", "--verdict", "pass", "--artifact", "openspec/changes/x/proposal.md"];

/** An initialized repository holding one claude-code epic `id` (no task source, so no archive
 *  obligation interferes) carrying the verdicts named. */
function withVerdicts(id = "w", { gate1 = false, gate2 = true, lane = "claude-code" } = {}) {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", id, "--lane", lane], { cwd });
  if (gate1) run(["record-gate-review", id, ...PASS1], { cwd });
  if (gate2) run(["record-gate-review", id, ...pass2(cwd)], { cwd });
  return cwd;
}

test("2.3 withdrawing a Gate 2 pass moves the whole entry to withdrawnGateReviews", () => {
  const cwd = withVerdicts("w23");
  const stored = epicOf(cwd, "w23").gateReview.gate2;
  accepted(cwd, ["update-epic", "w23", "--withdraw-gate-review", "2", "--withdrawal-reason", "recorded on the tracker mirror"]);
  const e = epicOf(cwd, "w23");
  assert.ok(!("gate2" in e.gateReview), "gateReview.gate2 is absent after the withdrawal");
  const last = e.withdrawnGateReviews.at(-1);
  assert.equal(last.gate, 2);
  assert.equal(last.reason, "recorded on the tracker mirror");
  assert.ok(!Number.isNaN(Date.parse(last.withdrawnAt)), `withdrawnAt is a timestamp: ${last.withdrawnAt}`);
  assert.deepEqual(last.entry, stored, "the entry is the verdict exactly as it was stored");
});

test("2.4 a Gate 1 carrying superseded moves whole, and nothing is promoted", () => {
  const cwd = withVerdicts("w24", { gate1: true, gate2: false });
  run(["record-gate-review", "w24", "--gate", "1", "--verdict", "fail"], { cwd });
  const stored = epicOf(cwd, "w24").gateReview.gate1;
  assert.ok(stored.superseded, "precondition: the stored Gate 1 carries a superseded entry");
  accepted(cwd, ["update-epic", "w24", "--withdraw-gate-review", "1", "--withdrawal-reason", "x"]);
  const e = epicOf(cwd, "w24");
  assert.ok(!("gate1" in e.gateReview), "the superseded entry is NOT promoted to the stored verdict");
  assert.deepEqual(e.withdrawnGateReviews.at(-1).entry, stored);
  assert.deepEqual(e.withdrawnGateReviews.at(-1).entry.superseded, stored.superseded);
});

test("2.5 withdrawing one gate leaves the other deep-equal", () => {
  const cwd = withVerdicts("w25", { gate1: true, gate2: true });
  const gate2 = epicOf(cwd, "w25").gateReview.gate2;
  accepted(cwd, ["update-epic", "w25", "--withdraw-gate-review", "1", "--withdrawal-reason", "x"]);
  assert.deepEqual(epicOf(cwd, "w25").gateReview.gate2, gate2);
});

test("2.6 --withdraw-gate-review repeats: both gates withdrawn in one call, two entries", () => {
  const cwd = withVerdicts("w26", { gate1: true, gate2: true });
  const before = epicOf(cwd, "w26").withdrawnGateReviews || [];
  accepted(cwd, ["update-epic", "w26", "--withdraw-gate-review", "1", "--withdraw-gate-review", "2", "--withdrawal-reason", "x"]);
  const e = epicOf(cwd, "w26");
  assert.ok(!("gate1" in e.gateReview) && !("gate2" in e.gateReview), `both gates are absent: ${JSON.stringify(e.gateReview)}`);
  const added = e.withdrawnGateReviews.slice(before.length);
  assert.equal(added.length, 2, "exactly two entries were added");
  assert.deepEqual(added.map(w => w.gate).sort(), [1, 2]);
  assert.ok(added.every(w => w.reason === "x"));
});

test("2.7 re-recording after a withdrawal starts clean, and the withdrawal is kept", () => {
  const cwd = withVerdicts("w27");
  accepted(cwd, ["update-epic", "w27", "--withdraw-gate-review", "2", "--withdrawal-reason", "x"]);
  run(["record-gate-review", "w27", ...pass2(cwd)], { cwd });
  const e = epicOf(cwd, "w27");
  assert.equal(e.gateReview.gate2.verdict, "pass");
  assert.ok(!("superseded" in e.gateReview.gate2), "the re-recorded verdict supersedes nothing");
  assert.equal(e.withdrawnGateReviews.length, 1);
  assert.equal(e.withdrawnGateReviews[0].reason, "x");
});

test("2.8 the read-back: a state still carrying the verdict, or lacking the entry, did NOT land", async () => {
  const { missingGateWithdrawals } = await import("../../lib/update-epic.mjs");
  const at = "2026-09-14T00:00:00.000Z";
  const asked = [{ gate: 2, reason: "r", withdrawnAt: at }];
  const landed = { epics: [{ id: "e", gateReview: {}, withdrawnGateReviews: [{ gate: 2, entry: {}, reason: "r", withdrawnAt: at }] }] };
  assert.deepEqual(missingGateWithdrawals(landed, "e", asked), []);
  const stillStored = { epics: [{ id: "e", gateReview: { gate2: { verdict: "pass" } },
    withdrawnGateReviews: [{ gate: 2, entry: {}, reason: "r", withdrawnAt: at }] }] };
  assert.deepEqual(missingGateWithdrawals(stillStored, "e", asked), [2], "a verdict still stored did not land");
  const noEntry = { epics: [{ id: "e", gateReview: {} }] };
  assert.deepEqual(missingGateWithdrawals(noEntry, "e", asked), [2], "no withdrawal entry did not land");
  const otherReason = { epics: [{ id: "e", gateReview: {}, withdrawnGateReviews: [{ gate: 2, entry: {}, reason: "old", withdrawnAt: at }] }] };
  assert.deepEqual(missingGateWithdrawals(otherReason, "e", asked), [2], "an entry with another reason is not this one");
  assert.deepEqual(missingGateWithdrawals({ epics: [] }, "e", asked), [2], "an absent epic holds nothing");
});

// ═══════════════ refusals — each supplies every other input valid ═══════════════

/** An openspec-lane epic the archive-drift heal archived with no verdict: registered by `sync`
 *  from a change directory, which is then moved under `archive/` and healed by a second `sync`.
 *  The only producer of an `ungated` Gate 2. */
function healArchived(cwd, id, { beforeArchive } = {}) {
  fs.mkdirSync(path.join(cwd, "openspec", "changes", id), { recursive: true });
  fs.writeFileSync(path.join(cwd, "openspec", "changes", id, "tasks.md"), "# tasks\n\n- [x] a\n");
  run(["sync"], { cwd });
  if (beforeArchive) beforeArchive();
  fs.mkdirSync(path.join(cwd, "openspec", "changes", "archive"), { recursive: true });
  fs.renameSync(path.join(cwd, "openspec", "changes", id),
    path.join(cwd, "openspec", "changes", "archive", `2026-09-14-${id}`));
  run(["sync"], { cwd });
}

test("3.1 --withdrawal-reason with neither withdrawal flag is refused, naming both, before state is read", () => {
  const cwd = withVerdicts("r31");
  const r = refused(cwd, ["update-epic", "r31", "--withdrawal-reason", "x"]);
  assert.match(r.stderr, /--withdraw-gate-review/);
  assert.match(r.stderr, /--withdraw-commit/);
  const early = refused(cwd, ["update-epic", "no-such-epic", "--withdrawal-reason", "x"]);
  assert.doesNotMatch(early.stderr, /not found/, "the refusal runs before the epic is looked up in state");
  assert.match(early.stderr, /--withdraw-gate-review/);
});

test("3.2 --withdraw-gate-review without a reason is refused, naming --withdrawal-reason", () => {
  const cwd = withVerdicts("r32");
  const r = refused(cwd, ["update-epic", "r32", "--withdraw-gate-review", "2"]);
  assert.match(r.stderr, /--withdrawal-reason/);
  assert.doesNotMatch(r.stderr, /unknown flag/);
});

test("3.3 a gate other than 1 or 2 is refused, naming the valid values", () => {
  const cwd = withVerdicts("r33", { gate1: true, gate2: true });
  for (const bad of ["3", "0", "x"]) {
    const r = refused(cwd, ["update-epic", "r33", "--withdraw-gate-review", bad, "--withdrawal-reason", "x"]);
    assert.match(r.stderr, /--withdraw-gate-review must be one of 1\|2/, `gate ${bad}: ${r.stderr}`);
  }
});

test("3.3a a padded or multi-line gate value is refused with nothing written, never trimmed into a partial write", () => {
  // Gate 2 (both lenses): the refusals trimmed " 2" to "2" while the write re-read the raw value,
  // so the key became `gate 2`, the verdict stayed stored, and an entry-less withdrawal was saved
  // before the read-back exited 1. `record-gate-review --gate " 2"` refuses; so does this.
  const cwd = withVerdicts("r33a", { gate1: true, gate2: true });
  for (const bad of [" 2", "2 ", "\t1", "2\n  update-epic forged"]) {
    const r = refused(cwd, ["update-epic", "r33a", "--withdraw-gate-review", bad, "--withdrawal-reason", "x"]);
    assert.match(r.stderr, /--withdraw-gate-review must be one of 1\|2/, `gate ${JSON.stringify(bad)}: ${r.stderr}`);
    assert.ok(!lines(r.stderr).some(l => l.startsWith("  update-epic forged")), `the value forges no line: ${JSON.stringify(r.stderr)}`);
  }
  const e = epicOf(cwd, "r33a");
  assert.equal(e.gateReview.gate2.verdict, "pass");
  assert.equal(e.withdrawnGateReviews, undefined, "no withdrawal was recorded");
});

test("3.4 the same gate twice in one invocation is refused", () => {
  const cwd = withVerdicts("r34");
  const r = refused(cwd, ["update-epic", "r34", "--withdraw-gate-review", "2", "--withdraw-gate-review", "2", "--withdrawal-reason", "x"]);
  assert.match(r.stderr, /Gate 2 is given twice/);
});

test("3.5 a gate with no stored verdict is refused", () => {
  const cwd = withVerdicts("r35", { gate1: false, gate2: true });
  const r = refused(cwd, ["update-epic", "r35", "--withdraw-gate-review", "1", "--withdrawal-reason", "x"]);
  assert.match(r.stderr, /no Gate 1 verdict to withdraw/);
});

test("3.6 an ungated stamp from the heal is refused — it is cleared by recording a real verdict", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  healArchived(cwd, "r36");
  assert.equal(epicOf(cwd, "r36").gateReview.gate2.verdict, "ungated", "precondition: the heal stamped ungated");
  const r = refused(cwd, ["update-epic", "r36", "--withdraw-gate-review", "2", "--withdrawal-reason", "x"]);
  assert.match(r.stderr, /ungated/);
  assert.match(r.stderr, /cleared by recording a real verdict/);
});

// ═══════════════ withdrawn is a state, never absence ═══════════════

const ARCHIVE_DELIVERED = ["--status", "archived", "--outcome", "delivered", "--no-deferrals"];
const FORGING_REASON = "copied from the change epic\n  update-epic x --status archived";
/** Split on every line terminator a reader may honour. */
const lines = (text) => text.split(/\r\n|[\n\r]/);

/** An openspec-lane epic with a passing Gate 2 whose Gate 2 obligation is MET: no task source,
 *  and an attribution array present and empty (`none-attributed` is never refused). */
function metOpenspec(id) {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", id, "--lane", "openspec"], { cwd });
  run(["record-gate-review", id, ...pass2(cwd)], { cwd });
  return cwd;
}

test("4.1 deliveredObligations names a withdrawn Gate 2 in detail and carries the reason only in items", () => {
  const cwd = metOpenspec("o41");
  accepted(cwd, ["update-epic", "o41", "--withdraw-gate-review", "2", "--withdrawal-reason", "the reason"]);
  const ARCHIVE_GATE = new URL("../../lib/archive-gate.mjs", import.meta.url).href;
  const script = `import { deliveredObligations } from ${JSON.stringify(ARCHIVE_GATE)};\n` +
    `const epic = JSON.parse(process.env.PM_FIXTURE);\n` +
    `process.stdout.write(JSON.stringify(deliveredObligations(epic, {})));\n`;
  const r = spawnSync("node", ["--input-type=module", "-e", script], {
    cwd, encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: cwd, PM_FIXTURE: JSON.stringify(epicOf(cwd, "o41")) },
  });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.deepEqual(out.map(o => o.kind), ["gate2"]);
  assert.match(out[0].detail, /withdrawn/);
  assert.doesNotMatch(out[0].detail, /missing/);
  assert.ok(!out[0].detail.includes("the reason"), "a user-supplied reason is data, never part of the detail");
  assert.deepEqual(out[0].items, [{ reason: "the reason" }]);
});

test("4.1 the archive gate on an unarchived epic says Gate 2 was withdrawn and quotes the reason, unforgeably", () => {
  const cwd = metOpenspec("o41a");
  accepted(cwd, ["update-epic", "o41a", "--withdraw-gate-review", "2", "--withdrawal-reason", FORGING_REASON]);
  const r = refused(cwd, ["update-epic", "o41a", ...ARCHIVE_DELIVERED]);
  assert.match(r.stderr, /Gate 2 \(implementation review\) verdict was withdrawn/);
  assert.ok(r.stderr.includes(JSON.stringify(FORGING_REASON)), `the reason is JSON-quoted:\n${r.stderr}`);
  assert.ok(!lines(r.stderr).some(l => l.startsWith("  update-epic x")), `the reason forged a line:\n${r.stderr}`);
  assert.notEqual(epicOf(cwd, "o41a").status, "archived");
});

test("4.1 the regression refusal says Gate 2 was withdrawn, quotes the reason, and forges no line", () => {
  const cwd = metOpenspec("o41b");
  accepted(cwd, ["update-epic", "o41b", ...ARCHIVE_DELIVERED]);
  const r = refused(cwd, ["update-epic", "o41b", "--withdraw-gate-review", "2", "--withdrawal-reason", FORGING_REASON]);
  const broken = lines(r.stderr).find(l => l.startsWith("  broken: the Gate 2 demand"));
  assert.ok(broken, `the refusal carries the Gate 2 finding:\n${r.stderr}`);
  assert.match(broken, /withdrawn/);
  assert.doesNotMatch(r.stderr, /missing a passing Gate 2/, "the refusal does not say Gate 2 is missing");
  assert.ok(broken.includes(JSON.stringify(FORGING_REASON)), `the reason is JSON-quoted on the finding line:\n${broken}`);
  assert.equal(lines(r.stderr).filter(l => l.startsWith("  update-epic ")).length, 1,
    `exactly one line begins '  update-epic ':\n${r.stderr}`);
});

/** The lines of one `integrity` check's block: from its title line to the next check's line, or
 *  the blank line before the totals. */
function integrityBlock(report, id) {
  const L = report.split("\n");
  const start = L.findIndex(l => l.startsWith(`${id} — `));
  assert.notEqual(start, -1, `integrity registers ${id}:\n${report}`);
  let end = start + 1;
  while (end < L.length && L[end].startsWith("  ")) end++;
  return L.slice(start, end);
}

test("4.2 archived-openspec-epic-with-no-gate-1 names a withdrawn Gate 1 and quotes its reason", () => {
  const cwd = metOpenspec("o42");
  run(["record-gate-review", "o42", ...PASS1], { cwd });
  accepted(cwd, ["update-epic", "o42", ...ARCHIVE_DELIVERED]);
  accepted(cwd, ["update-epic", "o42", "--withdraw-gate-review", "1", "--withdrawal-reason", "reviewed another change"]);
  const block = integrityBlock(run(["integrity"], { cwd }), "archived-openspec-epic-with-no-gate-1");
  const finding = block.find(l => l.includes("`o42`"));
  assert.ok(finding, `the check reports o42:\n${block.join("\n")}`);
  assert.match(finding, /Gate 1 \(spec review\) verdict was withdrawn/);
  assert.ok(finding.includes(JSON.stringify("reviewed another change")), finding);
});

/** PROJECT.md's gate table, as `{id: {gate1, gate2}}` in row order. */
function projectGateTable(cwd) {
  const md = fs.readFileSync(path.join(cwd, "PROJECT.md"), "utf8").split("\n");
  const start = md.indexOf("## Gate reviews");
  if (start === -1) return {};
  const rows = {};
  for (const l of md.slice(start + 1)) {
    if (l.startsWith("## ")) break;
    const m = l.match(/^\| `([^`]+)` \| (.*) \| (.*) \|$/);
    if (m) rows[m[1]] = { gate1: m[2], gate2: m[3] };
  }
  return rows;
}

/** The brief's GATE REVIEWS block, as `{id: {gate1, gate2}}`. */
function briefGateTable(cwd) {
  const L = parseBrief(cwd).split("\n");
  const start = L.indexOf("GATE REVIEWS:");
  if (start === -1) return {};
  const rows = {};
  for (const l of L.slice(start + 1)) {
    if (!l.trim()) break;
    const m = l.match(/^ {2}• `([^`]+)` gate 1: (.*) · gate 2: (.*)$/);
    if (m) rows[m[1]] = { gate1: m[2], gate2: m[3] };
  }
  return rows;
}

test("4.4 PROJECT.md and the brief show one withdrawn gate as withdrawn — <reason>", () => {
  const cwd = withVerdicts("t441", { gate1: true, gate2: true });
  accepted(cwd, ["update-epic", "t441", "--withdraw-gate-review", "2", "--withdrawal-reason", "on the wrong epic"]);
  for (const [surface, table] of [["PROJECT.md", projectGateTable(cwd)], ["brief", briefGateTable(cwd)]]) {
    assert.ok(table.t441, `${surface} lists t441 by its id: ${JSON.stringify(table)}`);
    assert.equal(table.t441.gate2, "withdrawn — on the wrong epic", surface);
    assert.match(table.t441.gate1, /^pass /, `${surface} keeps Gate 1's verdict`);
  }
});

test("4.4 PROJECT.md and the brief keep an epic whose every gate is withdrawn", () => {
  const cwd = withVerdicts("t442", { gate1: true, gate2: true });
  accepted(cwd, ["update-epic", "t442", "--withdraw-gate-review", "1", "--withdraw-gate-review", "2", "--withdrawal-reason", "both copied"]);
  for (const [surface, table] of [["PROJECT.md", projectGateTable(cwd)], ["brief", briefGateTable(cwd)]]) {
    assert.deepEqual(table.t442, { gate1: "withdrawn — both copied", gate2: "withdrawn — both copied" }, surface);
  }
});

test("4.4 PROJECT.md and the brief agree on the gate table: same ids, same cell text", () => {
  const cwd = withVerdicts("stored", { gate1: true, gate2: true });
  run(["add-epic", "--id", "withdrawn", "--lane", "claude-code"], { cwd });
  run(["record-gate-review", "withdrawn", ...pass2(cwd)], { cwd });
  run(["add-epic", "--id", "absent", "--lane", "claude-code"], { cwd });
  run(["add-epic", "--id", "half", "--lane", "claude-code"], { cwd });
  run(["record-gate-review", "half", ...PASS1], { cwd });
  run(["record-gate-review", "half", ...pass2(cwd)], { cwd });
  accepted(cwd, ["update-epic", "withdrawn", "--withdraw-gate-review", "2", "--withdrawal-reason", "gone"]);
  accepted(cwd, ["update-epic", "half", "--withdraw-gate-review", "1", "--withdrawal-reason", "half gone"]);
  const project = projectGateTable(cwd), brief = briefGateTable(cwd);
  const ids = Object.keys(project);
  assert.ok(ids.every(id => typeof id === "string" && id !== "undefined" && id.length), `real ids: ${ids}`);
  assert.deepEqual(ids.sort(), Object.keys(brief).sort(), "both surfaces list the same epics");
  assert.deepEqual(ids.sort(), ["half", "stored", "withdrawn"]);
  for (const id of ids) assert.deepEqual(brief[id], project[id], `the cells for ${id} are identical on both surfaces`);
});

test("4.5 diffEvents emits gate-withdrawn on GROWTH of withdrawnGateReviews, and nothing for a bare removal", async () => {
  const { diffEvents } = await import("../../lib/activity-log.mjs");
  const verdict = { verdict: "pass", reviewedAt: "2026-09-14T00:00:00.000Z" };
  const epic = (over) => ({ id: "a45", title: "a45", status: "queued", lane: "openspec", ...over });
  const before = { revision: 1, epics: [epic({ gateReview: { gate1: verdict, gate2: verdict } })] };
  const withdrawn = { revision: 2, epics: [epic({ gateReview: { gate1: verdict },
    withdrawnGateReviews: [{ gate: 2, entry: verdict, reason: "r", withdrawnAt: "2026-09-14T01:00:00.000Z" }] })] };
  const events = diffEvents(before, withdrawn, { verb: "update-epic" }).filter(e => e.kind === "gate-withdrawn");
  assert.equal(events.length, 1, JSON.stringify(events));
  assert.equal(events[0].epic, "a45");
  assert.equal(events[0].gate, "gate2");

  const bareRemoval = { revision: 2, epics: [epic({ gateReview: { gate1: verdict } })] };
  assert.deepEqual(diffEvents(before, bareRemoval, {}).filter(e => e.kind === "gate-withdrawn"), [],
    "a verdict disappearing without a withdrawal record is not logged as a withdrawal");
});

test("4.6 the activity report's GATES section lists a withdrawal made through update-epic", () => {
  const cwd = withVerdicts("a46");
  run(["set-activity-log", "on"], { cwd });
  accepted(cwd, ["update-epic", "a46", "--withdraw-gate-review", "2", "--withdrawal-reason", "x"]);
  const report = run(["activity"], { cwd }).split("\n");
  const start = report.findIndex(l => l.startsWith("GATES"));
  assert.notEqual(start, -1);
  const block = [];
  for (const l of report.slice(start + 1)) { if (!l.trim()) break; block.push(l); }
  const hits = block.filter(l => /a46 {2}gate2 withdrawn/.test(l));
  assert.equal(hits.length, 1, `exactly one withdrawal listed:\n${block.join("\n")}`);
});

// ═══════════════ the heal and the standing condition ═══════════════

/** The heal route: an openspec-lane epic registered from a change directory records Gate 2 and
 *  withdraws it while OPEN; the change is then archived on disk and a mutating verb heals it. */
function healedWithdrawn(id, reason = "copied from the change epic", { heal = true } = {}) {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const archive = () => {
    fs.mkdirSync(path.join(cwd, "openspec", "changes", "archive"), { recursive: true });
    fs.renameSync(path.join(cwd, "openspec", "changes", id),
      path.join(cwd, "openspec", "changes", "archive", `2026-09-14-${id}`));
  };
  fs.mkdirSync(path.join(cwd, "openspec", "changes", id), { recursive: true });
  fs.writeFileSync(path.join(cwd, "openspec", "changes", id, "tasks.md"), "# tasks\n\n- [x] a\n");
  run(["sync"], { cwd });
  run(["record-gate-review", id, ...pass2(cwd)], { cwd });
  accepted(cwd, ["update-epic", id, "--withdraw-gate-review", "2", "--withdrawal-reason", reason]);
  archive();
  if (heal) run(["sync"], { cwd });
  return cwd;
}

test("5.1 the heal does not stamp ungated over a withdrawn Gate 2", () => {
  const cwd = healedWithdrawn("h51");
  const e = epicOf(cwd, "h51");
  assert.equal(e.status, "archived");
  assert.equal(e.disposition.outcome, "unknown");
  assert.equal(e.disposition.recordedBy, "archive-drift-heal");
  assert.ok(!("gate2" in (e.gateReview || {})), `no ungated entry is written: ${JSON.stringify(e.gateReview)}`);
  assert.equal(e.withdrawnGateReviews.length, 1, "the withdrawal is untouched");
});

test("5.2 the heal is unchanged where nothing was withdrawn", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  healArchived(cwd, "h52");
  const e = epicOf(cwd, "h52");
  assert.deepEqual(Object.keys(e.gateReview.gate2).sort(), ["recordedBy", "reviewedAt", "verdict"]);
  assert.equal(e.gateReview.gate2.verdict, "ungated");
  assert.equal(e.gateReview.gate2.recordedBy, "archive-drift-heal");
  assert.equal(e.disposition.outcome, "unknown");
  assert.equal(e.disposition.recordedBy, "archive-drift-heal");
  assert.ok(!("withdrawnGateReviews" in e));
});

const NO_REVIEW = /no (gate 2 )?review/i;

/** The brief block enclosing the withdrawn-kind entry for `id`: from the nearest NON-INDENTED line
 *  above it (brief blocks are blank-delimited with unindented headings) to the next blank line. */
function briefWithdrawnBlock(brief, id) {
  const L = brief.split("\n");
  const at = L.findIndex(l => l.startsWith("  ⚠") && l.includes(`\`${id}\``) && /withdrawn/.test(l));
  assert.notEqual(at, -1, `the brief names ${id} as withdrawn:\n${brief}`);
  let start = at;
  while (start > 0 && /^\s/.test(L[start])) start--;
  let end = at;
  while (end < L.length && L[end].trim()) end++;
  return L.slice(start, end);
}

/** An archived `delivered` openspec epic whose Gate 2 `fail` was recorded after archive, then
 *  withdrawn — a verb route to the withdrawn kind that needs no heal. */
function archivedFailedThenWithdrawn(id, reason) {
  const cwd = metOpenspec(id);
  accepted(cwd, ["update-epic", id, ...ARCHIVE_DELIVERED]);
  run(["record-gate-review", id, "--gate", "2", "--verdict", "fail"], { cwd });
  accepted(cwd, ["update-epic", id, "--withdraw-gate-review", "2", "--withdrawal-reason", reason]);
  return cwd;
}

/** Assert both surfaces name `id` under the withdrawn kind, quote `reason`, and say no review is missing. */
function assertNamedWithdrawn(cwd, id, reason) {
  const report = run(["integrity"], { cwd });
  const block = integrityBlock(report, "archived-with-withdrawn-gate-2");
  const finding = block.find(l => l.includes(`\`${id}\``));
  assert.ok(finding, `integrity names ${id} under archived-with-withdrawn-gate-2:\n${block.join("\n")}`);
  assert.match(finding, /withdrawn/);
  assert.ok(finding.includes(JSON.stringify(reason)), `integrity quotes the reason:\n${finding}`);
  for (const l of block) assert.doesNotMatch(l, NO_REVIEW, `the integrity block says no review was recorded: ${l}`);
  assert.ok(!integrityBlock(report, "archived-with-no-gate-2-review").some(l => l.includes(`\`${id}\``)),
    "the ungated check does not name a withdrawn Gate 2");
  const brief = briefWithdrawnBlock(parseBrief(cwd), id);
  assert.ok(brief.some(l => l.includes(JSON.stringify(reason))), `the brief quotes the reason:\n${brief.join("\n")}`);
  for (const l of brief) assert.doesNotMatch(l, NO_REVIEW, `the brief block says no review was recorded: ${l}`);
  // The ungated heading must not ENCLOSE the epic either (Gate 2 lens 1: listing withdrawn epics under
  // "UNGATED ARCHIVES (archived with no Gate 2 review…)" passed every other assertion).
  const B = parseBrief(cwd).split("\n");
  const ungatedAt = B.findIndex(l => l.startsWith("UNGATED ARCHIVES"));
  if (ungatedAt !== -1) {
    let end = ungatedAt + 1;
    while (end < B.length && B[end].trim()) end++;
    assert.ok(!B.slice(ungatedAt, end).some(l => l.includes(`\`${id}\``)),
      `the brief lists ${id} under the ungated heading:\n${B.slice(ungatedAt, end).join("\n")}`);
  }
  return { finding, brief };
}

test("5.3 the withdrawn kind is its own integrity check and brief heading, worded as withdrawn", () => {
  const cwd = archivedFailedThenWithdrawn("s53", "the fail was recorded on the wrong epic");
  assertNamedWithdrawn(cwd, "s53", "the fail was recorded on the wrong epic");
});

test("5.8 a withdrawn entry that superseded an ungated stamp says so, and survives a second withdrawal", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  healArchived(cwd, "s58");
  assert.equal(epicOf(cwd, "s58").gateReview.gate2.verdict, "ungated", "precondition: the heal stamped ungated");
  run(["record-gate-review", "s58", ...pass2(cwd)], { cwd });
  accepted(cwd, ["update-epic", "s58", "--withdraw-gate-review", "2", "--withdrawal-reason", "first"]);
  const once = assertNamedWithdrawn(cwd, "s58", "first");
  assert.match(once.finding, /archived ungated/, `integrity says archived ungated:\n${once.finding}`);
  assert.ok(once.brief.some(l => /archived ungated/.test(l)), `the brief says archived ungated:\n${once.brief.join("\n")}`);

  run(["record-gate-review", "s58", ...pass2(cwd)], { cwd });
  accepted(cwd, ["update-epic", "s58", "--withdraw-gate-review", "2", "--withdrawal-reason", "second"]);
  assert.ok(!epicOf(cwd, "s58").withdrawnGateReviews.at(-1).entry.superseded, "precondition: the latest entry holds no ungated stamp");
  const twice = assertNamedWithdrawn(cwd, "s58", "second");
  assert.match(twice.finding, /archived ungated/);
  assert.ok(twice.brief.some(l => /archived ungated/.test(l)));
});

/** Assert neither surface names `id` under either kind of the standing condition. */
function assertNotNamed(cwd, id) {
  const report = run(["integrity"], { cwd });
  for (const check of ["archived-with-withdrawn-gate-2", "archived-with-no-gate-2-review"]) {
    assert.ok(!integrityBlock(report, check).some(l => l.includes(`\`${id}\``)), `${check} names ${id}`);
  }
  const brief = parseBrief(cwd).split("\n");
  assert.ok(!brief.some(l => l.startsWith("  ⚠") && l.includes(`\`${id}\``)), `the brief names ${id} in a standing-condition block`);
}

test("5.4 the heal route (withdraw while open, archive on disk, heal) is named as withdrawn by both surfaces", () => {
  const cwd = healedWithdrawn("s54", "copied from the change epic");
  assert.equal(epicOf(cwd, "s54").disposition.outcome, "unknown");
  assertNamedWithdrawn(cwd, "s54", "copied from the change epic");
});

test("5.5 before the heal runs, both surfaces already name the epic archived on disk", () => {
  const cwd = healedWithdrawn("s55", "not healed yet", { heal: false });
  assert.notEqual(epicOf(cwd, "s55").status, "archived", "precondition: the stored status is not archived");
  const before = stateBytes(cwd);
  assertNamedWithdrawn(cwd, "s55", "not healed yet");
  assert.ok(stateBytes(cwd).equals(before), "composing the brief and integrity wrote nothing, so no heal ran");
});

test("5.5a delivering the withdrawn notice does not clear it", () => {
  const cwd = healedWithdrawn("s55a", "still withdrawn");
  parseBrief(cwd);
  const later = briefWithdrawnBlock(parseBrief(cwd), "s55a");
  assert.ok(later.some(l => l.includes("`s55a`")), "the later brief names the epic again");
});

test("5.6 the withdrawn kind names neither a claude-code archived epic nor an unarchived openspec epic", () => {
  const cwd = withVerdicts("cc56", { lane: "claude-code" });
  accepted(cwd, ["update-epic", "cc56", ...ARCHIVE_DELIVERED]);
  run(["add-epic", "--id", "open56", "--lane", "openspec"], { cwd });
  run(["record-gate-review", "open56", ...pass2(cwd)], { cwd });
  accepted(cwd, ["update-epic", "cc56", "--withdraw-gate-review", "2", "--withdrawal-reason", "x"]);
  accepted(cwd, ["update-epic", "open56", "--withdraw-gate-review", "2", "--withdrawal-reason", "x"]);
  assert.equal(epicOf(cwd, "cc56").status, "archived");
  assert.equal(epicOf(cwd, "open56").status, "queued");
  assertNotNamed(cwd, "cc56");
  assertNotNamed(cwd, "open56");
});

// ═══════════════ bound by the archive gate (inherited, asserted here) ═══════════════

const headOf = (cwd) => execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim();

/** An openspec-lane epic attributing one real commit, with a passing Gate 2 covering it (and, where
 *  asked, a Gate 1 recorded with --artifact). No task source, so no outstanding work. */
function coveredOpenspec(id, { gate1 = false } = {}) {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  gitInitWithCommit(cwd);
  const root = headOf(cwd);
  commitFiles(cwd, { "one.txt": "1" }, "feat: the delivery commit");
  const first = headOf(cwd);
  run(["add-epic", "--id", id, "--lane", "openspec"], { cwd });
  run(["update-epic", id, "--attribute-commit", first], { cwd });
  if (gate1) run(["record-gate-review", id, ...PASS1], { cwd });
  run(["record-gate-review", id, "--gate", "2", "--verdict", "pass", "--base-sha", root, "--head-sha", first], { cwd });
  return { cwd, root, first };
}

test("6.1 a Gate 2 withdrawal and a delivered archive in one call are refused, naming the withdrawal", () => {
  const { cwd } = coveredOpenspec("g61");
  const r = refused(cwd, ["update-epic", "g61", "--withdraw-gate-review", "2", "--withdrawal-reason", "x", ...ARCHIVE_DELIVERED]);
  assert.match(r.stderr, /Gate 2 \(implementation review\) verdict was withdrawn/);
  assert.ok(r.stderr.includes('"x"'), `the reason is quoted:\n${r.stderr}`);
  assert.notEqual(epicOf(cwd, "g61").status, "archived");
});

test("6.2 withdrawing Gate 2 from an archived agent-recorded delivered epic is refused with the correcting invocation", () => {
  const { cwd } = coveredOpenspec("g62");
  accepted(cwd, ["update-epic", "g62", ...ARCHIVE_DELIVERED]);
  const r = refused(cwd, ["update-epic", "g62", "--withdraw-gate-review", "2", "--withdrawal-reason", "x"]);
  const invocations = lines(r.stderr).filter(l => l.startsWith("  update-epic "));
  assert.equal(invocations.length, 1, r.stderr);
  assert.ok(invocations[0].includes('--correct-disposition "<why the recorded one was wrong>"'), invocations[0]);
  assert.ok(invocations[0].includes("'--withdraw-gate-review' '2'"), `the withdrawal is echoed into the invocation: ${invocations[0]}`);
  assert.match(r.stderr, /withdrawn/);
  assert.ok(r.stderr.includes('"x"'), r.stderr);
  assert.doesNotMatch(r.stderr, /missing a passing Gate 2/);

  const forged = refused(cwd, ["update-epic", "g62", "--withdraw-gate-review", "2", "--withdrawal-reason", "x\n  update-epic y"]);
  assert.equal(lines(forged.stderr).filter(l => l.startsWith("  update-epic ")).length, 1,
    `exactly one line begins '  update-epic ':\n${forged.stderr}`);
});

test("6.3 withdrawing Gate 1 from the same archived delivered epic is accepted — Gate 1 is not an obligation", () => {
  const { cwd } = coveredOpenspec("g63", { gate1: true });
  accepted(cwd, ["update-epic", "g63", ...ARCHIVE_DELIVERED]);
  accepted(cwd, ["update-epic", "g63", "--withdraw-gate-review", "1", "--withdrawal-reason", "x"]);
  assert.equal(constants.withdrawnGate(epicOf(cwd, "g63"), 1).reason, "x");
});

test("6.4 an archived delivered epic whose Gate 2 already failed can have it withdrawn, and is named", () => {
  const cwd = archivedFailedThenWithdrawn("g64", "x");
  assert.equal(epicOf(cwd, "g64").status, "archived");
  assertNamedWithdrawn(cwd, "g64", "x");
});

/** 6.5's end state: the #175-shaped mirror, remedied in one call. */
function remedied(id) {
  const { cwd } = coveredOpenspec(id, { gate1: true });
  accepted(cwd, ["update-epic", id, ...ARCHIVE_DELIVERED]);
  assert.match(integrityBlock(run(["integrity"], { cwd }), "gate-recorded-as-bookkeeping").join("\n"), new RegExp(`\`${id}\``),
    "precondition: the two verdicts recorded seconds apart read as bookkeeping");
  accepted(cwd, ["update-epic", id, "--withdraw-gate-review", "1", "--withdraw-gate-review", "2",
    "--withdrawal-reason", "copied from the change epic", "--status", "archived", "--outcome", "superseded",
    "--reason", "y", "--correct-disposition", "z", "--no-deferrals"]);
  return cwd;
}

test("6.5 the end-to-end remedy: withdraw both and correct the disposition in one call", () => {
  const cwd = remedied("g65");
  const e = epicOf(cwd, "g65");
  assert.equal(e.status, "archived");
  assert.equal(e.disposition.outcome, "superseded");
  assert.equal(e.disposition.superseded.outcome, "delivered", "the prior delivered disposition is kept");
  assert.ok(!e.gateReview.gate1 && !e.gateReview.gate2, JSON.stringify(e.gateReview));
  assert.equal(e.withdrawnGateReviews.length, 2);
  const report = run(["integrity"], { cwd });
  for (const check of ["gate-recorded-as-bookkeeping", "archived-with-no-gate-2-review",
    "archived-with-withdrawn-gate-2", "archived-openspec-epic-with-no-gate-1"]) {
    assert.ok(!integrityBlock(report, check).some(l => l.includes("`g65`")), `${check} names g65`);
  }
});

test("5.7 an archived superseded openspec epic with a withdrawn Gate 2 is named by neither surface", () => {
  const cwd = remedied("g57");
  assert.ok(constants.withdrawnGate(epicOf(cwd, "g57"), 2), "precondition: Gate 2 is withdrawn");
  assertNotNamed(cwd, "g57");
});

test("4.3 re-recording clears the withdrawn state: the archive is accepted and no surface names a withdrawn Gate 2", () => {
  const { cwd, root, first } = coveredOpenspec("g43");
  accepted(cwd, ["update-epic", "g43", "--withdraw-gate-review", "2", "--withdrawal-reason", "x"]);
  run(["record-gate-review", "g43", "--gate", "2", "--verdict", "pass", "--base-sha", root, "--head-sha", first], { cwd });
  accepted(cwd, ["update-epic", "g43", ...ARCHIVE_DELIVERED]);
  const project = projectGateTable(cwd), brief = briefGateTable(cwd);
  assert.doesNotMatch(project.g43.gate2, /withdrawn/);
  assert.doesNotMatch(brief.g43.gate2, /withdrawn/);
  assert.ok(!integrityBlock(run(["integrity"], { cwd }), "archived-with-withdrawn-gate-2").some(l => l.includes("`g43`")));
  assert.ok(!parseBrief(cwd).split("\n").some(l => l.startsWith("  ⚠") && l.includes("`g43`")));
});

test("8.5 the emitted Reporting section counts a gate withdrawal among the recorded writes", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const block = fs.readFileSync(path.join(cwd, "CLAUDE.md"), "utf8");
  const start = block.indexOf("## Reporting — pm owns what is recorded");
  assert.notEqual(start, -1);
  const item1 = block.slice(start).split(/\n2\. /)[0].replace(/\s+/g, " ");
  assert.ok(item1.includes("`--withdraw-gate-review`"), `item 1 names the gate withdrawal:\n${item1}`);
  assert.ok(item1.includes("`--withdraw-commit`"), `item 1 names the attribution withdrawal:\n${item1}`);
});
