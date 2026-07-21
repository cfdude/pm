// scripts/lib/changelog.mjs
// The /pm:changelog CLI verb -- an on-demand companion to the delta upgrade() prints
// automatically. One-directional dependencies only.

import { changelogBetween } from "./plugin-meta.mjs";
import { isInitialized, loadState } from "./state.mjs";
import { parseFlags } from "./add-epic.mjs";

/** Show CHANGELOG entries newer than a version. `--since <x.y.z>` overrides the
 *  default, which is the version stamped in this repo's state.json. */
export function changelog() {
  const f = parseFlags(process.argv.slice(3));
  const since = typeof f.since === "string"
    ? f.since
    : (isInitialized() ? (loadState().pmVersion || null) : null);
  const secs = changelogBetween(since, null);
  if (secs === null) {
    process.stdout.write("conductor: no CHANGELOG.md ships with this pm version\n"); return;
  }
  if (!secs.length) {
    process.stdout.write(`conductor: no changelog entries newer than ${since || "(start)"}\n`); return;
  }
  process.stdout.write(secs.map(s => s.body).join("\n\n") + "\n");
}
