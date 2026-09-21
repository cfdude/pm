// scripts/lib/changelog.mjs
// The /pm:changelog CLI verb -- an on-demand companion to the delta upgrade() prints
// automatically. One-directional dependencies only.

import { changelogBetween } from "./plugin-meta.mjs";
import { isInitialized, loadState } from "./state.mjs";
import { parseFlags, requireFlagValues } from "./add-epic.mjs";
import { escapeControls } from "./constants.mjs";
import { currentArgv, outStream } from "./invocation.mjs";

/** Show CHANGELOG entries newer than a version. `--since <x.y.z>` overrides the
 *  default, which is the version stamped in this repo's state.json. */
export function changelog() {
  const f = parseFlags(currentArgv().slice(3));
  requireFlagValues("changelog", f);
  const since = typeof f.since === "string"
    ? f.since
    : (isInitialized() ? (loadState().pmVersion || null) : null);
  const secs = changelogBetween(since, null);
  if (secs === null) {
    outStream().write("conductor: no CHANGELOG.md ships with this pm version\n"); return;
  }
  if (!secs.length) {
    outStream().write(`conductor: no changelog entries newer than ${since ? escapeControls(since) : "(start)"}\n`); return;
  }
  outStream().write(secs.map(s => s.body).join("\n\n") + "\n");
}
