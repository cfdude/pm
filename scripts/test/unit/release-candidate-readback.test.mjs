// scripts/test/unit/release-candidate-readback.test.mjs
// converged-release-candidate-review 3.1 — `release show`'s derived "candidate review" line.
// UNIT RUNG: values over an in-memory store; the read writes nothing.

import assert from "node:assert/strict";
import { emptyRecord, memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";

const H1 = "1111111111111111111111111111111111111111";
const H2 = "2222222222222222222222222222222222222222";
const epic = (id, extra = {}) => ({ id, title: id, priority: "P1", status: "active", role: "epic", lane: "claude-code",
  links: [], reconcileNeeded: false, release: "R", attributedCommits: ["c".repeat(40)], ...extra });
const gate2 = (head, verdict = "pass", base = "b".repeat(40)) => ({ gate2: { verdict, reviewedAt: "2026-09-29T00:00:00Z", baseSha: base, headSha: head } });
const repo = (epics, releaseExtra = {}) => memoryEngine({ ...emptyRecord(), releases: [{ id: "R", intent: "x", deferred: [], ...releaseExtra }], epics });
const line = (out) => out.split("\n").filter(l => /candidate review/.test(l)).join("\n");

unitTest("Converged members: one shared head over every candidate member reads converged", () => {
  const engine = repo([epic("a", { gateReview: gate2(H1) }), epic("b", { gateReview: gate2(H1) })]);
  const out = engine(["release", "show", "R"]);
  assert.match(out, new RegExp(`candidate review: converged at \`${H1}\``));
  assert.match(out, /2 members/);
});

unitTest("A member with a divergent head is named: every distinct head is listed with its members", () => {
  const engine = repo([epic("a", { gateReview: gate2(H1) }), epic("b", { gateReview: gate2(H2) })]);
  const l = line(engine(["release", "show", "R"]));
  assert.match(l, /NOT converged/);
  const out = engine(["release", "show", "R"]);
  assert.match(out, new RegExp(`${H1} — \`a\``));
  assert.match(out, new RegExp(`${H2} — \`b\``));
});

unitTest("A member with no verdict is named, and nothing is written", () => {
  const engine = repo([epic("a", { gateReview: gate2(H1) }), epic("b")]);
  const before = engine.store.read("state.json").text;
  const out = engine(["release", "show", "R"]);
  assert.match(out, /NOT converged/);
  assert.match(out, /no Gate 2 verdict — `b`/);
  assert.doesNotMatch(out, /converged at/);
  assert.equal(engine.store.read("state.json").text, before, "the store is unchanged after the read");
});

unitTest("A withdrawn Gate 2 is named as missing", () => {
  const engine = repo([epic("a", { gateReview: gate2(H1) }),
    epic("b", { gateReview: {}, withdrawnGateReviews: [{ gate: 2, entry: gate2(H1).gate2, reason: "wrong epic", withdrawnAt: "2026-09-29T00:00:00Z" }] })]);
  const out = engine(["release", "show", "R"]);
  assert.match(out, /no Gate 2 verdict — `b`/);
  assert.doesNotMatch(out, /converged at/);
});

unitTest("Archived and unbuilt members are not candidate members", () => {
  const engine = repo([
    epic("a", { gateReview: gate2(H1) }),
    epic("b", { status: "archived" }),                        // archived: not a candidate member
    epic("c", { attributedCommits: [] }),                      // no built work: not a candidate member
    epic("d", { attributedCommits: undefined }),               // never attributed: not a candidate member
  ]);
  const out = engine(["release", "show", "R"]);
  assert.match(out, new RegExp(`candidate review: converged at \`${H1}\``));
  assert.match(out, /1 member\b/);
  assert.doesNotMatch(line(out), /`b`|`c`|`d`/);
  assert.doesNotMatch(out, /no Gate 2 verdict/);
});

unitTest("a release with no candidate members prints no candidate line", () => {
  const engine = repo([epic("b", { status: "archived" }), epic("c", { attributedCommits: [] })]);
  assert.doesNotMatch(engine(["release", "show", "R"]), /candidate review/);
  assert.doesNotMatch(repo([]).result(["release", "show", "R"]).stdout, /candidate review/);
});

unitTest("a recorded fail is a verdict at its head, but is never reported as converged and is named", () => {
  const engine = repo([epic("a", { gateReview: gate2(H1) }), epic("b", { gateReview: gate2(H1, "fail") })]);
  const out = engine(["release", "show", "R"]);
  assert.match(out, /NOT converged/);
  assert.doesNotMatch(out, /converged at/);
  assert.match(out, /failed: `b`/);
});

unitTest("the same head reviewed over a different base is not one range: NOT converged", () => {
  const B2 = "3333333333333333333333333333333333333333";
  const engine = repo([epic("a", { gateReview: gate2(H1) }), epic("b", { gateReview: gate2(H1, "pass", B2) })]);
  const out = engine(["release", "show", "R"]);
  assert.match(out, /NOT converged/);
  assert.doesNotMatch(out, /converged at/);
  assert.match(out, new RegExp(`${"b".repeat(40)}\\.\\.${H1} — \`a\``));
  assert.match(out, new RegExp(`${B2}\\.\\.${H1} — \`b\``));
});

unitTest("a Gate 2 with no recorded head is treated as no verdict", () => {
  const engine = repo([epic("a", { gateReview: gate2(H1) }), epic("b", { gateReview: { gate2: { verdict: "pass", note: "legacy prose" } } })]);
  assert.match(engine(["release", "show", "R"]), /no Gate 2 verdict — `b`/);
});

unitTest("other releases' members are not counted", () => {
  const engine = memoryEngine({ ...emptyRecord(),
    releases: [{ id: "R", intent: "x", deferred: [] }, { id: "S", intent: "y", deferred: [] }],
    epics: [epic("a", { gateReview: gate2(H1) }), epic("z", { release: "S" })] });
  assert.match(engine(["release", "show", "R"]), /converged at/);
});
