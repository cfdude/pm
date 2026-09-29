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
// THE RECORD IS A DIRECTORY OF MANIFESTS since certification-record-redesign 2.4 (design D1): one
// entry per passing run, named by the sha256 of its manifest (mode and blob id per subject path), and
// check 4 is a keyed LOOKUP of the one entry whose manifest equals the commit's whole subject. The
// covers/dangling-id half of the old check 4 retired with it: a deleted test or a removed conformance
// row is now a staged change to the subject, demanding a run. The pure decision is pinned on the unit
// rung (`unit/drift-freshness`); this file pins the record's BYTES and the derivations.
//
// WHAT THIS FILE CANNOT REACH, AND ITS FUNCTIONAL TWIN DOES (G-I2). Every check-4 case below hands the
// manifest in as a value, so the decision is tested and the READER is not: a manifest read from the
// worktree instead of the index would leave all of these green. `scripts/test/functional/
// drift-script.test.mjs` builds that state in a real repository and requires the refusal, and it holds
// the two cases that need real git: a staged deletion judged through HEAD, and X1's two indexes.

import "../fixtures/assert-git-shim.mjs";  // the run-time git counter, installed in THIS process (0.49.0, D3 row 1)
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { removeAtExit } from "../fixtures/temp-dir.mjs";  // gh-cfdude-pm-224: scratch dirs are removed at exit
import {
  ENGINE_ENTRY, REPO, assertionIds, bucketSubject, certifiedModules, couplingRefusals, describeRefusal,
  engineSourceFiles, enrolmentRefusals, freshnessRefusal, functionalIds, homeOf, twinRefusals,
  writeManifestEntry,
} from "../certification.mjs";
import { PERMITTED_SUBCOMMANDS, gitRead } from "../drift.mjs";
import * as recordDir from "../certification.mjs";  // 2.2: resolved per test, so a missing export fails that test alone

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

test("check 4 — a staged subject change with no agreeing entry is REFUSED, naming the bucket, the paths and the run", () => {
  const common = scratchCommonDir();
  const refusal = freshnessRefusal({
    commonDir: common, bucket: "functional", stagedPaths: ["scripts/lib/git.mjs"],
    indexPaths: new Set(["scripts/lib/git.mjs", "scripts/test/functional/alpha.test.mjs"]),
    subjectIndex: () => ["scripts/lib/git.mjs", "scripts/test/functional/alpha.test.mjs"], subjectHead: () => [],
    manifest: () => RD_MANIFEST,
  });
  assert.equal(refusal.kind, "stale-record");
  assert.equal(refusal.bucket, "functional", "the refusal names the bucket");
  assert.deepEqual(refusal.changed, ["scripts/lib/git.mjs"], "and the staged subject paths");
  assert.equal(refusal.run, "node scripts/test/certify.mjs functional",
    "and the command that would satisfy it — a refusal a developer cannot satisfy is a refusal that gets bypassed");
  assert.match(describeRefusal(refusal), /node scripts\/test\/certify\.mjs functional/);
});

test("check 4 — FRESHNESS IS THE CONTENT, not the age and not the commit", () => {
  const common = scratchCommonDir();
  const args = (manifest, staged = ["scripts/lib/a.mjs"]) => ({
    commonDir: common, bucket: "functional", stagedPaths: staged, indexPaths: new Set(Object.keys(manifest)),
    subjectIndex: () => Object.keys(manifest), subjectHead: () => [], manifest: () => manifest,
  });
  // An OLD entry over identical content → NO run demanded. "An unchanged module needs no new run" is
  // a scenario in the spec, not an incidental optimisation.
  writeManifestEntry(common, { bucket: "functional", manifest: RD_MANIFEST }, { now: () => new Date("2020-01-01T00:00:00.000Z") });
  assert.equal(freshnessRefusal(args(RD_MANIFEST)), null, "an unchanged subject needs no new run, however old the entry is");
  // A RECENT entry, changed content → a run demanded.
  const changed = { ...RD_MANIFEST, "scripts/lib/a.mjs": `100644 ${"9".repeat(40)}` };
  assert.ok(freshnessRefusal(args(changed)), "a changed subject needs a new run however recent the record");
  // A commit that stages nothing in the subject is not refused at all.
  assert.equal(freshnessRefusal(args(changed, ["README.x"])), null, "an unrelated commit is not refused — that is the whole point of a trigger");
});

test("check 4 — the sweeps bucket is a SECOND, disjoint demand, and each subject is the interim path classes (2.4)", () => {
  // A synthetic INDEX, read the way drift reads one: `paths` is its listing, `readFile` its bytes.
  const files = {
    "scripts/conductor.mjs": "export const main = () => gitOps();\n",
    "scripts/lib/git.mjs": "export const a = () => gitOps();\n",
    "scripts/lib/rank.mjs": "export const rank = () => 0;\n",
    "scripts/test/functional/alpha.test.mjs": "",
    "scripts/test/fixtures/helper.mjs": "",
    "scripts/test/assert/alpha.test.mjs": "",
    "scripts/test/sweeps/output-interpolations.mjs": "",
    "scripts/test/sweeps/output-interpolations.test.mjs": "",
    "scripts/test/certify.mjs": "", "scripts/test/certification.mjs": "", "scripts/test/drift.mjs": "",
  };
  const paths = Object.keys(files);
  const rel = (abs) => path.relative(REPO, abs).split(path.sep).join("/");
  const readFile = (abs) => files[rel(abs)] ?? "";
  const readdir = (abs) => [...new Set(paths.filter((p) => p.startsWith(`${rel(abs)}/`)).map((p) => p.slice(rel(abs).length + 1).split("/")[0]))];
  const subject = (bucket) => new Set(bucketSubject(bucket, { root: REPO, readFile, readdir, paths }));
  const functional = subject("functional");
  const sweeps = subject("sweeps");
  const demands = (p) => ["functional", "sweeps"].filter((b) => (b === "functional" ? functional : sweeps).has(p));

  assert.deepEqual(demands("scripts/lib/rank.mjs"), ["sweeps"], "a library module that makes no gateway call demands the SWEEPS only (L2; L3 widens this)");
  assert.deepEqual(demands("scripts/lib/git.mjs"), ["functional", "sweeps"], "a gateway caller demands BOTH, and neither substitutes");
  assert.deepEqual(demands(ENGINE_ENTRY), ["functional", "sweeps"], "the entry point, which calls the gateway, demands both");
  assert.deepEqual(demands("scripts/test/sweeps/output-interpolations.mjs"), ["sweeps"],
    "the sweep's own METHOD is in its subject: staging only it demands a sweeps run (the #229 shape, one bucket over)");
  assert.deepEqual(demands("scripts/test/sweeps/output-interpolations.test.mjs"), ["sweeps"]);
  assert.deepEqual(demands("scripts/test/functional/alpha.test.mjs"), ["functional"], "every functional test file is in the functional subject");
  assert.deepEqual(demands("scripts/test/fixtures/helper.mjs"), ["functional"], "so is every fixture");
  for (const m of ["scripts/test/certify.mjs", "scripts/test/certification.mjs", "scripts/test/drift.mjs"]) {
    assert.deepEqual(demands(m), ["functional"], `the certification machinery (${m}) is in the functional subject (B9)`);
  }
  assert.deepEqual(demands("scripts/test/assert/alpha.test.mjs"), [], "an assertion-half file is in no subject: the per-commit gate runs it");
  assert.ok(functional.has("scripts/test/js-lexer.mjs") && sweeps.has("scripts/test/js-lexer.mjs"),
    "js-lexer.mjs is named by both (from 3.1); the subject ∩ index rule drops it while the index holds none");
});

test("check 4 — an entry from another tree neither passes nor refuses", () => {
  // Worktree B certified content holding a functional test only B has. A's commit is judged by A's
  // own manifest alone: B's entry is never consulted, so it can neither certify A nor refuse it.
  const common = scratchCommonDir();
  const foreign = { ...RD_MANIFEST, "scripts/test/functional/only-on-b.test.mjs": `100644 ${"b".repeat(40)}` };
  writeManifestEntry(common, { bucket: "functional", manifest: foreign });
  const args = {
    commonDir: common, bucket: "functional", stagedPaths: ["scripts/lib/a.mjs"], indexPaths: new Set(Object.keys(RD_MANIFEST)),
    subjectIndex: () => Object.keys(RD_MANIFEST), subjectHead: () => [], manifest: () => RD_MANIFEST,
  };
  const alone = freshnessRefusal(args);
  assert.ok(alone, "the foreign entry is no pass");
  assert.doesNotMatch(describeRefusal(alone), /only-on-b/, "and the refusal says nothing about it — it is not a dangling pointer");
  writeManifestEntry(common, { bucket: "functional", manifest: RD_MANIFEST });
  assert.equal(freshnessRefusal(args), null, "A's own agreeing entry certifies A, beside B's");
  assert.equal(fs.readdirSync(path.join(common, "pm-suite-certification.d", "functional")).length, 2, "and both entries remain");
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
  // spawn the engine". This pins it as source: every spawn in the script is a git READ, and there is
  // no engine path, no test runner and no fixture anywhere in it.
  const src = readFile(path.join(REPO, "scripts", "test", "drift.mjs"));
  const spawns = [...src.matchAll(/execFileSync\(/g)].length;
  assert.equal(spawns, 1, "the whole script has exactly ONE spawn, and it is the git read");
  assert.deepEqual(PERMITTED_SUBCOMMANDS, ["ls-files", "diff", "show", "rev-parse", "ls-tree"],
    "the subcommands it may ask for are reads and nothing else — `ls-tree` since 2.4, to judge a staged " +
    "deletion against HEAD's tree — and the guard throws on any other");
  // The permitted set is enforced AT THE CALL, not only asserted here: `gitRead` throws on a
  // subcommand outside it, so a later `git commit` added to this file fails when it runs.
  assert.throws(() => gitRead(REPO, ["commit", "-m", "x"]), /not an index read/,
    "a write subcommand is refused by the call itself, not by a reader noticing it");
  assert.doesNotMatch(src, /--test/, "the drift script never starts a test runner");
  assert.doesNotMatch(src, /spawnSync|"conductor\.mjs"/, "and never starts the engine");
  assert.doesNotMatch(src, /mkdtemp|gitInit/, "and never creates a repository fixture");
  // ONE INDEX OVERRIDE, AND IT IS IN gitRead() (2.4, Gate 1 round 5 X1): every read that is about a
  // particular index passes `indexFile` down to the one spawn, so no read pairs one index's listing
  // with another's bytes. Comments are stripped first (a line-comment and block-comment filter; 3.1
  // replaces it with the shared lexer), so documenting the variable is not a violation.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const start = code.indexOf("export function gitRead(");
  const end = code.indexOf("\n}\n", start);
  assert.ok(start !== -1 && end !== -1, "drift.mjs defines gitRead()");
  const uses = [...code.matchAll(/GIT_INDEX_FILE/g)].map((m) => m.index);
  assert.ok(uses.length >= 1, "gitRead() hands an indexFile to git as GIT_INDEX_FILE");
  for (const at of uses) {
    assert.ok(at > start && at < end, `GIT_INDEX_FILE appears in drift.mjs's code outside gitRead(): …${code.slice(at - 60, at + 20)}…`);
  }
  assert.throws(() => gitRead(REPO, ["ls-files"], { indexFile: ".git/index" }), /absolute/,
    "a relative indexFile is refused before git runs: `-C root` would re-anchor it");
});

// ───────────────────────────── the refusal the gate prints ─────────────────────────────

test("G-M1 the refusal says WHICH BUCKET changed, which paths, and which run satisfies it", () => {
  // Rewritten at 2.4: the refusal used to name "the certified module '<id>'" (and, by a bug G-M1 fixed,
  // called the engine-source trigger a module too). There are now two buckets and no module ids, so
  // the sentence names the bucket, the staged subject paths and the run.
  const sweeps = { kind: "stale-record", bucket: "sweeps", changed: ["scripts/lib/rank.mjs"],
    run: "node scripts/test/certify.mjs sweeps", why: "no passing run over this content is recorded" };
  assert.match(describeRefusal(sweeps), /^the sweeps bucket's subject changed \(scripts\/lib\/rank\.mjs\), and no passing run over this content is recorded\. Run `node scripts\/test\/certify\.mjs sweeps`/,
    "so the developer is told which bucket moved, over which paths, and which command re-certifies it");
  const functional = { ...sweeps, bucket: "functional", changed: ["scripts/lib/git.mjs", "scripts/test/functional/x.test.mjs"],
    run: "node scripts/test/certify.mjs functional" };
  assert.match(describeRefusal(functional), /the functional bucket's subject changed \(scripts\/lib\/git\.mjs, scripts\/test\/functional\/x\.test\.mjs\)/);
  assert.doesNotMatch(describeRefusal(functional), /certified module|change-triggered/, "the retired vocabulary is gone");
});

// ───────────────────────────── 2.2 — the record DIRECTORY (certification-record-redesign D1) ─────────────────────────────
//
// FILE RUNG: each case writes the record directory under a scratch common dir, because the observable
// is the bytes and names on disk — an entry named by its manifest's sha256, created through a unique
// temp name and a rename, never rewritten, and pruned only by age.


const RD_MANIFEST = Object.freeze({
  "scripts/lib/a.mjs": `100644 ${"1".repeat(40)}`,
  "scripts/test/functional/alpha.test.mjs": `100644 ${"7".repeat(40)}`,
});
const scratchCommonDir = () => removeAtExit(fs.mkdtempSync(path.join(os.tmpdir(), "pm-cert-dir-")));
function rd() {
  for (const name of ["writeManifestEntry", "readEntry", "pruneRecord", "manifestKey"]) {
    assert.equal(typeof recordDir[name], "function", `certification.mjs exports no ${name}(): the manifest record directory has no ${name}`);
  }
  return recordDir;
}
/** An `io` that is `fs`, recording each write and rename it is asked for. */
function recordingIo(log, over = {}) {
  return {
    ...fs,
    writeFileSync: (p, ...rest) => { log.push(["write", p]); return fs.writeFileSync(p, ...rest); },
    renameSync: (a, b) => { log.push(["rename", a, b]); return fs.renameSync(a, b); },
    ...over,
  };
}

test("2.2 writeManifestEntry() names the file by the manifest's sha256 and creates it through a unique temp name plus a rename", () => {
  const { writeManifestEntry, readEntry, manifestKey } = rd();
  const common = scratchCommonDir();
  const log = [];
  const w = writeManifestEntry(common, { bucket: "functional", manifest: RD_MANIFEST, counts: { tests: 1, pass: 1, fail: 0 }, engineSha: "S", worktree: "W" }, { io: recordingIo(log) });
  const key = manifestKey(RD_MANIFEST);
  assert.equal(w.key, key);
  const dir = path.join(common, "pm-suite-certification.d", "functional");
  assert.equal(w.file, path.join(dir, `${key}.json`), "the entry is <common>/pm-suite-certification.d/<bucket>/<key>.json");
  assert.deepEqual(fs.readdirSync(dir), [`${key}.json`], "one file, and no temp file survives");
  const [write, rename] = log;
  assert.equal(write[0], "write");
  assert.match(path.basename(write[1]), new RegExp(`^${key}\\.${process.pid}\\.[0-9a-f]+\\.tmp$`), "the bytes go to a UNIQUE temp name first");
  assert.deepEqual(rename, ["rename", write[1], w.file], "and are renamed into place, so no reader sees a half-written entry");
  const e = readEntry(common, "functional", key);
  assert.deepEqual(e.manifest, RD_MANIFEST);
  assert.equal(e.version, 2);
  assert.equal(e.bucket, "functional");
  assert.equal(e.result, "pass");
  assert.equal(e.engineSha, "S");
  assert.equal(e.worktree, "W");
  assert.ok(!Number.isNaN(Date.parse(e.ranAt)), "ranAt is set when the entry is written");
  // A second write of the same content takes a DIFFERENT temp name: two runs over identical content
  // never share one.
  writeManifestEntry(common, { bucket: "functional", manifest: RD_MANIFEST }, { io: recordingIo(log) });
  assert.notEqual(log[2][1], write[1], "each write has its own temp name");
  assert.equal(readEntry(common, "functional", "0".repeat(64)), null, "an absent entry is no entry");
  assert.equal(readEntry(scratchCommonDir(), "sweeps", key), null, "an absent directory is no entry");
});

test("2.2 two writers interleaved through an injected io both survive whole (Concurrent writers lose no entry)", () => {
  const { writeManifestEntry, readEntry, manifestKey } = rd();
  const common = scratchCommonDir();
  const other = { ...RD_MANIFEST, "scripts/lib/b.mjs": `100644 ${"2".repeat(40)}` };
  let interleaved = false;
  // The first writer is paused between its temp write and its rename, and the second writer runs to
  // completion in that window — the read-modify-rename record lost one of the two exactly here.
  const io = recordingIo([], {
    renameSync: (a, b) => {
      if (!interleaved) {
        interleaved = true;
        writeManifestEntry(common, { bucket: "functional", manifest: other }, { io: fs });
      }
      return fs.renameSync(a, b);
    },
  });
  writeManifestEntry(common, { bucket: "functional", manifest: RD_MANIFEST }, { io });
  assert.equal(interleaved, true, "precondition: the second writer ran inside the first's window");
  assert.deepEqual(readEntry(common, "functional", manifestKey(RD_MANIFEST)).manifest, RD_MANIFEST, "the first entry is whole");
  assert.deepEqual(readEntry(common, "functional", manifestKey(other)).manifest, other, "and so is the second");
  assert.equal(fs.readdirSync(path.join(common, "pm-suite-certification.d", "functional")).length, 2);
});

test("2.2 pruning keeps the newest 50 by ranAt, and never the entry just written", () => {
  const { writeManifestEntry, pruneRecord, manifestKey } = rd();
  const common = scratchCommonDir();
  const t0 = Date.parse("2026-01-01T00:00:00.000Z");
  for (let i = 0; i < 55; i++) {
    const m = { ...RD_MANIFEST, "scripts/lib/n.mjs": `100644 ${String(i).padStart(40, "0")}` };
    writeManifestEntry(common, { bucket: "functional", manifest: m }, { now: () => new Date(t0 + (i + 1) * 60000) });
  }
  // The run that just finished wrote the OLDEST ranAt of all (a clock that went back): it still stays.
  const mine = { ...RD_MANIFEST, "scripts/lib/n.mjs": `100644 ${"f".repeat(40)}` };
  const { key } = writeManifestEntry(common, { bucket: "functional", manifest: mine }, { now: () => new Date(t0) });
  pruneRecord(common, "functional", { keep: key, tmpDir: scratchCommonDir() });
  const left = fs.readdirSync(path.join(common, "pm-suite-certification.d", "functional")).sort();
  assert.equal(left.length, 50, `the bucket is pruned to 50 entries: ${left.length}`);
  assert.ok(left.includes(`${key}.json`), "the entry just written is never pruned");
  const newest = Array.from({ length: 49 }, (_, j) => 54 - j)
    .map((i) => `${manifestKey({ ...RD_MANIFEST, "scripts/lib/n.mjs": `100644 ${String(i).padStart(40, "0")}` })}.json`);
  for (const f of newest) assert.ok(left.includes(f), `a newer entry was pruned: ${f}`);
});

test("2.2 pruning removes a *.tmp older than 1 hour and a pm-certify-run.* older than 24 hours, and keeps younger ones", () => {
  const { writeManifestEntry, pruneRecord } = rd();
  const common = scratchCommonDir();
  const tmpDir = scratchCommonDir();
  const { key } = writeManifestEntry(common, { bucket: "sweeps", manifest: { "scripts/test/sweeps/s.test.mjs": `100644 ${"5".repeat(40)}` } });
  const dir = path.join(common, "pm-suite-certification.d", "sweeps");
  const age = (p, ms) => { const t = new Date(Date.now() - ms); fs.utimesSync(p, t, t); };
  const oldTmp = path.join(dir, `${"a".repeat(64)}.1.aa.tmp`);
  const youngTmp = path.join(dir, `${"b".repeat(64)}.1.bb.tmp`);
  fs.writeFileSync(oldTmp, "{");
  fs.writeFileSync(youngTmp, "{");
  age(oldTmp, 2 * 3600 * 1000);
  age(youngTmp, 10 * 60 * 1000);
  const oldRun = path.join(tmpDir, "pm-certify-run.OLD");
  const youngRun = path.join(tmpDir, "pm-certify-run.YOUNG");
  const unrelated = path.join(tmpDir, "someone-else.OLD");
  for (const d of [oldRun, youngRun, unrelated]) fs.mkdirSync(path.join(d, "tree"), { recursive: true });
  age(oldRun, 25 * 3600 * 1000);
  age(youngRun, 23 * 3600 * 1000);
  age(unrelated, 25 * 3600 * 1000);
  pruneRecord(common, "sweeps", { keep: key, tmpDir });
  assert.equal(fs.existsSync(oldTmp), false, "an orphan temp file older than an hour is removed");
  assert.equal(fs.existsSync(youngTmp), true, "a younger temp file may belong to a live writer, and stays");
  assert.equal(fs.existsSync(oldRun), false, "a run directory older than 24 hours was left by a SIGKILL'd certify, and is removed");
  assert.equal(fs.existsSync(youngRun), true, "a younger run directory may be a live run, and stays");
  assert.equal(fs.existsSync(unrelated), true, "nothing that is not a certify run directory is touched");
  assert.ok(fs.existsSync(path.join(dir, `${key}.json`)));
});

test("2.2 a manifest holding no test file of its bucket is refused, and nothing is written", () => {
  const { writeManifestEntry } = rd();
  const common = scratchCommonDir();
  const noTest = { "scripts/lib/a.mjs": RD_MANIFEST["scripts/lib/a.mjs"] };
  assert.throws(() => writeManifestEntry(common, { bucket: "functional", manifest: noTest }), /no test file of the functional bucket/,
    "a pass with no test of its bucket behind it is not a certification");
  assert.throws(() => writeManifestEntry(common, { bucket: "sweeps", manifest: RD_MANIFEST }), /no test file of the sweeps bucket/,
    "a functional test does not make a sweeps entry");
  assert.throws(() => writeManifestEntry(common, { bucket: "engine-source", manifest: RD_MANIFEST }), /bucket/,
    "the buckets are `functional` and `sweeps`");
  assert.equal(fs.existsSync(path.join(common, "pm-suite-certification.d")), false, "a refused entry writes nothing, not even its directory");
});

// ───────────────────────────── 2.3 — migration: the two formats coexist (design D5, Gate 1 B5) ─────────────────────────────
//
// The single-file record is never parsed by the new gate and never removed by the new runner: a
// rollback to the old drift finds its record where it was left. A clone with no record directory
// behaves as a record with no entries.

// The superseded single-file shape: one entry per certified id with its files and covers (its
// per-entry byte hash is left out — only the file's presence and bytes matter to these cases).
const LEGACY = JSON.stringify({ version: 1, entries: {
  "scripts/lib/a.mjs": { kind: "module", files: ["scripts/lib/a.mjs"], covers: ["alpha"], result: "pass" },
  "engine-source": { kind: "trigger", files: ["scripts/conductor.mjs"], covers: ["output-interpolations"], result: "pass" },
} }, null, 2) + "\n";

function freshnessOf(common, { staged, subject = ["scripts/lib/a.mjs", "scripts/test/functional/alpha.test.mjs"] } = {}) {
  assert.equal(typeof recordDir.freshnessRefusal, "function",
    "certification.mjs exports no freshnessRefusal(): the record directory is never consulted as a whole — demand, manifest and one keyed entry");
  const calls = { index: 0, head: 0, manifest: 0 };
  const refusal = recordDir.freshnessRefusal({
    commonDir: common, bucket: "functional", stagedPaths: staged, indexPaths: new Set(Object.keys(RD_MANIFEST)),
    subjectIndex: () => { calls.index += 1; return subject; },
    subjectHead: () => { calls.head += 1; return subject; },
    manifest: () => { calls.manifest += 1; return RD_MANIFEST; },
  });
  return { refusal, calls };
}

test("2.3 a common dir holding only pm-suite-certification.json yields ZERO entries", () => {
  const common = scratchCommonDir();
  fs.writeFileSync(path.join(common, "pm-suite-certification.json"), LEGACY);
  for (const bucket of ["functional", "sweeps"]) {
    assert.equal(rd().readEntry(common, bucket, rd().manifestKey(RD_MANIFEST)), null, `the legacy file certifies nothing for ${bucket}`);
  }
  const { refusal } = freshnessOf(common, { staged: ["scripts/lib/a.mjs"] });
  assert.ok(refusal, "a staged subject path with only the legacy record present is a DEMAND, not a pass read from the old file");
  assert.equal(refusal.bucket, "functional");
  assert.equal(fs.readFileSync(path.join(common, "pm-suite-certification.json"), "utf8"), LEGACY, "and reading left the legacy file alone");
});

test("2.3 writeManifestEntry() leaves the legacy file byte-identical", () => {
  const common = scratchCommonDir();
  const legacy = path.join(common, "pm-suite-certification.json");
  fs.writeFileSync(legacy, LEGACY);
  rd().writeManifestEntry(common, { bucket: "functional", manifest: RD_MANIFEST });
  rd().pruneRecord(common, "functional", { keep: rd().manifestKey(RD_MANIFEST), tmpDir: scratchCommonDir() });
  assert.equal(fs.readFileSync(legacy, "utf8"), LEGACY,
    "the new runner neither rewrites nor removes the superseded record — a rollback finds it where it was left (D5)");
});

test("2.3 a fresh clone (no record directory) demands a run only when a subject path is staged", () => {
  const common = scratchCommonDir();
  const quiet = freshnessOf(common, { staged: ["openspec/changes/x/tasks.md", "docs/lessons/x.md"] });
  assert.equal(quiet.refusal, null, "a commit staging nothing in any subject is not refused");
  assert.deepEqual(quiet.calls, { index: 0, head: 0, manifest: 0 }, "and pays for no derivation and no manifest");
  const loud = freshnessOf(common, { staged: ["scripts/lib/a.mjs", "openspec/changes/x/tasks.md"] });
  assert.ok(loud.refusal, "a staged subject path with no record is refused");
  assert.deepEqual(loud.refusal.changed, ["scripts/lib/a.mjs"], "naming the staged subject paths");
  assert.equal(loud.refusal.run, "node scripts/test/certify.mjs functional", "and the run that satisfies it");
  assert.equal(loud.calls.manifest, 1);
  // ...and once that run's entry exists, the same commit is fresh.
  rd().writeManifestEntry(common, { bucket: "functional", manifest: RD_MANIFEST });
  assert.equal(freshnessOf(common, { staged: ["scripts/lib/a.mjs"] }).refusal, null, "the agreeing entry satisfies the demand");
});
