// scripts/lib/migrations.mjs
// APPEND-ONLY schema migrations, keyed by the release that introduced each change, and
// the /pm:upgrade verb that applies them. One-directional dependencies only.

import { isInitialized, loadState, saveState } from "./state.mjs";
import { pluginVersion, newestInstalledVersion, cmpVer, changelogBetween, stampVersion } from "./plugin-meta.mjs";
import { reconcileArchived } from "./epic-progress.mjs";
import { writeRules } from "./rules.mjs";
import { render } from "./render.mjs";
import { normalizeLink } from "./links.mjs";

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
];

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
  writeRules();
  render();
  process.stderr.write(`conductor: upgraded (${applied} migration(s)), pmVersion now ${state.pmVersion || "unknown"}\n`);

  // Surface WHAT the upgrade brought, not just that it happened — close the
  // post-upgrade blindspot. Print the CHANGELOG delta for (stamped, running].
  const delta = changelogBetween(stamped, state.pmVersion || null);
  if (delta && delta.length) {
    process.stdout.write(
      `What's new in pm (since ${stamped}):\n\n` + delta.map(s => s.body).join("\n\n") + "\n");
  }
}
