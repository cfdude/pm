---
lesson: a-silent-noop-edit-reports-success
date: 2026-09-08
trigger: About to apply an edit by string substitution — `str.replace`, `sed s///`, a scripted patch — to a file you are not going to read back, especially several edits in one script.
cost: Two of three fixes in a Gate 1 fix pass changed ZERO BYTES and the script printed "C1, I4, I6 applied". Both patterns had missed on line wrapping alone. The miss was invisible for an hour and was caught only because a reviewer quoted, as an open finding, the exact text believed already replaced — and the review that caught it was already running when the fix was written, so nothing would have caught it otherwise. A downstream `openspec validate --strict` passed on both the fixed and unfixed content, because valid was never the property in question.
rule: A substitution that misses is a no-op, and a no-op is indistinguishable from success unless you count matches. Assert the count — `re.subn` and compare, `grep -c` after `sed` — and make a miss exit non-zero. Never print "applied" from a line the substitution cannot reach.
enforced_in: habit — assert-the-match-count; no mechanism. The nearest mechanical cousin is the read-back verification `update-epic` performs after writing. The `detect:` matcher fires on an in-place `sed -i` on a Bash command's first line; a `.replace(` inside a script is source text no matcher can see, so that half stays a habit.
detect: {"tool":"Bash","commandMatches":"(^|[;&|]\\s*)sed -i"}
tags: [verification, false-signal, tooling, silent-failure]
---

**Cause.** Substitution APIs are total functions. `"abc".replace("x", "y")` is `"abc"` — not an
error, not a warning, not a distinguishable return value. Write that back to disk and the file is
byte-identical to what it was, the script exits zero, and any message printed after it is a claim
about intent rather than about what happened.

The failure needs no unusual conditions. Both misses here were **line wrapping**: the pattern was
copied from a document whose lines broke in one place and pasted against a file whose lines broke
in another. The words were identical. The bytes were not.

**Why it survives the checks you already have.** A validator downstream answers a different
question. `openspec validate --strict` reported *valid* on the unfixed content and would have
reported *valid* on the fixed content too — validity was never the property under change. A test
suite behaves the same way. Nothing in the pipeline is watching for "this edit did not happen",
because every tool assumes the edit happened.

**The shape to recognise.** This is the same defect this repository has now named three times in
different clothes: a guard that checks the wrong half; a flag that parses and writes nothing; a
substitution that matches nothing. In all three an operation completes, reports success, and
changes nothing — and the report is what stops anyone looking. See
[[a-guard-can-check-the-wrong-half]], and `update-epic`'s exit-0-write-nothing class (#79).

**What to do instead.**

```python
new, n = re.subn(pattern, repl, s, count=1)
if n != 1:
    sys.exit(f"FAILED {label}: matched {n}, expected 1 — nothing written")
```

For `sed`, count afterwards: `grep -c 'expected new text' file` and fail on zero. The cost is one
line per edit and it converts an invisible failure into a loud one.

**And when a batch is involved, order matters.** A script that exits on the first miss leaves
earlier edits applied and later ones not — a partial state that looks like a complete one. Either
apply every edit to an in-memory copy and write once at the end, or report exactly which edits
landed. Printing a summary line for the whole batch is what turned two silent misses into a
believed success here.
