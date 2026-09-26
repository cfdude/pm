// gates-bind-to-verified-evidence — a recorded commit is resolved when it is written, a withdrawal
// matches the attributed commit rather than its spelling, staleness reads every attributed commit,
// and integrity reports a recorded value that is not a commit object name.
//
// Every fixture here holds REAL commits (fixtureCommits in helpers.mjs). A fake sha is now refused
// at write, so a test that fed one would be exercising the refusal rather than the rule it names.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { removeAtExit } from "../fixtures/temp-dir.mjs";  // gh-cfdude-pm-224: scratch dirs are removed at exit
import { execFileSync, spawnSync } from "node:child_process";
import { ENGINE, EMPTY_CACHE, tmpRepo, run, readState, writeState, parseBrief, fixtureCommits, fixtureCommit } from "../fixtures/functional-harness.mjs";

const stateFile = (cwd) => path.join(cwd, ".conductor", "state.json");
const stateBytes = (cwd) => fs.readFileSync(stateFile(cwd));
const epicOf = (cwd, id) => readState(cwd).epics.find(e => e.id === id);
const git = (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

function attempt(cwd, args) {
  const r = spawnSync("node", [ENGINE, ...args], {
    cwd, encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: cwd, PM_CACHE_ROOT: EMPTY_CACHE },
  });
  return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}
function refused(cwd, args) {
  const before = stateBytes(cwd);
  const r = attempt(cwd, args);
  assert.notEqual(r.status, 0, `expected a refusal, got exit 0.\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
  assert.ok(stateBytes(cwd).equals(before), "a refused invocation must leave state.json byte-identical");
  return r;
}
function accepted(cwd, args) {
  const r = attempt(cwd, args);
  assert.equal(r.status, 0, `expected exit 0.\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
  return r;
}

/** An initialized pm repository holding `names` as real linear commits on branch `main`. */
function repoWith(names = ["root", "one"]) {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const shas = fixtureCommits(cwd, names);
  git(cwd, ["branch", "-M", "main"]);
  run(["add-epic", "--id", "e", "--lane", "openspec"], { cwd });
  return { cwd, shas };
}

// ═══════════════ Requirement: A recorded commit is resolved when it is written ═══════════════

test("2.1 --attribute-commit of a value that is not a commit is refused naming it, byte-identical", () => {
  const { cwd } = repoWith();
  const r = refused(cwd, ["update-epic", "e", "--attribute-commit", "not-a-commit"]);
  assert.match(r.stderr, /not-a-commit/, "the refusal names the value that did not resolve");
});

test("2.2 a moving ref is stored as the commit it named at the time of the call", () => {
  const { cwd, shas: [root, one] } = repoWith();
  accepted(cwd, ["record-gate-review", "e", "--gate", "2", "--verdict", "pass",
    "--base-sha", "main~1", "--head-sha", "HEAD", "--reviewer", "r"]);
  fixtureCommit(cwd, "later");
  const entry = epicOf(cwd, "e").gateReview.gate2;
  assert.equal(entry.baseSha, root, "main~1 is recorded as the full name it named at call time");
  assert.equal(entry.headSha, one, "HEAD is recorded as the full name it named at call time");
});

test("2.3 a unique short hash is stored as its commit's full name, and the read-back passes", () => {
  const { cwd, shas: [, one] } = repoWith();
  accepted(cwd, ["update-epic", "e", "--attribute-commit", one.slice(0, 10)]);
  assert.deepEqual(epicOf(cwd, "e").attributedCommits, [one]);
});

test("2.4 REGRESSION GUARD: a commit reachable only from a presquash/* tag, attributed from another branch, resolves", () => {
  const { cwd, shas: [, one] } = repoWith();
  const tree = git(cwd, ["rev-parse", "HEAD^{tree}"]);
  const squashed = execFileSync("git", ["commit-tree", tree, "-p", one, "-m", "pre-squash work"],
    { cwd, encoding: "utf8" }).trim();
  git(cwd, ["tag", "presquash/work", squashed]);
  git(cwd, ["checkout", "-q", "-b", "elsewhere"]);
  assert.equal(git(cwd, ["branch", "--contains", squashed]), "", "no branch holds the commit");
  accepted(cwd, ["update-epic", "e", "--attribute-commit", squashed.slice(0, 12)]);
  assert.deepEqual(epicOf(cwd, "e").attributedCommits, [squashed]);
});

test("2.5 a range bound that is not a commit is refused naming it, and no verdict is recorded", () => {
  const { cwd, shas: [, one] } = repoWith();
  const r = refused(cwd, ["record-gate-review", "e", "--gate", "2", "--verdict", "pass",
    "--base-sha", "root", "--head-sha", one]);
  assert.match(r.stderr, /root/, "the refusal names the unresolved bound");
  assert.equal(epicOf(cwd, "e").gateReview, undefined, "no verdict was recorded");
});

// ═══════════════ Requirement: A commit withdrawal matches the attributed commit, not its spelling ═══════════════

/** Rewrite one epic in state.json as a state file an earlier release could have written. */
function seedEpic(cwd, id, patch) {
  const s = readState(cwd);
  Object.assign(s.epics.find(e => e.id === id), patch);
  writeState(cwd, s);
}

test("3.1 a full hash withdraws the short legacy entry of the same commit, and the record names the stored entry", () => {
  const { cwd, shas: [, one] } = repoWith();
  const short = one.slice(0, 7);
  seedEpic(cwd, "e", { attributedCommits: [short] });
  accepted(cwd, ["update-epic", "e", "--withdraw-commit", one, "--withdrawal-reason", "x"]);
  const e = epicOf(cwd, "e");
  assert.deepEqual(e.attributedCommits, [], "the short entry naming the same commit is gone");
  assert.equal(e.withdrawnCommits.length, 1);
  assert.equal(e.withdrawnCommits[0].sha, short, "the withdrawal record carries the entry that was removed");
});

test("3.2 REGRESSION GUARD: a legacy entry that does not resolve is withdrawn by its exact spelling", () => {
  const { cwd } = repoWith();
  seedEpic(cwd, "e", { attributedCommits: ["not-a-commit"] });
  accepted(cwd, ["update-epic", "e", "--withdraw-commit", "not-a-commit", "--withdrawal-reason", "x"]);
  const e = epicOf(cwd, "e");
  assert.deepEqual(e.attributedCommits, []);
  assert.equal(e.withdrawnCommits[0].sha, "not-a-commit");
});

test("3.3 the same commit spelled two ways cannot be attributed and withdrawn in one invocation", () => {
  const { cwd, shas: [, one] } = repoWith();
  accepted(cwd, ["update-epic", "e", "--attribute-commit", one]);
  const r = refused(cwd, ["update-epic", "e", "--attribute-commit", one.slice(0, 8),
    "--withdraw-commit", one, "--withdrawal-reason", "x"]);
  assert.match(r.stderr, /cannot attribute and withdraw/, `refused as a contradiction, not a crash: ${r.stderr}`);
});

// ═══════════════ Requirement: A verdict that does not cover the shipped work is stale ═══════════════

const ARCHIVE_DELIVERED = ["--status", "archived", "--outcome", "delivered", "--no-deferrals"];
const gate2Row = (text) => (text.split("\n").find(l => l.includes("`e`") || /\| *e *\|/.test(l)) || "");

/** `e` attributing `attributed` (via the verb), with a passing Gate 2 over root..head. */
function gatedEpic(cwd, root, head, attributed) {
  for (const sha of attributed) accepted(cwd, ["update-epic", "e", "--attribute-commit", sha]);
  accepted(cwd, ["record-gate-review", "e", "--gate", "2", "--verdict", "pass", "--base-sha", root, "--head-sha", head]);
}
const renderedProject = (cwd) => { run(["render"], { cwd }); return fs.readFileSync(path.join(cwd, "PROJECT.md"), "utf8"); };

test("4.1 an ancestor attributed after an uncovered descendant does not make the verdict fresh", () => {
  const { cwd, shas: [root, a, d] } = repoWith(["root", "a", "descendant"]);
  gatedEpic(cwd, root, a, [d, a]);
  const r = refused(cwd, ["update-epic", "e", ...ARCHIVE_DELIVERED]);
  assert.ok(r.stderr.includes(d), `the refusal names the uncovered descendant ${d}: ${r.stderr}`);
  assert.match(renderedProject(cwd), /⚠ stale/);
});

test("4.2 a head sharing no history with the attributed commits is stale", () => {
  const { cwd, shas: [root, a] } = repoWith(["root", "a"]);
  const unrelated = fixtureCommit(cwd, "unrelated", { orphan: true });
  gatedEpic(cwd, root, unrelated, [a]);
  refused(cwd, ["update-epic", "e", ...ARCHIVE_DELIVERED]);
  assert.match(renderedProject(cwd), /⚠ stale/);
});

test("4.3 a legacy attributed value that is not a commit name is stale, not unverifiable", () => {
  const { cwd, shas: [root, a] } = repoWith(["root", "a"]);
  gatedEpic(cwd, root, a, [a]);
  seedEpic(cwd, "e", { attributedCommits: ["not-a-commit"] });
  const r = refused(cwd, ["update-epic", "e", ...ARCHIVE_DELIVERED]);
  assert.match(r.stderr, /not-a-commit/, "the refusal names the malformed value");
  const md = renderedProject(cwd);
  assert.match(md, /⚠ stale/);
  assert.doesNotMatch(md, /⚠ unverifiable/);
});

test("4.4 a legacy symbolic headSha renders stale on both surfaces and refuses delivered naming it", () => {
  const { cwd, shas: [root, a] } = repoWith(["root", "a"]);
  gatedEpic(cwd, root, a, [a]);
  const s = readState(cwd);
  const e = s.epics.find(x => x.id === "e");
  e.attributedCommits = [a];
  e.gateReview.gate2.headSha = "HEAD";
  writeState(cwd, s);
  assert.match(renderedProject(cwd), /⚠ stale/, "PROJECT.md renders the verdict stale");
  assert.match(parseBrief(cwd), /gate 2: pass[^\n]*⚠ stale/, "the brief renders the verdict stale");
  const r = refused(cwd, ["update-epic", "e", ...ARCHIVE_DELIVERED]);
  assert.match(r.stderr, /HEAD/, "the refusal names the symbolic value");
});

test("4.5 REGRESSION GUARD: a hex value this clone does not hold reads unverifiable and does not refuse", () => {
  const absent = "0123456789abcdef0123456789abcdef01234567";
  {
    const { cwd, shas: [root, a] } = repoWith(["root", "a"]);
    gatedEpic(cwd, root, a, [a]);
    seedEpic(cwd, "e", { gateReview: { gate2: { ...readState(cwd).epics.find(x => x.id === "e").gateReview.gate2, headSha: absent } } });
    assert.match(renderedProject(cwd), /⚠ unverifiable/, "an absent hex head is unverifiable");
    accepted(cwd, ["update-epic", "e", ...ARCHIVE_DELIVERED]);
  }
  {
    const { cwd, shas: [root, a] } = repoWith(["root", "a"]);
    gatedEpic(cwd, root, a, [a]);
    seedEpic(cwd, "e", { attributedCommits: [a, absent] });
    assert.match(renderedProject(cwd), /⚠ unverifiable/, "an absent hex entry, with every resolvable one reached, is unverifiable");
    accepted(cwd, ["update-epic", "e", ...ARCHIVE_DELIVERED]);
  }
  {
    const { cwd, shas: [root, a] } = repoWith(["root", "a"]);
    gatedEpic(cwd, root, a, []);
    const s = readState(cwd); delete s.epics.find(x => x.id === "e").attributedCommits; writeState(cwd, s);
    assert.match(renderedProject(cwd), /⚠ unverifiable/, "an absent array is unverifiable");
  }
  {
    const { cwd, shas: [root, a] } = repoWith(["root", "a"]);
    gatedEpic(cwd, root, a, []);
    assert.match(renderedProject(cwd), /no attributed commits/, "an empty array is none-attributed");
  }
  {
    const { cwd, shas: [root, a] } = repoWith(["root", "a"]);
    gatedEpic(cwd, root, a, [a]);
    accepted(cwd, ["update-epic", "e", "--withdraw-commit", a, "--withdrawal-reason", "wrong commit"]);
    assert.match(renderedProject(cwd), /⚠ attribution withdrawn/, "withdrawn-to-empty is attribution-withdrawn");
  }
});

test("4.6 REGRESSION GUARD: a head reaching every attributed commit is fresh past unrelated later commits, and the archived-epic regression check still binds", () => {
  const { cwd, shas: [root, a, b] } = repoWith(["root", "a", "b"]);
  gatedEpic(cwd, root, b, [a, b]);
  fixtureCommits(cwd, ["unrelated-1", "unrelated-2"]);
  const md = renderedProject(cwd);
  assert.doesNotMatch(md, /⚠ stale|⚠ unverifiable/, "the verdict is fresh");
  accepted(cwd, ["update-epic", "e", ...ARCHIVE_DELIVERED]);
  const later = fixtureCommit(cwd, "later");
  refused(cwd, ["update-epic", "e", "--attribute-commit", later]);
  // An archived delivered record whose Gate 2 had ALREADY failed is not locked by that failure.
  const s = readState(cwd);
  s.epics.find(x => x.id === "e").gateReview.gate2.verdict = "fail";
  writeState(cwd, s);
  accepted(cwd, ["update-epic", "e", "--attribute-commit", later]);
});

// ═══════════════ Requirement: A recorded commit value that is not a commit object name is reported ═══════════════

const NOT_AN_OBJECT_NAME = /not a commit object name/;
/** The integrity lines of the non-object-name arm. */
const nonObjectNameFindings = (cwd) => attempt(cwd, ["integrity"]).stdout.split("\n").filter(l => NOT_AN_OBJECT_NAME.test(l));

test("5.1 integrity reports a symbolic Gate 2 headSha by epic, field and value, and writes nothing", () => {
  const { cwd, shas: [root, a] } = repoWith(["root", "a"]);
  gatedEpic(cwd, root, a, [a]);
  const s = readState(cwd);
  s.epics.find(x => x.id === "e").gateReview.gate2.headSha = "HEAD";
  writeState(cwd, s);
  const before = stateBytes(cwd);
  const found = nonObjectNameFindings(cwd);
  assert.equal(found.length, 1, `one finding of this kind: ${JSON.stringify(found)}`);
  assert.match(found[0], /`?e`?/);
  assert.match(found[0], /gate2\.headSha/);
  assert.match(found[0], /HEAD/);
  assert.ok(stateBytes(cwd).equals(before), "integrity writes nothing");
});

test("5.2 REGRESSION GUARD: re-recording the verdict clears the finding, and a resolving short hash is never named", () => {
  const { cwd, shas: [root, a] } = repoWith(["root", "a"]);
  gatedEpic(cwd, root, a, [a]);
  const s = readState(cwd);
  const e = s.epics.find(x => x.id === "e");
  e.gateReview.gate2.headSha = "HEAD";
  e.attributedCommits = [a.slice(0, 9)];
  writeState(cwd, s);
  accepted(cwd, ["record-gate-review", "e", "--gate", "2", "--verdict", "pass", "--base-sha", root, "--head-sha", a]);
  assert.equal(epicOf(cwd, "e").gateReview.gate2.superseded.headSha, "HEAD", "the superseded verdict still holds HEAD");
  assert.deepEqual(nonObjectNameFindings(cwd), [], "no finding of this kind names the epic");
});

// ═══════════════ Gate 2 follow-up: a stored value is never read by git as an option ═══════════════

test("g2-1 a stored value shaped like a git option creates no file through integrity, brief or render", () => {
  const { cwd, shas: [root, a] } = repoWith(["root", "a"]);
  run(["add-epic", "--id", "f", "--lane", "openspec"], { cwd });
  const outDir = removeAtExit(fs.mkdtempSync(path.join(path.dirname(cwd), "pm-optinject-")));
  const viaAttributed = path.join(outDir, "via-attributed");
  const viaHead = path.join(outDir, "via-head");
  const s = readState(cwd);
  const e = s.epics.find(x => x.id === "e");
  // An UNEVIDENCED Gate 2 dated in the future, so the bookkeeping arm reads the last attributed
  // commit's date; the attributed value is an option.
  e.attributedCommits = [`--output=${viaAttributed}`];
  e.gateReview = { gate2: { verdict: "pass", reviewedAt: "2099-01-01T00:00:00.000Z" } };
  // An EVIDENCED Gate 2 whose note cites a real commit, so the cited-commits arm asks ancestry
  // against a headSha that is an option.
  const f = s.epics.find(x => x.id === "f");
  f.attributedCommits = [a];
  f.gateReview = { gate2: { verdict: "pass", reviewedAt: "2099-01-01T00:00:00.000Z", baseSha: root,
    headSha: `--output=${viaHead}`, note: `reviewed ${a}` } };
  writeState(cwd, s);
  for (const verb of [["integrity"], ["brief"], ["render"]]) attempt(cwd, verb);
  assert.equal(fs.existsSync(viaAttributed), false, "a stored attributed value was passed to git as an option");
  assert.equal(fs.existsSync(viaHead), false, "a stored headSha was passed to git as an option");
});

test("g2-m5 integrity reports a legacy headSha carrying whitespace, which every other surface reads stale", () => {
  const { cwd, shas: [root, a] } = repoWith(["root", "a"]);
  gatedEpic(cwd, root, a, [a]);
  const s = readState(cwd);
  s.epics.find(x => x.id === "e").gateReview.gate2.headSha = ` ${a} `;
  writeState(cwd, s);
  assert.match(renderedProject(cwd), /⚠ stale/, "precondition: the verdict renders stale");
  const found = nonObjectNameFindings(cwd);
  assert.equal(found.length, 1, `integrity names the padded value: ${JSON.stringify(found)}`);
  assert.match(found[0], /gate2\.headSha/);
});

test("g2-m3 an uppercase hexadecimal value is a commit name: it resolves, reads fresh, and is not reported", () => {
  const { cwd, shas: [root, a] } = repoWith(["root", "a"]);
  gatedEpic(cwd, root, a, [a]);
  const s = readState(cwd);
  const e = s.epics.find(x => x.id === "e");
  e.attributedCommits = [a.toUpperCase()];
  e.gateReview.gate2.headSha = a.toUpperCase();
  writeState(cwd, s);
  assert.doesNotMatch(renderedProject(cwd), /⚠ stale|⚠ unverifiable/, "an uppercase full name is fresh");
  assert.deepEqual(nonObjectNameFindings(cwd), [], "an uppercase full name is not reported as a ref");
});

// ═══════════════ Gate 2 follow-up: tests that kill the surviving mutants ═══════════════

const GIT_LIB = new URL("../../lib/git.mjs", import.meta.url).href;

test("g2-M08 a failed rev-list (head resolves, an attributed commit's history unreadable) never reads fresh", () => {
  const { cwd, shas: [root, a] } = repoWith(["root", "a"]);
  gatedEpic(cwd, root, a, [a]);
  const tree = git(cwd, ["rev-parse", "HEAD^{tree}"]);
  const x1 = execFileSync("git", ["commit-tree", tree, "-m", "x1"], { cwd, encoding: "utf8" }).trim();
  const x2 = execFileSync("git", ["commit-tree", tree, "-p", x1, "-m", "x2"], { cwd, encoding: "utf8" }).trim();
  seedEpic(cwd, "e", { attributedCommits: [a, x2] });
  // x2 itself resolves; its parent is gone, so walking it fails.
  fs.rmSync(path.join(cwd, ".git", "objects", x1.slice(0, 2), x1.slice(2)));
  const md = renderedProject(cwd);
  assert.match(md, /gate 2|Gate 2|pass/);
  assert.match(md, /⚠ unverifiable/, "git could not answer, so the verdict is unverifiable — never fresh");
});

test("g2-M06 a value carrying whitespace or a control character is refused before git reads it", async () => {
  const { resolveCommits } = await import(GIT_LIB);
  const newline = "HEAD\nHEAD";                         // would split into two input lines
  const nul = "HEAD" + String.fromCharCode(0) + "x";    // git reads it as HEAD
  const { resolved, unresolved } = resolveCommits([newline, nul]);
  assert.equal(resolved.size, 0, `neither resolves: ${[...resolved.keys()].map(k => JSON.stringify(k))}`);
  assert.deepEqual(unresolved.sort(), [newline, nul].sort());
});

test("g2-M07a an annotated tag resolves to the commit it names, not to the tag object", () => {
  const { cwd, shas: [, a] } = repoWith(["root", "a"]);
  git(cwd, ["tag", "-a", "v-annotated", "-m", "annotated", a]);
  accepted(cwd, ["update-epic", "e", "--attribute-commit", "v-annotated"]);
  assert.deepEqual(epicOf(cwd, "e").attributedCommits, [a]);
});

/** The source of one `export function <name>(` in an engine module, up to the next export. */
function bodyOfModule(src, fn) {
  const start = src.indexOf(`export function ${fn}(`);
  assert.notEqual(start, -1, `${fn} is still exported`);
  const next = src.indexOf("\nexport ", start + 1);
  return src.slice(start, next === -1 ? undefined : next);
}

/** The source of one operation in lib/git-gateway.mjs's returned object literal. The operations are
 *  separated by blank lines, and the extractor asserts the anchor it slices on still exists — a
 *  reformat of the gateway should fail this loudly rather than silently returning the whole file. */
function gatewayOperationBody(src, name) {
  const start = src.indexOf(`\n    ${name}: (`);
  assert.notEqual(start, -1, `${name} is still an operation in git-gateway.mjs`);
  const end = src.indexOf("\n\n", start + 1);
  assert.notEqual(end, -1, `${name}'s operation body ended before the next one — the extractor's anchor moved`);
  return src.slice(start, end);
}

test("g2-M17 every git call resolving or walking recorded commits sets GIT_NO_LAZY_FETCH", () => {
  // RE-POINTED BY 4.2, not weakened. The git call moved behind the injected gateway, so the
  // ASSERTION SPLITS IN TWO rather than being dropped: the caller must still reach git (through the
  // gateway) for the same two functions, and the environment override must still be there — now
  // asserted WHERE IT NOW LIVES, in the operations that inherited the two calls. A guard left
  // reading the old file would have gone quietly green on a `gitOps()` call that no longer spawns
  // anything at all.
  const src = fs.readFileSync(new URL("../../lib/git.mjs", import.meta.url), "utf8");
  const gw = fs.readFileSync(new URL("../../lib/git-gateway.mjs", import.meta.url), "utf8");
  const GIT_NO_LAZY_FETCH = /env: \{ \.\.\.env\(\), GIT_NO_LAZY_FETCH: "1" \}/;
  for (const [fn, op] of [["resolveCommits", "batchCheckCommits"], ["commitsNotReachedBy", "revListNotReached"]]) {
    // 0.47.0 (task 3.3) moved the child environment from `process.env` to the invocation's; 4.2 moved
    // the call itself to the gateway. The property is unchanged at every step — the spread is still
    // there and GIT_NO_LAZY_FETCH is still set — which is why the anchor moves and the assertion does
    // not.
    assert.match(bodyOfModule(src, fn), new RegExp(`gitOps\\(\\)\\.${op}\\(`),
      `${fn} must still reach git, through the gateway`);
    assert.match(gatewayOperationBody(gw, op), GIT_NO_LAZY_FETCH,
      `${op}'s git call must not fetch from a promisor remote`);
  }
  // The override is not ambient: exactly the operations that name it carry it, so a further op
  // acquiring it (or one of these losing it) is a change rather than a detail. handoff-demand-blind-
  // spots added the THIRD deliberately: `indexBlobs` (`cat-file --batch` over the index) follows
  // batchCheckCommits' shape, because a partial clone must not fetch a blob to answer it either.
  assert.match(gatewayOperationBody(gw, "indexBlobs"), GIT_NO_LAZY_FETCH, "indexBlobs must not fetch either");
  assert.equal((gw.match(/GIT_NO_LAZY_FETCH/g) || []).length, 3,
    "exactly three gateway operations pass GIT_NO_LAZY_FETCH");
});

test("g2-3 git calls whose input is already filtered to commit-name hex pass no --end-of-options, so an old git cannot fail them open", () => {
  // `--end-of-options` is git >= 2.24; an older git exits 129 on it, commitsNotReachedBy() then answers
  // null, gateStaleness reads unverifiable, and the archive gate (which refuses only `stale`) lets a
  // stale Gate 2 through. Every call below filters its values to hexadecimal commit names BEFORE
  // spawning git, so no value can be read as an option and the flag buys nothing but that failure.
  // 4.2: git-gateway.mjs is added to the list rather than replacing the other two — it is now the
  // ONLY place in the engine that spawns git, so it is the file where the flag could actually appear,
  // and a list that named only the old files would be checking two files that no longer can.
  for (const rel of ["../../lib/git.mjs", "../../lib/worktree-hygiene.mjs", "../../lib/git-gateway.mjs"]) {
    const src = fs.readFileSync(new URL(rel, import.meta.url), "utf8");
    assert.equal(src.includes('"--end-of-options"'), false, `${rel} still passes --end-of-options to git`);
  }
  const git = fs.readFileSync(new URL("../../lib/git.mjs", import.meta.url), "utf8");
  for (const [fn, guard] of [["isAncestor", "isCommitNameShaped"], ["commitDate", "isCommitNameShaped"],
    ["objectExists", "isCommitNameShaped"], ["reachableFromAnyRef", "isCommitNameShaped"], ["commitsNotReachedBy", "FULL_COMMIT_NAME"]]) {
    // The SPAWN anchor moved with the call (4.2). The ordering property — the value is shape-gated
    // BEFORE anything is handed to git — is asserted unchanged, which is the whole point: it is the
    // order that stops `--output=<path>` reaching git as an option.
    const body = bodyOfModule(git, fn);
    assert.ok(body.indexOf(guard) !== -1 && body.indexOf(guard) < body.indexOf("gitOps()"),
      `${fn} filters its values with ${guard} before it hands them to git`);
  }
});
