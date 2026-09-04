// scripts/lib/gate-guard.mjs
// The optional opt-in PreToolUse guard that blocks writes while a reconcile is owed.
// One-directional dependencies only.

import { isInitialized, loadState, saveState, readStdin } from "./state.mjs";
import { render } from "./render.mjs";

/** `set-gate-guard <on|off>` — repo-level opt-in for a hard PreToolUse guard blocking
 *  source writes while the active epic still owes a reconcile. Off by default. This is
 *  the one place pm's law tolerates mechanical blocking over pure instruction, because it
 *  protects the single highest-stakes skip (writing code before the reconcile gate runs
 *  on a detour POP) — opt-in, reversible, never silent. */
export function setGateGuard() {
  if (!isInitialized()) { process.stderr.write("conductor: run /pm:init first\n"); process.exit(1); }
  const val = process.argv[3];
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
          ? `  BLOCKING NOW: '${live.id}' owes a reconcile.`
          : (on && live.trackerRefreshNeeded
              ? `  BLOCKING NOW: '${live.id}' owes a tracker refresh.`
              : `  Nothing is blocked right now: '${live.id}' owes neither obligation.`)));
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
  saveState(state);
  render();
  process.stderr.write(`conductor: gate guard is now ${val}\n`);
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
      `conductor: gate guard — '${active.id}' still owes a reconcile (a detour touched shared ` +
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
      `conductor: gate guard — '${active.id}' owes a tracker refresh: re-read its linked item ` +
      "(body, comments, labels, state) before drawing specs or a plan for it, then record the " +
      "verdict with `record-tracker-refresh <id> --verdict unchanged|material-change " +
      "--external-updated-at <iso>`. Turn the guard off with `set-gate-guard off` if you cannot " +
      "reach the tracker — an honest bypass beats a blind `unchanged`.\n"
    );
    process.exit(2);
  }
}
