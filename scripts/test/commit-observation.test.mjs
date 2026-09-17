// scripts/test/commit-observation.test.mjs
//
// commit-nudge-reads-the-whole-move — what the post-call commit hook observes about the commits that
// landed since its previous observation. Every fixture here is a hermetic repository built by
// helpers.mjs observationRepo(), and every observation is the hook invoked the way hooks/hooks.json
// invokes it (observe()), with the event name in the payload.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { observationRepo } from "./helpers.mjs";

const OBSERVE_RECORD = (cwd) => path.join(cwd, ".conductor", "commit-observe.json");
const readRecord = (cwd) => JSON.parse(fs.readFileSync(OBSERVE_RECORD(cwd), "utf8"));
const short = (repo, sha) => repo.git("rev-parse", "--short", sha);

/** Bytes of each file, or null for an absent one, so "byte-identical" covers absent-stays-absent. */
function snapshotFiles(cwd, rels) {
  return Object.fromEntries(rels.map((rel) => {
    try { return [rel, fs.readFileSync(path.join(cwd, rel)).toString("base64")]; }
    catch { return [rel, null]; }
  }));
}

/** Rows of the detour log naming this commit, whatever their abbreviation length. */
function rowsFor(repo, fullSha) {
  return repo.detours().split("\n").filter(Boolean)
    .filter((l) => { const s = l.split("\t")[1]; return s && s !== "-" && fullSha.startsWith(s); });
}

// ─────────────── 2. Every live commit since the last observation is reported ───────────────

test("2.1 a commit followed by a checkout in the same call is reported", () => {
  const repo = observationRepo();
  repo.observe();
  const sha = repo.commit({ "src/one.txt": "1" }, "fix: one");
  repo.git("checkout", "-q", "-b", "tmp");
  repo.git("checkout", "-q", "main");
  const o = repo.observe("PostToolUse", "git commit -m 'fix: one' && git checkout -b tmp && git checkout main");
  assert.equal(o.status, 0, o.stderr);
  assert.ok(o.context.includes(short(repo, sha)),
    `the commit landed since the last observation and must be named. Output: ${JSON.stringify(o.stdout)}`);
});

test("2.2 two commits in one call are both reported, older first, in one attribution command", () => {
  const repo = observationRepo();
  repo.observe();
  const a = repo.commit({ "src/two.txt": "2" }, "fix: two");
  const b = repo.commit({ "src/three.txt": "3" }, "fix: three");
  const o = repo.observe("PostToolUse", "git commit -m two && git commit -m three");
  assert.equal(o.status, 0, o.stderr);
  const ia = o.context.indexOf(short(repo, a));
  const ib = o.context.indexOf(short(repo, b));
  assert.ok(ia >= 0 && ib >= 0, `both commits must be named. Output: ${JSON.stringify(o.context)}`);
  assert.ok(ia < ib, "the older commit is named first");
  assert.match(o.context, new RegExp(`update-epic epic-a --attribute-commit ${a} --attribute-commit ${b}`),
    "the attribution command carries both commits, in landing order, as one invocation");
});

test("2.3 hooks.json wires commit-nudge for Bash on PostToolUse and PostToolUseFailure, and on no pre-call event", () => {
  const doc = JSON.parse(fs.readFileSync(new URL("../../hooks/hooks.json", import.meta.url), "utf8"));
  const wiredOn = Object.entries(doc.hooks)
    .filter(([, groups]) => groups.some((g) => g.hooks.some((h) => /\scommit-nudge\s/.test(h.command))))
    .map(([event]) => event).sort();
  assert.deepEqual(wiredOn, ["PostToolUse", "PostToolUseFailure"]);
  for (const event of wiredOn) {
    const group = doc.hooks[event].find((g) => g.hooks.some((h) => /\scommit-nudge\s/.test(h.command)));
    assert.equal(group.matcher, "Bash", `${event} matches Bash`);
    assert.equal(group.hooks.find((h) => /\scommit-nudge\s/.test(h.command)).command,
      'node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" commit-nudge --platform claude-code');
  }
});

test("2.3b a commit in a failing call is reported on PostToolUseFailure; unreadable state writes nothing and defers it", () => {
  // Readable state: reported, and the envelope names the event it answers.
  {
    const repo = observationRepo();
    repo.observe();
    const sha = repo.commit({ "src/f.txt": "1" }, "fix: before the failure");
    const o = repo.observe("PostToolUseFailure", "git commit -m 'fix: before the failure' && false");
    assert.equal(o.status, 0, o.stderr);
    assert.ok(o.context.includes(short(repo, sha)), `reported on the failure event: ${JSON.stringify(o.stdout)}`);
    assert.equal(o.eventName, "PostToolUseFailure");
  }
  // Unreadable state: exit 2 naming the file, nothing written, reported once repaired.
  {
    const repo = observationRepo();
    repo.observe();
    const statePath = path.join(repo.cwd, ".conductor", "state.json");
    const good = fs.readFileSync(statePath, "utf8");
    const sha = repo.commit({ "src/g.txt": "1" }, "fix: over a broken record");
    fs.writeFileSync(statePath, "{ not json\n");
    const files = [".conductor/state.json", "PROJECT.md", ".conductor/detours.log",
      ".conductor/commit-watch.json", ".conductor/commit-observe.json"];
    const before = snapshotFiles(repo.cwd, files);
    const o = repo.observe("PostToolUseFailure", "git commit -m x && false");
    assert.equal(o.status, 2, `exit 2 on unreadable state. stderr: ${o.stderr}`);
    assert.match(o.stderr, /\.conductor\/state\.json/);
    assert.deepEqual(snapshotFiles(repo.cwd, files), before, "nothing is written over an unreadable record");
    fs.writeFileSync(statePath, good);
    const after = repo.observe("PostToolUse", "ls");
    assert.equal(after.status, 0, after.stderr);
    assert.ok(after.context.includes(short(repo, sha)),
      `the first readable observation reports the deferred commit: ${JSON.stringify(after.stdout)}`);
  }
});

test("2.4 overlapping observations: A reads, a commit lands, B completes, A writes — reported exactly once", async () => {
  const { beginObservation } = await import("../lib/commit-watch.mjs");
  const repo = observationRepo();
  repo.observe();
  const reflogLines = () => fs.readFileSync(path.join(repo.gitRoot, ".git", "logs", "HEAD"), "utf8").trim().split("\n");
  const preCommitLine = reflogLines().at(-1);

  const a = beginObservation({ root: repo.cwd });
  assert.notEqual(a.verdict, "skipped", "A holds the lock");
  const sha = repo.commit({ "src/race.txt": "1" }, "fix: lands mid-observation");
  const recordDuringA = fs.readFileSync(OBSERVE_RECORD(repo.cwd), "utf8");

  // B runs to completion while A holds the record. It must SKIP — no report, no write — because a
  // B that wrote a newer anchor and reported set would be overwritten by A's older ones, and a third
  // run would report the commit again (the unlocked interleaving Gate 1 round 2 simulated).
  const b = repo.observe("PostToolUse", "ls");
  assert.equal(b.status, 0, b.stderr);
  assert.equal(b.stdout, "", "B skips while A holds the observation");
  assert.equal(fs.readFileSync(OBSERVE_RECORD(repo.cwd), "utf8"), recordDuringA, "and B writes nothing");
  assert.equal(rowsFor(repo, sha).length, 0, "and logs nothing");

  a.finish(a.candidates.map((c) => c.sha));
  assert.equal(a.candidates.some((x) => x.sha === sha), false, "A read the reflog before the commit landed");
  assert.equal(readRecord(repo.cwd).anchor.line, preCommitLine,
    "A's write leaves the anchor BEFORE the commit, so the commit is still ahead of it");

  const c = repo.observe("PostToolUse", "ls");
  assert.ok(c.context.includes(short(repo, sha)), `the third observation reports it: ${JSON.stringify(c.stdout)}`);
  assert.equal(readRecord(repo.cwd).anchor.line, reflogLines().at(-1), "and the anchor moves past it");
  assert.ok(readRecord(repo.cwd).reported.includes(sha), "into the reported set");

  const d = repo.observe("PostToolUse", "ls");
  assert.ok(!d.context.includes(short(repo, sha)), "a later observation never reports it again");
  assert.ok(rowsFor(repo, sha).length <= 1, "at most one commit-derived row");
});

test("2.4 the observation lock held by another process: nothing reported or written; reported after release", () => {
  {
    const repo = observationRepo();
    repo.observe();
    const sha = repo.commit({ "src/held.txt": "1" }, "fix: behind a held lock");
    const lock = OBSERVE_RECORD(repo.cwd) + ".lock";
    fs.writeFileSync(lock, String(process.pid));
    const before = snapshotFiles(repo.cwd, [".conductor/commit-observe.json", ".conductor/detours.log", "PROJECT.md"]);
    const held = repo.observe("PostToolUse", "ls");
    assert.equal(held.status, 0, held.stderr);
    assert.equal(held.stdout, "", "a skipped observation says nothing");
    assert.deepEqual(snapshotFiles(repo.cwd, [".conductor/commit-observe.json", ".conductor/detours.log", "PROJECT.md"]), before);
    fs.rmSync(lock);
    const next = repo.observe("PostToolUse", "ls");
    assert.ok(next.context.includes(short(repo, sha)), `reported after release: ${JSON.stringify(next.stdout)}`);
  }
});

test("2.4 a lock older than 10 s was left by a killed hook, and is broken", () => {
  {
    const repo = observationRepo();
    repo.observe();
    const sha = repo.commit({ "src/stale.txt": "1" }, "fix: behind a stale lock");
    const lock = OBSERVE_RECORD(repo.cwd) + ".lock";
    fs.writeFileSync(lock, "999999");
    const old = new Date(Date.now() - 11_000);
    fs.utimesSync(lock, old, old);
    const o = repo.observe("PostToolUse", "ls");
    assert.ok(o.context.includes(short(repo, sha)), `a stale lock does not defer forever: ${JSON.stringify(o.stdout)}`);
    assert.equal(fs.existsSync(lock), false, "and the lock is released afterwards");
  }
});

test("2.4 the anchored reflog line itself is gone: nothing reported from the reflog, and the record re-anchors", () => {
  {
    const repo = observationRepo();
    repo.observe();
    const lost = repo.commit({ "src/lost.txt": "1" }, "fix: its anchor is deleted");
    repo.git("reflog", "delete", "HEAD@{1}");            // the anchored `commit: chore: baseline` line
    const o = repo.observe("PostToolUse", "ls");
    assert.equal(o.status, 0, o.stderr);
    assert.ok(!o.context.includes(short(repo, lost)), "an unverifiable reflog reports nothing from the reflog");
    const lines = fs.readFileSync(path.join(repo.gitRoot, ".git", "logs", "HEAD"), "utf8").trim().split("\n");
    assert.equal(readRecord(repo.cwd).anchor.line, lines[lines.length - 1], "re-anchored at the current end");
    const later = repo.commit({ "src/later.txt": "1" }, "fix: after re-anchoring");
    const o2 = repo.observe("PostToolUse", "ls");
    assert.ok(o2.context.includes(short(repo, later)), "observation resumes from the new anchor");
  }
});

test("2.4a reflog expiry at the front loses no commit", () => {
  const repo = observationRepo();
  repo.commit({ "src/h1.txt": "1" }, "chore: history one");
  repo.commit({ "src/h2.txt": "1" }, "chore: history two");
  repo.observe();
  const sha = repo.commit({ "src/front.txt": "1" }, "fix: after the expiry");
  const n = repo.git("reflog", "show", "--format=%H", "HEAD").split("\n").length;
  repo.git("reflog", "delete", `HEAD@{${n - 1}}`);        // the oldest entry, the front of logs/HEAD
  const o = repo.observe("PostToolUse", "ls");
  assert.equal(o.status, 0, o.stderr);
  assert.ok(o.context.includes(short(repo, sha)), `reported despite the front entry's removal: ${JSON.stringify(o.stdout)}`);
});
