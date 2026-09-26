* **One tracker item maps to one epic on every write path.** The duplicate check ran only when
  `add-epic` was given `--external-id`. So `add-epic --external-url` alone, `update-epic
  --external-url` and an `add-many` entry carrying `externalUrl` could each register a second
  epic for an issue already mirrored, and every one of those commands exited 0. All of them, and
  the inward sync through its `add-epic` line, now refuse a tracker item another epic already
  holds. The refusal names that epic and its status, and names the key that actually matched; it
  used to say `external-id` even when the URL was the match. An archived epic still holds its
  item. For an item that was genuinely reopened, `update-epic <holder> --clear external-url` frees
  it. Two entries of one `add-many` batch cannot claim the same item either. A `state.json` that
  already holds a duplicate still loads, and a write to either epic that does not set the key
  still goes through.
