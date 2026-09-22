import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { AGENT_OUTCOMES, unconsideredOutcomes } from "../../lib/archive-gate.mjs";
import {
  KNOWN_OUTCOMES, agentDisposition, engineStamp, isEngineStamped, outcomeOf,
} from "../../lib/disposition.mjs";
import { expectFail, readState, run, tmpRepo, writeState } from "../fixtures/assert-harness.mjs";

const AT = "2026-08-01T00:00:00.000Z";

const epic = (id, over = {}) => ({
  id, title: id, priority: "P2", status: "archived", role: "epic", lane: "claude-code",
  stories: [], links: [], ...over,
});

const ids = (epics) => unconsideredOutcomes(epics).map(r => r.epic.id).sort();

// 4.1 (0.48.0) moved FIFTEEN of this file's sixteen tests to
// `scripts/test/unit/unconsidered-outcomes.test.mjs`: the whole 4.1 predicate family, the two 4.2
// invocation tests, the 4.3 triple and the `unreconstructable` write path, 4.6's both-direction
// invariant, and the 5.10 verb family. Every one of them is a walker over a fixture, or a verb whose
// observable is JSON.
//
// THE ONE BELOW STAYS, and its FIXTURE is why: it writes 47 unticked-task PLAN FILES under
// `docs/superpowers/plans/`, which is what `epicProgress()` reads to reach the zero-ticked finding the
// test is about. The assertion is not about the file, but the file is what produces the number — the
// fourth shape batch 6 named in worklist-4.1.md.

// ───────── 4.4: an `unreconstructable` epic with unticked tasks is not a zero-ticked finding ────

test("4.4: an unreconstructable epic's unticked tasks are not a completion finding", async () => {
  const { inCompletionScope } = await import("../../lib/integrity.mjs");
  assert.equal(inCompletionScope({
    disposition: agentDisposition({ outcome: "unreconstructable", reason: "gone", recordedAt: AT }),
  }), false, "an epic whose defining property is that the evidence is gone is zero-ticked by " +
    "construction — a check firing on it forever fires on the record working correctly");

  const cwd = tmpRepo();
  run(["init"], { cwd });
  fs.mkdirSync(path.join(cwd, "docs", "superpowers", "plans"), { recursive: true });
  const plan = "# p\n\n" + Array.from({ length: 47 }, (_, n) => `- [ ] t${n}\n`).join("");
  for (const id of ["evidence-is-gone", "nobody-recorded-one"]) {
    fs.writeFileSync(path.join(cwd, "docs", "superpowers", "plans", `${id}.md`), plan);
  }
  // No `stories` key: epicProgress() short-circuits on ANY stories array, so an empty one reads
  // 0/0 from the wrong source and the zero-ticked check never sees the plan file.
  const planned = (id, disposition) => ({
    id, title: id, priority: "P2", status: "archived", role: "epic", links: [],
    lane: "superpowers", planPath: `docs/superpowers/plans/${id}.md`, disposition });
  writeState(cwd, { version: 1, active: null, detourStack: [], platform: "claude-code", epics: [
    planned("evidence-is-gone", agentDisposition({
      outcome: "unreconstructable", reason: "no commits survive", recordedAt: AT })),
    planned("nobody-recorded-one", engineStamp("migration", { recordedAt: AT })),
  ] });
  const out = run(["integrity"], { cwd });
  assert.ok(!out.includes("evidence-is-gone"),
    "the recorded determination already explains the zero");
  assert.ok(out.includes("nobody-recorded-one"),
    "control: `unknown` stays in scope, so this test is measuring the exclusion and not the file");
});

