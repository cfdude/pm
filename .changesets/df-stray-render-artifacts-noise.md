- **`render-stamp.json` no longer produces a spurious diff on every `render()` call when
  nothing meaningful changed.** Root cause: `writeRenderStamp()` unconditionally rewrote
  `.conductor/render-stamp.json` on every `render()` invocation, bumping its `renderedAt`
  timestamp even when `state.json` (and therefore the rendered `PROJECT.md` content) hadn't
  changed at all — producing a byte-only diff that had to be manually discarded roughly a
  dozen times across a single dogfooding session. `verify-state` (the mechanism this stamp
  exists for) only ever compares the recorded `stateMtimeMs` against `state.json`'s current
  mtime; it never reads `renderedAt` back for correctness. `writeRenderStamp()` now skips the
  rewrite entirely when the existing stamp's `stateMtimeMs` already matches `state.json`'s
  current mtime, so the sidecar file is only ever touched when something that actually matters
  changed. `.conductor/brief.txt` was confirmed already gitignored in this repo (a prior fix);
  no further action was needed there.
