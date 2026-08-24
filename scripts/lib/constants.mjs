// scripts/lib/constants.mjs
// Shared path/enum constants for the conductor engine. No dependencies on any other
// lib module — every other module may import from here.

import path from "node:path";

export const ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
export const CONDUCTOR_DIR = path.join(ROOT, ".conductor");
export const STATE_PATH = path.join(CONDUCTOR_DIR, "state.json");
export const BRIEF_PATH = path.join(CONDUCTOR_DIR, "brief.txt");
export const RENDER_STAMP_PATH = path.join(CONDUCTOR_DIR, "render-stamp.json");
export const DETOURS_LOG = path.join(CONDUCTOR_DIR, "detours.log");
export const WRITE_CONFLICTS_LOG = path.join(CONDUCTOR_DIR, "write-conflicts.log");
// Distinct from the 1 that every validation failure already uses (14 sites in update-epic.mjs
// alone), so an agent can tell "someone else wrote" from "you passed a bad flag" and retry
// rather than guess.
export const CONFLICT_EXIT_CODE = 9;
// Size-triggered rotation, never count-based: enforcing "keep the last N entries" means
// reading, filtering and rewriting the file, and this is the failure path of a WRITE guard.
// statSync is O(1) and rename(2) is O(1), so the mechanism never reads the log body.
export const CONFLICT_LOG_MAX_BYTES = 8192;
export const CONFLICT_WARN_THRESHOLD = 3;
export const PROJECT_MD = path.join(ROOT, "PROJECT.md");
export const CLAUDE_MD = path.join(ROOT, "CLAUDE.md");
export const CHANGES_DIR = path.join(ROOT, "openspec", "changes");
export const ARCHIVE_DIR = path.join(CHANGES_DIR, "archive");
export const PLANS_DIR = path.join(ROOT, "docs", "superpowers", "plans");
export const KNOWN_LANES = ["openspec", "superpowers", "claude-code", "decision", "external"];

/** THE predicate every site deciding openspec-lane membership goes through.
 *
 *  An absent `lane` IS openspec — `resolveEpics()` has normalized it that way since 0.3.0, so a
 *  lane-less epic renders as openspec-lane on every surface. Three sites nevertheless compared
 *  strictly (`epic.lane === "openspec"`): the archive guard, `missing()`, and
 *  `record-gate-review`'s lane refusal. The result was an epic that LOOKS openspec-lane
 *  everywhere and slips every gate that binds the lane — including, at
 *  `record-gate-review`, being refused the very verdict the archive gate would have demanded of
 *  it, had that gate bound it.
 *
 *  Exported rather than retyped at each site so a site added later inherits the rule: the
 *  archive-drift heal's bypass half is the fourth such site, and the suite's source scan fails a
 *  fifth one written strict. */
export const isOpenspecLane = (epic) => ((epic && epic.lane) || "openspec") === "openspec";
export const KNOWN_PLATFORMS = ["claude-code", "hermes", "codex"];

// Each platform's project-instruction file, in the order that platform resolves them.
// First EXISTING file wins (that is the one the platform will actually read); if none
// exist, the LAST entry is created -- it is the most broadly-compatible choice, e.g. a
// fresh Hermes repo gets CLAUDE.md (which Hermes reads as its third fallback and Claude
// Code reads natively) rather than a Hermes-exclusive HERMES.md.
export const PLATFORM_RULES_CHAIN = {
  "claude-code": ["CLAUDE.md"],
  hermes: ["HERMES.md", "AGENTS.md", "CLAUDE.md"],
  codex: ["AGENTS.md"],
};

// Slash-command form per platform. Hermes preserves ':' in plugin command names and
// looks them up by whole key, so the namespace survives -- and the namespace matters:
// Hermes SILENTLY skips a plugin command colliding with a built-in, and it ships a
// built-in `status`. Codex derives command names from prompt-file stems, so it is flat.
export const PLATFORM_COMMAND_PREFIX = {
  "claude-code": "/pm:",
  hermes: "/pm:",
  codex: "/pm-",
};
export const KNOWN_STATUSES = ["untriaged", "queued", "active", "paused", "later", "blocked", "planned", "archived"];

// ─────────────────────── the shared epic-flag registry ───────────────────────
//
// The ONE declaration of the flag surface the epic-writing commands share. It lives here
// because constants.mjs is the leaf every one of them already reaches, and because four
// separate capabilities in this release add flags to those commands: grown four times, in
// each command's own literal, whichever landed first would reject the others' flags BY NAME
// (an unlisted flag exits 1). Grown once, they compose.
//
// Per entry:
//   flag      the CLI flag, WITHOUT the leading `--`.
//   key       the epic's STATE key this flag writes, or null where the command consumes the
//             flag in its own logic instead of copying a value onto a key (`--story`/`--done`
//             are a control pair; `--add-story` appends a constructed object).
//   commands  the commands that accept it. An open list of names rather than an enum, so a
//             later capability can register a flag on a command this release never touched.
//   repeats   true = accumulates into an array across repeated `--flag value` occurrences.
//             parseFlags() reads this PER CALL (see repeatableFlags() in add-epic.mjs), so
//             setting it here is the only edit needed to make a flag repeat.
//   write     how the value reaches `key` — "replace" (the default), "append", or "custom"
//             where the command owns the write entirely. Declared, not yet dispatched on:
//             it is here so a capability adding an appending flag states the shape once.
//
// `key` is carried EXPLICITLY rather than derived from `flag`, because the mapping is already
// non-identity today (`--plan` → planPath, `--link` → links, `--external-id` → externalId) and
// any derivation rule would just be a second place to get it wrong. add-many's accepted BATCH
// keys are exactly the `key` of every entry naming `add-many` — which is why a batch document
// is written in state keys (`externalId`) and not flag names (`external-id`).
export const EPIC_FLAGS = [
  { flag: "id", key: "id", commands: ["add-epic", "add-many"] },
  { flag: "title", key: "title", commands: ["add-epic", "update-epic", "add-many"] },
  { flag: "lane", key: "lane", commands: ["add-epic", "add-many"] },
  { flag: "priority", key: "priority", commands: ["add-epic", "update-epic", "add-many"] },
  { flag: "status", key: "status", commands: ["add-epic", "update-epic", "add-many"] },
  { flag: "parent", key: "parent", commands: ["add-epic", "update-epic", "add-many"] },
  { flag: "external-id", key: "externalId", commands: ["add-epic", "update-epic", "add-many"] },
  { flag: "external-url", key: "externalUrl", commands: ["add-epic", "update-epic", "add-many"] },
  { flag: "plan", key: "planPath", commands: ["add-epic", "add-many"] },
  { flag: "link", key: "links", commands: ["add-epic", "update-epic", "add-many"], repeats: true, write: "custom" },
  // `description` and `notes` are DISTINCT and neither substitutes for the other: a description
  // is durable rationale (why this epic exists, what would make it worth revisiting), replaced
  // wholesale when set again; notes are an append-only trail that reads as activity. Both are
  // valued, and collapsing them would lose one of the two readings. `description` is a plain
  // string, so `add-many`'s string copy carries it unchanged; `notes` deliberately is NOT an
  // `add-many` flag — its state shape is an array of {at, actor, text} entries the batch loop
  // would silently drop, and rejecting the key by name is the whole point of #79.
  { flag: "description", key: "description", commands: ["add-epic", "update-epic", "add-many"] },
  { flag: "notes", key: "notes", commands: ["add-epic", "update-epic"], write: "append" },
  { flag: "review-mode", key: "reviewMode", commands: ["update-epic"] },
  { flag: "add-story", key: "stories", commands: ["update-epic"], write: "append" },
  { flag: "story", key: null, commands: ["update-epic"], write: "custom" },
  { flag: "done", key: null, commands: ["update-epic"], write: "custom" },
];

/** The flags `command` accepts, as bare names. The projection an allowlist is built from —
 *  never a second literal. */
export const epicFlagsFor = (command) =>
  EPIC_FLAGS.filter(f => f.commands.includes(command)).map(f => f.flag);

/** The epic flags declared repeatable. Consumed by parseFlags()'s union — see the comment on
 *  REPEATABLE_NON_EPIC_FLAGS in add-epic.mjs for why it is a union and not a replacement. */
export const repeatableEpicFlags = () => EPIC_FLAGS.filter(f => f.repeats).map(f => f.flag);

/** The state keys an `add-many` batch entry may carry. Derived from the same declaration, so
 *  the bulk path cannot drift from the single-epic one. Note these are STATE keys, not flag
 *  names — a batch document is written in `externalId`, not `--external-id`. */
export const epicBatchKeys = () =>
  EPIC_FLAGS.filter(f => f.commands.includes("add-many") && f.key).map(f => f.key);

export const KNOWN_AUTONOMY_LEVELS = ["off", "autonomous"];
// Default category taxonomy for the `--preauthorize "category:<name>:<reason>"` shorthand —
// see the `conductor` skill's "Epic-level autonomy" section for the matching heuristic each
// category expands to at decision-rule time. Additive-only convention: adding a category here
// is not a breaking change for existing preAuthorized entries.
export const KNOWN_PREAUTHORIZE_CATEGORIES = ["filesystem", "network", "schema", "external-api"];
export const KNOWN_REVIEW_MODES = ["off", "standard", "thorough"];
/** Rank used to compare review modes so an epic-level override can only ESCALATE above the
 *  repo-global dial, never de-escalate below it — see currentReviewMode(epicId). */
export const REVIEW_MODE_RANK = { off: 0, standard: 1, thorough: 2 };
export const LANE_RANK = { openspec: 0, superpowers: 1, "claude-code": 2, decision: 3, external: 4 };
export const laneRank = (l) => (l in LANE_RANK ? LANE_RANK[l] : 9);

// Platform-neutral by design: this is the literal ANCHOR writeRules() detects/replaces the
// block by (existing.includes(RULES_BEGIN), and the regex built from it). It must stay a
// single invariant string across all platforms, so it deliberately does not reference any
// platform's command form -- that lives in the block body instead, via pmCmd().
export const RULES_BEGIN = "<!-- BEGIN pm-conductor rules (managed by pm — safe to delete this block) -->";
export const RULES_END = "<!-- END pm-conductor rules -->";

// DETECTION keys on this stable prefix, never on the full decorated RULES_BEGIN above.
//
// Learned the hard way: the parenthetical used to read "(managed by /pm:init …)" and changing
// it to the platform-neutral "(managed by pm …)" meant `existing.includes(RULES_BEGIN)` no
// longer matched a block written by any earlier version -- so writeRules() fell through to its
// APPEND branch and produced a SECOND rules block in every existing repo on the next upgrade.
// Verified live before the fix: 1 block in, 2 blocks out.
//
// Keying on the prefix makes the decoration free to change: an old block is found, replaced in
// place, and silently upgraded to the current wording. Never tighten this back to the full
// string, and never make it platform-dependent -- a per-platform anchor would mean a block
// written under one platform is invisible to another, reintroducing the same duplication.
export const RULES_BEGIN_PREFIX = "<!-- BEGIN pm-conductor rules";

// ─────────────────── tracker direction: TWO predicates, resolved once ───────────────────
//
// They live here because `constants.mjs` is the only module BOTH emitters already reach:
// `briefing.mjs` does not import from `rules.mjs` and must not start (the one-directional
// discipline the engine is built on). A helper placed anywhere only one of them can reach
// becomes two copies, and the coherence assertion between them then passes vacuously — which
// is exactly how this defect shipped: `rules.mjs` suppressed the outward section on a literal
// vendor test while `briefing.mjs` gated the outward drift line on a tracker merely EXISTING,
// so cfdude/pm received a brief demanding outward action for 29 epics under a rules block
// carrying no outward instructions at all (#109).
export const KNOWN_TRACKER_DIRECTIONS = ["inward", "outward", "both"];

/** A tracker's resolved direction, or null when there is no tracker.
 *
 *  The FALLBACK is load-bearing independently of any state migration, because `/pm:upgrade`
 *  lags the plugin update by design — a repo can run this engine for weeks before its state is
 *  stamped. So a tracker with no recorded `direction` resolves to the behavior its vendor
 *  produced before direction existed: `github-issues` was inward-only, everything else received
 *  the outward mirror and never an inward pull.
 *
 *  A SECONDARY entry resolves `inward` whatever its vendor: the secondary role is defined as
 *  pull-only (no outward creation is specified for it anywhere), and every secondary emits an
 *  inward section today regardless of system. */
export function directionOf(tracker) {
  if (!tracker || !tracker.system) return null;
  if (KNOWN_TRACKER_DIRECTIONS.includes(tracker.direction)) return tracker.direction;
  if (tracker.role === "secondary") return "inward";
  return tracker.system === "github-issues" ? "inward" : "outward";
}

/** Resolved value #1: does the outward mirror apply to this tracker? */
export const outwardApplies = (tracker) => {
  const d = directionOf(tracker);
  return d === "outward" || d === "both";
};

/** The identifying scope an inward "list open items in …" step needs, or null.
 *  `github-issues` names its scope as a `repo` and nothing else; any other system accepts a
 *  `repo` or a `projectKey`. */
export function trackerScope(tracker) {
  if (!tracker || !tracker.system) return null;
  if (tracker.system === "github-issues") return tracker.repo || null;
  return tracker.repo || tracker.projectKey || null;
}

/** Resolved value #2: is an inward procedure EMITTABLE for this tracker?
 *
 *  Direction and scope are separate tests and must stay separate. A `github-issues` primary with
 *  no `repo` emits neither section today, resolves `inward`, and under the plain rule "inward iff
 *  direction includes inward" would gain a section it never had — carrying a `list open items in
 *  <scope>` step with nothing to put in the placeholder, which is the unrunnable emitted command
 *  "every command pm emits must run as written" forbids. */
export const inwardProcedureEmittable = (tracker) => {
  const d = directionOf(tracker);
  return (d === "inward" || d === "both") && !!trackerScope(tracker);
};

/** Does the REPO have an inward procedure anywhere — primary or any secondary? The completion-
 *  sync reminder, the brief's sync nudge and the brief's freshness line all key on this, so that
 *  none of them can instruct an action the repo has no emitted procedure for. */
export const anyInwardProcedureEmittable = (tracker, secondaryTrackers = []) =>
  inwardProcedureEmittable(tracker) ||
  (Array.isArray(secondaryTrackers) && secondaryTrackers.some(inwardProcedureEmittable));

/** True when this tracker's inward list step can be a literal `gh issue list --repo <repo>`
 *  invocation rather than the vendor-neutral "list open items in <system> (<scope>) with your own
 *  tooling" phrasing. Exported so an EMITTER never has to name a vendor to choose its phrasing —
 *  the suite's source scan fails any emitter that carries the `github-issues` literal itself,
 *  because a vendor literal in an emitter is how the direction rule came to be applied at one of
 *  two sites in the first place. */
export const usesGhIssueList = (tracker) =>
  !!tracker && tracker.system === "github-issues" && !!tracker.repo;
