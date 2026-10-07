// scripts/test/unit/theme-b2.test.mjs
// Theme B batch B2 (pm 0.51.0): the integrity checks and the release verb, observed as VALUES — the report
// `integrity` prints, the record a verb leaves, the text a printer returns. Anything that needs a directory
// on disk (the archive directory, the live change copy, the heal) is in scripts/test/assert/theme-b2.test.mjs.
//
//   gh#231  tracker-item-held-by-two-epics          gh#200 (the held set) and gh#215 are on the file rung
//   #5      archived-delivered-fails-delivered-obligation
//   #7      dispositionInvocation() prints the deferral PLACEHOLDER, never a bare --no-deferrals
//   #9      release --deliver / --undeliver and `release show`

import assert from "node:assert/strict";
import { emptyRecord, expectFail, memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";
import { agentDisposition } from "../../lib/disposition.mjs";
import { dispositionInvocation, DEFERRAL_PLACEHOLDER } from "../../lib/archive-gate.mjs";

const AT = "2026-09-01T00:00:00.000Z";
const epic = (id, extra = {}) => ({
  id, title: id, priority: "P1", status: "queued", role: "epic", lane: "claude-code", links: [], ...extra,
});
const repoWith = (record) => memoryEngine({ version: 1, active: null, detourStack: [], ...record });

/** The bullets under one check's heading in the integrity report. */
function block(out, id) {
  const lines = out.split("\n");
  const start = lines.findIndex(l => l.startsWith(`${id} — `));
  assert.notEqual(start, -1, `integrity printed no block for ${id}:\n${out}`);
  const bullets = [];
  for (let i = start + 1; i < lines.length && lines[i].startsWith("  "); i++) bullets.push(lines[i]);
  return bullets;
}

// ─────────────── gh#231: two epics holding one tracker item ───────────────

const TRACKED = "tracker-item-held-by-two-epics";

unitTest("gh-231: two epics sharing an externalUrl are reported once, naming both and the repair", () => {
  const url = "https://example.test/issues/7";
  const out = repoWith({ epics: [
    epic("older", { externalUrl: url, status: "archived" }),
    epic("newer", { externalUrl: url }),
    epic("other", { externalUrl: "https://example.test/issues/8" }),
  ] })(["integrity"]);
  const found = block(out, TRACKED);
  assert.equal(found.length, 1, out);
  assert.match(found[0], /`newer`/);
  assert.match(found[0], /`older` \(archived\)/, "archived holders count, as they do for the writers");
  assert.match(found[0], /`update-epic older --clear external-url`/);
  assert.match(found[0], /`update-epic newer --clear external-url`/);
});

unitTest("gh-231: the bare externalId collides only where NEITHER side has a URL; one URL-less side is no collision", () => {
  const ids = repoWith({ epics: [epic("a", { externalId: "7" }), epic("b", { externalId: "7" })] })(["integrity"]);
  const found = block(ids, TRACKED);
  assert.equal(found.length, 1, ids);
  assert.match(found[0], /external-id `7`/);
  assert.match(found[0], /--clear external-id/);
  const mixed = repoWith({ epics: [
    epic("a", { externalId: "7", externalUrl: "https://example.test/x/7" }), epic("b", { externalId: "7" })] })(["integrity"]);
  assert.deepEqual(block(mixed, TRACKED), [], "one side URL-less is never a collision (trackerKeyHolder's rule)");
});

unitTest("gh-231: three holders of one item report every pair, and distinct items report nothing", () => {
  const url = "https://example.test/issues/7";
  const three = repoWith({ epics: [epic("a", { externalUrl: url }), epic("b", { externalUrl: url }), epic("c", { externalUrl: url })] })(["integrity"]);
  assert.equal(block(three, TRACKED).length, 3, "a-b, a-c, b-c");
  const none = repoWith({ epics: [epic("a", { externalUrl: `${url}1` }), epic("b", { externalUrl: `${url}2` })] })(["integrity"]);
  assert.deepEqual(block(none, TRACKED), []);
});

// ─────────────── #5: an archived delivered epic that fails a delivered obligation ───────────────

const FAILS = "archived-delivered-fails-delivered-obligation";
const delivered = (id, extra = {}) => epic(id, { lane: "openspec", status: "archived",
  disposition: agentDisposition({ outcome: "delivered", recordedAt: AT }), ...extra });

unitTest("archived-delivered: a delivered openspec epic whose Gate 2 reads fail is named, with the re-record and the correction", () => {
  const out = repoWith({ epics: [delivered("shipped", { gateReview: { gate2: { verdict: "fail", reviewedAt: AT } } })] })(["integrity"]);
  const found = block(out, FAILS);
  assert.equal(found.length, 1, out);
  assert.match(found[0], /missing a passing Gate 2/);
  assert.match(found[0], /`record-gate-review shipped --gate 2 --verdict pass --base-sha <sha> --head-sha <sha>`/);
  assert.match(found[0], /--correct-disposition/);
  assert.match(found[0], /<--no-deferrals \| --deferral "<epicId>:<section>">/, "the deferral half is a placeholder, never a claim");
});

unitTest("archived-delivered: nothing failing, a withdrawn Gate 2, an ungated stamp and a non-delivered outcome are all silent", () => {
  const out = repoWith({ epics: [
    delivered("fine", { gateReview: { gate2: { verdict: "pass", reviewedAt: AT } } }),
    delivered("withdrawn", { withdrawnGateReviews: [{ gate: "2", reason: "r", entry: { verdict: "pass" }, withdrawnAt: AT }] }),
    delivered("ungated", { gateReview: { gate2: { verdict: "ungated", reviewedAt: AT, recordedBy: "archive-drift-heal" } } }),
    epic("killed", { lane: "openspec", status: "archived", disposition: agentDisposition({ outcome: "killed", reason: "r", recordedAt: AT }) }),
    epic("live", { lane: "openspec", gateReview: { gate2: { verdict: "fail", reviewedAt: AT } } }),
  ] })(["integrity"]);
  assert.deepEqual(block(out, FAILS), [], "withdrawn and ungated have their own checks and are not reported twice");
});

// ─────────────── #7: the printed invocation never carries a bare --no-deferrals ───────────────

unitTest("dispositionInvocation prints the PLACEHOLDER by default, nothing when asserted, and a bare flag only on explicit request", () => {
  const e = epic("x", { status: "archived" });
  assert.ok(dispositionInvocation(e).endsWith(` ${DEFERRAL_PLACEHOLDER}`));
  assert.doesNotMatch(dispositionInvocation(e), /--no-deferrals`?$/);
  assert.doesNotMatch(dispositionInvocation(e, { deferrals: "asserted" }), /deferral/);
  assert.ok(dispositionInvocation(e, { deferrals: "bare" }).endsWith(" --no-deferrals"), "an explicit request keeps its spelling");
});

unitTest("every printer of the invocation reaches the placeholder: integrity's undefined-status remedy prints it", () => {
  const out = repoWith({ epics: [epic("odd", { status: "done" })] })(["integrity"]);
  assert.match(out, /update-epic odd --status archived --outcome <[a-z|]+> --reason "<why>" <--no-deferrals \| --deferral/);
});

// ─────────────── #9: the release's delivered marker ───────────────

const releaseRepo = () => {
  const engine = memoryEngine(emptyRecord());
  engine(["add-epic", "--id", "e0", "--title", "t", "--lane", "claude-code"]);
  engine(["release", "r1", "--intent", "one", "--member", "e0"]);
  return engine;
};
const rel = (engine) => engine.store.record().releases.find(r => r.id === "r1");

unitTest("release --deliver records a marker, --undeliver removes it, and show renders both states", () => {
  const engine = releaseRepo();
  assert.equal(rel(engine).delivered, undefined, "no marker until one is recorded — a prior record has none");
  assert.match(engine(["release", "show", "r1"]), /delivered: — \(no marker/);
  engine(["release", "r1", "--deliver"]);
  assert.match(rel(engine).delivered.recordedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(engine(["release", "show", "r1"]), /delivered: yes — marked \d{4}-/);
  engine(["release", "r1", "--undeliver"]);
  assert.equal(rel(engine).delivered, undefined, "the inverse leaves no marker behind");
  assert.match(engine(["release", "show", "r1"]), /delivered: — \(no marker/);
});

unitTest("release --deliver twice keeps the first recordedAt; --undeliver without a marker and both flags together are refused", () => {
  const engine = releaseRepo();
  engine(["release", "r1", "--deliver"]);
  const first = rel(engine).delivered.recordedAt;
  engine(["release", "r1", "--deliver"]);
  assert.equal(rel(engine).delivered.recordedAt, first, "re-marking is a no-op");
  const both = expectFail(() => engine(["release", "r1", "--deliver", "--undeliver"]));
  assert.match(both.stderr, /cannot both be given/);
  assert.equal(rel(engine).delivered.recordedAt, first, "nothing was written");
  engine(["release", "r1", "--undeliver"]);
  const none = expectFail(() => engine(["release", "r1", "--undeliver"]));
  assert.match(none.stderr, /carries no delivered marker/);
});
