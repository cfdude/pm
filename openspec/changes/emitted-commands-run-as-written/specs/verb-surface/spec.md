## ADDED Requirements

### Requirement: A lone `--` ends flags on a free-text verb
On a verb whose positionals are free text — `triage`, `suggest-lane`, `log-detour`, `honcho-memory` —
a lone `--` token SHALL end flag recognition: every token after it is a positional, whatever its
shape, and the `--` itself is not a positional. On every other verb a lone `--` keeps today's
treatment. Where a free-text verb refuses a flag-shaped token as an undeclared flag, the refusal SHALL
name `--` as the way to pass that text, because quoting the value — the hint it gives today — does not
change the token the verb receives.

This exists so an emitted recipe can pass third-party text (an issue title) to a free-text verb with
one form that works for every title. Measured: `suggest-lane '--limit=5 ignored'` exits 1 with "If
'--limit=5 ignored' is part of the text, quote the whole value" — the value was already quoted.

#### Scenario: A flag-shaped text after `--` is the text
- **WHEN** `suggest-lane -- '--limit=5 ignored'` runs
- **THEN** it exits zero and routes on the text `--limit=5 ignored` (today it exits 1)

#### Scenario: `--` does not open a second text on a one-text verb
- **WHEN** `suggest-lane -- fix a typo` runs
- **THEN** it exits non-zero naming `a`, as `suggest-lane fix a typo` does

#### Scenario: The refusal names the form that works
- **WHEN** `triage --foo` runs
- **THEN** it exits non-zero, writes nothing, and its message names `--` before the text as the way to
  pass a flag-shaped ask
