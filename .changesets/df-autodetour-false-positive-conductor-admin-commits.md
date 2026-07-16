- **`commit-nudge`'s auto-detour heuristic no longer false-positives on routine conductor
  bookkeeping.** A commit touching only pm's own state-output files (`.conductor/state.json`,
  `PROJECT.md`, `.conductor/render-stamp.json`) is never auto-logged as a stray minimal detour,
  even if it matches the `fix:`/`chore:` + `<=3 files` shape — this fired 3 separate times in
  one session (registering epics, archiving epics, granting autonomy), always on commits that
  were routine administration, never a real detour. `CLAUDE.md` is deliberately excluded from
  this allowlist: it's user-authored content, not purely engine-generated output, so a commit
  touching it could still be a genuine detour.
