// scripts/lib/verb-effects.mjs
// WHICH SUBCOMMANDS TOUCH THE WORKING TREE. One declaration, checked two ways.
//
// #85: there was no stated contract for this, and it matters the moment anything inspects a
// conductor it does not own. An orchestrator wanting a guaranteed read of a sibling repo's
// backlog reached for `render` — the natural-sounding "show me the current state" verb — and
// silently dirtied that repo, producing drift it then went to reconcile.
//
// A doc alone would not have survived: the risk is someone adding a write to a verb that used to
// be safe, and prose cannot notice that. So scripts/test/conductor-25.test.mjs checks this table
// BOTH ways —
//   * COMPLETENESS against conductor.mjs's own dispatch object, read from source, so a verb added
//     later without an entry here fails rather than defaulting to an unstated claim;
//   * BEHAVIOUR for every `read-only` entry carrying an `exercise` argument list: the whole repo
//     is hashed by content AND mtime before and after, so a rewrite with identical bytes counts
//     as a write.
//
// A `--read-only` enforcement flag was considered and DECLINED. It would have to be threaded
// through or sniffed from argv at forty verbs, and it answers the question at call time for a
// caller who already has to trust the flag was wired up; the CI-time behavioural check answers
// #85's actual need — "a flag survives someone adding a write to a verb that used to be safe" —
// without shipping anything.
//
// THREE readings, and the third is not a hedge:
//   effect: "read-only"  + exercise: [...]  — VERIFIED. The suite runs it and asserts nothing moved.
//   effect: "read-only"  + no exercise      — DECLARED but not exercised here (needs a fixture
//                                             this check does not build). Silence and "verified"
//                                             must not look the same.
//   effect: "mutates"    + writes: "…"      — DECLARED mutating, naming what it touches.
//
// MEASURED, 2026-08-29 on 0.32.0, and it corrects #85's own premise: `render` no longer dirties
// the tree on EVERY call. #81's fix made both of its writes content-conditional — PROJECT.md is
// skipped when only the "Last rendered" line differs, and the render stamp is skipped when
// state.json's mtime has not moved. It is still `mutates`: with anything to render it rewrites
// PROJECT.md and .conductor/render-stamp.json, which is exactly what a caller inspecting someone
// else's repo must not trigger. Idempotent-when-nothing-changed is not read-only.

export const VERB_EFFECTS = {
  // ─────────────── read-only: safe to run against a repo you do not own ───────────────
  brief: { effect: "read-only", exercise: [], note: "prints the SessionStart additionalContext JSON" },
  changelog: { effect: "read-only", exercise: [], note: "prints the changelog delta between the stamped and installed versions" },
  changesets: { effect: "read-only", exercise: [], note: "lists pending .changesets/*.md fragments" },
  "gate-guard": { effect: "read-only", exercise: [], note: "PreToolUse decision; reads state and the hook payload on stdin" },
  integrity: { effect: "read-only", exercise: [], note: "audits the record for shapes that cannot be true; reports, never repairs" },
  "lesson-advice": { effect: "read-only", exercise: [], note: "PreToolUse advisory; reads docs/lessons/ frontmatter and the hook payload on stdin, writes nothing and never blocks" },
  "plan-hierarchy": { effect: "read-only", exercise: ["--parent", "p"], note: "recomputes execution batches fresh every call; no persistent state" },
  rules: { effect: "read-only", exercise: [], note: "prints the CLAUDE.md rules block to stdout — `write-rules` is the writing half" },
  "rules-target": { effect: "read-only", exercise: [], note: "prints which file this platform's rules block belongs in; deliberately does NOT record the platform" },
  "suggest-lane": { effect: "read-only", exercise: ["a caching bug"], note: "returns the routed lane for a title" },
  triage: { effect: "read-only", exercise: ["a caching bug in the renderer"], note: "candidate duplicates + lane suggestion; emits verdict:null and registers nothing" },
  "verify-specs": { effect: "read-only", exercise: [], note: "design-document coverage inventory" },
  // #84's whole point: an orchestrator asks "is it safe to write here" BEFORE dispatching into
  // a sibling repo. A verb that dirtied that repo to answer would be answering its own question
  // wrongly — so this one is exercised, not merely declared.
  owners: { effect: "read-only", exercise: [], note: "advisory claim report — who holds what, and how stale" },
  // #111's reader. Read-only in the strict sense the suite checks: it opens `.conductor/activity/`
  // and nothing else, and it does NOT create that directory when it is absent — a reader that
  // scaffolded its own store would dirty a repo merely by being asked a question about it.
  activity: { effect: "read-only", exercise: [], note: "reads the activity log and answers the questions it exists for" },
  // The ONE exercised verb that is SUPPOSED to exit non-zero — its whole job is to fail on
  // drift, and the behavioural check runs it against a repo with a render pending. Declared
  // rather than special-cased in the test, so "this verb fails by design" and "this verb
  // crashed before it ran" stay distinguishable: a crash writes nothing either, and a check
  // that accepted any non-zero exit would prove nothing for the other twelve.
  "verify-state": { effect: "read-only", exercise: [], expectsFailure: true, note: "compares state.json's mtime against the render stamp; exits non-zero on drift and writes nothing" },
  "verify-worktrees": { effect: "read-only", exercise: [], note: "reports stale git worktrees" },

  // ─────────────── mutates: never call these against a repo you are only inspecting ───────────────
  init: { effect: "mutates", writes: ".conductor/state.json, .gitignore, CLAUDE.md, PROJECT.md" },
  render: { effect: "mutates", writes: "PROJECT.md, .conductor/render-stamp.json (both skipped when the content would be identical)" },
  snapshot: { effect: "mutates", writes: ".conductor/brief.txt, plus render()'s writes" },
  "commit-nudge": { effect: "mutates", writes: ".conductor/commit-watch.json, .conductor/detours.log, state.json's archived-epic self-heal, plus render()'s writes" },
  sync: { effect: "mutates", writes: "state.json — registers newly-found openspec changes and plans as untriaged epics" },
  "log-detour": { effect: "mutates", writes: ".conductor/detours.log (append-only)" },
  "honcho-memory": { effect: "mutates", writes: ".conductor/honcho-memories.log (append-only)" },
  "add-epic": { effect: "mutates", writes: "state.json, plus render()'s writes" },
  "add-many": { effect: "mutates", writes: "state.json, plus render()'s writes" },
  "update-epic": { effect: "mutates", writes: "state.json, plus render()'s writes" },
  "remove-epic": { effect: "mutates", writes: "state.json, plus render()'s writes" },
  reorder: { effect: "mutates", writes: "state.json (epic rank), plus render()'s writes" },
  "set-active": { effect: "mutates", writes: "state.json (the active pointer), plus render()'s writes" },
  "clear-active": { effect: "mutates", writes: "state.json (the active pointer), plus render()'s writes" },
  "set-tracker": { effect: "mutates", writes: "state.json (tracker config), CLAUDE.md (the rules block)" },
  "set-lane-routing": { effect: "mutates", writes: "state.json (lane-routing overrides)" },
  "set-autonomy": { effect: "mutates", writes: "state.json (an epic's autonomy block and notifications)" },
  "set-review-mode": { effect: "mutates", writes: "state.json (the review-mode dial), CLAUDE.md (the rules block)" },
  "set-gate-guard": { effect: "mutates", writes: "state.json (the gate-guard toggle)" },
  release: { effect: "mutates", writes: "state.json (releases and one-way membership), plus render()'s writes" },
  "record-reconcile": { effect: "mutates", writes: "state.json (the reconcile verdict on an epic's detour link)" },
  "record-gate-review": { effect: "mutates", writes: "state.json (gateReview.gateN)" },
  "record-cross-spec-review": { effect: "mutates", writes: "state.json (the release-scope verdict and its spec-set hash)" },
  "record-tracker-refresh": { effect: "mutates", writes: "state.json (the externalUpdatedAt watermark and refresh verdict)" },
  "set-activity-log": { effect: "mutates", writes: "state.json (the activityLog toggle)" },
  // DESTRUCTIVE by nature, which is why it removes nothing without both a selector and --yes.
  "purge-logs": { effect: "mutates", writes: "removes .conductor/ log files — activity segments, write-conflicts.log(.prev), detours.log" },
  claim: { effect: "mutates", writes: "state.json (an epic's advisory claim) — or .conductor/session-claim.json with --repo" },
  unclaim: { effect: "mutates", writes: "state.json (clears an epic's advisory claim) — or removes .conductor/session-claim.json with --repo" },
  upgrade: { effect: "mutates", writes: "state.json (migrations, pmVersion), CLAUDE.md (the rules block), .gitignore" },
  "write-rules": { effect: "mutates", writes: "CLAUDE.md (or the platform's rules file), state.json (the recorded platform)" },
};
