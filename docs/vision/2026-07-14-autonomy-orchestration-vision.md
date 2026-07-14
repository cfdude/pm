# Autonomy & orchestration vision — where we are, what's not built yet

> Captured 2026-07-14 to survive context compaction. Origin: a brainstorm about extending pm's
> "flip the switch" autonomy across four layers. Only the first layer shipped. This doc is the
> context for turning B/C/D below into real OpenSpec proposals when picked up — read it before
> scoping any of them, don't re-derive from scratch.

## The original four-part vision

The user (Rob) wanted to move pm from "present for every phase transition and every safety stop"
toward "flip a switch, trust the agent, review a report afterward" — at four nested scopes:

**A. Epic-level autonomy** — one epic runs unattended through phase transitions and destructive
actions, with a preflight risk-scan up front and a decision rule that still stops for genuine
unknowns.

**B. Epic-hierarchy orchestration** (originally called "initiative-level orchestration," renamed
— see below) — a whole *collection* of epics (e.g. a Jira initiative, or in pm's own model a
parent epic with children) runs end-to-end unattended, with per-child autonomy grants set based
on how much context/risk each child carries.

**C. Portfolio/architecture-consistency scanning** — while executing a hierarchy of epics, watch
the *rest* of the backlog for a shared architectural decision hiding behind several separate
epics (e.g. three epics each independently deciding "do we need Redis") so it gets made once, as
a P0, and propagated — instead of accumulating technical debt or building the same thing three
different ways.

**D. Infra-runbook preflight discipline** — before planning or executing any epic that might
touch infrastructure, read the relevant runbook (Rob's `~/Servers/infra-playbooks` repo already
exists and is already referenced in his global CLAUDE.md) to see what's actually been built,
rather than assuming memory (Honcho or otherwise) is reliably up to date. Wire this in as a
structural preflight step, not just a prose reminder that can be skipped.

## Status: only A shipped

**A is done** — pm 0.8.0 (see `CHANGELOG.md` and `skills/conductor/SKILL.md`'s "Epic-level
autonomy — the preflight scan" section): a per-epic `autonomy` block (`level`, `preAuthorized`,
`context`, `notifications`), a full-read preflight scan process, a five-criteria execution-time
decision rule (a-e: pre-authorized→proceed, no backup→STOP, destructive-but-restorable→WARN, no
context→STOP, consequential-and-not-notified→report), and an end-of-epic report. Validated via
two live dogfood runs against real target docs before being trusted.

**B, C, D were never built, and never even registered as backlog epics anywhere** — they were
scoped out of A's design doc as explicit "Forward-compatibility, not built in this sub-project"
notes, then the conversation moved into fixing real bugs (`--title`, status taxonomy, atomic
writes, a `reconcileNeeded` regression, `--link` validation) and B/C/D fell out of view. Nothing
was lost technically (A's per-epic scoping was deliberately designed so B doesn't require
re-architecting A), but nothing was tracked either — hence this doc, so a future session can pick
any of them up without re-deriving the reasoning.

## B — Epic-hierarchy orchestration: the Jira-tier correction

Original framing used the word "initiative" (a Jira concept: Initiative → Epic → Story/Task/Bug →
Subtask). Rob caught that **Jira deprecated the Initiative→Epic grouping to Premium/Enterprise
tiers** — so anything pm builds here must not depend on it, or free/standard-tier Jira users get
locked out.

**The correction, already agreed:** don't build a new "initiative" concept. Reuse pm's *existing*
`parent` field (a pm epic can already be the parent of other epics — arbitrary tree, single-parent,
cycle-validated). A pm parent-epic with children **is** the grouping. This maps cleanly onto
Jira's free/standard-tier 3-level hierarchy:

- pm parent-epic ↔ Jira **Epic**
- pm child-epic ↔ Jira **Story / Task / Bug**
- pm epic's own inline stories/steps ↔ Jira **Subtask**

This mapping is about how pm's tree gets *mirrored* to a tracker, not a dependency of the tree
itself — it works identically whether or not a tracker is configured.

**What B actually needs to build**, per the epic-autonomy design's Forward-compatibility note:

1. A way to walk a parent-epic's children and, for each, run the *same* preflight-scan primitive
   A already built (`scan-epic-for-autonomy-readiness`, documented in the conductor skill) —
   it's already designed to take one epic id at a time regardless of caller, so this should be a
   thin orchestration loop, not a new scan mechanism.
2. Per-child autonomy grants that can differ — a child touching infrastructure needs more
   context/pre-authorization than a sibling that doesn't. A's per-epic (not global) `autonomy`
   scoping was deliberately chosen to support exactly this.
3. Rob's own worked example (verbatim from the brainstorm, keep this as the concrete test case
   when scoping): "if we set up an initiative with five epics, one of those epics might require
   a lot more context and approval to execute. When the initiative process is kicked off... it
   detects that this specific epic might change infrastructure, thereby requiring extra context
   and permissions... During the interactive session between Claude Code and the human user when
   kicking off that [hierarchy], there needs to be both the infrastructure pre-flight [see D] and
   a scan of the epics to determine if additional context or approval is needed. If it is, we may
   have to attach that context and approval to that epic specifically... That context could be
   contained within the Jira issue itself, the epic issue itself, or attached elsewhere."
4. End-of-hierarchy reporting: per-epic summaries plus a consolidated report flagging
   *controversial* decisions the human should know about (they may affect other backlog items —
   this is the seed of C, see below).

**Explicitly not required:** no new Jira concept, no premium-tier dependency, no new top-level
`state.json` field beyond what `parent` already provides.

## C — Portfolio/architecture-consistency scanning

The thinnest of the three — captured almost as an aside in the original brainstorm, never
designed at all. Rob's framing: "we need to look at the entirety of the backlog... to avoid a
narrow focus... Rather than taking on technical debt, we should first assess if we need to stand
up something architecturally — like Redis, a Postgres database, or a specific Python client...
Architecture decisions may need to be P0 and must be carried through/propagated to other in-flight
or planned initiatives so everyone else is aware."

Open questions nobody has answered yet (surface these when scoping, don't guess):
- Is this a scan that runs once per hierarchy-execution kickoff (tied to B), or a standing
  periodic backlog audit independent of any one epic-hierarchy run?
- What counts as "a shared architectural decision hiding behind several epics" — keyword/topic
  clustering across epic titles? An LLM read of the whole backlog? Something else?
- How does a detected cross-cutting decision actually get "propagated" — a new P0 epic gets
  created and linked (`relates-to`?) to every epic it affects? A Honcho memory broadcast?

This is the epic most likely to need its own brainstorm session before a design doc — it has the
least prior thinking behind it of the three.

## D — Infra-runbook preflight discipline — ✅ DONE 2026-07-14

**What actually shipped (turned out to be a docs/taxonomy task, not a pm engine change):**
- Reorganized `~/Servers/infra-playbooks` — `railway/` split into `general/` (cross-project) and
  on-demand `<project-slug>/`; new top-level `machines/<hostname>/` group (never nested under a
  provider folder); `~/SERVER_PORTS.md` migrated into `machines/rob-macbook-pro-max/server-ports.md`
  and the standalone file deleted.
- Scaffolded a second repo, `~/Servers/highway-infra-playbooks`, for Highway-side infra (Bitbucket,
  not GitHub — Rob caught that Highway and personal/Onvex infra need separate repos on separate
  hosts). No Bitbucket remote pushed yet — local-only until workspace/project confirmed.
- Rewrote the global CLAUDE.md's Ports + Infra-playbooks bullets to route by whose infra it is
  (personal → `infra-playbooks`, Highway → `highway-infra-playbooks`) and to state the grouping
  rules explicitly instead of leaving the structure flat.

**Original section below, preserved for context:**

**Partially exists already, just not wired into pm.** Rob's global CLAUDE.md already has an
"Infra playbooks" section: `~/Servers/infra-playbooks` (repo `onvexai/infra-playbooks`, private) —
"BEFORE any infra work... read the relevant `railway/*.md` or `cloudflare/*.md` playbook first."
Verified to exist locally with real content during the original brainstorm session (not vaporware).

**The actual gap Rob named:** "We should not assume 'Honcho memory' is working correctly. Before
we execute or plan an epic, we should read the infrastructure runbook repo to see what has
changed." — i.e. this is currently only a prose instruction in CLAUDE.md that can be (and per
Rob's own skepticism, should not be assumed to be reliably) followed. It isn't a *structural*
preflight step pm enforces or even prompts for.

**What D needs to build:** wire a runbook-read step into pm's epic/hierarchy preflight — before
scanning an epic for autonomy-readiness (A) or kicking off a hierarchy (B), check whether the
epic looks infrastructure-related, and if so, instruct the agent to read the relevant
runbook file(s) first, determining whether to build on existing architecture or deploy something
new (maintaining separation of concerns) before the risk-scan even runs. Rob's own words: "a
self-reinforcing feedback loop: architecture is discussed when something new is proposed, but it
is also evaluated every time something is about to be built."

Likely the smallest of the three to scope, since the runbook repo and convention already exist —
this is about wiring pm's instruction-emission into an existing discipline, not inventing one.

## Suggested build order

B before C: C's "propagate to other in-flight initiatives" concept presumes B's hierarchy
execution exists to propagate *into*. D can be built independently of B/C (it only depends on A's
existing preflight-scan hook point) and is probably the cheapest, so it's a reasonable first pick
if the goal is quick, low-risk progress rather than tackling the biggest piece first.
