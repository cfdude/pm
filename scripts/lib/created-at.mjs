// scripts/lib/created-at.mjs
// Recover an epic's REGISTRATION DATE from this repository's own git history, for the epics that
// predate the field. A verb, deliberately, and not a MIGRATIONS body.
//
// WHY A VERB. migrations.mjs:44-48 states the law this would otherwise break: "a migration that
// consulted disk would produce a different result on a machine whose checkout is at a different
// commit, which is not a property a one-shot, never-replayed transformation may have." That is a
// SECOND law, distinct from the network law, and the instance is on this machine —
// ~/Servers/market-intelligence (detached, 158 commits touching state.json) and its -dev sibling
// (160) are two checkouts of one remote, so `git log -S` returns a date in one and nothing in the
// other for the same epic id. Inside MIGRATIONS the poorer checkout would freeze absence forever,
// keyed to a pmVersion it never replays. As a verb, the 0.40.0 entry invokes it once and the
// checkout that later catches up can simply run it again.
//
// Absence is therefore a FIRST-CLASS ANSWER here and never an error: no git, an untracked state
// file, a shallow clone, an id older than the tracked history all mean the same thing — nobody
// recorded when this was registered, and a fabricated date would be worse than the silence.
//
// Local only, per the engine's architectural law. Every invocation is `execFileSync` with an argv
// array, never a shell string, for the reason git.mjs:141-142 gives: these values come out of a
// state file, and an epic id read from one may predate the `^[a-z0-9][a-z0-9._-]*$` validation
// add-epic.mjs applies today.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { ROOT } from "./constants.mjs";
import { isInitialized, loadState, saveState } from "./state.mjs";
import { reportSave, STATE_UNCHANGED } from "./save-report.mjs";
import { render } from "./render.mjs";
import { die } from "./command-exit.mjs";

/** The state file as a git PATHSPEC — CWD-relative, for the reason differsFromHead()'s is: git
 *  walks UP to find a repository, so a pm-managed project nested inside a larger repo has to be
 *  described in its own terms rather than by an absolute path into someone else's tree. */
const STATE_PATHSPEC = ".conductor/state.json";

/** The literal text an epic's id occupies in the state file, which is what makes the pickaxe
 *  precise. `JSON.stringify(state, null, 2)` writes `"id": "<id>"`, and no other key spells a
 *  record's own identifier that way — a link's target is `"epic":`, a child's parent is
 *  `"parent":`. Searching for the bare id would match a title or a link and date the epic from a
 *  commit that merely mentioned it. */
function idNeedle(epicId) {
  return `"id": "${epicId}"`;
}

/** The commits this checkout's history is GRAFTED at, or an empty set when it is not shallow.
 *
 *  A shallow clone's boundary commit has had its parents cut away, so git diffs it against nothing
 *  and reports EVERY line of every file as added there. The pickaxe therefore names that commit as
 *  introducing every epic id in the state file, which would hand each of them the same wrong date
 *  and record it as fact. At a graft point "introduced here" and "already existed and we cannot
 *  see when" are genuinely indistinguishable, so the honest answer is the absent one — and, because
 *  this is a re-runnable verb rather than a one-shot migration, `git fetch --unshallow` followed by
 *  a second run recovers the real dates.
 *
 *  Read from git's own `shallow` file rather than inferred from a parentless commit: a repository's
 *  true root commit is also parentless and is a perfectly good introduction. */
function shallowBoundaries() {
  try {
    const isShallow = execFileSync("git", ["rev-parse", "--is-shallow-repository"],
      { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (isShallow !== "true") return new Set();
    const p = execFileSync("git", ["rev-parse", "--git-path", "shallow"],
      { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    // RESOLVED AGAINST ROOT, not left to process.cwd(). `--git-path` answers relative to the
    // directory git ran in, which is ROOT — and readFileSync would resolve it against the
    // PROCESS's cwd instead. Those are the same directory in the common case and diverge for a
    // pm-managed project nested inside a larger repository, which is the layout differsFromHead()
    // carries the same warning for. The catch below would swallow that as an empty set, so the
    // guard would go silently inert in exactly the checkout shape it exists for.
    const body = fs.readFileSync(path.resolve(ROOT, p), "utf8");
    return new Set(body.split("\n").map(l => l.trim()).filter(Boolean));
  } catch { return new Set(); }
}

/** When `epicId` FIRST appeared in the tracked state file, as an ISO-8601 committer date, or
 *  `null` when this checkout holds no evidence.
 *
 *  `-S` is git's pickaxe over a FIXED string (not `-G`, which is a regex), so an id containing
 *  characters a regex would read specially is still matched literally. `--reverse` and then the
 *  FIRST line, rather than `-n 1`: git applies `-n` before reversing, so `-n 1 --reverse` returns
 *  the NEWEST commit — the opposite of the one being asked for.
 *
 *  No `--all`. HEAD-only traversal is exactly what produces the per-checkout variation this verb
 *  exists to be re-runnable against: a checkout that cannot see the introducing commit must
 *  answer `null` today and recover it after it fetches, rather than reaching into refs its user
 *  has not merged.
 *
 *  `%cI` (committer date) matches commitDate()'s reasoning in git.mjs: a rebased or cherry-picked
 *  commit keeps an author date from before the rebase, and what is being recorded is when the
 *  registration as it stands came into existence.
 *
 *  Local only — this reads the object database and contacts nothing. */
export function introducedAt(epicId, grafted = shallowBoundaries()) {
  if (typeof epicId !== "string" || !epicId) return null;
  try {
    const out = execFileSync(
      "git", ["log", `-S${idNeedle(epicId)}`, "--reverse", "--format=%H %cI", "--", STATE_PATHSPEC],
      { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const first = out.split("\n").map(l => l.trim()).filter(Boolean)[0];
    if (!first) return null;
    const [sha, date] = first.split(" ");
    if (grafted.has(sha)) return null;
    return date || null;
  } catch {
    // No git, no repository, no commits yet. Every one of those is "no evidence", which is the
    // same answer as "the history does not reach it" and calls for the same response.
    return null;
  }
}

/** Fill in every ABSENT `createdAt` this checkout can evidence, mutating `state` in place.
 *
 *  Idempotent by construction: an epic that already carries the key is skipped, so a second run
 *  cannot move a date and a checkout that fetches more history simply recovers more. Absence is
 *  left ABSENT rather than written as `null` — a reader asks whether the key is there, and a
 *  stored null would be a recorded claim that the date is unknowable rather than merely unknown,
 *  which is the freeze this verb exists to avoid.
 *
 *  Returns `{ missing, recovered, unrecoverable }` so the caller can report honestly instead of
 *  announcing a sweep whose result it did not measure. */
export function recoverCreatedAtDates(state) {
  const epics = Array.isArray(state.epics) ? state.epics : [];
  // Probed ONCE for the sweep, not once per epic: it is a property of the checkout, and this runs
  // over an archive of a couple of hundred records at ~85ms each already.
  const grafted = shallowBoundaries();
  let missing = 0, recovered = 0;
  for (const e of epics) {
    if (!e || typeof e !== "object") continue;
    if (Object.prototype.hasOwnProperty.call(e, "createdAt")) continue;
    missing++;
    const at = introducedAt(e.id, grafted);
    if (at) { e.createdAt = at; recovered++; }
  }
  return { missing, recovered, unrecoverable: missing - recovered };
}

/** The `recover-created-at` subcommand.
 *
 *  It REPAIRS NOTHING ELSE. The repositories this runs against are already wrong in other ways —
 *  six on this machine carry epics in `status: "done"`, a value KNOWN_STATUSES does not contain —
 *  and every one of those is a judgment about what happened to the work. This transforms a
 *  malformed record exactly as it transforms a well-formed one and leaves the judgment alone. */
export function recoverCreatedAt() {
  if (!isInitialized()) { die("conductor: run /pm:init first\n"); }
  const state = loadState();
  const { missing, recovered, unrecoverable } = recoverCreatedAtDates(state);
  // The save is guarded on nothing: with no recovery the state is identical to disk and
  // saveState's own no-op path returns without writing, so an unproductive run leaves
  // state.json byte-identical without this function having to know that.
  const saved = saveState(state, { verb: "recover-created-at" });
  render();
  // ONE summary shape for both outcomes, and the no-op only APPENDS to it. The counts are the
  // verb's proof that it ran to completion at all — conductor-39 requires them before every
  // absence assertion it makes, because an absence assertion passes just as happily against a
  // subcommand that does not exist. A no-op line that dropped them would have turned that guard
  // off, which is a strictly worse trade than the honesty it was buying.
  const summary = `conductor: recover-created-at: ${recovered} recovered, ${unrecoverable} ` +
    `unrecoverable (${missing} epic(s) had no registration date)`;
  reportSave(saved, {
    changed: summary,
    // The honest reading of a no-op here: either every epic already carried a date, or none of
    // the missing ones was recoverable from this checkout's history. Both leave the file alone,
    // and a re-run after `git fetch --unshallow` is exactly what the spec keeps available.
    unchanged: `${summary} — ${STATE_UNCHANGED}`,
  });
  if (unrecoverable) {
    process.stderr.write(
      "   Unrecoverable means UNKNOWN, not unknowable: no commit in THIS checkout introduces " +
      "those ids into .conductor/state.json. Re-run after fetching more history.\n");
  }
}
