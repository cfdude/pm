* **The commit hook no longer logs an epic's own small chore commits as AUTO-DETOURs.** The `chore(...)`/`fix(...)`
  plus small-diff shape also describes an epic whose deliverables are manifests and ledgers. A commit is now left
  out of the detour trail when the record ties it to the active epic: it is already attributed to an epic (the
  active one or another), its subject names the active epic's id, or every path it changed was already changed by
  a commit attributed to the active epic. One shared file is not enough. (gh#213)
* **A commit another epic already holds is not offered for attribution again.** The attribution paragraph names
  the holder (`<sha> is already attributed to <id> — not offered again`) instead of printing an
  `update-epic … --attribute-commit` line that would put one epic's work in another's Gate 2 range.
* **An auto-logged commit that is also offered for attribution is called one-or-the-other.** The two messages
  used to contradict each other; the AUTO-DETOUR message now says that a commit named in both is either the
  epic's own work (attribute it AND `retract-detour` its row) or a detour (attribute nothing).
