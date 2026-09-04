// scripts/lib/constants.mjs
// Shared path/enum constants for the conductor engine. No dependencies on any other
// lib module — every other module may import from here.

import fs from "node:fs";
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
// Where `verify-specs` looks for design documents when no `--root` is given (#93). A DEFAULT
// and never an assumption: nothing scans it, no epic is registered from it, and a repository
// that keeps its designs elsewhere is told the root is absent rather than handed a confidently
// empty report. It sits beside PLANS_DIR because they are the same kind of fact — a convention
// this estate happens to follow — not because the engine reads inside either one.
export const SPECS_DIR = path.join(ROOT, "docs", "superpowers", "specs");
export const KNOWN_LANES = ["openspec", "superpowers", "claude-code", "decision", "external"];

/** The `--link` vocabulary. It lives HERE, beside every other `KNOWN_*`, because gh#100 was
 *  filed after running `rg 'KNOWN_[A-Z_]+ =' constants.mjs` and getting every enumerated set
 *  except this one — in a repo an agent reads code before fetching a website, so the set has to
 *  land where attention already is.
 *
 *  This is the FLAT list and nothing more. Which types the engine READS, which it WRITES as
 *  protocol state, and which are annotation-only are declared in lib/links.mjs next to the
 *  consumer files that read each one — that adjacency is what makes the vocabulary drift-proof
 *  instead of a second enumeration, and conductor-29 asserts the bands' union is exactly this
 *  array, so the two cannot come apart. */
export const KNOWN_LINK_TYPES = [
  "depends-on", "supersedes", "may-invalidate", "relates-to", "blocks", "resolves-blocker-for",
];

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

/** A gate verdict carries CHECKABLE evidence when it records the commit range it covered.
 *
 *  THE definition, so the refusal that demands a range and the surfaces that report one
 *  missing can never disagree. A verdict written before these fields existed carries a
 *  free-text `note` instead; it loads unchanged, reports as unevidenced, and is never mined
 *  for a range — parsing that prose is the dependency the fields were added to remove. */
export const gateHasEvidence = (entry) =>
  !!(entry && typeof entry.baseSha === "string" && typeof entry.headSha === "string");

export const NO_GATE_EVIDENCE = "no checkable evidence";

/** The verdicts that may be STORED on `gateReview.gateN`. Deliberately WIDER than the
 *  verdicts an agent may write: `ungated` is the archive-drift heal's record that it flipped a
 *  status with no verdict from anyone, and a verdict meaning "no review happened" must never
 *  be writable by the party whose work would otherwise be reviewed. The agent's list is
 *  `KNOWN_GATE_VERDICTS` in gate-review-writeback.mjs and stays `pass|fail`; widening THAT
 *  list to admit `ungated` for storage's sake defeats the whole rule. */
export const STORABLE_GATE_VERDICTS = ["pass", "fail", "ungated"];


/** The ONE wording every surface uses for a recorded gate verdict, so PROJECT.md and the brief
 *  cannot drift apart. `extra` carries anything a later capability appends per verdict (the
 *  staleness marking). */
export function gateSummary(entry, extra = "") {
  if (!entry || typeof entry.verdict !== "string") return "—";
  const range = gateHasEvidence(entry)
    ? `${entry.baseSha}..${entry.headSha}`
    : `⚠ ${NO_GATE_EVIDENCE}`;
  const who = entry.reviewer ? ` · ${entry.reviewer}` : "";
  return `${entry.verdict} (${range})${who}${extra}`;
}
// ─────────────────────── releases: the readers both surfaces share ───────────────────────
//
// They live here for the same reason gateSummary() does, and the same reason the tracker
// direction predicates do: `constants.mjs` is the ONE module both emitters already reach.
// `briefing.mjs` may not import `render.mjs` (render imports briefing), and neither may import
// `releases.mjs` (which imports render to re-render after a write) — a reader placed in any of
// those becomes two copies, and two copies of "how many epics are in this release" is exactly
// the disagreement one-way membership was chosen to make impossible.

/** The release named `id`, or null. THE lookup — every reader goes through it so "which
 *  release is this" has one answer. */
export const findRelease = (state, id) =>
  (Array.isArray(state && state.releases) ? state.releases : []).find(r => r && r.id === id) || null;

/** The epics that are IN `release`, read from the one-way membership pointer. */
export const releaseMembers = (epics, releaseId) =>
  (epics || []).filter(e => e && e.release === releaseId);

/** Every release with its two counts, in declaration order — the ONE computation PROJECT.md and
 *  the briefing both render from, so the two surfaces cannot report different numbers for the
 *  same release. `deferred` is carried whole (not just counted) because each entry's reason is
 *  what makes the exclusion legible. */
export function releaseSummaries(state, epics) {
  const releases = Array.isArray(state && state.releases) ? state.releases : [];
  return releases.filter(r => r && r.id).map(r => ({
    id: r.id,
    intent: r.intent || "",
    target: r.target,
    members: releaseMembers(epics, r.id).length,
    deferred: Array.isArray(r.deferred) ? r.deferred : [],
  }));
}

/** The ONE wording for a release line, shared by both surfaces exactly as gateSummary() is. */
export const releaseLine = (s) =>
  `\`${s.id}\`: ${s.members} epic${s.members === 1 ? "" : "s"}, ${s.deferred.length} deferred`;

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
//   valueless true = this flag is a BOOLEAN and legitimately carries no value. Absent (the
//             default) means the flag is VALUE-BEARING, and every write surface refuses a
//             valueless or blank occurrence of it — see requireFlagValues() in add-epic.mjs.
//             This is the #149 rule, and it lives HERE rather than in each command because
//             every command previously carried its own hand-written list of the flags it
//             happened to check: `add-epic` checked three, `update-epic` checked four,
//             `record-gate-review` checked none. Same flag, same row, three behaviours.
//             DELIBERATELY one-directional: a value-bearing flag refuses a missing value, and
//             a `valueless` flag is merely EXEMPT — `--done true` is not made an error here,
//             because tightening that is a second behaviour change and belongs to its own
//             change (the precedent `--spec` set, which is why #149 exists as its own issue).
//             The discriminator is this marker and never `key`: ten value-bearing rows carry
//             `key: null` because the command owns the write.
//   requires  the phrase completing "conductor: --<flag> requires ___" when the value is
//             missing. Defaults to "a value". Carried on the ROW so a bespoke refusal one
//             command grew — `--link` pointing at `--clear-links`, `--wont-do` demanding a
//             reason — reaches EVERY command that accepts the flag, instead of being a second
//             behaviour on a second surface. That asymmetry is the whole subject of #149.
//
// `key` is carried EXPLICITLY rather than derived from `flag`, because the mapping is already
// non-identity today (`--plan` → planPath, `--link` → links, `--external-id` → externalId) and
// any derivation rule would just be a second place to get it wrong. add-many's accepted BATCH
// keys are exactly the `key` of every entry naming `add-many` — which is why a batch document
// is written in state keys (`externalId`) and not flag names (`external-id`).
/** The phrase a refusal ends in when a REASON is missing. Declared once and read by rows in
 *  BOTH tables below: `update-epic --reason`, `release --reason` and `push-detour --reason` all
 *  demand the same thing for the same reason, and the words must not fork across two tables the
 *  way the RULE itself forked across two commands before #149. */
export const REASON_REQUIRES = "a non-empty reason";

export const EPIC_FLAGS = [
  { flag: "id", key: "id", commands: ["add-epic", "add-many"] },
  { flag: "title", key: "title", commands: ["add-epic", "update-epic", "add-many"] },
  // `lane` and `plan` are settable AFTER creation as well as at it. A mis-routed epic used to be
  // correctable in exactly one way — remove it and register it again — which discards its start
  // time, its gate verdicts, its links and its stories. Both are validated on `update-epic`
  // against the same lists creation validates against, so the two surfaces cannot admit
  // different values.
  { flag: "lane", key: "lane", commands: ["add-epic", "update-epic", "add-many"],
    placeholder: KNOWN_LANES.join("|") },
  { flag: "priority", key: "priority", commands: ["add-epic", "update-epic", "add-many"],
    placeholder: "P0|P1|P2|P3" },
  { flag: "status", key: "status", commands: ["add-epic", "update-epic", "add-many"],
    placeholder: KNOWN_STATUSES.join("|") },
  { flag: "parent", key: "parent", commands: ["add-epic", "update-epic", "add-many"] },
  { flag: "external-id", key: "externalId", commands: ["add-epic", "update-epic", "add-many"] },
  { flag: "external-url", key: "externalUrl", commands: ["add-epic", "update-epic", "add-many"] },
  { flag: "plan", key: "planPath", commands: ["add-epic", "update-epic", "add-many"] },
  // The DESIGN DOCUMENT the epic's work was drawn from (#92) — provenance, and many-to-one on
  // purpose: a design too large for one implementation plan yields N epics that all name it.
  // Registered on all three surfaces for the reason `--plan` is: an association settable only
  // at creation is unreachable for every epic that already exists, which is what kept #64/#69
  // unfixable. Nothing infers progress from it; see EPIC_SOURCE_ARTIFACTS in
  // lib/source-artifacts.mjs for the family it joins.
  { flag: "spec", key: "specPath", commands: ["add-epic", "update-epic", "add-many"] },
  { flag: "link", key: "links", commands: ["add-epic", "update-epic", "add-many"], repeats: true, write: "custom",
    requires: "a \"<type>:<epic>[:<reason>]\" value — to empty an epic's links, say so with --clear-links",
    placeholder: "type:epic[:reason]" },
  // Emptying the links array is its OWN named flag. `--link` replaces the array wholesale, so a
  // VALUELESS `--link` parsed as `[true]`, was filtered to `[]` by parseLinkFlags, and silently
  // wiped every link — the destructive reading of what looks like a typo. `--clear-links` says
  // what it does; the valueless `--link` is now refused and points here.
  { flag: "clear-links", key: "links", commands: ["update-epic"], write: "custom", valueless: true },
  // `description` and `notes` are DISTINCT and neither substitutes for the other: a description
  // is durable rationale (why this epic exists, what would make it worth revisiting), replaced
  // wholesale when set again; notes are an append-only trail that reads as activity. Both are
  // valued, and collapsing them would lose one of the two readings. `description` is a plain
  // string, so `add-many`'s string copy carries it unchanged; `notes` deliberately is NOT an
  // `add-many` flag — its state shape is an array of {at, actor, text} entries the batch loop
  // would silently drop, and rejecting the key by name is the whole point of #79.
  { flag: "description", key: "description", commands: ["add-epic", "update-epic", "add-many"] },
  { flag: "notes", key: "notes", commands: ["add-epic", "update-epic"], write: "append" },
  // The tracker's OWN updated timestamp as of the last time the agent read that item's content
  // — never a local clock reading, and never advanced by merely seeing the item in a list
  // response. Registered on all three surfaces because a bulk-mirrored epic that carries no
  // watermark instantly pollutes the "never re-read" count the brief reports.
  { flag: "external-updated-at", key: "externalUpdatedAt", commands: ["add-epic", "update-epic", "add-many"] },
  // record-gate-review's CONTROL flags. Pre-existing — the command read them long before this
  // registry existed — and registered here anyway, because an allowlist that omits the two
  // flags every invocation carries would reject the command's own usage line. Registering them
  // is what makes the allowlist usable at all; leaving them out would be the second, parallel
  // list `epic-annotation` forbids, spelled as an exception instead of as an array.
  { flag: "gate", key: null, commands: ["record-gate-review"], write: "custom", placeholder: "1|2" },
  // `verdict` and `reviewer` are SHARED with record-cross-spec-review, the RELEASE-scope gate:
  // registered by adding a command name to the entry that already exists, never by giving that
  // verb a literal list of its own. This is the registry doing the job it was built for — a
  // shared allowlist four capabilities each needed to grow was one of the five Criticals that
  // motivated the release gate, and growing it here costs one array element.
  { flag: "verdict", key: null, commands: ["record-gate-review", "record-cross-spec-review"], write: "custom",
    placeholder: "pass|fail" },
  // record-gate-review's evidence flags. They live in this registry because it is the single
  // declaration of the flag surface every epic-WRITING command shares, and recording a verdict
  // writes an epic. `key` is null on all three: they land nested under `gateReview.gateN`
  // rather than on a top-level epic key, so the command owns the write.
  { flag: "base-sha", key: null, commands: ["record-gate-review"], write: "custom" },
  { flag: "head-sha", key: null, commands: ["record-gate-review"], write: "custom" },
  { flag: "reviewer", key: null, commands: ["record-gate-review", "record-cross-spec-review"], write: "custom" },
  // Attribution is an EXPLICIT array of hashes the agent supplies, and the engine infers it
  // from nothing else — not the files a commit touches, not an epic id in a commit message.
  // Deriving it from touched files would make the archive move (which relocates every file a
  // change owns) the last attributed commit, and every verdict stale at the exact instant the
  // archive gate reads it.
  // `repeats: true` is load-bearing, not decoration: parseFlags OVERWRITES a non-repeatable
  // flag on each occurrence, so `--attribute-commit <a> --attribute-commit <b>` would exit 0
  // having silently kept only <b> — two attributed hashes becoming one, with the ORDER that
  // gives the array its meaning quietly destroyed.
  { flag: "attribute-commit", key: "attributedCommits", commands: ["update-epic"], repeats: true, write: "append" },
  // #166 — the EXIT from an append-only array. Append-only is right and stays: order carries
  // meaning and the LAST entry is the endpoint a recorded Gate 2 headSha is compared against. But
  // "cannot be reordered or de-duplicated" is a different claim from "can never be corrected",
  // and the second was inherited rather than decided. A `git reset` is a normal operation, and
  // the gate procedure requires attributing at the moment of each commit — so an attribution can
  // outlive its commit through no error of process, and every escape was worse than the problem:
  // hand-edit state.json (forbidden here), tag the orphan (makes a false record permanent and
  // reachable), or remove-epic (destroys the disposition, links and stories).
  //
  // Repeatable, because one reset can strand several shas at once. The withdrawal is RECORDED in
  // a SIBLING field rather than erased — a correction is a judgment, and this record keeps
  // judgments — and the sibling is what keeps the endpoint rule intact.
  { flag: "withdraw-commit", key: null, commands: ["update-epic"], repeats: true, write: "custom",
    requires: "the sha to withdraw", placeholder: "a sha this epic attributed" },
  // The interactive archive verb's disposition. `key` is `disposition` for both: they are two
  // halves of ONE record the verb builds and writes together, never two epic fields.
  { flag: "outcome", key: "disposition", commands: ["update-epic"], write: "custom",
    placeholder: "delivered|killed|superseded|abandoned|declined" },
  // Also `release`'s: an exclusion's reason IS a disposition reason — the same required-reason
  // rule at a fourth scope — so it shares this entry rather than getting a second one under the
  // same name, which epicFlagsFor() would then project twice.
  { flag: "reason", key: "disposition", commands: ["update-epic", "release"], write: "custom",
    requires: REASON_REQUIRES },
  // The deferral assertion. Three flags, ONE record: `--deferral` names work that moved to a
  // registered epic, `--declined-deferral` records a deliberate decline with its reason, and
  // `--no-deferrals` is the explicit "there are none" — which must be sayable, or an absence
  // is indistinguishable from never having looked.
  { flag: "deferral", key: "deferralAssertion", commands: ["update-epic"], repeats: true, write: "custom",
    placeholder: "epicId:artifact section" },
  { flag: "declined-deferral", key: "deferralAssertion", commands: ["update-epic"], repeats: true, write: "custom",
    placeholder: "what::why not" },
  { flag: "no-deferrals", key: "deferralAssertion", commands: ["update-epic"], write: "custom", valueless: true },
  // The handoff. Lands on the disposition record rather than a field of its own — "where the
  // work went" is part of how this epic ended, not a separate fact about it.
  { flag: "carried-to", key: "disposition", commands: ["update-epic"], write: "custom" },
  // The CORRECTION of an already-recorded agent disposition (#130). Value-bearing on purpose:
  // its value is why the recorded record was wrong, so the justification is required by the
  // flag's own shape rather than by a second flag — the same form `--wont-do "<reason>"` takes.
  // `update-epic` only: a creation path has no prior judgment to correct.
  { flag: "correct-disposition", key: "disposition", commands: ["update-epic"], write: "custom" },
  // Release planning. The `release` verb writes exactly ONE epic key — `release`, the one-way
  // membership pointer — and its other flags shape the release object itself, so they carry a
  // null key exactly as record-gate-review's evidence flags do.
  //
  // `--intent` is ALREADY repeatable at the parser (it is set-tracker's flag, and parseFlags'
  // repeatable set is a global union across every subcommand, not a per-verb list), so it
  // arrives as an array here whatever this registry says. Declared `repeats: true` rather than
  // left to look single-valued: a reader comparing this entry against what `parseFlags` hands
  // the verb must not find the two disagreeing. A release has ONE intent, so the verb takes the
  // last value — see lastStr() in releases.mjs.
  { flag: "intent", key: null, commands: ["release"], repeats: true, write: "custom" },
  { flag: "target", key: null, commands: ["release"], write: "custom" },
  { flag: "member", key: "release", commands: ["release"], repeats: true, write: "custom" },
  // The exclusion. `--defer <epicId> --reason "<why>"` records one epic cut from one release,
  // so `--defer` is deliberately NOT repeatable: a repeatable `--defer` with a single `--reason`
  // would silently attach one reason to several exclusions, which is the reason-bearing record
  // saying something nobody wrote.
  { flag: "defer", key: null, commands: ["release"], write: "custom" },
  { flag: "review-mode", key: "reviewMode", commands: ["update-epic"] },
  // Stories, and the ONE registry edit that makes a plan land with its milestones (#95).
  // `add-epic` and `add-many` join `update-epic` here rather than growing a second literal:
  // `epicFlagsFor("add-epic")` builds add-epic's allowlist and `epicBatchKeys()` builds
  // add-many's accepted batch keys from this same row, so declaring the row is the whole edit.
  // Measured cause of the gap it closes: an epic's milestones could only be added one
  // `update-epic` call at a time AFTER registration, which is why 91.7% of epics in the audited
  // 108-epic repo had none at all — decomposition was a chore rather than part of registration.
  //
  // `repeats: true` is what makes `--add-story A --add-story B` in one invocation land BOTH.
  // It reaches parseFlags through repeatableFlagNames()'s union, so no parser edit is needed —
  // but it also changes `--add-story`'s parsed shape from a string to an array on the
  // pre-existing `update-epic` path, which is why both writers read it through one helper.
  { flag: "add-story", key: "stories", commands: ["add-epic", "update-epic", "add-many"], repeats: true, write: "append",
    requires: "a non-empty title" },
  { flag: "story", key: null, commands: ["update-epic"], write: "custom" },
  { flag: "done", key: null, commands: ["update-epic"], write: "custom", valueless: true },
  // The story-level TERMINAL DISPOSITION. `--story <n> --wont-do "<reason>"` keeps the row and
  // records why it will never be done, which is the only honest key to the archive gate's
  // pre-existing handoff refusal for work that was DROPPED rather than carried anywhere. It is
  // a control flag paired with `--story`, so its `key` is null exactly as `--done`'s is; the
  // write lands inside `stories[n-1].disposition`, not on a top-level epic key.
  { flag: "wont-do", key: null, commands: ["update-epic"], write: "custom", requires: "a reason" },
  // ─────────── #84: the advisory claim's control flags ───────────
  //
  // `claim`/`unclaim` write an epic (`epic.claim`), so they belong in the registry every
  // epic-writing command shares rather than carrying two literal lists of their own — the
  // second-literal defect #149 reports. `key` is null on all four: the write lands nested under
  // `epic.claim`, never on a top-level epic key, so the verb owns it.
  //
  // NOTE the verb is `unclaim`, NOT `release`: #84 suggests `conductor release <epic-id>` and
  // that name is already this engine's version-release verb. One verb carrying two unrelated
  // meanings is how a `release --defer` would come to mean both "cut from a release" and "hand
  // the claim back".
  { flag: "session", key: null, commands: ["claim", "unclaim"], write: "custom",
    requires: "a session name — set PM_SESSION or pass --session <name>",
    placeholder: "a session name" },
  { flag: "ttl", key: null, commands: ["claim"], write: "custom",
    requires: "a positive number of minutes" },
  // `--steal` is deliberately NOT `--force`. saveState() reads `--force` GLOBALLY off argv to
  // bypass the revision guard (state.mjs), so a claim verb spelled `--force` would silently
  // disable optimistic concurrency on the very write it is coordinating — the enforcement half
  // (#83) defeated as a side effect of the cooperative half (#84).
  { flag: "steal", key: null, commands: ["claim", "unclaim"], write: "custom", valueless: true },
  // The REPO-level quiescence marker rather than an epic's claim. Valueless: its presence is
  // the whole argument.
  { flag: "repo", key: null, commands: ["claim", "unclaim"], write: "custom", valueless: true },
];

/** The log families `purge-logs` can select. HERE rather than in purge-logs.mjs because
 *  `VERB_FLAGS`' `--kind` row names them in its refusal, and constants.mjs must not import a
 *  verb module to say what a flag accepts. purge-logs.mjs imports it back. */
export const PURGE_KINDS = ["activity", "conflicts", "detours", "all"];

// ─────────────────────── the flag surface of every OTHER verb ───────────────────────
//
// #152. `valueBearingFlagsFor()` returned `[]` for any command EPIC_FLAGS does not name, so
// #149's rule silently no-op'd on a dozen verbs — and TWO of them (`triage --limit`,
// `verify-specs --root`) had each invented the same answer BY HAND, independently. That is the
// tell the rule was bound to a LIST rather than to the function it governs; see
// docs/lessons/bind-rules-to-functions-not-enumerations.md. `set-autonomy --level` was the
// sharpest instance: valueless, it wrote an autonomy block and exited 0 with the level absent,
// on the verb whose entire purpose is recording how much trust an epic has been granted.
//
// WHY A SIBLING TABLE AND NOT A RENAME. #152 weighs two shapes: rename `EPIC_FLAGS` to `FLAGS`
// and scope its rows, or declare per-verb next to each verb with a shared checker. This is the
// first shape WITHOUT the rename. `EPIC_FLAGS`' name is load-bearing in each of its remaining
// projections — `epicFlagsFor()` builds add-epic/update-epic/release/record-gate-review's
// ALLOWLISTS, `epicBatchKeys()` builds add-many's accepted batch KEYS, and `epicFlagCommands()`
// feeds conductor-30's epic sweep — and `changelog --since` is not an epic flag under any of
// them. (`repeatableEpicFlags()` was the fourth; `repeatableFlagNames()` supersedes it, because
// parseFlags' repeatable set is global across subcommands and so cannot be an epic-only
// projection.) Per-verb declarations were rejected for the opposite reason: the
// surface list must be derivable MECHANICALLY in one place (see conductor-31), and a declaration
// living next to each verb makes the derivation walk a dozen modules to find what it is missing.
//
// THE BOUNDARY, stated so a later capability does not have to guess: a flag belongs in
// `EPIC_FLAGS` when the command WRITES AN EPIC RECORD — the criterion, not the list, because
// #84 landed `claim`/`unclaim` (they write `epic.claim`) into that registry while this comment
// still named six commands, and the list was false the moment the two branches met. Read the
// criterion; `epicFlagCommands()` will always tell you the current membership. Everything else
// goes in `VERB_FLAGS`. Both tables carry the SAME row shape and `valueBearingFlagsFor()`
// reads their union, so the split is invisible to the rule — it decides which projections see a
// row, never whether the guard applies. Where the two tables need the same WORDS, they share a
// constant (`REASON_REQUIRES`) rather than a row.
//
// Rows are SCOPED, and `--remove` is why that matters: it is a value-bearing match string on
// `set-lane-routing` and a boolean on `set-tracker`. One global row for the spelling would have
// to pick one reading, and either choice is wrong on one of the two verbs.
//
// NOT DECLARED, deliberately: `--force` (read straight from `process.argv` by saveState(), on
// every verb) and `--help`/`-h` (short-circuited in conductor.mjs before dispatch). They are
// argv-level, belong to no verb, and a row for them would claim a per-verb surface they do not
// have. `--platform` IS declared, on the three verbs that read it, because those verbs each
// resolve it into a real behaviour and a valueless one silently fell back to the recorded
// platform while looking answered.
export const VERB_FLAGS = [
  { flag: "from", commands: ["add-many"], requires: "a path, or `-` to read the batch from stdin" },
  { flag: "cascade", commands: ["remove-epic"], valueless: true },
  { flag: "mode", commands: ["set-review-mode"], placeholder: "off|standard|thorough" },
  // set-autonomy — #152's sharpest instance.
  { flag: "level", commands: ["set-autonomy"], placeholder: "off|autonomous" },
  { flag: "preauthorize", commands: ["set-autonomy"], repeats: true },
  { flag: "context", commands: ["set-autonomy"], repeats: true },
  { flag: "notify", commands: ["set-autonomy"], repeats: true },
  // set-lane-routing. A valueless `--add`/`--remove` arrived as `[true]` and was skipped, or
  // matched against the literal string "true" — a rule that silently removed nothing.
  { flag: "add", commands: ["set-lane-routing"], repeats: true, requires: "a \"<match>:<lane>\" value" },
  { flag: "remove", commands: ["set-lane-routing"], repeats: true,
    requires: "the <match> of the override to remove" },
  { flag: "clear", commands: ["set-lane-routing"], valueless: true },
  // set-tracker. `--remove` here is the BOOLEAN "delete this secondary", not a match string.
  { flag: "role", commands: ["set-tracker"] },
  { flag: "system", commands: ["set-tracker"] },
  { flag: "repo", commands: ["set-tracker"] },
  { flag: "project", commands: ["set-tracker"] },
  { flag: "instance", commands: ["set-tracker"] },
  { flag: "mechanism", commands: ["set-tracker"] },
  { flag: "direction", commands: ["set-tracker"], placeholder: "inward|outward|both" },
  { flag: "intent", commands: ["set-tracker"], repeats: true },
  { flag: "remove", commands: ["set-tracker"], valueless: true },
  // record-reconcile and record-tracker-refresh. `--verdict` is spelled the same on four verbs
  // and means four different vocabularies, so it is four scoped rows and not one shared one;
  // what they agree on — that it takes a value — is what the row carries.
  { flag: "detour", commands: ["record-reconcile"] },
  // NO `placeholder`, deliberately. This ONE row serves two commands with DIFFERENT value
  // spaces — record-reconcile takes valid|invalidated, record-tracker-refresh takes
  // unchanged|material-change — and the registry has no way to say "these values, but only on
  // that command". A placeholder here would be right for one caller and a lie to the other,
  // which is worse than `<a value>`. Splitting the row, or giving `placeholder` a per-command
  // shape, is the real fix; neither is worth doing blind at the moment this was found.
  { flag: "verdict", commands: ["record-reconcile", "record-tracker-refresh"] },
  { flag: "amendments", commands: ["record-reconcile"] },
  { flag: "summary", commands: ["record-tracker-refresh"] },
  { flag: "external-updated-at", commands: ["record-tracker-refresh"] },
  { flag: "since", commands: ["changelog"] },
  { flag: "limit", commands: ["triage"], requires: "a positive integer" },
  { flag: "root", commands: ["verify-specs"] },
  { flag: "headers", commands: ["verify-specs"], valueless: true },
  { flag: "parent", commands: ["plan-hierarchy"] },
  // Found by the mechanical sweep this capability's test performs, and by nothing else: `render`
  // reads a flag from the middle of its own body, long after it has written PROJECT.md, so it is
  // the one declared flag NOT guarded by a requireFlagValues() call. Valueless, so there is
  // nothing for the guard to require — but declaring it is what keeps `render` out of
  // FLAGLESS_VERBS, where it would have been a false claim.
  { flag: "diff-summary", commands: ["render"], valueless: true },
  { flag: "epic", commands: ["rules"] },
  { flag: "platform", commands: ["rules", "write-rules", "rules-target"],
    placeholder: KNOWN_PLATFORMS.join("|") },
  // #151's detour-stack verbs. `--reason` shares REASON_REQUIRES with the epic registry's row
  // rather than restating the phrase: a deferral's reason is held to the same standard whichever
  // verb records it.
  { flag: "detour", commands: ["push-detour"] },
  { flag: "reason", commands: ["push-detour"], requires: REASON_REQUIRES },
  // The reconcile decision is SAID, never defaulted — see pushDetour() in lib/detour-stack.mjs
  // for why, and KNOWN_STATUSES' neighbour `--no-deferrals` for the precedent.
  { flag: "reconcile", commands: ["push-detour"], valueless: true },
  { flag: "no-reconcile", commands: ["push-detour"], valueless: true },
  // ─────────── #84 / #111: the four verbs the two branches met without declaring ───────────
  //
  // `owners`, `activity` and `purge-logs` each parsed `process.argv` BY HAND — a third and
  // fourth independent reinvention of the rule after `triage --limit` and `verify-specs --root`,
  // written on a branch that could not see #152 because #152 did not exist on it yet. Declaring
  // the rows without converting the verbs would have asserted a refusal that does not happen,
  // which is why the guard refused the shortcut; the verbs now go through
  // `parseFlags` + `requireFlagValues` like every other one, and these rows are true.
  //
  // `set-activity-log` is in FLAGLESS_VERBS below, not here: its argument is the POSITIONAL
  // `on|off`, and a row would claim a flag surface it does not have.
  //
  // `--json` is one row across both readers because it means the same boolean on each — the
  // opposite case to `--remove`, which is two rows precisely because it does not.
  { flag: "json", commands: ["owners", "activity"], valueless: true },
  // Scoped rather than folded into `changelog --since` / `rules --epic`: the spellings collide
  // and the vocabularies do not. `changelog --since` takes a VERSION, `activity --since` an
  // instant; `rules --epic` selects the epic a rules block is rendered for, `activity --epic`
  // filters a log. What they agree on — that a value is required — is all the row carries.
  { flag: "since", commands: ["activity"], requires: "an ISO-8601 timestamp" },
  { flag: "epic", commands: ["activity"], requires: "an epic id" },
  // purge-logs. Its own `--keep`/`--over`/`--older-than` checks stay and run AFTER this rule,
  // on the precedent `triage --limit` set: neither is subsumed, because a value that is present
  // and unparseable is a different mistake from a value that is absent.
  { flag: "kind", commands: ["purge-logs"], requires: `one of ${PURGE_KINDS.join("|")}` },
  { flag: "keep", commands: ["purge-logs"], requires: "a non-negative whole number" },
  { flag: "over", commands: ["purge-logs"], requires: "a size like 500K, 10M or 1G" },
  { flag: "older-than", commands: ["purge-logs"], requires: "a non-negative number of days" },
  { flag: "dry-run", commands: ["purge-logs"], valueless: true },
  { flag: "yes", commands: ["purge-logs"], valueless: true },
];

/** The dispatched verbs that accept NO flags at all — positional arguments or none.
 *
 *  An EXPLICIT declaration and not an inferred remainder. conductor-31 asserts every verb
 *  conductor.mjs dispatches is claimed by exactly one of the two flag tables or by this list, so
 *  "this verb takes no flags" and "nobody got round to declaring this verb" cannot look the same
 *  — which is precisely how a dozen verbs came to sit outside #149's rule without anyone
 *  deciding they should. */
export const FLAGLESS_VERBS = [
  "init", "brief", "snapshot", "commit-nudge", "sync", "log-detour", "honcho-memory",
  "reorder", "set-active", "clear-active", "suggest-lane", "set-gate-guard", "gate-guard",
  "lesson-advice", "verify-worktrees", "verify-state", "integrity", "changesets", "upgrade",
  // #111's toggle. Its argument is the POSITIONAL `on|off` — `set-activity-log --on` is refused
  // by the same check that refuses `set-activity-log maybe` — so it has no flag surface to
  // declare, and a VERB_FLAGS row for it would be a claim about a parser that does not exist.
  "set-activity-log",
  // `pop-detour` takes an OPTIONAL POSITIONAL assertion (the epic you expect to be on top) and
  // no flags. The stack is LIFO, so a flag that SELECTED a frame would be a different verb; what
  // the positional does is refuse when the top is not what the caller thinks it is.
  "pop-detour",
];

// ─────────────────── #84: advisory claim TTLs ───────────────────
//
// TWO defaults, and the split is load-bearing rather than fussy. #84 suggests a `heartbeatAt`,
// and a heartbeat nothing beats is `claimedAt` wearing a costume: it would make the staleness
// threshold a lie in both directions — a live session reads stale after N minutes of honest
// work, and a crashed one reads live until N minutes after its last write. The only true
// auto-bump chokepoint is saveState(), which does not know WHICH epic is being written, so an
// epic-scoped heartbeat there is not cheap. A stated TTL is unambiguous, self-documenting, and
// needs no distributed heartbeat: re-claiming extends it.
//
// An EPIC claim spans the work — hours. A REPO marker spans one operation — minutes — and its
// failure mode is the expensive one: a crashed session holding the "do not write here" flag for
// two hours is exactly the false coordination signal #84 warns is worse than none.
export const CLAIM_DEFAULT_TTL_MINUTES = 120;
export const REPO_CLAIM_DEFAULT_TTL_MINUTES = 30;

// ─────────────────── #111: the activity log's two caps ───────────────────
//
// Both SIZE-based, deliberately, and the maintainer's ruling says why a day is not a unit of
// anything here: a quiet repo emits nothing for a week, an orchestrated fan-out emits more in an
// hour than a normal month, and a log that only rotates on a calendar boundary can grow past the
// point where an agent can read it at all — which defeats the reason for collecting it.
//
// SEGMENT: 128 KB, chosen against a stated constraint rather than by feel. A segment must be
// fully readable in ONE pass by an agent: 128 KB / 191 B per measured event ≈ 680 events ≈ 37k
// tokens, which leaves room for the actual task. Larger stops satisfying the constraint; smaller
// multiplies files for no gain. At the observed rate that is 1–2 segments per month for the
// busiest repo in the fleet.
export const ACTIVITY_SEGMENT_MAX_BYTES = 131_072;
// RETENTION: 1 GB total per project, oldest first. ≈ 5.5 million events ≈ centuries at pm's own
// measured rate — a backstop against pathology, not an operating point, which is the right
// posture for a cap. Stated plainly because it is easy to misread: the cap is PER PROJECT and
// this is intended to run in ~22 of them, so the worst case is 22 GB and the measured real case
// is a few megabytes in total.
export const ACTIVITY_RETENTION_MAX_BYTES = 1_073_741_824;

/** The flags `command` accepts, as bare names. The projection an allowlist is built from —
 *  never a second literal. */
export const epicFlagsFor = (command) =>
  EPIC_FLAGS.filter(f => f.commands.includes(command)).map(f => f.flag);

/** EVERY flag `command` accepts, from BOTH tables. The union projection an ALLOWLIST is built
 *  from — the "is this flag known here at all" question, as distinct from `valueBearingFlagsFor`'s
 *  "does it need a value".
 *
 *  `epicFlagsFor()` answered this for the epic-write surfaces and `[]` for every other verb, so
 *  the verbs outside that registry that wanted an allowlist typed one out — `purge-logs`' KNOWN
 *  list was six flag names beside a table that could declare them. That is #152's shape one
 *  question over: a rule bound to a LIST rather than to the function it governs. Reading the
 *  union here means a verb's allowlist follows its rows whichever table they sit in, so moving a
 *  row between the two tables can never silently narrow what a verb accepts.
 *
 *  Note this deliberately does NOT filter on `valueless`: an allowlist must recognise
 *  `--dry-run` as known, and the value rule is a separate projection precisely so neither
 *  question can be answered with the other one's list. */
export const flagsFor = (command) =>
  [...new Set([...EPIC_FLAGS, ...VERB_FLAGS].filter(f => f.commands.includes(command))
    .map(f => f.flag))];

/** EVERY repeatable flag either table declares. parseFlags()'s repeatable set is GLOBAL across
 *  subcommands, so this is the one honest projection for it: a flag repeatable on any verb is
 *  repeatable at the parser. It replaces the hand-written REPEATABLE_NON_EPIC_FLAGS list
 *  add-epic.mjs used to carry — six flag names typed out beside a registry that could declare
 *  them, which is the same enumeration #152 is about wearing a smaller costume. */
export const repeatableFlagNames = () =>
  [...new Set([...EPIC_FLAGS, ...VERB_FLAGS].filter(f => f.repeats).map(f => f.flag))];

/** Every command any EPIC_FLAGS row names. Derived, never listed: the #149 guard has to be
 *  applied at EVERY write surface, and a surface enumerated by hand is the surface nobody
 *  remembers — `add-many` in the issue's own words, and `record-gate-review`, which checked no
 *  flag for a value at all and let a valueless `--reviewer` exit 0 with the field absent. */
export const epicFlagCommands = () => [...new Set(EPIC_FLAGS.flatMap(f => f.commands))];

/** The rows `command` accepts that REQUIRE a value, with the phrase each one's refusal ends in.
 *  The projection every write surface's guard reads — never a second literal, which is the
 *  defect #149 reports. */
// #152: the UNION of both tables, never EPIC_FLAGS alone. This function is where the rule was
// bound to a list — it answered `[]` for every command outside the epic registry, so
// requireFlagValues() ran and checked nothing on a dozen verbs. Reading the union here is the
// whole fix: every existing call site is covered without changing its code, and a verb declared
// in either table is covered from the moment its row lands.
export const valueBearingFlagsFor = (command) =>
  [...EPIC_FLAGS, ...VERB_FLAGS].filter(f => f.commands.includes(command) && !f.valueless)
    .map(f => ({ flag: f.flag, requires: f.requires || "a value" }));

/** The state keys an `add-many` batch entry may carry. Derived from the same declaration, so
 *  the bulk path cannot drift from the single-epic one. Note these are STATE keys, not flag
 *  names — a batch document is written in `externalId`, not `--external-id`. */
export const epicBatchKeys = () =>
  EPIC_FLAGS.filter(f => f.commands.includes("add-many") && f.key).map(f => f.key);

/** The commands whose EPIC_FLAGS rows describe a JSON BATCH DOCUMENT rather than a CLI flag
 *  surface. A COMMAND-level declaration, deliberately — the same shape as `FLAGLESS_VERBS` and
 *  for the same reason: how a command ACCEPTS keys is a property of the command, not of each row,
 *  and an inferred remainder is how a dozen verbs came to sit outside #149's rule.
 *
 *  `add-many` is the whole set today. Its rows are here so `epicBatchKeys()` can derive the state
 *  keys a batch entry may carry; its parser (`scripts/lib/add-many.mjs`) takes exactly one flag,
 *  `--from`, and refuses everything else. So `flagsFor("add-many")` answering 15 is CORRECT for
 *  the allowlist question it exists to answer, and WRONG the moment help reuses it: help would
 *  advertise 14 flags the parser ignores. An authoritative wrong answer is worse than none, which
 *  is the whole reason #158 was filed. */
/** Where a reader goes for procedure and rationale, as distinct from what THIS engine accepts.
 *
 *  Constants because two surfaces emit them — `verbHelp()` and the rules block — and a URL typed
 *  twice is a URL that will one day disagree with itself.
 *
 *  `llms.txt` is the INDEX and its entries already carry `.md`, so no instruction to append one is
 *  needed. `llms-full.txt` also exists and is deliberately NOT here: it is ~367KB, which is a
 *  context bomb rather than a help channel. conductor-35 asserts it never appears in emitted
 *  output. */
export const DOCS_INDEX_URL = "https://pm-plugin.dev/llms.txt";
export const DOCS_MCP_URL = "https://pm-plugin.dev/mcp";

export const BATCH_KEY_COMMANDS = ["add-many"];

/** The flags `command` accepts AT ITS PARSER — the projection HELP reads.
 *
 *  Distinct from `flagsFor()` on purpose, and the distinction is the one #158's fix turns on.
 *  `flagsFor()` answers "which rows NAME this command", which is right for an allowlist: a batch
 *  key and a CLI flag must both be recognised as known. This answers "which of those can a caller
 *  actually type", which is the only honest thing to print in help.
 *
 *  For every command outside `BATCH_KEY_COMMANDS` the two are identical by construction, and
 *  conductor-35 asserts that on a sample — so this can never quietly narrow a normal verb's
 *  surface while looking like it only touched add-many. */
export const cliFlagsFor = (command) =>
  BATCH_KEY_COMMANDS.includes(command)
    ? [...new Set(VERB_FLAGS.filter(f => f.commands.includes(command)).map(f => f.flag))]
    : flagsFor(command);

/** Everything help needs about ONE flag on ONE command, read from the row itself: whether it
 *  takes a value, whether repeating it accumulates, and the phrase its own refusal ends in.
 *  Two sources, in order: `placeholder` when the row carries one, else `requires`, else
 *  `<a value>`. The ORDER is the fix for a real defect — see the note inside.
 *
 *  HONEST LIMIT, measured rather than asserted: of the 92 value-bearing (verb, flag) pairs across
 *  all 48 verbs, only 21 render anything more specific than `<a value>`. An earlier version of
 *  this comment claimed `requires` alone made a truthful signature possible "without adding a
 *  prose field to ~100 rows" — true about truthfulness, false about usefulness, and Gate 2
 *  measured it: every closed-enum flag the engine enforces named none of its legal values, so a
 *  reader wanting to know what `--outcome` accepts still had to open `scripts/lib/`, which is the
 *  thing #158 exists to stop. `placeholder` is where a closed enum names its values; the ten that
 *  have one are done, and the remaining `<a value>` rows are a known, visible gap rather than a
 *  claim that the surface is complete. */
export const flagSpecsFor = (command) => {
  const rows = [...EPIC_FLAGS, ...VERB_FLAGS].filter(f => f.commands.includes(command));
  const seen = new Map();
  for (const name of cliFlagsFor(command)) {
    const f = rows.find(r => r.flag === name);
    if (!f || seen.has(name)) continue;
    seen.set(name, {
      flag: name,
      valueless: f.valueless === true,
      repeats: f.repeats === true,
      // PLACEHOLDER first, `requires` only as a fallback. The two have different audiences and
      // conflating them shipped a real defect: `--link`'s `requires` ends "...say so with
      // --clear-links", which is correct in a REFUSAL and made `add-epic --help` advertise
      // `--clear-links` — a flag add-epic's parser refuses — falsifying help's own headline
      // invariant. `--session`'s nested itself the same way. `requires` stays the refusal tail
      // and is unchanged; `placeholder` is what a SIGNATURE needs, and it is also where a closed
      // enum names its legal values, which `requires` never did for --outcome, --status or --lane.
      requires: f.valueless === true ? null : (f.placeholder || f.requires || "a value"),
    });
  }
  return [...seen.values()];
};

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
 *  `repo` or a `projectKey`.
 *
 *  This is the SINGLE definition of "what this tracker names as its scope" — the emitter reads
 *  it rather than picking `repo`/`projectKey` out of the tracker itself, so there is exactly one
 *  answer to compare against `inwardProcedureEmittable`'s. Two readings of the same question is
 *  how a section comes to be emitted with a placeholder nothing filled in. */
export function trackerScope(tracker) {
  if (!tracker || !tracker.system) return null;
  // A SECONDARY is vendor-neutral about its scope, whatever its system: `set-tracker --role
  // secondary` accepts `--repo` OR `--project` for every vendor and refuses an entry carrying
  // neither. Reading only `repo` for a github-issues secondary therefore calls a REGISTERED
  // tracker scope-less — which is how `--role secondary --system github-issues --project ABC`
  // came to have its epic id emitted as `add-epic --id null-<issue-number>`, a command that
  // does not run as written. The github-issues repo-only rule below governs the PRIMARY slot
  // only, exactly as `tracker-sync` requires of the scope-lessness rule it feeds.
  if (tracker.role === "secondary") return tracker.repo || tracker.projectKey || null;
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

/** Is an inward procedure emittable for a SECONDARY tracker?
 *
 *  Deliberately NOT `inwardProcedureEmittable`. Scope-lessness governs the primary slot only —
 *  `tracker-sync` says in as many words that the requirement "MUST NOT be generalized to them"
 *  — because a secondary is pinned inward by definition and registration already refuses one
 *  with neither `--repo` nor `--project`. Running a secondary through the primary's predicate
 *  generalized it anyway, and `trackerScope` reads `repo` and ignores `projectKey` for
 *  `github-issues`: a secondary registered as `--system github-issues --project ABC` had
 *  rules.mjs emitting its whole sync section while the completion-sync reminder, the brief's
 *  freshness line and `sync`'s own message all suppressed. Two emitters, same question,
 *  opposite answers.
 *
 *  The test is exactly the `continue` guard the secondary emitter loop in rules.mjs applies —
 *  `st && st.system`, i.e. "this is a registered secondary" — so the emitter and the predicate
 *  cannot answer differently. Adding a scope test here to close that gap would BE the
 *  generalization the spec forbids; the fix is for the predicate to follow the emitter. */
export const secondaryInwardProcedureEmittable = (st) => !!(st && st.system);

/** Does the REPO have an inward procedure anywhere — primary or any secondary? The completion-
 *  sync reminder, the brief's sync nudge and the brief's freshness line all key on this, so that
 *  none of them can instruct an action the repo has no emitted procedure for. */
export const anyInwardProcedureEmittable = (tracker, secondaryTrackers = []) =>
  inwardProcedureEmittable(tracker) ||
  (Array.isArray(secondaryTrackers) && secondaryTrackers.some(secondaryInwardProcedureEmittable));

/** The deterministic id PREFIX for an epic mirrored from an item in this tracker. The full id
 *  is `<prefix>-<item-number>`.
 *
 *  Derived from what identifies the item globally — the tracker's system and its scope — so the
 *  same external item yields the same epic id in every repo and every session. That is what lets
 *  a re-run of the emitted recipe be REFUSED as a duplicate instead of creating a second epic
 *  under a slug the agent invented from the title (two sessions hit exactly that the same
 *  afternoon). The scope is load-bearing, not decoration: without it, `#42` in two different
 *  repos derives one id and the second registration collides with the first — the very
 *  cross-tracker collision `externalUrl` dedup exists to avoid.
 *
 *  `github-issues` shortens to `gh`. That abbreviation is legibility only, and is NOT a claim of
 *  continuity with the ids already in this repository: because the scope is part of the prefix,
 *  issue #109 on `cfdude/pm` derives `gh-cfdude-pm-109`, while the epics mirrored here before
 *  this function existed are spelled `gh-109`. Nothing depends on the two agreeing — dedup keys
 *  on `externalUrl` (add-epic.mjs), which is identical under either spelling, so an old-form and
 *  a new-form registration of the same issue are still refused as one duplicate. */
export function mirroredEpicIdPrefix(tracker) {
  if (!tracker || !tracker.system) return null;
  const scope = trackerScope(tracker);
  if (!scope) return null;
  const slug = (v) => String(v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const system = tracker.system === "github-issues" ? "gh" : slug(tracker.system);
  return `${system}-${slug(scope)}`;
}

/** True when this tracker's inward list step can be a literal `gh issue list --repo <repo>`
 *  invocation rather than the vendor-neutral "list open items in <system> (<scope>) with your own
 *  tooling" phrasing. Exported so an EMITTER never has to name a vendor to choose its phrasing —
 *  the suite's source scan fails any emitter that carries the `github-issues` literal itself,
 *  because a vendor literal in an emitter is how the direction rule came to be applied at one of
 *  two sites in the first place. */
export const usesGhIssueList = (tracker) =>
  !!tracker && tracker.system === "github-issues" && !!tracker.repo;

// ─────────────────────── gh#82 — is ROOT the repository the caller is in? ───────────────────────
//
// `ROOT` above prefers CLAUDE_PROJECT_DIR over the cwd, and everything the engine touches hangs
// off it: `.conductor/`, `state.json`, `PROJECT.md`, `CLAUDE.md`, `openspec/changes/`. When that
// variable is stale or points elsewhere, `add-epic` files into another repo's backlog and
// `write-rules` rewrites another repo's managed rules block — with no error and no line of output
// naming the repository that was written.
//
// The precedence is NOT changed here, deliberately. It is load-bearing: hooks and slash commands
// resolve the project through it, 0.28.0's self-hosting handoff resolves the checkout through it,
// and the maintainer's cross-repo orchestration targets a sibling conductor with it. Refusing
// would break a supported pattern; the defect is that a redirect is INDISTINGUISHABLE from a local
// run in the output, so the fix is to make it distinguishable. This guard only observes.
//
// A first-class `--project-dir` flag (the tracker's "better" suggestion) is deliberately NOT part
// of this: the frozen `path.join(ROOT, …)` constants above are computed at module load, before any
// dispatcher could parse a flag, so it needs a re-exec or argv-parsing inside this module. That is
// the issue's separate "(b) missing feature", not this defect.

/** Is `ROOT` a DIFFERENT repository from the one the caller is standing in, or merely a different
 *  path to the same project?  Returns `{ target, cwd }` for the former, `null` otherwise.
 *
 *  Three conditions, and each rules out a case where warning would be a nuisance:
 *
 *  1. CLAUDE_PROJECT_DIR is set at all — with it unset, ROOT *is* the cwd and there is no
 *     redirect to report.
 *  2. It resolves to a different directory. Through `realpathSync`, never a string compare: on
 *     macOS the harness (and every fixture under `os.tmpdir()`) carries `/var/folders/…` while
 *     `process.cwd()` reports the physical `/private/var/folders/…`, so a string compare calls
 *     one directory two and fires this warning on every invocation in a symlinked checkout.
 *  3. The cwd has a `.conductor/` OF ITS OWN. This is the discriminator, and it is what separates
 *     "I meant this repo, the harness meant that one" from every legitimate use. Running the
 *     engine from a subdirectory (`pm/scripts/`) is routine and silent, because a subdirectory has
 *     no conductor. Pointing the engine at a project from a neutral directory — the test harness,
 *     `evals/fixtures.py`, an orchestrator that avoids `cd` — is silent for the same reason. Only
 *     when TWO initialized projects are in play, and the one being written is not the one you are
 *     standing in, is there a choice that could have gone the other way.
 *
 *  A git WORKTREE of the same repository does trip this, and that is correct rather than
 *  collateral: a worktree has its own checkout of `.conductor/state.json`, so writing the main
 *  checkout's copy from inside a worktree changes a different file than the one on screen. */
export function rootDivergence({ env = process.env, cwd = process.cwd() } = {}) {
  const declared = env.CLAUDE_PROJECT_DIR;
  if (!declared) return null;
  // A path that does not exist cannot be realpath'd; resolve() still normalizes it, and a
  // non-existent target is a divergence worth reporting rather than a reason to fall silent.
  const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
  const target = real(declared);
  const here = real(cwd);
  if (target === here) return null;
  if (!fs.existsSync(path.join(here, ".conductor"))) return null;
  return { target, cwd: here };
}

/** Emit the divergence warning, once, naming BOTH repositories. Returns what it reported, or null.
 *
 *  Unconditional by design — NOT gated on PM_QUIET_ENGINE_BANNER or on CLAUDE_PROJECT_DIR being
 *  absent. The engine banner is suppressed whenever CLAUDE_PROJECT_DIR is set, which means the
 *  single condition that redirects every write is also the condition that makes the engine
 *  quietest. A safety line that inherits that is no safety line. */
export function warnRootDivergence(stream = process.stderr) {
  const d = rootDivergence();
  if (!d) return null;
  stream.write(
    `conductor: ⚠ WRITING A DIFFERENT REPOSITORY — CLAUDE_PROJECT_DIR points at ${d.target}\n` +
    `conductor:   You are in ${d.cwd}, which has a conductor of its own. Every path this ` +
    `command reads or writes belongs to ${d.target}. Unset CLAUDE_PROJECT_DIR to act here instead.\n`
  );
  return d;
}
