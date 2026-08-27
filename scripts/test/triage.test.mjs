// Intake triage (gh-112) — the MECHANICAL half of admitting an ask.
//
// The line this suite pins: the engine computes a CANDIDATE SET and never a VERDICT. Every
// test below either checks that the candidate set is real (it surfaces the thing a human found
// by reading), or that the engine declines to judge. A test that only asserted "valid JSON with
// these keys" would pass with the candidate list hard-coded empty, which is the mutation these
// were written against.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { run, readState, writeState, tmpRepo, runCombined } from "./helpers.mjs";

const TRIAGE = new URL("../lib/triage.mjs", import.meta.url).href;
const DISPOSITION = new URL("../lib/disposition.mjs", import.meta.url).href;

/** A repo whose state holds exactly `epics`, each entry `{id, title, description?, ...}`. */
function repoWith(epics) {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const state = readState(cwd);
  state.epics = epics.map(e => ({
    priority: "P2", status: "queued", role: "epic", lane: "superpowers",
    links: [], reconcileNeeded: false, ...e,
  }));
  state.active = null;
  writeState(cwd, state);
  return cwd;
}

const triage = (cwd, ask, ...flags) => JSON.parse(run(["triage", ask, ...flags], { cwd }));

// ───────────────────────────── the live-evidence acceptance case ─────────────────────────────
//
// These id/title shapes are copied from this repository's OWN state.json — the four pairs
// `integrity`'s change-registered-under-two-lanes reports, each one change registered twice
// under different lanes and different names. A human found them by reading the backlog; exact-id
// and externalUrl dedup found none of them. Copied into a fixture rather than read live so the
// test does not depend on state a later session may repair.
const LIVE_PAIRS = [
  { id: "epic-hierarchy-orchestration", lane: "decision",
    title: "Epic-hierarchy orchestration — run a parent epic's children unattended" },
  { id: "2026-07-14-epic-hierarchy-orchestration", lane: "superpowers",
    title: "Epic-Hierarchy Orchestration Implementation Plan" },
  { id: "conductor-mjs-module-split", lane: "openspec",
    title: "Split scripts/conductor.mjs into native ES modules, zero-dependency" },
  { id: "2026-07-21-conductor-mjs-module-split", lane: "superpowers",
    title: "conductor.mjs Module Split Implementation Plan" },
  { id: "edd-harness-agent-behavior-testing", lane: "decision",
    title: "Stand up an EDD harness inside pm to prove SEMANTIC parity across platforms" },
  { id: "2026-07-26-edd-harness-agent-behavior-testing", lane: "superpowers",
    title: "EDD Harness for Agent Behavior Testing — Implementation Plan" },
  { id: "platform-parity-mechanism", lane: "openspec",
    title: "Build the mechanism that keeps every supported platform at parity" },
  { id: "2026-08-03-platform-parity-mechanism", lane: "superpowers",
    title: "Platform parity mechanism implementation plan" },
];

test("triage surfaces the already-registered twin of an ask — the four live pairs exact-id dedup missed", () => {
  const cwd = repoWith(LIVE_PAIRS);
  // For each pair, ask with ONE member's title and require the OTHER member to be surfaced.
  for (let i = 0; i < LIVE_PAIRS.length; i += 2) {
    const [a, b] = [LIVE_PAIRS[i], LIVE_PAIRS[i + 1]];
    for (const [ask, twin] of [[b.title, a.id], [a.title, b.id]]) {
      const ids = triage(cwd, ask).candidates.map(c => c.id);
      assert.ok(ids.includes(twin),
        `triage("${ask}") must surface '${twin}' — got ${JSON.stringify(ids)}`);
    }
  }
});

test("a candidate carries what it takes to READ it, and a shared-token trail saying why it is here", () => {
  const cwd = repoWith(LIVE_PAIRS);
  const c = triage(cwd, "Epic-Hierarchy Orchestration Implementation Plan").candidates
    .find(x => x.id === "epic-hierarchy-orchestration");
  assert.ok(c, "the twin must be a candidate at all");
  for (const k of ["id", "title", "status", "lane", "priority", "score", "shared"]) {
    assert.ok(k in c, `a candidate must carry '${k}' so the agent can read the epic without a second lookup`);
  }
  assert.ok(c.score > 0, "a surfaced candidate must carry a positive score");
  // The trail is the engine SHOWING ITS WORK, which is what makes a lexical surface auditable
  // rather than an oracle. "hierarchy"/"orchestration" are what actually match here.
  assert.ok(c.shared.includes("hierarchy") && c.shared.includes("orchestration"),
    `the shared-token trail must name the distinctive overlap — got ${JSON.stringify(c.shared)}`);
});

// ─────────────────── the ranking is weighted, not a count of shared words ───────────────────

test("a rare shared token beats several ubiquitous ones, which are not evidence at all", () => {
  // Ten epics all carrying the same three words, so those words say nothing about ANY epic.
  const noise = Array.from({ length: 10 }, (_, i) => ({
    id: `noise-${i}`, title: `conductor state render worker ${i}`,
  }));
  const cwd = repoWith([
    ...noise,
    { id: "ubiquitous-three", title: "conductor state render pipeline" },
    // Carries the ubiquitous three AS WELL AS the rare one, so the trail assertion below is
    // about what the engine chose to SHOW rather than about what this epic happens to contain.
    { id: "distinctive-one", title: "conductor state render quokka" },
  ]);
  // A generous limit on purpose, so nothing below is missing merely for being cut off.
  const ranked = triage(cwd, "conductor state render quokka", "--limit", "50").candidates;
  const ids = ranked.map(c => c.id);
  // THREE shared words against ONE. Counting shared words ranks `ubiquitous-three` first and
  // drags all ten noise epics in behind it; weighting each token by how much it narrows the
  // backlog leaves exactly the epic that actually distinguishes.
  assert.deepEqual(ids, ["distinctive-one"],
    `only the epic sharing the RARE token is evidence — got ${JSON.stringify(ranked.map(c => [c.id, c.score]))}`);
  // The trail is what a reader dismisses a bad hit by, so a token carrying no weight must not
  // appear in it — listed there it reads as evidence, and it is the opposite of evidence.
  assert.deepEqual(ranked[0].shared, ["quokka"],
    `the trail must name only the tokens that earned the score — got ${JSON.stringify(ranked[0].shared)}`);
});

test("a word almost every epic uses is not held against a small backlog", () => {
  // The same shape below the threshold where a frequency means anything. Two epics both about
  // quokkas put "quokka" in 100% of the corpus; dropping it there would make the surface answer
  // nothing at exactly the moment it is cheapest to be right.
  const cwd = repoWith([
    { id: "quokka-ingest", title: "quokka telemetry ingestion" },
    { id: "quokka-export", title: "quokka telemetry export" },
  ]);
  const ids = triage(cwd, "quokka telemetry").candidates.map(c => c.id);
  assert.deepEqual(ids.sort(), ["quokka-export", "quokka-ingest"]);
});

test("an ask with nothing in common with the backlog surfaces nothing", () => {
  const cwd = repoWith([
    { id: "alpha", title: "conductor state render" },
    { id: "beta", title: "detour stack reconcile gate" },
  ]);
  const out = triage(cwd, "photosynthesis chlorophyll stomata");
  assert.deepEqual(out.candidates, [],
    "surfacing unrelated epics would train the agent to ignore the whole surface");
});

test("--limit bounds the candidate set", () => {
  const cwd = repoWith(LIVE_PAIRS);
  const out = triage(cwd, "implementation plan orchestration parity harness split", "--limit", "2");
  assert.equal(out.candidates.length, 2);
});

// ───────────────────────────── the engine does not decide ─────────────────────────────

test("the engine states that it reached no verdict, and labels no candidate a duplicate", () => {
  const cwd = repoWith(LIVE_PAIRS);
  const out = triage(cwd, "Epic-Hierarchy Orchestration Implementation Plan");
  assert.equal(out.verdict, null, "a verdict is the agent's to record, never the engine's");
  const raw = run(["triage", "Epic-Hierarchy Orchestration Implementation Plan"], { cwd });
  assert.ok(!/"duplicate"|"same"|"overlaps"\s*:\s*true/.test(raw),
    "the engine must not assert that two asks are the same ask");
});

// ────────────────────────── the rest of what intake needs, cheaply ──────────────────────────

test("triage carries the repo's lane routing and the backlog's shape", () => {
  const cwd = repoWith(LIVE_PAIRS);
  run(["set-lane-routing", "--add", "parity:openspec"], { cwd });
  const out = triage(cwd, "platform parity mechanism");
  assert.deepEqual(out.lane, { lane: "openspec", matched: "parity" },
    "the lane a repo's own routing picks must arrive with the candidates, not need a second call");
  assert.equal(out.backlog.total, LIVE_PAIRS.length);
  assert.equal(out.backlog.byStatus.queued, LIVE_PAIRS.length);
  const none = triage(cwd, "something else entirely");
  assert.deepEqual(none.lane, { lane: null, matched: null });
});

test("a candidate already superseded by another epic says so", () => {
  const cwd = repoWith([
    { id: "old-thing", title: "quokka telemetry ingestion" },
    { id: "new-thing", title: "quokka telemetry ingestion, second attempt",
      links: [{ type: "supersedes", epic: "old-thing", reason: "consolidated at intake" }] },
  ]);
  const byId = Object.fromEntries(
    triage(cwd, "quokka telemetry ingestion").candidates.map(c => [c.id, c]));
  assert.equal(byId["old-thing"].superseded, true,
    "consolidating a fourth ask INTO an epic that is already dead is the mistake this flags");
  assert.equal(byId["new-thing"].superseded, false);
});

test("triage refuses an empty ask and an uninitialized repo rather than answering", () => {
  const cwd = repoWith([{ id: "alpha", title: "a" }]);
  assert.match(runCombined(["triage"], { cwd }), /usage/);
  const bare = tmpRepo();
  assert.match(runCombined(["triage", "anything"], { cwd: bare }), /pm:init/);
});

// ─────────────────────── recording the decision: `declined` ───────────────────────

test("`declined` is a terminal outcome, and it demands its reason like every non-delivered one", async () => {
  const { KNOWN_OUTCOMES, dispositionError } = await import(DISPOSITION);
  assert.ok(KNOWN_OUTCOMES.includes("declined"),
    "an ask that is considered and turned down must be recordable — declining by never " +
    "registering it is exactly the lost record #95 ruled against");
  assert.ok(dispositionError({ outcome: "declined" }),
    "a decline with no reason is indistinguishable from an ask nobody looked at");
  assert.equal(dispositionError({ outcome: "declined", reason: "already covered by gh-70" }), null);
});

test("an ask can be registered and declined end to end, and the record keeps the reason", () => {
  const cwd = repoWith([{ id: "existing-validator", title: "link format validation" }]);
  run(["add-epic", "--id", "asked-for-thing", "--lane", "claude-code", "--status", "untriaged",
    "--title", "Validate link types against a known set"], { cwd });
  run(["update-epic", "asked-for-thing", "--status", "archived", "--outcome", "declined",
    "--reason", "already covered by existing-validator", "--no-deferrals"], { cwd });
  const e = readState(cwd).epics.find(x => x.id === "asked-for-thing");
  assert.equal(e.status, "archived");
  assert.equal(e.disposition.outcome, "declined");
  assert.match(e.disposition.reason, /existing-validator/);
  assert.ok(!e.disposition.recordedBy, "a decline is the agent's judgment, not an engine stamp");
  const md = fs.readFileSync(path.join(cwd, "PROJECT.md"), "utf8");
  assert.match(md, /declined/, "a decline must be visible in the rendered record");
});

test("a declined epic is out of the completion-shaped checks' scope", async () => {
  const { inCompletionScope } = await import(new URL("../lib/integrity.mjs", import.meta.url).href);
  // A declined ask has zero ticked tasks and no gate verdict BY CONSTRUCTION — nobody ever
  // worked it. Leaving it in scope makes every recorded decline a permanent integrity finding,
  // which is how a team learns to stop recording them.
  assert.equal(inCompletionScope({ id: "d", disposition: { outcome: "declined", reason: "x" } }), false);
  assert.equal(inCompletionScope({ id: "u", disposition: { outcome: "unknown" } }), true,
    "`unknown` must STAY in scope — that exclusion is the one this check exists for");
});

// ─────────────────────── the judgment half: the emitted instruction ───────────────────────

test("the rules block instructs the agent to triage an ask before registering it", () => {
  const cwd = repoWith([{ id: "alpha", title: "a" }]);
  const block = run(["rules"], { cwd });
  assert.match(block, /## Intake/, "intake must be a section of its own, not a sentence inside another");
  assert.match(block, /triage "/, "the rules must name the command that produces the candidate set");
  assert.match(block, /--outcome declined/, "the rules must say how a 'no' is recorded");
  // The rule has to reach EVERY registration path, and the tracker-sync procedures are the two
  // that already carry a dedup step of their own — a reader who follows only those must be told
  // theirs is identity-based and does not cover this.
  assert.match(block, /externalUrl/,
    "the intake section must name the identity-based dedup it is NOT a substitute for");
});

test("a triage verb exists and is dispatched", () => {
  assert.match(run(["--help"]), /triage/, "the usage line must name it");
});

test("the scorer is a pure function of the epics it is given", async () => {
  const { candidateSet } = await import(TRIAGE);
  const epics = [{ id: "quokka-telemetry", title: "quokka telemetry" }, { id: "other", title: "render" }];
  const a = candidateSet(epics, "quokka telemetry", { limit: 5 });
  const b = candidateSet(epics, "quokka telemetry", { limit: 5 });
  assert.deepEqual(a, b, "same input, same output — no clock, no filesystem, no ordering luck");
  assert.equal(a[0].id, "quokka-telemetry");
});
