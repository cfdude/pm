* **`triage` finds candidates in any script, not only ASCII.** Its tokenizer treated every letter
  outside `a-z` as a separator, so an epic titled in Cyrillic and the identical ask both reduced to
  no words at all and `triage` returned `candidates: []` — the same answer as "nothing overlaps" —
  while an umlaut cut a German word in two. Letters, combining marks and digits of every script
  are now word characters, and text is NFC-normalised first so a composed and a decomposed
  spelling of one word match.
  Chinese, Japanese and Korean text, which puts no spaces between words, is split into
  overlapping two-character tokens, so a reworded ask still finds the epic whose words it shares.
  An epic matched only by those tokens needs a share of them that grows with the ask, so common
  words such as "new" and "feature" do not fill the candidate list.
