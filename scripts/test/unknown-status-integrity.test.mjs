// The unknown-status integrity check — an epic whose `status` is outside KNOWN_STATUSES.
//
// Measured across 27 distinct upstreams before this shipped: 26 epics sit in `status: "done"`,
// a value the engine has never defined. Nothing rejected it on write in whatever wrote it, and
// nothing on the read side ever mentioned it — so the finding here has to carry the CONSEQUENCE
// and not just the value, which is the half a reader cannot deduce and the reason this went
// unnoticed in six repositories.
//
// The seam at the bottom is deliberate and is asserted, not implied: a `done` epic is not
// `archived`, so every archived-keyed walker structurally cannot reach it. This check reports
// the illegal status; those walkers reach the epic only after a human moves it. Two halves of
// one measured number, split across two capabilities on purpose.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { run, runCombined, tmpRepo, writeState } from "./helpers.mjs";
import { KNOWN_STATUSES } from "../lib/constants.mjs";
import { inCompletionScope, runIntegrity } from "../lib/integrity.mjs";
import { dependencySatisfied, effectivePriorityOf } from "../lib/dependency-order.mjs";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const FIXTURE = path.join(REPO, "scripts", "test", "fixtures", "state-real-undefined-statuses.json");
const CHECK = "epic-in-undefined-status";

const epic = (id, over = {}) => ({
  id, title: id, priority: "P2", status: "queued", role: "epic", lane: "claude-code",
  stories: [], links: [], ...over,
});
const seed = (epics, extra = {}) => ({ version: 1, active: null, epics, detourStack: [], ...extra });

/** The findings of ONE check. Asserts the check is registered, so a rename fails loudly here
 *  rather than silently reporting zero findings forever. */
function findingsFor(id, state) {
  const c = runIntegrity(state).find(x => x.id === id);
  assert.ok(c, `no check registered as ${id}`);
  return c.findings;
}

// ───────────────────────────── 3.1: the value is named, with a remedy ─────────────────────────

test("an epic in a status the engine does not define is reported with its id, its value and a remedy", () => {
  const findings = findingsFor(CHECK, seed([epic("finished", { status: "done" }), epic("ok")]));
  assert.equal(findings.length, 1, "exactly the one epic in an undefined status");
  const [f] = findings;
  assert.equal(f.epic, "finished");
  assert.match(f.detail, /\bdone\b/, "the finding does not name the value the epic carries");
  // The remedy names the epic AND is a runnable invocation — a finding a reader cannot act on
  // is a finding a reader ignores.
  assert.match(f.detail, /update-epic finished --status/);
  // The legal set is quoted from the engine, not typed into the string.
  for (const s of KNOWN_STATUSES) {
    assert.ok(f.detail.includes(s), `the finding does not name the defined status '${s}'`);
  }
});

test("the offending value is quoted verbatim, whatever it is", () => {
  const findings = findingsFor(CHECK, seed([epic("weird", { status: "In Progress" })]));
  assert.equal(findings.length, 1);
  assert.match(findings[0].detail, /In Progress/);
});

// ─────────────────────── 3.2: the finding names the CONSEQUENCE, not the value ────────────────

test("the finding states that the epic is exempt from every rule testing for the archived status", () => {
  const [f] = findingsFor(CHECK, seed([epic("finished", { status: "done" })]));
  assert.match(f.detail, /archived/,
    "the finding never mentions the archived status it is non-terminal to");
  assert.match(f.detail, /non-terminal|invisible|exempt/i,
    "the finding names the value but not the consequence — the half a reader cannot deduce");
});

test("the finding states that a dependency edge pointing at such an epic reads unsatisfied permanently", () => {
  const [f] = findingsFor(CHECK, seed([epic("finished", { status: "done" })]));
  assert.match(f.detail, /depends-on/,
    "the finding does not name the edge type whose satisfaction it is talking about");
  assert.match(f.detail, /priority/i,
    "the finding does not name the priority lift, which is what makes this cost something");
});

test("the consequence the finding states is TRUE of the engine, not prose about it", () => {
  // Asserted against the functions themselves, so the finding cannot go on claiming a mechanism
  // the engine has stopped implementing.
  assert.equal(dependencySatisfied({ status: "done" }), false,
    "a `done` dependency now reads satisfied — the finding's stated consequence is stale");
  assert.equal(dependencySatisfied({ status: "archived" }), true);

  // The lift, MEASURED rather than restated. `effectivePriorityOf` propagates along the edge
  // from the dependent to the dependency — the blocker absorbs the priority of everything
  // waiting on it — so the epic in the undefined status is the one that is lifted, and it stays
  // lifted for as long as the value persists because the edge can never read satisfied.
  //
  // NOTE the direction: the delta spec says the lift falls on "everything downstream of it",
  // which is the opposite end of the same edge. Reported as a finding, not silently mirrored —
  // a finding whose stated mechanism points the wrong way is worse than one that says less.
  const stuck = epic("stuck", { status: "done", priority: "P3" });
  const waiting = epic("waiting", { priority: "P0", links: [{ type: "depends-on", epic: "stuck" }] });
  assert.equal(effectivePriorityOf([stuck, waiting]).get("stuck"), "P0",
    "the permanent lift the finding warns about did not happen");
  // The same graph with the dependency properly ended: the edge is satisfied, and no lift.
  const ended = epic("stuck", { status: "archived", priority: "P3" });
  assert.equal(effectivePriorityOf([ended, waiting]).get("stuck"), "P3");
});

// ──────────────────────── 3.3: reports and repairs nothing; a clean file is silent ────────────

test("a state file in which every epic carries a defined status reports nothing", () => {
  for (const status of KNOWN_STATUSES) {
    assert.deepEqual(findingsFor(CHECK, seed([epic("e", { status })])), [],
      `the defined status '${status}' was reported as undefined`);
  }
});

test("integrity reports the undefined status and repairs nothing — the file is byte-identical", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  writeState(cwd, seed([epic("finished", { status: "done" })]));
  const before = fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8");
  const out = runCombined(["integrity"], { cwd });
  assert.match(out, new RegExp(`${CHECK} — 1 finding`));
  assert.match(out, /finished/);
  assert.equal(fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8"), before,
    "the check wrote to the record it is auditing — which legal status an undefined one should " +
    "become is a judgment about what happened to the work, and the engine must not guess it");
});

test("the CLI reports the check even when it finds nothing — a zero is a check that RAN", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  writeState(cwd, seed([epic("e", { status: "queued" })]));
  assert.match(runCombined(["integrity"], { cwd }), new RegExp(`${CHECK} — 0 finding`));
});

// ─────────────── 3.5: against a copy of a real repository's state file ────────────────────────
//
// REDACTED, and the redaction is not incidental. The source repository is private and
// `cfdude/pm` is public, so ids and titles are replaced by placeholders — date prefixes kept, so
// `strippedChangeId()` still has something to strip — while every status, lane, priority, role,
// timestamp and disposition passes through VERBATIM. The shape under audit is the real one.

test("3.5: the real record's 18 `done` epics are each reported, and nothing else is", () => {
  const state = JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
  const expected = state.epics.filter(e => !KNOWN_STATUSES.includes(e.status)).map(e => e.id).sort();
  assert.equal(expected.length, 18, "the fixture stopped carrying the population it was copied for");
  const reported = findingsFor(CHECK, state).map(f => f.epic).sort();
  assert.deepEqual(reported, expected);
  // 67 epics, 49 of them in defined statuses: the check is selective, not indiscriminate.
  assert.equal(state.epics.length, 67);
});

test("3.5: the real record loads and every other check still runs against it", () => {
  const state = JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
  const report = runIntegrity(state);
  assert.ok(report.length > 1, "runIntegrity returned one entry per check and there is only one");
  assert.ok(report.every(c => Array.isArray(c.findings)),
    "a check threw or returned a non-array against a real record — an undefined status must not " +
    "make the rest of the audit unrunnable");
});

// ───────────────────────────────── 3.6: the seam, asserted ────────────────────────────────────

test("3.6: no archived-keyed check reaches an epic in an undefined status — only this one does", () => {
  const state = seed([epic("finished", { status: "done" })]);
  const reporting = runIntegrity(state)
    .filter(c => c.findings.some(f => f.epic === "finished"))
    .map(c => c.id);
  // DERIVED from the report rather than from a list of the checks that exist today, so a check
  // added later that does reach a `done` epic fails this rather than passing unnoticed.
  assert.deepEqual(reporting, [CHECK],
    "an epic in an undefined status was reported by something other than the unknown-status " +
    "check — the partition between this check and the archived-keyed walkers has moved");
});

test("3.6: the epic becomes reachable to the archived-keyed walkers only after a human moves it", () => {
  const done = epic("finished", { status: "done" });
  // BEFORE: unreachable. Every archived-keyed walker gates on `status === "archived"` first, so
  // an epic in an undefined status is outside its domain no matter what else it carries.
  assert.notEqual(done.status, "archived");
  assert.equal(findingsFor(CHECK, seed([done])).length, 1);

  // AFTER: the human records what happened to the work. The unknown-status finding is discharged
  // and the SAME epic is now inside the archived-keyed domain — which is the other capability's
  // half of the measured number, reached by moving the status and never by this check guessing.
  const archived = { ...done, status: "archived" };
  assert.deepEqual(findingsFor(CHECK, seed([archived])), []);
  assert.equal(archived.status, "archived");
  assert.equal(inCompletionScope(archived), true,
    "the moved epic is still outside the completion-shaped scope — the seam does not close");
});
