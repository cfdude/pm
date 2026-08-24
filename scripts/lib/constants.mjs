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
