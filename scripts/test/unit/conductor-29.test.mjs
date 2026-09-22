// scripts/test/unit/conductor-29.test.mjs
// 4.1's migration of `assert/conductor-29.test.mjs` — 15 of its 19 tests, moved from the file rung to
// the unit rung with every assertion unchanged.
//
// gh#100 — the link-type vocabulary: a known set, derived from what the code READS, validated
// on write, and reported (never rewritten) where a record already holds something else.
// gh#94 — serial deferral: made VISIBLE where a stack already renders, with no threshold and
// no imperative. See the header comment on deferralHistory() in lib/links.mjs for why.
//
// ─────────────── WHAT MOVED, AND WHAT DID NOT ───────────────
//
// FIFTEEN moved: the union-of-three-bands invariant, the five write-path tests (add-epic, update-epic,
// the every-known-type sweep, add-many and the usage line), the three legacy-stored-type tests, and
// the whole gh#94 deferral family — the two pure-function tests plus the brief/stderr disclosures.
// Every one of their observables is a value: a refusal message, a JSON payload, the rendered
// PROJECT.md (a store-owned artifact) or the record's own bytes.
//
// FOUR STAY, and all four are SOURCE reads: gh#100's own `rg 'KNOWN_[A-Z_]+ =' constants.mjs`
// reproduction, the two drift guards (one walks every engine source file, one opens each file a
// declaration claims) and `commands/epic.md`. They are the shape-based half of gh#100's own
// requirement, and this half may not read a path.
//
//   `tmpRepo()` + `run(["init"], { cwd })`  →  `memoryEngine(emptyRecord())`
//   `seed(cwd, epics, extra)`               →  `memoryEngine({ …, epics, …extra })`
//   `readState(cwd)`                        →  `engine.store.record()`
//   `parseBrief(cwd)`                       →  `JSON.parse(engine(["brief"])).hookSpecificOutput…`

import assert from "node:assert/strict";
import { emptyRecord, expectFail, memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";
import {
  KNOWN_LINK_TYPES, LINK_TYPES_READ, LINK_TYPES_WRITTEN, LINK_TYPES_ANNOTATION,
  isKnownLinkType, deferralHistory, ordinal,
} from "../../lib/links.mjs";

const readState = (engine) => engine.store.record();
const epic = (id, over = {}) => ({
  id, title: id, priority: "P2", status: "queued", role: "epic", lane: "claude-code",
  stories: [], links: [], ...over,
});
/** `seed()`'s fixture IS the record it wrote, so the memory store is handed it directly. */
const seed = (epics, extra = {}) => memoryEngine({ version: 1, active: null, epics, detourStack: [], ...extra });
const parseBrief = (engine) => {
  const out = engine(["brief"]);
  return out.trim() ? JSON.parse(out).hookSpecificOutput.additionalContext : "";
};

// ---------------------------------------------------------------- gh#100: the known set

unitTest("KNOWN_LINK_TYPES is the union of the three bands, with no duplicates", () => {
  const expected = [
    ...LINK_TYPES_READ.map(t => t.type),
    ...LINK_TYPES_WRITTEN.map(t => t.type),
    ...LINK_TYPES_ANNOTATION,
  ];
  assert.deepEqual(KNOWN_LINK_TYPES, expected);
  assert.equal(new Set(KNOWN_LINK_TYPES).size, KNOWN_LINK_TYPES.length);
  assert.ok(isKnownLinkType("depends-on"));
  assert.ok(!isKnownLinkType("depends_on"));
});

// ---------------------------------------------------------------- gh#100: validation on write

unitTest("add-epic --link refuses an unknown type and names the valid set", () => {
  const engine = seed([epic("a")]);
  const err = expectFail(() => engine(["add-epic", "--id", "b", "--title", "B", "--lane", "claude-code",
    "--link", "depends_on:a"]));
  assert.ok(err, "an unknown link type was accepted");
  const msg = err.stderr || String(err);
  assert.match(msg, /depends_on/);
  assert.match(msg, /not a known link type/);
  for (const t of KNOWN_LINK_TYPES) assert.ok(msg.includes(t), `the refusal does not name '${t}'`);
  // The actual back-compat wall: a user hits this while re-passing a link they did not author.
  // The message must say what to do about it — and under APPEND that remedy is `--clear-links`
  // plus the corrected set in one invocation, since a corrected type is a different identity
  // and would leave the malformed link in place. Anchored on the flag, not on "replaces", which
  // was the old behaviour's wording.
  assert.match(msg, /--clear-links/);
  assert.ok(!readState(engine).epics.some(e => e.id === "b"), "the epic was written anyway");
});

unitTest("update-epic --link refuses an unknown type, and leaves the existing links untouched", () => {
  const engine = seed([epic("a"), epic("b", { links: [{ type: "relates-to", epic: "a" }] })]);
  const err = expectFail(() => engine(["update-epic", "b", "--link", "realtes-to:a"]));
  assert.ok(err, "an unknown link type was accepted");
  assert.match(err.stderr || String(err), /realtes-to/);
  assert.deepEqual(readState(engine).epics.find(e => e.id === "b").links, [{ type: "relates-to", epic: "a" }]);
});

unitTest("every known type is accepted on write", () => {
  const engine = seed([epic("a"), epic("b")]);
  // `--link` APPENDS, and each type is a distinct identity against the same target, so the
  // array GROWS by one per iteration. It previously asserted a one-element array because the
  // flag replaced wholesale; asserting the last element alone would pass against an
  // implementation that still replaced, so the whole array is compared.
  const expected = [];
  for (const t of KNOWN_LINK_TYPES) {
    engine(["update-epic", "b", "--link", `${t}:a:why`]);
    // A hand-supplied may-invalidate link carries an explicit FALSE arming record: only
    // push-detour --reconcile arms a reconcile obligation (gates-bind-to-verified-evidence).
    expected.push(t === "may-invalidate"
      ? { type: t, epic: "a", reason: "why", reconcileOnResume: false }
      : { type: t, epic: "a", reason: "why" });
    assert.deepEqual(readState(engine).epics.find(e => e.id === "b").links, expected);
  }
});

unitTest("add-many refuses an unknown type too — the sibling write path, not just parseLinkFlags", () => {
  // The call-site sweep's finding: `--link` goes through parseLinkFlags, but an add-many batch
  // entry's `links` is a JSON array copied verbatim. A guard at one and not the other is the
  // absent edit neither gate can see.
  const engine = seed([epic("a")]);
  const batch = JSON.stringify({ epics: [
    { id: "b", lane: "claude-code", links: [{ type: "depends_on", epic: "a" }] }] });
  const err = expectFail(() => engine(["add-many", "--from", "-"], { input: batch }));
  assert.ok(err, "add-many accepted an unknown link type");
  assert.match(err.stderr || String(err), /depends_on/);
  assert.ok(!readState(engine).epics.some(e => e.id === "b"));

  const ok = JSON.stringify({ epics: [
    { id: "b", lane: "claude-code", links: [{ type: "depends-on", epic: "a" }] }] });
  engine(["add-many", "--from", "-"], { input: ok });
  assert.deepEqual(readState(engine).epics.find(e => e.id === "b").links, [{ type: "depends-on", epic: "a" }]);
});

unitTest("the usage line publishes the vocabulary, not just the syntax", () => {
  // gh#100 item 5: "the help string is where an agent looks first". update-epic is the verb
  // that HAS a usage line (add-epic refuses per-flag instead of printing one), so this is where
  // the vocabulary goes; add-epic's surface is the refusal message, covered above.
  const engine = memoryEngine(emptyRecord());
  const out = engine.combined(["update-epic"]);
  assert.match(out, /--link/);
  for (const t of KNOWN_LINK_TYPES) {
    assert.ok(out.includes(t), `update-epic's usage does not name the link type '${t}'`);
  }
});

// ------------------------------------------- gh#100: records already holding an unknown type

unitTest("a stored unknown type still loads and still renders — validation is on WRITE only", () => {
  const engine = seed([epic("a"), epic("b", { links: [{ type: "relates", epic: "a", reason: "legacy" }] })]);
  engine(["render"]);
  const project = engine.store.read("PROJECT.md").text;
  assert.match(project, /relates→a/, "a legacy link stopped rendering — the record became unreadable");
  assert.deepEqual(readState(engine).epics.find(e => e.id === "b").links,
    [{ type: "relates", epic: "a", reason: "legacy" }], "the stored type was rewritten");
});

unitTest("integrity reports a stored unknown type as an inert edge, and repairs nothing", () => {
  const engine = seed([epic("a"), epic("b", { links: [{ type: "relates", epic: "a" }] })]);
  const before = engine.store.read("state.json").text;
  const out = engine.combined(["integrity"]);
  assert.match(out, /link-of-unknown-type — 1 finding/);
  assert.match(out, /relates/);
  assert.equal(engine.store.read("state.json").text, before,
    "integrity wrote to the record it is auditing");
});

unitTest("integrity says nothing when every stored type is known", () => {
  const engine = seed([epic("a"), epic("b", { links: [{ type: "depends-on", epic: "a" }] })]);
  assert.match(engine.combined(["integrity"]), /link-of-unknown-type — 0 finding/);
});

// ---------------------------------------------------------------- gh#94: deferral visibility

unitTest("deferralHistory counts DISTINCT detours recorded against an epic, live frame included", () => {
  const state = {
    epics: [{ id: "p", links: [
      { type: "may-invalidate", epic: "d1" },
      { type: "may-invalidate", epic: "d2" },
      { type: "relates-to", epic: "d3" },
    ] }],
    detourStack: [{ pausedEpic: "p", pausedAt: "2026-08-01T00:00:00.000Z", spawnedDetour: "d2" },
      { pausedEpic: "p", pausedAt: "2026-08-10T00:00:00.000Z", spawnedDetour: "d4" }],
  };
  const h = deferralHistory(state, "p");
  assert.deepEqual(h.detours, ["d1", "d2", "d4"]);
  assert.equal(h.count, 3);
  assert.equal(h.pausedAt, "2026-08-01T00:00:00.000Z", "the OLDEST live pause is the one that matters");
  assert.deepEqual(deferralHistory(state, "nobody"), { count: 0, detours: [], pausedAt: null });
});

unitTest("ordinal reads as English for the numbers a deferral count can reach", () => {
  assert.equal(ordinal(1), "1st");
  assert.equal(ordinal(2), "2nd");
  assert.equal(ordinal(3), "3rd");
  assert.equal(ordinal(4), "4th");
  assert.equal(ordinal(11), "11th");
  assert.equal(ordinal(21), "21st");
});

unitTest("the brief's detour stack shows how long a pause has run and how often it has recurred", () => {
  const elevenDaysAgo = new Date(Date.now() - 11 * 864e5).toISOString();
  const engine = seed([
    epic("p", { status: "paused", links: [
      { type: "may-invalidate", epic: "d1" }, { type: "may-invalidate", epic: "d2" }] }),
    epic("d1", { status: "archived", role: "detour" }),
    epic("d2", { status: "active", role: "detour" }),
  ], { detourStack: [{ pausedEpic: "p", pausedAt: elevenDaysAgo, reason: "blocked", spawnedDetour: "d2", reconcileOnResume: true }] });
  const brief = parseBrief(engine);
  assert.match(brief, /paused 11d/);
  assert.match(brief, /2nd deferral/);
  assert.match(brief, /d1, d2/);
  // Information, not judgment: the engine has no evidence for a threshold, so it must not
  // issue one. See the deferralHistory() header comment.
  const line = brief.split("\n").find(l => /2nd deferral/.test(l));
  assert.doesNotMatch(line, /should|too many|stop|⚠/);
});

unitTest("a first deferral gets no recurrence clause — the first detour is the mechanism working", () => {
  const engine = seed([epic("p", { status: "paused" }), epic("d1", { status: "active", role: "detour" })],
    { detourStack: [{ pausedEpic: "p", pausedAt: new Date().toISOString(), reason: "blocked", spawnedDetour: "d1" }] });
  const brief = parseBrief(engine);
  assert.match(brief, /paused `p`/);
  assert.doesNotMatch(brief, /deferral/);
});

unitTest("honcho-memory push discloses a repeat deferral on stderr, leaving stdout paste-clean", () => {
  const engine = seed([epic("p", { links: [{ type: "may-invalidate", epic: "d1" }, { type: "may-invalidate", epic: "d2" }] }),
    epic("d1"), epic("d2")]);
  const combined = engine.combined(["honcho-memory", "push", "p", "a blocker"]);
  assert.match(combined, /2nd deferral/);
  assert.match(combined, /d1, d2/);
  // The stdout contract is a line an agent pastes into Honcho verbatim; a disclosure that
  // leaked into it would be pasted too.
  assert.equal(engine(["honcho-memory", "push", "p", "a blocker"]), "paused p for a blocker\n");
});

unitTest("honcho-memory push says nothing extra on a first deferral", () => {
  const engine = seed([epic("p", { links: [{ type: "may-invalidate", epic: "d1" }] }), epic("d1")]);
  assert.doesNotMatch(engine.combined(["honcho-memory", "push", "p", "a blocker"]), /deferral/);
});
