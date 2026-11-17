---
lesson: a-clause-kept-in-a-tool-generated-file-has-no-home
date: 2026-11-16
trigger: About to add or change a pm clause by editing a file under `.claude/skills/openspec-*` or `.claude/commands/opsx/` — or any file another tool's own header says it regenerates and overwrites.
cost: pm 0.27.0 (commit 543a38fb) hand-edited one clause into OpenSpec's generated archive skill and its command twin. The generated files said `openspec update` overwrites local edits and pm's own brief repeated it, yet the edit shipped. Every repo that took the rules block and regenerates its OpenSpec files may have lost the clause with no warning from either tool; GitHub #262 found it by reading `git diff`. The fix took an epic (a managed-block section, a read-only check, a doc reorder) where one sentence in the right place would have sufficed.
rule: A pm clause that must reach an OpenSpec workflow lives in the managed block's "OpenSpec addenda" section. Never edit `.claude/skills/openspec-*` or `.claude/commands/opsx/*`; the engine writes to none of them and reports any pm text found inside one as RESIDUAL.
enforced_in: the managed block's own practice sentence under "## OpenSpec addenda" (emitted when `openspec/` exists), the `dogfooding` skill (a sentence under the practices list), and the brief's `OpenSpec addenda RESIDUAL` line, which is the real binding point because it reports after the fact on every repo. The detect matcher below covers an Edit on the one file where it happened; a Write, or the command twin, is not covered.
detect: {"tool":"Edit","pathEndsWith":"openspec-archive-change/SKILL.md"}
tags: [generated-files, openspec, silent-loss]
---

**Cause.** The edit was made where the instruction was read, not where it would survive. A generated
file is a cache of someone else's source: whatever pm adds to it lasts only until the generator next
runs, and the generator gives no signal when it erases an addition. The text of the file and pm's
own brief both said so; the warning was present and did not bind, because nothing in the editing
step ties "this file is regenerated" to "so do not put the clause here".

**Practice, named out loud.** This is a PROCESS failure (how we work), not a product gap: the product
side (carry the clause somewhere durable, and report residue) is what #262 built. The rule is
carried by the block sentence and the dogfooding skill; the residual line is the backstop that
catches a repo which did it anyway.

**Evidence limits, so the lesson does not overclaim.** One pm-authored passage was found in the 24
tracked generated files (a throwaway-copy `openspec update` changed only version stamps and one
trailing period, see the sweep beside the plan). That the clause was erased on 2026-10-30 is NOT
shown by git history: no commit removed it, so any loss happened in a working tree. The cost above
is the exposure, not a counted loss.
