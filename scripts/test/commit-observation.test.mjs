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
/** The anchored reflog line, which the record stores as its bytes (base64), decoded for comparison. */
const anchorLine = (cwd) => Buffer.from(readRecord(cwd).anchor.lineBase64, "base64").toString("utf8");
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
  const attributionBefore = arrays(repo);
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
  assert.equal(arrays(repo), attributionBefore, "7.3: the hook attributes nothing");
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
  assert.equal(anchorLine(repo.cwd), preCommitLine,
    "A's write leaves the anchor BEFORE the commit, so the commit is still ahead of it");

  const c = repo.observe("PostToolUse", "ls");
  assert.ok(c.context.includes(short(repo, sha)), `the third observation reports it: ${JSON.stringify(c.stdout)}`);
  assert.equal(anchorLine(repo.cwd), reflogLines().at(-1), "and the anchor moves past it");
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

test("G2-I3 a LIVE holder's lock is never broken for its age: a long observation is not reported twice", async () => {
  const { beginObservation } = await import("../lib/commit-watch.mjs");
  const repo = observationRepo();
  repo.observe();
  const sha = repo.commit({ "src/slow.txt": "1" }, "fix: read by a slow observation");
  // A holds the lock (this test process — alive) and is still working 11 s later, as a hook reading
  // hundreds of commits was measured to be (10.6 s).
  const a = beginObservation({ root: repo.cwd });
  assert.equal(a.verdict, "landed", "fixture: A holds the lock and has the commit in hand");
  const lock = OBSERVE_RECORD(repo.cwd) + ".lock";
  const old = new Date(Date.now() - 11_000);
  fs.utimesSync(lock, old, old);
  const before = snapshotFiles(repo.cwd, [".conductor/commit-observe.json", ".conductor/detours.log", "PROJECT.md"]);
  const b = repo.observe("PostToolUse", "ls");
  assert.equal(b.status, 0, b.stderr);
  assert.equal(b.stdout, "", `B skips: A is alive, so its lock is not stale whatever its age. Output: ${b.stdout}`);
  assert.deepEqual(snapshotFiles(repo.cwd, [".conductor/commit-observe.json", ".conductor/detours.log", "PROJECT.md"]), before,
    "and B writes nothing");
  assert.ok(fs.existsSync(lock), "A's lock is still in place");
  a.finish(a.candidates.map((c) => c.sha));
  assert.equal(fs.existsSync(lock), false, "A releases its own lock");
  const c = repo.observe("PostToolUse", "ls");
  assert.ok(!c.context.includes(short(repo, sha)), "A reported it; nobody reports it again");
});

test("G2-I3 a lock whose holder is confirmed dead is broken at once, however young", async () => {
  const { spawnSync } = await import("node:child_process");
  const os = await import("node:os");
  const repo = observationRepo();
  repo.observe();
  const sha = repo.commit({ "src/dead.txt": "1" }, "fix: behind a dead holder");
  const dead = spawnSync(process.execPath, ["-e", ""]).pid;        // exited: its pid names no process
  const lock = OBSERVE_RECORD(repo.cwd) + ".lock";
  let pidns = null;
  try { pidns = fs.readlinkSync("/proc/self/ns/pid"); } catch { /* not Linux */ }
  fs.writeFileSync(lock, JSON.stringify({ pid: dead, host: os.hostname(), pidns, acquiredAt: new Date().toISOString(), nonce: "n" }));
  const o = repo.observe("PostToolUse", "ls");
  assert.ok(o.context.includes(short(repo, sha)), `a dead holder does not defer the report: ${JSON.stringify(o.stdout)}`);
  assert.equal(fs.existsSync(lock), false);
});

test("G2-I3 breaking a stale observation lock removes only the lock judged, never a successor", async () => {
  const cw = await import("../lib/commit-watch.mjs");
  const repo = observationRepo();
  repo.observe();
  const lock = OBSERVE_RECORD(repo.cwd) + ".lock";
  // L: left by a killed hook. B judges it stale ...
  fs.writeFileSync(lock, "999999");
  const old = new Date(Date.now() - 11_000);
  fs.utimesSync(lock, old, old);
  const judgedByB = cw.inspectObserveLock(repo.cwd);
  assert.ok(judgedByB && cw.isStaleObserveLock(judgedByB), "precondition: B judges L stale");
  // ... A breaks L first and takes N ...
  assert.equal(cw.breakStaleObserveLock(repo.cwd, cw.inspectObserveLock(repo.cwd)), true, "A breaks L");
  const a = cw.beginObservation({ root: repo.cwd });
  assert.notEqual(a.verdict, "skipped", "A holds N");
  // ... and B's break, acting on its old judgement, must not remove N.
  assert.equal(cw.breakStaleObserveLock(repo.cwd, judgedByB), false, "B removes nothing");
  assert.ok(fs.existsSync(lock), "N is still held");
  a.release();
  assert.equal(fs.existsSync(lock), false);
});

test("G2-M-b an observation whose lock was broken releases only its own lock, never its successor's", async () => {
  const cw = await import("../lib/commit-watch.mjs");
  const repo = observationRepo();
  repo.observe();
  const lock = OBSERVE_RECORD(repo.cwd) + ".lock";
  // A takes the lock, then its holder becomes unconfirmable (recorded on another host) and 11 s old,
  // as a hook on a shared checkout stalled past the stale age would be. Nonce and inode are A's own.
  const a = cw.beginObservation({ root: repo.cwd });
  assert.notEqual(a.verdict, "skipped", "fixture: A holds the lock");
  const aLock = JSON.parse(fs.readFileSync(lock, "utf8"));
  fs.writeFileSync(lock, JSON.stringify({ ...aLock, host: `${aLock.host}-elsewhere` }));
  const old = new Date(Date.now() - 11_000);
  fs.utimesSync(lock, old, old);
  assert.ok(cw.isStaleObserveLock(cw.inspectObserveLock(repo.cwd)), "precondition: A's lock is judged stale");
  // B breaks A's lock and takes its own.
  const b = cw.beginObservation({ root: repo.cwd });
  assert.notEqual(b.verdict, "skipped", "B broke the stale lock and holds a new one");
  const bLock = cw.inspectObserveLock(repo.cwd);
  assert.ok(bLock && bLock.nonce && bLock.nonce !== aLock.nonce, "fixture: the lock in place is B's");
  // A finally ends. Its release must leave B's lock alone.
  a.release();
  assert.ok(fs.existsSync(lock), "A's release removed B's lock");
  assert.equal(cw.inspectObserveLock(repo.cwd).nonce, bLock.nonce, "the lock in place is still B's");
  b.release();
  assert.equal(fs.existsSync(lock), false, "B releases its own lock");
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
    assert.equal(anchorLine(repo.cwd), lines[lines.length - 1], "re-anchored at the current end");
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

test("G2-C1 a reflog line that is not valid UTF-8 anchors by its bytes: every commit is still reported", () => {
  const repo = observationRepo();
  repo.observe();
  const msgFile = path.join(repo.gitRoot, ".git", "latin1-msg");
  for (let i = 1; i <= 4; i++) {
    fs.writeFileSync(path.join(repo.gitRoot, "g.txt"), `${i}\n`);
    repo.git("add", "g.txt");
    // A raw 0xE9 byte (Latin-1 e-acute) in the subject: git copies it into logs/HEAD unchanged, so
    // the reflog is not valid UTF-8 from this line on.
    fs.writeFileSync(msgFile, Buffer.concat([Buffer.from("fix: caf"), Buffer.from([0xe9]), Buffer.from(` ${i}\n`)]));
    repo.git("-c", "i18n.commitEncoding=ISO-8859-1", "commit", "-q", "-F", msgFile);
    const sha = repo.head();
    const reflog = fs.readFileSync(path.join(repo.gitRoot, ".git", "logs", "HEAD"));
    assert.ok(reflog.includes(Buffer.from([0x63, 0x61, 0x66, 0xe9])), "fixture: the reflog holds the raw Latin-1 byte");
    const o = repo.observe("PostToolUse", "git commit");
    assert.equal(o.status, 0, o.stderr);
    assert.ok(o.context.includes(short(repo, sha)),
      `commit ${i} after a non-UTF-8 reflog line is reported: ${JSON.stringify(o.stdout)}`);
  }
  // The subjects reach the trail and PROJECT.md as git re-encodes them for output (UTF-8), never as
  // the raw Latin-1 byte: both files are valid UTF-8 and hold "caf" + C3 A9.
  const eAcute = Buffer.concat([Buffer.from("caf"), Buffer.from([0xc3, 0xa9])]);
  for (const rel of [".conductor/detours.log", "PROJECT.md"]) {
    const buf = fs.readFileSync(path.join(repo.cwd, rel));
    assert.equal(Buffer.compare(buf, Buffer.from(buf.toString("utf8"), "utf8")), 0, `${rel} is valid UTF-8`);
    assert.ok(buf.includes(eAcute), `${rel} carries the re-encoded subject`);
    assert.ok(!buf.includes(Buffer.from([0x63, 0x61, 0x66, 0xe9])), `${rel} never carries the raw Latin-1 byte`);
  }
});

test("G2-M4 REGRESSION GUARD: the anchor is the LAST occurrence of its line ending at or before the recorded size", async () => {
  const { anchorOf, locateAnchor } = await import("../lib/commit-watch.mjs");
  const L = Buffer.from("a".repeat(40) + " " + "b".repeat(40) + " T <t@e.x> 1 +0000\tcheckout: moving from x to y\n");
  const X = Buffer.from("b".repeat(40) + " " + "a".repeat(40) + " T <t@e.x> 2 +0000\tcheckout: moving from y to x\n");
  // Recorded after L X L: the anchor is the SECOND, byte-identical L, not the first.
  const both = Buffer.concat([L, X, L]);
  const recorded = anchorOf(both);
  assert.equal(locateAnchor(both, recorded), both.length, "the last occurrence, not the first");
  // Recorded after L alone, and X L appended since: the later identical L lies past the recorded
  // size, so it is new, and the anchor stays at the first.
  const early = anchorOf(L);
  assert.equal(locateAnchor(both, early), L.length, "an identical line past the recorded size is never the anchor");
});

test("2.6 a commit rewritten by `pull --rebase` is named rewritten or abandoned, never logged or attributed", () => {
  const repo = observationRepo({ clone: true });
  repo.observe();
  const x = repo.commit({ "src/x.txt": "1" }, "fix: rewritten by the rebase");
  repo.upstreamCommit();
  repo.git("pull", "-q", "--rebase");
  assert.equal(repo.git("for-each-ref", "--contains", x, "refs/heads"), "", "fixture: X is on no branch");
  const o = repo.observe("PostToolUse", "git commit -m x && git pull --rebase");
  assert.equal(o.status, 0, o.stderr);
  assert.match(o.context, /rewritten or abandoned/i, `X is named as dead: ${JSON.stringify(o.stdout)}`);
  assert.ok(o.context.includes(short(repo, x)));
  assert.equal(rowsFor(repo, x).length, 0, "no detour-trail row for a dead commit");
  assert.doesNotMatch(o.context, new RegExp(`--attribute-commit ${x}`), "and no attribution command naming it");
});

test("2.7 a commit reset away in the same call is named rewritten or abandoned, never logged or attributed", () => {
  const repo = observationRepo();
  repo.observe();
  const y = repo.commit({ "src/y.txt": "1" }, "fix: reset away");
  repo.git("reset", "-q", "--hard", "HEAD~1");
  const o = repo.observe("PostToolUse", "git commit -m y && git reset --hard HEAD~1");
  assert.equal(o.status, 0, o.stderr);
  assert.match(o.context, /rewritten or abandoned/i, `Y is named as dead: ${JSON.stringify(o.stdout)}`);
  assert.ok(o.context.includes(short(repo, y)));
  assert.equal(rowsFor(repo, y).length, 0, "no row");
  assert.doesNotMatch(o.context, new RegExp(`--attribute-commit ${y}`), "no attribution command naming it");
  // G2-M1: naming a dead commit IS reporting it, so the report carries the provenance statement even
  // when no live commit is named alongside it.
  for (const re of PROVENANCE) assert.match(o.context, re, `a dead-only report states its provenance: ${o.context}`);
});

// ─────────────── 3. The provenance statement ───────────────

const PROVENANCE = [/landed since the last observation/, /another terminal/, /parallel call/];

test("3.1 a reported commit is stated as landed since the last observation, not proven to be this call's", () => {
  const repo = observationRepo();
  repo.observe();
  const sha = repo.commit({ "src/p.txt": "1" }, "fix: provenance");
  const o = repo.observe("PostToolUse", "git commit -m provenance");
  assert.equal(o.status, 0, o.stderr);
  assert.ok(o.context.includes(short(repo, sha)), `reported: ${JSON.stringify(o.stdout)}`);
  for (const re of PROVENANCE) assert.match(o.context, re);
  assert.doesNotMatch(o.context, /this call made|made by this call/i, "never claims the answered call made it");
});

test("3.2 a commit from another terminal carries the statement, and its automatic row names retract-detour", () => {
  const repo = observationRepo();
  repo.observe("PostToolUse", "ls");
  const sha = repo.commit({ "src/other.txt": "1" }, "chore: from another terminal");   // outside any call
  const o = repo.observe("PostToolUse", "npm test");                                   // a call that made no commit
  assert.equal(o.status, 0, o.stderr);
  assert.ok(o.context.includes(short(repo, sha)), `reported: ${JSON.stringify(o.stdout)}`);
  for (const re of PROVENANCE) assert.match(o.context, re);
  assert.equal(rowsFor(repo, sha).length, 1, "fixture: an AUTO-DETOUR row was written for it");
  assert.match(o.context, new RegExp(`retract-detour ${short(repo, sha)} --reason`), "the correction is the verb");
  assert.doesNotMatch(o.context, /edit\/remove the line|remove the line|edit the line/, "never a hand-edit of the log");
});

// ─────────────── 4. retract-detour ───────────────

import { spawnSync } from "node:child_process";
import { ENGINE, EMPTY_CACHE } from "./helpers.mjs";

function engineRun(cwd, args) {
  const r = spawnSync("node", [ENGINE, ...args], {
    cwd, encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: cwd, PM_CACHE_ROOT: EMPTY_CACHE },
  });
  return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}
const logPath = (repo) => path.join(repo.cwd, ".conductor", "detours.log");
const projectMdOf = (repo) => fs.readFileSync(path.join(repo.cwd, "PROJECT.md"), "utf8");
const detourTableRows = (repo) => {
  const md = projectMdOf(repo);
  const section = md.slice(md.indexOf("## Recent detours"), md.indexOf("## Briefing"));
  return section.split("\n").filter((l) => /^\| \d{4}-/.test(l));
};
const logRows = (repo) => repo.detours().split("\n").filter(Boolean).map((l) => l.split("\t"));
function writeRows(repo, rows) {
  fs.mkdirSync(path.dirname(logPath(repo)), { recursive: true });
  fs.writeFileSync(logPath(repo), rows.map((r) => ["2026-09-01T00:00:00.000Z", ...r].join("\t")).join("\n") + "\n");
  engineRun(repo.cwd, ["render"]);
}
/** A commit auto-logged by an observation, returned with its full sha. */
function autoLogged(repo, file, subject) {
  const sha = repo.commit({ [file]: "1" }, subject);
  const o = repo.observe("PostToolUse", "git commit");
  assert.equal(rowsFor(repo, sha).filter((r) => r.includes("\tAUTO-DETOUR\t")).length, 1,
    `fixture: ${subject} was auto-logged. Output: ${o.stdout}`);
  return sha;
}

test("4.1 retract-detour on an AUTO-DETOUR row appends a RETRACTED row and PROJECT.md drops it (abbreviated and full sha)", () => {
  const repo = observationRepo();
  repo.observe();
  for (const [file, form] of [["src/r1.txt", "short"], ["src/r2.txt", "full"]]) {
    const sha = autoLogged(repo, file, `chore: detour ${form}`);
    const before = logRows(repo).length;
    const arg = form === "short" ? short(repo, sha) : sha;
    const r = engineRun(repo.cwd, ["retract-detour", arg, "--reason", "own work"]);
    assert.equal(r.status, 0, r.stderr);
    const rows = logRows(repo);
    assert.equal(rows.length, before + 1, "one row appended, none removed");
    assert.ok(rows.some((x) => x[2] === "AUTO-DETOUR" && sha.startsWith(x[1])), "the original row is kept");
    const retraction = rows.at(-1);
    assert.equal(retraction[2], "RETRACTED");
    assert.ok(sha.startsWith(retraction[1]), "the retraction names the commit");
    assert.equal(retraction[3], "epic-a", "and the epic of the row it retracts");
    assert.equal(retraction[4], "own work");
    assert.ok(!detourTableRows(repo).some((l) => l.includes(short(repo, sha))), "PROJECT.md shows no row for it");
  }
});

test("4.2 rows of 7 and 8 characters match only their own commit, and a re-fired observation writes no new row", () => {
  const repo = observationRepo();
  repo.observe();
  const recordBefore = fs.readFileSync(OBSERVE_RECORD(repo.cwd), "utf8");
  const a = repo.commit({ "src/a.txt": "1" }, "fix: seven");
  const b = repo.commit({ "src/b.txt": "1" }, "fix: eight");
  writeRows(repo, [
    [repo.git("rev-parse", "--short=7", a), "AUTO-DETOUR", "epic-a", "fix: seven"],
    [repo.git("rev-parse", "--short=8", b), "AUTO-DETOUR", "epic-a", "fix: eight"],
  ]);
  let r = engineRun(repo.cwd, ["retract-detour", a, "--reason", "not a detour"]);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(logRows(repo).filter((x) => x[2] === "RETRACTED").map((x) => a.startsWith(x[1])), [true]);
  assert.equal(detourTableRows(repo).length, 1, "B's row is still visible");
  r = engineRun(repo.cwd, ["retract-detour", b, "--reason", "not a detour"]);
  assert.equal(r.status, 0, r.stderr);
  const retracted = logRows(repo).filter((x) => x[2] === "RETRACTED");
  assert.equal(retracted.length, 2);
  assert.ok(b.startsWith(retracted[1][1]) && !a.startsWith(retracted[1][1]), "the second retraction is B's only");
  // Re-fire: move the anchor back before both commits, so an observation reads them again.
  const rowsBefore = logRows(repo).length;
  fs.writeFileSync(OBSERVE_RECORD(repo.cwd), recordBefore);
  repo.observe("PostToolUse", "ls");
  assert.equal(logRows(repo).length, rowsBefore, "a retracted commit still counts as logged");
});

test("4.2a a row whose commit was rewritten and pruned can be retracted by the row's sha", () => {
  // G2-I5: either sha may begin with the other — the row's own abbreviation, and a value LONGER than
  // it (the pruned commit's full name), each retract it.
  for (const byLonger of [false, true]) {
    const repo = observationRepo();
    repo.observe();
    const gone = autoLogged(repo, "src/gone.txt", "chore: rewritten then pruned");
    const rowSha = rowsFor(repo, gone)[0].split("\t")[1];
    repo.git("reset", "-q", "--hard", "HEAD~1");
    fs.rmSync(path.join(repo.gitRoot, ".git", "ORIG_HEAD"), { force: true });
    repo.git("reflog", "expire", "--expire=now", "--all");
    repo.git("gc", "-q", "--prune=now");
    assert.throws(() => repo.git("cat-file", "-e", `${gone}^{commit}`), "fixture: the commit no longer resolves");
    const value = byLonger ? gone : rowSha;
    assert.ok(!byLonger || value.length > rowSha.length, "fixture: the value is longer than the row's sha");
    const r = engineRun(repo.cwd, ["retract-detour", value, "--reason", "rewritten away"]);
    assert.equal(r.status, 0, `${byLonger ? "longer value" : "row sha"}: ${r.stderr}`);
    const last = logRows(repo).at(-1);
    assert.equal(last[2], "RETRACTED");
    assert.equal(last[1], rowSha);
  }
});

test("4.3 every retract-detour refusal names its reason and writes nothing", () => {
  const repo = observationRepo();
  repo.observe();
  const logged = autoLogged(repo, "src/logged.txt", "chore: logged once");
  const bare = repo.commit({ "src/bare.txt": "1" }, "feat: never logged");
  engineRun(repo.cwd, ["log-detour", "declared minimal"]);            // a MINIMAL row at HEAD (bare)
  const unlogged = repo.commit({ "src/unlogged.txt": "1" }, "feat: no row at all");
  engineRun(repo.cwd, ["retract-detour", logged, "--reason", "first"]); // now already retracted
  // G2-I4: a LIVE commit's open row, and a value that extends that row's sha but resolves to nothing.
  // Only rows whose own sha also resolves to nothing may match an unresolvable value.
  const live = autoLogged(repo, "src/live.txt", "chore: a live row");
  const liveRowSha = rowsFor(repo, live)[0].split("\t")[1];
  const next = live[liveRowSha.length];
  const bogus = liveRowSha + (next === "0" ? "1" : "0") + "000000";
  fs.appendFileSync(logPath(repo),
    "2026-09-01T00:00:00.000Z\tabcdef12\tAUTO-DETOUR\tepic-a\tpruned one\n" +
    "2026-09-01T00:00:00.000Z\tabcdef13\tAUTO-DETOUR\tepic-a\tpruned two\n");
  engineRun(repo.cwd, ["render"]);

  const cases = [
    [["retract-detour", "deadbee", "--reason", "x"], /matches no row/i],
    [["retract-detour", unlogged, "--reason", "x"], /no AUTO-DETOUR or DETOUR-COMMIT row/],
    [["retract-detour", bare, "--reason", "x"], /only a MINIMAL row/],
    [["retract-detour", logged, "--reason", "x"], /already retracted/],
    [["retract-detour", short(repo, logged)], /--reason/],
    [["retract-detour", short(repo, logged), "--reason", ""], /--reason/],
    [["retract-detour", "1", "--reason", "x"], /at least 7/],
    [["retract-detour", "abcdef1", "--reason", "x"], /ambiguous/],
    [["retract-detour", bogus, "--reason", "x"], /resolves to no commit and matches no row/],
    // G2-M2: a ref is not a sha. It must not be told it "resolves to no commit".
    [["retract-detour", "HEAD", "--reason", "x"], /takes a commit sha, not a ref/],
  ];
  for (const [args, message] of cases) {
    const before = [fs.readFileSync(logPath(repo), "utf8"), projectMdOf(repo)];
    const r = engineRun(repo.cwd, args);
    assert.notEqual(r.status, 0, `${args.join(" ")} must refuse`);
    assert.match(r.stderr, message, `${args.join(" ")}: ${r.stderr}`);
    assert.deepEqual([fs.readFileSync(logPath(repo), "utf8"), projectMdOf(repo)], before, `${args.join(" ")} wrote nothing`);
  }
  // Missing and empty reason are named distinctly.
  const missing = engineRun(repo.cwd, ["retract-detour", "abcdef12"]).stderr;
  const empty = engineRun(repo.cwd, ["retract-detour", "abcdef12", "--reason", "  "]).stderr;
  assert.notEqual(missing, empty, "a missing and an empty --reason are different refusals");
});

test("4.4 REGRESSION GUARD: help, undeclared flags and a detached tree write nothing; render keeps 8 visible rows; one retraction hides both kinds", () => {
  const repo = observationRepo();
  repo.observe();
  const sha = autoLogged(repo, "src/both.txt", "chore: logged twice");
  fs.appendFileSync(logPath(repo), `2026-09-01T00:00:01.000Z\t${short(repo, sha)}\tDETOUR-COMMIT\tepic-a\tchore: logged twice\n`);

  const snap = () => [fs.readFileSync(logPath(repo), "utf8"), projectMdOf(repo)];
  let before = snap();
  let r = engineRun(repo.cwd, ["retract-detour", "--help"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /retract-detour/);
  assert.deepEqual(snap(), before, "--help writes nothing");
  r = engineRun(repo.cwd, ["retract-detour", sha, "--reason", "x", "--bogus", "y"]);
  assert.notEqual(r.status, 0);
  assert.deepEqual(snap(), before, "an undeclared flag writes nothing");

  r = engineRun(repo.cwd, ["retract-detour", sha, "--reason", "one commit, two rows"]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(detourTableRows(repo).length, 0, "one retraction hides the AUTO-DETOUR and the DETOUR-COMMIT row");

  // Eight visible rows even when retractions sit among the last eight lines.
  const rows = [];
  for (let i = 0; i < 10; i++) rows.push([`abc${(0x1000 + i).toString(16)}`, "AUTO-DETOUR", "epic-a", `row ${i}`]);
  writeRows(repo, rows);
  for (const i of [8, 9]) {
    r = engineRun(repo.cwd, ["retract-detour", `abc${(0x1000 + i).toString(16)}`, "--reason", "x"]);
    assert.equal(r.status, 0, r.stderr);
  }
  assert.equal(detourTableRows(repo).length, 8, "the last eight VISIBLE rows");
  assert.ok(!detourTableRows(repo).some((l) => /RETRACTED/.test(l)), "retraction rows are never rendered");

  // A detached tree: refused, nothing written.
  const det = observationRepo();
  det.observe();
  const dsha = autoLogged(det, "src/d.txt", "chore: in a tree about to detach");
  det.git("checkout", "-q", "--detach");
  before = [fs.readFileSync(logPath(det), "utf8"), projectMdOf(det)];
  r = engineRun(det.cwd, ["retract-detour", dsha, "--reason", "x"]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /no retraction was written/);
  assert.deepEqual([fs.readFileSync(logPath(det), "utf8"), projectMdOf(det)], before);
});

// ─────────────── 5. An amend replaces ───────────────

const stateOf = (repo) => JSON.parse(fs.readFileSync(path.join(repo.cwd, ".conductor", "state.json"), "utf8"));
function editState(repo, fn) {
  const s = stateOf(repo);
  fn(s);
  fs.writeFileSync(path.join(repo.cwd, ".conductor", "state.json"), JSON.stringify(s, null, 2) + "\n");
}
const amend = (repo, message) => { repo.git("commit", "-q", "--amend", "-m", message); return repo.head(); };
const retractedFor = (repo, full) => logRows(repo).filter((x) => x[2] === "RETRACTED" && full.startsWith(x[1]));
const withdrawLine = (id, sha) => new RegExp(`update-epic ${id} --withdraw-commit ${sha} --withdrawal-reason "[^"]+"`);

test("5.1 amending an auto-logged commit leaves one visible row; the log keeps the original and its retraction", () => {
  const repo = observationRepo();
  repo.observe();
  const c1 = autoLogged(repo, "src/am.txt", "chore: amend me");
  const c2 = amend(repo, "chore: amended");
  const o = repo.observe("PostToolUse", "git commit --amend");
  assert.equal(o.status, 0, o.stderr);
  const visible = detourTableRows(repo);
  assert.ok(!visible.some((l) => l.includes(short(repo, c1))), `no visible row for the replaced commit:\n${visible.join("\n")}`);
  assert.ok(visible.some((l) => l.includes(short(repo, c2))), "a row for the amending commit");
  const rows = logRows(repo);
  const orig = rows.findIndex((x) => x[2] === "AUTO-DETOUR" && c1.startsWith(x[1]));
  const retr = rows.findIndex((x) => x[2] === "RETRACTED" && c1.startsWith(x[1]));
  assert.ok(orig >= 0 && retr > orig, "the original row, then its retraction");
  assert.match(rows[retr][4], new RegExp(`amended into ${short(repo, c2)}`));
});

test("5.2 amending an attributed commit prints the withdrawal before any attribution, and writes no attribution", () => {
  const repo = observationRepo();
  repo.observe();
  const c1 = autoLogged(repo, "src/att.txt", "chore: attributed then amended");
  engineRun(repo.cwd, ["update-epic", "epic-a", "--attribute-commit", c1]);
  const before = JSON.stringify(stateOf(repo).epics.find((e) => e.id === "epic-a").attributedCommits);
  const c2 = amend(repo, "chore: amended attributed");
  const o = repo.observe("PostToolUse", "git commit --amend");
  assert.equal(o.status, 0, o.stderr);
  const w = o.context.search(withdrawLine("epic-a", c1));
  assert.ok(w >= 0, `the withdrawal is printed: ${o.context}`);
  assert.match(o.context, new RegExp(`--withdrawal-reason "amended into ${short(repo, c2)}"`));
  const a = o.context.indexOf("--attribute-commit");
  assert.ok(a < 0 || w < a, "before any attribution command");
  assert.doesNotMatch(o.context, new RegExp(`--attribute-commit ${c1}`), "never an attribution of the replaced commit");
  assert.equal(JSON.stringify(stateOf(repo).epics.find((e) => e.id === "epic-a").attributedCommits), before,
    "the hook withdraws nothing itself");
});

test("5.3 a chain of amends, an amend then reset, and an undone amend", () => {
  // C1 → C2 → C3 in one call.
  {
    const repo = observationRepo();
    repo.observe();
    const c1 = autoLogged(repo, "src/chain.txt", "chore: chain start");
    engineRun(repo.cwd, ["update-epic", "epic-a", "--attribute-commit", c1]);
    const c2 = amend(repo, "chore: chain two");
    const c3 = amend(repo, "chore: chain three");
    const o = repo.observe("PostToolUse", "git commit --amend && git commit --amend");
    assert.equal(o.status, 0, o.stderr);
    assert.equal(retractedFor(repo, c1).length, 1, "C1's row is retracted");
    assert.match(o.context, withdrawLine("epic-a", c1));
    assert.doesNotMatch(o.context, new RegExp(`--attribute-commit[^\\n\`]*(${c1}|${c2})`), "no attribution of C1 or C2");
    const visible = detourTableRows(repo);
    assert.ok(!visible.some((l) => l.includes(short(repo, c1)) || l.includes(short(repo, c2))), visible.join("\n"));
    assert.ok(visible.some((l) => l.includes(short(repo, c3))), "only C3 is shown");
  }
  // Amend then reset --hard HEAD~1: the amending commit is dead too, and C1 is still superseded.
  {
    const repo = observationRepo();
    repo.observe();
    const c1 = autoLogged(repo, "src/reset.txt", "chore: amend then reset");
    amend(repo, "chore: amended then reset");
    repo.git("reset", "-q", "--hard", "HEAD~1");
    // Attributed AFTER the reset: `reset --hard` restores the tracked state.json of the fixture's
    // baseline, which would silently drop an attribution recorded earlier.
    engineRun(repo.cwd, ["update-epic", "epic-a", "--attribute-commit", c1]);
    const o = repo.observe("PostToolUse", "git commit --amend && git reset --hard HEAD~1");
    assert.equal(o.status, 0, o.stderr);
    assert.equal(retractedFor(repo, c1).length, 1, "C1's row is retracted");
    assert.match(o.context, withdrawLine("epic-a", c1), "and its withdrawal printed");
  }
  // Amend then reset --hard HEAD@{1}: the amend is undone, C1 is live, nothing is superseded.
  {
    const repo = observationRepo();
    repo.observe();
    const c1 = autoLogged(repo, "src/undo.txt", "chore: amend undone");
    amend(repo, "chore: amend to be undone");
    repo.git("reset", "-q", "--hard", "HEAD@{1}");
    assert.equal(repo.head(), c1, "fixture: C1 is HEAD again");
    engineRun(repo.cwd, ["update-epic", "epic-a", "--attribute-commit", c1]);   // after the tree reset
    assert.deepEqual(stateOf(repo).epics.find((e) => e.id === "epic-a").attributedCommits, [c1], "fixture: C1 is attributed");
    const o = repo.observe("PostToolUse", "git commit --amend && git reset --hard HEAD@{1}");
    assert.equal(o.status, 0, o.stderr);
    assert.equal(retractedFor(repo, c1).length, 0, "C1's row is NOT retracted");
    assert.doesNotMatch(o.context, new RegExp(`--withdraw-commit ${c1}`), "and no withdrawal names C1");
  }
});

test("5.2a a delivered epic gets the withdrawal command exactly where update-epic would accept it", () => {
  const archivedDelivered = (extra) => ({
    title: "t", priority: "P1", role: "epic", links: [], reconcileNeeded: false, status: "archived",
    disposition: { outcome: "delivered", recordedAt: "2026-09-01T00:00:00.000Z", recordedBy: "agent" },
    ...extra,
  });
  const gate2 = (base, head) => ({ gate2: { verdict: "pass", baseSha: base, headSha: head, reviewedAt: "2026-09-01T00:00:00.000Z" } });
  const cases = [
    { id: "E", printed: false, exit: 1, build: (repo, root, c0, c1) =>
      archivedDelivered({ id: "E", lane: "openspec", attributedCommits: [c1], gateReview: gate2(root, c1) }) },
    { id: "E2", printed: true, exit: 0, build: (repo, root, c0, c1) =>
      archivedDelivered({ id: "E2", lane: "openspec", attributedCommits: [c0, c1], gateReview: gate2(root, c1) }) },
    { id: "E4", printed: false, exit: 1, build: (repo, root, c0, c1) => {
      fs.mkdirSync(path.join(repo.cwd, "openspec", "changes", "archive", "2026-09-01-E4"), { recursive: true });
      return archivedDelivered({ id: "E4", lane: "openspec", status: "queued", attributedCommits: [c1], gateReview: gate2(root, c1) });
    } },
    // G2-I2: the same commit attributed twice. --withdraw-commit removes ONE occurrence (the last), so
    // the record keeps c1 under its Gate 2 head and the withdrawal is accepted; a hook that simulated
    // removing every copy read an emptied array and withheld a command update-epic runs.
    { id: "E3", printed: true, exit: 0, build: (repo, root, c0, c1) =>
      archivedDelivered({ id: "E3", lane: "openspec", attributedCommits: [c1, c1], gateReview: gate2(root, c1) }) },
    { id: "F", printed: true, exit: 0, build: (repo, root, c0, c1) =>
      archivedDelivered({ id: "F", lane: "claude-code", attributedCommits: [c1] }) },
  ];
  for (const { id, printed, exit, build } of cases) {
    const repo = observationRepo();
    const root = repo.head();
    const c0 = repo.commit({ "src/c0.txt": "0" }, "feat: earlier delivered work");
    const c1 = repo.commit({ "src/c1.txt": "1" }, "feat: delivered work");
    editState(repo, (s) => { s.epics.push(build(repo, root, c0, c1)); });
    repo.observe();                                          // anchor after the delivered commits
    const c2 = amend(repo, "feat: delivered work, amended");
    const o = repo.observe("PostToolUse", "git commit --amend");
    assert.equal(o.status, 0, `${id}: ${o.stderr}`);
    const line = o.context.match(withdrawLine(id, c1));
    assert.equal(!!line, printed, `${id}: withdrawal line ${printed ? "printed" : "not printed"}:\n${o.context}`);
    if (!printed) {
      assert.match(o.context, new RegExp(`\`${id}\`[^\\n]*delivered`), `${id}: named as a delivered epic`);
      assert.match(o.context, /refusal[^\n]*names the remedy/, `${id}: says update-epic's refusal names the remedy`);
    } else {
      assert.doesNotMatch(o.context, new RegExp(`\`${id}\`[^\\n]*would break`), `${id}: no refusal sentence`);
    }
    const r = engineRun(repo.cwd, ["update-epic", id, "--withdraw-commit", c1, "--withdrawal-reason", `amended into ${short(repo, c2)}`]);
    assert.equal(r.status, exit, `${id}: running the withdrawal exits ${exit}. stderr: ${r.stderr}`);
  }
});

test("5.3a REGRESSION GUARD: checkouts before an amend — the replaced commit is the one HEAD held before the amend", () => {
  const repo = observationRepo();
  repo.observe();
  const c1 = autoLogged(repo, "src/co.txt", "chore: before the checkouts");
  // One call: `checkout -b tmp` (an orphan, so tmp does not keep C1 alive), a commit there, `checkout
  // main`, `commit --amend`. The entry just before the amend is the checkout FROM tmp, whose old value
  // is T — a rule reading neighbouring entries rather than the amend line's own old value names T.
  repo.git("checkout", "-q", "--orphan", "tmp");
  const t = repo.commit({ "src/t.txt": "1" }, "chore: on the orphan branch");
  repo.git("checkout", "-q", "-f", "main");
  const c2 = amend(repo, "chore: amended after checkouts");
  // Attributed after the checkouts: `checkout -f main` restores the fixture's tracked state.json.
  engineRun(repo.cwd, ["update-epic", "epic-a", "--attribute-commit", c1]);
  const o = repo.observe("PostToolUse", "git checkout --orphan tmp && git commit && git checkout main && git commit --amend");
  assert.equal(o.status, 0, o.stderr);
  assert.match(o.context, withdrawLine("epic-a", c1), `the replaced commit is C1:\n${o.context}`);
  assert.doesNotMatch(o.context, new RegExp(`--withdraw-commit ${t}`), "never the checkout's old value");
  assert.equal(retractedFor(repo, c1).length, 1);
  assert.ok(c2);
});

// ─────────────── 6. Detour rows: own artifacts and conductor-root paths ───────────────

/** Observe a commit and require the hook ran to completion, so an absent row is not a silent hook. */
function observedCommit(repo, files, subject) {
  const sha = repo.commit(files, subject);
  const o = repo.observe("PostToolUse", "git commit");
  assert.equal(o.status, 0, o.stderr);
  assert.ok(o.context.includes(short(repo, sha)), `the hook reported ${subject}: ${JSON.stringify(o.stdout)}`);
  return sha;
}
const pushDetourFixture = (repo, paused = "epic-a", detour = "detour-d") => {
  for (const args of [["add-epic", "--id", detour, "--lane", "claude-code"],
    ["push-detour", paused, "--detour", detour, "--reason", "blocked", "--reconcile"]]) {
    const r = engineRun(repo.cwd, args);
    assert.equal(r.status, 0, `${args.join(" ")}: ${r.stderr}`);
  }
};
const appendTo = (repo, rel) => fs.readFileSync(path.join(repo.gitRoot, rel), "utf8") + "\n";

test("6.1 a TDD commit touching the active epic's change directory is not an AUTO-DETOUR", () => {
  const repo = observationRepo();
  repo.observe();
  const sha = observedCommit(repo, { "openspec/changes/epic-a/red-1.txt": "red", "src/one.mjs": "1", "src/two.mjs": "2" },
    "fix(a): make the red test green");
  assert.equal(rowsFor(repo, sha).length, 0, repo.detours());
});

test("6.2 a task-tick commit for the active epic is not an AUTO-DETOUR", () => {
  const repo = observationRepo();
  repo.observe();
  const sha = observedCommit(repo, { "openspec/changes/epic-a/tasks.md": "- [x] 1.1\n" }, "chore(openspec): tick epic-a 1.1");
  assert.equal(rowsFor(repo, sha).length, 0, repo.detours());
});

test("6.3 a commit touching the active epic's plan file is not an AUTO-DETOUR", () => {
  const repo = observationRepo();
  const plan = "docs/superpowers/plans/2026-09-01-epic-a.md";
  fs.mkdirSync(path.join(repo.cwd, path.dirname(plan)), { recursive: true });
  fs.writeFileSync(path.join(repo.cwd, plan), "# plan\n");
  const r = engineRun(repo.cwd, ["update-epic", "epic-a", "--plan", plan]);
  assert.equal(r.status, 0, r.stderr);
  repo.observe();
  const sha = observedCommit(repo, { [plan]: "# plan\n- [x] step\n" }, "chore(plan): tick a step");
  assert.equal(rowsFor(repo, sha).length, 0, repo.detours());
});

test("6.4 a commit confined to a paused epic's artifacts is not a DETOUR-COMMIT", () => {
  const repo = observationRepo();
  pushDetourFixture(repo);
  repo.observe();
  const sha = observedCommit(repo, { "openspec/changes/epic-a/tasks.md": "- [x] 1.1\n" }, "chore(openspec): tick epic-a");
  assert.equal(rowsFor(repo, sha).length, 0, repo.detours());
});

test("6.5 a nested conductor's bookkeeping commit is not a detour, on either branch", () => {
  for (const detour of [false, true]) {
    const repo = observationRepo({ nested: true });
    if (detour) pushDetourFixture(repo);
    repo.observe();
    const files = {
      "projects/sub/.conductor/state.json": appendTo(repo, "projects/sub/.conductor/state.json"),
      "projects/sub/PROJECT.md": appendTo(repo, "projects/sub/PROJECT.md"),
    };
    const sha = observedCommit(repo, files, "chore(conductor): register epic-b");
    assert.equal(rowsFor(repo, sha).length, 0, `${detour ? "DETOUR-COMMIT" : "AUTO-DETOUR"}: ${repo.detours()}`);
  }
});

test("G2-I1 a nested conductor under a non-ASCII directory: its bookkeeping commit is not a detour, on either branch", () => {
  // Built from bytes, never spelled: `projects/s` + U+00FC + `b`. git quotes such a path in
  // `diff-tree` output by default ("projects/s\\303\\274b/..."), which then matched no show-prefix.
  const sub = "projects/s" + Buffer.from([0xc3, 0xbc]).toString("utf8") + "b";
  for (const detour of [false, true]) {
    const repo = observationRepo({ nested: sub });
    if (detour) pushDetourFixture(repo);
    repo.observe();
    const sha = observedCommit(repo, {
      [`${sub}/.conductor/state.json`]: appendTo(repo, `${sub}/.conductor/state.json`),
      [`${sub}/PROJECT.md`]: appendTo(repo, `${sub}/PROJECT.md`),
    }, "chore(conductor): register epic-b");
    assert.equal(rowsFor(repo, sha).length, 0, `${detour ? "DETOUR-COMMIT" : "AUTO-DETOUR"}: ${repo.detours()}`);
  }
});

test("G2-I1 sweep: upgrade's commit nudge names its rewritten files in a nested conductor under a non-ASCII directory", () => {
  // The sibling changed-path reader (git.mjs differsFromHead, `git diff --name-only`) printed the same
  // quoted git-root path, so no line ended with `/.conductor/state.json` and the nudge went silent.
  for (const sub of ["projects/sub", "projects/s" + Buffer.from([0xc3, 0xbc]).toString("utf8") + "b"]) {
    const repo = observationRepo({ nested: sub });
    editState(repo, (s) => { s.pmVersion = "0.1.0"; });
    repo.git("add", "-A");
    repo.git("commit", "-q", "-m", "chore: an older conductor");
    const r = engineRun(repo.cwd, ["upgrade"]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, /COMMIT THIS UPGRADE[\s\S]*git add [^\n]*\.conductor\/state\.json/, `${sub}: ${r.stderr}`);
  }
});

test("G2-I6 REGRESSION GUARD: in a nested conductor, pm-named files at the GIT root are not this conductor's own files", () => {
  const repo = observationRepo({ nested: true });
  repo.observe();
  const sha = observedCommit(repo, {
    "PROJECT.md": "# a git-root PROJECT.md\n",
    ".conductor/state.json": "{}\n",
  }, "chore(x): git-root files that only look like pm's");
  assert.equal(rowsFor(repo, sha).filter((l) => l.includes("\tAUTO-DETOUR\t")).length, 1,
    `a changed path outside the conductor root never matches pm's own files: ${repo.detours()}`);
});

test("6.6 REGRESSION GUARD: a nested mixed commit, a mismatched change directory and #173's shape still log", () => {
  {
    const repo = observationRepo({ nested: true });
    repo.observe();
    const sha = observedCommit(repo, {
      "projects/sub/PROJECT.md": appendTo(repo, "projects/sub/PROJECT.md"),
      "src/thing.mjs": "export {}\n",
    }, "chore(x): mixed");
    assert.equal(rowsFor(repo, sha).filter((l) => l.includes("\tAUTO-DETOUR\t")).length, 1, repo.detours());
  }
  {
    const repo = observationRepo();
    repo.observe();
    const sha = observedCommit(repo, { "openspec/changes/a-different-dir/tasks.md": "- [x] 1\n" }, "chore(openspec): tick");
    assert.equal(rowsFor(repo, sha).filter((l) => l.includes("\tAUTO-DETOUR\t")).length, 1,
      "an epic whose id differs from its change directory keeps today's behaviour");
  }
  {
    const repo = observationRepo();
    repo.observe();
    const sha = observedCommit(repo, {
      ".gitignore": appendTo(repo, ".gitignore"),
      ".conductor/state.json": appendTo(repo, ".conductor/state.json"),
      "PROJECT.md": appendTo(repo, "PROJECT.md"),
    }, "chore(pm): upgrade conductor");
    assert.equal(rowsFor(repo, sha).filter((l) => l.includes("\tAUTO-DETOUR\t")).length, 1, "#173's shape is still auto-logged");
  }
});

// ─────────────── 7. The attribution hint lists candidates and decides none ───────────────

const attributionCommands = (context) => [...context.matchAll(/update-epic (\S+) --attribute-commit/g)].map((m) => m[1]);
const arrays = (repo) => JSON.stringify(stateOf(repo).epics.map((e) => [e.id, e.attributedCommits]));

test("7.1 during a detour the hint gives the detour epic and the paused epic each a command, and decides neither", () => {
  const repo = observationRepo();
  pushDetourFixture(repo);
  repo.observe();
  const before = arrays(repo);
  const sha2 = repo.commit({ "src/more.mjs": "2" }, "feat: detour work");
  const out = repo.observe("PostToolUse", "git commit");
  const cmds = attributionCommands(out.context);
  assert.deepEqual([...cmds].sort(), ["detour-d", "epic-a"], `a command for D and for P:\n${out.context}`);
  assert.match(out.context, new RegExp(`update-epic detour-d --attribute-commit ${sha2}`));
  assert.match(out.context, new RegExp(`update-epic epic-a --attribute-commit ${sha2}`));
  assert.match(out.context, /choosing is yours|the choice is yours/i, "the choice is stated as the agent's");
  assert.equal(arrays(repo), before, "the hook attributes nothing");
});

test("7.2 a commit confined to the paused epic's change directory lists that epic first", () => {
  const repo = observationRepo();
  pushDetourFixture(repo);
  repo.observe();
  const before = arrays(repo);
  const sha = repo.commit({ "openspec/changes/epic-a/tasks.md": "- [x] 1\n" }, "chore(openspec): tick epic-a");
  const o = repo.observe("PostToolUse", "git commit");
  const cmds = attributionCommands(o.context);
  assert.deepEqual(cmds, ["epic-a", "detour-d"], `P's command precedes D's:\n${o.context}`);
  assert.equal(arrays(repo), before);
  assert.ok(sha);
});

test("7.3 REGRESSION GUARD: one active epic prints one command; an epic with no array is never a candidate; no active epic prints no hint", () => {
  {
    const repo = observationRepo();
    repo.observe();
    const before = arrays(repo);
    repo.commit({ "src/a.mjs": "1" }, "feat: ordinary work");
    const o = repo.observe("PostToolUse", "git commit");
    assert.deepEqual(attributionCommands(o.context), ["epic-a"]);
    assert.equal(arrays(repo), before);
  }
  {
    const repo = observationRepo();
    pushDetourFixture(repo);
    editState(repo, (s) => { delete s.epics.find((e) => e.id === "detour-d").attributedCommits; });
    repo.observe();
    repo.commit({ "src/b.mjs": "1" }, "feat: detour work");
    const o = repo.observe("PostToolUse", "git commit");
    assert.deepEqual(attributionCommands(o.context), ["epic-a"], "an epic with no attribution array is never a candidate");
  }
  {
    const repo = observationRepo();
    engineRun(repo.cwd, ["add-epic", "--id", "e-change", "--lane", "claude-code"]);
    const cleared = engineRun(repo.cwd, ["clear-active"]);
    assert.equal(cleared.status, 0, cleared.stderr);
    repo.observe();
    const s1 = repo.commit({ "openspec/changes/e-change/tasks.md": "- [x] 1\n" }, "chore(openspec): tick e-change");
    let o = repo.observe("PostToolUse", "git commit");
    assert.ok(o.context.includes(short(repo, s1)), "fixture: reported");
    assert.deepEqual(attributionCommands(o.context), [], "touching an epic's files never makes it a candidate");
    fs.mkdirSync(path.join(repo.gitRoot, "openspec", "changes", "archive"), { recursive: true });
    repo.git("mv", "openspec/changes/e-change", "openspec/changes/archive/e-change");
    repo.git("commit", "-q", "-m", "chore(openspec): archive e-change");
    o = repo.observe("PostToolUse", "git commit");
    assert.deepEqual(attributionCommands(o.context), [], "nor does the archive move");
  }
});
