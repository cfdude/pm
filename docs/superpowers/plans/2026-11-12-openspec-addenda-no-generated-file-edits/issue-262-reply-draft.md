# DRAFT reply to cfdude/pm#262 (not posted; awaiting Rob's approval)

Thanks for the careful write-up. Most of it held up when I re-checked it against the repo; one premise did not, and
it changes who was affected.

**What held.** 0.27.0 (`543a38fb`) added the clause "a spec the sync deliberately kept and reported is also a match"
to `.claude/skills/openspec-archive-change/SKILL.md` and `.claude/commands/opsx/archive.md`, which `openspec update`
rewrites. That was a mistake: pm should never have kept a clause in a file another tool regenerates.

**What did not hold: "shipped to every repo".** Those two files are this repository's own checked-in OpenSpec install
(`.claude/` at the repo root). They are not part of the plugin: the plugin ships `commands/`, `skills/`, `agents/`,
`hooks/` and `.claude-plugin/`, and `rg "deliberately kept"` finds the clause in none of them and in no part of the
managed rules block. So no other repo ever received the clause from pm, and none lost it. The exposure was this repo's
own archive check, not a fleet-wide regression. Also, I could not confirm the erasure itself from history: no commit
removed the clause, and `ab1e1552` (the 1.13.2 to 1.15.0 update commit) says it kept the allowance, so any loss
happened in a working tree and was caught before commit.

**What changed.** The clause now lives in an `## OpenSpec addenda` section of the managed rules block, emitted only
when `openspec/` exists (a repo without it pays 0 bytes). pm removed its hand edit from the two generated files and
the engine writes to no OpenSpec-generated file. The brief and `/pm:upgrade` print two read-only findings: RESIDUAL
(pm text found inside a generated file) and MISSING (the repo uses OpenSpec but the block has no addenda section),
both pointing at `openspec update --dry-run`. The engine still never runs `openspec`. `/pm:upgrade` step 4 now says run
`openspec update` first, then `/pm:upgrade`. Option (a) from your ask, plus a read-only slice of (b).

**Still open.** Whether `openspec update` rewrote any pm content in `CLAUDE.md` is unverified; git history shows no
removal. Related: #261 (the `/opsx:verify` collision, whose guardrails now ship in the same section) and #266 (the
HOLD list naming every unarchived change).
