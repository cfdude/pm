// scripts/lib/add-epic.mjs
// CLI flag parsing (shared by nearly every subcommand module), the add-epic verb, and
// plan-hierarchy. Circular with lib/render.mjs (addEpic calls render(); render() calls
// parseFlags()) -- see the design doc. parseFlags/parseLinkFlags/findCyclePath/
// parentError are general-purpose and imported by most other lib modules; they live
// here because that's where the "add-epic" comment section originally put them.

import { activate } from "./active-pointer.mjs";
import { isInitialized, loadState, saveState } from "./state.mjs";
import { render } from "./render.mjs";
import { KNOWN_LANES, KNOWN_STATUSES, epicFlagsFor, repeatableEpicFlags } from "./constants.mjs";

// Repeatable flags that belong to NO epic-writing command, and so cannot come from the shared
// EPIC_FLAGS registry: --intent is set-tracker's, --preauthorize/--context/--notify are
// set-autonomy's, --add/--remove are set-lane-routing's. parseFlags is shared by nearly every
// subcommand, so the epic registry's repeatable entries are UNIONED with this list and never
// substituted for it — replacing it would leave `set-tracker --intent a:b --intent c:d`
// silently keeping only the second pair, with an exit code of 0.
//
// `link` is deliberately absent: it IS an epic flag, and it now carries `repeats: true` in the
// registry, so it reaches parseFlags through the union like any flag a later capability adds.
const REPEATABLE_NON_EPIC_FLAGS = ["intent", "preauthorize", "context", "notify", "add", "remove"];

/** The full repeatable set — the non-epic list above UNIONed with every EPIC_FLAGS entry
 *  marked `repeats: true`. Recomputed on every parseFlags() call rather than frozen at module
 *  scope, so declaring `repeats: true` in the registry is the entire edit a capability makes;
 *  this file never changes for it. */
export const repeatableFlags = () =>
  [...new Set([...REPEATABLE_NON_EPIC_FLAGS, ...repeatableEpicFlags()])];

export function parseFlags(argv) {
  const o = {};
  const repeatable = new Set(repeatableFlags());
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const k = a.slice(2);
    const v = (argv[i + 1] !== undefined && !argv[i + 1].startsWith("--")) ? argv[++i] : true;
    if (repeatable.has(k)) (o[k] || (o[k] = [])).push(v);
    else o[k] = v;
  }
  return o;
}

/** Parse `--link "<type>:<epic>[:<reason>]"` strings into validated {type,epic,reason?}
 *  objects. Rejects malformed input (fewer than two segments, or an `epic` that isn't a
 *  real known epic id) by THROWING, instead of the prior behavior of silently storing a
 *  garbage link object — a typo like "type:related:epic:..." used to parse successfully
 *  (type="type", epic="related") because nothing checked that "related" was a real epic.
 *  Shared by add-epic and update-epic. */
export function parseLinkFlags(raw, knownEpicIds) {
  return (raw || []).filter(s => typeof s === "string").map(s => {
    const [type, epic, ...rest] = s.split(":");
    if (!type || !epic) {
      throw new Error(`bad --link '${s}': expected "<type>:<epic>[:<reason>]"`);
    }
    if (!knownEpicIds.has(epic)) {
      throw new Error(`bad --link '${s}': '${epic}' is not a known epic id`);
    }
    const reason = rest.join(":").trim();
    return reason ? { type, epic, reason } : { type, epic };
  });
}

/** One `notes` entry: `{at, actor, text}`. APPEND-ONLY — every writer pushes, nothing rewrites
 *  or drops an earlier entry, which is what keeps a note distinguishable from a `description`
 *  (durable rationale, replaced when set again).
 *
 *  `actor` is RECORDED and not interpreted: a queued session-attribution capability owns what it
 *  means. The engine has no way to know a human's identity, so every entry it writes today is
 *  attributed to the agent that ran the command. Shared by add-epic and update-epic so the entry
 *  shape has one definition. */
export function noteEntry(text, actor = "agent") {
  return { at: new Date().toISOString(), actor, text };
}

/** DFS cycle-path finder over a dependency map (id -> Set of ids it depends on), restricted
 *  to `stuckIds` (the set Kahn's algorithm couldn't place). Returns the actual cycle as an
 *  array of ids ending back at its start (e.g. ["a","b","a"]), for a debuggable error message
 *  instead of an unordered dump of every stuck id. */
export function findCyclePath(stuckIds, deps) {
  const stuckSet = new Set(stuckIds);
  const visited = new Set();
  const stack = [];
  const onStack = new Set();
  function dfs(id) {
    stack.push(id); onStack.add(id); visited.add(id);
    for (const dep of deps.get(id)) {
      if (!stuckSet.has(dep)) continue;
      if (onStack.has(dep)) return [...stack.slice(stack.indexOf(dep)), dep];
      if (!visited.has(dep)) {
        const found = dfs(dep);
        if (found) return found;
      }
    }
    stack.pop(); onStack.delete(id);
    return null;
  }
  for (const id of stuckIds) {
    if (!visited.has(id)) {
      const found = dfs(id);
      if (found) return found;
    }
  }
  return stuckIds; // defensive fallback — Kahn's algorithm guarantees a real cycle exists
}

/** `plan-hierarchy --parent <id>` — computes execution batches for a parent epic's children,
 *  recomputed fresh from existing data every call (no new persistent state): `depends-on`
 *  links BETWEEN SIBLINGS drive a topological sort into batches (Kahn's algorithm); within a
 *  batch, order by priority (P0 first, ties broken by id). Each child is annotated with
 *  whether it already has `autonomy.level === "autonomous"` — dispatching one that doesn't
 *  would immediately hit the epic-autonomy decision rule's "no context to act on" stop.
 *  A dependency cycle among children is rejected outright (exit 1), naming the cycle path,
 *  rather than producing a bogus order. Pure read + stdout — no state mutation. */
export function planHierarchy() {
  if (!isInitialized()) { process.stderr.write("conductor: run /pm:init first\n"); process.exit(1); }
  const f = parseFlags(process.argv.slice(3));
  const parent = typeof f.parent === "string" ? f.parent : undefined;
  if (!parent) { process.stderr.write("usage: conductor.mjs plan-hierarchy --parent <id>\n"); process.exit(1); }
  const state = loadState();
  if (!state.epics.some(e => e.id === parent)) {
    process.stderr.write(`conductor: epic '${parent}' not found\n`); process.exit(1);
  }
  // Archived children are done — exclude them from the plan entirely. This also means a
  // depends-on reference to an archived sibling falls outside `childIds` below and is
  // silently treated as "not a hierarchy dependency" (satisfied), exactly the existing
  // behavior for a link to any epic outside the hierarchy — a done dependency imposes no wait.
  const children = state.epics.filter(e => e.parent === parent && e.status !== "archived");
  const childIds = new Set(children.map(e => e.id));

  const deps = new Map(children.map(e => [e.id, new Set()]));
  for (const e of children) {
    for (const l of (e.links || [])) {
      if (l && l.type === "depends-on" && childIds.has(l.epic)) deps.get(e.id).add(l.epic);
    }
  }

  const rank = { P0: 0, P1: 1, P2: 2, P3: 3, "P?": 9 };
  const placed = new Set();
  const batches = [];
  while (placed.size < children.length) {
    const ready = children.filter(e =>
      !placed.has(e.id) && [...deps.get(e.id)].every(d => placed.has(d)));
    if (!ready.length) {
      const stuck = children.filter(e => !placed.has(e.id)).map(e => e.id);
      const cycle = findCyclePath(stuck, deps);
      process.stderr.write(
        `conductor: plan-hierarchy: dependency cycle among children of '${parent}': ${cycle.join(" -> ")}\n`);
      process.exit(1);
    }
    ready.sort((a, b) => ((rank[a.priority] ?? 9) - (rank[b.priority] ?? 9)) || a.id.localeCompare(b.id));
    batches.push(ready);
    for (const e of ready) placed.add(e.id);
  }

  const plan = {
    parent,
    batches: batches.map((epics, i) => ({
      batch: i,
      epics: epics.map(e => ({
        id: e.id, priority: e.priority,
        autonomous: !!(e.autonomy && e.autonomy.level === "autonomous"),
        dependsOn: [...deps.get(e.id)].sort(),
      })),
    })),
  };
  process.stdout.write(JSON.stringify(plan) + "\n");
}

/** Validate a proposed `parent` for epic `id` against the current `epics`.
 *  Returns an error string, or null if the parent is acceptable (or unset).
 *  `id` need not yet exist (add-epic); for re-parenting (update-epic) it will.
 *  Shared by add-epic, update-epic, and add-many so the tree stays acyclic. */
export function parentError(epics, id, parent) {
  if (parent === undefined || parent === null) return null;
  if (parent === id) return `epic '${id}' cannot be its own parent`;
  const byId = new Map(epics.map(e => [e.id, e]));
  if (!byId.has(parent)) return `parent '${parent}' is not a known epic`;
  // Walk ancestors of `parent`; reaching `id` means this edge would close a cycle.
  let cur = byId.get(parent), guard = 0;
  while (cur && cur.parent && guard++ < 10000) {
    if (cur.parent === id) return `setting parent '${parent}' on '${id}' would create a cycle`;
    cur = byId.get(cur.parent);
  }
  return null;
}

export function addEpic() {
  if (!isInitialized()) { process.stderr.write("conductor: run /pm:init first\n"); process.exit(1); }
  const f = parseFlags(process.argv.slice(3));
  // add-epic's FIRST allowlist. Until now it validated no flag surface at all: parseFlags read
  // the flags the body happened to name and dropped every other one without a word, so
  // `--notes "<text>"` parsed, exited 0 and wrote nothing (#79). That failure is invisible and
  // the text is unrecoverable — it destroyed the whole payload of a batch of epics registered
  // precisely so a later session would remember why they exist. Rejected BEFORE loadState(),
  // so a refusal cannot leave a partial write behind.
  const known = epicFlagsFor("add-epic");
  const unknown = Object.keys(f).filter(k => !known.includes(k));
  if (unknown.length) {
    process.stderr.write(`conductor: add-epic: unknown flag(s) --${unknown.join(", --")} ` +
      `(known: ${known.map(k => `--${k}`).join(", ")})\n`);
    process.exit(1);
  }
  const str = (v) => (typeof v === "string" ? v : undefined); // valueless flags arrive as boolean true
  const id = str(f.id);
  if (!id || !/^[a-z0-9][a-z0-9._-]*$/.test(id)) {
    process.stderr.write("conductor: --id required, format ^[a-z0-9][a-z0-9._-]*$\n"); process.exit(1);
  }
  const lane = str(f.lane);
  if (!lane || !KNOWN_LANES.includes(lane)) {
    process.stderr.write(`conductor: --lane must be one of ${KNOWN_LANES.join("|")}\n`); process.exit(1);
  }
  const status = str(f.status) || "queued";
  if (!KNOWN_STATUSES.includes(status)) {
    process.stderr.write(`conductor: --status must be one of ${KNOWN_STATUSES.join("|")}\n`); process.exit(1);
  }
  const state = loadState();
  if (state.epics.some(e => e.id === id)) {
    process.stderr.write(`conductor: epic '${id}' already exists\n`); process.exit(1);
  }
  const externalId = str(f["external-id"]);
  const externalUrl = str(f["external-url"]);
  if (externalId !== undefined) {
    // Dedup by externalUrl when BOTH sides have one — a bare externalId is only unique WITHIN
    // one tracker/repo (e.g. GitHub issue numbers restart at #1 per repo), so two epics sourced
    // from different secondary trackers can legitimately share the same externalId. Bare
    // externalId is compared only when NEITHER side has a URL. When exactly one side has a URL
    // and the other doesn't, they are never treated as a duplicate — falling back to an
    // externalId-only comparison in that case would let a URL-less legacy epic falsely block a
    // genuinely distinct, URL-bearing one sharing the same bare id (Gate 2 finding).
    const dup = state.epics.find(e => {
      if (externalUrl !== undefined && e.externalUrl !== undefined) return e.externalUrl === externalUrl;
      if (externalUrl === undefined && e.externalUrl === undefined) return e.externalId === externalId;
      return false;
    });
    if (dup) {
      process.stderr.write(`conductor: epic with external-id '${externalId}' already exists ('${dup.id}') — skipped\n`);
      process.exit(1);
    }
  }
  let links;
  try {
    links = parseLinkFlags(f.link, new Set(state.epics.map(e => e.id)));
  } catch (e) {
    process.stderr.write(`conductor: ${e.message}\n`); process.exit(1);
  }
  const parent = str(f.parent);
  if (parent !== undefined) {
    const perr = parentError(state.epics, id, parent);
    if (perr) { process.stderr.write(`conductor: ${perr}\n`); process.exit(1); }
  }
  const epic = {
    id, title: str(f.title) || id, priority: str(f.priority) || "P?",
    status, role: "epic", lane, links, reconcileNeeded: false,
  };
  if (str(f.plan)) epic.planPath = f.plan;
  // A valueless `--description` / `--notes` arrives as boolean true and would otherwise be
  // dropped by str() — exit-0-write-nothing, the exact shape of #79 the allowlist above was
  // added to end. Refuse it instead.
  for (const flag of ["description", "notes"]) {
    if (f[flag] === true) {
      process.stderr.write(`conductor: --${flag} requires a value\n`); process.exit(1);
    }
  }
  if (str(f.description) !== undefined) epic.description = str(f.description);
  if (str(f.notes) !== undefined) epic.notes = [noteEntry(str(f.notes))];
  if (parent !== undefined) epic.parent = parent;
  if (str(f["external-id"]) !== undefined) epic.externalId = str(f["external-id"]);
  if (str(f["external-url"]) !== undefined) epic.externalUrl = str(f["external-url"]);
  if (str(f["external-updated-at"]) !== undefined) epic.externalUpdatedAt = str(f["external-updated-at"]);
  state.epics.push(epic);
  if (epic.status === "active") activate(state, id);   // keep .active in sync on creation
  saveState(state);
  render();
  process.stderr.write(`conductor: added epic '${id}' (${lane}, ${status})\n`);
}
