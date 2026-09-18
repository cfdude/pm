// scripts/lib/gate-guard.mjs
// The optional opt-in PreToolUse guard that blocks writes while a reconcile is owed.
// One-directional dependencies only.

import { isInitialized, loadState, saveState, readStdin } from "./state.mjs";
import { reportSave, STATE_UNCHANGED } from "./save-report.mjs";
import { render } from "./render.mjs";
import { requirePlatformFlag } from "./add-epic.mjs";
import { checkedPositionals } from "./argv-surface.mjs";
import { escapeControls } from "./constants.mjs";

/** `set-gate-guard <on|off>` — repo-level opt-in for a hard PreToolUse guard blocking
 *  source writes while the active epic still owes a reconcile. Off by default. This is
 *  the one place pm's law tolerates mechanical blocking over pure instruction, because it
 *  protects the single highest-stakes skip (writing code before the reconcile gate runs
 *  on a detour POP) — opt-in, reversible, never silent. */
export function setGateGuard() {
  if (!isInitialized()) { process.stderr.write("conductor: run /pm:init first\n"); process.exit(1); }
  // The check's classified positional, never `process.argv[3]`: with no positional the canonical
  // argv leaves `--force` there, and `set-gate-guard --force` printed usage instead of reading.
  const [val] = checkedPositionals("set-gate-guard");
  // #159 — BARE INVOCATION READS. `set-gate-guard` wrote and confirmed the write, and nothing
  // anywhere read it back, so "is the guard on?" was answerable only by opening state.json —
  // which is what a read verb exists to avoid.
  //
  // The reader goes HERE, on the toggle, and deliberately NOT on `gate-guard`. That verb is the
  // PreToolUse hook (hooks/hooks.json): it blocks with stderr + exit 2 and ALLOWS by returning
  // silently, so its stdout is protocol surface and a human-readable report printed there would
  // corrupt it. The reporter read that silence as a broken command; it is the allow signal.
  //
  // `owners` is the model, including the half that matters most: state the value AND what it
  // cannot tell you. The non-obvious limit here is that `on` does not mean anything is currently
  // blocked — the guard also needs an active, non-archived epic that owes something, which is
  // exactly the inference the reporter drew from `gateGuard: true` plus silence.
  if (val === undefined) {
    const st = loadState();
    const on = st.gateGuard === true;
    const active = st.active ? st.epics.find(e => e.id === st.active) : null;
    const live = active && active.status !== "archived" ? active : null;
    const out = [`GATE GUARD — ${on ? "on" : "off"}.`, ""];
    out.push("  The reconcile gate is ALWAYS enforced, whatever this flag says: an epic carrying");
    out.push("  `reconcileNeeded` blocks Edit/Write/NotebookEdit until a verdict is recorded, and");
    out.push("  `set-gate-guard off` does not reach that case.");
    out.push(on
      ? "  This flag additionally enforces the TRACKER REFRESH obligation."
      : "  This flag is off, so the tracker-refresh obligation is NOT enforced.");
    out.push("");
    // What it cannot tell you, said out loud rather than left to be inferred.
    out.push(!live
      ? "  Nothing is blocked right now: no live active epic, and the guard needs one."
      : (live.reconcileNeeded
          ? `  BLOCKING NOW: '${escapeControls(live.id)}' owes a reconcile.`
          : (on && live.trackerRefreshNeeded
              ? `  BLOCKING NOW: '${escapeControls(live.id)}' owes a tracker refresh.`
              : `  Nothing is blocked right now: '${escapeControls(live.id)}' owes neither obligation.`)));
    out.push("  'on' alone never means something is blocked — the guard also needs a live active");
    out.push("  epic that owes one of those two things.");
    out.push("");
    out.push("  Change it with `set-gate-guard on|off`.");
    process.stdout.write(out.join("\n") + "\n");
    return;
  }
  if (val !== "on" && val !== "off") {
    process.stderr.write("usage: conductor.mjs set-gate-guard <on|off>\n"); process.exit(1);
  }
  const state = loadState();
  state.gateGuard = (val === "on");
  const saved = saveState(state);
  render();
  reportSave(saved, {
    changed: `conductor: gate guard is now ${val}`,
    unchanged: `conductor: gate guard was already ${val} — ${STATE_UNCHANGED}`,
  });
}

// ───────────── the closed write-shape list (the-guard-covers-every-write-path, design D2) ─────────────
//
// The guard is registered for `Bash` as well as for the editing tools, because an agent blocked on
// `Edit` wrote the same file with `cat > f <<EOF`, `sed -i` or `tee` in one hop. What a command
// STRING can be resolved to is small and bounded, and the rows below are the whole of it: ONE site,
// CLOSED, each row carrying a FIXED label, so the block message names a decision about this command
// while printing no text taken from it.
//
// IT CANNOT SEE, and must never claim to: a path built from a variable or `$(…)`; anything behind
// `eval`; a script or a Makefile target invoked by name; an interpreter given inline source
// (`python -c`, `node -e`); a program that writes files of its own accord; an in-place editor
// reached through another command's arguments (`find … -exec sed -i …`, `xargs … sed -i`), which is
// not a position this list reads. It has no quoting model either, so a `>` inside a quoted string
// or a heredoc body reads as a redirection — an accepted false positive. The instruction layer
// stays primary; this is a backstop, and its own message says so.

/** The fixed labels, and the whole of what a caller may print. Text the engine wrote itself needs
 *  neither escaping nor a length bound; a target path or a matched fragment would need both. */
export const WRITE_SHAPE_LABELS = Object.freeze({
  redirect: "a redirection into a file",
  inPlace: "an in-place stream editor",
  tee: "tee",
  gitApply: "git apply",
  record: "a write to the conductor record",
  cp: "cp", mv: "mv", install: "install", rsync: "rsync", dd: "dd", truncate: "truncate", patch: "patch",
});

const DEVICE_PATH = /^\/dev\//;
/** A `tee` argument beginning `&` is a descriptor word, never a file. */
const NEVER_A_FILE = /^(\/dev\/|&)/;
/** The conductor record: `.conductor`, `.conductor/state.json`, a `*` glob of that directory, or a
 *  trailing `*` appended to either name, at any directory prefix. The discriminator is whether the
 *  WRITTEN argument names the record among its expansions — a trailing `*` does, so it matches even
 *  though it also reaches the lock. NOT a longer LITERAL filename, and not a glob that cannot expand
 *  to the record: `.conductor/state.json.lock` is a different file and `.conductor/state.json.*`
 *  reaches only such files, and the engine's own lock refusal prints the literal path. A trailing
 *  `*` and only `*` — `?` and `[…]` are out of scope under the incomplete-by-construction rule. */
const RECORD_PATH = /(^|\/)\.conductor(\*|\/(state\.json\*?|\*))?\/?$/;
const ENGINE_PATH = /(^|\/)conductor\.mjs$/;
const VARIABLE_REF = /^\$(\{[A-Za-z_][A-Za-z0-9_]*\}|[A-Za-z_][A-Za-z0-9_]*)$/;
const IN_PLACE_EDITORS = ["sed", "gsed", "perl", "ruby"];
/** Copiers and movers, read ONLY as a segment's leading command word. The label is LOOKED UP in
 *  WRITE_SHAPE_LABELS rather than sliced from the command: its value is one of these seven
 *  literals, but its lexeme is command text, and the message may carry none. */
const COMMAND_WORD_SHAPES = ["cp", "mv", "install", "rsync", "dd", "truncate", "patch"];

/** Strip ONE surrounding quote character at each end. There is no quoting model here (Non-Goals);
 *  this is the common spelling (`rm '.conductor/state.json'`) and nothing more. */
function unquoteOnce(word) {
  return String(word).replace(/^['"]/, "").replace(/['"]$/, "");
}

/** Segments, split on newline, `;`, `&&`, `||` and `|` — EXCEPT a `|` immediately following `>`.
 *  `>|` is the no-clobber-override redirection operator, and splitting there would hide it from the
 *  redirection arm entirely (`cmd >| out.txt` passed on the prototype until this was fixed). */
function segments(text) {
  return text.split(/\n|;|&&|\|\||(?<!>)\|/);
}

/** A segment's leading command word and the words after it, skipping a `VAR=value` prefix and a
 *  leading `sudo`/`env`/`command`. The command word is taken after its last `/`. */
function segmentHead(seg) {
  const words = seg.trim().split(/\s+/).filter(Boolean);
  let i = 0;
  while (i < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i])) i++;
  if (words[i] === "sudo" || words[i] === "command" || words[i] === "env") i++;
  return { word: (words[i] || "").split("/").pop(), rest: words.slice(i + 1) };
}

/** An invocation of pm's own engine: a runtime whose first argument — one surrounding quote stripped
 *  from each end — is a path ending `conductor.mjs` OR an unexpanded variable reference, followed by
 *  a verb. Both spellings pm actually emits are covered: the quoted plugin-root path and
 *  `node "$ENGINE" <verb>`, which the guard cannot expand.
 *
 *  EXPORTED because this is the exemption's ONLY falsifiable surface. Under the list as it stands no
 *  command-word row is REACHABLE from a `node`-led segment — the arm reads the segment's LEADING
 *  word, always the runtime and never the verb — so removing the call site below changes no
 *  command's outcome and a case-based check of exit codes cannot fail. Any future row keyed on
 *  something other than the leading command word must re-establish that reachability before it
 *  ships. The commands this gate names as the way through it are engine invocations, and a gate that
 *  blocked its own completing command would have no exit. */
export function isEngineInvocation(word, rest) {
  if (word !== "node") return false;
  const first = unquoteOnce(rest[0] || "");
  if (!(ENGINE_PATH.test(first) || VARIABLE_REF.test(first))) return false;
  return rest.length > 1 && !rest[1].startsWith("-");   // a verb follows
}

/** The matched write shape's FIXED LABEL, or null. The single site design D2's closed list lives at,
 *  and the label is the only thing a caller may print. */
export function writeShape(command) {
  const text = String(command || "");
  for (const seg of segments(text)) {
    // 1. REDIRECTION INTO A FILE, per segment — `>`/`>>`, optionally preceded by one or more fd
    //    digits, optionally `&`-prefixed or `|`-suffixed (the no-clobber override). Excluded: a
    //    `/dev/` target; an fd DUPLICATION, which is `&` followed by digits or `-` (`>&2`, `2>&1`,
    //    `>&-`) and deliberately not `&` followed by a path, since `node --test >& out.txt` writes a
    //    file; and a `>` whose immediately preceding character is `-`, the arrow that appears in the
    //    `rg` patterns and `git log` format strings this repository mandates.
    //    This arm runs for EVERY segment, the engine-exempt ones included — an exemption that
    //    swallowed redirections would make "prefix it with an engine invocation" a one-line bypass.
    const redirection = /(^|[^<>|-])[0-9]*>>?\|?(&?)\s*([^\s;|)]+)/g;
    let m;
    while ((m = redirection.exec(seg)) !== null) {
      const [, , ampersand, target] = m;
      if (ampersand && /^([0-9]+|-)$/.test(target)) continue;   // a descriptor, not a file
      if (DEVICE_PATH.test(target)) continue;
      return WRITE_SHAPE_LABELS.redirect;
    }
    // 2. SEGMENT-LEADING COMMAND WORDS.
    const { word, rest } = segmentHead(seg);
    if (!word) continue;
    if (isEngineInvocation(word, rest)) continue;   // the exemption, command-word arm ONLY
    if (IN_PLACE_EDITORS.includes(word) &&
        rest.some(a => /^-[a-zA-Z]*i/.test(a) || /^--in-place(=|$)/.test(a))) return WRITE_SHAPE_LABELS.inPlace;
    if (word === "tee" && !rest.every(a => NEVER_A_FILE.test(a) || a.startsWith("-"))) return WRITE_SHAPE_LABELS.tee;
    if (COMMAND_WORD_SHAPES.includes(word)) return WRITE_SHAPE_LABELS[word];
    if (word === "git" && rest[0] === "apply") return WRITE_SHAPE_LABELS.gitApply;
    // 3. DESTROYING THE CONDUCTOR RECORD. Not a lesser evasion than writing over a source file: the
    //    guard is dormant while no record exists, so a deletion turns the whole block OFF. `rm` is on
    //    the list for the record and for nothing else — `mv` and `truncate` are already unconditional
    //    command words above, and the guard gets no general path policy out of this.
    if (word === "rm" && rest.some(a => RECORD_PATH.test(unquoteOnce(a)))) return WRITE_SHAPE_LABELS.record;
  }
  return null;
}

/** PreToolUse hook body: block Edit/Write/NotebookEdit while the active epic still owes a
 *  reconcile (`reconcileNeeded` — see reconcileArchived()'s comment for why this can be
 *  legitimately true with an empty detour stack). Dormant until /pm:init. As of the
 *  gate-guard-default-on-reconcile change, an epic with `reconcileNeeded: true` is ALWAYS
 *  gate-guarded — real-usage feedback showed the opt-in (`set-gate-guard on`) was never
 *  actually turned on, so the single highest-stakes skip (writing source before the
 *  reconcile gate runs) is now protected by default and cannot be silenced via
 *  `set-gate-guard off`. The repo-level `gateGuard` flag still exists (and still gates any
 *  *future* generalization of this hook to other checks), but no longer gates the
 *  reconcile-owed check itself. Exits 2 to block per Claude Code's PreToolUse convention
 *  (stderr becomes the reason shown to the agent). */
export function gateGuardCheck() {
  if (!isInitialized()) return;         // DORMANT until /pm:init
  readStdin();                          // drain, unused — this check needs no tool_input
  requirePlatformFlag("gate-guard");    // after the drain, so a refusal leaves no writer holding a pipe
  const state = loadState();
  const activeEpic = state.active ? state.epics.find(e => e.id === state.active) : null;
  // AN EPIC THAT HAS ENDED OWES NOTHING. `state.active` can legitimately name an ARCHIVED epic
  // for a stretch — the pointer is cleared by reconcileArchived(), which runs on the WRITE paths
  // (render, sync, commit-nudge, upgrade) and not on this read-only hook. render.mjs says so out
  // loud: "`<id>` was archived; the active pointer clears on next `/pm:sync` or commit".
  //
  // This is the THIRD reader of that pointer and it was the only one not filtering: render.mjs:53
  // and briefing.mjs:60 both drop an archived epic at the moment they resolve it. The asymmetry
  // mattered here more than anywhere, because this reader BLOCKS WRITES mechanically and the
  // reconcile branch below is deliberately unreachable by `set-gate-guard off` — so an archived
  // epic carrying a stale `reconcileNeeded` could wedge Edit/Write/NotebookEdit with no CLI way
  // out. Filtered HERE, at the resolution, rather than inside each branch, so a future third
  // obligation inherits the rule instead of having to remember it.
  const active = activeEpic && activeEpic.status !== "archived" ? activeEpic : null;
  if (!active) return;
  // UNCONDITIONAL. `set-gate-guard off` does not reach this case: writing source before the
  // reconcile gate runs on a detour POP is the single highest-stakes skip, and the opt-in was
  // never actually turned on in real usage.
  if (active.reconcileNeeded) {
    process.stderr.write(
      `conductor: gate guard — '${escapeControls(active.id)}' still owes a reconcile (a detour touched shared ` +
      "code). Run the reconcile gate (reconciler agent, per the conductor skill's POP protocol) " +
      // NO BYPASS SENTENCE HERE, and its absence is the fix. This branch is UNCONDITIONAL —
      // `set-gate-guard off` does not reach it, by design (the reconcile skip is the
      // highest-stakes one, and the opt-in was never actually turned on in real usage). The
      // message nevertheless told the reader to turn the guard off to bypass, which is simply
      // false: verified by setting it off and watching this branch still exit 2. It also
      // contradicted commands/gate-guard.md's "There is no bypass for this specific case".
      // The tracker branch below keeps its bypass sentence because there the flag really does
      // gate it.
      "before writing source. There is NO bypass for this case: `set-gate-guard off` does not " +
      "reach it. Completing the reconcile gate is the only way through.\n"
    );
    process.exit(2);
  }
  // OPT-OUT, under the repo-level `gateGuard` flag — the generalization this hook's own source
  // pre-authorized. The escape hatch is not optional here: an agent that is offline,
  // unauthenticated, or facing a deleted upstream item must be able to proceed honestly, and a
  // `--verdict unchanged` recorded blind is a worse outcome than an honest bypass.
  if (state.gateGuard === true && active.trackerRefreshNeeded) {
    process.stderr.write(
      `conductor: gate guard — '${escapeControls(active.id)}' owes a tracker refresh: re-read its linked item ` +
      "(body, comments, labels, state) before drawing specs or a plan for it, then record the " +
      "verdict with `record-tracker-refresh <id> --verdict unchanged|material-change " +
      "--external-updated-at <iso>`. Turn the guard off with `set-gate-guard off` if you cannot " +
      "reach the tracker — an honest bypass beats a blind `unchanged`.\n"
    );
    process.exit(2);
  }
}
