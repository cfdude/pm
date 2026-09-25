// scripts/test/unit/triage.test.mjs
// 4.1's migration of `assert/triage.test.mjs` — 19 of its 19 tests, moved from the file rung to the
// unit rung with every assertion unchanged. The file is GONE from the file rung.
//
// Intake triage (gh-112) — the MECHANICAL half of admitting an ask.
//
// The line this suite pins: the engine computes a CANDIDATE SET and never a VERDICT. Every
// test below either checks that the candidate set is real (it surfaces the thing a human found
// by reading), or that the engine declines to judge. A test that only asserted "valid JSON with
// these keys" would pass with the candidate list hard-coded empty, which is the mutation these
// were written against.
//
// WHY THE WHOLE FILE MOVED: `repoWith()` writes a whole record and every observable afterwards is a
// VALUE — the JSON payload `triage` prints, the rules block it prints, PROJECT.md (a store-owned
// artifact) — so the fixture's record becomes the record the memory store is seeded with. The two
// `new URL(…).href` module specifiers are dynamic IMPORTS of lib modules rather than path reads, so
// they are unchanged; the only file read left in the original was PROJECT.md, and it is the store's.

import assert from "node:assert/strict";
import { emptyRecord, memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";

const TRIAGE = new URL("../../lib/triage.mjs", import.meta.url).href;
const DISPOSITION = new URL("../../lib/disposition.mjs", import.meta.url).href;

/** A repo whose state holds exactly `epics`, each entry `{id, title, description?, ...}`. */
function repoWith(epics) {
  const engine = memoryEngine({
    ...emptyRecord(),
    epics: epics.map(e => ({
      priority: "P2", status: "queued", role: "epic", lane: "superpowers",
      links: [], reconcileNeeded: false, ...e,
    })),
    active: null,
  });
  return engine;
}

const triage = (engine, ask, ...flags) => JSON.parse(engine(["triage", ask, ...flags]));
const readState = (engine) => engine.store.record();

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

unitTest("triage surfaces the already-registered twin of an ask — the four live pairs exact-id dedup missed", () => {
  const engine = repoWith(LIVE_PAIRS);
  // For each pair, ask with ONE member's title and require the OTHER member to be surfaced.
  for (let i = 0; i < LIVE_PAIRS.length; i += 2) {
    const [a, b] = [LIVE_PAIRS[i], LIVE_PAIRS[i + 1]];
    for (const [ask, twin] of [[b.title, a.id], [a.title, b.id]]) {
      const ids = triage(engine, ask).candidates.map(c => c.id);
      assert.ok(ids.includes(twin),
        `triage("${ask}") must surface '${twin}' — got ${JSON.stringify(ids)}`);
    }
  }
});

unitTest("a candidate carries what it takes to READ it, and a shared-token trail saying why it is here", () => {
  const engine = repoWith(LIVE_PAIRS);
  const c = triage(engine, "Epic-Hierarchy Orchestration Implementation Plan").candidates
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

unitTest("a rare shared token beats several ubiquitous ones, which are not evidence at all", () => {
  // Ten epics all carrying the same three words, so those words say nothing about ANY epic.
  const noise = Array.from({ length: 10 }, (_, i) => ({
    id: `noise-${i}`, title: `conductor state render worker ${i}`,
  }));
  const engine = repoWith([
    ...noise,
    { id: "ubiquitous-three", title: "conductor state render pipeline" },
    // Carries the ubiquitous three AS WELL AS the rare one, so the trail assertion below is
    // about what the engine chose to SHOW rather than about what this epic happens to contain.
    { id: "distinctive-one", title: "conductor state render quokka" },
  ]);
  // A generous limit on purpose, so nothing below is missing merely for being cut off.
  const ranked = triage(engine, "conductor state render quokka", "--limit", "50").candidates;
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

unitTest("a word almost every epic uses is not held against a small backlog", () => {
  // The same shape below the threshold where a frequency means anything. Two epics both about
  // quokkas put "quokka" in 100% of the corpus; dropping it there would make the surface answer
  // nothing at exactly the moment it is cheapest to be right.
  const engine = repoWith([
    { id: "quokka-ingest", title: "quokka telemetry ingestion" },
    { id: "quokka-export", title: "quokka telemetry export" },
  ]);
  const ids = triage(engine, "quokka telemetry").candidates.map(c => c.id);
  assert.deepEqual(ids.sort(), ["quokka-export", "quokka-ingest"]);
});

unitTest("an ask with nothing in common with the backlog surfaces nothing", () => {
  const engine = repoWith([
    { id: "alpha", title: "conductor state render" },
    { id: "beta", title: "detour stack reconcile gate" },
  ]);
  const out = triage(engine, "photosynthesis chlorophyll stomata");
  assert.deepEqual(out.candidates, [],
    "surfacing unrelated epics would train the agent to ignore the whole surface");
});

unitTest("--limit bounds the candidate set", () => {
  const engine = repoWith(LIVE_PAIRS);
  const out = triage(engine, "implementation plan orchestration parity harness split", "--limit", "2");
  assert.equal(out.candidates.length, 2);
});

// ───────────────────────────── the engine does not decide ─────────────────────────────

unitTest("the engine states that it reached no verdict, and labels no candidate a duplicate", () => {
  const engine = repoWith(LIVE_PAIRS);
  const out = triage(engine, "Epic-Hierarchy Orchestration Implementation Plan");
  assert.equal(out.verdict, null, "a verdict is the agent's to record, never the engine's");
  const raw = engine(["triage", "Epic-Hierarchy Orchestration Implementation Plan"]);
  assert.ok(!/"duplicate"|"same"|"overlaps"\s*:\s*true/.test(raw),
    "the engine must not assert that two asks are the same ask");
});

// ────────────────────────── the rest of what intake needs, cheaply ──────────────────────────

unitTest("triage carries the repo's lane routing and the backlog's shape", () => {
  const engine = repoWith(LIVE_PAIRS);
  engine(["set-lane-routing", "--add", "parity:openspec"]);
  const out = triage(engine, "platform parity mechanism");
  assert.deepEqual(out.lane, { lane: "openspec", matched: "parity" },
    "the lane a repo's own routing picks must arrive with the candidates, not need a second call");
  assert.equal(out.backlog.total, LIVE_PAIRS.length);
  assert.equal(out.backlog.byStatus.queued, LIVE_PAIRS.length);
  const none = triage(engine, "something else entirely");
  assert.deepEqual(none.lane, { lane: null, matched: null });
});

unitTest("a candidate already superseded by another epic says so", () => {
  const engine = repoWith([
    { id: "old-thing", title: "quokka telemetry ingestion" },
    { id: "new-thing", title: "quokka telemetry ingestion, second attempt",
      links: [{ type: "supersedes", epic: "old-thing", reason: "consolidated at intake" }] },
  ]);
  const byId = Object.fromEntries(
    triage(engine, "quokka telemetry ingestion").candidates.map(c => [c.id, c]));
  assert.equal(byId["old-thing"].superseded, true,
    "consolidating a fourth ask INTO an epic that is already dead is the mistake this flags");
  assert.equal(byId["new-thing"].superseded, false);
});

unitTest("a --limit that is not a positive integer is REFUSED, never coerced", () => {
  const engine = repoWith(LIVE_PAIRS);
  // A valueless flag arrives from parseFlags as boolean `true`, and `Number(true)` is 1 — so a
  // coercing read answers with exactly ONE candidate: exit 0, plausible output, wrong result,
  // invisible. That is #79's shape, and `add-epic` already refuses a valueless `--description`
  // for it. `--limit abc` is the same failure wearing a different value.
  for (const argv of [["--limit"], ["--limit", "abc"], ["--limit", "0"], ["--limit", "-3"]]) {
    const out = engine.combined(["triage", "Epic-Hierarchy Orchestration Implementation Plan", ...argv]);
    assert.match(out, /--limit/, `\`triage … ${argv.join(" ")}\` must name the flag it refused — got ${out}`);
    assert.doesNotMatch(out, /"candidates"/,
      `\`triage … ${argv.join(" ")}\` must not answer at all — a wrong bound is worse than a refusal`);
  }
  assert.equal(triage(engine, "Epic-Hierarchy Orchestration Implementation Plan", "--limit", "3")
    .candidates.length <= 3, true, "a real limit still works, so the refusal above is a decision");
});

unitTest("triage rejects an unknown flag by name instead of ignoring it", () => {
  const engine = repoWith(LIVE_PAIRS);
  const out = engine.combined(["triage", "an ask", "--min-score", "0.4"]);
  assert.match(out, /min-score/, "the refusal must name the flag that was not understood");
  assert.match(out, /--limit/, "…and name what IS accepted, so the caller can fix it in one step");
  assert.doesNotMatch(out, /"candidates"/, "a silently dropped flag is a silently wrong answer");
});

unitTest("triage refuses an empty ask and an uninitialized repo rather than answering", () => {
  const engine = repoWith([{ id: "alpha", title: "a" }]);
  assert.match(engine.combined(["triage"]), /usage/);
  const bare = memoryEngine();
  assert.match(bare.combined(["triage", "anything"]), /pm:init/);
});

// ─────────────────────── recording the decision: `declined` ───────────────────────

unitTest("`declined` is a terminal outcome, and it demands its reason like every non-delivered one", async () => {
  const { KNOWN_OUTCOMES, dispositionError } = await import(DISPOSITION);
  assert.ok(KNOWN_OUTCOMES.includes("declined"),
    "an ask that is considered and turned down must be recordable — declining by never " +
    "registering it is exactly the lost record #95 ruled against");
  assert.ok(dispositionError({ outcome: "declined" }),
    "a decline with no reason is indistinguishable from an ask nobody looked at");
  assert.equal(dispositionError({ outcome: "declined", reason: "already covered by gh-70" }), null);
});

unitTest("an ask can be registered and declined end to end, and the record keeps the reason", () => {
  const engine = repoWith([{ id: "existing-validator", title: "link format validation" }]);
  engine(["add-epic", "--id", "asked-for-thing", "--lane", "claude-code", "--status", "untriaged",
    "--title", "Validate link types against a known set"]);
  engine(["update-epic", "asked-for-thing", "--status", "archived", "--outcome", "declined",
    "--reason", "already covered by existing-validator", "--no-deferrals"]);
  const e = readState(engine).epics.find(x => x.id === "asked-for-thing");
  assert.equal(e.status, "archived");
  assert.equal(e.disposition.outcome, "declined");
  assert.match(e.disposition.reason, /existing-validator/);
  assert.ok(!e.disposition.recordedBy, "a decline is the agent's judgment, not an engine stamp");
  const md = engine.store.read("PROJECT.md").text;
  assert.match(md, /declined/, "a decline must be visible in the rendered record");
});

unitTest("a declined epic is out of the completion-shaped checks' scope", async () => {
  const { inCompletionScope } = await import(new URL("../../lib/integrity.mjs", import.meta.url).href);
  // A declined ask has zero ticked tasks and no gate verdict BY CONSTRUCTION — nobody ever
  // worked it. Leaving it in scope makes every recorded decline a permanent integrity finding,
  // which is how a team learns to stop recording them.
  assert.equal(inCompletionScope({ id: "d", disposition: { outcome: "declined", reason: "x" } }), false);
  assert.equal(inCompletionScope({ id: "u", disposition: { outcome: "unknown" } }), true,
    "`unknown` must STAY in scope — that exclusion is the one this check exists for");
});

// ─────────────────────── the judgment half: the emitted instruction ───────────────────────

unitTest("the rules block instructs the agent to triage an ask before registering it", () => {
  const engine = repoWith([{ id: "alpha", title: "a" }]);
  const block = engine(["rules"]);
  assert.match(block, /## Intake/, "intake must be a section of its own, not a sentence inside another");
  assert.match(block, /triage "/, "the rules must name the command that produces the candidate set");
  assert.match(block, /--outcome declined/, "the rules must say how a 'no' is recorded");
  // The rule has to reach EVERY registration path, and the tracker-sync procedures are the two
  // that already carry a dedup step of their own — a reader who follows only those must be told
  // theirs is identity-based and does not cover this.
  assert.match(block, /externalUrl/,
    "the intake section must name the identity-based dedup it is NOT a substitute for");
});

unitTest("a triage verb exists and is dispatched", () => {
  assert.match(memoryEngine()(["--help"]), /triage/, "the usage line must name it");
});

unitTest("the scorer is a pure function of the epics it is given", async () => {
  const { candidateSet } = await import(TRIAGE);
  const epics = [{ id: "quokka-telemetry", title: "quokka telemetry" }, { id: "other", title: "render" }];
  const a = candidateSet(epics, "quokka telemetry", { limit: 5 });
  const b = candidateSet(epics, "quokka telemetry", { limit: 5 });
  assert.deepEqual(a, b, "same input, same output — no clock, no filesystem, no ordering luck");
  assert.equal(a[0].id, "quokka-telemetry");
});

// ───────────── user-text-never-forges-output, Gate 2 U2-M1: JSON stdout carries no raw line terminator ─────────────
// JSON.stringify escapes C0 inside a string but leaves DEL, the C1 controls (NEL among them) and
// U+2028/U+2029 raw, so a legacy stored value put a line start into a JSON verb's stdout for any
// reader that splits lines before it parses. Written as `\u` escapes instead: valid JSON, same value.
unitTest("U2-M1: a legacy status holding U+2028, NEL and DEL reaches triage's JSON escaped, and parses to the stored value", () => {
  const ch = (n) => String.fromCharCode(n);
  const status = "queued" + ch(0x2028) + "FORGED" + ch(0x85) + "FORGED" + ch(0x7f) + ch(0x2029);
  const engine = repoWith([{ id: "json-poison", title: "escape the json poison surface", status }]);
  const out = engine(["triage", "json poison surface"]);
  for (const c of [0x2028, 0x2029, 0x85, 0x7f]) assert.ok(!out.includes(ch(c)), `stdout holds no raw U+${c.toString(16).padStart(4, "0")}`);
  const parsed = JSON.parse(out);
  const hit = parsed.candidates.find(x => x.id === "json-poison");
  assert.ok(hit, "non-vacuity: the poisoned epic is a candidate");
  assert.equal(hit.status, status, "the parsed value is exactly the stored value");
  assert.equal(parsed.backlog.byStatus[status], 1);
});

// ───────────── triage-ignores-non-latin-text (code review 0.43.0, D1) ─────────────
// tokenize() split on [^a-z0-9], so every letter outside ASCII was a separator: an epic titled in
// Cyrillic and the identical ask both reduced to ZERO tokens and triage answered `candidates: []` —
// the same answer as "no overlap" at intake's mandatory first step. The titles are built from code
// points so this file carries no literal it has to trust an editor to have preserved.
const cp = (...ns) => String.fromCodePoint(...ns);
// "Экспорт отчётов" — "export of reports"
const CYRILLIC_TITLE = cp(0x42d, 0x43a, 0x441, 0x43f, 0x43e, 0x440, 0x442) + " " +
  cp(0x43e, 0x442, 0x447, 0x451, 0x442, 0x43e, 0x432);
// "Größe ändern" — letters with diacritics inside an otherwise Latin word
const GERMAN_TITLE = "Gr" + cp(0xf6, 0xdf) + "e " + cp(0xe4) + "ndern";

unitTest("a Cyrillic epic is a candidate for the identical ask", () => {
  const engine = repoWith([
    { id: "reports-export", title: CYRILLIC_TITLE },
    { id: "unrelated", title: "render the backlog table" },
  ]);
  const got = triage(engine, CYRILLIC_TITLE);
  assert.deepEqual(got.candidates.map(c => c.id), ["reports-export"]);
});

unitTest("tokenize keeps letters outside ASCII inside their word, and still splits on punctuation", async () => {
  const { tokenize } = await import(TRIAGE);
  assert.deepEqual(tokenize(GERMAN_TITLE), [("Gr" + cp(0xf6, 0xdf) + "e").toLowerCase(), cp(0xe4) + "ndern"],
    "an umlaut is a letter, not a separator that cuts a word in two");
  assert.deepEqual(tokenize("Epic-Hierarchy Orchestration"), ["epic", "hierarchy", "orchestration"]);
  assert.deepEqual(tokenize(CYRILLIC_TITLE).length, 2);
});

unitTest("a decomposed accent is the same word as the composed one — NFC before the split", async () => {
  const { tokenize } = await import(TRIAGE);
  // "a" + COMBINING DIAERESIS: without NFC the mark is a separate code point; without \p{M} it splits the word.
  assert.deepEqual(tokenize(cp(0x61, 0x308) + "ndern"), tokenize(cp(0xe4) + "ndern"));
});
