# What pm costs every session: the rules block and the SessionStart brief

Measured 2026-10-07 on pm's own repository with `conductor.mjs rules --sections --platform claude-code`
(the block that would be written) and `conductor.mjs render` (the on-disk block and the brief). Tokens are
bytes/4, an estimate. Epic: `rules-block-session-cost`.

## The two costs

| Cost | Bytes | Est. tokens | Paid by |
| --- | --- | --- | --- |
| Managed rules block in CLAUDE.md | 40,087 | ~10,022 | every session, every dispatched agent |
| SessionStart brief, before the cap | 78,275 | ~19,569 | every session start (not agents) |
| SessionStart brief, after the 16,384-byte cap | 16,034 | ~4,009 | every session start |

The brief is the one that grows with a repository's history. On pm's own repo, RELEASES, DISPOSITIONS,
GATE REVIEWS, HANDOFFS and EPIC LINKS are all but the first ~1.7 KB of it. This repo is the extreme case;
a young repo's brief is a few KB and the cap never fires. The cap keeps the head, a visible marker, and the
last three paragraphs (lifecycle-marker reminder, the RULES reminder, the "Manage with" line). PROJECT.md
embeds the full text, which is where the marker points.

## The rules block, ranked

| # | Section | Bytes | Share |
| --- | --- | --- | --- |
| 1 | The gate procedure: required task items | 11,963 | 29.8% |
| 2 | PM Conductor: operating rules (items 1-3 and the preamble) | 5,939 | 14.8% |
| 3 | GitHub issue sync (cfdude/pm) | 5,498 | 13.7% |
| 4 | Intake: triage an ask against the whole backlog | 4,021 | 10.0% |
| 5 | Epic-level autonomy | 3,137 | 7.8% |
| 6 | Reporting | 2,853 | 7.1% |
| 7 | Execution profile | 1,958 | 4.9% |
| 8 | Re-read the source before an epic becomes the work | 1,644 | 4.1% |
| 9 | Release candidate | 1,173 | 2.9% |
| 10 | Feedback | 776 | 1.9% |
| 11 | Getting help with pm | 721 | 1.8% |
| 12 | Sync after completing tracker-linked work | 404 | 1.0% |

## Candidates to move to on-demand skills (a later epic's call)

Constraint, from the adoption evidence: the gate procedure's numbered items 1-7 stay in the block. A rule
carried by a required task item reached 14/14 changes; the same rule as a prose bullet reached 3/15. That
section (29.8%) and the operating rules (14.8%) are not candidates.

What is left is guidance an agent needs only when it is doing one specific thing:

| Section | Bytes | Needed when | Notes |
| --- | --- | --- | --- |
| GitHub issue sync (cfdude/pm) | 5,498 | running `/pm:sync` against a tracker | Tracker-specific text emitted per configured tracker; already absent in a repo with no tracker. Strongest candidate: needed only at sync time, and the procedure is a verb-adjacent recipe. |
| Intake | 4,021 | registering a new epic | Only at the moment of `add-epic`. `/pm:triage` already exists to carry it. |
| Epic-level autonomy | 3,137 | an epic is flipped to autonomous | Rare; the `conductor` skill already holds the preflight scan. |
| Reporting | 2,853 | the end of a hierarchy or autonomy run | Mostly a statement of precedence over the user's own contract. |
| Execution profile | 1,958 | dispatching a job | Has live per-repo values in it (project and lane settings), so it is data as well as prose. |
| Re-read the source | 1,644 | an epic becomes active | |
| Release candidate | 1,173 | building a release | Already points at the `release-candidate` skill. |

Summed: 20,284 bytes (about 5,071 tokens, 50.6% of the block). Moving all of it would leave about 19.8 KB
(~4,950 tokens) in the block.

Risk to weigh before moving any of it: a skill is a pull, and an agent has to decide to pull it. The
evidence above is that pulls are adopted less reliably than pushes. The sections whose trigger is a verb the
engine runs itself (GitHub issue sync at `/pm:sync`, Intake at `/pm:triage`) are the safest, because the
engine can emit the text at that moment instead of relying on the agent to remember to load it.

## What this pass does and does not do

Does: measures both costs, reports them in `/pm:upgrade` and `/pm:status` output, caps the brief at 16,384
bytes with a visible marker, and prints the ranked table with `rules --sections`.

Does not: change a byte of the rules block.
