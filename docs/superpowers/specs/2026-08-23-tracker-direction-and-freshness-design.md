# Design: tracker direction, freshness watermark, and the refresh gate

**Epics:** `gh-109-tracker-sync-direction` (P1) · `gh-102-sync-blind-to-issue-comments` (P2) ·
`gh-103-tracker-refresh-gate-before-specs` (P2)
**Issues:** cfdude/pm#109, #102, #103 · **Date:** 2026-08-23 · **Engine:** 0.26.0 → 0.27.0

Three issues, one contract. #109 says *where items are allowed to flow*; #102 says *when we last
looked*; #103 says *look again before you commit*. They share one schema surface (the tracker
block plus two new epic fields) and one failure mode — a rule applied at one emitter and not the
other — so they are designed together and shipped together.

> #110 (Gate 2 bypassed by the archive hook) also ships in 0.27.0. It does not interact with any
> of this: it concerns `update-epic --status archived`'s Gate 2 refusal, which reads
> `epic.gateReview` and nothing in the tracker block. No shared field, no shared call path.

---

## The defect

### 1. Direction is hardcoded to the vendor's name, and only one emitter got the memo

`scripts/lib/rules.mjs:203` suppresses the entire outward mirroring section by testing the
tracker's *system name*:

```js
// scripts/lib/rules.mjs:197-203
// github-issues is deliberately INWARD-only (issues -> untriaged epics, below): auto-filing
// a GitHub issue for every unmirrored local epic is a much bigger, more consequential
// default (silently creating public GitHub issues) than mirroring toward an internal
// Jira/Linear instance, so the outward "External tracker sync" section is suppressed
// entirely for this system. jira/linear/any other tracker system keeps full bidirectional
// outward-mirror instructions, unchanged.
if (sys !== "github-issues") {
```

`scripts/lib/briefing.mjs:115-123` emits outward instruction too, gated only on a tracker
existing:

```js
// scripts/lib/briefing.mjs:115-123
if (state.tracker && state.tracker.system) {
  const tr = state.tracker;
  …
  const unmirrored = epics.filter(e =>
    ["queued", "active", "paused"].includes(e.status) && !missing(e) && !e.externalId);
  L.push(`TRACKER SYNC (${tr.system}${scope}):`);
  if (unmirrored.length) {
    L.push(`  ⚠ not yet in ${tr.system} — create issues + record keys (update-epic): ` + …);
```

So a `github-issues` repo gets a rules block containing **no outward procedure at all** and a
SessionStart brief **demanding outward action every session**. Verified live: this repo's brief
names 5 epics; the `mi-docs` repo's named 29. An agent that complies files dozens of public
issues; there is no bulk undo. Agents have been declining it by judgment, and every session pays
to re-derive that judgment.

The vendor test is also just wrong as a rule. GitHub Issues is perfectly capable of bidirectional
use; Jira is perfectly capable of inward-only use. `sys !== "github-issues"` encodes one repo's
convention as a property of a vendor.

### 2. "bidirectional" in the docs is a misnomer, and it matters for the migration

`skills/conductor/SKILL.md:107-108` and `commands/tracker.md:99` both describe the non-github
primary path as a "full bidirectional mirror". Read against the code, both directions named are
*outward*:

- epic without `externalId` → **create** the issue (outward)
- epic changes status → **transition** the linked issue (outward)

There is exactly one inward-pull section in the whole engine, `rules.mjs:228`, and it is gated
`sys === "github-issues" && tracker.repo`. **A Jira primary tracker has never had an inward pull
instruction.** This is load-bearing for the migration (§ Migration) and the docs' wording has to
be corrected along with the code.

### 3. Sync establishes existence parity and never re-reads (#102)

`sync()` (`scripts/lib/subcommands.mjs:224-255`) is entirely local — OpenSpec changes and
Superpowers plans on disk. The tracker half is instruction, emitted at `rules.mjs:238-247`, and
it stops at existence: `gh issue list --json number,title,url,labels` → skip anything already
carrying that `externalId` → register the rest. Once `externalId` is recorded, the issue is never
looked at again. There is no field on an epic recording *when* the external item was last read,
so "has it changed since we looked?" has no answer to compute against.

Measured on this tracker: 16 of 23 open issues carry comments; the local epics record none of
them. #92's ask was superseded by a comment after it was mirrored, triaged and prioritised; #66
escalated from papercut to hard archive block in a comment three days after filing. Both were
found because a human said "go look at the comments."

The dangerous property is that **sync reports success and parity is genuinely maintained** — every
open issue does have an epic. What drifted is content, which sync never claimed to track.

### 4. A fourth, smaller defect found while enumerating

`rules.mjs:286-299` emits "Sync after completing tracker-linked work" whenever
`hasInwardPullTracker` — which is true for a `github-issues` primary. Its text reads *"After you
close/transition a tracker-linked issue as part of completing an epic (the writeback steps
above)"*. For a `github-issues` primary with no secondary trackers there **are no writeback steps
above**: completion writeback is emitted only in the secondary-tracker loop (`rules.mjs:279-283`).
This repo's own `CLAUDE.md` carries that dangling reference today.

---

## Approach

**One field, `direction`, on the tracker block; read by every emitter through one helper; never
inferred from the vendor again.**

```
tracker: { system, instance?, projectKey?, mechanism?, repo?, statusIntent?, direction? }
direction ∈ "inward" | "outward" | "both"
```

Set via `set-tracker --direction <d>`. Default for a **new** tracker: `inward`.

### What each direction means

| | Rules block emits | Brief's TRACKER SYNC | `/pm:sync` instructs |
|---|---|---|---|
| **`inward`** | `## Tracker inward sync (<sys> · <scope>)` — list open items, dedup, `add-epic --status untriaged`, stamp the watermark. **No** outward section. | No drift line. Instead: `⚠ N tracker-linked epics never re-read since mirroring` when that count is non-zero. | Pull new items in; diff `updatedAt` against each epic's `externalUpdatedAt`; read the movers. |
| **`outward`** | `## External tracker sync (<sys> · <scope>)` — create an issue for any epic lacking `externalId`; transition on `statusIntent`. **No** inward section. | `⚠ not yet in <sys> — create issues + record keys (update-epic): …` | Nothing external. Local OpenSpec/Superpowers registration only. |
| **`both`** | Both sections, in that order. | Both lines. | Both. |

The inward section is **generalized off GitHub**. Today it hardcodes `gh issue list`; under
`direction: "inward"` a Jira or Linear primary needs the same shape with its own tooling. The
generic form already exists and is proven — `rules.mjs:265-267` emits exactly this for secondary
trackers:

```js
...(st.system === "github-issues" && st.repo
  ? [`1. \`gh issue list --repo ${st.repo} --state open --json number,title,url,labels\`.`]
  : [`1. List open issues in ${st.system}${scope ? ` (${scope})` : ""} with your own tooling.`]),
```

The primary inward section adopts that branch verbatim, so a `github-issues` primary keeps its
literal `gh` command and every other vendor gets the generic instruction.

**Dedup in the generalized inward section is by `externalUrl`, not bare `externalId`.** Issue
numbers are unique only within one tracker/repo. The secondary block already argues this
(`rules.mjs:268-273`) and `add-epic.mjs:193-194` already implements URL-preferring dedup:

```js
if (externalUrl !== undefined && e.externalUrl !== undefined) return e.externalUrl === externalUrl;
if (externalUrl === undefined && e.externalUrl === undefined) return e.externalId === externalId;
```

A primary that can now be inward for any vendor inherits that reason. Do not restate the older
`externalId`-only rule when generalizing.

### What `direction` deliberately does NOT govern

**Status/completion writeback on an item that is already linked.** Closing an issue you were
handed is honoring a link you already recorded, not creating work in someone else's tracker. It
follows the link, not the direction — which is precisely why secondary trackers do writeback today
while being inward-only (`rules.mjs:279-283`). Keeping writeback out of `direction` is what lets
secondary trackers be expressed as `direction: "inward"` with **no exception clause**.

### Alternatives rejected

| Alternative | Why rejected |
|---|---|
| Patch `briefing.mjs` to mirror `rules.mjs:203`'s `sys !== "github-issues"` test | Fixes the symptom and leaves the rule expressed twice, keyed on a vendor name, in two files. The next emitter added is the next #109. |
| Boolean `inwardOnly` on the tracker block | Cannot express outward-only, which is exactly what every existing Jira repo is. Three states are needed and pretending there are two is what created this. |
| Per-epic `direction` override | No motivating case. Provenance (`externalId`) already distinguishes per-epic behavior where it matters — see § The refresh gate. |
| Derive direction at read time from whether any epic has an `externalId` | A state-transition/configuration value derived from current state. CLAUDE.md's own law, learned from `reconcileNeeded`: *"State-transition flags are not pure functions of current state."* |

---

## Freshness: the watermark (#102)

**`externalUpdatedAt` on the epic — the tracker's own `updatedAt` value as of the last time the
agent read the item's CONTENT.**

Three properties, each load-bearing:

1. **It is the tracker's clock, never ours.** The comparison is `remote.updatedAt >
   epic.externalUpdatedAt`; mixing a local `Date.now()` into that comparison makes it wrong by
   clock skew and by the tracker's own write latency.
2. **It advances only when content was read.** Seeing an item in a list response is not reading
   it. `/pm:sync` fetches `number,updatedAt` for the whole list to compute the drift set; it
   stamps the watermark only on the items whose bodies/comments it actually read. If a list
   sighting advanced the watermark, sync would erase the drift it exists to find.
3. **Per epic, never a global `tracker.lastSyncedAt`.** A single global watermark advances past
   comments nobody read the moment one item is handled and another is deferred. Per-epic makes
   partial progress representable — this is #102's own argument and it is right.

`updatedAt` is broader than comments (it moves on relabel, edit, state change) and that is
correct: a `P0` label added to a mirrored issue matters exactly as much as a comment, and today
both are equally invisible.

### Which verbs write it

| Verb | Writes | When |
|---|---|---|
| `add-epic … --external-updated-at <iso>` | `epic.externalUpdatedAt` | Inward registration. The agent just read title/url/labels/body — stamp it, or every freshly-mirrored epic instantly pollutes the "never re-read" count. |
| `update-epic <id> --external-updated-at <iso>` | `epic.externalUpdatedAt` | Plain re-read during `/pm:sync`, no verdict needed. |
| `record-tracker-refresh <id> --verdict … --external-updated-at <iso>` | `epic.trackerRefresh` **and** `epic.externalUpdatedAt` | The refresh gate. `--external-updated-at` is **required** so a verdict can never be recorded without advancing the watermark. |

`update-epic` has a **closed** flag allowlist (`update-epic.mjs:15`) that exits non-zero on an
unknown flag, so `--external-updated-at` must be added there or the verb is unreachable:

```js
export const UPDATE_EPIC_FLAGS = ["external-id", "external-url", "parent", "status", "priority", "title", "link", "review-mode", "add-story", "story", "done"];
```

`add-epic` has **no** such allowlist — it reads named flags and silently ignores the rest. So on
the `add-epic` path a passing exit code proves nothing; the field must be read back out of
`state.epics[i]` to know it landed. Both paths need the flag; only one of them will complain if
you forget.

### What the brief can honestly say

#102 proposes the brief surface `⚠ N mirrored issues have tracker activity newer than their last
sync`. **The engine cannot compute that.** It would need each item's current remote `updatedAt`,
which requires a network call, which the architectural law forbids. Emitting it anyway would be a
fabricated number — the same class of dishonesty the brief already refuses for transition drift
(`briefing.mjs:114`: *"Status-transition sync is the agent's job (rules block), NOT fabricated
here."*).

The locally computable substitute, which is the population that actually matters:

```
⚠ N tracker-linked epics never re-read since mirroring — /pm:sync
```

counting epics with an `externalId` and no `externalUpdatedAt`. Every pre-0.27.0 epic is in that
set on day one, and the count decays to zero as sync stamps them. The live drift count is real and
useful — it belongs in **`/pm:sync`'s own in-session output**, computed by the agent that just
made the call, not in a brief rendered offline.

---

## The refresh gate (#103)

**Rule:** before drawing up specs or a plan for an epic, re-read that epic's source of truth and
record the verdict.

### The gate keys off provenance, not direction — argued explicitly

This is the design point most likely to be got wrong, because both fields are about "the tracker"
and the wrong one is one character shorter to type.

**`direction` says where items are BORN. Provenance says where an item's TRUTH LIVES.** They are
independent, and in a `both` repo they disagree routinely on the same day:

- An issue filed by a third party, mirrored inward → its truth is in the tracker. New comments can
  supersede the ask outright.
- An epic born from a local OpenSpec proposal, mirrored outward so stakeholders can see it → its
  truth is the spec on disk. A comment there does not *replace* the ask; it is input the spec
  author adjudicates.

Same repo, same tracker, same `direction` value, different relationship to the same linked issue.
So `direction` cannot gate this. The gate keys off **`externalId` present**:

| Epic has | Re-read | Recorded by |
|---|---|---|
| `externalId` | The linked external item (`externalUrl`) — body, comments, labels, state | `record-tracker-refresh <id> --verdict unchanged\|material-change [--summary "<what>"] --external-updated-at <iso>` |
| no `externalId` | The local source — `planPath`, or the OpenSpec change's `proposal.md`/`tasks.md` | Instruction only; no verb, no state (§ Scope) |

Two fields, two jobs. `direction` shapes the *instructions the repo emits*; `externalId` shapes
*what one epic must re-read before it is turned into a commitment*.

**Provenance does not mean "born inward" — and the schema could not tell you if it did.** An
outward-mirrored epic also has an `externalId` (recorded via `update-epic --external-id` after the
agent creates the issue), and nothing in `state.json` records which write path set it. That is
fine, because the trigger is not origin but exposure: **a linked issue accumulates third-party
context regardless of which way it was born.** #103's motivating scenario 5 — *"a third party hits
the same problem, reads the backlog, and comments with materially different context"* — happens on
an outward-mirrored issue exactly as readily as on an inward-born one. Origin governs *whose ask
wins when the two disagree* (spec-born epic: the spec wins, the comment is input); it does not
govern *whether to look*. Always look; then adjudicate.

The same acceptance applies to the brief's never-re-read count: in a `both` repo it includes
outward-born epics. That is correct and deliberate — the line counts *linked items we have never
read*, which is honest for both origins.

### Where it fires

At **activation**, enforced at write time.

`activate()` (`active-pointer.mjs:13-23`) is the single chokepoint for an epic becoming active —
three callers, `active-pointer.mjs:55` (`set-active`), `update-epic.mjs:136`, `add-epic.mjs:222`.
Setting the flag inside `activate()` is the structurally correct answer to the defect class this
whole release exists to fix: one rule, one site, three entry points covered.

```
activate(state, id, { freshlyRead = false } = {})
  → if (epic.externalId && !freshlyRead) epic.trackerRefreshNeeded = true;
```

`add-epic.mjs:222` passes `freshlyRead: true` — an epic created in the same command that read the
issue does not owe an immediate re-read.

The flag is **set at the transition, not derived**. CLAUDE.md's law, learned the hard way from
`reconcileNeeded`: *"State-transition flags are not pure functions of current state … deriving the
flag from 'is there still a live frame' breaks it at exactly the moment it needs to stay true."*
Deriving `trackerRefreshNeeded` from "does this epic have a stale watermark" would have the same
shape of bug — the watermark advances for reasons unrelated to activation.

Enforcement, in tiers:

1. **Instruction — always.** The rules block gains a "Tracker refresh gate" paragraph whenever any
   tracker is configured; the `conductor` skill's lifecycle gains the step between "Lane it" and
   "Build". This is the layer that works in every repo, on every host platform.
2. **Brief + PROJECT.md — always.** An active epic with `trackerRefreshNeeded: true` is marked, so
   a compacted or resumed session re-learns the debt instead of inheriting it silently.
3. **`gate-guard` PreToolUse block — opt-in, under the existing `state.gateGuard` flag.** This
   generalization is pre-authorized in the guard's own source:

   > *"The repo-level `gateGuard` flag still exists (and still gates any \*future\* generalization
   > of this hook to other checks), but no longer gates the reconcile-owed check itself."*
   > — `scripts/lib/gate-guard.mjs:33-35`

   The reconcile check stays unconditional; the tracker-refresh check respects `set-gate-guard
   off`. The escape hatch is not optional here: an agent with no network, no `gh` auth, or a
   deleted upstream issue must be able to proceed, and `--verdict unchanged` recorded blind would
   be a worse outcome than an honest bypass.

pm cannot verify the agent actually read anything, exactly as it cannot verify a Gate 1 review
happened. What it guarantees is that proceeding without an explicit recorded answer leaves
evidence — the same trust model as the rest of the plugin.

---

## Completeness: every site that reads the tracker block or emits tracker instruction

This release exists because a rule was applied at one of two emitters. Enumerated by
`rg -n "currentTracker|currentSecondaryTrackers|state\.tracker|\.secondaryTrackers" scripts/ hooks/ agents/ skills/`,
not from memory.

| # | Site | Today | Governed by `direction`? |
|---|---|---|---|
| 1 | `rules.mjs:203` — outward "External tracker sync" gate | `sys !== "github-issues"` | **Yes** — `direction ∈ {outward, both}` |
| 2 | `rules.mjs:228` — inward "GitHub issue sync" gate | `sys === "github-issues" && tracker.repo` | **Yes** — `direction ∈ {inward, both}`, and generalized off GitHub |
| 3 | `rules.mjs:251-285` — secondary tracker sections | always, per entry | **Yes, pinned** — secondary reads `direction`, which is always `inward` (§ Secondary trackers) |
| 4 | `rules.mjs:286-288` — `hasInwardPullTracker` | `sys === "github-issues" \|\| secondaries.length` | **Yes** — recomputed as "any tracker whose direction includes inward". Also fixes defect 4's dangling "writeback steps above". |
| 5 | `briefing.mjs:115-128` — `TRACKER SYNC` block | gated only on `tracker.system` | **Yes** — the #109 fix. Outward drift line under `{outward, both}`; never-re-read line under `{inward, both}`. |
| 6 | `briefing.mjs:134-145` — "N tracker(s) configured — consider `/pm:sync`" nudge | `trackerCount > 0` | **Yes** — an outward-only tracker cannot produce new inward items, and the rules block gives no inward procedure to run. This is the site a naive #109 fix misses. |
| 7 | `tracker.mjs:61-85` — `setTracker` primary writer | merges flags | **Yes** — new `--direction` flag, validated, defaulted (§ the merge trap) |
| 8 | `tracker.mjs:26-59` — `setTracker` secondary writer | merges flags | **Yes** — `--direction` other than `inward` is **rejected** |
| 9 | `rules.mjs:17-25` — `currentTracker()` / `currentSecondaryTrackers()` | plain readers | **Indirectly** — the `directionOf()` fallback lives here so every consumer, including #10, inherits it |
| 10 | `conductor.mjs:134` — `rules` subcommand printing `rulesBlock(currentTracker(), …)` | pass-through | **Inherits** — no site-specific change |
| 11 | `render.mjs` (PROJECT.md) | **no tracker output** — verified by grep, zero hits | **No** — except the new `trackerRefreshNeeded` marker on the active epic |
| 12 | `update-epic.mjs:15` `UPDATE_EPIC_FLAGS` / `add-epic.mjs:182-220` | `externalId`/`externalUrl` only | **No** (per-epic, not per-tracker) — but both gain `--external-updated-at` |
| 13 | **`add-many.mjs:49-71`** — bulk epic creation | sets `externalId` (`:68`) and pushes straight onto `state.epics` (`:71`); **never calls `activate()`**, even for `status: "active"` (`:64`) | **No** (per-epic) — but it is the **fourth door** into the `activate()` chokepoint and must gain both `externalUpdatedAt` in its JSON schema and a call through `activate()` |
| 14 | `hooks/hooks.json`, `agents/*.md` | no tracker references | **No** |
| 15 | `conductor.mjs:78` USAGE string + `:113` dispatch map | no `record-tracker-refresh` | **No** (per-verb) — both need the new subcommand |

Row 13 is the one this enumeration exists to catch. `rg -n "activate\("` returns three callers
(`active-pointer.mjs:55`, `update-epic.mjs:136`, `add-epic.mjs:222`); `add-many` is not among them
because it constructs epics inline. So a tracker-linked epic created by `add-many` today gets no
`externalUpdatedAt` (polluting the never-re-read count) and, at `status: "active"`, would bypass
`trackerRefreshNeeded` entirely — *and already bypasses the single-active invariant that
`activate()` enforces*, which is a pre-existing bug this change surfaces rather than causes. **A
rule applied at three of four sites is the defect this release is fixing.** Fix it by routing
`add-many` through `activate()`, not by duplicating the flag logic.

Documentation surfaces that assert the vendor rule and must change in the same PR cycle:
`commands/tracker.md` (§ "GitHub-issues tracker: inward sync", and the "full bidirectional mirror"
wording at :99), `commands/sync.md:18-25`, `commands/epic.md:74-78` (the `update-epic` flag list),
`skills/conductor/SKILL.md:101-141` and the schema block at `:522`/`:531`/`:545`, `README.md`, the
Mintlify site per the `mintlify-doc-sync` skill, `CHANGELOG.md`, and
**`openspec/specs/tracker-sync/spec.md:31-33`**, whose scenario *"github-issues as primary keeps
its existing inward-only special case"* becomes **wrong**, not merely incomplete — it asserts
vendor-derived behavior as a requirement and must be rewritten, not augmented.

**Command-doc obligation — a deviation to be ratified, not assumed.** CLAUDE.md states *"every new
subcommand needs a matching command doc under `commands/`"*. This design proposes documenting
`record-tracker-refresh` inside `commands/sync.md` and the `conductor` skill instead, on the
precedent that `record-gate-review` and `record-reconcile` are shipped subcommands with no
`commands/*.md` of their own (`ls commands/` — 16 files, none for either). Both are *engine-facing
writeback verbs an agent runs mid-gate*, not user-facing slash commands, and this is the third of
that shape. That is the maintainer's call; taken as proposed, `docs/parity-ledger.json` needs no
new capability and no new claimed path. If a `commands/refresh.md` is added instead, it must be
claimed in a capability in the same commit or `scripts/test/parity.test.mjs` fails CI.

---

## The check that can fail

Each assertion below fails against the **current** engine. Numbered in the order they should be
written.

1. **Coherence — the assertion that makes #109 structurally impossible.** For every
   `direction ∈ {inward, outward, both}` × `system ∈ {github-issues, jira}`, build one fixture and
   assert `outwardInstructionPresent(rulesBlock(...)) === outwardInstructionPresent(buildBrief(...))`.
   Fails today for `{github-issues, *}`: rules-block false, brief true. This is the only assertion
   that catches the *class* rather than the instance.

2. **Paired polarity on the `github-issues` absence case — and why the pairing is required.**
   Same fixture, two directions:
   - `{system:"github-issues", repo:"o/n", direction:"inward"}` + an unmirrored queued epic →
     brief does **not** match `/not yet in github-issues/`.
   - the identical fixture with `direction:"outward"` → brief **does** match it.

   The absence half alone is not evidence: #109's root cause was a suite whose only TRACKER SYNC
   tests were written against jira (`conductor-05.test.mjs:262`, `:282`), so an emitter that
   produced nothing at all would have passed. Presence on the same fixture is what proves the
   absence was a decision rather than a dead code path.

3. `rulesBlock({system:"jira", projectKey:"JOB", direction:"inward"})` contains **no**
   `## External tracker sync`. Fails today — `rules.mjs:203` gates on the vendor name.

4. `rulesBlock({system:"github-issues", repo:"o/n", direction:"outward"})` contains
   `## External tracker sync` and **not** the inward section. Fails today — both gates are
   vendor-keyed.

5. `rulesBlock({system:"jira", projectKey:"JOB", direction:"inward"})` contains a generic inward
   section naming jira and instructing dedup **by `externalUrl`**. Fails today — no inward section
   exists for any non-github primary.

6. **The no-behavior-change triple.** Take a real 0.26.0 state with
   `tracker: {system:"jira", projectKey:"JOB"}` and compare rules block + brief across
   (a) 0.26.0, (b) 0.27.0 **before** `/pm:upgrade`, (c) 0.27.0 **after** `/pm:upgrade`.
   The **rules block must be byte-identical in all three.** The brief must be identical in all
   three **except** the `💡 N tracker configured — consider /pm:sync` nudge, which is absent in (b)
   and (c). That single diff is deliberate and must be asserted explicitly, with its reason:
   telling an outward-only repo to sync new issues inward instructs an action its rules block
   gives no procedure for — the same defect shape as #109, one order of magnitude less costly.
   If any *other* diff appears, direction-as-configuration is changing existing behavior somewhere
   that has not been found, and that is a design problem, not an implementation one.

7. **The merge trap.** With an existing `tracker: {system:"jira"}` and no `direction`, running
   `set-tracker --intent paused:todo` leaves the tracker **without** an implicit `inward`
   stamped — i.e. `directionOf()` still resolves `outward`. `tracker.mjs:61` merges
   (`const t = { ...(state.tracker || {}) }`), so a naive `if (!t.direction) t.direction = "inward"`
   in the writer silently switches off outward mirroring for every existing Jira repo — the exact
   catastrophe the migration exists to prevent, sneaking in through the writer instead. The
   new-tracker test must be captured **before** the merge:
   `const isNew = !(state.tracker && state.tracker.system)`. Same trap in `upsertSecondaryTracker`.

8. `set-tracker --system jira` with **no** prior tracker and no `--direction` → `direction:
   "inward"`. `set-tracker --direction sideways` exits non-zero and writes nothing.

9. `set-tracker --role secondary --system jira --project ABC --direction outward` exits non-zero.
   Rationale is spec conformance, not preference: `openspec/specs/tracker-sync/spec.md`'s
   requirement *"Secondary trackers never receive outward-created issues."*

10. `update-epic <id> --external-updated-at 2026-08-23T00:00:00Z` exits 0 **and**
    `state.epics[i].externalUpdatedAt` reads back that value. Fails today at the allowlist
    (`update-epic.mjs:15` → exit 1).

11. `add-epic … --external-updated-at <iso>` → the value reads back out of `state.epics[i]`.
    Fails today by silently dropping it — `add-epic` has no closed allowlist, so **exit 0 is not
    evidence**; only the read-back is.

12. `record-tracker-refresh <id> --verdict material-change --summary "scope widened"
    --external-updated-at <iso>` writes `epic.trackerRefresh = {verdict, summary, refreshedAt,
    externalUpdatedAt}`, advances `epic.externalUpdatedAt`, and clears `trackerRefreshNeeded`.
    Fails today — the verb does not exist (`conductor.mjs:78`'s USAGE string).

13. `record-tracker-refresh` **without** `--external-updated-at`, and on an epic with no
    `externalId`, each exit non-zero and write nothing.

14. `set-active <id>` on an epic with `externalId` sets `trackerRefreshNeeded: true`; on an epic
    without one, does not. Repeat through `update-epic <id> --status active`, through
    `add-epic --status active` (with `freshlyRead`, so it must **not** set the flag), and through
    `add-many --from <json>` with an entry at `status: "active"` carrying an `externalId` — **four
    entry points, one `activate()`**. The `add-many` case fails today twice over: no flag, and
    `state.active` not updated either.

15. `gateGuardCheck()` with `gateGuard: true` and an active epic carrying
    `trackerRefreshNeeded: true` exits 2; with `gateGuard: false` it exits 0. **Regression guard:**
    with `reconcileNeeded: true` it still exits 2 in both cases — `set-gate-guard off` must not
    have become a bypass for the reconcile gate.

16. Brief emits `⚠ N tracker-linked epics never re-read since mirroring` counting epics with
    `externalId` and no `externalUpdatedAt`; with that count at zero the line is **absent**.

---

## Migration

### The fallback is load-bearing; the migration is for legibility

Every consumer resolves direction through one helper:

**Placement — it must be `constants.mjs`, not `rules.mjs`.** The design rests on both emitters
resolving direction through *one* definition, and `briefing.mjs` does not import from `rules.mjs`
at all today (it reads `state.tracker` directly at `:115`). Adding that import would run against
this repo's one-directional-dependency discipline (`tracker.mjs:3-4`, and
`docs/superpowers/specs/2026-07-21-conductor-mjs-module-split-design.md`). `constants.mjs` is the
leaf — *"No dependencies on any other lib module — every other module may import from here"* — and
`briefing.mjs` already imports from it twice (`:10`, `:12`). A pure function over a tracker object
belongs there. If it lands anywhere both emitters cannot import without a cycle, "one definition"
becomes two copies and assertion 1 passes vacuously.

```js
// one definition, in constants.mjs (leaf module — both emitters already import from it)
export function directionOf(t) {
  if (t && (t.direction === "inward" || t.direction === "outward" || t.direction === "both")) return t.direction;
  return t && t.system === "github-issues" ? "inward" : "outward";   // vendor-derived legacy default
}
```

This is what preserves behavior, and it has to exist independently of the migration because
**`/pm:upgrade` lags the plugin update**. The documented sequence is: update the plugin →
`/reload-plugins` → `/pm:upgrade` *per repo*. A repo can run the 0.27.0 engine for weeks before
anyone runs `/pm:upgrade` in it. If correctness depended on the migration having run, every such
repo would be wrong in the interval.

By CLAUDE.md's own test, a `MIGRATIONS` entry is therefore **not strictly required** — existing
data stays valid without transformation, the same reasoning as the write-conflict guard's
absent-means-zero. Ship one anyway, for one reason: `direction` is *user-facing configuration*, and
a setting that exists only implicitly cannot be discovered, inspected, or changed with confidence.
Stamping it converts a vendor-derived default into a recorded decision.

```js
{
  release: "0.27.0",
  note: "stamp tracker direction, preserving today's vendor-derived behavior",
  apply(state) {
    const t = state.tracker;
    if (t && t.system && !t.direction) {
      t.direction = t.system === "github-issues" ? "inward" : "outward";
    }
    for (const st of (Array.isArray(state.secondaryTrackers) ? state.secondaryTrackers : [])) {
      if (st && st.system && !st.direction) st.direction = "inward";
    }
  },
}
```

Additive, idempotent (guarded on `!direction`, so it never overwrites an explicit value and a
double `/pm:upgrade` is a no-op), backward-compatible (a 0.26.0 state loads unchanged; a 0.27.0
state loads on 0.26.0 with the extra field ignored).

### The mapping — and why `both` is the wrong answer for existing non-github trackers

The obvious mapping is "`github-issues` → inward, everything else → **both**", on the strength of
the docs calling the non-github path a "full bidirectional mirror". **Verified against the code,
that is wrong.**

- `rules.mjs:203` gives jira/linear the outward section. ✅ outward
- `rules.mjs:228` gates the **only** inward-pull section on `sys === "github-issues" &&
  tracker.repo`. A jira primary has never received an inward instruction. ❌ inward
- `briefing.mjs:115-128` emits outward drift only. `sync()` (`subcommands.mjs:224`) is local-only.
  `commands/sync.md:18` scopes inward pull to `github-issues`. No other inward channel exists.

"Bidirectional" in `skills/conductor/SKILL.md:107-108` and `commands/tracker.md:99` names two
things — *create the issue* and *transition the issue* — **both of which are outward**. The word
is a misnomer in the docs and must be corrected as part of this change.

So stamping `both` would **add** an inward pull to every existing Jira and Linear repo: `/pm:sync`
would begin registering an untriaged epic for every open issue in the project. On a real Jira
project that is #109's failure mode with a larger blast radius and pointed the other way.

| Existing `system` | Migrated `direction` | Preserves |
|---|---|---|
| `github-issues` (primary) | `inward` | inward pull; outward stays suppressed |
| anything else (primary) | `outward` | outward create + transition; no inward pull is introduced |
| any secondary entry | `inward` | inward pull + completion writeback, never outward creation |

### The deliberate discontinuity — new vs migrated

A **new** jira tracker defaults to `inward`. An **existing** jira tracker migrates to `outward`.
That is not an inconsistency, and it is stated here so it does not read as one:

- The migration's job is *continuity* — never silently change what a configured repo already does,
  with **one qualified exception**: site #6 removes the `💡 … consider /pm:sync` nudge from every
  existing outward-only repo (assertion 6). That is deliberate — the nudge instructs an inward
  action the rules block gives no procedure for — but it is a second user-visible change and
  belongs in the CHANGELOG alongside the new-tracker-default one, not buried as an implementation
  detail.
- The new-tracker default's job is *safety* — the more consequential default (outward creation
  into someone else's tracker) must be chosen, not inherited.

It does mean a fresh `set-tracker --system jira` in 0.27.0 emits different instructions than the
same command in 0.26.0. That is a user-visible behavior change and belongs in `CHANGELOG.md` as
one, with the one-line remedy: `set-tracker --system jira --direction outward`.

### No migration needed for the freshness fields

`externalUpdatedAt` absent means "never read since mirroring" — which is exactly, and truthfully,
the state of every pre-0.27.0 tracker-linked epic. `trackerRefreshNeeded` absent means "not owed",
and it is set at the next `activate()`. Neither needs transforming.

---

## Scope

**In:**

- `direction` on the primary tracker block and on secondary entries; `set-tracker --direction`;
  `directionOf()` fallback; all 13 sites in the completeness table.
- Generalization of the inward-pull section off `github-issues` to any vendor, deduping by
  `externalUrl`.
- `externalUpdatedAt` on epics; `--external-updated-at` on `add-epic` and `update-epic` (widening
  `UPDATE_EPIC_FLAGS`), plus an `externalUpdatedAt` key in `add-many`'s JSON entry schema.
- `record-tracker-refresh` verb (plus its `conductor.mjs:78` USAGE and `:113` dispatch entries);
  `trackerRefresh` + `trackerRefreshNeeded` on epics; `activate()` setting the flag; routing
  `add-many` through `activate()` so the chokepoint has no fourth door; brief + PROJECT.md
  surfacing it.
- `gate-guard` honoring `trackerRefreshNeeded` **under the existing opt-in `state.gateGuard`
  flag only**.
- The `MIGRATIONS` 0.27.0 entry; README + Mintlify + `openspec/specs/tracker-sync/spec.md`
  updates in the same PR cycle.
- Fixing defect 4's dangling "writeback steps above" reference, which falls out of site #4.

**Out, deliberately:**

- **Any network call from the engine.** The architectural law. Every fetch in every flow above is
  the interactive agent's.
- **Storing the issue body/description locally.** #102 correctly notes there is no body field
  today; adding one makes `state.json` a cache, and caches rot. pm stores a *watermark*, not a
  copy — a timestamp cannot be subtly wrong about content.
- **A global `tracker.lastSyncedAt`.** #102's own argument: it advances past comments nobody read.
- **An engine-computed "N items have newer remote activity" brief line.** Not computable without
  fetching. The agent reports it from `/pm:sync`'s own output.
- **Age-threshold staleness nagging** (`⚠ last re-read 21d ago`). No evidence for any threshold,
  and an unactionable recurring warning trains agents to ignore the whole block.
- **A Gate-1 refusal backstop** (refusing `record-gate-review --gate 1` while a refresh is owed).
  Gate 1 is openspec-lane-only (`gate-review-writeback.mjs:37-41`), and all three motivating epics
  — `gh-102`, `gh-103`, `gh-109` — are `lane: "claude-code"`. It would not have fired on a single
  one of them. Revisit only with measured evidence of skipped refreshes on openspec-lane epics.
- **Making the tracker-refresh gate-guard check unconditional** the way the reconcile check is.
  The reconcile check earned that by measured non-adoption of the opt-in; this one has no such
  evidence yet, and it needs a bypass for the offline / unauthenticated / deleted-upstream cases.
- **Completion writeback for a primary inward tracker.** Only secondaries emit writeback today
  (`rules.mjs:279-283`). The asymmetry is real and probably a bug, but changing it changes what
  `/pm:sync` does to live issues in every `github-issues` repo. Separate issue, separate release.
- **Per-epic `direction` override.**
- **Mechanical enforcement of the non-tracker half of the refresh gate** ("re-read the local
  spec"). Instruction only — the engine cannot tell a re-read from a stat, and inventing a verb to
  record one buys nothing that the OpenSpec gates do not already cover.
- **New tracker vendors.** `direction` is vendor-neutral by construction; adding vendors is
  orthogonal.
