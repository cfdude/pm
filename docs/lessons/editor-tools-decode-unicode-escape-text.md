---
title: The agent's tool calls decode backslash-u escape text into the raw character
trigger: You are about to write or edit source through the agent's Write, Edit or Bash tool, and the
  text contains a JavaScript or JSON escape spelled out as text (backslash, "u", four hex digits —
  a regex class over U+0000..U+001F, a string holding U+2028) that must land on disk as those six
  characters.
cost: Four times in one change (archive-gate-reads-what-it-writes, 2026-09-14). An Edit put raw C0
  bytes into `scripts/lib/update-epic.mjs`; the tests still passed, and only a `Bin` line in
  `git show --stat` exposed that git now treated the engine as a binary file (fixed in b9a3826).
  Then a Write produced a patch script whose regex held raw control bytes and failed with
  `SyntaxError: Invalid regular expression`; an Edit could not match an old_string holding the
  escape text; and two Bash commands carrying it were refused for containing control characters.
  About 20 minutes of misdirected debugging.
rule: Never spell a backslash-u escape literally in any tool call. Apply the change with a script
  run through Bash that builds the escape from parts ("\\" + "u" + hex), refuse inside that script
  to write any raw control or separator character, and after the commit confirm `git show --stat`
  shows line counts, not `Bin`.
enforced_in: retrieval only — no mechanical check. The Bash tool's refusal of a command carrying a
  raw control character is the only signal, and a Write or Edit gives none.
---

## What happened

The regression refusal in `update-epic.mjs` needs a control-character class. The implementing
subagent wrote it with Edit, and the file received the characters themselves instead of the escape
text. JavaScript accepts a regex literal holding raw C0 bytes, so every test passed, and the defect
showed only as `Bin` in `git show --stat`. A Gate 2 diff of a file git calls binary shows nothing.

Widening the class at Gate 2 hit the same wall. Edit said it had tried swapping the escapes and
their characters, so its old_string had been decoded before matching. A Write of a Node patch
script decoded the escapes in that script's own safety check, so the script failed to parse. Two
Bash commands carrying the escape text were refused outright. The decoding happens where the tool
call is read, not in any one tool, and a double backslash is what survives it.

## What worked

A Node script that builds every escape as `"\\" + "u" + hex`, replaces exact substrings once each,
and walks the finished text by code point to refuse writing any C0 (except tab, LF, CR), DEL, C1,
U+2028 or U+2029. Then rg over `scripts/` for raw control and separator characters, and
`git show --stat` to confirm line counts.

## Kind

A process failure with an external cause: the agent tooling, not pm. Reported to the Claude Code
maintainers as tooling friction; this file records how we work around it here.
