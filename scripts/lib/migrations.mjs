// scripts/lib/migrations.mjs
// APPEND-ONLY schema migrations, keyed by the release that introduced each change, and
// the /pm:upgrade verb that applies them. One-directional dependencies only.

import { isInitialized, loadState, saveState } from "./state.mjs";
import { pluginVersion, newestInstalledVersion, cmpVer, changelogBetween, stampVersion } from "./plugin-meta.mjs";
import { reconcileArchived } from "./epic-progress.mjs";
import { writeRules } from "./rules.mjs";
import { render } from "./render.mjs";
import { normalizeLink } from "./links.mjs";
import { engineStamp } from "./disposition.mjs";
import { resolvePlatform } from "./platform.mjs";
import { ensureGitignore } from "./subcommands.mjs";
import { openspecCurrencyLines } from "./tool-currency.mjs";

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
  const stamped = state.pmVersion || "0.0.0";
  let applied = 0;
  // Apply in ascending release order (independent of array authoring order) so a
  // repo several versions behind runs every missed migration in the correct sequence.
  const ordered = [...MIGRATIONS].sort((a, b) => cmpVer(a.release, b.release));
  for (const m of ordered) {
    if (cmpVer(m.release, stamped) > 0) { m.apply(state); applied++; }
  }
  reconcileArchived(state);
  stampVersion(state);
  saveState(state);
  writeRules(resolvePlatform({}, state));
  render();
  ensureGitignore();
  process.stderr.write(`conductor: upgraded (${applied} migration(s)), pmVersion now ${state.pmVersion || "unknown"}\n`);

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
}
