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
- **Enterprise Portal Backlog** (`https://claude.ai/artifact/Q1zYe28pQxt8591562kGj6`): the live page was not
  readable from here (other organization, then a Cloudflare human check). Resolved: the other laptop documented
  it in Notion, "Standard Backlog Artifact — Spec, Source & Recommendations"
  (https://app.notion.com/p/40da73c68c7f81248f38d19192333ea7), with the HTML source attached
  (`backlog-template.html`, `enterprise-portal-backlog.html`, `example-seed.json`, `seed_to_batch.py`,
  `make_template.py`). The spec below is read from that page; the attached HTML files are not yet pulled.
  Pattern, in short:
  - One static page over the artifact database (`db` plus `user` capabilities). Collections `items/<ID>`,
    `votes/<userId>`, `notes/<userId>`, `snapshots/<day>`. Rules: read `view`, write `admin`; votes and notes are
    per-user documents writable at `interact`.
  - Item fields: id, title, sum (summary), det (detail), cat, prio, rank (sparse, 1000 steps, midpoint on drop),
    status, src, needs, deps[], docNotes[], effort, values[], ds, jira key, removed{reason,by,at}, log{by,via,at,what}.
  - Behaviour worth copying: priority groups then rank; drag takes the target group's priority and never makes
    Urgent; dependency-below-dependent warning; Delivered and Not pursuing tables; removal never deletes
    (reasons: Won't do, Deferred, For consideration, Merged); "last change" tooltip with `via: claude`;
    daily in-page snapshot; a CONFIG block so one template serves every project; a seed tool that chunks writes
    in batches of 50.
  - Rules that match pm: status past Open comes only from the tracker (there Jira, here gh issues and
    state.json); removing is a disposition, not a delete (pm's `--outcome declined|superseded`).
  - Known gotchas: component CSS class collisions; `invalid_argument` on a write means view-only access;
    omit `capabilities` on republish to keep them; headless `claude -p` has no artifact-data tool.
  - Its own unbuilt list names what pm also needs: keyboard and touch reorder, settings in the database,
    owner and target release fields plus a release view (the release board), stale flag, CSV export.
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

## Second reference: iv-studio-dev (built 2026-11-03, same day)

A sibling session (`iv-studio-dev`, Rob's Mac port of hollisorg/iv-studio) built both boards against pm 0.53.0
state and filed what it hit. Pages (Rob's account): release plan
`https://claude.ai/artifact/XMmQFPJ1gEBJZ1dR1riy5K`, backlog `https://claude.ai/artifact/E7U8BdpwFhsTB9bpRUVi3q`
(Enterprise Portal spec plus a target-release field). Feed script:
`~/Documents/Repos/iv-studio-dev/docs/backlog/sync_from_conductor.py` (read; the two pages not yet opened).
Contract: collections `epics/<id>` and `releases/<id>`, `plan/state` for "here", batches of 50, op `set`.

What the script had to invent, which is the gap list for `board --json` and the release fields:
- reads `state.json` directly (gh#269: no export verb);
- release `order` is the array index and release `status` is derived by a heuristic over member statuses
  (gh#268: no order, status, theme, scope, exit, size, "here");
- `rank` is synthesized from priority then array position, ignoring `epic.rank`;
- it copies `outcome` separately because `archived` alone reads as delivered (gh#270). The board export should
  carry a derived `delivered` boolean;
- link handling guesses the shape of `links[]`; the export should emit `dependsOn` already resolved;
- `set` needs `if_version` on re-seed: the exporter should emit `update` ops, or the skill should read versions first.

Filed against cfdude/pm by that session: gh#267 (init writes `.conductor/*` to a tracked `.gitignore` even when
already ignored; fork PR pollution; `/pm:upgrade` may do the same), gh#268, gh#269, gh#270, gh#271 (uppercase
release id refused, error lacks the lowercase suggestion). All five fold into the `project-boards` change except
#267 and #271, which are independent fixes.

Design point from that session: each artifact has its own database, so tying the two boards together needs one
source of truth, and pm state is it. Shared epic ids across both boards is the join.

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

1. Pull the attached Enterprise Portal template and seed tool from Notion; base the backlog board on its CONFIG
   template, mapping `prio`/`rank` to epic priority and `rank`, `jira` to `externalUrl`, `removed` to dispositions.
2. Spec change `project-boards`: `board --json`, summary/why-now/theme/order fields, skill, command, opt-in row.
3. Build pm-dev's two boards by hand from the skill draft as the proving run; keep the process notes.
4. Gate, test, register the 0.55.0 release membership.
