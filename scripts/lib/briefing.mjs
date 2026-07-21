// scripts/lib/briefing.mjs
// Builds the SessionStart/PreCompact briefing text. Needs lib/active-pointer.mjs's
// staleMarker() (one-directional — active-pointer doesn't need anything back from here).

import { resolveEpics, missing, orderQueueWithDependencies, bar } from "./epic-progress.mjs";
import { changelogAddedHeadlines, cmpVer, newestInstalledVersion, pluginVersion } from "./plugin-meta.mjs";
import { getAutonomy } from "./autonomy.mjs";
import { staleMarker } from "./active-pointer.mjs";
import { validLink } from "./links.mjs";
import { KNOWN_LANES } from "./constants.mjs";

export function buildBrief(state) {
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

  L.push("CONDUCTOR STATE — where we are and what's next");
  L.push("");

  const activeEpic = state.active ? byId[state.active] : null;
  const active = activeEpic && activeEpic.status !== "archived" ? activeEpic : null;
  if (active) {
    const autonomous = getAutonomy(active).level === "autonomous" ? ", 🤖 autonomous" : "";
    L.push(`NOW: \`${active.id}\` (${active.lane}, ${active.role}, ${active.priority}${autonomous}) — ${bar(active.progress)}${staleMarker(active)}`);
    if (active.reconcileNeeded)
      L.push(`  ⚠ RECONCILE PENDING: re-validate this proposal before continuing (a detour touched shared code).`);
  } else if (activeEpic && activeEpic.status === "archived") {
    L.push(`NOW: (no active epic — \`${activeEpic.id}\` was archived; the active pointer clears on next /pm:sync or commit)`);
  } else {
    L.push("NOW: (no active epic set)");
  }
  L.push("");

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

  const links = epics.flatMap(e => (e.links || []).filter(validLink).map(l => ({ from: e.id, ...l })));
  if (links.length) {
    L.push("EPIC LINKS:");
    for (const l of links) L.push(`  • \`${l.from}\` ${l.type} \`${l.epic}\`${l.reason ? ` — ${l.reason}` : ""}`);
    L.push("");
  }

  // TRACKER SYNC — only when a tracker is configured, and only honestly-computable drift:
  // active-work epics (queued/active/paused, excluding missing() ghosts) with no externalId.
  // Status-transition sync is the agent's job (rules block), NOT fabricated here.
  if (state.tracker && state.tracker.system) {
    const tr = state.tracker;
    const scope = tr.projectKey ? ` · ${tr.projectKey}` : "";
    const unmirrored = epics.filter(e =>
      ["queued", "active", "paused"].includes(e.status) && !missing(e) && !e.externalId);
    L.push(`TRACKER SYNC (${tr.system}${scope}):`);
    if (unmirrored.length) {
      L.push(`  ⚠ not yet in ${tr.system} — create issues + record keys (update-epic): ` +
        unmirrored.map(e => `\`${e.id}\``).join(", "));
    } else {
      L.push(`  ✓ all active epics are mirrored to ${tr.system}`);
    }
    L.push("");
  }

  // Non-blocking sync nudge — any tracker (primary or secondary) configured means new issues
  // could have appeared externally with no in-session event to surface them. Deliberately no
  // "time since last sync": session restarts here are infrequent enough (after real chunks of
  // work) that a bare nudge is enough — the agent decides whether it's worth the round trip.
  const secondaryTrackers = Array.isArray(state.secondaryTrackers) ? state.secondaryTrackers : [];
  const trackerCount = (state.tracker && state.tracker.system ? 1 : 0) + secondaryTrackers.length;
  if (trackerCount > 0) {
    const systems = [
      ...(state.tracker && state.tracker.system ? [state.tracker.system] : []),
      ...secondaryTrackers.map(st => st.system),
    ];
    const label = trackerCount === 1 ? "tracker" : "trackers";
    L.push(`💡 ${trackerCount} ${label} configured (${systems.join(", ")}) — consider \`/pm:sync\` this ` +
      "session to pull in any new issues.");
    L.push("");
  }

  // Re-injected RULES reminder — survives compaction because SessionStart re-fires (source=compact).
  L.push("RULES (pm): classify detours before fixing — minimal → fix+commit then `/pm:detour --minimal`; " +
    "substantial → `/pm:detour` (own proposal + PUSH). After any state change, `/pm:status`. " +
    "Resume via `/pm:resume` + reconcile gate. Mirror every PUSH/POP to a one-line Honcho memory.");
  L.push("");
  L.push("Manage with /pm:status · /pm:next · /pm:detour · /pm:resume, or the `conductor` skill.");
  return L.join("\n");
}
