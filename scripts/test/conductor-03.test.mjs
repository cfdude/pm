import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { tmpRepo, run, readState, writeState, projectMd, parseBrief, expectFail, withArchivedChange, gitRepo, commitFiles } from "./helpers.mjs";

// ─────────────── 0.7.0: set-active / clear-active + active↔status ───────────────

test("set-active sets the .active pointer and the epic's status, demoting a prior active", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["add-epic", "--id", "a", "--lane", "claude-code"], { cwd });
  run(["add-epic", "--id", "b", "--lane", "claude-code"], { cwd });
  run(["set-active", "a"], { cwd });
  let s = readState(cwd);
  assert.equal(s.active, "a");
  assert.equal(s.epics.find(e => e.id === "a").status, "active");
  run(["set-active", "b"], { cwd });
  s = readState(cwd);
  assert.equal(s.active, "b");
  assert.equal(s.epics.find(e => e.id === "b").status, "active");
  assert.equal(s.epics.find(e => e.id === "a").status, "queued");   // prior active demoted
});

test("set-active rejects an unknown or archived id and writes nothing", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["add-epic", "--id", "real", "--lane", "claude-code"], { cwd });
  const before = fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8");
  assert.ok(expectFail(() => run(["set-active", "ghost"], { cwd })), "unknown id rejected");
  assert.equal(fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8"), before);
  // archived id
  fs.mkdirSync(path.join(cwd, "openspec", "changes", "archive", "2026-07-08-done"), { recursive: true });
  run(["add-epic", "--id", "done", "--lane", "openspec"], { cwd });
  assert.ok(expectFail(() => run(["set-active", "done"], { cwd })), "archived id rejected");
});

test("clear-active nulls the pointer and demotes the active epic", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["add-epic", "--id", "a", "--lane", "claude-code"], { cwd });
  run(["set-active", "a"], { cwd });
  run(["clear-active"], { cwd });
  const s = readState(cwd);
  assert.equal(s.active, null);
  assert.equal(s.epics.find(e => e.id === "a").status, "queued");
});

test("update-epic --status active also sets the .active pointer (no desync)", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["add-epic", "--id", "a", "--lane", "claude-code"], { cwd });
  run(["update-epic", "a", "--status", "active"], { cwd });
  const s = readState(cwd);
  assert.equal(s.active, "a");                                       // the reported footgun, fixed
  assert.equal(s.epics.find(e => e.id === "a").status, "active");
  assert.match(parseBrief(cwd), /NOW: `a`/);
});

test("update-epic moving the active epic off active clears the pointer", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["add-epic", "--id", "a", "--lane", "claude-code"], { cwd });
  run(["set-active", "a"], { cwd });
  run(["update-epic", "a", "--status", "queued"], { cwd });
  const s = readState(cwd);
  assert.equal(s.active, null);
  assert.equal(s.epics.find(e => e.id === "a").status, "queued");
});

test("add-epic --status active sets the .active pointer too", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["add-epic", "--id", "a", "--lane", "claude-code", "--status", "active"], { cwd });
  assert.equal(readState(cwd).active, "a");
});

// ──────────────── epic-level autonomy: set-autonomy ────────────────

test("set-autonomy sets level and rejects an unknown level", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["add-epic", "--id", "a", "--lane", "claude-code"], { cwd });
  run(["set-autonomy", "a", "--level", "autonomous"], { cwd });
  assert.equal(readState(cwd).epics.find(e => e.id === "a").autonomy.level, "autonomous");
  assert.ok(expectFail(() => run(["set-autonomy", "a", "--level", "bogus"], { cwd })), "bad level rejected");
});

test("set-autonomy records preauthorize/context/notify entries, repeatable and merged across calls", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["add-epic", "--id", "a", "--lane", "claude-code"], { cwd });
  run(["set-autonomy", "a",
    "--preauthorize", "drop-scratch-table:reviewed, safe to drop",
    "--preauthorize", "rename-field:no external readers",
    "--context", "staging DB only, no prod access",
  ], { cwd });
  let a = readState(cwd).epics.find(e => e.id === "a").autonomy;
  assert.equal(a.preAuthorized.length, 2);
  assert.deepEqual(
    { action: a.preAuthorized[0].action, reason: a.preAuthorized[0].reason },
    { action: "drop-scratch-table", reason: "reviewed, safe to drop" },
  );
  assert.ok(a.preAuthorized[0].grantedAt);            // timestamp present
  assert.deepEqual(a.context, ["staging DB only, no prod access"]);

  // a second call APPENDS, does not clobber
  run(["set-autonomy", "a", "--notify", "ran a schema migration"], { cwd });
  a = readState(cwd).epics.find(e => e.id === "a").autonomy;
  assert.equal(a.preAuthorized.length, 2);            // unchanged by the second call
  assert.equal(a.notifications.length, 1);
  assert.equal(a.notifications[0].what, "ran a schema migration");
  assert.ok(a.notifications[0].when);
});

test("set-autonomy supports a category-based --preauthorize shorthand distinct from exact-action grants", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["add-epic", "--id", "a", "--lane", "claude-code"], { cwd });
  run(["set-autonomy", "a",
    "--preauthorize", "category:filesystem:routine scratch-file cleanup",
    "--preauthorize", "delete-legacy-config:reviewed, one-off",
    "--preauthorize", "category:network:internal health checks only",
  ], { cwd });
  const a = readState(cwd).epics.find(e => e.id === "a").autonomy;
  assert.equal(a.preAuthorized.length, 3);

  const catEntry = a.preAuthorized.find(e => e.category === "filesystem");
  assert.ok(catEntry, "filesystem category entry recorded");
  assert.equal(catEntry.action, undefined);           // category entries carry no `action`
  assert.equal(catEntry.reason, "routine scratch-file cleanup");
  assert.ok(catEntry.grantedAt);

  const actionEntry = a.preAuthorized.find(e => e.action === "delete-legacy-config");
  assert.ok(actionEntry, "exact-action entry still recorded unchanged");
  assert.equal(actionEntry.category, undefined);      // exact-action entries carry no `category`
  assert.equal(actionEntry.reason, "reviewed, one-off");

  const netEntry = a.preAuthorized.find(e => e.category === "network");
  assert.ok(netEntry);
  assert.equal(netEntry.reason, "internal health checks only");
});

test("set-autonomy rejects an unknown --preauthorize category", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["add-epic", "--id", "a", "--lane", "claude-code"], { cwd });
  assert.ok(expectFail(() => run(["set-autonomy", "a",
    "--preauthorize", "category:bogus-category:whatever",
  ], { cwd })), "unknown category rejected");
});

test("set-autonomy on an unknown id exits non-zero and writes nothing", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  const before = fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8");
  assert.ok(expectFail(() => run(["set-autonomy", "ghost", "--level", "autonomous"], { cwd })));
  assert.equal(fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8"), before);
});

test("render marks an autonomous epic with 🤖 in its Status cell; a plain epic gets no marker", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["add-epic", "--id", "auto", "--lane", "claude-code"], { cwd });
  run(["add-epic", "--id", "plain", "--lane", "claude-code"], { cwd });
  run(["set-autonomy", "auto", "--level", "autonomous"], { cwd });
  const md = projectMd(cwd);
  const autoLine = md.split("\n").find(l => l.includes("`auto`"));
  const plainLine = md.split("\n").find(l => l.includes("`plain`"));
  assert.match(autoLine, /🤖/);
  assert.doesNotMatch(plainLine, /🤖/);
});

test("brief NOW line shows 🤖 autonomous only when the active epic is autonomous", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  run(["add-epic", "--id", "a", "--lane", "claude-code", "--status", "active"], { cwd });
  assert.doesNotMatch(parseBrief(cwd), /🤖/);
  run(["set-autonomy", "a", "--level", "autonomous"], { cwd });
  assert.match(parseBrief(cwd), /NOW: `a`.*🤖 autonomous/);
});

test("isArchived recognizes a date-prefixed openspec archive dir (status flips, no ghost)", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  withArchivedChange(cwd, "feat-x");
  run(["render"], { cwd });
  const md = projectMd(cwd);
  assert.match(md, /`feat-x` \| openspec \| epic \| archived/);   // derived status = archived
  assert.doesNotMatch(md, /no change on disk/);                   // not a false ghost
});

test("brief does not show an archived epic as active, and stays read-only", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  withArchivedChange(cwd, "feat-x");
  const brief = parseBrief(cwd);
  assert.doesNotMatch(brief, /NOW: `feat-x`/);    // not presented as active
  assert.match(brief, /was archived/);            // honest note instead
  assert.equal(readState(cwd).active, "feat-x");  // brief did NOT mutate state (read path)
});

test("sync clears an archived active pointer and stamps archived status", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  withArchivedChange(cwd, "feat-x");
  run(["sync"], { cwd });
  const s = readState(cwd);
  assert.equal(s.active, null);
  assert.equal(s.epics.find(e => e.id === "feat-x").status, "archived");
});

// This fixture has NO git repo, which makes it the only coverage of commit-nudge's
// UNVERIFIABLE branch (gh#65/gh#68): headSubject() returns null, so the hook cannot tell whether
// a commit landed and must fall through to the prior behaviour rather than going silent. Keep it
// repo-less deliberately — a two-state guard (match / no-match) broke exactly this test, which is
// how the three-state design was found. Its verified-path twin is the next test.
test("commit-nudge self-heals an archived active pointer when the commit cannot be verified (no git repo)", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  withArchivedChange(cwd, "feat-x");
  run(["commit-nudge"], { cwd, input: JSON.stringify({ tool_input: { command: 'git commit -m "archive feat-x"' } }) });
  const s = readState(cwd);
  assert.equal(s.active, null);
  assert.equal(s.epics.find(e => e.id === "feat-x").status, "archived");
});

test("commit-nudge self-heals an archived active pointer on the VERIFIED path too (real git repo, commit landed)", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  withArchivedChange(cwd, "feat-x");
  gitRepo(cwd);
  // Land the commit for real so headSubject() matches and the hook takes the verified path.
  commitFiles(cwd, { "archived.txt": "1" }, "archive feat-x");
  run(["commit-nudge"], { cwd, input: JSON.stringify({ tool_input: { command: 'git commit -m "archive feat-x"' } }) });
  const s = readState(cwd);
  assert.equal(s.active, null, "self-heal must fire on the verified path, not only the unverifiable one");
  assert.equal(s.epics.find(e => e.id === "feat-x").status, "archived");
});

// ───────── recompute-don't-remember: active validity + reconcileNeeded self-heal ─────────

test("render clears a dangling active pointer that references a completely missing epic (not just an archived one)", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  writeState(cwd, { version: 1, active: "ghost-id", detourStack: [], epics: [
    { id: "real", title: "real", priority: "P1", status: "queued", role: "epic", lane: "claude-code", links: [] },
  ]});
  run(["render"], { cwd });
  assert.equal(readState(cwd).active, null);
});

test("render recomputes reconcileNeeded from the detour stack rather than trusting a stored flag", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  writeState(cwd, {
    version: 1, active: "paused-a", detourStack: [
      { pausedEpic: "paused-a", pausedAt: "2026-07-14T00:00:00Z", reason: "x", spawnedDetour: "d1", reconcileOnResume: true },
    ],
    epics: [
      // stale true with no matching frame → should be healed to false
      { id: "stale-true", title: "stale-true", priority: "P1", status: "queued", role: "epic", lane: "claude-code", links: [], reconcileNeeded: true },
      // missing/false but IS the pausedEpic of a reconcileOnResume frame → should be healed to true
      { id: "paused-a", title: "paused-a", priority: "P1", status: "paused", role: "epic", lane: "claude-code", links: [], reconcileNeeded: false },
    ],
  });
  run(["render"], { cwd });
  const s = readState(cwd);
  assert.equal(s.epics.find(e => e.id === "stale-true").reconcileNeeded, false);
  assert.equal(s.epics.find(e => e.id === "paused-a").reconcileNeeded, true);
});

test("render NEVER clears reconcileNeeded on the currently active epic, even with no live detour frame (the legitimate just-popped, pre-reconcile window)", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  // POP protocol removes the detour-stack frame BEFORE reconciliation runs, so an active
  // epic can legitimately still owe reconcile with an EMPTY detourStack. A naive recompute
  // that derives reconcileNeeded purely from live-frame presence would wipe this out at
  // exactly the moment it matters most — this regression test locks that in.
  writeState(cwd, {
    version: 1, active: "just-resumed", detourStack: [],
    epics: [
      { id: "just-resumed", title: "just-resumed", priority: "P1", status: "active", role: "epic", lane: "claude-code", links: [], reconcileNeeded: true },
    ],
  });
  run(["render"], { cwd });
  assert.equal(readState(cwd).epics.find(e => e.id === "just-resumed").reconcileNeeded, true);
});

test("brief displays the recomputed truth but stays read-only, even for the new active/reconcile checks", () => {
  const cwd = tmpRepo(); run(["init"], { cwd });
  writeState(cwd, { version: 1, active: "ghost-id", detourStack: [], epics: [
    { id: "real", title: "real", priority: "P1", status: "queued", role: "epic", lane: "claude-code", links: [] },
  ]});
  const brief = parseBrief(cwd);
  assert.match(brief, /NOW: \(no active epic set\)/);
  assert.equal(readState(cwd).active, "ghost-id");   // brief did NOT mutate state (read path)
});
