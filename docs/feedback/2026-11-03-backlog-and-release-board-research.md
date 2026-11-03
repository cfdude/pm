# Backlog board and release-plan board: research and build strategy

Date: 2026-11-03. Status: research, nothing built. Extends the planned epic
`release-planning-mission-and-milestone` (brief: `docs/feedback/2026-10-23-release-planning-mission-and-milestone.md`).

## What Rob asked for

Two live boards for pm-dev, then the same two in every project that uses pm, on by default:

1. **Release plan board.** Which plan is active (there can be several), a "We are here" marker, a roadmap of
   releases each with theme, scope, exit check and member epics, green-light criteria, and a decisions table
   (question, recommendation, agree/disagree, notes, a send button).
2. **Backlog board.** Every open epic with title and summary, drag-to-rank, filters, per-item detail and notes,
   a delivered / not-pursued section.

The pain behind both: hyphenated epic ids tell the operator nothing about the problem or why it matters now.
Hermes nearly got greenlit on its name alone.

## What was read

- **MI release plan** (`https://claude.ai/artifact/S421GrdRG1hp47DRb9grb2`), read in full. Pattern:
  - Static HTML shell plus a live database. Capability `db`, rule `read: view, write: admin`.
  - Collections: `plan/state` (one doc: asOf, version, head, unpushed, openDecisions), `plans`, `groups`
    (releases: label, theme, semver, status, order, scope, exit, size), `epics` (id, group, status, priority),
    `log`, `criteria`, `decisions`, `answers`.
  - Claude writes the rows with the artifact-data tool. The page only reads (`onSnapshot`) and writes `answers`.
    So the board stays current with no republish.
  - "Send my answers" only stamps `answers/_submitted`. Claude is not notified; the operator must say so.
  - Plan selector, "we are here" banner plus a marker line between releases, stale warning at 2+ days.
- **Enterprise Portal Backlog** (`https://claude.ai/artifact/Q1zYe28pQxt8591562kGj6`): NOT read. It lives in
  Rob's other organization, so the Artifact tool refuses it, and the public link sits behind a Cloudflare
  human check (agent-browser, and the Chrome tool cannot read the sandboxed frame). The backlog design below is
  therefore built from Rob's description (ranked list, drag to reorder, detail panel, editable notes, remove,
  delivered and not-pursued at the bottom). To close the gap: save the page HTML into this folder, or send two
  screenshots (list, detail panel).
- **pm code** (subagent pass, pm 0.53.0), findings below.

## What pm already has

| Need | Today |
|---|---|
| Rank beyond P0-P3 | `epic.rank`, written by `reorder <id>...`; unused (0 of 353 epics ranked) |
| Epic summary | `description`, set on 64 of 353 epics; **none of the 17 untriaged issues has one** |
| Release shape | `intent`, `target`, `delivered`, `crossSpecReview`, `deferred`; no order, theme, rationale or exit check |
| Mission / milestone | none |
| Board-grade JSON | `list --json` omits rank, effective priority, notes, external URL; `release show` is text only |
| Publishing | nothing mentions the Artifact tool; `docs/artifacts/artifacts.md` is a hand-kept index |
| Opt-in registry | `scripts/lib/opt-ins.mjs`; every row is off until adopted, so default-on has no precedent |

## Recommendation

**Division of labor, preserving the law that pm never opens a connection:**

- **Engine (read-only, zero network):** new verb `board --json`, in `scripts/lib/board.mjs`, reusing
  `resolveEpics` (shared ordering, effective priority) and the release helpers. One snapshot: counts, releases
  with derived members, unassigned backlog, a recent archived window. Declared read-only in `VERB_EFFECTS`.
  Mission, milestone and per-release theme/exit are null until the planned epic adds the fields.
- **Skill (bundled, `skills/project-boards/`):** the single source of how an agent builds and refreshes both
  boards. It holds the page shell (two templates), the database schema above, the refresh procedure, and the
  `artifacts.md` registration step. One skill, not an agent: the work is mechanical and runs in the main
  session; a skill gives every project identical output.
- **Command (`/pm:boards`):** thin entry point that loads the skill and runs the refresh.
- **Standalone fallback:** the same skill emits a self-contained HTML file with the snapshot inlined, for
  hosts with no Artifact tool (Codex, Hermes). Read-only there; editing needs the live version.
- **Refresh triggers:** after `/pm:sync`, a status change, a release registration, or a gate record. Add one
  rules-block line and one brief line; keep the full procedure in the skill, loaded on use (the
  usage-conditioned section pattern from #248), not in the always-on block.
- **Default on:** an `OPT_INS` row with the inverse default (`set-boards off`), plus an `upgrade` announcement
  line so the agent tells the user the first time. Needs the rules-block byte budget checked.

**Rank and summary are the real gaps, not the page.** A board over empty descriptions is the same hyphenated
list in a nicer frame. Add:
- a required one-line `summary` and a `why-now` on every epic that leaves `untriaged` (intake and triage ask
  for them; the mirror recipe fills them from the issue body);
- release `theme`, `rationale`, `exit` and an explicit `order`;
- `mission` and `milestone` with numbered exit criteria (already specified in the 2026-10-23 brief).

**Drag-to-rank:** the page writes the new order to the database; an agent step then applies it with the
existing `reorder` verb, because state.json stays the record and the engine stays the only writer.
The board is a view, never the source of truth.

## Open questions for Rob

1. Where does an operator's drag land: DB row applied by the agent next turn, or applied immediately by a
   small helper? Recommend next-turn, preserving single-writer.
2. Do the two boards share one artifact (tabs) or stay two? Recommend two, matching what you built elsewhere.
3. Should `summary` / `why-now` block leaving `untriaged`? Recommend a warning first, a refusal one release later.

## Proposed build order (not started)

1. Write the Enterprise Portal pattern notes once the page is readable.
2. Spec change `project-boards`: `board --json`, summary/why-now/theme/order fields, skill, command, opt-in row.
3. Build pm-dev's two boards by hand from the skill draft as the proving run; keep the process notes.
4. Gate, test, register the 0.55.0 release membership.
