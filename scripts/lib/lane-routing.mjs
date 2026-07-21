// scripts/lib/lane-routing.mjs
// Per-repo lane-assignment override rules (keyword/glob), checked before the generic
// lane heuristic. One-directional dependencies only.

import { isInitialized, loadState, saveState } from "./state.mjs";
import { parseFlags } from "./add-epic.mjs";
import { render } from "./render.mjs";
import { KNOWN_LANES } from "./constants.mjs";

export function laneMatchTest(match, text) {
  const hay = String(text).toLowerCase();
  if (match.includes("*")) {
    // glob-style: split on '*', escape each literal segment, join with '.*', and
    // search (not full-anchor) so "billing-*" matches inside "billing-refund-flow".
    const pattern = match.split("*").map(seg =>
      seg.toLowerCase().replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    ).join(".*");
    return new RegExp(pattern, "i").test(hay);
  }
  return hay.includes(match.toLowerCase());
}

/** `set-lane-routing --add "<match>:<lane>" [--add ...] | --remove "<match>" | --clear`
 *  Writes/edits the optional `laneRouting.overrides` list — keyword/glob rules checked
 *  BEFORE the generic lane heuristic (documented in CLAUDE.md / the conductor skill) when
 *  an agent is deciding which lane should build a new epic. Pure local state write, same
 *  shape as setTracker(): the engine never enforces this itself (it has no lane-assignment
 *  code path to intercept — add-epic always takes an explicit --lane); suggest-lane just
 *  surfaces the match so the interactive agent can act on it. */
export function setLaneRouting() {
  if (!isInitialized()) { process.stderr.write("conductor: run /pm:init first\n"); process.exit(1); }
  const f = parseFlags(process.argv.slice(3));
  const state = loadState();
  const lr = { overrides: [...((state.laneRouting || {}).overrides || [])] };

  if (f.clear) {
    lr.overrides = [];
  }
  if (Array.isArray(f.remove) || typeof f.remove === "string") {
    const removes = new Set((Array.isArray(f.remove) ? f.remove : [f.remove]).map(String));
    lr.overrides = lr.overrides.filter(o => !removes.has(o.match));
  }
  if (Array.isArray(f.add) || typeof f.add === "string") {
    const adds = Array.isArray(f.add) ? f.add : [f.add];
    for (const raw of adds) {
      if (typeof raw !== "string") continue;
      const i = raw.lastIndexOf(":");
      if (i <= 0 || i === raw.length - 1) {
        process.stderr.write(`conductor: bad --add '${raw}': expected "<match>:<lane>"\n`); process.exit(1);
      }
      const match = raw.slice(0, i).trim();
      const lane = raw.slice(i + 1).trim();
      if (!KNOWN_LANES.includes(lane)) {
        process.stderr.write(`conductor: bad --add '${raw}': lane must be one of ${KNOWN_LANES.join("|")}\n`); process.exit(1);
      }
      lr.overrides = lr.overrides.filter(o => o.match !== match);   // last --add for a match wins
      lr.overrides.push({ match, lane });
    }
  }

  state.laneRouting = lr;
  saveState(state);
  render();
  process.stderr.write(`conductor: lane routing has ${lr.overrides.length} override(s)\n`);
}

/** `suggest-lane "<free text>"` — checks the repo's `laneRouting.overrides` (in order,
 *  first match wins) against a proposed epic's title/description BEFORE the generic
 *  lane heuristic is applied. Prints `{lane, matched}` as JSON; `lane: null` means no
 *  override matched and the agent should fall back to the documented generic heuristic
 *  (>8h/cross-system -> openspec; 2-8h -> superpowers; <2h -> claude-code; etc). */
export function suggestLane() {
  if (!isInitialized()) { process.stderr.write("conductor: run /pm:init first\n"); process.exit(1); }
  const text = process.argv[3];
  if (typeof text !== "string" || !text.length) {
    process.stderr.write("usage: conductor.mjs suggest-lane \"<free text>\"\n"); process.exit(1);
  }
  const state = loadState();
  const overrides = ((state.laneRouting || {}).overrides || []);
  for (const o of overrides) {
    if (laneMatchTest(o.match, text)) {
      process.stdout.write(JSON.stringify({ lane: o.lane, matched: o.match }) + "\n");
      return;
    }
  }
  process.stdout.write(JSON.stringify({ lane: null, matched: null }) + "\n");
}
