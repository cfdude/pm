# Pending tooling feedback (awaiting approval to file; nothing here has been filed)

Source: the release-planning-taxonomy build, 2026-11-16. Each item is TOOLING FRICTION worked around
by hand, to be filed with `/pm:feedback` against `cfdude/pm` once Rob approves.

1. **bug: the commit-nudge hook mislabels an epic's own commits as detours.** A commit made for the
   active epic's own work is described as a detour in the nudge text.
2. **feature: a docs-only commit costs a full functional certify (about 8 minutes).** `README.md` and
   `skills/dogfooding/SKILL.md` sit in the functional bucket's certify subject, so a prose edit
   demands the whole functional run. Narrow the subject to what the half actually observes.
3. **bug: `.claude/agent-startup.md` and the briefs disagree on attribution.** The file says an agent
   never runs `update-epic`, yet a brief needs `--attribute-commit` right after each commit. Decide
   who attributes and say it once.
4. **bug: `integrity` flags gate-recorded-as-bookkeeping when the gates were recorded in one command
   batch after reviews that were hours apart.** The recordings landed 2307 ms apart, and the check
   reads recording time, not review time, so it reads as a rubber stamp.
