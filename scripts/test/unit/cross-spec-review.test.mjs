// scripts/test/unit/cross-spec-review.test.mjs
// 4.1's migration of `assert/cross-spec-review.test.mjs` — 2 of its 17 tests, moved from the file rung
// to the unit rung with every assertion unchanged.
//
// The RELEASE-scope review gate (gh#126).
//
// pm's gate vocabulary is per CHANGE: Gate 1 reviews one change's artifacts, Gate 2 its
// implementation. A release is many changes, and nothing asked whether a release's specs AGREE
// WITH EACH OTHER. On 0.27.0 that question returned 5 Critical and 10 Important against six
// specs that had each passed `openspec validate --strict` and would each have passed Gate 1
// alone. These tests bind the engine half of closing that gap: the spec set is ENUMERATED from
// disk (never asserted by the agent), the verdict records a digest per spec, and a spec ADDED
// or CHANGED after the verdict makes it stale.
//
// ─────────────── WHAT MOVED, AND WHY SO FEW ───────────────
//
// TWO moved: `crossSpecRequired`, which is a pure function of a spec list, and the rules-block test,
// which asserts the emitted text.
//
// FIFTEEN STAY, and EVERY ONE OF THEM IS THE SAME POPULATION: this feature's whole premise is that the
// spec set is DERIVED FROM DISK — `releaseSpecFiles()` walks `openspec/changes/<id>/specs/<cap>/spec.md`
// — so the fixture has to write those files, and the enumeration, the digest, the staleness check and
// the two rendered surfaces are all questions about what it finds there. That includes the archive-move
// test, which renames a directory to prove the record is keyed by CHANGE-relative keys rather than by
// path.
//
// This is the seam's edge stated as plainly as the batch contains: a feature whose subject is the
// filesystem leaves the least, and no amount of fixture rewriting changes that without changing what
// the test is about.
//
//   `tmpRepo()` + `run(["init"], { cwd })`  →  `memoryEngine(emptyRecord())`
//   `run(args, { cwd })`                    →  `engine(args)`

import assert from "node:assert/strict";
import { emptyRecord, memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";
import { crossSpecRequired } from "../../lib/cross-spec-review.mjs";

unitTest("crossSpecRequired is a FLAT SPEC COUNT, not a member count", () => {
  // One member change carrying six specs is exactly 0.27.0's shape, and it is the case a
  // member-count threshold silently drops.
  assert.equal(crossSpecRequired([{ key: "a" }]), false);
  assert.equal(crossSpecRequired([{ key: "a" }, { key: "b" }]), true);
});

// ───────────────────────── recording the verdict ─────────────────────────
unitTest("the rules block carries the release gate as a NUMBERED REQUIRED TASK ITEM", () => {
  const engine = memoryEngine(emptyRecord());
  const out = engine(["rules"]);
  // Measured in this repo: a rule carried by a required task reached 14/14 subsequent changes,
  // the same rule as a prose bullet reached 3/15. Bind the numbering, not just the words.
  assert.match(out, /^\d+\. \*\*Review a release's specs against each other\.\*\*/m);
  assert.match(out, /record-cross-spec-review/);
});
