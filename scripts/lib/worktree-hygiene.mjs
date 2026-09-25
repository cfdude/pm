// scripts/lib/worktree-hygiene.mjs
// Cross-references git worktree list against epic status to flag orphaned
// hierarchy-child worktrees; lists .changesets/*.md fragments; verifies state.json
// hasn't been hand-edited outside the render pipeline. One-directional dependencies only.

import fs from "node:fs";
import path from "node:path";
import { isInitialized, loadState } from "./state.mjs";
import { ARTIFACT, storeOps } from "./store.mjs";
import { engineRoot, escapeControls, jsonText } from "./constants.mjs";
import { die } from "./command-exit.mjs";
import { errStream, gitOps, outStream } from "./invocation.mjs";

/** `verify-worktrees` — cross-references `git worktree list` against epic status (and, since
 *  the `df-verify-worktrees-merged-not-just-archived` fix, actual merge state) to catch a
 *  hierarchy-dispatch worktree (branch `hierarchy-child/<epic-id>`, see the epic-hierarchy
 *  orchestration design's worktree-isolation addendum) that was never cleaned up after its
 *  work landed. Two independent triggers, either one is enough to flag a worktree:
 *    - `epic-archived` — the epic's status field says it's done (the original check).
 *    - `branch-merged` — the worktree's branch tip is already an ancestor of the current
 *      branch's HEAD (`git merge-base --is-ancestor`), regardless of what the epic's status
 *      field says. This catches the case where `git branch -d` was attempted after a merge
 *      and failed with "used by worktree" — the branch is fully merged but the worktree
 *      itself (and often the epic's status bookkeeping) was never cleaned up.
 *  Pure read — flags, never deletes, since a worktree could in principle still hold
 *  in-progress work the bookkeeping hasn't caught up with. Bakes worktree hygiene into the
 *  plugin itself (checkable on any fresh install) rather than depending on a user's own
 *  personal discipline/CLAUDE.md. Zero-dependency: shells out to `git worktree list -z
 *  --porcelain` and `git merge-base --is-ancestor` only; gracefully returns no orphans if
 *  this isn't a git repo at all, and REFUSES on any other listing failure (an old git). */
export function verifyWorktrees() {
  if (!isInitialized()) { die("conductor: run /pm:init first\n"); }
  const state = loadState();
  const byId = new Map(state.epics.map(e => [e.id, e]));
  let out;
  try {
    out = gitOps().worktreeList();
  } catch (e) {
    // ONLY "not a repository" (git's status 128) is an honest empty answer: there are no worktrees
    // to be orphaned. Any other failure — above all a git older than 2.36, which refuses `-z` as an
    // unknown switch (status 129) — used to print the same `[]`, a check that could not run reading
    // exactly like a clean one. Refused instead, with git's own words.
    // Matched on git's OWN words, not on status 128 alone (branch review): git exits 128 for
    // "dubious ownership" and a corrupt repository too, and those have worktrees nobody checked.
    const said = e && e.stderr ? String(e.stderr).trim() : "";
    if (/not a git repository/i.test(said)) {
      outStream().write(jsonText({ orphaned: [] }) + "\n");
      return;
    }
    const how = e && e.code === "ENOENT" ? "git was not found on PATH"
      : e && Number.isInteger(e.status) ? `git exited ${escapeControls(String(e.status))}`
      : `git could not be run (${escapeControls(String((e && (e.code || e.message)) || "unknown error"))})`;
    die(`conductor: verify-worktrees could not list worktrees — ${how}` +
      (said ? `: ${escapeControls(said)}` : "") +
      ". It reads `git worktree list --porcelain -z`, which needs git 2.36 or later. Nothing was checked.\n");
  }
  const orphaned = [];
  let currentPath = null;
  let currentHead = null;
  for (const line of out.split("\0")) {
    if (line.startsWith("worktree ")) { currentPath = line.slice("worktree ".length); currentHead = null; continue; }
    if (line.startsWith("HEAD ")) { currentHead = line.slice("HEAD ".length).trim(); continue; }
    const m = line.match(/^branch refs\/heads\/hierarchy-child\/(.+)$/);
    if (m && currentPath) {
      const epicId = m[1];
      const epic = byId.get(epicId);
      const branch = `hierarchy-child/${epicId}`;
      const archived = !!(epic && epic.status === "archived");
      const merged = !!(currentHead && isAncestorOfCurrentHead(currentHead));
      if (archived || merged) {
        const reasons = [];
        if (archived) reasons.push("epic-archived");
        if (merged) reasons.push("branch-merged");
        orphaned.push({ path: currentPath, branch, epicId, reasons });
      }
      currentPath = null;
      currentHead = null;
    }
  }
  outStream().write(jsonText({ orphaned }) + "\n");
}

/** True if `sha` is an ancestor of the current branch's HEAD (i.e. already merged in) —
 *  used by `verifyWorktrees()`'s `branch-merged` trigger. Returns false (never throws) if
 *  the check itself fails for any reason (detached/missing ref, shallow clone, etc.) so a
 *  git-plumbing hiccup degrades to "not flagged" rather than crashing verify-worktrees. */
export function isAncestorOfCurrentHead(sha) {
  try {
    // A worktree head read from `git worktree list`, not a stored value — but never interpolated into
    // a shell line, and never read as an option either (hex-gated; no `--end-of-options`, see git.mjs).
    if (typeof sha !== "string" || !/^[0-9a-fA-F]{4,64}$/.test(sha)) return false;
    gitOps().mergeBaseIsAncestorOfHead(sha);
    return true;
  } catch {
    return false;
  }
}

/** `changesets` — lists the `.changesets/<epic-id>.md` fragment files hierarchy children write
 *  instead of editing CHANGELOG.md's shared `[Unreleased]` section directly (that shared-header
 *  edit was a guaranteed merge conflict across parallel batches). Pure read: never deletes or
 *  concatenates on its own — the orchestrator is the sole writer of CHANGELOG.md, same pattern as
 *  it already being the sole writer of state.json, and does the consolidation itself at release
 *  time (concatenate the fragment bodies into the new/`[Unreleased]` section, then delete the
 *  consumed files). Returns `{ changesets: [{ id, path, body }] }` sorted by id, `[]` if
 *  `.changesets/` doesn't exist or is empty — never errors on a missing directory. */
export function changesets() {
  if (!isInitialized()) { die("conductor: run /pm:init first\n"); }
  const dir = path.join(engineRoot(), ".changesets");
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    outStream().write(jsonText({ changesets: [] }) + "\n");
    return;
  }
  const out = [];
  for (const ent of entries) {
    if (!ent.isFile() || !ent.name.endsWith(".md")) continue;
    const id = ent.name.slice(0, -3);
    const p = path.join(dir, ent.name);
    out.push({ id, path: p, body: fs.readFileSync(p, "utf8") });
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  outStream().write(jsonText({ changesets: out }) + "\n");
}

/** `verify-state` — mechanically catches an undetected hand-edit of state.json (CLAUDE.md
 *  forbids hand-editing it; PROJECT.md must only ever be regenerated from it). Compares
 *  state.json's revision and mtime against the stamp `writeRenderStamp()` records every
 *  render(): bytes that moved while the revision did NOT are evidence something wrote to it
 *  outside the engine's subcommands (see the comment in the body). BOTH SIDES OF THAT
 *  COMPARISON COME FROM THE STORE — the stamp that `render.mjs` writes it with and the mtime it
 *  stamps — because a reader on a raw path beside a writer on the store is a verb whose result
 *  depends on which store it was handed. Pure read — never modifies state.json or PROJECT.md
 *  itself. */
export function verifyState() {
  if (!isInitialized()) { die("conductor: not initialized (.conductor/state.json missing) — run /pm:init\n"); }
  // BOTH READS GO THROUGH THE STORE, and they are the same two lines `render.mjs:382`/`:387` write
  // them with. They used to be raw — `readJSON(renderStampPath(), null)` and
  // `fs.statSync(statePath()).mtimeMs` — which left the WRITER behind the seam and the READER in
  // front of it: a memory-store render wrote the stamp, `store.exists("render-stamp.json")` was
  // true, and `verify-state` still answered "no render stamp found" because it was reading a path
  // the store had never written. `store.mtimeMs()` answers `null`/`0` where a store has no path, so
  // the comparison below degrades to "nothing has moved" for a store that keeps no mtimes, which is
  // the honest reading rather than a claim about a file that does not exist.
  const stampRead = storeOps().read(ARTIFACT.RENDER_STAMP);
  let stamp = null;
  if (stampRead.kind === "ok") { try { stamp = JSON.parse(stampRead.text); } catch { stamp = null; } }
  const hasRevision = !!stamp && Number.isInteger(stamp.stateRevision);
  if (!stamp || (!hasRevision && typeof stamp.stateMtimeMs !== "number")) {
    die(
      "conductor: no render stamp found (.conductor/render-stamp.json) — state.json has never " +
      "been rendered, so an accidental hand-edit can't be ruled out. Run `/pm:status` to render " +
      "and establish a baseline.\n"
    );
  }
  const handEdit =
    "conductor: state.json was modified AFTER the last render — this looks like an " +
    "undetected hand-edit (CLAUDE.md forbids hand-editing state.json/PROJECT.md; the state " +
    "of record must go through the engine's subcommands). Run `/pm:status` to re-render, " +
    "review the diff, and reconcile before trusting PROJECT.md again.\n";
  // THE BASELINE IS THE ENGINE'S LAST KNOWN WRITE, and the stamp records two of them (code review
  // 0.43.0, C2, and its branch review): the render (`stateRevision`/`stateMtimeMs`) and, since
  // saveState() began stamping it, the last engine SAVE (`lastSave: {revision, mtimeMs}`) — the
  // write a verb that saves WITHOUT rendering (`set-activity-log`, a claim) makes. Comparing mtime
  // to the render alone called every such save a hand-edit; trusting any revision ahead of the
  // render instead made a hand-edit after one invisible. So, against the later of the two:
  //   revision BEHIND it       → rewound or hand-edited (the engine only advances it)      exit 1
  //   revision AHEAD of it     → a revision no engine save recorded: cannot rule out one    exit 1
  //   same revision, newer mtime → bytes changed with no engine save: a hand-edit          exit 1
  //   same revision, same mtime  → clean; "PROJECT.md may be stale" if saves followed the render.
  // What this cannot see, and commands/verify-state.md says so: a hand-edit followed by an engine
  // save (the save re-baselines over it), and one within the filesystem's mtime resolution of a save.
  // A stamp written before `stateRevision` existed has only the mtime, and keeps the old check.
  // At an EQUAL revision the render is the later observation of the same bytes (a save always
  // advances the revision, so a render at the saved revision came after it), and its mtime is the one
  // to trust — a copy that preserved timestamps imprecisely is re-observed by its render.
  const currentMtimeMs = storeOps().mtimeMs(ARTIFACT.RECORD);
  if (hasRevision) {
    const current = storeOps().recordIdentity();
    const saved = stamp.lastSave && Number.isInteger(stamp.lastSave.revision) &&
      stamp.lastSave.revision > stamp.stateRevision ? stamp.lastSave : null;
    const base = saved ? saved : { revision: stamp.stateRevision, mtimeMs: stamp.stateMtimeMs };
    if (Number.isInteger(current) && current < base.revision) {
      die(
        `conductor: state.json's revision went backwards since the engine last wrote it (last written at ` +
        `revision ${escapeControls(String(base.revision))}, now ${escapeControls(String(current))}) — the file was rewound or hand-edited; ` +
        "the engine only ever advances it. Run `/pm:status` to re-render, review the diff, and " +
        "reconcile before trusting PROJECT.md again.\n"
      );
    }
    if (Number.isInteger(current) && current > base.revision) {
      die(
        `conductor: state.json is at revision ${escapeControls(String(current))}, past the last engine write this ` +
        `stamp recorded (revision ${escapeControls(String(base.revision))}) — cannot rule out a hand-edit (or a save by ` +
        "a pm older than this check). Review the diff of state.json, then run `/pm:status` to re-render " +
        "and re-baseline.\n"
      );
    }
    if (typeof base.mtimeMs === "number" && currentMtimeMs > base.mtimeMs) die(handEdit);
    if (saved && saved.revision > stamp.stateRevision) {
      errStream().write(
        `conductor: state.json has ${escapeControls(String(saved.revision - stamp.stateRevision))} engine write(s) since the last ` +
        "render — no hand-edit detected, but PROJECT.md may be stale. Run `/pm:status` to re-render.\n"
      );
      return;
    }
  } else if (currentMtimeMs > stamp.stateMtimeMs) {
    die(handEdit);
  }
  errStream().write("conductor: state.json matches the last render — no hand-edit detected.\n");
}
