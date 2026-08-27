---
description: Triage an incoming ask against the whole backlog before it becomes an epic — near-duplicate candidates, lane, and backlog shape
allowed-tools: Bash, Read
---

Run this **before** `add-epic`, every time an ask arrives — a GitHub issue you are about to
mirror, a request in conversation, a line from a roadmap doc.

The conductor has always ACCEPTED work; it has not TRIAGED it. `add-epic` validates the id, the
lane and the priority, refuses a duplicate `externalId`, and appends. The only dedup that exists
is **identity-based** — same id, or the same `externalUrl` — which correctly stops `/pm:sync`
from mirroring the same issue twice and does nothing at all about *the same ask arriving under a
different name*. That failure has exactly one symptom: the backlog only ever grows, and every
entry looks equally legitimate.

Measured in this plugin's own repository: `integrity`'s `change-registered-under-two-lanes`
check reports **four live pairs** that are one change registered twice, under different lanes and
different names. Identity dedup found none of them; a human reading the backlog did.

## Get the candidate set

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" triage "<the ask, in its own words>"
```

Optional: `--limit N` (default 5) bounds how many candidates come back. It must be a positive
integer — a valueless or non-numeric `--limit` is refused rather than coerced, and any other
flag is rejected by name. A wrong bound on a recall device silently hides the twin the whole
command exists to surface.

Read-only — it writes nothing and re-renders nothing. It prints one JSON object:

```json
{
  "ask": "Validate link types against a known set",
  "lane": { "lane": "openspec", "matched": "validat*" },
  "backlog": { "total": 115, "open": 63, "byStatus": { "queued": 40, "planned": 23 }, "active": "gh-112" },
  "candidates": [
    { "id": "gh-cfdude-pm-100", "title": "link types have no known set",
      "status": "queued", "lane": "openspec", "priority": "P2",
      "score": 0.71, "shared": ["link", "types", "set"], "superseded": false }
  ],
  "verdict": null
}
```

- **`candidates`** — existing epics that share *distinctive* vocabulary with the ask, ranked.
  Each carries the `shared` tokens that put it there, so you can dismiss a bad hit in a glance.
  Vocabulary the whole backlog uses (`conductor`, `epic`, `plan` in this repo) counts for almost
  nothing; a word only one or two epics use counts for a lot — which is why "Implementation Plan"
  in a title does not drag half the backlog into the result.
- **`superseded: true`** — some other epic already holds a `supersedes` link to this one. It is
  already dead; do not consolidate a fourth ask into it.
- **`lane`** — the repo's own `suggest-lane` answer, carried here so intake is one call, not two.
  `lane: null` means no override matched and the generic heuristic applies.
- **`backlog`** — what is already in flight, so "where does this sit against current priorities"
  has data behind it.
- **`verdict: null`** — see below. It is not a placeholder.

## What this command does NOT do, and why

`pm` is an instruction layer. It emits instructions for you to act on; it does not read prose to
form judgments, and it never decides. So the work is split at exactly one line:

| Mechanical — the engine's | Judgment — yours |
|---|---|
| Which existing epics share distinctive vocabulary with this ask | Whether any of them is **the same ask** |
| Which lane this repo's routing rules pick | Whether that lane is right for this item |
| What the backlog looks like as a set right now | Where this sits against what is in flight |
| Which candidates are already superseded | Whether to consolidate, decline, or register |

A lexical overlap is a reason to **read** an epic. It is never a claim that two asks are the
same, and the engine will not make that claim — `verdict` is always `null`, and no candidate is
ever labelled a duplicate. The command is deliberately tuned for recall: surfacing one epic too
many costs you a glance, missing the twin costs a permanent duplicate.

## Then record what you decided

Leaving the judgment in the conversation is the same failure in a new place. Record it:

```bash
# it relates to existing work
add-epic --id <new> … --link "relates-to:<existing>:<how they inform each other>"

# it REPLACES existing work — two halves, and the second is not optional
add-epic --id <new> … --link "supersedes:<old>:<why this replaces it>"
update-epic <old> --status archived --outcome superseded \
  --reason "replaced by <new>" --no-deferrals   # or --deferral "<epicId>:<section>" /
                                                # --declined-deferral "<what>:<why not>" if the
                                                # old epic projected work the new one won't carry

# the answer is no
add-epic --id <new> … --status untriaged
update-epic <new> --status archived --outcome declined \
  --reason "<why not>" --no-deferrals
```

**Declining is two commands on purpose.** Not every ask should be taken on — but declining by
never registering it destroys the record that anybody considered it, which is the same objection
that made every other ending recordable. Registering and then declining keeps the ask, the
decision and the reason. (Creating an epic directly at `--status archived` will not do: that path
stamps an engine record carrying no reason at all.)

`declined` is a terminal **outcome**, not a status: `archived` already means terminal, and every
status-driven behavior in the engine is unchanged by it. Like every outcome except `delivered`,
it requires a reason. Because it is not `delivered`, the archive gate's Gate 2 demand and its
handoff demand both pass it by — correctly, since no code was ever written.

## Where this fires automatically

The managed rules block emits an **Intake** section carrying this as a numbered procedure, so it
applies on every path that registers an epic: the tracker-sync procedures, `/pm:epic add`, and a
roadmap document read in-session. That section and the sync procedures' `externalUrl` check are
not substitutes for each other — the URL match answers *"have I already mirrored THIS item"*,
triage answers *"is this ask already in the backlog under another name"*. Run both.
