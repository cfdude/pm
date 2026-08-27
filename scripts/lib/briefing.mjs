// scripts/lib/briefing.mjs
// Builds the SessionStart/PreCompact briefing text. Needs lib/active-pointer.mjs's
// staleMarker() (one-directional — active-pointer doesn't need anything back from here).

import { resolveEpics, missing, orderQueueWithDependencies, bar, CLAIMED_COMPLETION_NOTE } from "./epic-progress.mjs";
import { changelogAddedHeadlines, cmpVer, newestInstalledVersion, pluginVersion } from "./plugin-meta.mjs";
import { getAutonomy } from "./autonomy.mjs";
import { staleMarker } from "./active-pointer.mjs";
import { validLink } from "./links.mjs";
import { outcomeOf, recordedDispositions } from "./disposition.mjs";
import { stalenessMarking } from "./archive-gate.mjs";
import { ungatedArchives } from "./integrity.mjs";
import { KNOWN_LANES, anyInwardProcedureEmittable, gateSummary, outwardApplies, releaseLine, releaseSummaries } from "./constants.mjs";
import { conflictCount, conflictWarningLatched, consumeConflictWarning } from "./write-conflicts.mjs";
import { CONFLICT_WARN_THRESHOLD } from "./constants.mjs";
import { openspecCurrencyLines } from "./tool-currency.mjs";

export function buildBrief(state, { consume = false } = {}) {
  const epics = resolveEpics(state);
  const byId = Object.fromEntries(epics.map(e => [e.id, e]));
  const L = [];

  const stamped = state.pmVersion || "0.0.0";
  const newest = newestInstalledVersion();
  if (newest !== null) {
    if (cmpVer(stamped, newest) < 0) {
      L.push(`⚠ pm ${stamped} → ${newest} available — run \`/reload-plugins\` (if you just updated the plugin), then \`/pm:upgrade\`.`);
      for (const h of changelogAddedHeadlines(stamped, newest)) L.push(`   - ${h}`);
      L.push("");
    }
  } else {
    const running = pluginVersion();
    if (running && cmpVer(stamped, running) < 0) {
      L.push(`⚠ pm ${stamped} → ${running} since this repo was set up — run \`/pm:upgrade\` (CLAUDE.md rules and epic schema may need refreshing).`);
      for (const h of changelogAddedHeadlines(stamped, running)) L.push(`   - ${h}`);
      L.push("");
    }
  }

  // gh#128 — the SAME question the block above asks, for a tool that cannot answer it itself.
  // pm is a plugin and auto-updates; OpenSpec is a CLI the user upgrades by hand, and
  // `openspec update` is a further manual per-project step nothing anywhere asks about. Sits
  // here, immediately after pm's own version nudge, because it is the same class of finding and
  // because a reader who scrolls past the top of a brief never sees a currency warning at all.
  // Emits nothing (and spawns nothing) unless this repo has an `openspec/` directory AND a
  // readable generated stamp — see tool-currency.mjs's guard-ordering note.
  const openspecLines = openspecCurrencyLines();
  if (openspecLines.length) {
    for (const l of openspecLines) L.push(l);
    L.push("");
  }

  L.push("CONDUCTOR STATE — where we are and what's next");
  L.push(CLAIMED_COMPLETION_NOTE);
  L.push("");

  const activeEpic = state.active ? byId[state.active] : null;
  const active = activeEpic && activeEpic.status !== "archived" ? activeEpic : null;
  if (active) {
    const autonomous = getAutonomy(active).level === "autonomous" ? ", 🤖 autonomous" : "";
    L.push(`NOW: \`${active.id}\` (${active.lane}, ${active.role}, ${active.priority}${autonomous}) — ${bar(active.progress)}${staleMarker(active)}`);
    if (active.reconcileNeeded)
      L.push(`  ⚠ RECONCILE PENDING: re-validate this proposal before continuing (a detour touched shared code).`);
    // The refresh debt is re-taught every briefing rather than remembered by the session that
    // incurred it — a compaction is exactly when it would otherwise be lost, and it was incurred
    // at activation, which may have been many turns ago.
    if (active.trackerRefreshNeeded)
      L.push(`  ⚠ TRACKER REFRESH OWED: re-read \`${active.externalUrl || active.externalId}\` ` +
        "(body, comments, labels, state) before drawing specs or a plan, then " +
        "`record-tracker-refresh " + active.id + " --verdict unchanged|material-change --external-updated-at <iso>`.");
  } else if (activeEpic && activeEpic.status === "archived") {
    L.push(`NOW: (no active epic — \`${activeEpic.id}\` was archived; the active pointer clears on next /pm:sync or commit)`);
  } else {
    L.push("NOW: (no active epic set)");
  }
  L.push("");

  // At-or-above the threshold, and once per EPISODE of contention — not exactly-equal, and not
  // >= on its own. Exact equality shipped in 0.26.0 and was wrong for a reason it could not see:
  // conflictCount() is SAMPLED, not observed — it is only read when a briefing is composed — so
  // the warning required the count to be exactly 3 AT THAT MOMENT. A wedged writer or a hook
  // loop produces a BURST, so 3 skips warned and 7 did not: the warning was least likely to fire
  // in exactly the scenario it exists for, and its absence then read as evidence of health.
  // Bare >= is the other failure: it re-warns every briefing until a successful write, which is
  // the repeating-error storm that trains a reader to filter the message, at which point a real
  // signal has been made invisible. So: warn while unlatched, then latch (a marker file beside
  // the log — see write-conflicts.mjs), and let the next successful state write clear both.
  //
  // consume defaults to false because buildBrief() is ALSO called by render() to embed the
  // "Briefing" section into PROJECT.md — composing that document is not a session ever seeing
  // the warning. Consuming there meant the third skip's warning was rotated away by the very
  // render() call that produced it, so it landed once in a PROJECT.md the next render overwrites
  // and never reached a live SessionStart brief. Only brief()/snapshot() — the entry points that
  // actually deliver a briefing to a session — pass consume: true.
  const skipped = conflictCount();
  if (skipped >= CONFLICT_WARN_THRESHOLD && !conflictWarningLatched()) {
    // Name the count actually found, never the threshold: under >= they are the same number only
    // in the mildest case, and reporting "3" after a burst of 7 understates the very thing the
    // reader is being told to go look at.
    L.push(`⚠ ${skipped} state writes skipped on conflict — a writer may be wedged (.conductor/write-conflicts.log)`);
    if (consume) consumeConflictWarning();
  }

  if (state.detourStack.length) {
    L.push(`DETOUR STACK — ${state.detourStack.length} paused (LIFO, resume top first):`);
    for (let i = state.detourStack.length - 1; i >= 0; i--) {
      const f = state.detourStack[i];
      L.push(`  ⤷ paused \`${f.pausedEpic}\` — ${f.reason}`);
      if (f.spawnedDetour) L.push(`      detour in flight: \`${f.spawnedDetour}\``);
      if (f.reconcileOnResume)
        L.push(`      ⚠ ON RESUME: re-validate \`${f.pausedEpic}\` against \`${f.spawnedDetour}\`'s changes BEFORE coding.`);
    }
    L.push("");
  }

  const NEXT_CAP = 5;
  const queuedByPriority = epics.filter(e => ["queued", "untriaged"].includes(e.status) && !missing(e));
  const { ordered: queued, notes: starvationNotes } = orderQueueWithDependencies(queuedByPriority);
  if (queued.length) {
    L.push("NEXT UP (by priority, then lane):");
    for (const e of queued.slice(0, NEXT_CAP)) {
      const pa = e.parent ? `, parent: \`${e.parent}\`` : "";
      L.push(`  • \`${e.id}\` (${e.priority}, ${e.lane}, ${e.status}${pa}) — ${bar(e.progress)}${staleMarker(e)}`);
    }
    if (queued.length > NEXT_CAP) L.push(`  (+${queued.length - NEXT_CAP} more — see PROJECT.md)`);
    for (const note of starvationNotes) L.push(`  ⚠ ${note}`);
    const counts = {};
    for (const e of epics) if (!missing(e) && e.status !== "planned") counts[e.lane] = (counts[e.lane] || 0) + 1;
    const ordered = KNOWN_LANES.filter(l => counts[l]).map(l => `${l} ${counts[l]}`);
    const unknown = Object.keys(counts).filter(l => !KNOWN_LANES.includes(l)).sort().map(l => `${l} ${counts[l]}`);
    L.push(`  lanes: ${[...ordered, ...unknown].join(" · ")}`);
    L.push("");
  }

  const plannedCount = epics.filter(e => e.status === "planned").length;
  if (plannedCount) {
    L.push(`planned: ${plannedCount} — see PROJECT.md`);
    L.push("");
  }

  // Releases — the same releaseSummaries() PROJECT.md renders, so a release cannot read as 12
  // epics on one surface and 11 on the other. One line each: the counts and what the release is
  // FOR. Each exclusion's reason is enumerated in PROJECT.md and readable in state.json; a brief
  // that recites every reason is a brief a reader learns to skip.
  const releases = releaseSummaries(state, epics);
  if (releases.length) {
    L.push("RELEASES:");
    for (const r of releases) {
      L.push(`  • ${releaseLine(r)}${r.intent ? ` — ${r.intent}` : ""}${r.target ? ` (target: ${r.target})` : ""}`);
    }
    L.push("");
  }

  // Same rule as PROJECT.md's Dispositions table: only records carrying a judgment, so the
  // migration's `unknown` stamps never crowd the brief. Capped like NEXT UP — the full list
  // is in PROJECT.md, which is the surface for enumeration.
  const dispositions = recordedDispositions(epics);
  if (dispositions.length) {
    L.push("DISPOSITIONS (recorded outcomes):");
    for (const { epic, disposition: d } of dispositions.slice(0, NEXT_CAP)) {
      const when = d.recordedAt ? ` (${d.recordedAt.slice(0, 10)})` : "";
      const why = d.reason ? ` — ${d.reason}` : "";
      const carried = d.carriedTo ? ` — carried to \`${d.carriedTo}\`` : "";
      L.push(`  • \`${epic.id}\` — ${outcomeOf(epic)}${when}${why}${carried}`);
    }
    if (dispositions.length > NEXT_CAP) {
      L.push(`  (+${dispositions.length - NEXT_CAP} more — see PROJECT.md)`);
    }
    L.push("");
  }

  // Same source and the same wording as PROJECT.md's Gate reviews table (gateSummary), so a
  // verdict cannot read as evidenced on one surface and unevidenced on the other.
  const gated = epics.filter(e => e.gateReview && (e.gateReview.gate1 || e.gateReview.gate2));
  if (gated.length) {
    L.push("GATE REVIEWS:");
    for (const e of gated.slice(0, NEXT_CAP)) {
      L.push(`  • \`${e.id}\` gate 1: ${gateSummary(e.gateReview.gate1, stalenessMarking(e, e.gateReview.gate1))} · ` +
        `gate 2: ${gateSummary(e.gateReview.gate2, stalenessMarking(e, e.gateReview.gate2))}`);
    }
    if (gated.length > NEXT_CAP) L.push(`  (+${gated.length - NEXT_CAP} more — see PROJECT.md)`);
    L.push("");
  }

  // The UNGATED-ARCHIVE notice — recomputed from state.json at every composition and NEVER
  // consumed on delivery. An `ungated` verdict is a standing record condition, not an episode:
  // it persists until a real Gate 2 supersedes it, so a notice that consumed would report it to
  // one session and hide it from every session after. That is the deliberate opposite of the
  // contention warning above, which describes a run of events that has already ended.
  //
  // No epic the archive backfill or the two creation paths register can ever appear here: they
  // are forbidden from writing a `gate2` entry at all, which is what keeps an unclearable
  // condition from being asserted en masse against changes archived before the conductor existed.
  const ungated = ungatedArchives(epics);
  if (ungated.length) {
    L.push("UNGATED ARCHIVES (archived with no Gate 2 review — clears when a real verdict supersedes it):");
    for (const e of ungated.slice(0, NEXT_CAP)) {
      L.push(`  ⚠ \`${e.id}\` — \`record-gate-review ${e.id} --gate 2 --verdict pass --base-sha <sha> --head-sha <sha>\``);
    }
    if (ungated.length > NEXT_CAP) L.push(`  (+${ungated.length - NEXT_CAP} more — see PROJECT.md)`);
    L.push("");
  }

  // Both ends of every handoff, so the epic that INHERITED work is as legible as the one that
  // carried it out — a relationship visible from one side only is how a remainder disappears.
  const handoffs = epics.filter(e => e.disposition && e.disposition.carriedTo);
  if (handoffs.length) {
    L.push("HANDOFFS (work carried out of an archived epic):");
    for (const e of handoffs) {
      L.push(`  • \`${e.id}\` carried work to \`${e.disposition.carriedTo}\`` +
        `${e.disposition.reason ? ` — ${e.disposition.reason}` : ""}`);
      L.push(`      \`${e.disposition.carriedTo}\` inherited it from \`${e.id}\``);
    }
    L.push("");
  }

  const links = epics.flatMap(e => (e.links || []).filter(validLink).map(l => ({ from: e.id, ...l })));
  if (links.length) {
    L.push("EPIC LINKS:");
    for (const l of links) L.push(`  • \`${l.from}\` ${l.type} \`${l.epic}\`${l.reason ? ` — ${l.reason}` : ""}`);
    L.push("");
  }

  // TRACKER SYNC — governed by DIRECTION, not by a tracker merely existing. Gating the drift
  // line on `state.tracker` alone is the half of #109 that lived here: a github-issues repo
  // whose rules block carries no outward instructions was told, every session, to create issues
  // for 29 epics. `outwardApplies` is the same resolved value rules.mjs reads, so the two
  // emitters cannot disagree again. Status-transition sync is still the agent's job (rules
  // block) and is NOT fabricated here.
  const tracker = state.tracker && state.tracker.system ? state.tracker : null;
  const secondaryTrackers = Array.isArray(state.secondaryTrackers) ? state.secondaryTrackers : [];
  const inwardHere = anyInwardProcedureEmittable(tracker, secondaryTrackers);
  const trackerLines = [];
  if (tracker && outwardApplies(tracker)) {
    const unmirrored = epics.filter(e =>
      ["queued", "active", "paused"].includes(e.status) && !missing(e) && !e.externalId);
    trackerLines.push(unmirrored.length
      ? `  ⚠ not yet in ${tracker.system} — create issues + record keys (update-epic): ` +
        unmirrored.map(e => `\`${e.id}\``).join(", ")
      : `  ✓ all active epics are mirrored to ${tracker.system}`);
  }
  // Freshness — locally computable and nothing more. How many linked items have NEWER remote
  // activity is a network call the engine is forbidden to make, so the honest population is the
  // one whose content has never been read since it was mirrored.
  const neverReRead = epics.filter(e => e.externalId && !e.externalUpdatedAt && !missing(e));
  if (inwardHere && neverReRead.length) {
    trackerLines.push(`  ⚠ ${neverReRead.length} tracker-linked epic(s) never re-read since mirroring — run \`/pm:sync\``);
  }
  // The block renders whenever it HAS something to say, not only when a PRIMARY tracker exists.
  // Gating the whole block on `tracker` split two emitters that read the same predicate: the
  // sync nudge below fires for a secondary-only inward repo, while the freshness line above was
  // computed, pushed, and then silently dropped for exactly that repo. Same question, opposite
  // answers, at two emitters — #109's shape, at the sibling of the site #109 was found at.
  //
  // The primary-tracker heading is unchanged byte-for-byte; only the no-primary case is new.
  if (trackerLines.length) {
    const label = tracker
      ? `${tracker.system}${tracker.projectKey ? ` · ${tracker.projectKey}` : ""}`
      : secondaryTrackers.map(st => `${st.system}${st.repo || st.projectKey ? ` · ${st.repo || st.projectKey}` : ""}`).join(", ");
    L.push(`TRACKER SYNC (${label}):`);
    for (const line of trackerLines) L.push(line);
    L.push("");
  }

  // Non-blocking sync nudge — only where an inward procedure is actually emittable. An
  // outward-only tracker cannot produce new inward items, and a scope-less inward tracker names
  // nothing to list; in both cases the rules block gives no inward procedure to run, so the
  // nudge would instruct an action the repo has no instructions for. Deliberately no "time
  // since last sync": session restarts here are infrequent enough that a bare nudge is enough.
  const trackerCount = (tracker ? 1 : 0) + secondaryTrackers.length;
  if (inwardHere && trackerCount > 0) {
    const systems = [...(tracker ? [tracker.system] : []), ...secondaryTrackers.map(st => st.system)];
    const label = trackerCount === 1 ? "tracker" : "trackers";
    L.push(`💡 ${trackerCount} ${label} configured (${systems.join(", ")}) — consider \`/pm:sync\` this ` +
      "session to pull in any new issues.");
    L.push("");
  }

  // The lifecycle-marker obligation — instruction, always, and deliberately in the BRIEF as well
  // as the rules block. The engine infers lifecycle exclusion from nothing: the marker is
  // agent-declared, so an agent who never reads it leaves every self-referential archive task
  // counting as outstanding work forever. Re-taught every briefing for the same reason the
  // refresh debt is: a compaction is exactly when an obligation learned once is lost.
  L.push("LIFECYCLE TASKS (pm): a task that is bookkeeping about the change's own lifecycle — above " +
    "all the one that archives the change itself, which always qualifies — carries the literal " +
    "`<!-- pm:lifecycle -->` on its task line. Mark it when the source is authored OR AMENDED; a " +
    "source predating this capability gets the marker the first time you touch it.");
  L.push("");

  // Re-injected RULES reminder — survives compaction because SessionStart re-fires (source=compact).
  L.push("RULES (pm): classify detours before fixing — minimal → fix+commit then `/pm:detour --minimal`; " +
    "substantial → `/pm:detour` (own proposal + PUSH). After any state change, `/pm:status`. " +
    "Resume via `/pm:resume` + reconcile gate. Mirror every PUSH/POP to a one-line Honcho memory.");
  L.push("");
  L.push("Manage with /pm:status · /pm:next · /pm:detour · /pm:resume, or the `conductor` skill.");
  return L.join("\n");
}
