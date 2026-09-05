// scripts/lib/integrity.mjs
// READ-ONLY checks over the conductor's own record: shapes that cannot be true, reported with
// the epic they concern and enough detail to act on. May import constants.mjs,
// epic-progress.mjs, disposition.mjs, links.mjs and git.mjs — and nothing under those imports
// back up.
//
// REPORTS, NEVER REPAIRS. Nothing here writes state and nothing here blocks a command. That is
// not a stylistic preference: a check that repaired would be a second writer racing the paths
// that produce the records it reads, and a check that blocked would make an audit finding into
// an outage. The remediation for every finding below is a command a human or an agent runs.
//
// A check that finds nothing is still a check that RAN, and the report says so. A report that
// listed only its non-empty checks would be indistinguishable from a report whose empty checks
// had been quietly removed — and "the check measured nothing" is exactly the failure this
// capability exists to end.

import { isInitialized, loadState } from "./state.mjs";
import { archivedChanges, epicProgress, strippedChangeId } from "./epic-progress.mjs";
import { gateHasEvidence, isOpenspecLane, releaseMembers } from "./constants.mjs";
import { commitDate, isAncestor, objectExists, reachableFromAnyRef } from "./git.mjs";
import { isArchiveBackfilled, outcomeOf, stampedBy } from "./disposition.mjs";
import { epicReferences, isKnownLinkType, isRenderableLink, KNOWN_LINK_TYPES, supersededEpics } from "./links.mjs";
import { claimExpiry, isLiveClaim } from "./claim-shape.mjs";

/** The outcomes that are their own explanation. Each carries a REQUIRED reason saying why the
 *  work did not complete, so an epic holding one is a record working rather than a record
 *  broken — the release's own flagship case is a change killed at Gate 1 with 47 tasks and no
 *  code written, which is zero-ticked by construction. `declined` is the extreme of the same
 *  shape: an ask turned down at intake was never worked at all, so leaving it in scope would
 *  make every recorded decline a permanent finding — which is how a team learns to stop
 *  recording them, and the record goes silent again. */
const EXPLAINED_OUTCOMES = ["killed", "superseded", "abandoned", "declined"];

/** THE scope rule for the completion-shaped checks. Exactly two exclusions and nothing else.
 *
 *  `unknown` STAYS IN SCOPE, and that is the whole design. It is the value the engine stamps
 *  when nobody was asked, and its reason is a path name rather than an explanation of why the
 *  work did not complete — which is the property the two exclusions above actually rest on.
 *
 *  Scoping these checks to `delivered` instead would make them INERT, and that is measurable
 *  rather than arguable: this repository holds 69 archived epics and 3 carrying a passing
 *  Gate 2 (measured 2026-08-23), so after the migration that stamps `delivered` only where such
 *  a verdict exists, a `delivered`-only zero-ticked check has zero candidates in the very
 *  repository whose live data this rule cites as its evidence. */
export function inCompletionScope(epic) {
  if (EXPLAINED_OUTCOMES.includes(outcomeOf(epic))) return false;
  // A backfilled epic never passed through the conductor while it was in flight: it has no gate
  // verdict, no start time and — where the change was abandoned — no ticked tasks. Those are
  // properties of a record rebuilt from disk, not of a badly managed epic, and without this
  // exclusion the backfill's first run fills the report with findings against changes archived
  // long before the conductor could have guarded them.
  if (isArchiveBackfilled(epic)) return false;
  return true;
}

/** Are `a` and `b` the same commit written at different abbreviation lengths? */
const sameSha = (a, b) => !!a && !!b && (a.startsWith(b) || b.startsWith(a));

/** The commit hashes a verdict's NOTE cites, minus the two the verdict already records as
 *  fields.
 *
 *  The range is read from `baseSha`/`headSha` and NEVER parsed out of the note — that prose
 *  dependency is exactly what the structured fields were added to remove. The note is read only
 *  for the hashes it MENTIONS, and the two field values are subtracted so a note that spells its
 *  own range out ("reviewed d168b1e..04c54c8") does not report its own base as uncontained.
 *
 *  A hex-looking token is not necessarily a commit: an 8-digit date, or an ordinary word like
 *  `defaced`, matches this pattern. Those are not filtered here — `isAncestor` answers `null`
 *  for a hash this repository has never seen, and only a definite `false` is reported. The
 *  three-valued answer is doing the filtering, deliberately, because the alternative is a
 *  cleverer regex that would still be guessing. */
function citedShas(entry) {
  const note = typeof entry.note === "string" ? entry.note : "";
  return [...new Set(note.match(/\b[0-9a-f]{7,40}\b/g) || [])]
    .filter(sha => !sameSha(sha, entry.baseSha) && !sameSha(sha, entry.headSha));
}

/** Every commit sha this record holds, each with the epic and the FIELD that holds it.
 *
 *  DERIVED from a mechanical sweep of the writers, not typed from memory: `rg "baseSha|headSha|
 *  attributedCommits" scripts/lib` finds exactly two holders — `attributedCommits[]` (written by
 *  update-epic's `--attribute-commit`, seeded by state.mjs's pushEpic) and a gate verdict's
 *  `baseSha`/`headSha` (written by gate-review-writeback.mjs). A third holder added later must
 *  be added HERE, and the check below then covers it for free; a check that enumerated only the
 *  attribution array would leave every gate verdict's range — the half that makes a verdict
 *  checkable at all — unwatched.
 *
 *  The `where` is carried because a finding that says only "a sha is gone" makes the reader go
 *  find which field held it. */
export function recordedShas(state) {
  const out = [];
  const push = (epic, where, sha) => {
    if (typeof sha === "string" && sha.trim()) out.push({ epic, where, sha: sha.trim() });
  };
  for (const e of state.epics || []) {
    if (!e) continue;
    for (const sha of Array.isArray(e.attributedCommits) ? e.attributedCommits : []) {
      push(e.id, "attributedCommits", sha);
    }
    for (const gate of ["gate1", "gate2"]) {
      const entry = e.gateReview && e.gateReview[gate];
      if (!entry) continue;
      push(e.id, `${gate}.baseSha`, entry.baseSha);
      push(e.id, `${gate}.headSha`, entry.headSha);
    }
  }
  return out;
}

/** The epics carrying an `ungated` Gate 2 — archived with no review from anyone.
 *
 *  THE definition, read by the integrity report AND by the briefing, so the two can never name
 *  different sets. It is a pure function of `state.json` and is recomputed at every composition:
 *  nothing stores it, and nothing consumes it on delivery.
 *
 *  That is the deliberate opposite of the write-contention warning. The contention warning
 *  describes a run of events that has ENDED, so it is consumed once a session has seen it; an
 *  `ungated` verdict persists in the record until a real Gate 2 supersedes it, so a notice that
 *  consumed would report the condition to one session and hide it from every session after.
 *
 *  Scoped by `inCompletionScope`, exactly as every other completion-shaped check is. An epic the
 *  heal flipped to `archived` and an agent then closed `killed`, `superseded` or `abandoned` will
 *  never acquire the passing Gate 2 that is this condition's ONLY clearing path — the code was
 *  never written, or was written and thrown away — so without the scope rule its entry is
 *  permanent and unclearable, which is precisely the shape the backfill exclusion below it was
 *  added to prevent. Applied HERE rather than at the check, so the report and the brief can never
 *  name different sets. */
export function ungatedArchives(epics) {
  return (epics || []).filter(e =>
    e && e.gateReview && e.gateReview.gate2 && e.gateReview.gate2.verdict === "ungated" &&
    inCompletionScope(e));
}

/** The registry. One entry per check: a stable `id` a reader can grep for, a one-line `title`
 *  saying what shape it looks for, and `run(state)` returning findings.
 *
 *  A finding is `{epic, detail}` — `epic` is the id it concerns (null where the finding is about
 *  something other than an epic, e.g. a directory), `detail` is the sentence a reader acts on.
 *  The shape is uniform so the formatter never special-cases a check, which is what keeps
 *  adding a check to one array from being a change to the reporting surface too. */
export const CHECKS = [
  {
    id: "archived-with-zero-ticked-tasks",
    title: "an archived epic whose task source exists and has nothing ticked",
    run(state) {
      const out = [];
      for (const e of state.epics) {
        if (e.status !== "archived" || !inCompletionScope(e)) continue;
        const p = epicProgress(e);
        // Gated on `total > 0`, NEVER on `done === 0`. epicProgress() returns `{done: 0,
        // total: 0}` for an archived epic whose source is gone — the ordinary case for most of
        // them — so a `done === 0` test reports every source-less archived epic in the repo and
        // says nothing about any of them. `total > 0` means a real source with real checkboxes.
        if (p.total > 0 && p.done === 0) {
          out.push({ epic: e.id, detail: `archived at ${p.done}/${p.total} (source: ${p.source})` });
        }
      }
      return out;
    },
  },
  {
    id: "verdict-range-omits-cited-commits",
    title: "a gate verdict's note cites commits its recorded range does not contain",
    run(state) {
      const out = [];
      for (const e of state.epics) {
        for (const gate of ["gate1", "gate2"]) {
          const entry = e.gateReview && e.gateReview[gate];
          if (!entry || !gateHasEvidence(entry)) continue;
          // Only a definite `false` — "git answered, and this commit is not reachable from the
          // recorded head". `null` means git could not answer at all, which is not evidence of
          // anything and must never be reported as a finding.
          const uncontained = citedShas(entry).filter(sha => isAncestor(sha, entry.headSha) === false);
          if (uncontained.length) {
            out.push({ epic: e.id, detail:
              `${gate} records ${entry.baseSha}..${entry.headSha} but its note cites commit(s) ` +
              `that range does not contain: ${uncontained.join(", ")}` });
          }
        }
      }
      return out;
    },
  },
  {
    id: "archived-with-no-gate-2-review",
    title: "an epic archived with an `ungated` Gate 2 — no review from anyone",
    run(state) {
      return ungatedArchives(state.epics).map(e => ({ epic: e.id, detail:
        "archived by the drift heal with no Gate 2 review recorded by anyone. A standing " +
        "condition, not an episode: it holds until a real passing verdict with its commit range " +
        `supersedes it — record-gate-review ${e.id} --gate 2 --verdict pass --base-sha <sha> ` +
        "--head-sha <sha>" }));
    },
  },
  {
    id: "delivered-epic-attributed-no-commits",
    title: "a delivered epic with a passing Gate 2 whose attribution array is present and empty",
    run(state) {
      const out = [];
      for (const e of state.epics) {
        if (outcomeOf(e) !== "delivered") continue;
        const gate2 = e.gateReview && e.gateReview.gate2;
        if (!gate2 || gate2.verdict !== "pass") continue;
        // PRESENT AND EMPTY, never absent. Absent means the epic predates the capability and
        // nothing can be concluded; empty means it was created under the capability and asserts
        // that nothing was attributed to it. This is precisely the shape of "the agent ignored
        // the --attribute-commit obligation", and without the check that unmet obligation leaves
        // no trace anywhere — the staleness gate behaves correctly on an empty array, so it
        // reports nothing either.
        if (Array.isArray(e.attributedCommits) && e.attributedCommits.length === 0) {
          // WITHDRAWN READS DIFFERENTLY FROM NEVER-ATTRIBUTED. Gate 2: telling an agent to
          // "record the range that shipped" on an epic that deliberately WITHDREW its shas hides
          // the judgment somebody made, and invites re-attributing the very commit that was
          // withdrawn — with the recorded reason visible nowhere. Same finding, same shape as
          // #159 in this release: a field written and never read.
          const withdrawn = Array.isArray(e.withdrawnCommits) ? e.withdrawnCommits : [];
          out.push({ epic: e.id, detail: withdrawn.length
            ? `recorded as delivered with a passing Gate 2 and attributes no commits, having ` +
              `WITHDRAWN ${withdrawn.map(w => `${w.sha} ("${w.reason}")`).join("; ")}. A ` +
              `withdrawal corrects the record and does not discharge the obligation — attribute ` +
              `the commits that actually shipped: update-epic ${e.id} --attribute-commit <sha>`
            : "recorded as delivered with a passing Gate 2 but attributed no commits — record " +
              `the range that shipped with: update-epic ${e.id} --attribute-commit <sha>` });
        }
      }
      return out;
    },
  },
  {
    id: "archived-openspec-epic-with-no-gate-1",
    title: "an openspec-lane epic archived with a passing Gate 2 and no Gate 1 verdict",
    run(state) {
      const out = [];
      for (const e of state.epics) {
        if (e.status !== "archived" || !isOpenspecLane(e) || !inCompletionScope(e)) continue;
        const gates = e.gateReview || {};
        if (!gates.gate2 || gates.gate2.verdict !== "pass" || gates.gate1) continue;
        // REPORTED, never refused. Gate 1 gates CODE, and by archive time the code is written —
        // a refusal at the archive transition would be demanding a spec review of work that has
        // already shipped, which is theatre. Reporting it is what makes a recorded Gate 1 read
        // by anything at all.
        out.push({ epic: e.id, detail:
          "archived with a passing Gate 2 and no Gate 1 (spec review) verdict — the spec review " +
          "either did not happen or was never recorded" });
      }
      return out;
    },
  },
  {
    id: "archive-directory-has-no-epic",
    title: "a directory under openspec/changes/archive/ that corresponds to no epic",
    run(state) {
      const held = new Set();
      for (const e of state.epics) { held.add(e.id); held.add(strippedChangeId(e.id)); }
      // Registering it is explicitly OUT of scope here — that belongs to `sync`'s archive
      // reconciliation. A check that registered would be a repair, and this module repairs
      // nothing.
      return archivedChanges().filter(c => !held.has(c.id)).map(c => ({ epic: null, detail:
        `archive/${c.dir} is an archived change the conductor holds no epic for — \`/pm:sync\` ` +
        "registers it; this check only reports it" }));
    },
  },
  {
    id: "heal-archived-epic-passed-gate-2",
    title: "an epic the heal archived reads `unknown` while carrying a passing Gate 2",
    run(state) {
      const out = [];
      for (const e of state.epics) {
        if (!stampedBy(e, "archive-drift-heal") || outcomeOf(e) !== "unknown") continue;
        const gate2 = e.gateReview && e.gateReview.gate2;
        if (!gate2 || gate2.verdict !== "pass") continue;
        // A `delivered`-shaped record wearing an `unknown` outcome. The heal is behaving
        // correctly — nobody supplied a disposition at the moment it flipped the status, and
        // `unknown` says exactly that — and the epic gets no `ungated` entry either, because it
        // already had a real verdict. So without this check the mismatch is visible nowhere.
        out.push({ epic: e.id, detail:
          "archived by the drift heal with a passing Gate 2 but no recorded disposition. This " +
          "is the ordinary end of the documented workflow, and the fix is the ordinary next " +
          `step: update-epic ${e.id} --status archived --outcome delivered --no-deferrals` });
      }
      return out;
    },
  },
  {
    id: "gate-recorded-as-bookkeeping",
    title: "a gate verdict recorded as bookkeeping rather than as review",
    run(state) {
      const out = [];
      for (const e of state.epics) {
        const g1 = e.gateReview && e.gateReview.gate1;
        const g2 = e.gateReview && e.gateReview.gate2;
        // ARM 1 — an UNEVIDENCED verdict dated AFTER the work it reviewed had already merged.
        // The merge commit is defined as the LAST hash in the epic's attribution array, and
        // where that array is absent or empty this arm simply does not apply: every other
        // reading of "the merge commit" is either inert on all live epics or fires on
        // essentially all of them, and a check that fires on everything is a check nobody reads.
        //
        // A verdict CARRYING checkable evidence is exempt, and that exemption is what keeps this
        // arm from firing on compliance. This release's own two obligations — "attribute each
        // commit at the moment it is made" and "record Gate 2 after the implementation, before
        // docs" — TOGETHER GUARANTEE `reviewedAt > commitDate(last attributed)` for every
        // correctly run gate. Measured on this repository the moment it exercised both: the arm
        // reported its own honest verdict. The audited instances this arm exists for are
        // unevidenced by construction — they predate the sha fields and were written 83 seconds
        // after a squash-merge with no notes and no range — while a verdict that records
        // `baseSha..headSha` states what it covered, and being dated after the last commit it
        // names is what a real review looks like rather than a bookkeeping signature. Whether
        // that recorded range actually REACHES the attributed commits is a different question,
        // answered by gateStaleness() and refused at the archive gate, not guessed at here.
        const attributed = Array.isArray(e.attributedCommits) ? e.attributedCommits : [];
        const mergedAt = attributed.length ? commitDate(attributed[attributed.length - 1]) : null;
        for (const [gate, entry] of [["gate1", g1], ["gate2", g2]]) {
          if (!entry || !entry.reviewedAt || !mergedAt || gateHasEvidence(entry)) continue;
          if (Date.parse(entry.reviewedAt) > Date.parse(mergedAt)) {
            out.push({ epic: e.id, detail:
              `${gate} was recorded ${entry.reviewedAt} — after the epic's merge commit ` +
              `${attributed[attributed.length - 1]} (${mergedAt}), so the verdict post-dates the ` +
              "work it claims to have reviewed" });
          }
        }
        // ARM 2 — two gates recorded within a minute of each other. A spec review and an
        // implementation review of the same change are never seconds apart; the audited instance
        // recorded both 47 ms apart, with no notes, 83 seconds after the squash-merge.
        if (g1 && g2 && g1.reviewedAt && g2.reviewedAt) {
          const apart = Math.abs(Date.parse(g1.reviewedAt) - Date.parse(g2.reviewedAt));
          if (apart <= 60_000) {
            out.push({ epic: e.id, detail:
              `gate 1 and gate 2 were recorded ${apart} ms apart — a spec review and an ` +
              "implementation review of the same change are never that close together" });
          }
        }
      }
      return out;
    },
  },
  {
    id: "change-registered-under-two-lanes",
    title: "one change id registered as two epics under different lanes",
    run(state) {
      // Identity is the DATE-PREFIX-STRIPPED id, the same normalization `isArchived()` applies.
      // Literal equality is the implementation that reads as coverage and measures nothing:
      // measured on this repository, ZERO ids collide literally while FOUR changes are
      // registered twice — so a literal check reports none of them while claiming four exist.
      const groups = new Map();
      for (const e of state.epics) {
        const key = strippedChangeId(e.id);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(e);
      }
      const out = [];
      for (const [key, members] of groups) {
        if (members.length < 2) continue;
        const lanes = new Set(members.map(e => e.lane || "openspec"));
        if (lanes.size < 2) continue;
        // The lanes are READ, never assumed uniform: of this repository's four pairs, two hold
        // `decision` rather than `openspec` on the un-prefixed side.
        out.push({ epic: key, detail:
          `registered ${members.length} times under different lanes: ` +
          members.map(e => `\`${e.id}\` (${e.lane || "openspec"})`).join(" and ") +
          // The known explanation, given alongside the pair. Every such pair in this repository
          // is the same deferred bug, and a reader who has to rediscover that for each one is
          // being handed a symptom instead of a cause. Naming it costs no new state — the
          // alternative considered was a machine-readable `deliberate` field, which would have
          // been a fifth disposition scope invented to quiet one check's output. When #64/#69
          // lands, these findings disappear on their own.
          " — likely cause: #64/#69, `sync` registering a finished plan file as a second epic" });
      }
      return out;
    },
  },
  {
    id: "link-of-unknown-type",
    title: "a stored link whose type nothing in the engine knows — an edge that reads as a relationship and is not one",
    run(state) {
      // gh#100's other half. `--link` now refuses an unknown type on WRITE, but records written
      // before that hold them, and the read paths must keep accepting those or an existing state
      // file stops loading (see isRenderableLink() in links.mjs). Reporting is therefore the
      // ONLY correct treatment: a repair would have to guess which type was meant, and
      // `resolves-blocker-for`→`depends-on` — the guess that looks most obvious — points the
      // opposite way and would corrupt queue ordering.
      const out = [];
      for (const e of state.epics || []) {
        for (const l of (e && Array.isArray(e.links) ? e.links : [])) {
          if (!isRenderableLink(l) || isKnownLinkType(l.type)) continue;
          out.push({ epic: e.id, detail:
            `link \`${l.type}→${l.epic}\` — '${l.type}' is not one of ${KNOWN_LINK_TYPES.join(", ")}, ` +
            "so every consumer that switches on the type ignores it. Fix it with " +
            `\`update-epic ${e.id} --link\` (which replaces the whole array — pass every link you want kept).` });
        }
      }
      return out;
    },
  },
  {
    id: "dangling-epic-reference",
    title: "a reference in the record that names an epic the record does not hold",
    run(state) {
      // The sibling of archive-directory-has-no-epic, and derived rather than enumerated: the
      // holders come from epicReferences() in links.mjs, the same declaration `remove-epic`
      // sweeps, so a sixth place the record holds an epic id is covered by both or by neither.
      // The reported instance was a release deferral left behind by remove-epic; `PROJECT.md`
      // renders one of those as a deferral pointing at nothing.
      const held = new Set((state.epics || []).map(e => e && e.id));
      return epicReferences(state)
        .filter(r => !held.has(r.epic))
        .map(r => ({ epic: r.holder || undefined, detail:
          `${r.where} names \`${r.epic}\`, which is not an epic in this record` +
          (r.drop ? "" : " — a detour-stack frame, so `/pm:resume` would pop a frame that " +
            "names nothing") }));
    },
  },
  {
    id: "superseded-epic-never-ended",
    title: "an epic another epic declares it supersedes, still carrying a non-terminal status",
    /** gh-112's deferred follow-up. That change shipped the `supersedes` link type and taught
     *  `triage` to mark a candidate dead when some other epic holds `supersedes: <this>` — so an
     *  agent is told not to consolidate a fourth ask into it. Nothing ever told anyone the epic
     *  itself was never ENDED. A consolidation that declares the replacement and leaves the
     *  replaced epic `queued` produces two rows for one piece of work, and the backlog only ever
     *  grows — the bloat gh-112 was filed about, half-fixed.
     *
     *  THE SUPERSEDING EPIC'S OWN STATE IS DELIBERATELY NOT CONSULTED. `triage` treats the
     *  declaration as sufficient — the moment A says it replaces B, B is dead to the scorer,
     *  whatever became of A — and the two readers must not disagree about which epics are dead.
     *  It is also the right answer on its own terms: if A was itself killed, B does not
     *  automatically come back to life, it needs a decision, and a decision is exactly what a
     *  disposition records.
     *
     *  A LINK NAMING AN EPIC THE RECORD DOES NOT HOLD is not reported here. That is
     *  `dangling-epic-reference`'s shape, it reads the same links through `epicReferences()`, and
     *  reporting it twice would count one defect under a heading naming the wrong problem.
     *
     *  SCOPED AWAY FROM TERMINAL EPICS BY CONSTRUCTION (gh-138): only an epic whose status is NOT
     *  `archived` can be reported. The check is about an ending that never happened, not about
     *  the fact of supersession, so an epic that ended — with any outcome — is silent forever
     *  after. `inCompletionScope` is not applied for the same reason it is not applied to the
     *  release check: that rule exempts epics whose ending IS explained, and nothing reported
     *  here has an ending at all. */
    run(state) {
      const epics = state.epics || [];
      const superseded = supersededEpics(epics);
      const out = [];
      for (const e of epics) {
        if (!e || !superseded.has(e.id) || e.status === "archived") continue;
        out.push({ epic: e.id, detail:
          `\`${superseded.get(e.id)}\` declares that it supersedes this epic, which is still ` +
          `\`${e.status}\` — one piece of work carrying two live rows. End it with the record ` +
          `the consolidation implies: update-epic ${e.id} --status archived --outcome superseded ` +
          `--reason "<what replaced it>" --no-deferrals` });
      }
      return out;
    },
  },
  {
    id: "delivered-release-epic-left-open",
    title: "an epic still open in a release that has already delivered, and was not deliberately cut",
    /** gh-137. 0.27.0 shipped, its parent epic archived `delivered`, and all TWENTY member epics
     *  stayed `queued` with no disposition — after which `next` recommended two P0s that had
     *  shipped hours earlier, in the release the conductor had itself just recorded as delivered.
     *  The record over-reporting REMAINING work, which is the exact inverse of the defect the
     *  release was named for. Three signals were in `state.json` at that moment and nothing read
     *  one of them.
     *
     *  WHAT "THE RELEASE HAS DELIVERED" MEANS HERE, and it is a CHOICE rather than a derivation:
     *  a release object carries no parent pointer and no delivery marker — `id`, `intent`,
     *  `target`, `deferred[]`, `crossSpecReview` and nothing else — so "the release's parent epic
     *  is delivered" is not a question this schema can be asked. The reading is therefore
     *  MEMBER-DERIVED: at least one member carries a `delivered` disposition. Nothing new is
     *  recorded for it, which is the point — the act that reliably happens at the end of a
     *  release is archiving the change that shipped it, and a marker an agent must remember to
     *  set is the same class of forgetting that produced the defect.
     *
     *  THE IN-FLIGHT GUARD is what keeps that reading from becoming noise. A release whose
     *  members ship one at a time would otherwise be reported from the moment the FIRST one
     *  landed, with every legitimately-queued sibling named as a finding — gh-138's failure
     *  exactly: an inflated count is how a true warning gets ignored. So a release holding any
     *  `active` or `paused` member is silent: work is in flight there and the ending has not
     *  come yet. It is a heuristic and it is stated as one — a repo that never marks an epic
     *  `active` gets this check firing mid-release, and the two remedies it prints are both
     *  correct answers in that case anyway.
     *
     *  THE EXCLUSION HALF — `deferred[]` — is honoured because the release object ALREADY
     *  distinguishes "cut on purpose" from "shipped", and consuming only one half of that
     *  distinction is the whole shape of the bug. Note what it defends against: the `--defer`
     *  verb DELETES `epic.release` when it records an exclusion, so a deferred epic is not a
     *  member and the ordinary CLI path can never reach this filter. It is reachable from a
     *  HAND-EDITED state — which this repository's own history has repeatedly produced — and
     *  from any future writer that records an exclusion without clearing membership. Reported
     *  as a guard against the record, not against the verb.
     *
     *  SCOPED AWAY FROM TERMINAL EPICS BY CONSTRUCTION (gh-138): the only epic this can report
     *  is one whose status is NOT `archived`. The condition it detects IS "work ended and the
     *  record does not say so", so every finding is by definition work that can still be acted
     *  on, and discharging one removes it. `inCompletionScope` is deliberately NOT applied —
     *  that rule exempts epics whose ENDING is already explained, and an epic reported here has
     *  no ending recorded at all. */
    run(state) {
      const out = [];
      for (const rel of Array.isArray(state.releases) ? state.releases : []) {
        if (!rel || !rel.id) continue;
        const members = releaseMembers(state.epics, rel.id);
        if (!members.some(e => outcomeOf(e) === "delivered")) continue;
        if (members.some(e => e.status === "active" || e.status === "paused")) continue;
        const cut = new Set((Array.isArray(rel.deferred) ? rel.deferred : [])
          .map(d => d && d.epic).filter(Boolean));
        for (const e of members) {
          if (e.status === "archived" || cut.has(e.id)) continue;
          out.push({ epic: e.id, detail:
            `still \`${e.status}\` in release \`${rel.id}\`, which has already delivered — and ` +
            "it is not in that release's deferred[], so the record says neither that it shipped " +
            "nor that it was cut. Give it the ending it actually had: " +
            `update-epic ${e.id} --status archived --outcome delivered --no-deferrals — or, if ` +
            `it was cut, record that instead: release ${rel.id} --defer ${e.id} --reason "<why>"` });
        }
      }
      return out;
    },
  },
  {
    id: "recorded-sha-the-repository-cannot-resolve",
    title: "a recorded commit sha this repository can no longer resolve — orphaned, or already gone",
    /** The recorded shas ARE the evidence: a Gate 2 verdict means "a reviewer read this range",
     *  and the range is the only thing that makes the claim checkable or lets it go stale. A
     *  squash-merge — the only merge method this repository permits, and a common one everywhere
     *  — produces one commit whose sole parent is the target branch's previous tip, leaving every
     *  commit on the merged branch a parent of nothing, reachable from no ref, and deleted by the
     *  next `git gc` (default `gc.pruneExpire`: two weeks). Measured on cfdude/pm immediately
     *  after 0.28.0 merged: 36 recorded shas, 0 reachable from any ref, 36 still in the object
     *  store. Every check was green throughout.
     *
     *  THE EXISTING CHECKS ARE NOT WRONG, and this one does not change them. `isAncestor()` is
     *  three-valued and `null` — "git could not answer" — is never a finding, because silence IS
     *  the correct answer to "is this one commit outside the range". It is the wrong answer to
     *  "can this record be verified at all any more", and only the first question was being
     *  asked. This check asks the second, from the object store and the ref graph rather than
     *  from ancestry, so nothing here can make an ancestry check start reporting `null` as
     *  failure.
     *
     *  TWO ARMS, because recoverable-now and already-gone are different reports:
     *
     *  ARM 1 — ORPHANED. The object is in the store and no ref contains it. Unambiguous: a fresh
     *  clone cannot produce this shape, because a clone transfers only reachable objects. Urgent
     *  and actionable — `git tag` it and it is saved; wait for `gc` and it is not.
     *
     *  ARM 2 — ABSENT. The object is not here at all. Ambiguous by construction: "destroyed
     *  here" and "this clone never had it" are the same observation. So it is gated on the PROBE
     *  below rather than reported on sight.
     *
     *  THE PROBE — does this clone hold this record's history at all? If it resolves NONE of the
     *  recorded shas, arm 2 says nothing. That is the population-level reading of exactly the
     *  `null` isAncestor() returns per sha: not "the evidence was destroyed" but "this clone
     *  cannot answer for this record". It is what every fresh, shallow or single-ref clone of a
     *  squash-merging repository looks like — including this repo's own CI checkout, where all
     *  35 recorded shas live only on `presquash/*` tags — and #142's own words are that a fresh
     *  clone must not be reported as a disaster.
     *
     *  Scoped to THE RECORD'S OWN SHAS rather than to "any historical sha" (#142's suggested
     *  probe). A `HEAD~20` probe passes in any full clone of one branch, so it would report all
     *  35 of this repository's shas as destroyed in CI, where they are merely absent.
     *
     *  TWO THINGS THIS DELIBERATELY DOES NOT DO, decided rather than assumed:
     *  - An authoring clone where `gc` has already taken EVERY recorded sha resolves none of
     *    them, so the probe silences arm 2 and the report is quiet at the worst moment. That is
     *    undecidable locally — nothing distinguishes it from a fresh clone — and the alternative
     *    is a false alarm on every CI run. The recoverable window is covered by arm 1, which is
     *    where a fix is still possible; this is the cost of not crying wolf.
     *  - The probe is ALL-OR-NOTHING, so it is a cliff: the first time exactly one recorded sha
     *    resolves in an otherwise history-less clone, arm 2 reports every other one. If this
     *    check ever fires en masse in CI, that is the cause — not a mass deletion.
     */
    run(state) {
      const records = recordedShas(state);
      if (!records.length) return [];
      // One pair of git calls per DISTINCT sha, not per record: the same commit is routinely
      // both attributed and named as a verdict's head.
      const seen = new Map();
      for (const { sha } of records) {
        if (seen.has(sha)) continue;
        const exists = objectExists(sha);
        seen.set(sha, { exists, reachable: exists && reachableFromAnyRef(sha) });
      }
      const resolvable = [...seen.values()].filter(s => s.exists).length;
      // epic -> arm -> [record]
      const grouped = new Map();
      for (const r of records) {
        const s = seen.get(r.sha);
        if (s.exists && s.reachable) continue;
        const arm = s.exists ? "orphaned" : "absent";
        if (arm === "absent" && resolvable === 0) continue;   // THE PROBE
        if (!grouped.has(r.epic)) grouped.set(r.epic, { orphaned: [], absent: [] });
        grouped.get(r.epic)[arm].push(r);
      }
      const cite = (list) => [...new Set(list.map(r => `${r.where} \`${r.sha.slice(0, 7)}\``))].join(", ");
      const out = [];
      for (const [epic, arms] of grouped) {
        if (arms.orphaned.length) {
          out.push({ epic, detail:
            `${arms.orphaned.length} recorded sha(s) are still in this repository's object store ` +
            "but reachable from NO ref — the shape a squash-merge leaves behind. RECOVERABLE " +
            "NOW and deleted by the next `git gc` (default `gc.pruneExpire`: two weeks), after " +
            "which the range this epic's gate verdict names can never be reviewed again. Tag " +
            `them while they exist: \`git tag presquash/<name> <sha>\`. ${cite(arms.orphaned)}` });
        }
        if (arms.absent.length) {
          out.push({ epic, detail:
            `${arms.absent.length} recorded sha(s) this repository cannot resolve at all — the ` +
            "object is gone from here, and this clone demonstrably holds the rest of this " +
            "record's history, so it was not merely never fetched. The evidence for what these " +
            "records claim is unrecoverable locally; a fork, another clone or the PR record is " +
            `the only place left to look. ${cite(arms.absent)}` });
        }
      }
      return out;
    },
  },
  {
    id: "advisory-claim-shape",
    title: "an advisory claim that cannot be true — expired, or held on an epic that has ended",
    // #84 — `owners` answers the question only when someone thinks to ask it, and a stale claim
    // is by construction left behind by a session that is no longer there to ask. This check is
    // the surface that finds one without being asked. It REPORTS, like everything here: a claim
    // is advisory, so nothing about a finding blocks a command, and the remediation is a `claim`
    // or `unclaim` a person runs.
    //
    // Two shapes, deliberately distinguished. An EXPIRED claim is ordinary — it is how a dead
    // session looks, and taking it over is a normal `claim` with no --steal. A claim on an
    // ARCHIVED epic is the dangling-reference shape: `update-epic --status archived` clears it,
    // so one that survives was written by a hand-edit or by a state file older than that rule,
    // and it renders as ownership of work that has ended.
    run(state) {
      const out = [];
      const now = Date.now();
      for (const e of state.epics || []) {
        if (!e.claim) continue;
        if (e.status === "archived") {
          out.push({ epic: e.id, detail:
            `archived, and still holding a claim by session '${e.claim.session}' since ` +
            `${e.claim.claimedAt}. Archiving clears the claim, so this record predates that rule ` +
            "or was hand-edited. Clear it: `unclaim " + e.id + " --session " + e.claim.session + " --steal`." });
          continue;
        }
        if (!isLiveClaim(e.claim, now)) {
          out.push({ epic: e.id, detail:
            `claim by session '${e.claim.session}' expired at ${claimExpiry(e.claim) || "an unreadable time"} ` +
            `(claimed ${e.claim.claimedAt}, ttl ${e.claim.ttlMinutes} min). A session that died ` +
            "mid-epic looks exactly like this. Take it over with `claim " + e.id +
            " --session <you>` — no --steal is needed once expired." });
        }
      }
      return out;
    },
  },
];

/** Run every check. Returns one entry PER CHECK, including the ones that found nothing. */
export function runIntegrity(state) {
  return CHECKS.map(c => ({ id: c.id, title: c.title, findings: c.run(state) || [] }));
}

/** The report, as text. One block per check, count first, then the findings. */
export function formatIntegrity(report) {
  const L = ["INTEGRITY — records that cannot be true.",
    "Findings are reported, never repaired: nothing here writes state or blocks a command.", ""];
  for (const { id, title, findings } of report) {
    L.push(`${id} — ${findings.length} finding(s): ${title}`);
    for (const f of findings) {
      L.push(`  • ${f.epic ? `\`${f.epic}\` — ` : ""}${f.detail}`);
    }
  }
  L.push("");
  L.push(`${report.reduce((n, c) => n + c.findings.length, 0)} finding(s) across ${report.length} check(s).`);
  return L.join("\n");
}

/** `integrity` — print the report. Exits 0 whatever it finds.
 *
 *  Deliberately does NOT call `render()`, which every other verb here does: render runs the
 *  archive-drift heal and SAVES, so an audit that rendered would write state on the way to
 *  telling you it writes none — and would do it against the live record of whatever repo is
 *  being audited. Read-only means the file is byte-identical afterwards. */
export function integrity() {
  if (!isInitialized()) { process.stderr.write("conductor: run /pm:init first\n"); process.exit(1); }
  process.stdout.write(formatIntegrity(runIntegrity(loadState())) + "\n");
}
