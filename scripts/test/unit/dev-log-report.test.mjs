// scripts/test/unit/dev-log-report.test.mjs
// developer-session-log 2.1 -- the per-session report, joined to ledger rows: values from in-memory entries and
// rows (the unit rung), plus the off messages the verb prints over an in-memory record.

import assert from "node:assert/strict";
import { emptyRecord, memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";
import {
  LARGE_CONTEXT_TOKENS, STALE_SESSION_DAYS, buildSessions, renderDevLog,
} from "../../lib/dev-log-report.mjs";

const T0 = Date.UTC(2026, 9, 1, 12, 0, 0);
const at = (ms) => new Date(T0 + ms).toISOString();
const DAY = 24 * 60 * 60 * 1000;
const msg = (id, ms, over = {}) => ({
  type: "message", messageId: id, sessionId: "sA", agentId: null, at: at(ms),
  userText: 10, toolResults: { Read: 100 }, attachments: 5, images: 0, textBytes: 20, thinkingBytes: 3, ...over,
});
const row = (id, over = {}) => ({ messageId: id, input: 1, cacheCreation: 2, cacheRead: 3, output: 4, ...over });
const snap = (ms, on) => ({ type: "features", at: at(ms), features: { spendGuard: { on, bytes: on ? 806 : 0 } }, surfaces: {} });

unitTest("2.1 a session reports messages, first and last time, token classes and work, joined by messageId", () => {
  const [s] = buildSessions({ entries: [msg("a", 0), msg("b", 1000)], rows: [row("a"), row("b")] });
  assert.equal(s.sessionId, "sA");
  assert.equal(s.messages, 2);
  assert.deepEqual([s.first, s.last], [at(0), at(1000)]);
  assert.deepEqual([s.tokens.input, s.tokens.cacheCreation, s.tokens.cacheRead, s.tokens.output], [2, 4, 6, 8]);
  assert.equal(s.tokens.work, 2 * (1 + 2 + 4), "work is every class but cache-read, from the shared totals builder");
  assert.deepEqual(s.composition.toolResults, { Read: 200 });
  assert.equal(s.composition.userText, 20);
});

unitTest("2.1 a message with no ledger row reports `tokens: not in ledger`, and the other messages still count", () => {
  const [s] = buildSessions({ entries: [msg("a", 0), msg("gone", 1000)], rows: [row("a")] });
  assert.equal(s.tokens.messages, 1);
  assert.match(s.tokens.notInLedger, /1 message\(s\): tokens: not in ledger/);
  assert.match(renderDevLog({ sessions: [s], filters: {} }).join("\n"), /tokens: not in ledger/);
});

unitTest("2.1 a session whose first and last message are seven days apart carries stale-session with both times", () => {
  const [s] = buildSessions({ entries: [msg("a", 0), msg("b", 7 * DAY)], rows: [row("a"), row("b")] });
  const w = s.warnings.find((x) => x.rule === "stale-session");
  assert.ok(w);
  assert.deepEqual([w.first, w.last, w.thresholdDays], [at(0), at(7 * DAY), STALE_SESSION_DAYS]);
  assert.equal(buildSessions({ entries: [msg("a", 0), msg("b", 7 * DAY - 1)], rows: [] })[0].warnings.length, 0, "one millisecond short is not stale");
});

unitTest("2.1 a message with 379,000 tokens of context carries large-context naming the figure and the threshold", () => {
  const [s] = buildSessions({ entries: [msg("a", 0)], rows: [row("a", { input: 1000, cacheCreation: 3000, cacheRead: 375000 })] });
  const w = s.warnings.find((x) => x.rule === "large-context");
  assert.equal(w.largest.context, 379000);
  assert.equal(w.threshold, LARGE_CONTEXT_TOKENS);
  assert.equal(buildSessions({ entries: [msg("a", 0)], rows: [row("a", { input: 0, cacheCreation: 0, cacheRead: LARGE_CONTEXT_TOKENS - 1 })] })[0].warnings.length, 0);
});

unitTest("2.1 a compaction entry makes the session compacted, with its time", () => {
  const entries = [msg("a", 0), { type: "compaction", sessionId: "sA", at: at(500), trigger: "auto", preTokens: 1, postTokens: 1 }];
  const w = buildSessions({ entries, rows: [] })[0].warnings.find((x) => x.rule === "compacted");
  assert.deepEqual([w.count, w.at], [1, [at(500)]]);
});

unitTest("2.1 the features in force are the latest snapshot at or before the first message; a mid-session change is marked", () => {
  const entries = [snap(-1000, false), msg("a", 0), snap(500, true), msg("b", 1000)];
  const [s] = buildSessions({ entries, rows: [] });
  assert.equal(s.features.features.spendGuard.on, false);
  assert.equal(s.features.capturedAfterSessionStart, false);
  assert.deepEqual(s.featuresChangedDuring, [at(500)]);
  assert.match(renderDevLog({ sessions: [s], filters: {} }).join("\n"), /the features changed during this session/);
});

unitTest("2.1 with no snapshot at or before the first message the earliest is used and says it came after", () => {
  const [s] = buildSessions({ entries: [msg("a", 0), snap(5000, true)], rows: [] });
  assert.equal(s.features.capturedAfterSessionStart, true);
  assert.match(renderDevLog({ sessions: [s], filters: {} }).join("\n"), /snapshot taken after the session began/);
});

unitTest("2.1 --session-id, --since and --until narrow the sessions; --since/--until are half-open", () => {
  const entries = [msg("a", 0), msg("b", 1000, { sessionId: "sB" }), msg("c", 2000, { sessionId: "sB" })];
  assert.deepEqual(buildSessions({ entries, rows: [], filters: { sessionId: "sB" } }).map((s) => s.sessionId), ["sB"]);
  const since = buildSessions({ entries, rows: [], filters: { since: at(1000) } });
  assert.deepEqual(since.map((x) => [x.sessionId, x.messages]), [["sB", 2]], "a is before `since`, so session sA drops out");
  const half = buildSessions({ entries, rows: [], filters: { since: at(1000), until: at(2000) } });
  assert.deepEqual(half.map((s) => [s.sessionId, s.messages]), [["sB", 1]], "b is in, c is at `until` and out");
});

unitTest("2.1 the text report labels composition as BYTES and prints every warning's threshold", () => {
  const [s] = buildSessions({ entries: [msg("a", 0), msg("b", 8 * DAY)], rows: [row("a", { cacheRead: 400000 }), row("b")] });
  const text = renderDevLog({ sessions: [s], filters: {} }).join("\n");
  assert.match(text, /composition \(BYTES, not tokens\)/);
  assert.match(text, /stale-session.*threshold 7 days, a proposal/);
  assert.match(text, /large-context.*300,000 tokens of context \(a proposal\)/);
});

unitTest("2.1 off: the verb says which switch is off and names the verb to run first, in text and --json", () => {
  const noTracking = memoryEngine(emptyRecord());
  assert.match(noTracking(["dev-log"]), /set-spend-tracking on/);
  assert.match(JSON.parse(noTracking(["dev-log", "--json"])).off, /set-spend-tracking on/);
  const trackingOnly = memoryEngine({ ...emptyRecord(), spendTracking: { enabled: true, enabledAt: "2026-10-09T00:00:00.000Z" } });
  assert.match(trackingOnly(["dev-log"]), /set-dev-log on/);
});

unitTest("2.1 an unparseable --since, a stray --yes and --clear with a report flag are refused", () => {
  const e = memoryEngine({ ...emptyRecord(), spendTracking: { enabled: true, enabledAt: "2026-10-09T00:00:00.000Z" }, devLog: { enabled: true, enabledAt: "2026-10-09T00:00:00.000Z" } });
  for (const args of [["dev-log", "--since", "yesterday"], ["dev-log", "--yes"], ["dev-log", "--clear", "--json"]]) {
    const r = e.result(args);
    assert.notEqual(r.status, 0, args.join(" "));
  }
});
