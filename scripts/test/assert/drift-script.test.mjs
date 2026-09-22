// scripts/test/assert/drift-script.test.mjs
// 5.4 + 6.1 (design D6/D8) — THE DRIFT SCRIPT'S FOUR CHECKS, each seen to REFUSE.
//
// 6.1 IS A REGRESSION GUARD, NOT A RED: it passes the moment the script it tests exists. So it is
// verified the way the task text says — by its FOUR VIOLATIONS, one at a time, each asserting that
// the refusal NAMES the module, id or file at fault. A guard that is only ever observed saying "ok"
// is a guard nobody has watched fire.
//
// THE CHECKS ARE PURE FUNCTIONS OVER INJECTED LISTS, which is deliberate and is what lets this file
// sit in the assertion half: the git plumbing (`ls-files`, `diff --cached`, `show :<path>`,
// `rev-parse --git-common-dir`) is in drift.mjs's CLI tail, and every decision is made in
// certification.mjs from data its caller gathered. So the violations below need no repository, no
// spawn and no fixture.
//
// 7.2'S DATA-REFERENCE OBLIGATION IS TESTED HERE TOO, in the same table, because it is check 4's
// other half: the record holds module ids and functional ids, and every one of them is a pointer that
// can be left dangling by a rename or a deletion.
//
// WHAT THIS FILE CANNOT REACH, AND ITS FUNCTIONAL TWIN DOES (G-I2). Every check-4 case below injects
// `hashStaged` as a STUB, so the decision is tested and the READER is not: swapping the staged read
// (`git show :<path>`) for a worktree `readFileSync` left all of these green, and the bypass that buys
// is a commit whose index holds unverified content while the worktree holds the certified bytes.
// `scripts/test/functional/drift-script.test.mjs` builds that exact state in a real repository and
// requires the refusal — the half that may spawn is the half that can observe where the bytes came
// from, which is D5's placement rule producing a pairing rather than a gap.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ENGINE_ENTRY, ENGINE_SOURCE, REPO, assertionIds, certifiedModules, certifiedSet, contentHash,
  conformanceRows, couplingRefusals, coversFor, describeRefusal, engineSourceFiles, enrolmentRefusals,
  functionalIds, homeOf, readRecord, recordRefusals, sweepIds, twinRefusals, writeEntry,
} from "../certification.mjs";
import { PERMITTED_SUBCOMMANDS, gitRead } from "../drift.mjs";
import { KIND_MODULE, KIND_TRIGGER, RECORD_NAME, moduleEntry, triggerEntry } from "../certification.mjs";

const readFile = (p) => fs.readFileSync(p, "utf8");

// ───────────────────────────── the repository's own shape ─────────────────────────────

test("5.4/6.1: the repository's own suite passes all four checks", () => {
  // The checks are self-applied before they are trusted to refuse anything else: if the script's
  // rules were wrong about THIS tree, every commit would be refused for the wrong reason.
  const tracked = functionalIds(REPO).map((id) => `scripts/test/functional/${id}.test.mjs`)
    .concat(assertionIds(REPO).map((id) => `scripts/test/assert/${id}.test.mjs`))
    .concat(fs.readdirSync(path.join(REPO, "scripts", "test", "sweeps")).filter((f) => f.endsWith(".test.mjs"))
      .map((f) => `scripts/test/sweeps/${f}`));
  assert.deepEqual(enrolmentRefusals(tracked), [], "every tracked test file in this repository has one home");
  assert.deepEqual(twinRefusals({ functional: functionalIds(REPO), assertion: assertionIds(REPO) }), [],
    "every functional id has an assertion twin of the same id");
  assert.deepEqual(couplingRefusals({ stagedFiles: [], functional: functionalIds(REPO), assertion: assertionIds(REPO) }), [],
    "nothing staged means nothing to couple");
});

test("5.4/6.1: the id is the file's place on disk, both directions of the walk", () => {
  assert.equal(homeOf("scripts/test/assert/conductor-01.test.mjs"), "assert");
  // THE FOURTH HOME (0.48.0 task 2.2). This assertion was MISSING rather than wrong: the three above
  // were written when there were three, and a positive assertion is the only thing that notices a
  // name falling OUT of the regex — the two null cases below cannot, because a name that stopped
  // matching is exactly what they expect for something else.
  assert.equal(homeOf("scripts/test/unit/state-verb.test.mjs"), "unit");
  assert.equal(homeOf("scripts/test/functional/conductor-01.test.mjs"), "functional");
  assert.equal(homeOf("scripts/test/sweeps/output-interpolations.test.mjs"), "sweeps");
  assert.equal(homeOf("scripts/test/leftover.test.mjs"), null, "a file at the top level has no home");
  assert.equal(homeOf("scripts/test/fixtures/helpers.mjs"), null, "a non-test module is outside the enumeration");
});

// ───────────────────────────── the FOUR violations ─────────────────────────────

test("check 1 — a tracked test file in neither half and in no bucket is REFUSED, by name", () => {
  const tracked = [
    "scripts/test/assert/conductor-01.test.mjs",
    "scripts/test/functional/conductor-01.test.mjs",
    "scripts/test/leftover.test.mjs",
    "scripts/test/assert/nested/deep.test.mjs",
  ];
  const refused = enrolmentRefusals(tracked);
  assert.deepEqual(refused, ["scripts/test/assert/nested/deep.test.mjs", "scripts/test/leftover.test.mjs"],
    "the refusal names EVERY file with no home, and the message is the file's path");
  // WHY THIS IS THE ONE THAT MATTERS: the floor compares two counts over the files a runner was
  // HANDED, so a file in neither half is run by nothing and counted by nothing — it is invisible to
  // the floor in both directions, which is the silence the split introduced.
  assert.equal(refused.length, 2, "a file in neither half is a refusal rather than a silence");
});

test("check 2 — a functional id with no assertion twin is REFUSED, naming the id", () => {
  const refused = twinRefusals({
    functional: ["alpha", "beta", "gamma"],
    assertion: ["alpha", "gamma"],
  });
  assert.deepEqual(refused, ["beta"], "the refusal names the id whose twin is missing");
  assert.match(refused[0], /^beta$/, "the id, not a path — the twin's path is derived from it");

  // AND THE CONVERSE IS NOT A REFUSAL (D6, one direction). An assertion-only file is the normal
  // shape for a test whose subject is not git's behaviour, so it is asserted here rather than left
  // to a reader: a check that started refusing these would pull every assertion file into the
  // triggered half.
  assert.deepEqual(twinRefusals({ functional: ["alpha"], assertion: ["alpha", "assertion-only"] }), [],
    "an assertion-half file with no functional twin is NOT a refusal");
});

test("check 3 — a staged change touching one half only is REFUSED, naming the id and the twin's path", () => {
  const functional = ["alpha", "beta"];
  const assertion = ["alpha", "beta"];
  const refused = couplingRefusals({
    stagedFiles: ["scripts/test/functional/alpha.test.mjs"],
    functional, assertion,
  });
  assert.equal(refused.length, 1);
  assert.equal(refused[0].id, "alpha");
  assert.equal(refused[0].assertion, "scripts/test/assert/alpha.test.mjs", "the refusal names the path that is missing");

  // A rename carries BOTH paths (the caller collects the staged set with `--no-renames`), so it
  // passes — which is the behaviour D6 states and the reason the flag is not optional.
  assert.deepEqual(couplingRefusals({
    stagedFiles: ["scripts/test/functional/alpha.test.mjs", "scripts/test/assert/alpha.test.mjs"],
    functional, assertion,
  }), [], "both halves staged is not a refusal");

  // A change to the ASSERTION half alone is not a refusal either: the coupling key lives only where
  // check 2 does, i.e. on the functional half's ids.
  assert.deepEqual(couplingRefusals({
    stagedFiles: ["scripts/test/assert/alpha.test.mjs"], functional, assertion,
  }), [], "the coupling is one-directional, like the twin rule it keys on");
});

test("check 4 — a certified module whose STAGED content has no matching contentHash is REFUSED, with the run named", () => {
  const set = new Map([["scripts/lib/git.mjs", ["scripts/lib/git.mjs"]]]);
  const record = {
    entries: {
      "scripts/lib/git.mjs": {
        kind: "module", files: ["scripts/lib/git.mjs"], contentHash: "hash-of-the-OLD-content",
        covers: [], result: "pass", ranAt: "2020-01-01T00:00:00.000Z", engineSha: "deadbeef",
      },
    },
  };
  const refused = recordRefusals({
    stagedFiles: ["scripts/lib/git.mjs"],
    record, set,
    hashStaged: () => "hash-of-the-NEW-content",
    liveIds: [], conformanceRowsNow: [],
  });
  assert.equal(refused.length, 1);
  assert.equal(refused[0].kind, "stale-record");
  assert.equal(refused[0].entryId, "scripts/lib/git.mjs", "the refusal names the module");
  assert.equal(refused[0].run, "node scripts/test/certify.mjs functional",
    "and the command that would satisfy it — a refusal a developer cannot satisfy is a refusal that gets bypassed");
  assert.match(describeRefusal(refused[0]), /node scripts\/test\/certify\.mjs functional/);
});

test("check 4 — FRESHNESS IS THE CONTENT, not the age and not the commit", () => {
  const set = new Map([["scripts/lib/git.mjs", ["scripts/lib/git.mjs"]]]);
  const unchanged = { entries: { "scripts/lib/git.mjs": { result: "pass", contentHash: "H", covers: [] } } };
  // Old record, identical content → NO run demanded. "An unchanged module needs no new run" is a
  // scenario in the spec, not an incidental optimisation: a gate that went stale on age would demand
  // a functional run for a commit that touched nothing certified.
  assert.deepEqual(recordRefusals({
    stagedFiles: ["scripts/lib/git.mjs"], record: unchanged, set,
    hashStaged: () => "H", liveIds: [], conformanceRowsNow: [],
  }), [], "an unchanged module needs no new run, however old the record is");

  // Fresh record, changed content → a run demanded. "A changed module needs a new run however recent
  // the record" is the other scenario, and this is the half that makes the record a gate.
  const fresh = { entries: { "scripts/lib/git.mjs": { result: "pass", contentHash: "H", covers: [], ranAt: new Date().toISOString() } } };
  assert.equal(recordRefusals({
    stagedFiles: ["scripts/lib/git.mjs"], record: fresh, set,
    hashStaged: () => "NOT-H", liveIds: [], conformanceRowsNow: [],
  }).length, 1, "a changed module needs a new run however recent the record");

  // A commit that touches nothing certified is not refused at all.
  assert.deepEqual(recordRefusals({
    stagedFiles: ["README.md"], record: { entries: {} }, set,
    hashStaged: () => "H", liveIds: [], conformanceRowsNow: [],
  }), [], "an unrelated commit is not refused — that is the whole point of a trigger");
});

test("check 4 — the engine-source trigger is a SECOND, disjoint demand (D9/6.3)", () => {
  // An edit to scripts/lib/rank.mjs is engine source and NOT a certified module: the sweep bucket's
  // subject changed, the gateway sweep's did not. The refusal must name the SWEEP run.
  const set = certifiedSet(REPO);
  assert.ok(set.has(ENGINE_SOURCE), "the engine-source trigger is in the certified set");
  assert.ok(!set.has("scripts/lib/rank.mjs"), "a library module that does not call the gateway is not a certified module");
  const refused = recordRefusals({
    stagedFiles: ["scripts/lib/rank.mjs"], record: { entries: {} }, set,
    hashStaged: () => "H", liveIds: functionalIds(REPO), conformanceRowsNow: conformanceRows(REPO),
  });
  assert.deepEqual(refused.map((r) => r.entryId), [ENGINE_SOURCE]);
  assert.equal(refused[0].run, "node scripts/test/certify.mjs sweeps",
    "the frozen engine-source edit is refused with the command that produces its record");

  // And an edit to conductor.mjs demands BOTH: the module entry (the conformance set certifies it)
  // and the engine-source trigger. Neither substitutes for the other.
  const both = recordRefusals({
    stagedFiles: [ENGINE_ENTRY], record: { entries: {} }, set,
    hashStaged: () => "H", liveIds: functionalIds(REPO), conformanceRowsNow: conformanceRows(REPO),
  });
  assert.deepEqual(both.map((r) => r.entryId).sort(), [ENGINE_ENTRY, ENGINE_SOURCE].sort(),
    "conductor.mjs is demanded by both entries at once, and each names its own run");
});

// ───────────────────────────── 7.2 — the ids are DATA references ─────────────────────────────

test("7.2: a module RENAMED in the certified set leaves the record dangling — refused, not silently not-covering", () => {
  // The record is keyed on a module id. Rename the module and the key points at nothing: the entry
  // would read as a live certification of a module that no longer exists. The refusal names the id.
  const set = new Map([["scripts/lib/git-renamed.mjs", ["scripts/lib/git-renamed.mjs"]]]);
  const record = { entries: { "scripts/lib/git.mjs": { kind: "module", files: ["scripts/lib/git.mjs"], contentHash: "H", covers: [] } } };
  const refused = recordRefusals({
    stagedFiles: [], record, set, hashStaged: () => "H", liveIds: [], conformanceRowsNow: [],
  });
  assert.equal(refused.length, 1);
  assert.equal(refused[0].kind, "dangling-entry");
  assert.equal(refused[0].entryId, "scripts/lib/git.mjs");

  // ...and it is caught even when NOTHING was staged, which is the point: the dangling reference is
  // invisible to a diff-scoped check that only looks at what moved.
  const refusedUnstaged = recordRefusals({
    stagedFiles: ["README.md"], record, set, hashStaged: () => "H", liveIds: [], conformanceRowsNow: [],
  });
  assert.equal(refusedUnstaged.length, 1, "the dangling key is refused on an unrelated commit too");
});

test("7.2: deleting a CONFORMANCE ROW refuses the conductor.mjs entry, not just renaming its file", () => {
  const entry = {
    kind: "module", files: [ENGINE_ENTRY], contentHash: "H",
    covers: ["conformance"], conformanceRows: ["row one", "row two"],
  };
  const set = new Map([[ENGINE_ENTRY, [ENGINE_ENTRY]]]);
  const record = { entries: { [ENGINE_ENTRY]: entry } };

  // The row is gone from the conformance file. `covers` still resolves (the FILE is there), so a
  // file-granularity check alone would pass — and the module would read as certified by an
  // observation that no longer exists.
  const refused = recordRefusals({
    stagedFiles: [], record, set, hashStaged: () => "H",
    liveIds: ["conformance"], conformanceRowsNow: ["row one"],
  });
  assert.equal(refused.length, 1);
  assert.equal(refused[0].kind, "dangling-covers");
  assert.match(refused[0].covers, /"row two"/, "the refusal names the ROW that vanished");

  // The file renamed out from under it is the coarser failure and is caught by the covers half.
  const gone = recordRefusals({
    stagedFiles: [], record, set, hashStaged: () => "H",
    liveIds: [], conformanceRowsNow: ["row one", "row two"],
  });
  assert.equal(gone.length, 1);
  assert.equal(gone[0].covers, "conformance");

  // A healthy record over the same set is not refused.
  assert.deepEqual(recordRefusals({
    stagedFiles: [], record, set, hashStaged: () => "H",
    liveIds: ["conformance"], conformanceRowsNow: ["row one", "row two"],
  }), []);
});

test("7.2: a DELETED functional test refuses every entry that named it", () => {
  const record = {
    entries: {
      "scripts/lib/git.mjs": { kind: "module", files: ["scripts/lib/git.mjs"], contentHash: "H", covers: ["git-gateway-double", "commit-observation"] },
    },
  };
  const set = new Map([["scripts/lib/git.mjs", ["scripts/lib/git.mjs"]]]);
  const refused = recordRefusals({
    stagedFiles: [], record, set, hashStaged: () => "H",
    liveIds: ["git-gateway-double"], conformanceRowsNow: [],
  });
  assert.deepEqual(refused.map((r) => r.covers), ["commit-observation"],
    "the entry that named the deleted id is refused, and the one that did not is not");
});

// ───────────────────────────── the derivation, and what the script may do ─────────────────────────────

test("6.1: the certified set is DERIVED from the gateway calls, not typed", () => {
  const mods = certifiedModules(REPO, readFile, fs.readdirSync);
  // The seven the design names, plus the entry point — and the agreement is the ASSERTION, not the
  // source of the list: the set comes from scanning for `gitOps(` calls, so a module that starts
  // calling the gateway enters it without anyone remembering to add it.
  assert.deepEqual(mods, [
    "scripts/conductor.mjs",
    "scripts/lib/commit-watch.mjs",
    "scripts/lib/constants.mjs",
    "scripts/lib/created-at.mjs",
    "scripts/lib/git.mjs",
    "scripts/lib/subcommands.mjs",
    "scripts/lib/tool-currency.mjs",
    "scripts/lib/worktree-hygiene.mjs",
  ], "the gateway's callers, derived by scanning for gitOps() calls");
  // The two machinery files are excluded by name, and each exclusion is stated: one IS the gateway,
  // the other BUILDS it — neither can be handed a double in the sense the certified set is about.
  assert.ok(!mods.includes("scripts/lib/git-gateway.mjs"));
  assert.ok(!mods.includes("scripts/lib/invocation.mjs"));
  assert.deepEqual(engineSourceFiles(REPO, fs.readdirSync).slice(0, 1), [ENGINE_ENTRY],
    "the engine-source trigger's subject starts with the entry point");
  assert.ok(engineSourceFiles(REPO, fs.readdirSync).includes("scripts/lib/git-gateway.mjs"),
    "and covers EVERY library module, the gateway included — it hashes source, not behaviour");
});

test("6.1/6.4: the drift script starts no engine, no runner and no fixture — it reads the index", () => {
  // The capability: the checks "SHALL NOT run the functional half, drive git against a repository, or
  // spawn the engine". This pins it as source: every spawn in the script is a `git` plumbing READ,
  // and there is no engine path, no test runner and no fixture anywhere in it.
  const src = readFile(path.join(REPO, "scripts", "test", "drift.mjs"));
  const spawns = [...src.matchAll(/execFileSync\(/g)].length;
  assert.equal(spawns, 1, "the whole script has exactly ONE spawn, and it is the git index read");
  assert.deepEqual(PERMITTED_SUBCOMMANDS, ["ls-files", "diff", "show", "rev-parse"],
    "the subcommands it may ask for are the index reads and nothing else — the guard throws on any other");
  // The permitted set is enforced AT THE CALL, not only asserted here: `gitRead` throws on a
  // subcommand outside it, so a later `git commit` added to this file fails when it runs.
  assert.throws(() => gitRead(REPO, ["commit", "-m", "x"]), /not an index read/,
    "a write subcommand is refused by the call itself, not by a reader noticing it");
  assert.doesNotMatch(src, /--test/, "the drift script never starts a test runner");
  assert.doesNotMatch(src, /spawnSync|"conductor\.mjs"/, "and never starts the engine");
  assert.doesNotMatch(src, /mkdtemp|gitInit/, "and never creates a repository fixture");
});

// ───────────────────────────── 6.2/6.3 — the record the RUNNER writes ─────────────────────────────

test("6.2: a certified module's entry records what was certified, over what CONTENT, and when", () => {
  // D7's shape: per module — the files, a content hash over their bytes, the functional ids that
  // cover it, the result, the timestamp, and the engine sha as INFORMATIONAL provenance. The shape
  // is asserted rather than the values, because it is what check 4 reads back.
  const functional = functionalIds(REPO);
  const e = moduleEntry("scripts/lib/git.mjs", { root: REPO, functional, counts: { tests: 5, pass: 5, fail: 0 }, ranAt: "T", engineSha: "S" });
  assert.equal(e.kind, KIND_MODULE);
  assert.deepEqual(e.files, ["scripts/lib/git.mjs"], "the files the hash is taken over, named");
  assert.match(e.contentHash, /^[0-9a-f]{64}$/, "a sha256 over those files' bytes");
  assert.equal(e.result, "pass");
  assert.equal(e.ranAt, "T");
  assert.equal(e.engineSha, "S", "provenance only — nothing gates on it (D7)");
  assert.deepEqual(e.counts, { tests: 5, pass: 5, fail: 0 });
  assert.ok(Array.isArray(e.covers) && e.covers.every((id) => functional.includes(id)),
    `every covers id resolves to a live functional id: ${JSON.stringify(e.covers)}`);
  assert.equal(e.run, "node scripts/test/certify.mjs functional", "and the entry names the run that wrote it");
});

test("6.2: the entry point's entry carries the CONFORMANCE SET's ids, rows included", () => {
  // conductor.mjs is in the certified set by name rather than by derivation (D7), and its covers is
  // the conformance set — the in-process/CLI status equivalence is not derivable from the gateway
  // sweep. The ROWS are recorded beside the file id so a deleted row refuses (7.2).
  const e = moduleEntry(ENGINE_ENTRY, { root: REPO, functional: functionalIds(REPO), counts: {}, ranAt: "T", engineSha: "S" });
  assert.deepEqual(e.covers, ["conformance"], "the conformance FILE id");
  assert.deepEqual(e.conformanceRows, conformanceRows(REPO), "and every row it was written over");
  assert.ok(e.conformanceRows.length >= 10, `the conformance set holds ${e.conformanceRows.length} rows`);
  // Every OTHER module carries no row list: the field exists because the conformance set does.
  const other = moduleEntry("scripts/lib/git.mjs", { root: REPO, functional: functionalIds(REPO), counts: {}, ranAt: "T", engineSha: "S" });
  assert.equal(other.conformanceRows, undefined);
});

test("6.3: the engine-source trigger is a TRIGGER entry, and its subject is the whole engine source", () => {
  const e = triggerEntry({ root: REPO, counts: {}, ranAt: "T", engineSha: "S" });
  assert.equal(e.kind, KIND_TRIGGER);
  assert.equal(e.run, "node scripts/test/certify.mjs sweeps", "the refusal for it names the SWEEP run");
  assert.deepEqual(e.covers, ["output-interpolations"], "the sweep bucket's member");
  assert.ok(e.files.includes(ENGINE_ENTRY) && e.files.includes("scripts/lib/git-gateway.mjs"),
    "conductor.mjs plus every library module — the output sweep reads their SOURCE");
  assert.match(e.contentHash, /^[0-9a-f]{64}$/);
});

test("6.2: the record is written beside the suite lock, and a fresh clone reads as EMPTY rather than as an error", () => {
  // A fresh clone having no record is CORRECT (6.2's verify): the first commit touching a certified
  // module demands a run. It must not read as a crash, and it must not read as a pass.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-cert-record-"));
  const record = readRecord(dir);
  assert.deepEqual(record, { version: 1, entries: {} }, "no record is an empty record, not a failure");
  assert.deepEqual(Object.keys(readRecord(dir).entries), [], "and it certifies nothing");

  // `writeEntry` is ATOMIC and MERGING: a killed run must not leave a half-written record, and
  // recording one bucket must not drop the other's claim (an edit to conductor.mjs demands both).
  // `covers` is non-empty because the writer REFUSES an empty one (G-M2) — these entries exist to
  // prove the write is atomic and merging, and an empty covers would now fail before reaching that.
  writeEntry(dir, "scripts/lib/git.mjs", { kind: KIND_MODULE, result: "pass", contentHash: "H1", covers: ["conformance"] });
  writeEntry(dir, "engine-source", { kind: KIND_TRIGGER, result: "pass", contentHash: "H2", covers: ["output-interpolations"] });
  const after = readRecord(dir);
  assert.deepEqual(Object.keys(after.entries).sort(), ["engine-source", "scripts/lib/git.mjs"],
    "the second write kept the first");
  assert.equal(after.entries["scripts/lib/git.mjs"].contentHash, "H1");
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f !== RECORD_NAME), [], "no half-written temp file survives");
  assert.match(RECORD_NAME, /\.json$/, "and the record is machine-readable by name");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("G-M1 the refusal says WHICH KIND of thing changed — the trigger is not a module", () => {
  // The refusal read `set.get(entryId).kind`, and `certifiedSet()` maps an id to its FILES, so the
  // noun was always `undefined`, the trigger branch in describeRefusal never fired, and a refusal
  // about the engine-source trigger printed "the certified module 'engine-source' changed".
  const set = certifiedSet(REPO);
  const record = { entries: {
    [ENGINE_SOURCE]: { kind: KIND_TRIGGER, result: "pass", contentHash: "OLD", covers: ["output-interpolations"] },
    "scripts/lib/git.mjs": { kind: KIND_MODULE, result: "pass", contentHash: "OLD", covers: ["tool-currency"] },
  } };
  const refused = recordRefusals({
    stagedFiles: ["scripts/lib/rank.mjs", "scripts/lib/git.mjs"],
    record, set, hashStaged: () => "NEW",
    liveIds: [...functionalIds(REPO), ...sweepIds(REPO)], conformanceRowsNow: conformanceRows(REPO),
  });
  const trigger = refused.find((r) => r.entryId === ENGINE_SOURCE);
  const module = refused.find((r) => r.entryId === "scripts/lib/git.mjs");
  assert.ok(trigger && module, "both demands are refused by the same edit set");
  assert.equal(trigger.noun, KIND_TRIGGER, "the engine-source entry is a TRIGGER, not a module");
  assert.equal(module.noun, KIND_MODULE);
  assert.match(describeRefusal(trigger), /change-triggered bucket 'engine-source'/,
    "so the developer is told which bucket moved, and which command re-certifies it");
  assert.match(describeRefusal(module), /the certified module 'scripts\/lib\/git\.mjs'/);

  // AND THE DERIVATION CARRIES IT when the record has no entry at all — the case that made the
  // fallback necessary, since `entry` is then undefined.
  const noEntry = recordRefusals({
    stagedFiles: ["scripts/lib/rank.mjs"], record: { entries: {} }, set, hashStaged: () => "NEW",
    liveIds: [...functionalIds(REPO), ...sweepIds(REPO)], conformanceRowsNow: conformanceRows(REPO),
  }).find((r) => r.entryId === ENGINE_SOURCE);
  assert.equal(noEntry.noun, KIND_TRIGGER, "a missing entry still names the trigger as a trigger");
});

test("G-M2 the record writer REFUSES an entry with an empty covers, and writes nothing", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-cert-covers-"));
  const written = [];
  const fakeIo = {
    readFileSync: () => { const e = new Error("ENOENT"); e.code = "ENOENT"; throw e; },
    writeFileSync: (p) => written.push(p),
    renameSync: (a, b) => written.push(`${a}->${b}`),
  };
  assert.throws(
    () => writeEntry(dir, "scripts/lib/git.mjs", { kind: KIND_MODULE, result: "pass", contentHash: "H", covers: [] }, fakeIo),
    /EMPTY covers/, "an empty covers must be refused by name");
  assert.throws(
    () => writeEntry(dir, "scripts/lib/git.mjs", { kind: KIND_MODULE, result: "pass", contentHash: "H" }, fakeIo),
    /EMPTY covers/, "and so must a missing one, which is the same thing with a different spelling");
  assert.deepEqual(written, [], "a refused entry must not reach the record — not even a temp file");
  fs.rmSync(dir, { recursive: true, force: true });

  // AND THE DERIVATION ACTUALLY SATISFIES IT for every certified module in this repository: the
  // refusal is only usable if nothing legitimate is empty, or the runner would be unable to write a
  // record at all. `commit-watch.mjs` resolved to [] before coversFor learned the import form.
  for (const id of certifiedModules(REPO)) {
    assert.ok(coversFor(id).length > 0,
      `'${id}' is in the certified set and resolves to no covering id — the record for it could not be written`);
  }
});

test("check 4 — a covers id from the SWEEP BUCKET resolves (found by running the gate end-to-end)", () => {
  // THE BUG THIS PINS, found by running the drift script against a record `certify sweeps` had just
  // written — not by reading it. Check 4 resolved `covers` against the FUNCTIONAL half alone, and the
  // engine-source trigger's own member (`output-interpolations`) lives in the SWEEP bucket, so every
  // record the sweep runner produced was refused as dangling and the refusal named the very command
  // that had just satisfied it. That is the worst shape a refusal can have: unsatisfiable.
  const set = new Map([[ENGINE_SOURCE, engineSourceFiles(REPO)]]);
  const record = { entries: { [ENGINE_SOURCE]: { kind: KIND_TRIGGER, result: "pass", contentHash: "H", covers: ["output-interpolations"] } } };
  const resolved = recordRefusals({
    stagedFiles: [], record, set, hashStaged: () => "H",
    liveIds: [...functionalIds(REPO), ...sweepIds(REPO)], conformanceRowsNow: conformanceRows(REPO),
  });
  assert.deepEqual(resolved, [], "a sweeps id in covers is a live id, and the record is accepted");
  assert.ok(sweepIds(REPO).includes("output-interpolations"), "the sweep bucket's ids are enumerable off disk");

  // ...and the denial is not a weakening: an id in NEITHER half NOR the bucket is still refused.
  const dangling = recordRefusals({
    stagedFiles: [], record: { entries: { [ENGINE_SOURCE]: { kind: KIND_TRIGGER, result: "pass", contentHash: "H", covers: ["no-such-id"] } } },
    set, hashStaged: () => "H",
    liveIds: [...functionalIds(REPO), ...sweepIds(REPO)], conformanceRowsNow: conformanceRows(REPO),
  });
  assert.equal(dangling.length, 1);
  assert.equal(dangling[0].covers, "no-such-id");
});
