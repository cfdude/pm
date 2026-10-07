// scripts/test/unit/drift-freshness.test.mjs
// certification-record-redesign task 2.1 (design D1, Gate 1 B1/B2; suite-certification, "A functional
// result is recorded and checked, never remembered") — FRESHNESS IS EQUALITY WITH ONE ENTRY'S WHOLE
// MANIFEST.
//
// The record stops being one entry per certified id holding a hash over working-tree bytes (#226,
// #230). A passing run writes ONE entry whose MANIFEST maps every path of its bucket's subject that
// the index holds to that path's mode and blob id (what `git ls-files -s` reports). A commit is fresh
// for a bucket only when the ONE entry keyed by its own manifest exists, passed, and holds exactly
// that manifest. Nothing is combined and nothing is resolved against another tree.
//
// Every function below is a pure function of values — the subject derivations reach it as thunks, the
// record as `entryFor(key)` — so each spec scenario is one named test here, over no filesystem and no
// git. The drift script's CLI gathers the values (task 2.4); this file pins the decision.
//
// UNIT RUNG: every observable is a value a function returned. No functional twin is needed (tasks.md
// 2.1): the functional side of the same rule is `functional/drift-script`'s, which reaches it through
// the real index.

import assert from "node:assert/strict";
import * as certification from "../certification.mjs";
import { unitTest } from "../fixtures/unit-harness.mjs";

/** The certification functions this file needs, each asserted to exist — a missing one is the RED,
 *  and it should say which one rather than fail as `undefined is not a function`. */
function fns() {
  for (const name of ["bucketDemanded", "manifestKey", "recordFreshness", "manifestOf"]) {
    assert.equal(typeof certification[name], "function",
      `certification.mjs exports no ${name}(): freshness as equality with one entry's whole manifest ` +
      "(design D1) cannot be decided without it");
  }
  return certification;
}

const BLOB = (c) => c.repeat(40);
const A = "scripts/lib/a.mjs";
const B = "scripts/lib/b.mjs";
const T = "scripts/test/functional/alpha.test.mjs";
const CONF = "scripts/test/functional/conformance.test.mjs";

/** A manifest in the record's own shape: path → "<mode> <blob id>". */
const manifest = (entries) => Object.fromEntries(Object.entries(entries).map(([p, v]) => [p, v]));

/** A record as `entryFor(key)` sees it: a lookup by the manifest's key, nothing else. */
function recordOf(...entries) {
  const { manifestKey } = fns();
  const byKey = new Map(entries.map((e) => [manifestKey(e.manifest), e]));
  return (key) => byKey.get(key) ?? null;
}

const pass = (bucket, m) => ({ version: 2, bucket, manifest: m, result: "pass" });

/** The demand, with each subject derivation behind a thunk that COUNTS its calls. */
function demand({ staged, index, subjectIndex = [], subjectHead = [] }) {
  const calls = { index: 0, head: 0 };
  const demanded = fns().bucketDemanded({
    stagedPaths: staged,
    indexPaths: new Set(index),
    subjectIndex: () => { calls.index += 1; return new Set(subjectIndex); },
    subjectHead: () => { calls.head += 1; return new Set(subjectHead); },
  });
  return { demanded, calls };
}

const M1 = manifest({ [A]: `100644 ${BLOB("1")}`, [T]: `100644 ${BLOB("7")}` });

unitTest("2.1 an unchanged module needs no new run: a commit staging nothing in the subject demands nothing", () => {
  const { demanded } = demand({ staged: ["scripts/lib/other.mjs"], index: [A, T, "scripts/lib/other.mjs"], subjectIndex: [A, T] });
  assert.equal(demanded, false, "a staged path outside the subject demands no run, however old the record");
  // And the same module, staged but byte-identical to the certified run, is fresh: the record is not aged.
  const f = fns().recordFreshness({ bucket: "functional", indexManifest: M1, entryFor: recordOf(pass("functional", M1)) });
  assert.equal(f.fresh, true, `an entry whose whole manifest equals the index's is fresh: ${JSON.stringify(f)}`);
});

unitTest("2.1 a changed module needs a new run however recent the record", () => {
  const { demanded } = demand({ staged: [A], index: [A, T], subjectIndex: [A, T] });
  assert.equal(demanded, true, "a staged subject path demands the bucket");
  const now = manifest({ [A]: `100644 ${BLOB("2")}`, [T]: `100644 ${BLOB("7")}` });
  const recent = { ...pass("functional", M1), ranAt: new Date().toISOString() };
  const f = fns().recordFreshness({ bucket: "functional", indexManifest: now, entryFor: recordOf(recent) });
  assert.equal(f.fresh, false, "an entry over the module's OLD blob does not certify its new content");
});

unitTest("2.1 a stale record is not a silent pass: no record, another bucket's entry, or other content", () => {
  const { recordFreshness } = fns();
  assert.equal(recordFreshness({ bucket: "functional", indexManifest: M1, entryFor: () => null }).fresh, false,
    "no record at all is not a pass");
  assert.equal(recordFreshness({ bucket: "functional", indexManifest: M1, entryFor: recordOf(pass("sweeps", M1)) }).fresh, false,
    "an entry for ANOTHER bucket over the same content does not certify this bucket");
  const other = manifest({ [A]: `100644 ${BLOB("3")}`, [T]: `100644 ${BLOB("7")}` });
  assert.equal(recordFreshness({ bucket: "functional", indexManifest: M1, entryFor: recordOf(pass("functional", other)) }).fresh, false,
    "an entry over different content does not certify this content");
  assert.equal(recordFreshness({ bucket: "functional", indexManifest: M1, entryFor: recordOf({ ...pass("functional", M1), result: "fail" }) }).fresh, false,
    "an entry whose result is not a pass certifies nothing");
});

unitTest("2.1 a certification split across two commits: the first split commit is NOT fresh against the run over both", () => {
  // The run certified an index holding NEW content for both A and B...
  const run = manifest({ [A]: `100644 ${BLOB("a")}`, [B]: `100644 ${BLOB("b")}`, [T]: `100644 ${BLOB("7")}` });
  // ...and the first commit stages only A, so its index still holds B's OLD content.
  const firstCommit = manifest({ [A]: `100644 ${BLOB("a")}`, [B]: `100644 ${BLOB("0")}`, [T]: `100644 ${BLOB("7")}` });
  const f = fns().recordFreshness({ bucket: "functional", indexManifest: firstCommit, entryFor: recordOf(pass("functional", run)) });
  assert.equal(f.fresh, false, "the run's pass rested on B's NEW content, which the first split commit does not contain");
});

unitTest("2.1 an entry agreeing on the staged paths only (a different unstaged subject file) is NOT fresh", () => {
  const entry = manifest({ [A]: `100644 ${BLOB("2")}`, [B]: `100644 ${BLOB("9")}`, [T]: `100644 ${BLOB("7")}` });
  const index = manifest({ [A]: `100644 ${BLOB("2")}`, [B]: `100644 ${BLOB("8")}`, [T]: `100644 ${BLOB("7")}` });
  const f = fns().recordFreshness({ bucket: "functional", indexManifest: index, entryFor: recordOf(pass("functional", entry)) });
  assert.equal(f.fresh, false, "agreement on the staged path A alone is not agreement on the WHOLE subject (B differs)");
});

unitTest("2.1 a mode-only change (100644 to 100755) is NOT fresh", () => {
  const exec = manifest({ [A]: `100755 ${BLOB("1")}`, [T]: `100644 ${BLOB("7")}` });
  assert.notEqual(fns().manifestKey(exec), fns().manifestKey(M1), "the mode is part of the key");
  const f = fns().recordFreshness({ bucket: "functional", indexManifest: exec, entryFor: recordOf(pass("functional", M1)) });
  assert.equal(f.fresh, false, "an entry over the previous mode does not certify the new one");
});

unitTest("2.1 two runs are NOT combined into one pass", () => {
  const index = manifest({ [A]: `100644 ${BLOB("a")}`, [B]: `100644 ${BLOB("b")}`, [T]: `100644 ${BLOB("7")}` });
  const agreesOnA = manifest({ [A]: `100644 ${BLOB("a")}`, [B]: `100644 ${BLOB("0")}`, [T]: `100644 ${BLOB("7")}` });
  const agreesOnB = manifest({ [A]: `100644 ${BLOB("0")}`, [B]: `100644 ${BLOB("b")}`, [T]: `100644 ${BLOB("7")}` });
  const f = fns().recordFreshness({
    bucket: "functional", indexManifest: index,
    entryFor: recordOf(pass("functional", agreesOnA), pass("functional", agreesOnB)),
  });
  assert.equal(f.fresh, false, "no single run observed A's and B's new content together");
});

unitTest("2.1 a deleted functional test is demanded through subjectHead, and is not fresh", () => {
  // The index no longer holds T, so subject(index) cannot name it; HEAD's subject did.
  const { demanded, calls } = demand({ staged: [T], index: [A], subjectIndex: [A], subjectHead: [A, T] });
  assert.equal(demanded, true, "a staged deletion of a path in subject(HEAD) demands the bucket");
  assert.equal(calls.head, 1, "the deletion is judged against HEAD's subject");
  const now = manifest({ [A]: `100644 ${BLOB("1")}` });
  const f = fns().recordFreshness({ bucket: "functional", indexManifest: now, entryFor: recordOf(pass("functional", M1)) });
  assert.equal(f.fresh, false, "the entry whose manifest still holds the deleted test does not agree with the new subject");
});

unitTest("2.1 a MODIFIED path in subjectHead but not in subjectIndex is NOT demanded through HEAD (m2)", () => {
  // The index still holds X, so X is judged by subject(index) alone, which no longer names it.
  const X = "scripts/lib/x.mjs";
  const { demanded, calls } = demand({ staged: [X], index: [A, X], subjectIndex: [A], subjectHead: [A, X] });
  assert.equal(demanded, false, "HEAD's subject judges only a path the index no longer holds");
  assert.equal(calls.head, 0, "and it is not even derived for a path the index still holds");
});

unitTest("2.1 a staged set of only openspec/ and CHANGELOG.md paths demands nothing and calls neither subject thunk (m3)", () => {
  const { demanded, calls } = demand({
    staged: ["openspec/changes/x/tasks.md", "CHANGELOG.md"],
    index: ["openspec/changes/x/tasks.md", "CHANGELOG.md", A],
    subjectIndex: [A], subjectHead: [A],
  });
  assert.equal(demanded, false);
  assert.deepEqual(calls, { index: 0, head: 0 },
    "no staged path lies under a subject root, so neither derivation is paid for (design D2, 'The skip')");
});

unitTest("2.1 a removed conformance row is an edit to conformance.test.mjs, and demands a run", () => {
  const before = manifest({ [A]: `100644 ${BLOB("1")}`, [CONF]: `100644 ${BLOB("c")}` });
  const { demanded } = demand({ staged: [CONF], index: [A, CONF], subjectIndex: [A, CONF] });
  assert.equal(demanded, true, "the conformance file is in the functional subject");
  const after = manifest({ [A]: `100644 ${BLOB("1")}`, [CONF]: `100644 ${BLOB("d")}` });
  const f = fns().recordFreshness({ bucket: "functional", indexManifest: after, entryFor: recordOf(pass("functional", before)) });
  assert.equal(f.fresh, false, "the entry written before the row was removed does not agree with the new file");
});

unitTest("2.1 an entry from another tree is ignored: it neither passes nor refuses", () => {
  const foreign = manifest({ [A]: `100644 ${BLOB("1")}`, "scripts/test/functional/only-on-b.test.mjs": `100644 ${BLOB("f")}` });
  const { recordFreshness } = fns();
  const withOurs = recordFreshness({ bucket: "functional", indexManifest: M1, entryFor: recordOf(pass("functional", foreign), pass("functional", M1)) });
  assert.equal(withOurs.fresh, true, "our agreeing entry certifies us; the foreign one is not consulted");
  const alone = recordFreshness({ bucket: "functional", indexManifest: M1, entryFor: recordOf(pass("functional", foreign)) });
  assert.equal(alone.fresh, false, "a foreign entry alone is no pass...");
  assert.doesNotMatch(JSON.stringify(alone), /only-on-b/, "...and the result carries nothing about the foreign entry's paths");
});

unitTest("2.1 subject ∩ index paths: a subject path the index does not hold is not in the manifest", () => {
  // `engineSourceFiles()` always names scripts/conductor.mjs, which a hook fixture writes but never
  // tracks: that path has no mode and no blob, so the manifest cannot hold it.
  const { manifestOf, manifestKey, recordFreshness } = fns();
  const indexEntries = new Map([[A, `100644 ${BLOB("1")}`], [T, `100644 ${BLOB("7")}`], ["README.md", `100644 ${BLOB("r")}`]]);
  const m = manifestOf({ subject: ["scripts/conductor.mjs", A, T], indexEntries });
  assert.deepEqual(m, M1, "the manifest is the subject's paths that the index holds, each with its mode and blob");
  assert.equal(manifestKey(m), manifestKey(M1));
  assert.equal(recordFreshness({ bucket: "functional", indexManifest: m, entryFor: recordOf(pass("functional", M1)) }).fresh, true,
    "an entry over the index's paths alone is fresh");
});

unitTest("2.1 the key is a sha256 over `path NUL mode SP blob NUL`, independent of insertion order", () => {
  const { manifestKey } = fns();
  const key = manifestKey(M1);
  assert.match(key, /^[0-9a-f]{64}$/, "a sha256, hex");
  const reversed = Object.fromEntries(Object.entries(M1).reverse());
  assert.equal(manifestKey(reversed), key, "the paths are sorted before hashing");
  assert.notEqual(manifestKey({ [A]: M1[A] }), key, "a different path set is a different key");
});
