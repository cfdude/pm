# Release planning: a mission, a milestone, and a backlog that stops feeding itself

Source: Rob Sherman, 2026-10-23, from running pm across many repos (reported for pm 0.5x and up).
Epic: `release-planning-mission-and-milestone` (P2, openspec lane, planned). Not scheduled to a release.
Reference artifact (from `market-intelligence-dev`, not a template yet): https://claude.ai/artifact/S421GrdRG1hp47DRb9grb2

This file keeps the feedback verbatim so the build has the exact ask. Sections 1 and 2 are Rob's words.
Section 3 is the orchestrator's reading of the reference artifact. Section 4 is a requirements sketch, not a
reviewed spec; it needs the OpenSpec proposal and Gate 1 before any build.

## 1. Feedback, part one (verbatim): the backlog-hygiene passes

> The issue I am seeing across all projects using the PM plugin (at least version 5.0 and up) is that the process is singularly development-focused. When there is a problem, an epic is created and tested. If testing uncovers new issues, two or three more epics are logged, plus another one just to close out the original epic with recommended changes. Work gets prioritized as P0 through P3, PM tasks it out, and once finished, five more epics appear. The process keeps generating work for itself, which works against establishing an MVP and shipping real software.
>
> We need to formalize a release planning process to manage this backlog:
>
> 1. Deduplication Pass. Check whether an item already exists in the backlog that is identical or similar before creating a new epic. If a similar item exists, modify it to incorporate the new criteria rather than opening a separate one. Currently, duplicate or near-duplicate items can sit at different priority levels (for example, one as a P1 and another as a P2 or P3), leaving one fixed while the duplicate remains in the backlog.
> 2. Validation Pass. Review every backlog item to verify whether it is still valid or has been superseded: (a) Check if the issue was already resolved during ongoing work (for instance, fixed in a Claude Code, Superpower, or Conductor lane). When pushing commits, we should also check whether the code can close out an open backlog item or handle a minor related change. (b) Check if older items (such as tickets created months ago) are no longer relevant because surrounding architecture changed or upstream fixes resolved the root cause.
> 3. Trimming and Deletion (Archival). Identify items that can be cut. Low-priority, pie-in-the-sky P3 items that will never be addressed should be removed so active development stays focused on what is needed for release. Flag these to confirm with a human, archive them with appropriate notes, and resurface them only if they come up again in the future.
> 4. Blocker Prioritization. Once the backlog is deduplicated, validated, and trimmed, identify all blockers and prioritize them so upcoming work is not held up.

## 2. Feedback, part two (verbatim): mission, planned releases, the milestone

> What comes next for me generally when I'm working on a project is proper release planning.
>
> Generally speaking, the PM plugin does a good enough job of assigning priorities (P0 through P3), but what it is not doing is proper release planning. By and large, that means we need to have some sort of mission for what we are developing at any given time. That mission can change over time, and that's okay, but it needs to be understood. The way we plan releases should be based entirely on meeting the goals of that mission.
>
> Let me give you a really great example. I have been working on the market intelligence project for five months now. It creates a database and an API of financial data. My whole goal and mission was to modernize it, update it, and ensure efficiency and stability so that I could lock it down, do a release, and then shift gears to update my trading platforms (personal-finance and personal-finance-paper) and their respective repositories.
>
> The problem is that because of this ongoing cycle of "do one item, but create four items worth of work," I have not been able to do any trading after six months, and the market intelligence platform had a backlog of 140 items. It is a terrible, atrocious development cycle, and the PM plugin plays a very large part in that.
>
> At this point, in terms of my own project planning, I have to establish a clear mission: stabilize the market intelligence platform, lock everything down, and ensure our API remains unchanged. At that point, I can actually start working on the trading platforms knowing that the API is stable. If there are changes that occur after that, they should be minor updates to the front-end platforms, not a major overhaul.
>
> Once that mission is stated, we need to do release planning so we can actually reach that goal.
>
> I have an artifact that just got generated for me from market intelligence that lays out how we are going to meet that goal, and I think this process should be formalized within the PM plugin. If we are going to use Claude Code, it can certainly generate artifacts that can be viewed by a human and referenced by Claude Code to make sure we are working on the exact same thing.
>
> The problem with the PM plugin right now, if you are using it by itself without Jira or GitHub Issues, is that you have zero visibility into what is going into the backlog, how it is growing, and where we are in meeting the mission to get us to a production release.
>
> This type of release planning process needs to be formalized in the PM plugin. While I don't know if this particular artifact should be used as a template for everything, it is the first one that has come up that is reasonable and provides good visibility and insight.
>
> We need a more backlog-oriented view that:
> 1. Shows planned releases.
> 2. Shows the items going into each release.
> 3. Explains why each release is planned the way it is and what it will actually deliver.
> 4. Lays down a milestone indicating where we hit our goal or meet the mission as stated today.
>
> That mission should be clear on the release planning artifact. Anything listed after that milestone should be designated as non-critical path: minor changes, small updates, maintenance, stability fixes, or efficiency gains. Even on this current artifact, the items listed after the cutover are lower priority compared to the mission of getting the API stable: back-end reliability, security, LLM routing, observability and monitoring, data quality, generators and tooling.
>
> This additional layer of release planning is a necessity. We must ensure we are not creating more work as we are performing work. Even when we move into a fully autonomous mode, the desire from a human standpoint is that "fully autonomous" means working toward our goals and completing the work in the planned releases. If new things come up, they should go into the backlog, but they must not be prioritized as the next things to build. Otherwise, we end up in a never-ending build cycle where the backlog just grows and we never reach our goal.
>
> It is alarming to look at the artifact market intelligence gave me: we started with 140 epics in the backlog, and only 107 were kept. Cutting 33 items tells me we have definitive problems in the PM plugin related to this.
>
> This is the epic I want to explore and get into the backlog. Write this down as a spec and tie it to the corresponding item in the backlog so that when we get to it, we have the exact details of this feedback.

## 3. What the reference artifact ("MI cutover plan") does

Read 2026-10-23 from the artifact itself. It is a single human-readable page, summary first:

- **The answer up front:** which release ends the mission ("platforms can start after R4"), epic count and planning days to that point, how many epics are true blockers of the mission, how many breaking changes, and the before/after backlog size (140 to 107).
- **Priority mix before and after,** with P1 redefined as "on the path to the mission" and back-end-only work capped at P2.
- **Release table as the spine:** release, theme, epic count, size, semver impact, and the consumer action each release forces. One row is the **cutover line** ("platforms begin the overhaul"); every release below it is non-critical-path.
- **Per-release rationale:** what ships, why in this release, and an exit check that can be run.
- **Consumer impact table:** what each downstream consumer must change at each step.
- **Green-light criteria:** numbered, each with a mechanical check, so "done" is not a feeling. Two need human numbers.
- **Archives and consolidations:** firm archives (with evidence), firm merges (survivor and folded-in epics), and a count that depends on human answers.
- **Decisions for the human:** numbered, each with a recommendation; the ones that shape the cutover are starred.
- **Parked ideas and uncertainties:** what was deliberately not turned into epics, and what the planner could not verify.

Its spot-check: 13 of 14 archive and merge verdicts held on a repo read, one was downgraded.

## 4. Requirements sketch (for the proposal; not yet reviewed)

Overlap with existing work: `backlog-grooming-pass` (P1, 0.54.0, Gate 1 passed, built) covers dedup, validation and trimming as a
repeatable read-only procedure and records dispositions. This epic does not redo that. It adds what grooming does not have: a
**mission**, a **milestone**, **release-ordered plans with rationale**, a **blocker pass against the mission**, and a **rule that
stops new work from jumping the queue**. Items 1 to 3 of part one are satisfied by grooming plus the intake hook below; item 4 and all of
part two are new.

1. **Mission is a recorded fact.** One current mission statement per project, with a date and a way to change it that keeps the old
   one (history, not overwrite). The engine records it; it never invents one. Surfaces: status, the SessionStart brief, the emitted
   rules block (one line, to hold the byte budget).
2. **Milestone.** A named point in the release order where the mission is met. Releases at or before it are critical path;
   everything after is non-critical path and says so wherever it is listed. Exit criteria for the milestone are numbered and each
   names its check, with a marker for criteria that need a human number.
3. **Planned releases with rationale.** Extends the existing release object (id, intent, members, deferred) with: order, theme,
   why it sits where it does, what it delivers, size weight, semver impact, and a runnable exit check. Must stay consistent with
   `triage-surfaces-open-release-intents`.
4. **Backlog visibility without an external tracker.** A read-only view of backlog size over time, intake rate against completion
   rate, share of the backlog on the critical path, and progress toward the milestone. Today a repo without Jira or GitHub Issues
   has none of this.
5. **The anti-spawn rule.** While a mission and milestone are set, a newly registered epic lands in the backlog flagged "off the
   critical path" unless the human or an explicit blocker check says otherwise, and `next` never recommends it ahead of critical-path
   work. "Fully autonomous" is bounded by the planned releases: new discoveries are recorded, not started. Follow-ups an epic
   generates while it is being built or reviewed are attributed to their parent so the amplification is measurable (epics born per
   epic delivered).
6. **Blocker prioritization against the mission.** After dedup, validation and trim, rank what blocks the milestone. A blocker is a
   `depends-on` edge or a named exit criterion, not a P-level. Priority meaning under a mission: P1 is on the path to the milestone.
7. **Human-readable plan artifact.** pm emits the data and a section outline; the agent renders the page (an Artifact or a repo
   markdown file) and the page is registered in `docs/artifacts/artifacts.md`. The page is the shared reference the human and the
   agent both read. pm itself never renders or hosts anything (instruction layer, not integration layer).
8. **Cuts are confirmed, recorded, reversible.** Anything dropped is archived with a disposition and reason after human
   confirmation, never deleted; it resurfaces only through the normal triage path. A planner that trims 140 to 107 reports each cut
   with evidence, as the reference artifact does.
9. **Commit-time close check.** On push, the agent checks whether the work closes or covers an open backlog item (part one, 2a).
   Instruction only; the engine supplies the open-epic candidates that share vocabulary with the commit.

## 5. Open design questions (for the proposal's design.md)

- Where does the mission live: `state.json` field, a release-level field, or a decision record (`record-decision` already exists)?
- Is the milestone a property of a release, or its own object that releases are ordered around?
- How does the anti-spawn rule interact with P0 production incidents? Needs an explicit bypass that is recorded, not silent.
- Is the artifact outline fixed, or a template the agent adapts? Rob said the MI artifact may not be the template for everything.
- Cost: every new per-session line spends tokens in every pm repo. The mission line must be measured against the rules-block budget.
- Does the cross-spec review (item 5 of the gate procedure) already cover "do a release's specs agree", and can the milestone's exit
  criteria reuse it rather than add a second gate?
- Process cause worth its own lesson: why the cycle amplifies (test finds issues, each becomes an epic, close-out epic per original).
  Measure it from this repo's own record before designing the rule (epics created per epic delivered).

## 6. Related epics

- `backlog-grooming-pass`: relates-to. Supplies dedup, validate and trim; this epic consumes its output.
- `triage-surfaces-open-release-intents`: relates-to. Makes release intent visible at intake; this epic gives that intent a mission.
- `epic-registration-clock`: relates-to (growth-over-time view needs `createdAt`).
