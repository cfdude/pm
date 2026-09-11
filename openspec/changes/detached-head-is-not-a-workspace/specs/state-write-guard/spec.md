## ADDED Requirements

### Requirement: A mutating verb announces that it is writing into a detached tree

A verb **not declared `read-only`** MUST report, when the root working tree's HEAD is detached, that
the write it is about to make sits in a tree a deploy can discard. It MUST still perform the write.

The predicate is `not read-only`, NOT `is mutates`. The gate it reuses is
`VERB_EFFECTS[cmd]?.effect !== "read-only"`, so an UNRECOGNISED verb has no entry, reads as
not-read-only, and warns — deliberately, and asserted by the existing suite against a literal source
string. Specifying `mutates` would force either a second divergent gate or an implementation that
violates this text while satisfying the design, which is the staleness this reuse exists to avoid.

> A deploy that runs `git checkout --force` discards any uncommitted state the engine wrote, so a
> `/pm:upgrade` in a deployed checkout reports success and then vanishes at the next release. That
> is the silent-success shape this project has spent several releases closing, and the remedy is
> the same one used everywhere else: say what happened, rather than deciding for the operator.
>
> It WARNS rather than REFUSES because detachment is a cheap signal with deliberate false positives
> — a bisect, a review of an old release — and refusing would break legitimate work to protect
> against a case the operator can see once it is named.

#### Scenario: A mutating verb in a detached tree warns and still writes

- **WHEN** a verb declared `mutates` runs in a working tree whose HEAD is detached
- **THEN** it writes as it normally would, and reports ON A CHANNEL THAT REACHES THE INVOKING
  SESSION that the tree is detached and that a deploy which checks it out again will discard the
  write, NAMING the files it wrote

> Two constraints, and each has already been a defect in this capability. **Delivery**: a warning
> composed into `.conductor/brief.txt` or `PROJECT.md` is written by a hook and read back by
> nothing — this capability already carries a requirement that a warning is consumed only where it
> reaches a session, and a new warning filed beside it without that constraint reintroduces exactly
> what the sibling forbids. Standard error on the invocation satisfies it. **Naming what was
> written**: `upgrade` writes five things, four of them tracked in a typical repository, while some
> of them are suppressed by the sibling requirement — so a generic "the write" tells the operator
> that a write will be discarded while pointing at the one write that no longer happens.

#### Scenario: The warning names the tag when HEAD is exactly at one

- **WHEN** the detached HEAD is exactly at a tag
- **THEN** the report names that tag, resolved with `git describe --tags --exact-match HEAD`

> `--tags` is load-bearing: without it `describe` considers annotated tags only, and a deploy that
> checks out a LIGHTWEIGHT tag is entirely ordinary. Where several tags point at the same commit,
> `describe` reports one of them arbitrarily; that is accepted, because the tag is context for a
> human rather than an identifier anything keys on.

> `detached at v2.11.0` identifies a deployment to a reader; `detached` alone does not. The tag is
> CONTEXT in the message and never a CONDITION on the check: requiring a tag match would miss every
> deploy that checks out a sha, and a signal with silent false negatives is what this change exists
> to remove.

#### Scenario: A read-only verb is silent

- **WHEN** a verb declared `read-only` runs in a working tree whose HEAD is detached
- **THEN** it produces no detached-tree warning

> Reading a deployed checkout's record is a legitimate thing to want, and the warning is about a
> write. Crying wolf on the read-only verbs is the defect 0.41.0's sibling fix removed from the
> WRITING-A-DIFFERENT-REPOSITORY warning; this check must not reintroduce it one release later.

#### Scenario: A tree on a branch produces no warning

- **WHEN** a mutating verb runs in a working tree whose HEAD is on a branch
- **THEN** no detached-tree warning is produced

#### Scenario: An unrecognised verb in a detached tree warns

- **WHEN** a verb the effects table does not declare runs in a working tree whose HEAD is detached
- **THEN** the warning is produced

> This mirrors the divergence warning it sits beside: a verb nobody declared is not evidence that
> it is safe, and reading an absent declaration as read-only would make every new verb silently
> exempt until someone remembered to add a row.
