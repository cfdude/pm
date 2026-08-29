// scripts/lib/hook-write.mjs
// THE "retry once, then skip" policy for hook writes, in one place.
//
// WHY IT IS A FUNCTION AND NOT A PATTERN. 0.26.0 specified hook writes as RETRY ONCE, THEN SKIP
// and implemented it as five lines copied into two call sites — render.mjs and commitNudge().
// Measured on 0.32.0 (#131): delete the retry from BOTH sites and all 856 tests still pass. The
// heal those sites run is idempotent and hook-driven, so a LATER hook invocation covers for the
// missing retry, and nothing observes the difference. That cover is real in production too —
// which is exactly why the copies could rot unnoticed, and why the policy is now one function
// with its own unit tests instead of a shape two files are trusted to keep.
//
// It is also why the commit-nudge site cannot be verified end to end: commitNudge() calls
// render() two lines later and render()'s heal is idempotent, so whether commit-nudge's retry
// ran is invisible from outside a single invocation. A source scan in
// scripts/test/conductor-25.test.mjs binds that site to this function instead — a live helper
// reached by dead code passes every test of the helper
// (docs/lessons/a-guard-can-check-the-wrong-half.md).
//
// Zero dependencies beyond lib/state.mjs, and it does not import epic-progress.mjs: the HEAL is
// a parameter, so this module never learns what a hook is healing and cannot become a second
// place that decides.

import { loadState, saveState } from "./state.mjs";

/** Apply a hook's self-heal to state.json under the RETRY ONCE, THEN SKIP policy.
 *
 *  The caller has already run its heal against `state`; this owns only the write.
 *
 *  On a conflicting first write the retry RELOADS and RE-RUNS the heal rather than re-attempting
 *  the same object: the in-hand state is built on a revision another writer has already
 *  superseded, so writing it again would clobber exactly what the revision guard exists to
 *  protect. If the reloaded state has nothing left to heal — someone else's write already
 *  applied it — that is a SKIP and not a blind re-save, for the same reason.
 *
 *  A second conflict skips. It never loops: the file is contended, the heal re-runs on the next
 *  hook, and spinning here would trade a free retry for an unbounded one on the failure path.
 *
 *  `load`/`save` are injectable so the policy is testable without a conflict-injection seam in
 *  the shipped engine — an earlier `--conflict-selftest` verb was considered during 0.26.0 and
 *  dropped deliberately, and a test-only branch in a write path is precisely the kind of thing
 *  that ends up load-bearing.
 *
 *  @param {object}   o.state  the state the caller healed and wants written
 *  @param {string}   o.verb   the verb name recorded in the conflict sidecar
 *  @param {function} o.heal   (state) => boolean — re-run on the reloaded state
 *  @returns {{ok: boolean, retried: boolean}}
 */
export function saveHookHeal({ state, verb, heal, load = loadState, save = hookSave(verb) }) {
  const first = save(state);
  if (first && first.ok) return { ok: true, retried: false };

  const fresh = load();
  if (!heal(fresh)) return { ok: false, retried: true };
  const second = save(fresh);
  return { ok: !!(second && second.ok), retried: true };
}

/** The real write both hook sites use: skip on conflict, tagged with the calling verb so the
 *  sidecar names which hook lost the race. */
const hookSave = (verb) => (s) => saveState(s, { onConflict: "skip", verb });
