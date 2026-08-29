// scripts/lib/add-epic.mjs
// CLI flag parsing (shared by nearly every subcommand module), the add-epic verb, and
// plan-hierarchy. Circular with lib/render.mjs (addEpic calls render(); render() calls
// parseFlags()) -- see the design doc. parseFlags/parseLinkFlags/findCyclePath/
// parentError are general-purpose and imported by most other lib modules; they live
// here because that's where the "add-epic" comment section originally put them.

import { activate } from "./active-pointer.mjs";
import { isInitialized, loadState, pushEpic, saveState } from "./state.mjs";
import { render } from "./render.mjs";
import { KNOWN_LANES, KNOWN_STATUSES, epicFlagsFor, repeatableEpicFlags, valueBearingFlagsFor } from "./constants.mjs";
import { isKnownLinkType, unknownLinkTypeMessage, linkTypeVocabulary } from "./links.mjs";
import { creationStamp } from "./disposition.mjs";
import { rankOf } from "./epic-progress.mjs";

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

/** #149 — the ONE rule for "this flag needs a value", read from EPIC_FLAGS.
 *
 *  Returns the refusal message, or null when every value-bearing flag `command` accepts either
 *  is absent or carries a usable value. Pure, so the rule is testable without a subprocess;
 *  requireFlagValues() below is the exit-1 wrapper every write surface calls.
 *
 *  THE ASYMMETRY THIS ENDS. `update-epic --plan` with no value was refused and `add-epic --plan`
 *  with no value was silently dropped — exit 0, epic created, field absent — because each
 *  command carried its own hand-written list of flags to check. `record-gate-review` carried no
 *  list at all, so a valueless `--reviewer` exited 0 with the evidence field missing. Refusing
 *  on every surface is the only reading that does not REMOVE a working catch, and the mistake it
 *  catches is silent and unrecoverable: a shell that ate the value, a trailing flag with nothing
 *  after it.
 *
 *  THREE SHAPES, and the second is the one a per-flag guard always misses:
 *   • `true` — a valueless non-repeatable flag, as parseFlags yields it.
 *   • `[…, true]` — a valueless occurrence of a REPEATABLE flag. parseFlags pushes into an
 *     array, so a repeatable flag NEVER arrives as bare `true`; a guard written `f[flag] ===
 *     true` covers none of the eight repeatable rows, and one reading `vals[0]` misses
 *     `--attribute-commit <sha> --attribute-commit`, where the good occurrence is first.
 *   • `"   "` — present but blank. `str()` passes it through and the write lands as a
 *     whitespace-only path, title or sha, which is the same unrecoverable silence one step on.
 *     `--title ""` previously fell back to the id; it is now refused, which is the one live
 *     behaviour change here beyond the valueless case.
 */
export function valuelessFlagError(command, f) {
  for (const { flag, requires } of valueBearingFlagsFor(command)) {
    const raw = f[flag];
    if (raw === undefined) continue;
    const vals = Array.isArray(raw) ? raw : [raw];
    // An EMPTY array cannot occur (parseFlags only creates the array by pushing) but is treated
    // as "given with nothing usable" rather than skipped, so a future caller constructing flags
    // programmatically cannot slip past by handing over [].
    if (!vals.length || vals.some(v => typeof v !== "string" || !v.trim())) {
      return `conductor: --${flag} requires ${requires}`;
    }
  }
  return null;
}

/** The exit-1 wrapper. Called by every write surface IMMEDIATELY after its unknown-flag
 *  allowlist and BEFORE loadState(), so a refusal can never leave a partial write behind. */
export function requireFlagValues(command, f) {
  const err = valuelessFlagError(command, f);
  if (err) { process.stderr.write(err + "\n"); process.exit(1); }
}

/** Parse `--link "<type>:<epic>[:<reason>]"` strings into validated {type,epic,reason?}
 *  objects. Rejects malformed input (fewer than two segments, or an `epic` that isn't a
 *  real known epic id) by THROWING, instead of the prior behavior of silently storing a
 *  garbage link object — a typo like "type:related:epic:..." used to parse successfully
 *  (type="type", epic="related") because nothing checked that "related" was a real epic.
 *  Shared by add-epic and update-epic.
 *
 *  BOTH halves are checked now (gh#100). #70 shipped the epic half; the type half was the
 *  vocabulary it did not have, so `--link "depends_on:x"` stored an edge that every consumer
 *  ignores forever and that the next agent copies as precedent. This is the ONE write path —
 *  add-epic, update-epic and add-many all reach the store through here — which is why the check
 *  lives at the shared function rather than at each verb. The read paths deliberately stay
 *  permissive; see isRenderableLink() in links.mjs for why. */
export function parseLinkFlags(raw, knownEpicIds) {
  return (raw || []).filter(s => typeof s === "string").map(s => {
    const [type, epic, ...rest] = s.split(":");
    if (!type || !epic) {
      throw new Error(`bad --link '${s}': expected "<type>:<epic>[:<reason>]"`);
    }
    // ORDER IS DELIBERATE: the epic half first. A value that mis-split (#70's regression,
    // `type:related:epic:...`, which parses as type="type" epic="related") is best diagnosed by
    // the half that reveals the mis-split — "'related' is not a known epic id" points at the
    // structure, where "'type' is not a known link type" would send the reader off to fix a
    // vocabulary they never got wrong.
    if (!knownEpicIds.has(epic)) {
      throw new Error(`bad --link '${s}': '${epic}' is not a known epic id`);
    }
    if (!isKnownLinkType(type)) {
      throw new Error(unknownLinkTypeMessage(s, type));
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

/** One inline story: `{title, done}`. The ONE constructor, so `add-epic`, `update-epic` and
 *  `add-many` cannot come to write three subtly different row shapes — which is exactly how
 *  `add-many` ended up unable to carry stories at all while the other two could. */
export function newStory(title, done = false) {
  return { title: title.trim(), done: !!done };
}

/** Parse the repeatable `--add-story` flag into validated titles.
 *
 *  `--add-story` is declared `repeats: true`, so parseFlags always hands it an ARRAY — but a
 *  VALUELESS `--add-story` arrives inside that array as boolean `true`, which is the
 *  exit-0-write-nothing shape (#79) if it is quietly filtered away. Every non-string and every
 *  blank title is therefore REFUSED by throwing, and the caller turns that into its own
 *  refusal before any state is loaded or written.
 *
 *  Returns [] when the flag is absent, so a caller can test `.length` and leave `stories`
 *  entirely ABSENT from an epic that declared none — an empty array would read as "this epic
 *  has milestones and they are all missing", which is a different claim. */
export function parseStoryFlags(raw) {
  const list = raw === undefined ? [] : (Array.isArray(raw) ? raw : [raw]);
  return list.map(v => {
    if (typeof v !== "string" || !v.trim()) {
      throw new Error("--add-story requires a non-empty title");
    }
    return newStory(v);
  });
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
    // Manual rank applies HERE too, not only in resolveEpics()'s comparator. This is the same
    // question — how do two epics that tie on priority order? — and it fell through to
    // `id.localeCompare` in exactly the same way, so honouring rank at one site and not the
    // other would make a deliberate order hold in PROJECT.md and vanish in a hierarchy batch.
    // Found by sweeping every `rank` call site rather than by the diff, which never touched
    // this file.
    //
    // EFFECTIVE priority is deliberately NOT applied here: the batching above is already a
    // topological sort over sibling `depends-on` edges, so within a batch the members are
    // mutually independent by construction and there is no inversion left for inherited
    // priority to fix. Applying it would reorder epics against a constraint already satisfied.
    ready.sort((a, b) => ((rank[a.priority] ?? 9) - (rank[b.priority] ?? 9)) ||
      (rankOf(a) - rankOf(b)) || a.id.localeCompare(b.id));
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
  // #149 — every value-bearing flag this command accepts must carry a usable value. One rule
  // from the registry, applied here and at every other write surface, replacing the literal
  // `["description", "notes", "spec"]` this command used to check: `--plan` was absent from that
  // list and was silently dropped, while `update-epic` refused it. Before loadState().
  requireFlagValues("add-epic", f);
  const str = (v) => (typeof v === "string" ? v : undefined); // valueless flags arrive as boolean true
  // Stories are parsed BEFORE loadState(), with the id and lane checks, so a bad title refuses
  // the whole registration rather than creating a story-less epic somebody then has to notice.
  // This is complaint 2 of gh#95: a plan's milestones land in the SAME write as the epic, not
  // one `update-epic` call at a time afterwards.
  let stories;
  try { stories = parseStoryFlags(f["add-story"]); }
  catch (e) { process.stderr.write(`conductor: ${e.message}\n`); process.exit(1); }
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
  // `attributedCommits: []` is NOT written here. It is stamped by pushEpic() in state.mjs —
  // the one sink every creation path routes through — because writing it at each construction
  // site is precisely how `sync`'s two paths came to be missed.
  const epic = {
    id, title: str(f.title) || id, priority: str(f.priority) || "P?",
    status, role: "epic", lane, links, reconcileNeeded: false,
  };
  // Created directly AT `archived`: stamp rather than refuse. Refusing would be the simpler
  // rule, but the capability is in use — this repository's own suite creates archived epics to
  // exercise parent rollup, and the archive backfill registers historical changes directly at
  // `archived` by design. The stamp keeps the outcome invariant true without removing it.
  // No `gateReview.gate2` entry, for the backfill's reason: the stamp already records exactly
  // how the epic reached `archived`, while an `ungated` entry would add a permanent standing
  // condition clearable only by a real Gate 2 of work that finished before the epic existed.
  // Creation at any other status writes no disposition at all — nothing has ended.
  if (status === "archived") epic.disposition = creationStamp("add-epic");
  if (str(f.plan)) epic.planPath = f.plan;
  // #92's design document. Written HERE and not by the EPIC_FLAGS row, which is the whole
  // finding: the registry decides which flags this command ACCEPTS, and every field it stores
  // is copied by an explicit line. Registering `--spec` without this one would have it parse,
  // pass the allowlist and vanish — exit-0-write-nothing, and the family's parity test would
  // stay green because it checks registration, not the write.
  if (str(f.spec)) epic.specPath = str(f.spec);
  // The per-flag `["description", "notes", "spec"]` loop that used to live here is gone: #149
  // moved the rule into requireFlagValues() above, which reads it from EPIC_FLAGS and so covers
  // every flag this command accepts rather than the three somebody remembered. The `--plan`
  // asymmetry that loop deliberately preserved — refused on `update-epic`, dropped here — is
  // what #149 decided, and it is decided the strict way, on every surface.
  //
  // Absent, not empty: an epic that declared no milestones carries no `stories` key at all, so
  // epicProgress() falls through to its planPath/tasks.md precedence exactly as before.
  if (stories.length) epic.stories = stories;
  if (str(f.description) !== undefined) epic.description = str(f.description);
  if (str(f.notes) !== undefined) epic.notes = [noteEntry(str(f.notes))];
  if (parent !== undefined) epic.parent = parent;
  if (str(f["external-id"]) !== undefined) epic.externalId = str(f["external-id"]);
  if (str(f["external-url"]) !== undefined) epic.externalUrl = str(f["external-url"]);
  if (str(f["external-updated-at"]) !== undefined) epic.externalUpdatedAt = str(f["external-updated-at"]);
  pushEpic(state, epic);
  // keep .active in sync on creation. `freshlyRead` when this very command carried the item's
  // updated timestamp: the agent just read it, so an immediate re-read obligation would be noise.
  if (epic.status === "active") {
    activate(state, id, { freshlyRead: str(f["external-updated-at"]) !== undefined });
  }
  saveState(state);
  render();
  process.stderr.write(`conductor: added epic '${id}' (${lane}, ${status})\n`);
}
