// scripts/test/recorded-sha-resolvability.test.mjs
// #142 — nothing noticed when a recorded sha became unreachable.
//
// `.conductor/state.json` records commit shas in two places: `attributedCommits` on an epic and
// `baseSha`/`headSha` on a gate verdict. A squash-merge — this repo's ONLY permitted merge
// method — orphans every commit on the branch, and the next `git gc` deletes them. Measured on
// cfdude/pm right after 0.28.0 merged: 36 recorded shas, 0 reachable from any ref, 36 still in
// the object store. Every existing check was green, correctly: `isAncestor()` answers `null` for
// a sha git has never seen and `null` is never reported, so the checks go quiet at exactly the
// moment every sha becomes unknowable at once.
//
// These fixtures build REAL git repositories, because the question under test is a question only
// git can answer. The orphan is synthesized the way a squash-merge makes one: commit it, then
// move the only ref off it. `for-each-ref` lists neither `HEAD` nor the reflog, so the commit is
// then in the object store and reachable from no ref — the exact shape.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { run, tmpRepo, writeState } from "./helpers.mjs";

const CHECK = "recorded-sha-the-repository-cannot-resolve";

const git = (cwd, ...args) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

/** A temp repo with real git history and, optionally, an orphaned commit.
 *  Returns { cwd, head, orphan } — `orphan` is in the object store and on no ref. */
function gitRepo({ orphan = false } = {}) {
  const cwd = tmpRepo();
  git(cwd, "init", "-q", "-b", "main");
  git(cwd, "config", "user.email", "t@example.com");
  git(cwd, "config", "user.name", "t");
  fs.writeFileSync(path.join(cwd, "a.txt"), "a\n");
  git(cwd, "add", "a.txt");
  git(cwd, "commit", "-q", "-m", "a");
  const head = git(cwd, "rev-parse", "HEAD");
  let orphanSha;
  if (orphan) {
    fs.writeFileSync(path.join(cwd, "b.txt"), "b\n");
    git(cwd, "add", "b.txt");
    git(cwd, "commit", "-q", "-m", "b");
    orphanSha = git(cwd, "rev-parse", "HEAD");
    // The squash-merge shape: the branch's commit stays in the object store, reachable from no
    // ref. `reset --hard` is how we get there without a second clone.
    git(cwd, "reset", "-q", "--hard", head);
  }
  run(["init"], { cwd });
  return { cwd, head, orphan: orphanSha };
}

/** A sha that is syntactically a commit and that no repository has ever held. */
const NEVER = "0123456789abcdef0123456789abcdef01234567";
const NEVER2 = "fedcba9876543210fedcba9876543210fedcba98";

const epic = (id, extra = {}) => ({
  id, title: id, priority: "P1", status: "queued", role: "epic", lane: "claude-code",
  links: [], attributedCommits: [], ...extra,
});

const withEpics = (cwd, epics) =>
  writeState(cwd, { version: 1, active: null, detourStack: [], platform: "claude-code", epics });

/** The line the report prints for this check, e.g. "<id> — 2 finding(s): ..." */
const countLine = (out) => {
  const m = out.match(new RegExp(`^${CHECK} — (\\d+) finding\\(s\\)`, "m"));
  assert.ok(m, `the report must name ${CHECK} with its count, even at zero:\n${out}`);
  return Number(m[1]);
};

test("142: an orphaned attributed commit is reported, with the gc deadline named", () => {
  const { cwd, orphan } = gitRepo({ orphan: true });
  withEpics(cwd, [epic("e1", { attributedCommits: [orphan] })]);
  const out = run(["integrity"], { cwd });
  assert.equal(countLine(out), 1, "an orphaned recorded sha is exactly the condition this check exists for");
  assert.match(out, /object store/, "the finding must say the commit is still recoverable");
  assert.match(out, /gc/, "and must name what deletes it, because the window is finite");
  assert.match(out, new RegExp(orphan.slice(0, 7)), "the finding must name the sha to act on");
});

test("142: an orphaned gate verdict range is reported too — a verdict's shas are recorded shas", () => {
  // The call-site sweep: `attributedCommits` is not the only place state holds a sha. A check
  // that read only the array would leave every gate verdict's range unwatched, which is the
  // half of the record that makes a verdict checkable at all.
  const { cwd, orphan } = gitRepo({ orphan: true });
  withEpics(cwd, [epic("e1", {
    gateReview: { gate2: { verdict: "pass", reviewedAt: "2026-08-01T00:00:00.000Z", baseSha: orphan, headSha: orphan } },
  })]);
  const out = run(["integrity"], { cwd });
  assert.equal(countLine(out), 1);
  assert.match(out, /gate2\.(baseSha|headSha)/, "the finding must say WHERE the sha is recorded");
});

test("142: a reachable recorded sha is not a finding", () => {
  const { cwd, head } = gitRepo();
  withEpics(cwd, [epic("e1", { attributedCommits: [head] })]);
  assert.equal(countLine(run(["integrity"], { cwd })), 0);
});

test("142: a clone that resolves NONE of the record is not reported as a disaster", () => {
  // The fresh/shallow/partial-clone guard. This repo has real history — `HEAD` resolves, so
  // #142's suggested "can it resolve any historical sha" probe would PASS here — but it holds
  // none of the record's own shas. That is what every fresh clone of a squash-merging repo
  // looks like, and calling it "your evidence was destroyed" is the false alarm the issue
  // explicitly forbids.
  const { cwd } = gitRepo();
  withEpics(cwd, [epic("e1", { attributedCommits: [NEVER, NEVER2] })]);
  const out = run(["integrity"], { cwd });
  assert.equal(countLine(out), 0,
    "a clone that resolves none of the record lacks the history; it has not destroyed it");
});

test("142: in a clone that DOES hold the record, a sha it cannot resolve is reported as gone", () => {
  // The probe's pass branch, and the arm the previous test must not be allowed to disable
  // wholesale. One recorded sha resolves, so this clone demonstrably holds this record's
  // history — the one it cannot resolve is therefore gone from here, not missing from a clone
  // that never had it.
  const { cwd, head } = gitRepo();
  withEpics(cwd, [epic("e1", { attributedCommits: [head, NEVER] })]);
  const out = run(["integrity"], { cwd });
  assert.equal(countLine(out), 1);
  assert.match(out, /cannot resolve/i);
  assert.match(out, new RegExp(NEVER.slice(0, 7)));
});

test("142: orphaned and absent are DIFFERENT reports, not one severity", () => {
  const { cwd, orphan } = gitRepo({ orphan: true });
  withEpics(cwd, [epic("e1", { attributedCommits: [orphan, NEVER] })]);
  const out = run(["integrity"], { cwd });
  assert.equal(countLine(out), 2,
    "recoverable-now and already-gone are different findings — collapsing them loses the deadline");
  const block = out.split(`${CHECK} — `)[1];
  assert.match(block, /object store/);
  assert.match(block, /cannot resolve/i);
});

test("142: with no recorded shas at all the check reports zero rather than erroring", () => {
  const { cwd } = gitRepo();
  withEpics(cwd, [epic("e1")]);
  assert.equal(countLine(run(["integrity"], { cwd })), 0);
});

test("142: outside a git repository the check reports nothing", () => {
  // No repository means git cannot answer ANY question — the population-level reading of the
  // same `null` that `isAncestor()` returns per sha. Reporting here would be reporting the
  // absence of git as the destruction of evidence.
  const cwd = tmpRepo();
  run(["init"], { cwd });
  withEpics(cwd, [epic("e1", { attributedCommits: [NEVER] })]);
  assert.equal(countLine(run(["integrity"], { cwd })), 0);
});

test("142: the new check does not make the existing ancestry checks report `null` as failure", () => {
  // The load-bearing contract this change must not break. `verdict-range-omits-cited-commits`
  // reports only a definite `false` from `isAncestor`; a note citing a sha git has never seen
  // stays silent there even while the new check has plenty to say about the same record.
  const { cwd, orphan } = gitRepo({ orphan: true });
  withEpics(cwd, [epic("e1", {
    attributedCommits: [orphan],
    gateReview: { gate2: { verdict: "pass", reviewedAt: "2026-08-01T00:00:00.000Z",
      baseSha: orphan, headSha: orphan, note: `reviewed alongside ${NEVER.slice(0, 7)}` } },
  })]);
  const out = run(["integrity"], { cwd });
  assert.match(out, /^verdict-range-omits-cited-commits — 0 finding\(s\)/m,
    "an unresolvable cited sha is `null`, and `null` is never a finding — that is correct and stays correct");
});

test("142: integrity still writes nothing while asking git these questions", () => {
  const { cwd, orphan } = gitRepo({ orphan: true });
  withEpics(cwd, [epic("e1", { attributedCommits: [orphan] })]);
  const before = fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8");
  run(["integrity"], { cwd });
  assert.equal(fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8"), before);
});
