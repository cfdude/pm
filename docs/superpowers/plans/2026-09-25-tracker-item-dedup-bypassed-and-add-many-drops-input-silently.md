# Tracker-item dedup at every writer + add-many input validation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** One tracker item maps to one epic on every write path, and an `add-many` batch persists
everything it accepts or refuses it by name.

**Epics:** `tracker-item-dedup-bypassed` (Tasks 1–2), `add-many-drops-input-silently` (Tasks 3–4).
Both superpowers lane, release 0.50.0. Source: `docs/reviews/2026-09-14-code-review-0.43.0-findings.md`
(B1, B2, E1).

**Architecture:** A new pure module `scripts/lib/tracker-dedup.mjs` owns the collision rule
(`trackerKeyHolder`) and its refusal text (`trackerKeyRefusal`). `add-epic`, `update-epic` and
`add-many` call it; the inward sync reaches the store only through the emitted `add-epic` line, so
it is covered by `add-epic`. `add-many` gains a document-shape check and a links pass that runs
after every batch id is known.

**Tech Stack:** Node ≥22 built-ins only (zero-runtime-dependency engine); `node --test`; unit rung
(`memoryEngine`) for every new test, because each one observes a value or a refusal.

## Global Constraints

- Engine is zero-runtime-dependency: `node:*` built-ins only.
- Every interpolated value in a refusal goes through `escapeControls` (the output-interpolations sweep).
- No edit to `scripts/lib/epic-progress.mjs`, `archive-gate.mjs`, `integrity.mjs`, `git-gateway.mjs`, `openspec/`
  (another agent's scope), and none to `constants.mjs` / `subcommands.mjs` (certified modules).
- The new module must not contain the text `gitOps(` (it would become a certified module).
- One conventional commit per task; RED saved to the evidence dir and named in the commit body.
- Certify only under `/Users/robsherman/Documents/Repos/pm/.git/pm-certify.lock` (mkdir), held
  across certify AND commit, released by trap, and refused while any `scripts/lib` or
  `scripts/conductor.mjs` file has unstaged or untracked changes (#230).

## Decisions

1. **Archived holders count.** An archived epic still holding a URL blocks a second epic claiming
   it. Why: the emitted sync step 2 and the completion-writeback step both match ANY epic by
   `externalUrl`, whatever its status. A second holder would make both ambiguous, and a
   delivered epic whose issue is still open would otherwise be re-registered by every careless
   sync. The route for a genuinely reopened item is the inverse: `update-epic <archived>
   --clear external-url`, which works on an archived epic today (probed), and the refusal names it.
2. **The key compared is the existing EPIC_DEDUP_KEYS rule, unchanged:** URL against URL when both
   sides carry one; bare `externalId` only when NEITHER side carries a URL; one side URL-less is
   never a collision. Exact string equality (no URL normalisation — that would be a new rule).
3. **The guard fires only when a write SETS a key.** `update-epic` compares the record as it will
   stand after the write against every OTHER epic (no self-collision when re-stating one's own
   URL). `--clear external-url` is never refused, even when the now URL-less epic collides with
   another on the `externalId` fallback: refusing the inverse would make a URL un-freeable.
4. **Existing duplicates still load.** Nothing on the read path changes. An unrelated write to
   either holder (priority, status…) succeeds; setting the key on either is refused naming the
   other; clearing it on one frees it for the other.
5. **Integrity reporting of existing duplicates: yes, it should report them** (a duplicate makes
   sync step 2 and the writeback match two epics) — but it needs `scripts/lib/integrity.mjs`,
   which is out of this worktree's scope. Stopped and reported, not shipped here.
6. **add-many links:** an entry's `links` must be an array (null / a bare string are refused by
   name). Each element is either a `"<type>:<epic>[:<reason>]"` string (the `--link` grammar) or
   an object carrying only `type`, `epic` and optional string `reason`. Checked epic-first then
   type, like `parseLinkFlags`, against existing ids ∪ batch ids, in a pass after all ids are
   collected (a link to a later entry is legal). Any other key on a link object is refused —
   otherwise a batch could smuggle a `verdict` or arming record onto a `may-invalidate` edge
   through `mergeLinks`' spread. A self-link is accepted, matching `update-epic --link`.
7. **add-many document:** must be a JSON object whose only keys are `parent` and `epics`;
   `parent` an object; `epics` an array. Anything else is refused by name.

## Review Focus

- A URL re-stated on its own holder via `update-epic` must NOT refuse (Task 1 test).
- A duplicate WITHIN one add-many batch, not only against the record (Task 2 test).
- An add-many link to an entry that appears LATER in the batch must be accepted (Task 4 test).
- `links: null` must refuse, not silently become `[]` (Task 4 test).
- A state file already holding two holders must still render and accept unrelated writes (Task 1 test).

---

### Task 1: shared tracker-key guard at add-epic and update-epic

**Files:**
- Create: `scripts/lib/tracker-dedup.mjs`
- Modify: `scripts/lib/add-epic.mjs` (the `if (externalId !== undefined)` dedup block)
- Modify: `scripts/lib/update-epic.mjs` (after the `--clear` contradiction check)
- Modify: `scripts/test/unit/conductor-04.test.mjs` (its assertion pinned E1's wrong key name)
- Test: `scripts/test/unit/tracker-item-dedup.test.mjs`

**Interfaces — Produces:**
- `trackerKeyHolder(others: Epic[], candidate: {externalUrl?, externalId?}) → {holder: Epic, key: "externalUrl"|"externalId"} | null`
- `trackerKeyRefusal(hit, candidate, {inBatch?: boolean}) → string` (no `conductor:` prefix, no newline)

- [x] **Step 1: failing tests** — in `tracker-item-dedup.test.mjs`, each on `memoryEngine(emptyRecord())`:
  - `add-epic --external-url U` twice with different ids and NO `--external-id` → second refused, stderr names `external-url` and the holder id; one epic.
  - `add-epic` with the exact emitted sync line shape (`--id gh-cfdude-pm-7 --title=… --status untriaged --external-id 7 --external-url=U …`) when `other` already holds `U` → refused naming `other`.
  - `update-epic d --external-url U` when `a` holds U → refused naming `a`; `d` unchanged.
  - `update-epic a --external-url U` (its own URL) → succeeds.
  - archived holder blocks; `update-epic <archived> --clear external-url` then frees it.
  - seeded record with two holders of U: `render`, `brief`, `update-epic b --priority P1` succeed; `update-epic b --external-url U` refused naming `a`; `update-epic a --clear external-url` then `update-epic b --external-url U` succeeds.
  - `--clear external-url` succeeds even when it leaves an `externalId` fallback collision.
  - the `externalId` fallback (no URL either side) is enforced by `update-epic --external-id`.
- [x] **Step 2:** `node --test scripts/test/unit/tracker-item-dedup.test.mjs > red-1.txt` — FAIL (duplicates accepted).
- [x] **Step 3: implement** `tracker-dedup.mjs`:

```js
import { EPIC_DEDUP_KEYS, escapeControls } from "./constants.mjs";
const FLAG = { externalUrl: "external-url", externalId: "external-id" };
const has = (o, k) => o && typeof o[k] === "string" && o[k] !== "";
export function trackerKeyHolder(others, candidate) {
  const { primary, fallback } = EPIC_DEDUP_KEYS;
  for (const e of others) {
    if (!e || typeof e !== "object") continue;
    if (has(candidate, primary) && has(e, primary)) {
      if (e[primary] === candidate[primary]) return { holder: e, key: primary };
      continue;
    }
    if (!has(candidate, primary) && !has(e, primary) && has(candidate, fallback) &&
        has(e, fallback) && e[fallback] === candidate[fallback]) return { holder: e, key: fallback };
  }
  return null;
}
export function trackerKeyRefusal({ holder, key }, candidate, { inBatch = false } = {}) { /* names key, value, holder, status, remedy */ }
```
  `add-epic`: build `candidate` from `--external-url`/`--external-id`; when either is set, refuse on a hit.
  `update-epic`: when either flag is SET, candidate = supplied value, else the epic's current value
  unless that key is being cleared; compare against `state.epics` minus the epic itself.
- [x] **Step 4:** targeted run passes; update `conductor-04`'s `/external-id '42' already/` to the URL key it actually collided on.
- [x] **Step 5:** commit `fix(dedup): one tracker item maps to one epic at add-epic and update-epic` (under the certify lock).

### Task 2: add-many enforces the same guard, against the record and within the batch

**Files:** Modify `scripts/lib/add-many.mjs`; Test `scripts/test/unit/tracker-item-dedup.test.mjs`.

- [x] **Step 1: failing tests:** a batch entry with `externalUrl` held by an existing epic → refused naming it, nothing written; two batch entries with one `externalUrl` → refused naming the first entry; `parent` + child sharing a URL → refused.
- [x] **Step 2:** save `red-2.txt`.
- [x] **Step 3: implement** a pass after the per-entry loop: for each entry in order, `trackerKeyHolder([...state.epics, ...earlierEntries], entry)`; refuse with `trackerKeyRefusal(hit, entry, { inBatch: earlierEntries.includes(hit.holder) })`.
- [x] **Step 4:** targeted run passes. **Step 5:** commit `fix(add-many): refuse a tracker item another epic or batch entry already holds`.

### Task 3: add-many validates the document's own shape

**Files:** Modify `scripts/lib/add-many.mjs`; Test `scripts/test/unit/add-many-input.test.mjs`.

- [x] **Step 1: failing tests:** `{"parent":{…},"epic":[…]}` refused naming `epic` and the supported keys, nothing written; `[]`, `null`, `"x"` refused as "must be a JSON object"; `{"epics":{}}` refused "epics must be an array"; `{"parent":"x"}` refused "parent must be an object".
- [x] **Step 2:** `red-3.txt`.
- [x] **Step 3: implement** before `loadState()`:

```js
const DOC_KEYS = ["parent", "epics"];
if (!doc || typeof doc !== "object" || Array.isArray(doc)) refuse("the batch must be a JSON object with `parent` and/or `epics`");
const unknownDoc = Object.keys(doc).filter(k => !DOC_KEYS.includes(k));
if (unknownDoc.length) refuse(`unsupported top-level key(s) ${escapeControls(unknownDoc.join(", "))} (supported: ${DOC_KEYS.join(", ")})`);
if (doc.parent !== undefined && (!doc.parent || typeof doc.parent !== "object" || Array.isArray(doc.parent))) refuse("`parent` must be an object");
if (doc.epics !== undefined && !Array.isArray(doc.epics)) refuse("`epics` must be an array");
```
  (`refuse` moves above these lines.)
- [x] **Step 4/5:** passes; commit `fix(add-many): refuse a batch document with unknown or mis-shaped top-level keys`.

### Task 4: add-many links pass the same validation as `--link`

**Files:** Modify `scripts/lib/add-many.mjs`, `scripts/lib/add-epic.mjs` (extract `splitLinkSpec`); Test `scripts/test/unit/add-many-input.test.mjs`.

- [x] **Step 1: failing tests:** `links: ["depends-on:base"]` persists `{type:"depends-on",epic:"base"}`; `"depends-on:base:why"` keeps the reason; `links: "depends-on:base"` refused "links must be an array"; `links: null` refused; `{type:"depends-on",epic:"ghost"}` refused "'ghost' is not a known epic id"; `{type:"blocks"}` refused naming the missing target; `{type:"blocks",epic:"b",verdict:"valid"}` refused naming `verdict`; `42` refused; a link to a LATER batch entry accepted; a self-link accepted; unknown type still refused.
- [x] **Step 2:** `red-4.txt`.
- [x] **Step 3: implement** `splitLinkSpec(s) → {type, epic, reason}` in add-epic.mjs (used by `parseLinkFlags`), and in add-many a `batchLink(raw, known) → {type, epic, reason?}` that throws a named message; run it after ids are collected (`known = existingIds ∪ batchIds`), store the normalized list, and pass it to `mergeLinks([], …)` in the copy loop.
- [x] **Step 4/5:** passes; commit `fix(add-many): links persist or refuse by name — strings parsed, dangling and target-less refused`.

### Task 5: docs + changesets

- [x] README `add-many` row and the `externalUrl` dedup sentence; `commands/epic.md` `--external-url` row.
- [x] `.changesets/tracker-item-dedup-bypassed.md`, `.changesets/add-many-drops-input-silently.md` (user-facing prose only).
- [x] Commit `docs: tracker-item dedup on every writer; add-many batch validation`.

---

## Required item 1 — call-site sweep

Derived with `rg -n "\.externalUrl\s*=|\.externalId\s*=|externalUrl:|externalId:|pushEpic\(|trackerKeyHolder\(" scripts/lib scripts/conductor.mjs`
and `rg -n "mergeLinks\(|parseLinkFlags\(|splitLinkSpec\(|\.links\s*=" scripts/lib` at HEAD.

**Writers of the dedup key (`externalUrl` / `externalId`) — the rule HOLDS at every one:**

| site | writes | guard |
| --- | --- | --- |
| `add-epic.mjs` addEpic (`epic.externalId/externalUrl =`) | `--external-id`, `--external-url` | `trackerKeyHolder(state.epics, …)` whenever either is supplied |
| `update-epic.mjs` updateEpic (`epic.externalId/externalUrl =`) | `--external-id`, `--external-url` | `trackerKeyHolder(others, after-write candidate)` whenever either is SET |
| `add-many.mjs` addMany (registry copy loop) | `externalId`, `externalUrl` batch keys | `trackerKeyHolder([...record, ...earlier entries], …)` per entry |
| inward sync | the emitted `add-epic … --external-id … --external-url=…` line (rules.mjs `registrationStep`) | covered by add-epic; pinned by a test running that line's exact shape |
| `subcommands.mjs` pushEpic ×3 (sync of openspec changes, superpowers plans, archive backfill) | no dedup key | n/a — none of the three writes a URL or external id |
| `migrations.mjs` | no write of either key | n/a |

**Where the rule deliberately does NOT hold:** `update-epic --clear external-url|external-id`, which is
the inverse and is never refused (Decision 3), and every write that does not SET a key. That is what
keeps a pre-existing duplicate loadable and editable (Decision 4).

**Inverses.**
- Refusing a second holder is inverted by freeing the key. `update-epic <holder> --clear external-url`
  (and `--clear external-id`) already existed and is now tested to free the item, including on an
  archived holder. `remove-epic` also frees it, by removing the holder.
- A link `add-many` adds is inverted by the existing `update-epic --clear-links` and by `remove-epic`,
  whose `epicReferences` removal strips links that point at the removed epic.
- The document and link validation are refusals, so they have no inverse.

**Data references.** A batch link's `epic` holds another record's id.
- It is now validated at write, against the record's ids plus the batch's.
- It is read by render, brief and integrity, all through `isRenderableLink`.
- It is removed by `remove-epic` (links.mjs `epicReferences` → `e.links.filter`).
- `externalUrl` and `externalId` are not epic ids.

**Other link writers.**
- `parseLinkFlags` (add-epic, update-epic) now shares `splitLinkSpec` with add-many's string form.
- `detour-stack.mjs` and `push-detour` write engine-built `may-invalidate` links from validated ids. They are out of scope, because no user input reaches them.
- `migrations.mjs` normalizes stored links. That is a read-repair path, and it stays permissive by design (`isRenderableLink` comment).

**Not shipped:** an integrity check that REPORTS a pre-existing duplicate. It is deferred to
`scripts/lib/integrity.mjs`, which is out of this worktree's scope, and filed as cfdude/pm#231.

## Required item 7 — route what the work taught

- **Product gap (tracker):** integrity does not report pre-0.50.0 duplicate holders → **filed #231**.
- **Tooling friction:** the certify record is shared across parallel worktrees, so this work
  certified under an orchestrator-convention lock (`pm-certify.lock`) with a #230-style refusal
  of unstaged certified-set files. Both are already filed, as #226 and #230, so nothing new was filed.
- **Process lesson:** none new. The one test that had to change (`conductor-04`) was pinning the E1
  bug's wording. The existing practice (fix the pin, and say so in the commit) covered it.
