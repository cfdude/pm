* **An epic now records which named sessions wrote it, and `--session` works on every epic-writing verb.**
  `--session <name>` (fallback `PM_SESSION`) was declared for `claim` and `unclaim` only. It is now accepted on
  every verb whose save can change an epic, declared once through the shared flag registry and derived from the
  effects registry's `epicWriting` marker. When a save changes an epic and an identity resolves, the same write
  appends it to `epic.sessions`: one `{session, firstAt, lastAt}` entry per distinct name, in first-seen order
  (`sessions` is engine-written history, set-only). No identity, no field; a no-op write records nothing; a
  hook's save never stamps. **Behaviour change on `claim` and `unclaim`:** the identity is now validated for
  every non-hook verb before any write (non-blank, at most 128 characters, no control character), so a
  `--session` or `PM_SESSION` holding a control character, which `claim` used to store, is refused. A stored
  claim written earlier is still printed escaped. No migration: `sessions` is additive and optional.
