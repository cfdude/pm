// scripts/lib/worktree-hygiene.mjs
// Cross-references git worktree list against epic status to flag orphaned
// hierarchy-child worktrees; lists .changesets/*.md fragments; verifies state.json
// hasn't been hand-edited outside the render pipeline. One-directional dependencies only.

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { isInitialized, loadState, readJSON } from "./state.mjs";
import { ROOT, RENDER_STAMP_PATH, STATE_PATH } from "./constants.mjs";

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
 *  personal discipline/CLAUDE.md. Zero-dependency: shells out to `git worktree list
 *  --porcelain` and `git merge-base --is-ancestor` only; gracefully returns no orphans if
 *  listing worktrees fails (e.g. this isn't a git repo at all). */
export function verifyWorktrees() {
  if (!isInitialized()) { process.stderr.write("conductor: run /pm:init first\n"); process.exit(1); }
  const state = loadState();
  const byId = new Map(state.epics.map(e => [e.id, e]));
  let out;
  try {
    out = execSync("git worktree list --porcelain", { cwd: ROOT, encoding: "utf8" });
  } catch {
    process.stdout.write(JSON.stringify({ orphaned: [] }) + "\n");
    return;
  }
  const orphaned = [];
  let currentPath = null;
  let currentHead = null;
  for (const line of out.split("\n")) {
    if (line.startsWith("worktree ")) { currentPath = line.slice("worktree ".length).trim(); currentHead = null; continue; }
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
  process.stdout.write(JSON.stringify({ orphaned }) + "\n");
}

/** True if `sha` is an ancestor of the current branch's HEAD (i.e. already merged in) —
 *  used by `verifyWorktrees()`'s `branch-merged` trigger. Returns false (never throws) if
 *  the check itself fails for any reason (detached/missing ref, shallow clone, etc.) so a
 *  git-plumbing hiccup degrades to "not flagged" rather than crashing verify-worktrees. */
export function isAncestorOfCurrentHead(sha) {
  try {
    execSync(`git merge-base --is-ancestor ${sha} HEAD`, { cwd: ROOT, stdio: "ignore" });
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
  if (!isInitialized()) { process.stderr.write("conductor: run /pm:init first\n"); process.exit(1); }
  const dir = path.join(ROOT, ".changesets");
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    process.stdout.write(JSON.stringify({ changesets: [] }) + "\n");
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
  process.stdout.write(JSON.stringify({ changesets: out }) + "\n");
}

/** `verify-state` — mechanically catches an undetected hand-edit of state.json (CLAUDE.md
 *  forbids hand-editing it; PROJECT.md must only ever be regenerated from it). Compares
 *  state.json's filesystem mtime against the stamp `writeRenderStamp()` records every
 *  render(): if state.json was modified AFTER the last recorded render, that mtime delta
 *  is evidence something wrote to it outside `/pm:status`/the engine's subcommands. Pure
 *  read — never modifies state.json or PROJECT.md itself. */
export function verifyState() {
  if (!isInitialized()) { process.stderr.write("conductor: not initialized (.conductor/state.json missing) — run /pm:init\n"); process.exit(1); }
  const stamp = readJSON(RENDER_STAMP_PATH, null);
  if (!stamp || typeof stamp.stateMtimeMs !== "number") {
    process.stderr.write(
      "conductor: no render stamp found (.conductor/render-stamp.json) — state.json has never " +
      "been rendered, so an accidental hand-edit can't be ruled out. Run `/pm:status` to render " +
      "and establish a baseline.\n"
    );
    process.exit(1);
  }
  const currentMtimeMs = fs.statSync(STATE_PATH).mtimeMs;
  if (currentMtimeMs > stamp.stateMtimeMs) {
    process.stderr.write(
      "conductor: state.json was modified AFTER the last render — this looks like an " +
      "undetected hand-edit (CLAUDE.md forbids hand-editing state.json/PROJECT.md; the state " +
      "of record must go through the engine's subcommands). Run `/pm:status` to re-render, " +
      "review the diff, and reconcile before trusting PROJECT.md again.\n"
    );
    process.exit(1);
  }
  process.stderr.write("conductor: state.json matches the last render — no hand-edit detected.\n");
}
