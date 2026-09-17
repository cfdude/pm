---
lesson: ascii-fixtures-hide-a-lossy-decode
date: 2026-09-16
trigger: You are writing code that reads bytes another program wrote — a git reflog or object, a log file, a subprocess's output — decodes them to a string, and later stores, compares or searches for that string, and every fixture you test it with is plain ASCII.
cost: commit-nudge-reads-the-whole-move, Gate 2 finding G2-C1. `anchorOf()` decoded HEAD's reflog as UTF-8 and stored the last line as text. A commit made with `i18n.commitEncoding=ISO-8859-1` writes its subject's raw 0xE9 byte into `logs/HEAD`; the decode stored U+FFFD, the next observation searched for EF BF BD, never found the anchor, re-anchored and reported nothing — the reviewer's repro reported 4 commits as 1, 0, 0, 0, and the lost commits were gone for good, not deferred. Every TDD task, both Gate 1 lenses and the whole suite passed over it, because every fixture subject was ASCII. It took one fix commit (304311e), a follow-up guard (46fa347) and a scoped re-review.
rule: Where bytes come from outside and the program only needs to find them again, keep them as bytes — store them encoded losslessly (base64) and compare Buffers. Decode only what must be read as text, and only the part that is ASCII by construction. Then add one fixture with bytes that are NOT valid UTF-8 (a Latin-1 0xE9 is enough) for every such store-and-compare path, and watch it fail against a decoding version first.
enforced_in: scripts/test/commit-observation.test.mjs "G2-C1 a reflog line that is not valid UTF-8 anchors by its bytes"; design.md Decision 2 (the record stores `anchor.lineBase64`). Beyond this code path, a habit — no mechanism finds a lossy decode.
tags: [testing, fixtures, encoding, git, false-signal]
---

**Cause.** Decoding bytes as UTF-8 never throws in Node: an invalid sequence becomes U+FFFD. The
round trip bytes → string → bytes is therefore lossy for any input that is not valid UTF-8, and it
is lossless for ASCII. A test suite whose fixtures are all ASCII cannot tell the two apart, so the
lossy version passes every test anyone thought to write.

**Why the usual gates miss it.** TDD writes the fixture the author imagined, and authors imagine
ASCII commit subjects. A spec reviewer checks behaviour against the requirement, and the requirement
("report every commit") is met for every input the review has in mind. Only a reviewer who asks
"what bytes can git actually write here?" finds it.

**Why it is expensive when it lands.** Nothing crashes. A store-and-compare that silently stops
matching looks, from outside, exactly like "nothing happened" — which is the one result the hook is
designed to report quietly.

**Where the text half is fine.** The same code still decodes the reflog to parse it: the sha fields
and the `commit` action prefix are ASCII by construction, and commit subjects come from
`git log --format=%s`, which git re-encodes to UTF-8. Keep bytes where equality matters; decode where
reading is all that matters.
