// scripts/lib/dependency-order.mjs
// EFFECTIVE PRIORITY over the `depends-on` closure, and the statements that go with it.
// Pure functions over an already-resolved epic list; no imports, no I/O.
//
// WHY THIS EXISTS (gh#101). `orderQueueWithDependencies()` reorders epics against each other and
// does exactly what its docstring says — but it is only ever handed the `queued`/`untriaged`
// set. So a `depends-on` edge whose target sits in ANY other status is silently inert: the
// dependent sorts by its own priority as if nothing were in its way, and the epic that would
// unblock it is nowhere in the ordering. That is not an edge case, it is the normal shape of a
// backlog — blockers live in the backlog, not in the queue — and `untriaged` being the default
// status for everything `sync` registers means the most common way an epic enters the record is
// also the way its edges become invisible. Measured twice in the wild: a P1 blocked by a
// `planned` P2 in one repo, and this repo's own `gh-95` → `gh-79` (P1 queued → P2 untriaged),
// both found by a human reading the link list by eye.
//
// THE COMPUTATION IS NEVER WRITTEN BACK, and that is the design, not an optimisation:
//   - nothing is hand-maintained, so it cannot drift;
//   - the MERIT priority stays legible — you can still tell the goal from the means, which a
//     manual re-rank destroys;
//   - it is self-correcting: deprioritise the dependent and its blocker's lift drops with it.
//
// MEMBERSHIP RULES ARE UNCHANGED. Effective priority reorders and ANNOTATES the record; it does
// not inject `planned`/`later` epics into NEXT UP. "Not scheduled" and "not nameable" are
// different claims, and the second is the bug — the issue's own "what would have been enough"
// is a statement, not membership.

/** Priority ordering. Declared here rather than promoted into constants.mjs: it is a leaf
 *  fact this module and epic-progress.mjs share, and constants.mjs is the file every module
 *  already reaches — growing it for two consumers buys nothing. */
export const PRIORITY_RANK = { P0: 0, P1: 1, P2: 2, P3: 3, "P?": 9 };
export const priorityRank = (p) => (p in PRIORITY_RANK ? PRIORITY_RANK[p] : 9);

/** The statuses NEXT UP is willing to offer as work. Kept in one place so the "is this
 *  dependency actually schedulable" question and briefing.mjs's membership filter cannot
 *  answer it differently — the two disagreeing IS the defect this module exists for. */
export const ACTIONABLE_STATUSES = ["queued", "untriaged"];
export const isActionable = (e) => ACTIONABLE_STATUSES.includes(e && e.status);

/** A dependency is SATISFIED only when it is archived. Every other status — including
 *  `active` and `paused` — is work that has not landed, so the dependent still waits. */
export const dependencySatisfied = (e) => !!e && e.status === "archived";

/** Every `depends-on` edge whose BOTH endpoints are present in `epics`, as `{from, to, reason}`.
 *
 *  A dangling target is skipped rather than reported: naming a reference to a record that does
 *  not exist is `integrity`'s job (`dangling-epic-reference`), and an ordering pass that threw
 *  or warned on it would duplicate that finding on every render.
 *
 *  An ARCHIVED `from` contributes no edge. A finished epic has nothing left to be blocked on,
 *  so keeping its edges would leave a delivered goal permanently lifting the priority of the
 *  means it once needed — a lift with nobody waiting behind it. */
export function dependsOnEdges(epics) {
  const byId = new Map(epics.map(e => [e.id, e]));
  const out = [];
  for (const from of epics) {
    if (from.status === "archived") continue;
    for (const l of from.links || []) {
      if (!l || l.type !== "depends-on" || typeof l.epic !== "string") continue;
      const to = byId.get(l.epic);
      if (!to) continue;
      out.push({ from, to, reason: l.reason });
    }
  }
  return out;
}

/** `Map<epicId, priority>` — each epic's EFFECTIVE priority: the best of its own merit priority
 *  and that of every epic which transitively depends on it.
 *
 *  Relaxation to a fixpoint over a five-value lattice (P0…P3, P?), so it terminates on a cyclic
 *  graph as well as an acyclic one: a priority only ever improves, and it can improve at most
 *  four times per node. A cycle among epics is a record defect `integrity` reports; a display
 *  helper must not hang or throw on one, which is the same ruling `orderQueueWithDependencies`
 *  already made for its own topological pass.
 *
 *  Satisfied (archived) dependencies receive nothing: lifting a finished epic's priority moves
 *  it around a record where it is no longer work. */
export function effectivePriorityOf(epics) {
  const eff = new Map(epics.map(e => [e.id, e.priority]));
  const outgoing = new Map();
  for (const { from, to } of dependsOnEdges(epics)) {
    if (dependencySatisfied(to)) continue;
    if (!outgoing.has(from.id)) outgoing.set(from.id, []);
    outgoing.get(from.id).push(to.id);
  }
  const queue = [...outgoing.keys()];
  // Bound as belt-and-braces only: the lattice already guarantees convergence. It exists so a
  // future edge source that is NOT monotone cannot turn this into an infinite loop inside a
  // SessionStart hook.
  let guard = (epics.length + 1) * (Object.keys(PRIORITY_RANK).length + 1);
  while (queue.length && guard-- > 0) {
    const id = queue.shift();
    const src = eff.get(id);
    for (const next of outgoing.get(id) || []) {
      if (priorityRank(src) < priorityRank(eff.get(next))) {
        eff.set(next, src);
        queue.push(next);
      }
    }
  }
  return eff;
}

/** The DEPENDENCY WARNINGS — one line per inversion, written so a human acts on it in seconds.
 *
 *  Three kinds, and each answers a question the record could not previously be asked:
 *
 *  1. A dependency that is NOT ACTIONABLE. This is gh#101's headline: the dependent shows as
 *     next-up while being unstartable, and the thing that would unblock it is in a status
 *     nothing surfaces. The line names both endpoints, both statuses, WHY it is a problem, and
 *     the effective priority the blocker now carries — which is what makes "pull it forward, or
 *     descope the dependent" a decision rather than a stall.
 *
 *  2. A dependency that IS actionable but lower-priority — the pre-existing starvation note,
 *     still emitted by `orderQueueWithDependencies()` in the wording tests hold it to. Not
 *     duplicated here: that pass knows the resulting ORDER, this one does not, and two emitters
 *     answering the same question is the drift this repository keeps finding.
 *
 *  3. A `blocked` epic with no live `depends-on` edge. `blocked` is otherwise a dead end — an
 *     epic can sit in it indefinitely with nothing recording what it waits on, which is exactly
 *     how the motivating dependency came to exist only as prose in a design doc. Deriving
 *     blocked-ness from `depends-on` rather than adding a `blockedBy` field is the issue's own
 *     stated preference (one mechanism, not two), and THIS WARNING is what makes deriving
 *     equivalent to storing: without it, "no edge" and "no blocker" look identical.
 *
 *  An ARCHIVED dependency produces nothing at all, in any of the three. */
export function dependencyNotes(epics) {
  const eff = effectivePriorityOf(epics);
  const notes = [];
  const hasLiveDependency = new Set();
  for (const { from, to } of dependsOnEdges(epics)) {
    if (dependencySatisfied(to)) continue;
    hasLiveDependency.add(from.id);
    if (isActionable(to)) continue;
    const lower = priorityRank(to.priority) > priorityRank(from.priority);
    const why = lower ? "lower-priority and not queued" : "not queued";
    const lifted = eff.get(to.id) !== to.priority
      ? ` — \`${to.id}\` now carries effective priority ${eff.get(to.id)}` : "";
    notes.push(`\`${from.id}\` (${from.priority}) depends on \`${to.id}\` ` +
      `(${to.priority}, ${to.status}) — the dependency is ${why}${lifted}`);
  }
  for (const e of epics) {
    if (e.status !== "blocked" || hasLiveDependency.has(e.id)) continue;
    notes.push(`\`${e.id}\` is \`blocked\` with no \`depends-on\` link — nothing records what it ` +
      `waits on (\`update-epic ${e.id} --link "depends-on:<id>:<why>"\`)`);
  }
  return notes;
}
