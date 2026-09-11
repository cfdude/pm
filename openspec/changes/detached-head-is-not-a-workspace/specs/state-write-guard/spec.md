## ADDED Requirements

### Requirement: A mutating verb announces that it is writing into a detached tree

A verb declared `mutates` MUST report, when the working tree's HEAD is detached, that the write it
is about to make sits in a tree a deploy can discard. It MUST still perform the write.

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
- **THEN** it writes as it normally would, and reports that the tree is detached and that a deploy
  which checks the tree out again will discard the write

#### Scenario: The warning names the tag when HEAD is exactly at one

- **WHEN** the detached HEAD is exactly at a tag
- **THEN** the report names that tag

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
