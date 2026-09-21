// scripts/lib/lane-routing.mjs
// Per-repo lane-assignment override rules (keyword/glob), checked before the generic
// lane heuristic. One-directional dependencies only.

import { isInitialized, loadState, saveState } from "./state.mjs";
import { reportSave, STATE_UNCHANGED } from "./save-report.mjs";
import { parseFlags, requireFlagValues } from "./add-epic.mjs";
import { render } from "./render.mjs";
import { KNOWN_LANES, escapeControls, jsonText } from "./constants.mjs";
import { checkedPositionals } from "./argv-surface.mjs";
import { die } from "./command-exit.mjs";
import { currentArgv, outStream } from "./invocation.mjs";

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
  if (!isInitialized()) { die("conductor: run /pm:init first\n"); }
  const f = parseFlags(currentArgv().slice(3));
  requireFlagValues("set-lane-routing", f);
  // every-verb-refuses-what-it-does-not-read D8: with NONE of the three operations this used to write
  // `laneRouting: {overrides: []}` where no block existed and report success — a write nobody asked
  // for. Refused before loadState(). A read form (set-gate-guard's #159 precedent) was considered and
  // declined: it is new behaviour with its own output contract, and the defect is only the write.
  if (f.add === undefined && f.remove === undefined && f.clear === undefined) {
    die(
      "conductor: set-lane-routing needs an operation — --add \"<match>:<lane>\", --remove \"<match>\" " +
      "or --clear. Nothing was written.\n");
  }
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
        die(`conductor: bad --add '${escapeControls(raw)}': expected "<match>:<lane>"\n`);
      }
      const match = raw.slice(0, i).trim();
      const lane = raw.slice(i + 1).trim();
      if (!KNOWN_LANES.includes(lane)) {
        die(`conductor: bad --add '${escapeControls(raw)}': lane must be one of ${KNOWN_LANES.join("|")}\n`);
      }
      lr.overrides = lr.overrides.filter(o => o.match !== match);   // last --add for a match wins
      lr.overrides.push({ match, lane });
    }
  }

  state.laneRouting = lr;
  const saved = saveState(state);
  render();
  reportSave(saved, {
    changed: `conductor: lane routing has ${lr.overrides.length} override(s)`,
    unchanged: `conductor: lane routing already held exactly these ${lr.overrides.length} ` +
      `override(s) — ${STATE_UNCHANGED}`,
  });
}

/** The repo's lane-routing answer for one piece of free text, as data: `{lane, matched}`, with
 *  `lane: null` where no override matched. Extracted from suggestLane() so a SECOND consumer —
 *  intake triage, which needs the same answer alongside its candidate set — reads it through one
 *  function instead of re-walking `overrides` with its own copy of the first-match-wins rule. */
export function laneSuggestion(state, text) {
  for (const o of ((state && state.laneRouting) || {}).overrides || []) {
    if (laneMatchTest(o.match, text)) return { lane: o.lane, matched: o.match };
  }
  return { lane: null, matched: null };
}

/** `suggest-lane "<free text>"` — checks the repo's `laneRouting.overrides` (in order,
 *  first match wins) against a proposed epic's title/description BEFORE the generic
 *  lane heuristic is applied. Prints `{lane, matched}` as JSON; `lane: null` means no
 *  override matched and the agent should fall back to the documented generic heuristic
 *  (>8h/cross-system -> openspec; 2-8h -> superpowers; <2h -> claude-code; etc). */
export function suggestLane() {
  if (!isInitialized()) { die("conductor: run /pm:init first\n"); }
  // The check's classified positional, never `process.argv[3]`: that slot holds the first flag when
  // the line carries no text. Read-only today, so `--force` is refused before it could get here —
  // bound to the classification anyway, so a later argv-level row cannot reopen it.
  const [positional] = checkedPositionals("suggest-lane");
  // `--ask=<text>` carries the text as a flag VALUE, so a title shaped like a flag routes like any
  // other. One verb, one text: both at once is a surplus argument, never a silent pick of one.
  const f = parseFlags(currentArgv().slice(3));
  requireFlagValues("suggest-lane", f);
  const ask = typeof f.ask === "string" ? f.ask : undefined;
  if (ask !== undefined && typeof positional === "string") {
    die(`conductor: suggest-lane takes ONE text — '${escapeControls(positional)}' is an extra argument ` +
      "it does not read, because --ask already gave the text. Nothing was written.\n");
  }
  const text = ask !== undefined ? ask : positional;
  if (typeof text !== "string" || !text.length) {
    die("usage: conductor.mjs suggest-lane \"<free text>\" | --ask=<text>\n");
  }
  outStream().write(jsonText(laneSuggestion(loadState(), text)) + "\n");
}
