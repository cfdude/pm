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
import { tmpRepo, run, readState, writeState } from "./helpers.mjs";

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

// ─────────── the instruction half — sync proposes the disposition for a closed item ───────────
//
// The ENGINE may not ask a tracker anything (pm is an instruction layer, never an integration
// layer), so the half of gh-137 that needs tracker state belongs in the emitted procedure the
// agent already runs. Sync lists OPEN items; an epic linked to an item that is not in that list
// has an item that is no longer open. That is the reciprocal of the registration step, and it
// was missing: sync could create an epic from an item and never close one.
//
// PROPOSING, never writing. The outcome and its required reason are a judgment about what
// happened to the work; an engine-inferred `delivered` would be exactly the unreplaceable,
// provenance-free disposition gh-130 is about.

const rulesWith = (tracker, secondaryTrackers) => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const state = readState(cwd);
  if (tracker) state.tracker = tracker;
  if (secondaryTrackers) state.secondaryTrackers = secondaryTrackers;
  writeState(cwd, state);
  return run(["rules"], { cwd });
};

const flat = (s) => s.replace(/\n\s*/g, " ");

/** BOTH inward emitters, derived from the sweep rather than typed: `rg "Inward tracker sync|
 *  GitHub issue sync|Secondary tracker sync" scripts/lib/rules.mjs` finds exactly two blocks that
 *  emit a "list open items" procedure — the primary's inward section and the secondary loop. A
 *  step added to one and not the other is the diff-scoped omission the gate procedure names. */
const INWARD_EMITTERS = [
  ["primary · github-issues", () => rulesWith({ system: "github-issues", repo: "o/n", direction: "inward" })],
  ["primary · jira", () => rulesWith({ system: "jira", projectKey: "JOB", direction: "inward" })],
  ["secondary", () => rulesWith({ system: "github-issues", repo: "o/n", direction: "outward" },
    [{ system: "github-issues", repo: "o/second", role: "secondary" }])],
];

for (const [name, emit] of INWARD_EMITTERS) {
  test(`gh-137: ${name} — the inward procedure closes the loop on an item that is no longer open`, () => {
    const block = flat(emit());
    assert.match(block, /no longer open/,
      "an epic linked to an item absent from the open list is the signal nothing consumed");
    assert.match(block, /--outcome delivered\|killed\|superseded\|abandoned/,
      "the proposal names the vocabulary the disposition must come from");
    assert.match(block, /PROPOSE/,
      "proposing, not writing — the outcome and its reason are the agent's judgment, and an " +
      "engine-inferred disposition is unreplaceable (gh-130)");
  });

  test(`gh-137: ${name} — the procedure does not treat absence from the list as proof`, () => {
    const block = flat(emit());
    assert.match(block, /read the item/i,
      "absence from an open-item list also covers a deleted, transferred or out-of-scope item, " +
      "so the item itself is read before anything is proposed");
  });

  test(`gh-137: ${name} — only a NON-TERMINAL epic is proposed for (gh-138)`, () => {
    const block = flat(emit());
    assert.match(block, /already `archived`/,
      "an epic that has ended owes nothing here — gh-138's count is half work that can never " +
      "happen, and this step must not add to it");
  });
}

test("gh-137: an outward-only repo is instructed to close no epic — it reads no list", () => {
  const block = flat(rulesWith({ system: "jira", projectKey: "JOB", direction: "outward" }));
  assert.doesNotMatch(block, /no longer open/,
    "the step hangs off the list the inward pull performs; a repo that lists nothing cannot run " +
    "it, and emitting it would point at a step that is not there");
});

// ─────────── the replay — the exact record gh-137 was filed from ───────────
//
// The live-data test above proves the check is SILENT today, which is the right answer and also
// the weakest possible evidence: a check that returned [] unconditionally would pass it. This
// one rebuilds the moment the issue was filed from the same live record — every `gh-*` member of
// 0.27.0 back to `queued` with its disposition removed, exactly the twenty hand-run `update-epic`
// calls undone — and asserts the check names all twenty. Nothing is written: the mutation is on
// a parsed copy.

test("gh-137: replayed against the record as it stood when the issue was filed, the check names all twenty", () => {
  const st = liveState();
  let reverted = 0;
  for (const e of st.epics) {
    if (e.release === "0.27.0" && e.id.startsWith("gh-")) {
      e.status = "queued";
      delete e.disposition;
      reverted++;
    }
  }
  assert.equal(reverted, 20,
    `0.27.0 held twenty tracker-mirrored members when #137 was filed — found ${reverted}. If this ` +
    "moved, the replay is no longer replaying the issue and the number below means nothing.");
  const findings = findingsFor("delivered-release-epic-left-open", st);
  assert.equal(findings.length, 20,
    "all twenty, which is what the issue says the engine could have known and did not");
  // The change that shipped the release is still archived `delivered` in the replay — it is what
  // makes the release read as delivered — so it must not be among them.
  assert.ok(!findings.some(f => f.epic === "conductor-tells-the-truth"),
    "the delivered member is the SIGNAL, never a finding");
  // And the four cut on purpose stay out, by both routes: they are in deferred[] and `--defer`
  // already cleared their membership pointer.
  for (const cut of ["gh-114-lane-routing-blind-to-product", "gh-66-update-epic-missing-flags",
    "gh-64-sync-duplicate-shipped-plan", "gh-69-sync-no-done-signal-for-plans"]) {
    assert.ok(!findings.some(f => f.epic === cut),
      `${cut} was deliberately cut from 0.27.0 and must never be reported as unfinished bookkeeping`);
  }
});
