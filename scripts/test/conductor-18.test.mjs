// gh-137 — nothing closes an epic when the release it shipped in is delivered, and gh-112's
// deferred follow-up: nothing closes an epic another epic declares it SUPERSEDES.
//
// The defect gh-137 pins: 0.27.0 shipped, its parent epic archived `delivered`, all 20 member
// epics stayed `queued` with no disposition, and `next` then recommended two P0s that had
// shipped hours earlier. Three signals were in `state.json` at that moment and nothing read any
// of them. These are the engine's half — pure functions of `state.json`, no tracker call.
//
// Both checks are scoped AWAY from terminal epics by construction (gh-138): each reports only an
// epic whose status is non-terminal, so neither can add a finding for work that has ended.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRepo, run, readState } from "./helpers.mjs";

const REPO = new URL("../..", import.meta.url).pathname;
const { runIntegrity } = await import("../lib/integrity.mjs");

const liveState = () => JSON.parse(fs.readFileSync(path.join(REPO, ".conductor", "state.json"), "utf8"));
const findingsFor = (id, state) => {
  const c = runIntegrity(state).find(x => x.id === id);
  assert.ok(c, `no check registered as ${id}`);
  return c.findings;
};

const at = "2026-08-01T00:00:00.000Z";
const epic = (id, over = {}) => ({
  id, title: id, priority: "P1", status: "queued", role: "epic", lane: "claude-code", ...over,
});
const delivered = (id, over = {}) => epic(id, {
  status: "archived", disposition: { outcome: "delivered", recordedAt: at }, ...over,
});

// ─────────────────────── check A — a delivered release's open members ───────────────────────
//
// THE FIXTURE IS gh-137's OWN SHAPE: one member archived `delivered` (the change that shipped),
// the rest still `queued`, and one epic the release deliberately cut recorded in `deferred[]`.

/** A release whose parent shipped, two members left open, and one deliberate exclusion. */
const shippedRelease = () => ({
  version: 1, active: null, detourStack: [],
  releases: [{
    id: "0.27.0", intent: "ship it", deferred: [{ epic: "cut", reason: "out of scope", recordedAt: at }],
  }],
  epics: [
    delivered("parent", { release: "0.27.0" }),
    epic("member-a", { release: "0.27.0" }),
    epic("member-b", { release: "0.27.0" }),
    // Deliberately excluded — carries the membership pointer TOO, which only a hand-edited
    // state can produce (the `--defer` verb clears `epic.release`). That is exactly why the
    // exclusion is honoured here rather than assumed unreachable.
    epic("cut", { release: "0.27.0" }),
    epic("unrelated"),
  ],
});

test("gh-137: an epic left non-terminal in a release whose parent delivered is reported", () => {
  const reported = findingsFor("delivered-release-epic-left-open", shippedRelease()).map(f => f.epic).sort();
  assert.deepEqual(reported, ["member-a", "member-b"],
    "both open members must be reported — this is the 20-epic case the issue was filed from");
});

test("gh-137: the release's own `deferred[]` excludes an epic cut on purpose", () => {
  const reported = findingsFor("delivered-release-epic-left-open", shippedRelease()).map(f => f.epic);
  assert.ok(!reported.includes("cut"),
    "the release object already distinguishes `excluded on purpose` from `shipped`; consuming " +
    "only the exclusion half is the defect, and reporting a deferred epic re-breaks it");
});

test("gh-137: an epic in no release, and an epic in a release nothing delivered, are both silent", () => {
  const st = shippedRelease();
  assert.ok(!findingsFor("delivered-release-epic-left-open", st).some(f => f.epic === "unrelated"),
    "an epic with no `release` pointer is outside this check entirely");
  // Strip the delivered disposition: the release is now planned but unshipped.
  st.epics[0].status = "queued";
  delete st.epics[0].disposition;
  assert.deepEqual(findingsFor("delivered-release-epic-left-open", st), [],
    "a release nothing has delivered yet is an ordinary backlog, not a finding");
});

test("gh-137: a release with work still in flight is silent — a staged release is not a defect", () => {
  const st = shippedRelease();
  st.epics[1].status = "active";
  assert.deepEqual(findingsFor("delivered-release-epic-left-open", st), [],
    "one member delivered while another is being worked is a release mid-flight; reporting the " +
    "rest would be the noise gh-138 is about");
  st.epics[1].status = "paused";
  assert.deepEqual(findingsFor("delivered-release-epic-left-open", st), [],
    "a paused member is in flight too — it is coming back");
});

test("gh-137: the check never reports an epic whose status is terminal (gh-138)", () => {
  const st = shippedRelease();
  for (const e of st.epics) { e.status = "archived"; e.disposition = { outcome: "delivered", recordedAt: at }; }
  assert.deepEqual(findingsFor("delivered-release-epic-left-open", st), [],
    "every finding is an epic that is still open; work that ended can never be one");
});

test("gh-137: the finding hands over the two commands that end it", () => {
  const [f] = findingsFor("delivered-release-epic-left-open", shippedRelease());
  assert.match(f.detail, /update-epic member-a --status archived --outcome delivered/,
    "the remediation is a command the reader runs, as every check in this file does");
  assert.match(f.detail, /release 0\.27\.0 --defer member-a --reason/,
    "the other honest ending is `it was cut` — an audit that offers only one of them presumes " +
    "which one is true");
});

// ─────────────────────── check B — a superseded epic that never ended ───────────────────────
//
// gh-112 shipped the `supersedes` link type and triage's use of it; the mechanical signal it
// deliberately left on the table is this one.

const withSupersession = (over = {}) => ({
  version: 1, active: null, detourStack: [], releases: [],
  epics: [
    epic("replacement", { links: [{ type: "supersedes", epic: "old", reason: "one validator" }] }),
    epic("old", over),
    epic("bystander", { links: [{ type: "relates-to", epic: "old" }] }),
  ],
});

test("gh-112: an epic another epic supersedes, still queued, is reported", () => {
  const findings = findingsFor("superseded-epic-never-ended", withSupersession());
  assert.deepEqual(findings.map(f => f.epic), ["old"]);
  assert.match(findings[0].detail, /replacement/, "the finding names the epic that replaced it");
  assert.match(findings[0].detail, /--outcome superseded --reason/,
    "the ending a superseded epic owes is its own disposition, and its reason is required");
});

test("gh-112: an active superseded epic is reported too — it is being worked on twice", () => {
  const findings = findingsFor("superseded-epic-never-ended", withSupersession({ status: "active" }));
  assert.deepEqual(findings.map(f => f.epic), ["old"],
    "`active` is the worst case, not an exemption: two epics building one thing");
});

test("gh-112: a superseded epic that ENDED is silent (gh-138)", () => {
  const st = withSupersession({ status: "archived", disposition: { outcome: "superseded", reason: "r", recordedAt: at } });
  assert.deepEqual(findingsFor("superseded-epic-never-ended", st), [],
    "the check reports an unfinished ending, not the fact of supersession");
});

test("gh-112: the state of the SUPERSEDING epic does not change the answer", () => {
  const st = withSupersession();
  st.epics[0].status = "archived";
  st.epics[0].disposition = { outcome: "delivered", recordedAt: at };
  assert.deepEqual(findingsFor("superseded-epic-never-ended", st).map(f => f.epic), ["old"],
    "triage treats a superseded epic as dead the moment the declaration exists, regardless of " +
    "what happened to the epic that made it — the two readers must not disagree");
});

test("gh-112: another link type is not a supersession", () => {
  const st = withSupersession();
  st.epics[0].links[0].type = "relates-to";
  assert.deepEqual(findingsFor("superseded-epic-never-ended", st), [],
    "only `supersedes` declares that one epic replaces another");
});

test("gh-112: a supersedes link naming an epic the record does not hold is not this check's finding", () => {
  const st = withSupersession();
  st.epics = st.epics.filter(e => e.id !== "old");
  assert.deepEqual(findingsFor("superseded-epic-never-ended", st), [],
    "`dangling-epic-reference` owns that shape; reporting it here would double-count it under a " +
    "heading that names the wrong problem");
});

// ─────── the superseded set has ONE declaration, read by triage and by integrity ───────

test("gh-112: triage and integrity read the same superseded-set predicate", async () => {
  const links = await import("../lib/links.mjs");
  assert.equal(typeof links.supersededEpics, "function",
    "the predicate is declared once in links.mjs — two copies of `who is superseded` is the " +
    "duplication epicReferences() exists to prevent");
  const triageSrc = fs.readFileSync(path.join(REPO, "scripts", "lib", "triage.mjs"), "utf8");
  const integritySrc = fs.readFileSync(path.join(REPO, "scripts", "lib", "integrity.mjs"), "utf8");
  for (const [name, src] of [["triage.mjs", triageSrc], ["integrity.mjs", integritySrc]]) {
    assert.match(src, /supersededEpics/, `${name} must consume the shared predicate`);
    assert.doesNotMatch(src, /l\.type === "supersedes"/,
      `${name} must not re-derive the set locally`);
  }
});

// ─────────────────────── both checks, against this repository's live record ───────────────────────

test("gh-137/gh-112: both checks are quiet on this repository's real record, and that is correct", () => {
  const st = liveState();
  assert.deepEqual(findingsFor("delivered-release-epic-left-open", st), [],
    "0.27.0's twenty members were given their dispositions by hand when gh-137 was filed, so a " +
    "correct check reports none of them now — the finding it would have made has been discharged");
  assert.deepEqual(findingsFor("superseded-epic-never-ended", st), [],
    "no epic here holds a `supersedes` link yet; the link type shipped with gh-112's triage " +
    "layer and nothing has consolidated a pair through it");
  // The live-data claim above is only meaningful while the release it names is still delivered.
  const members = st.epics.filter(e => e.release === "0.27.0");
  assert.ok(members.length >= 20, `0.27.0 should still hold its members — found ${members.length}`);
  assert.ok(members.every(e => e.status === "archived"),
    "every member of 0.27.0 is archived — that is WHY the check is silent, not a miss");
});

// ─────────────────────── the report surface ───────────────────────

test("gh-137/gh-112: both checks appear in the report even when they find nothing", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const out = run(["integrity"], { cwd });
  for (const id of ["delivered-release-epic-left-open", "superseded-epic-never-ended"]) {
    assert.match(out, new RegExp(`^${id} — \\d+ finding\\(s\\)`, "m"),
      `${id}: a check that measured nothing must still say it ran`);
  }
  assert.ok(readState(cwd), "integrity writes no state");
});
