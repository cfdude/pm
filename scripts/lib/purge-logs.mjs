// scripts/lib/purge-logs.mjs
// #111 — the manual purge. Required in the same release as the log, not a follow-up.
//
// WHY IT EXISTS WHEN AUTOMATIC RETENTION ALREADY DOES: automatic pruning only ever fires at the
// cap, and the cap is a backstop against pathology (1 GB ≈ 5.5 million events ≈ centuries at the
// measured rate). An operator managing disk, or clearing noise before a fresh measurement
// window, needs a direct tool and will otherwise reach for `rm` — which is the same thing
// without a plan printed first.
//
// DESTRUCTIVE, SO IT REFUSES TO GUESS, TWICE:
//   1. With no selector it removes NOTHING and says so. "Purge the logs" with no qualifier has
//      no safe reading, and defaulting it to "everything" is how a tool deletes a record
//      somebody wanted.
//   2. Without `--yes` it prints exactly what it WOULD remove and exits 0 having removed
//      nothing. That is the non-interactive form of "requires confirmation unless --dry-run
//      already showed it": this engine is driven by agents and hooks, so a prompt on stdin
//      would hang rather than confirm. `--dry-run` is kept as the explicit spelling of the
//      same thing, so a caller can say what it means rather than relying on an omission.

import fs from "node:fs";
import path from "node:path";
import { isInitialized } from "./state.mjs";
import { activityDir, segments } from "./activity-log.mjs";
import { segmentStart } from "./activity-report.mjs";
import { PURGE_KINDS } from "./constants.mjs";
import { parseFlags, requireFlagValues, requireKnownFlags } from "./add-epic.mjs";

// Re-exported from its DECLARATION in constants.mjs: `VERB_FLAGS`' `--kind` row names these
// kinds in its own refusal phrase, so the list has to live where constants.mjs can read it
// without importing a verb module. Everything that already imported it from here still can.
export { PURGE_KINDS };

function conductorDir() {
  return path.join(process.env.CLAUDE_PROJECT_DIR || process.cwd(), ".conductor");
}

/** `100`, `4K`, `10M`, `1G` → bytes; null when unparseable. */
export function parseSize(s) {
  const m = /^(\d+(?:\.\d+)?)\s*([KMGkmg])?[Bb]?$/.exec(String(s).trim());
  if (!m) return null;
  const mult = { K: 1024, M: 1024 ** 2, G: 1024 ** 3 }[(m[2] || "").toUpperCase()] || 1;
  return Math.floor(Number(m[1]) * mult);
}

/** Every purgeable file for `kind`, NEWEST FIRST, each with its size and its time.
 *
 *  `time` comes from the SEGMENT NAME for activity segments and from mtime for the single-file
 *  logs. That asymmetry is deliberate and is the payoff of timestamped names: a segment's window
 *  is knowable without opening it, and mtime on an append-only log answers only "when was the
 *  last line written", which is the best available for a file that has no window of its own. */
export function candidates(kind) {
  const dir = conductorDir();
  const out = [];
  const stat = (p) => { try { return fs.statSync(p); } catch { return null; } };

  if (kind === "activity" || kind === "all") {
    const adir = activityDir();
    for (const name of segments(adir)) {
      const p = path.join(adir, name);
      const st = stat(p);
      if (!st) continue;
      out.push({ kind: "activity", path: p, name, size: st.size, time: segmentStart(name) ?? st.mtimeMs });
    }
  }
  if (kind === "conflicts" || kind === "all") {
    for (const name of ["write-conflicts.log", "write-conflicts.log.prev"]) {
      const p = path.join(dir, name);
      const st = stat(p);
      if (st) out.push({ kind: "conflicts", path: p, name, size: st.size, time: st.mtimeMs });
    }
  }
  if (kind === "detours" || kind === "all") {
    const p = path.join(dir, "detours.log");
    const st = stat(p);
    if (st) out.push({ kind: "detours", path: p, name: "detours.log", size: st.size, time: st.mtimeMs });
  }
  return out.sort((a, b) => b.time - a.time);
}

/** Which files each selector marks. The removal set is the UNION — an operator saying "older
 *  than 90 days, and also trim to 10 files" means both, not their intersection. Pure, so the
 *  policy is testable without deleting anything. `files` must be newest-first. */
export function selectForRemoval(files, { keep = null, over = null, olderThanDays = null } = {}, now = Date.now()) {
  const marked = new Set();
  if (Number.isInteger(keep) && keep >= 0) files.slice(keep).forEach(f => marked.add(f.path));
  if (Number.isFinite(olderThanDays)) {
    const cut = now - olderThanDays * 86_400_000;
    files.filter(f => f.time < cut).forEach(f => marked.add(f.path));
  }
  if (Number.isInteger(over) && over >= 0) {
    let total = files.reduce((a, f) => a + f.size, 0);
    // Oldest first, which is the tail of a newest-first list.
    for (const f of [...files].reverse()) {
      if (total <= over) break;
      if (!marked.has(f.path)) { marked.add(f.path); }
      total -= f.size;
    }
  }
  return files.filter(f => marked.has(f.path));
}

function die(msg) { process.stderr.write(`conductor: ${msg}\n`); process.exit(1); }

/** `purge-logs [--kind activity|conflicts|detours|all] [--keep <n>] [--over <size>]
 *              [--older-than <days>] [--dry-run] [--yes]` */
export function purgeLogs() {
  if (!isInitialized()) die("run /pm:init first");
  const argv = process.argv.slice(3);
  // The allowlist is the registry's OWN projection through the SHARED checker, never the
  // `KNOWN = ["kind", "keep", …]` literal and hand-written loop this verb used to carry — the
  // enumeration defect #152 reports, one question over: `flagsFor()` answers "is this flag known
  // on this verb", `valueBearingFlagsFor()` answers "does it need a value", and neither may be
  // answered with the other's list.
  requireKnownFlags("purge-logs", argv);
  // NAMED `flags`, not `f`: this body already binds `f` as the loop variable for a candidate
  // FILE (`f.size`, `f.path`), so a parsed-flags object called `f` would be shadowed inside
  // every one of those loops. It reads as a live hazard and conductor-31's region scanner reads
  // it as four undeclared flags — both are the same confusion, and the rename removes it.
  const flags = parseFlags(argv);
  // FIRST, before every check below, and the ORDER is load-bearing rather than tidy. #152's
  // shared rule and this verb's own parsing do not subsume each other — `--keep abc` carries a
  // value and is still not a whole number — but run the bespoke checks first and a blank
  // `--kind "   "` is refused as "must be one of …" rather than as the missing value it is.
  // Same shape conductor-31 already pins for `triage --limit`.
  requireFlagValues("purge-logs", flags);
  // Past requireFlagValues, a declared value-bearing flag is either absent or a usable string;
  // `true` can only be one of the two valueless rows, which are read by name below.
  const val = (name) => {
    const v = flags[name];
    return v === undefined || v === true ? null : String(v);
  };

  const kind = val("kind") || "all";
  if (!PURGE_KINDS.includes(kind)) die(`--kind must be one of ${PURGE_KINDS.join("|")}`);

  const keepRaw = val("keep");
  const overRaw = val("over");
  const olderRaw = val("older-than");
  const keep = keepRaw === null ? null : Number(keepRaw);
  if (keepRaw !== null && (!Number.isInteger(keep) || keep < 0)) die("--keep requires a non-negative whole number");
  const over = overRaw === null ? null : parseSize(overRaw);
  if (overRaw !== null && over === null) die("--over requires a size like 500K, 10M or 1G");
  const olderThanDays = olderRaw === null ? null : Number(olderRaw);
  if (olderRaw !== null && (!Number.isFinite(olderThanDays) || olderThanDays < 0)) {
    die("--older-than requires a non-negative number of days");
  }

  if (keep === null && over === null && olderThanDays === null) {
    die("purge-logs removes nothing without a selector. Say which: --keep <n>, --over <size>, " +
      "or --older-than <days>. \"Purge the logs\" has no safe default, and defaulting it to " +
      "everything is how a tool deletes a record somebody wanted.");
  }

  const files = candidates(kind);
  const doomed = selectForRemoval(files, { keep, over, olderThanDays });
  const bytes = doomed.reduce((a, f) => a + f.size, 0);
  const dryRun = flags["dry-run"] === true;
  const confirmed = flags.yes === true && !dryRun;

  if (!doomed.length) {
    process.stdout.write(
      `purge-logs: nothing matches (${files.length} candidate file(s) under --kind ${kind}).\n`);
    return;
  }
  const L = [`purge-logs: ${doomed.length} file(s), ${bytes} byte(s)` +
    `${confirmed ? " REMOVED" : " would be removed"}:`];
  for (const f of doomed) L.push(`  ${f.kind}\t${f.size}\t${f.name}`);
  if (!confirmed) {
    L.push("");
    L.push(dryRun
      ? "--dry-run: nothing was removed."
      : "Nothing was removed. This is the plan; re-run with --yes to apply it.");
  }
  process.stdout.write(L.join("\n") + "\n");
  if (!confirmed) return;
  for (const f of doomed) {
    try { fs.rmSync(f.path, { force: true }); } catch { /* best effort */ }
  }
}
