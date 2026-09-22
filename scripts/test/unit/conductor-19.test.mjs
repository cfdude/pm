// scripts/test/unit/conductor-19.test.mjs
// 4.1's migration of `assert/conductor-19.test.mjs` — 5 of its 5 tests, moved from the file rung to
// the unit rung with every assertion unchanged. The file is GONE from the file rung.
//
// gh-138 — the never-re-read warning counted epics whose work can never happen.
//
// The brief's freshness line ("N tracker-linked epic(s) never re-read since mirroring") counted
// every linked epic with no watermark, terminal ones included. Measured on this repository when
// the issue was filed: 59 counted, of which 29 were archived or had an already-closed item. Half
// the number was work that could never happen — and `/pm:sync`, the remedy the line names,
// provably could not clear those 29, because they have no open item to read. An inflated count
// is how a true warning gets ignored, and the line naming an action that cannot clear its own
// number is the defect.
//
// THE SPLIT. The engine cannot know an item is CLOSED without integration, which pm must never
// do. So the status half is the engine's — a pure function of `state.json` — and the closed half
// belongs to the inward-sync instruction the agent already runs, which lists open items anyway.
// `closedItemStep()` in rules.mjs already ships that half, and already ships this semantics in
// so many words: "An epic that is already `archived` owes nothing here — it ended, and a record
// that ended does not need a second ending." The engine counting those 29 was the engine
// contradicting text it emits. The two halves compose with no new machinery: the instruction
// turns "item closed" into "epic archived", and the filter here turns "archived" into "owes no
// refresh". A separate terminal WATERMARK was weighed and rejected as redundant — it would be a
// second mechanism for something the disposition already accomplishes, needing its own writer,
// its own verb and its own staleness story.
//
// NOTHING HERE ASSERTS A LIVE NUMBER. Every expectation is a RELATION computed from the fixture
// the test itself built (docs/lessons/hardcoded-live-data-claims-rot.md): a test pinning "59" or
// "30" against the live record breaks the moment an epic is added, and the likely response is to
// weaken the check rather than fix the number. Live figures appear only as dated comments.
//
// WHY THE WHOLE FILE MOVED: both surfaces it reads are the STORE's. The brief is printed by the
// verb (`parseBrief` runs `brief` and parses the payload) and PROJECT.md is an artifact the store
// owns — `projectMd(cwd)`'s `readFileSync` becomes `store.read("PROJECT.md").text`. The fixture's
// `writeState` becomes the store's own `writeRecord`, which is the same write through the seam
// instead of around it.

import assert from "node:assert/strict";
import { emptyRecord, memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";

const FRESHNESS = /(\d+) tracker-linked epic\(s\) never re-read since mirroring/;

/** `parseBrief()`'s store sibling: the verb prints the payload, so the text is the value. */
const parseBrief = (engine) => {
  const out = engine(["brief"]);
  return out.trim() ? JSON.parse(out).hookSpecificOutput.additionalContext : "";
};
const projectMd = (engine) => engine.store.read("PROJECT.md").text;

/** A repo under an inward tracker holding `open` non-terminal linked epics and `ended` archived
 *  ones — every one of them tracker-linked and carrying NO watermark, so status is the only
 *  thing that can separate them. */
function mixedRepo({ open, ended }) {
  const engine = memoryEngine(emptyRecord());
  const link = (id, n) => engine(["add-epic", "--id", id, "--lane", "claude-code",
    "--external-id", String(n), "--external-url", `https://x.test/${n}`]);
  for (let i = 1; i <= open; i++) link(`open-${i}`, i);
  for (let i = 1; i <= ended; i++) {
    link(`ended-${i}`, open + i);
    // The disposition IS the discharge — recorded through the ordinary gated verb, both halves
    // in one invocation, exactly as the rules block requires of any ending.
    engine(["update-epic", `ended-${i}`, "--status", "archived", "--outcome", "delivered",
      "--no-deferrals"]);
  }
  const state = engine.store.record();
  state.tracker = { system: "github-issues", repo: "o/n" };
  engine.store.writeRecord(state);
  // The direct write bypasses the render, so PROJECT.md still holds the pre-tracker render —
  // re-render explicitly, or the on-disk surface answers a question the state no longer asks.
  engine(["render"]);
  return engine;
}

const freshnessCount = text => {
  const m = text.match(FRESHNESS);
  return m ? Number(m[1]) : 0;
};

unitTest("the freshness count names the non-terminal linked set, not every linked epic", () => {
  // Deliberately more ended than open, so a count that ignores status cannot coincide with one
  // that honours it, and neither can coincide with zero.
  const OPEN = 3, ENDED = 5;
  const engine = mixedRepo({ open: OPEN, ended: ENDED });
  const brief = parseBrief(engine);
  assert.ok(FRESHNESS.test(brief), "epics that can still become work must still be reported");
  assert.equal(freshnessCount(brief), OPEN,
    "an epic that ended owes no refresh — the count is the non-terminal linked set");
});

unitTest("archiving one counted epic decrements the count by exactly one", () => {
  // The relation that survives the live record growing: whatever the count is, ending a member
  // of the counted set removes it and nothing else.
  const engine = mixedRepo({ open: 4, ended: 1 });
  const before = freshnessCount(parseBrief(engine));
  assert.ok(before > 0, "the fixture must have something to decrement");
  engine(["update-epic", "open-1", "--status", "archived", "--outcome", "delivered",
    "--no-deferrals"]);
  assert.equal(freshnessCount(parseBrief(engine)), before - 1,
    "the disposition discharges the obligation — no watermark is written or required");
});

unitTest("the line vanishes entirely once every linked epic has ended", () => {
  // A distinct BRANCH, not a smaller number: emission is gated on the count being non-zero, and
  // a mutation that excludes nothing slips past any test that only ever reads a digit.
  const engine = mixedRepo({ open: 0, ended: 3 });
  assert.ok(!FRESHNESS.test(parseBrief(engine)),
    "every linked epic ended — there is no refresh debt left to name");
});

unitTest("PROJECT.md reports the same count as the brief", () => {
  // The two surfaces this repo's dominant defect class splits: PROJECT.md embeds buildBrief()'s
  // output, so they cannot disagree today — asserted so that a future second reading of the
  // population cannot land in one surface and miss the other.
  const engine = mixedRepo({ open: 2, ended: 4 });
  assert.equal(freshnessCount(projectMd(engine)), freshnessCount(parseBrief(engine)));
  assert.equal(freshnessCount(projectMd(engine)), 2);
});

unitTest("the remedy the line names can actually clear the number it reports", () => {
  // The half of gh-138 that is about honesty rather than volume. `/pm:sync` reads open items;
  // an archived epic has no open item to read, so while terminal epics were counted the line
  // named an action that provably could not discharge them. Every epic now counted is one whose
  // watermark that sync CAN advance — asserted by discharging the whole set the way sync does.
  const engine = mixedRepo({ open: 3, ended: 2 });
  assert.ok(FRESHNESS.test(parseBrief(engine)));
  for (let i = 1; i <= 3; i++) {
    engine(["update-epic", `open-${i}`, "--external-updated-at", "2026-08-27T09:30:00Z"]);
  }
  assert.ok(!FRESHNESS.test(parseBrief(engine)),
    "recording the watermark sync would record clears the line completely");
});
