// scripts/test/stored-value-integrity.test.mjs
// `gate-integrity` — the read-only surface reports three shapes of stored value that cannot be
// true: a reference naming itself, a reference naming nothing, and a grant naming nothing. Every
// test is one scenario of
// openspec/changes/operations-ship-their-inverses/specs/gate-integrity/spec.md.
//
// WHY A CHECK AS WELL AS THE WRITE-TIME REFUSALS. They are not redundant and neither substitutes
// for the other: a refusal binds a write that has not happened yet and does nothing for the records
// already on disk, which is where all three of these were found. Every fixture below is therefore
// hand-written — after `epic-disposition`'s refusals and `epic-autonomy`'s, the engine can no
// longer produce any of them.

import { test } from "node:test";
import assert from "node:assert/strict";
import { run, runCombined, readState, tmpRepo } from "./helpers.mjs";
import fs from "node:fs";
import path from "node:path";

const stateFile = (cwd) => path.join(cwd, ".conductor", "state.json");

/** Init, then hand-edit the record into a shape the engine refuses to write. */
function poisoned(mutate) {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "a", "--lane", "claude-code"], { cwd });
  run(["add-epic", "--id", "other", "--lane", "claude-code"], { cwd });
  const s = readState(cwd);
  mutate(s, s.epics.find(e => e.id === "a"));
  fs.writeFileSync(stateFile(cwd), JSON.stringify(s, null, 2) + "\n");
  return cwd;
}

/** The findings block for one check id, as `integrity` prints it. */
function block(out, id) {
  const lines = out.split("\n");
  const at = lines.findIndex(l => l.startsWith(`${id} — `));
  assert.notEqual(at, -1, `integrity declares a '${id}' check:\n${out}`);
  const found = [];
  for (let i = at + 1; i < lines.length && lines[i].startsWith("  • "); i++) found.push(lines[i]);
  return { header: lines[at], findings: found };
}

const integrity = (cwd) => runCombined(["integrity"], { cwd });
const archived = (e) => { e.status = "archived"; e.disposition = { outcome: "delivered", recordedAt: "2026-01-01T00:00:00.000Z" }; };

test("Scenario: A self-referential handoff is reported", () => {
  const cwd = poisoned((s, a) => { archived(a); a.disposition.carriedTo = "a"; });
  const { header, findings } = block(integrity(cwd), "self-referential-epic-id");
  assert.match(header, /1 finding/);
  assert.match(findings[0], /`a`/, "names the epic that holds it");
  assert.match(findings[0], /disposition\.carriedTo/, "and the field");
  // Reported, never repaired.
  assert.equal(readState(cwd).epics.find(e => e.id === "a").disposition.carriedTo, "a");
});

test("Scenario: A self-referential deferral is reported", () => {
  // The SAME declared set, not `carriedTo` alone: a self-reference is no less false in a deferral.
  const cwd = poisoned((s, a) => {
    archived(a);
    a.deferralAssertion = { deferrals: [{ epic: "a", section: "design.md" }], declined: [], recordedAt: "2026-01-01T00:00:00.000Z" };
  });
  const { findings } = block(integrity(cwd), "self-referential-epic-id");
  assert.equal(findings.length, 1);
  assert.match(findings[0], /deferralAssertion\.deferrals/);
});

test("Scenario: An empty deferral reference is reported", () => {
  const cwd = poisoned((s, a) => {
    archived(a);
    a.deferralAssertion = { deferrals: [{ epic: "", section: "" }], declined: [], recordedAt: "2026-01-01T00:00:00.000Z" };
  });
  const out = integrity(cwd);
  const { findings } = block(out, "empty-epic-id");
  assert.equal(findings.length, 1, "the shape `dangling-epic-reference` passes over by construction");
  assert.match(findings[0], /`a`/);
  assert.match(findings[0], /deferralAssertion\.deferrals/);
  assert.equal(block(out, "dangling-epic-reference").findings.length, 0,
    "and it is NOT also reported as dangling — one finding, exactly one check");
});

test("Scenario: A grant naming nothing is reported", () => {
  const cwd = poisoned((s, a) => {
    a.autonomy = { level: "off", context: [], notifications: [],
      preAuthorized: [{ action: "", grantedAt: "2026-01-01T00:00:00.000Z", reason: "no action" }] };
  });
  const { findings } = block(integrity(cwd), "grant-names-nothing");
  assert.equal(findings.length, 1, "no revoke can reach it — a revoke names a STORED value");
  assert.match(findings[0], /`a`/);
});

test("Scenario: An unknown id is reported once, as a dangling reference and not as an empty one", () => {
  const cwd = poisoned((s, a) => { archived(a); a.disposition.carriedTo = "ghost-epic"; });
  const out = integrity(cwd);
  assert.equal(block(out, "dangling-epic-reference").findings.length, 1);
  assert.equal(block(out, "empty-epic-id").findings.length, 0);
  assert.equal(block(out, "self-referential-epic-id").findings.length, 0);
});

test("Scenario: A valid reference is not reported", () => {
  const cwd = poisoned((s, a) => {
    archived(a);
    a.disposition.carriedTo = "other";
    a.deferralAssertion = { deferrals: [{ epic: "other", section: "" }], declined: [], recordedAt: "2026-01-01T00:00:00.000Z" };
    a.autonomy = { level: "autonomous", context: [], notifications: [], preAuthorized: [
      { action: "rm -rf build/", grantedAt: "2026-01-01T00:00:00.000Z" },
      { category: "filesystem", grantedAt: "2026-01-01T00:00:00.000Z" },
      // A REVOKED grant still names something, so it is not a finding: the check is about a grant
      // that names NOTHING, not about one that has been taken back.
      { action: "drop-table", grantedAt: "2026-01-01T00:00:00.000Z", revoked: { reason: "unsafe", revokedAt: "2026-01-02T00:00:00.000Z" } },
    ] };
  });
  const out = integrity(cwd);
  for (const id of ["self-referential-epic-id", "empty-epic-id", "grant-names-nothing"]) {
    assert.equal(block(out, id).findings.length, 0, `${id} reports nothing:\n${out}`);
  }
});

// ───────── 2.7 REGRESSION GUARD — the value-agnostic enumeration changes no existing consumer ─────────

test("REGRESSION GUARD: dangling-epic-reference still reports a non-empty unknown id exactly once", () => {
  const cwd = poisoned((s, a) => {
    archived(a);
    a.disposition.carriedTo = "ghost-epic";
    a.deferralAssertion = { deferrals: [{ epic: "", section: "x" }], declined: [], recordedAt: "2026-01-01T00:00:00.000Z" };
  });
  const out = integrity(cwd);
  const dangling = block(out, "dangling-epic-reference");
  assert.equal(dangling.findings.length, 1, "the empty holder does not leak into the dangling check");
  assert.match(dangling.findings[0], /ghost-epic/);
  assert.equal(block(out, "empty-epic-id").findings.length, 1, "and the empty one is reported by its own check");
});

test("REGRESSION GUARD: remove-epic neither sweeps nor refuses on a holder whose value is empty", () => {
  const cwd = poisoned((s, a) => {
    archived(a);
    a.deferralAssertion = { deferrals: [{ epic: "", section: "x" }], declined: [], recordedAt: "2026-01-01T00:00:00.000Z" };
  });
  // Removing an unrelated epic must behave exactly as before: the empty holder is invisible to the
  // sweep (no epic id is ever the empty string) and blocks nothing.
  run(["remove-epic", "other"], { cwd });
  const s = readState(cwd);
  assert.equal(s.epics.find(e => e.id === "other"), undefined);
  assert.deepEqual(s.epics.find(e => e.id === "a").deferralAssertion.deferrals, [{ epic: "", section: "x" }],
    "the empty holder is left exactly as it was");
});

test("REGRESSION GUARD: remove-epic still refuses on a frame and on an owed reconcile", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "p", "--lane", "claude-code", "--status", "active"], { cwd });
  run(["add-epic", "--id", "d", "--lane", "claude-code"], { cwd });
  run(["push-detour", "p", "--detour", "d", "--reason", "blocked", "--reconcile"], { cwd });
  const out = runCombined(["remove-epic", "p"], { cwd });
  assert.match(out, /detour-stack frame|reconcile/i, "the frame and the owed reconcile still block a removal");
  assert.ok(readState(cwd).epics.find(e => e.id === "p"), "and the epic is still there");
});

// ───────── Gate 2 I-I2 — the repair path, and what the report says about history ─────────

test("Scenario: correcting a self-referential handoff repairs the LIVE field and keeps the history reported", () => {
  // The repair path the checks' remedy prescribes, run end to end. `--correct-disposition` moves the
  // prior record — the bad value and all — under `disposition.superseded`, which is immutable by this
  // release's own record-don't-delete rule. So the live finding CLEARS and the historical one does
  // NOT, and the historical one must not prescribe an action no verb can perform.
  const cwd = poisoned((s, a) => { archived(a); a.disposition.carriedTo = "a"; });
  assert.equal(block(integrity(cwd), "self-referential-epic-id").findings.length, 1, "fixture: the live field is a finding");

  run(["update-epic", "a", "--status", "archived", "--outcome", "superseded", "--reason",
    "the work moved to 'other'", "--carried-to", "other", "--no-deferrals",
    "--correct-disposition", "carriedTo named the epic itself, which conveys nothing"], { cwd });

  const d = readState(cwd).epics.find(e => e.id === "a").disposition;
  assert.equal(d.carriedTo, "other", "the live handoff now names the epic that holds the work");
  assert.equal(d.superseded.carriedTo, "a", "and the prior record keeps the value that was wrong, verbatim");

  const { header, findings } = block(integrity(cwd), "self-referential-epic-id");
  assert.match(header, /1 finding/, "the historical copy is still reported — it is still a value that cannot be true");
  assert.match(findings[0], /disposition\.superseded\.carriedTo/, "and it is the superseded field, not the live one");
  assert.doesNotMatch(findings[0], /Point it at the epic that actually holds the work/,
    "but NOT with the live field's remedy: no verb can rewrite a superseded record, and prescribing it is a remedy that does nothing");
  assert.match(findings[0], /superseded|corrected|history/i,
    "the finding says instead that it persists by design on a corrected record");
});

test("REGRESSION GUARD: the live field's remedy is unchanged for a reference that is not history", () => {
  const cwd = poisoned((s, a) => { archived(a); a.disposition.carriedTo = "a"; });
  const { findings } = block(integrity(cwd), "self-referential-epic-id");
  assert.match(findings[0], /Point it at the epic that actually holds the work, or remove the claim/,
    "a live self-reference still gets the actionable remedy");
});

test("Scenario: an empty id in a superseded record is reported without the re-record remedy", () => {
  // The same ruling for `empty-epic-id`, which reads the same declared set. HAND-WRITTEN, and no
  // engine version wrote this shape: `agentDisposition()` copies `carriedTo` only when it is
  // non-empty, and the superseded half is a verbatim copy of a prior record built the same way. The
  // fixture exercises the WORDING branch over a record only a hand-edit can produce — which is the
  // population every check in this file exists for.
  const cwd = poisoned((s, a) => {
    archived(a);
    a.disposition.superseded = { outcome: "delivered", recordedAt: "2026-01-01T00:00:00.000Z", carriedTo: "" };
  });
  const { findings } = block(integrity(cwd), "empty-epic-id");
  assert.equal(findings.length, 1);
  assert.match(findings[0], /disposition\.superseded\.carriedTo/);
  assert.doesNotMatch(findings[0], /is repaired by re-recording the reference with the epic it meant/,
    "the live remedy is not offered against a record no verb can rewrite");
});
