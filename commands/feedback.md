---
description: File a bug report or feature request for pm directly as a GitHub issue on cfdude/pm
argument-hint: "[bug|feature] \"<short summary>\""
allowed-tools: Bash
---

You've hit something worth reporting back to the `pm` plugin's own maintainers — a bug in the
engine/skill/commands, or a feature you wish `pm` had. Today's workflow is manually copy-pasting
context between sessions; this command posts it straight to GitHub instead.

This is a pure agent-driven workflow — **the engine (`scripts/conductor.mjs`) is never involved
and must never be**. All GitHub calls below are made by you, the interactive agent, via the
`gh` CLI (Bash). This complies with pm's instruction-layer law: the engine never talks to an
external system itself.

1. **Gather the report.** From `$ARGUMENTS` plus the conversation, determine:
   - **Kind:** `bug` or `feature` (ask if genuinely ambiguous — don't guess a bug report into
     a feature request or vice versa).
   - **Title:** a short, specific one-line summary.
   - **Description:** what's wrong / what's wanted, in enough detail for a maintainer with no
     context on this session to act on it.
   - **Relevant context:** for a bug, repro steps, the command/subcommand involved, and any
     error output; for a feature, the concrete use case that motivates it and, if known, which
     lane/command/skill section it would touch.

2. **Check for a near-duplicate before filing anything new.** Search OPEN issues on
   `cfdude/pm` for a close title match:

   ```bash
   gh issue list --repo cfdude/pm --state open --search "<key terms from the title>"
   ```

   Read the results. If one is clearly the same report (not just a loosely related topic),
   **comment on it instead of creating a new issue**:

   ```bash
   gh issue comment <number> --repo cfdude/pm --body "<new details, e.g. a fresh repro or extra context from this session>"
   ```

   Then report that issue's URL back to the user and stop — do not also create a new issue.

3. **If no duplicate exists, create the issue:**

   ```bash
   gh issue create --repo cfdude/pm \
     --title "<title>" \
     --body "<description + relevant context, written as durable standalone text>" \
     --label "<bug|enhancement>"
   ```

   Use label `bug` for bug reports, `enhancement` for feature requests. If the label doesn't
   exist on the repo yet, `gh issue create` will error — fall back to creating the issue without
   `--label` rather than failing the whole report, and note in your reply that the label needs
   to be added on the repo side.

4. **Report back the issue URL** (or the comment/issue URL if you deduplicated) so the user has
   a durable link, and nothing was lost the way manual copy-paste between sessions used to lose
   it.

Do not invoke this against any repo other than `cfdude/pm` — this command is specifically for
feeding back into pm's own development, not a general-purpose issue filer.
