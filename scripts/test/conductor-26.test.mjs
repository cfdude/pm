// scripts/test/conductor-26.test.mjs
//
// gh#129 — the commit-time attribution nudge.
//
// `update-epic <id> --attribute-commit <sha>` is asked for at the moment a commit is made and,
// until now, checked for only at the archive gate. By then the commits were made hours or days
// and possibly several sessions earlier, and the array is APPEND-ONLY: its last entry is the
// endpoint a Gate 2 `headSha` is compared against, so a catch-up performed after forward
// attribution has begun leaves an ancestor as the endpoint and is not recoverable. The detector
// therefore fired at the one moment its finding could no longer be acted on.
//
// The nudge closes that, and it is deliberately the SMALLEST thing that does: one clause
// appended to the advisory commit-nudge ALREADY emits on a real commit. It adds no new hook, no
// new file, no new state and no new flag, and it names a sha only when commit-watch OBSERVED the
// commit land (`verdict: "landed"`). Every assertion below is therefore two-directional — the
// clause must appear where the obligation is real, and must be ABSENT everywhere the engine
// would otherwise be guessing, because a nudge naming a wrong sha on an append-only array is
// worse than no nudge at all.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { run, tmpRepo, writeState, gitRepo, commitFiles } from "./helpers.mjs";

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
const head = (cwd) => git(cwd, "rev-parse", "HEAD");

function nudge(cwd, command) {
  return run(["commit-nudge"], { cwd, input: JSON.stringify({ tool_input: { command } }) });
}
/** The hook fires on EVERY Bash call, so in the field the watermark is always primed by the
 *  previous call. A fixture that skips this tests the cold-start rung instead. */
const prime = (cwd) => nudge(cwd, "ls -la");
const ctxOf = (out) => (out.trim() ? JSON.parse(out).hookSpecificOutput.additionalContext : "");

/** An initialized repo with an active epic. `attributed` is written verbatim onto the epic so
 *  each of the three shapes — absent, present-and-empty, present-and-non-empty — is exercised. */
function repoWithActive(attributed, extra = {}) {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const epic = {
    id: "epic-a", title: "epic-a", priority: "P1", status: "active", role: "epic",
    lane: "openspec", links: [], reconcileNeeded: false,
  };
  if (attributed !== undefined) epic.attributedCommits = attributed;
  writeState(cwd, { version: 1, active: "epic-a", detourStack: [], epics: [epic], ...extra });
  gitRepo(cwd);
  return cwd;
}

test("gh#129: a real commit under an active epic names the exact attribute-commit line", () => {
  const cwd = repoWithActive([]);
  prime(cwd);
  commitFiles(cwd, { "a.txt": "1" }, "feat(x): real work");
  const ctx = ctxOf(nudge(cwd, "git commit -m 'feat(x): real work'"));
  assert.match(ctx, new RegExp(`update-epic epic-a --attribute-commit ${head(cwd)}`),
    "the nudge must name the epic and the sha that just landed, verbatim and runnable");
});

test("gh#129: an epic that has attributed nothing yet gets the catch-up rule; one that has does not", () => {
  const first = repoWithActive([]);
  prime(first);
  commitFiles(first, { "a.txt": "1" }, "feat(x): real work");
  const firstCtx = ctxOf(nudge(first, "git commit -m x"));
  assert.match(firstCtx, /ORDER THEY LANDED/,
    "an empty array is the LAST moment the catch-up rule is available — say so there");

  const later = repoWithActive(["0000000000000000000000000000000000000000"]);
  prime(later);
  commitFiles(later, { "a.txt": "1" }, "feat(x): real work");
  const laterCtx = ctxOf(nudge(later, "git commit -m x"));
  assert.doesNotMatch(laterCtx, /ORDER THEY LANDED/,
    "forward attribution has begun: catching up now is the thing item 4 forbids, so never say it");
  assert.match(laterCtx, /--attribute-commit/, "but the per-commit obligation still stands");
});

test("gh#129: commits made during a detour are attributed to the DETOUR epic, not the paused parent", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  writeState(cwd, {
    version: 1, active: "paused-a",
    detourStack: [{ pausedEpic: "paused-a", pausedAt: "2026-08-28T00:00:00Z", reason: "x", spawnedDetour: "detour-1", reconcileOnResume: false }],
    epics: [
      { id: "paused-a", title: "paused-a", priority: "P1", status: "paused", role: "epic", lane: "openspec", links: [], reconcileNeeded: false, attributedCommits: [] },
      { id: "detour-1", title: "detour-1", priority: "P1", status: "active", role: "detour", lane: "claude-code", links: [], reconcileNeeded: false, attributedCommits: [] },
    ],
  });
  gitRepo(cwd);
  prime(cwd);
  commitFiles(cwd, { "a.txt": "1" }, "fix(y): detour work");
  const ctx = ctxOf(nudge(cwd, "git commit -m x"));
  assert.match(ctx, /--attribute-commit/, "a commit during a detour is still a commit to attribute");
  assert.match(ctx, /update-epic detour-1 /,
    "state.active names the PAUSED parent while a detour is live; the work belongs to the detour");
  assert.doesNotMatch(ctx, /update-epic paused-a /,
    "attributing a detour's commit to the paused parent is unrecoverable — the array is append-only");
});

test("gh#129: the clause carries the ONE exclusion, so the archive-move commit is not attributed on autopilot", () => {
  const cwd = repoWithActive([]);
  prime(cwd);
  commitFiles(cwd, { "a.txt": "1" }, "feat(x): real work");
  assert.match(ctxOf(nudge(cwd, "git commit -m x")), /moves or deletes/,
    "attributing the archive move makes the epic's own Gate 2 read stale at the archive gate");
});

test("gh#129: SILENT where the engine would be guessing — no active epic, no array, unobserved commit", () => {
  // (a) No active epic. gh#91's lesson: with nothing active there is nothing to attribute TO.
  const none = repoWithActive([], {});
  writeState(none, { version: 1, active: null, detourStack: [], epics: [] });
  prime(none);
  commitFiles(none, { "a.txt": "1" }, "feat(x): real work");
  assert.doesNotMatch(ctxOf(nudge(none, "git commit -m x")), /--attribute-commit/,
    "no active epic: naming one would be the engine inventing the attribution it must never infer");

  // (a2) A detour frame naming an epic that does not exist — a real, non-placeholder id that
  // resolves to nothing. The id must be RESOLVED against state.epics rather than interpolated:
  // an epic id can reach here from a detour frame, from `state.active`, or from detourContext's
  // literal "-" fallback, and only a lookup rejects all three when they name no record.
  const ghost = tmpRepo();
  run(["init"], { cwd: ghost });
  writeState(ghost, {
    version: 1, active: null,
    detourStack: [{ pausedEpic: "gone", pausedAt: "2026-08-28T00:00:00Z", reason: "x", spawnedDetour: "ghost-detour", reconcileOnResume: false }],
    epics: [],
  });
  gitRepo(ghost);
  prime(ghost);
  commitFiles(ghost, { "a.txt": "1" }, "feat(x): real work");
  const ghostCtx = ctxOf(nudge(ghost, "git commit -m x"));
  assert.doesNotMatch(ghostCtx, /--attribute-commit/,
    "an id that names no epic must produce no command, not a command against a record that is not there");

  // (b) attributedCommits ABSENT — an archive-backfilled epic that predates the capability.
  // state.mjs deliberately leaves the array off those; asserting an obligation there would
  // convert the staleness gate's one forgiven case into a repo-wide false positive.
  const absent = repoWithActive(undefined);
  prime(absent);
  commitFiles(absent, { "a.txt": "1" }, "feat(x): real work");
  assert.doesNotMatch(ctxOf(nudge(absent, "git commit -m x")), /--attribute-commit/,
    "an absent array means the epic predates attribution — nothing can be concluded, so say nothing");

  // (c) UNVERIFIABLE rung: no watermark yet, so nothing was observed to land. The legacy text
  // heuristic still emits its own advisory, but a sha must never be named — obs.head is
  // non-null here while no commit is known to have landed, which is gh#104 in a new costume.
  const cold = repoWithActive([]);
  // deliberately NOT primed: no .conductor/commit-watch.json exists
  commitFiles(cold, { "a.txt": "1" }, "feat(x): real work");
  const coldCtx = ctxOf(nudge(cold, "git commit -m 'feat(x): real work'"));
  assert.match(coldCtx, /Commit detected/, "the legacy rung still runs — this is a no-regression check");
  assert.doesNotMatch(coldCtx, /--attribute-commit/,
    "unverifiable is not a quiet yes: no observation, no sha, no obligation asserted");
});

test("gh#129: a Bash call that merely mentions git commit stays silent (gh#104 must not regress)", () => {
  const cwd = repoWithActive([]);
  prime(cwd);
  assert.equal(nudge(cwd, "echo 'run git commit -m ok'").trim(), "",
    "HEAD did not move: nothing landed, so nothing at all is emitted");
});

test("gh#129: degrades to doing nothing — no git, unreadable state, reflogs disabled", () => {
  // The hook fires on EVERY Bash tool call in EVERY initialized project. Erroring here is a
  // mid-session exit-9 for every user, so each rung must exit 0.
  const noGit = tmpRepo();
  run(["init"], { cwd: noGit });
  assert.doesNotThrow(() => nudge(noGit, "git commit -m x"), "no repository at all");

  const broken = repoWithActive([]);
  prime(broken);
  commitFiles(broken, { "a.txt": "1" }, "feat(x): real work");
  fs.writeFileSync(path.join(broken, ".conductor", "state.json"), "{ not json");
  assert.doesNotThrow(() => nudge(broken, "git commit -m x"), "unreadable state.json");

  const noReflog = repoWithActive([]);
  git(noReflog, "config", "core.logAllRefUpdates", "false");
  prime(noReflog);
  commitFiles(noReflog, { "a.txt": "1" }, "feat(x): real work");
  assert.doesNotThrow(() => nudge(noReflog, "git commit -m x"), "reflogs disabled");
});
