* **New `overhead [--all-features] [--json]` verb: what pm injects into a session, by surface and by feature.**
  Reports every managed rules section, the SessionStart brief, the PreCompact snapshot, each hook's text and the
  shipped command, skill and agent descriptions, each with its bytes and a `~N tokens (bytes/4, estimate)` figure and
  the one feature that emits it (`core`, `listings`, or an opt-in). `--all-features` computes the every-opt-in-on case
  in memory and writes nothing. Spend tracking's own cost (its rules sections and the per-dispatch marker line) is its
  own line. Read-only: opens no spend, transcript or network path, and claims no downstream saving.
