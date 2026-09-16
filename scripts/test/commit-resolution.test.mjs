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
import { execFileSync, spawnSync } from "node:child_process";
import { ENGINE, EMPTY_CACHE, tmpRepo, run, readState, writeState, parseBrief, fixtureCommits, fixtureCommit } from "./helpers.mjs";

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
  const outDir = fs.mkdtempSync(path.join(path.dirname(cwd), "pm-optinject-"));
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
