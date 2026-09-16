// scripts/lib/migrations.mjs
// APPEND-ONLY schema migrations, keyed by the release that introduced each change, and
// the /pm:upgrade verb that applies them. One-directional dependencies only.

import path from "node:path";
import { isInitialized, loadState, saveState } from "./state.mjs";
import { reportSave, STATE_UNCHANGED } from "./save-report.mjs";
import { pluginVersion, newestInstalledVersion, cmpVer, changelogBetween, stampVersion } from "./plugin-meta.mjs";
import { reconcileArchived } from "./epic-progress.mjs";
import { assertRulesBlockWritable, writeRules } from "./rules.mjs";
import { render } from "./render.mjs";
import { normalizeLink, stampReconcileKeys } from "./links.mjs";
import { ARCHIVE_BACKFILL, engineStamp, stampedBy } from "./disposition.mjs";
import { resolvePlatform } from "./platform.mjs";
import { ensureGitignore } from "./subcommands.mjs";
import { openspecCurrencyLines } from "./tool-currency.mjs";
import { differsFromHead } from "./git.mjs";
import { recoverCreatedAtDates } from "./created-at.mjs";

// MIGRATIONS — APPEND-ONLY, each keyed by the release that introduced the change.
// NEVER remove or reorder a shipped entry: a repo many versions behind replays every
// entry whose release > its stamped version. upgrade() applies them SORTED by release,
// so a multi-version jump (e.g. 0.2.0 → 0.5.x) runs them in the correct order regardless
// of array position. Each apply() must be additive, idempotent, and backward-compatible.
const MIGRATIONS = [
  {
    release: "0.3.0",
    note: "stamp explicit lane on epics (lane-agnostic schema)",
    apply(state) {
      for (const e of state.epics) if (!e.lane) e.lane = "openspec";
    },
  },
  {
    release: "0.5.0",
    note: "normalize links (repair colon-strings, drop unrecoverable)",
    apply(state) {
      for (const e of state.epics) {
        e.links = (Array.isArray(e.links) ? e.links : []).map(normalizeLink).filter(Boolean);
      }
    },
  },
  {
    release: "0.24.0",
    note: "stamp the active host platform (claude-code for every pre-existing repo)",
    apply(state) {
      if (!state.platform) state.platform = "claude-code";
    },
  },
  // 0.27.0 — the conductor-tells-the-truth release. Two stamps, one entry: the direction each
  // existing tracker ALREADY behaves with, and a terminal outcome on every archived epic.
  // Both are additive, both are guarded on the field being ABSENT, and neither reads anything
  // outside `state` — a migration that consulted disk would produce a different result on a
  // machine whose checkout is at a different commit, which is not a property a one-shot,
  // never-replayed transformation may have.
  {
    release: "0.27.0",
    note: "stamp tracker direction and every archived epic's terminal outcome",
    apply(state) {
      stampTrackerDirection(state);
      stampArchivedOutcomes(state);
    },
  },
  // 0.32.0 — #133. Registration provenance moves OFF the disposition and ONTO the epic. Every
  // repo written before this carries `archive-backfill` only on the disposition record, and the
  // reader now asks the epic — so the fact has to be lifted or those epics stop being
  // recognized as backfilled the moment they are read. A TRANSFORM of existing data, which is
  // why this is a migration and not merely an added optional field.
  {
    release: "0.32.0",
    note: "lift archive-backfill registration provenance from the disposition onto the epic",
    apply(state) {
      liftBackfillProvenance(state);
    },
  },
  // 0.40.0 — every epic gains a registration date, and the ones that predate the field get theirs
  // back from this checkout's own history.
  //
  // IT DELEGATES, and the delegation is the point. The rule stated at the 0.27.0 entry above
  // forbids a migration from reading disk, because a one-shot, never-replayed transformation may
  // not produce a different result on a machine whose checkout sits at a different commit — and
  // reading history does exactly that. Two checkouts of one remote on this machine differ by two
  // commits touching state.json, so the poorer one would freeze absence permanently, keyed to a
  // pmVersion it never replays again.
  //
  // So the recovery is a VERB (lib/created-at.mjs) that this entry invokes once. The migration
  // stays a one-shot; the recovery stays re-runnable; a checkout that later fetches more history
  // recovers what this pass could not. Nothing else here changes: `createdAt` on epics registered
  // from now on is stamped by pushEpic(), and `touchedAt` is deliberately left ABSENT on every
  // pre-existing epic — saveState() excludes both timekeeping fields from its per-record
  // comparison, so this sweep is a recovery rather than a fleet-wide touch on upgrade day.
  {
    release: "0.40.0",
    note: "recover epic registration dates from local history (delegates to the re-runnable verb)",
    apply(state) {
      recoverCreatedAtDates(state);
    },
  },
  {
    release: "0.44.0",
    note: "give every may-invalidate link an explicit reconcileOnResume arming record",
    // gates-bind-to-verified-evidence Decision 3. Additive (a key only where none exists), idempotent
    // (a keyed link is never touched) and reads only `state`. The SAME function runs again on every
    // upgrade below; this entry is what the version bump carries.
    apply(state) { stampReconcileKeys(state); },
  },
];

/** 0.27.0 — record the direction each existing tracker ALREADY behaves with.
 *
 *  PRESERVATION, not policy. `github-issues` was inward-only; every other primary received the
 *  outward mirror and never an inward pull; a secondary is pull-only by definition, whatever its
 *  vendor. `both` is the tempting answer for a non-github primary and it is wrong in the
 *  direction that costs something — verified rather than assumed: a jira tracker receives ONLY
 *  the outward section today (rules.mjs), and the sole inward-pull section is gated on the
 *  vendor plus a scope. Stamping `both` would grant an inward pull no repo has ever had, and
 *  `/pm:sync` would start registering an untriaged epic per open issue in a project nobody asked
 *  the conductor to mirror.
 *
 *  Guarded on an ABSENT direction at every site, so configuration outranks inference and a
 *  second run is a no-op. The values mirror `directionOf()`'s fallback deliberately: the
 *  fallback is what an UN-upgraded repo resolves to, and a migration that stamped anything else
 *  would make `/pm:upgrade` — which lags a plugin update by design — a behavior change. */
function stampTrackerDirection(state) {
  const t = state.tracker;
  if (t && t.system && !t.direction) {
    t.direction = t.system === "github-issues" ? "inward" : "outward";
  }
  for (const s of Array.isArray(state.secondaryTrackers) ? state.secondaryTrackers : []) {
    if (s && s.system && !s.direction) s.direction = "inward";
  }
}

/** 0.27.0 — give every ARCHIVED epic a terminal outcome, regardless of lane.
 *
 *  LANE-SCOPING THIS IS WRONG ON MEASURED DATA. Of this repository's 69 archived epics only 3
 *  are openspec-lane (measured 2026-08-23), so stamping one lane would leave 66 archived epics
 *  with no outcome at all — and the outcome invariant ("no write that leaves an epic archived
 *  may leave it without an outcome") would fail on pm's own repository the instant the
 *  migration ran.
 *
 *  `delivered` ONLY where a passing Gate 2 exists — the one durable piece of evidence in the
 *  record that a review actually happened. Everywhere else `unknown`, which is not a hedge but
 *  the true statement about those epics: nobody recorded a disposition. No non-openspec lane has
 *  a Gate 2 to have passed, so `delivered` there would assert something unverified.
 *
 *  `recordedBy: "migration"` keeps this stamp distinguishable from the heal's and the backfill's,
 *  because every rule that exempts or replaces a stamp keys on WHICH path wrote it.
 *
 *  `recordedAt` prefers the epic's own `completedAt`: the migration clock says when this code
 *  ran, which is not when the work ended.
 *
 *  Never overwrites an existing disposition. An agent's judgment outranks a stamp nobody chose,
 *  and re-stamping would break idempotence besides. Note the rule binds THE MIGRATION and not
 *  the repo: the interactive archive verb still replaces a `recordedBy: "migration"` stamp, or
 *  every epic this touches would be frozen at `unknown` forever. */
function stampArchivedOutcomes(state) {
  const at = new Date().toISOString();
  for (const e of state.epics) {
    if (e.status !== "archived" || e.disposition) continue;
    const gate2 = e.gateReview && e.gateReview.gate2;
    const outcome = gate2 && gate2.verdict === "pass" ? "delivered" : "unknown";
    e.disposition = engineStamp("migration", { outcome, recordedAt: e.completedAt || at });
  }
}

/** 0.32.0 — #133. Move `archive-backfill` registration provenance from the DISPOSITION record
 *  onto the EPIC, where a later disposition write cannot destroy it.
 *
 *  The defect it repairs: `isArchiveBackfilled()` asked the disposition who registered the
 *  epic, and the interactive archive verb REPLACES the disposition wholesale with an agent's
 *  own — which by design carries no `recordedBy`. So an agent doing exactly the right thing
 *  (recording an honest `abandoned` on a change that was abandoned) silently un-backfilled the
 *  epic and reverted its archived task counts to `—`. Recording the truth destroyed the
 *  evidence, and the better an agent behaved the worse the record got.
 *
 *  Scoped to the BACKFILL's own token and no other. `add-epic`, `add-many` and `migration` are
 *  creation/stamping paths too, but nothing exempts anything on them — every backfill exemption
 *  in the engine keys on this one token, and lifting the others would invent a field value with
 *  no rule attached, which is the silent hole ENGINE_STAMP_TOKENS' closed set exists to prevent.
 *
 *  Guarded on an ABSENT `registeredBy`, so it is idempotent and a repo that has already been
 *  lifted (or an epic the backfill registered under 0.32.0+) is untouched. Reads only `state`:
 *  a migration that consulted disk would produce a different result on a machine whose checkout
 *  sits at a different commit.
 *
 *  It cannot recover an epic whose disposition was ALREADY overwritten before this shipped —
 *  nothing in `state` still holds that fact. Such an epic keeps rendering `—`, exactly as it
 *  does today; re-running `sync` will not re-register it either, because the row still exists.
 *  That is the bug's residue, not a new one, and it is bounded: the counts are on disk and a
 *  reader can still open the archived `tasks.md`. */
function liftBackfillProvenance(state) {
  for (const e of state.epics) {
    // Asked through stampedBy(), never by reading the field: a direct `.recordedBy` read is
    // how a second definition of "engine-stamped" starts, and the suite's source scan fails one.
    if (e.registeredBy) continue;
    if (stampedBy(e, ARCHIVE_BACKFILL)) e.registeredBy = ARCHIVE_BACKFILL;
  }
}

export function upgrade() {
  if (!isInitialized()) { process.stderr.write("conductor: run /pm:init first\n"); process.exit(1); }
  const running = pluginVersion();
  const newest = newestInstalledVersion();
  if (running && newest && cmpVer(newest, running) > 0) {
    process.stderr.write(
      `conductor: this is pm ${running}, but ${newest} is installed — your session is still ` +
      `running the old engine.\n` +
      `Run /reload-plugins (or restart Claude Code), then /pm:upgrade again.\n` +
      `(Running the engine directly from a checkout? Set PM_CACHE_ROOT to override.)\n`);
    process.exit(1);
  }
  const state = loadState();
  // BEFORE the first write. upgrade stamps pmVersion — what the fleet procedure reads as "this repo
  // is done" — and then renders and back-fills .gitignore AFTER the block write, so a late refusal
  // would leave a repository reading as upgraded forever with a stale block, a stale PROJECT.md and
  // no lock gitignore line (managed-rules-block).
  assertRulesBlockWritable(resolvePlatform({}, state));
  const stamped = state.pmVersion || "0.0.0";
  let applied = 0;
  // Apply in ascending release order (independent of array authoring order) so a
  // repo several versions behind runs every missed migration in the correct sequence.
  const ordered = [...MIGRATIONS].sort((a, b) => cmpVer(a.release, b.release));
  for (const m of ordered) {
    if (cmpVer(m.release, stamped) > 0) { m.apply(state); applied++; }
  }
  // EVERY non-refused run, not only the 0.44.0 bump: MIGRATIONS apply only when release > pmVersion,
  // and a keyless may-invalidate link can be written AFTER the stamp (an unreloaded older session, a
  // second machine sharing state.json). The refusal that names /pm:upgrade must never name a no-op.
  // Immediately before the heal, so the heal reads every link keyed.
  stampReconcileKeys(state);
  reconcileArchived(state);
  stampVersion(state);
  const saved = saveState(state);
  const rulesFile = path.basename(writeRules(resolvePlatform({}, state)));
  render();
  ensureGitignore();
  // STILL "upgraded", and still exit zero: state-write-guard's own re-run scenario ends "and the
  // save reports success", and `upgrade` is the byte-idempotent verb that scenario is written
  // about. What changes is the claim about the FILE — a second run rewrote nothing, and the
  // rules block and PROJECT.md were re-rendered regardless.
  reportSave(saved, {
    changed: `conductor: upgraded (${applied} migration(s)), pmVersion now ${state.pmVersion || "unknown"}`,
    unchanged: `conductor: upgraded (${applied} migration(s)), pmVersion now ` +
      `${state.pmVersion || "unknown"} — ${STATE_UNCHANGED} ` +
      "(the rules block and PROJECT.md were re-rendered)",
  });

  // Surface WHAT the upgrade brought, not just that it happened — close the
  // post-upgrade blindspot. Print the CHANGELOG delta for (stamped, running].
  const delta = changelogBetween(stamped, state.pmVersion || null);
  if (delta && delta.length) {
    process.stdout.write(
      `What's new in pm (since ${stamped}):\n\n` + delta.map(s => s.body).join("\n\n") + "\n");
  }

  // gh#128 — "is this repo current with pm?" is the question this verb exists to answer, and it
  // is exactly the question nothing asks about the OpenSpec CLI. Same emitter as the brief, so
  // the two surfaces cannot report the same drift differently. NOT a MIGRATIONS entry: nothing
  // in `state.json` changes and there is nothing to transform — this is a READ of the working
  // tree, reported. A migration that consulted disk would produce different results on machines
  // whose checkouts sit at different commits, which is the one property a one-shot,
  // never-replayed transformation may not have.
  const openspecLines = openspecCurrencyLines();
  for (const l of openspecLines) process.stderr.write(l + "\n");

  // COMMIT WHAT THIS JUST REWROTE. Every path below is one THIS function wrote a moment ago:
  // state.json (migrations + the version stamp), the platform's rules file (NOT always
  // CLAUDE.md — Hermes/Codex resolve AGENTS.md or HERMES.md, so the name comes from
  // writeRules()'s return, never a literal), PROJECT.md and the render stamp (both via
  // render()), and .gitignore (ensureGitignore's back-fill).
  //
  // Nine repositories on one machine had run this and never committed the result — see
  // differsFromHead()'s note for the measurements. The failure is silent by construction: the
  // session reads the rewritten files off disk, so nothing looks broken, and git quietly records
  // a version the code is no longer at. `/pm:upgrade` said nothing about committing any of it.
  //
  // The probe decides BOTH suppressions on its own: an idempotent re-run changes no content and
  // prints nothing, and a path this repo git-ignores never appears, so a repo that ignores the
  // file is never told to commit something git would refuse. Nothing here is a second list of
  // what the verb writes — it IS the verb's own writes, named at the point they happen.
  const rewritten = differsFromHead(
    [".conductor/state.json", rulesFile, "PROJECT.md", ".conductor/render-stamp.json", ".gitignore"]);
  if (rewritten.length) {
    process.stderr.write(
      `conductor: \u26a0 COMMIT THIS UPGRADE — it rewrote ${rewritten.length} tracked ` +
      `file${rewritten.length === 1 ? "" : "s"} and git still records the old ones.\n` +
      `   git add ${rewritten.join(" ")}\n` +
      `   git commit -m "chore(pm): upgrade conductor to ${state.pmVersion || "unknown"}"\n` +
      "   Left uncommitted, git says this repo is on the OLD version while every session reads " +
      "the new rules off disk — nothing anywhere detects that.\n");
  }
}
