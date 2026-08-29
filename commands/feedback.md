---
description: File a bug report or feature request for pm — via gh, a prefilled GitHub form, or email
argument-hint: "[bug|feature] \"<short summary>\""
allowed-tools: Bash
---

You've hit something worth reporting back to the `pm` plugin's own maintainers — a bug in the
engine/skill/commands, or a feature you wish `pm` had. Today's workflow is manually copy-pasting
context between sessions; this command gets it to the maintainers instead.

This is a pure agent-driven workflow — **the engine (`scripts/conductor.mjs`) is never involved
and must never be**. Everything below is done by you, the interactive agent. This complies with
pm's instruction-layer law: the engine never talks to an external system itself.

## Dependencies — declare them, never assume them

`gh` (the GitHub CLI) **and an authenticated GitHub account** are an OPTIONAL dependency of this
command, not a requirement. Step 3 checks for them; steps 4 and 5 need neither. Do not shell out
to `gh` before that check — an unchecked `gh issue create` on a machine without it fails with a
shell error that explains nothing, which is how this command spent its first fourteen releases
working only for people who happened to have the maintainer's setup (#105).

`curl` is not a substitute. Anonymous issue creation on GitHub returns HTTP 401 and always will;
a PAT is strictly worse than `gh` (same account requirement, hand-managed token instead of the
system keyring). The dependency was never on the CLI — it is on holding a GitHub credential at
all, which is why the fallbacks below avoid credentials entirely rather than swapping the tool.

## 1. Gather the report

From `$ARGUMENTS` plus the conversation, determine:

- **Kind:** `bug` or `feature` (ask if genuinely ambiguous — don't guess a bug report into a
  feature request or vice versa).
- **Title:** a short, specific one-line summary.
- **Description:** what's wrong / what's wanted, in enough detail for a maintainer with no
  context on this session to act on it.
- **Relevant context:** for a bug, repro steps, the command/subcommand involved, and any error
  output; for a feature, the concrete use case that motivates it and, if known, which
  lane/command/skill section it would touch.

## 2. Write the report to a local file FIRST, before choosing a channel

```bash
mkdir -p .conductor/feedback
# write title + body to .conductor/feedback/<YYYY-MM-DD>-<slug>.md
```

Do this every time, on every path, before any network call. Three reasons, and all three have
happened:

- every channel below can fail, and a report that exists only in the conversation is lost when
  the session ends;
- a body too long for the prefilled URL (step 4) needs somewhere to live so the user can paste
  it;
- the user may want to send it another way entirely, and "the content is at this path" is a
  complete answer where "filing failed" is not.

Tell the user this path in your reply whichever channel you end up using.

## 3. Preferred channel — `gh`, when it is actually available

Check BOTH, and treat either failing as "this channel is unavailable" rather than as an error to
report:

```bash
command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1 && echo AVAILABLE
```

When available, this is the preferred path whenever it is available, not merely a faster one —
no browser, no login, no context switch, and the report lands the moment you have it.

**Check for a near-duplicate before filing anything new.** Search OPEN issues on `cfdude/pm`
for a close title match:

```bash
gh issue list --repo cfdude/pm --state open --search "<key terms from the title>"
```

Read the results. If one is clearly the same report (not just a loosely related topic),
**comment on it instead of creating a new issue**:

```bash
gh issue comment <number> --repo cfdude/pm --body "<new details, e.g. a fresh repro or extra context from this session>"
```

Then report that issue's URL back to the user and stop — do not also create a new issue.

If no duplicate exists, create the issue:

```bash
gh issue create --repo cfdude/pm \
  --title "<title>" \
  --body "<description + relevant context, written as durable standalone text>" \
  --label "<bug|enhancement>"
```

Use label `bug` for bug reports, `enhancement` for feature requests. If the label doesn't exist
on the repo yet, `gh issue create` will error — fall back to creating the issue without
`--label` rather than failing the whole report, and note in your reply that the label needs to
be added on the repo side.

## 4. No `gh`, or not authenticated — hand the user a prefilled issue form

Build a URL and give it to the user to open. Do not fetch it yourself; the point is that THEY
submit it, in their own browser, as themselves.

```
https://github.com/cfdude/pm/issues/new?title=<urlencoded title>&body=<urlencoded body>&labels=<bug|enhancement>
```

Two properties make this more than a fallback:

- **No credential ever touches the plugin.** Nothing to configure, nothing to leak, nothing to
  expire. An unauthenticated `GET` returns 302 — GitHub redirects to sign-in and then to the
  prefilled form.
- **Correct attribution.** The issue is authored by the person who actually hit the problem,
  rather than by whichever account the machine happens to hold.

**Measured length ceiling, and it is the real constraint.** ~6 KB of URL works (HTTP 302); ~7 KB
returns HTTP 500 and ~16 KB returns HTTP 414. After percent-encoding, markdown inflates roughly
1.5–2×, so the safe budget is **~3 KB of raw body**. When the report is longer: truncate the
body in the URL, end it with a pointer to the local file from step 2, and tell the user to paste
the rest from there. Never silently send a truncated report — a report that looks complete and
is not is worse than one that is obviously short.

Duplicate-checking is not possible on this channel without a credential. Say so in one line
rather than implying the search happened.

## 5. Doesn't want to use GitHub at all — email

A user with no GitHub account, or who does not want one, still has feedback worth having. Offer:

> **bugs@pm-plugin.dev**

Attach or paste the file from step 2. This channel exists because without it every "would you
like to file this?" prompt is really a request to create a GitHub account, the user says no, and
the plugin reads that as "no feedback" — losing the signal from exactly the users least invested
in its tracker.

`none` is a legitimate answer too. If the user declines all three, say the report is saved at
its local path and move on; do not re-offer for the rest of the session.

## 6. Report back

Give the user the issue URL (or the comment URL if you deduplicated, or the prefilled URL, or
the email address) **and** the local file path from step 2, so nothing was lost the way manual
copy-paste between sessions used to lose it.

Do not invoke this against any repo other than `cfdude/pm` — this command is specifically for
feeding back into pm's own development, not a general-purpose issue filer.
