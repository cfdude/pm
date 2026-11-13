## MODIFIED Requirements

### Requirement: Every engine invocation pm ships is one the installed engine accepts
Every engine invocation pm emits or ships SHALL pass the engine's own pre-dispatch command-line
check once its documented placeholders are filled. The population SHALL be derived from the
sources at test time, never typed as a list: the rules block rendered for every supported platform
and every tracker role, system class and direction, and under every usage answer of the managed
rules block (autonomy off, release candidate off, both off); the brief; `integrity`; the archive gate's
refusals; `unconsidered-outcomes`; `init`'s output; the commit nudge; and every shipped document an
agent reads (`commands/*.md`, `skills/**/SKILL.md`, `agents/*.md`, `README.md`). An invocation
written as alternatives (`(--a | --b)`, or whole forms separated by `|`) SHALL be checked once per
alternative.

A shipped document that deliberately shows an invocation the engine refuses SHALL mark that one
invocation in its own source, and the marker SHALL name the refusal class it demonstrates. The
engine's refusal SHALL carry a class the check can compare. A marked invocation that is accepted,
or refused for a different class, fails; a marker binds to exactly one invocation. Engine output
quoted in shipped text is not an invocation and SHALL be distinguishable from one.

Shipped command documents and agent documents SHALL invoke the INSTALLED engine, never a path that
exists only in a checkout of pm itself, and SHALL NOT instruct a user's agent to work on files that
exist only in pm's own repository (its `README.md` or `scripts/test`). A shipped statement that the
engine cannot do something SHALL be true of the engine. Every `/pm:<name>` reference in shipped text SHALL name a
command or skill pm ships; this check reads the name only, not the words after it.

#### Scenario: An unmarked refused invocation fails the sweep
- **WHEN** a shipped document contains an unmarked engine invocation carrying a flag its verb does
  not declare
- **THEN** the sweep fails naming the file, the line and the refusal class

#### Scenario: A marker must match the refusal it claims
- **WHEN** a shipped document marks an invocation as a refused example of one class, and the engine
  accepts it or refuses it for another class
- **THEN** the sweep fails naming the marker, the expected class and what the engine did

#### Scenario: A marker does not reach a neighbouring invocation
- **WHEN** a marked refused example is followed on the same or the next line by an unmarked
  invocation the engine refuses
- **THEN** the sweep fails on the unmarked one

#### Scenario: Both halves of an alternative group are checked
- **WHEN** a shipped form reads `push-detour <parent> --detour <id> --reason "<why>" (--reconcile |
  --no-reconcile)`
- **THEN** the sweep checks one invocation with `--reconcile` and one with `--no-reconcile`, and both
  pass

#### Scenario: A reference to a command pm does not ship fails
- **WHEN** a shipped document names `/pm:integrity`, which is neither a shipped command nor a
  shipped skill
- **THEN** the sweep fails naming the reference (today `commands/upgrade.md` does)

#### Scenario: The child agent doc gives no pm-repository-only instruction
- **WHEN** `agents/hierarchy-child-executor.md` is scanned
- **THEN** it does not instruct updating pm's `README.md` or running `scripts/test/*.test.mjs` (today
  its "check README.md" paragraph does)

#### Scenario: review-mode.md does not deny an unset the engine has
- **WHEN** `commands/review-mode.md` describes clearing a per-epic review-mode override
- **THEN** it names `update-epic <id> --clear review-mode` and does not say there is no unset (today
  it says there is no separate unset, while `--clear review-mode` clears the override)

#### Scenario: A shipped command document invokes the installed engine
- **WHEN** a command document instructs the agent to run an engine verb
- **THEN** the invocation goes through the installed engine, and `node scripts/conductor.mjs` in
  `commands/cross-spec-review.md` fails the sweep

#### Scenario: The usage-off renders are swept
- **WHEN** the rules block is rendered with autonomy off, with release candidate off, and with both off
- **THEN** every invocation in the `## Procedures emitted on use` section passes the check, alongside the full render's
