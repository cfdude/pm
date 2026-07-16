### Added

- **Session-continuity check for live external-infra epics.** The
  `hierarchy-child-executor` agent now has a required checklist item: before finalizing its
  STATUS/DONE/DECISIONS/CONCERNS report, if the epic's work made a live change to external
  infrastructure the orchestrator itself depends on for the rest of the session (branch
  protection rules, credential/token rotation, webhook/API changes, etc.), it must explicitly
  answer "does this change affect how the orchestrator itself needs to operate for the rest of
  this session?" in CONCERNS — even an explicit "no" is required output, not silence. The
  conductor skill's "Epic-level autonomy — the preflight scan" section now references the same
  check as a standing preflight question for any epic making a live external-infra change.
  Fixes a real incident: `branch-protection-and-pr-workflow` applied live branch-protection
  settings to `main`, and the orchestrator's very next `git push origin main` was rejected —
  discovered only empirically, not flagged by that epic's preflight or its executor's
  completion report. Doc-only change; no `scripts/conductor.mjs` code affected.
