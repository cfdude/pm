// scripts/lib/update-epic.mjs
// The update-epic write-back verb: title/status/priority/links/story mutations on an
// existing epic. One-directional dependencies only.

import {
  EPIC_FLAGS, KNOWN_LANES, KNOWN_STATUSES, KNOWN_REVIEW_MODES, REVIEW_MODE_RANK,
  epicFlagsFor, isFlagToken, nullableEpicFlags, splitFlagToken,
} from "./constants.mjs";
import { activate } from "./active-pointer.mjs";
import { globalReviewMode } from "./rules.mjs";
import { isInitialized, loadState, saveState } from "./state.mjs";
import { reportSave } from "./save-report.mjs";
import { noteEntry, parentError, parseFlags, parseLinkFlags, parseStoryFlags, requireFlagValues } from "./add-epic.mjs";
import { render } from "./render.mjs";
import { archiveGate, AGENT_OUTCOMES } from "./archive-gate.mjs";
import { deferralAssertion, isStoryDisposed, storyDisposition, storyDispositionError } from "./disposition.mjs";
import { claimArtifacts } from "./source-artifacts.mjs";
import { linkTypeVocabulary, mergeLinks } from "./links.mjs";

// The flags update-epic recognizes. Anything else is a rejected error, not a
// silent no-op — an unrecognized flag (e.g. a typo) used to parse, run, and
// print "updated" with nothing actually changed.
//
// A PROJECTION of the shared EPIC_FLAGS registry, never a literal: this list, add-epic's and
// add-many's all have to grow for every flag this release adds, and a literal here is exactly
// the copy that would reject another capability's flag by name. Registering a flag on
// `update-epic` in EPIC_FLAGS is the whole edit; nothing changes in this file.
export const UPDATE_EPIC_FLAGS = epicFlagsFor("update-epic");

/** Which of `shas` are NOT in `state`'s record of epic `id` — read from a state loaded FROM DISK,
 *  never from the in-memory object the command has been mutating.
 *
 *  #140: four `--attribute-commit` invocations reported success and the arrays read `[]`
 *  afterwards. saveState() now verifies its own bytes reached the disk, and that covers every
 *  verb — but this command does not END at saveState(): render() runs afterwards and writes
 *  again (its reconcileArchived() self-heal saves a state it re-loaded). #140's first candidate
 *  mechanism is exactly that shape — "a later engine invocation re-serialising state.json from a
 *  copy read before the attribution" — and a guard inside saveState structurally cannot see a
 *  write that happens after it returns. So the claim this command prints is checked against the
 *  disk at the moment the command makes it, which is the only moment that matters to a caller.
 *
 *  An absent epic or an absent array counts as everything missing: both mean the record does not
 *  hold what the caller was told it holds. */
export function missingAttributions(state, id, shas) {
  const epic = (state.epics || []).find(e => e && e.id === id);
  const held = new Set(Array.isArray(epic && epic.attributedCommits) ? epic.attributedCommits : []);
  return shas.filter(sha => !held.has(sha));
}

/** Update an EXISTING epic's title/externalId/externalUrl/parent/status/priority/links.
 *  The id is POSITIONAL (parseFlags skips non-`--` tokens). Closes the tracker
 *  sync loop: after the agent creates an issue it records the key here.
 *
 *  --link APPENDS. A link's IDENTITY is its type and its target; the reason is the part a reader
 *  acts on and is NOT part of that identity, so re-supplying an already-recorded (type, target)
 *  UPDATES that entry's reason in place rather than adding a second entry — two relationships of
 *  the same type between the same pair of epics are one relationship. It used to REPLACE the
 *  array wholesale, which made recording a second relationship silently discard the first.
 *  To empty the array, say so with --clear-links; the two are combinable in ONE invocation, so
 *  the documented repair of a malformed link stays a single atomic write.
 *
 *  --clear <flag> is the GENERIC unset, one flag for every field the registry declares nullable
 *  (`nullable: true` in EPIC_FLAGS). It names fields by their FLAG spelling, never their state
 *  key. `links` is deliberately refused by it and points at --clear-links. */
export function updateEpic() {
  if (!isInitialized()) { process.stderr.write("conductor: run /pm:init first\n"); process.exit(1); }
  const argv = process.argv.slice(3);
  const id = argv[0] && !argv[0].startsWith("--") ? argv[0] : undefined;
  // #71: `update-epic --id my-epic --priority P1` is the mistake everyone makes, because every
  // OTHER epic-writing command takes `--id`. This one's id is POSITIONAL and stays that way —
  // accepting `--id` as an alias would make the same argument mean two things depending on which
  // verb you typed. So DIAGNOSE it: name the flag, show the positional form, and rewrite the
  // exact line the caller meant. A bare usage dump naming ~25 flags answers a question nobody
  // asked and never mentions `--id` at all, which is why the mistake kept recurring.
  //
  // TWO distinct diagnoses. "You put the id behind a flag" and "you gave no id at all" are
  // different mistakes and get different messages; collapsing them back into one usage dump is
  // the regression this guards against.
  if (!id) {
    // gh#182: the FOURTH raw-argv scanner, and the same two halves. `--id=e1` must be diagnosed
    // as well as `--id e1`, and the token it consumes as the value must be decided by
    // isFlagToken() rather than by a leading `--`, so the rewritten line it prints is the line
    // the caller actually meant.
    const at = argv.findIndex(a => a === "--id" || a.startsWith("--id="));
    if (at !== -1) {
      const [, inline] = splitFlagToken(argv[at]);
      const consumesNext = inline === undefined
        && argv[at + 1] !== undefined && !isFlagToken(argv[at + 1]);
      const value = inline !== undefined ? inline : (consumesNext ? argv[at + 1] : "<id>");
      // Only drop at+1 when it WAS this flag's value. Dropping it unconditionally silently
      // deleted the next flag from the suggested line whenever `--id` carried no value at all.
      const rest = argv.filter((_, i) => i !== at && !(consumesNext && i === at + 1));
      process.stderr.write(
        `conductor: update-epic takes its epic id POSITIONALLY, not as --id — write ` +
        `\`update-epic <id> ...\`, i.e. \`update-epic ${value}${rest.length ? ` ${rest.join(" ")}` : ""}\`. ` +
        "Nothing was written.\n");
      process.exit(1);
    }
    process.stderr.write("conductor: update-epic requires an epic id as its first POSITIONAL argument\n");
    process.stderr.write(`usage: conductor.mjs update-epic <id> [--title T] [--external-id X] [--external-url U] [--parent P] [--status S] [--priority P] [--lane openspec|superpowers|claude-code|decision|external] [--plan <path>] [--spec <path>] [--link \"<${linkTypeVocabulary()}>:<epic>[:<reason>]\"] [--clear-links] [--clear <field>] [--review-mode off|standard|thorough] [--add-story \"<title>\"] [--story <n> --done|--wont-do "<reason>"] [--attribute-commit <sha>] [--withdraw-commit <sha> --withdrawal-reason \"<why>\"] [--outcome ${AGENT_OUTCOMES.join("|")}] [--reason \"<why>\"] [--correct-disposition \"<why the recorded one was wrong>\"] [--carried-to <epicId>] [--deferral \"<epicId>:<section>\" (or ::)] [--declined-deferral \"<what>::<why not>\"] [--no-deferrals] [--description D] [--notes \"<text>\"] [--external-updated-at <iso>]\n`);
    process.exit(1);
  }
  const f = parseFlags(argv.slice(1));
  const unknown = Object.keys(f).filter(k => !UPDATE_EPIC_FLAGS.includes(k));
  if (unknown.length) {
    process.stderr.write(`conductor: update-epic: unknown flag(s) --${unknown.join(", --")} ` +
      `(known: ${UPDATE_EPIC_FLAGS.map(k => `--${k}`).join(", ")})\n`);
    process.exit(1);
  }
  // #149 — every value-bearing flag this command accepts must carry a usable value, read from
  // the shared registry. It replaces the per-flag checks this command had grown for `--plan`,
  // `--spec`, `--description` and `--notes` — four of the value-bearing flags it accepts;
  // `--outcome`, `--reason`, `--carried-to`, `--base-sha` and the rest were never checked here
  // at all. Before loadState(), so a refusal can leave no partial write.
  requireFlagValues("update-epic", f);
  const str = (v) => (typeof v === "string" ? v : undefined);
  const state = loadState();
  const epic = state.epics.find(e => e.id === id);
  if (!epic) { process.stderr.write(`conductor: epic '${id}' not found\n`); process.exit(1); }

  const parent = str(f.parent);
  if (parent !== undefined) {
    const perr = parentError(state.epics, id, parent);
    if (perr) { process.stderr.write(`conductor: ${perr}\n`); process.exit(1); }
  }
  const status = str(f.status);
  if (status !== undefined && !KNOWN_STATUSES.includes(status)) {
    process.stderr.write(`conductor: --status must be one of ${KNOWN_STATUSES.join("|")}\n`); process.exit(1);
  }
  // --lane: re-route an epic in place. Validated against the SAME KNOWN_LANES creation validates
  // against, so a lane addEpic() would refuse cannot arrive through this door instead. Tested on
  // `f.lane !== undefined` rather than on the str() result, so a VALUELESS `--lane` (which
  // parseFlags yields as boolean true) is refused by name rather than dropped by str() into an
  // exit-0-write-nothing — the #79 shape.
  const lane = str(f.lane);
  if (f.lane !== undefined && (lane === undefined || !KNOWN_LANES.includes(lane))) {
    process.stderr.write(`conductor: --lane must be one of ${KNOWN_LANES.join("|")}\n`); process.exit(1);
  }
  // --plan / --spec: attach (or repoint) the plan, and the DESIGN DOCUMENT an epic's work was
  // drawn from (#92). Written by their own explicit lines because the EPIC_FLAGS row makes this
  // command ACCEPT the flag and nothing in the registry copies a value onto a key — registering
  // a row and stopping there is the exit-0-write-nothing shape of #79. Their valueless refusals
  // moved to requireFlagValues() above, which covers every flag rather than these two.
  const planPath = str(f.plan);
  const specPath = str(f.spec);
  // Clearing the links is a NAMED flag, and the valueless `--link` that used to do it by
  // accident is refused. `--link` is repeatable, so `--link` with nothing after it parses as
  // `[true]`; parseLinkFlags filters non-strings away and yields `[]`, which then REPLACED the
  // array — a wipe that looks exactly like a typo and reports "updated". Both spellings now say
  // what they mean, and the refusal names the one that clears.
  //
  // THE MUTUAL EXCLUSION IS GONE, deliberately. Replacement is the documented repair for a
  // malformed link, and under APPEND that repair is exactly "clear, then supply the corrected
  // set". Keeping them exclusive would make it two writes with a zero-link window between them,
  // and a rejection on the second would leave the epic with no links at all.
  let clearedLinks = false;
  let suppliedLinks;
  if (f["clear-links"] !== undefined) {
    if (f["clear-links"] !== true) {
      process.stderr.write("conductor: --clear-links takes no value\n"); process.exit(1);
    }
    clearedLinks = true;
  }
  if (f.link !== undefined) {
    // The "--link requires a value, and --clear-links is the one that empties" refusal that
    // stood here now lives on the `--link` ROW in EPIC_FLAGS, as its `requires` phrase, and
    // fires from requireFlagValues() above. Same words, and now on `add-epic` too — which
    // accepted a valueless `--link`, filtered it to `[]` and created the epic. Keeping a second
    // copy here would be unreachable code asserting a rule the registry already carries.
    try {
      suppliedLinks = parseLinkFlags(f.link, new Set(state.epics.map(e => e.id)));
    } catch (e) {
      process.stderr.write(`conductor: ${e.message}\n`); process.exit(1);
    }
  }

  // `--clear <field>` — the GENERIC unset. Repeatable, and it names fields by their FLAG
  // spelling: `--clear plan`, never `--clear planPath`. The accepted set and the message that
  // enumerates it are both read from the registry HERE, at the moment of the refusal, so a row
  // that gains `nullable: true` becomes clearable without an edit to this file — and a literal
  // list here would be the stale hand-typed enumeration this release already measured once.
  const nullableRows = nullableEpicFlags("update-epic");
  const clearedFlags = [].concat(f.clear === undefined ? [] : f.clear)
    .filter(v => typeof v === "string").map(v => v.trim().replace(/^--/, ""));
  const clearedRows = [];
  for (const name of clearedFlags) {
    const nullableRow = nullableRows.find(r => r.flag === name);
    if (nullableRow) { clearedRows.push(nullableRow); continue; }
    // A SET-ONLY field is refused with the registry's OWN reason rather than a generic "not
    // clearable" — the reason is declared beside the marker precisely so it reaches a reader.
    const declared = EPIC_FLAGS.find(r => r.flag === name && r.commands.includes("update-epic"));
    if (declared && declared.setOnly) {
      process.stderr.write(
        `conductor: --clear ${name}: '${name}' is deliberately set-only — ${declared.setOnly}. ` +
        "Nothing was written.\n");
      process.exit(1);
    }
    process.stderr.write(
      `conductor: --clear ${name}: '${name}' is not a field this command can unset. ` +
      `Clearable fields: ${nullableRows.map(r => `${r.flag} (${r.key})`).join(", ")}. ` +
      "Name the FLAG, not the state key — they are two namespaces. Nothing was written.\n");
    process.exit(1);
  }
  // Setting and clearing ONE field in one invocation is contradictory, and silently letting one
  // win would make the record depend on the order this function happens to write in. Scoped to
  // the cleared FLAG's own spelling, so it can never catch `--clear-links --link`, which is a
  // different flag and is the required atomic repair.
  const contradictory = clearedFlags.filter(n => f[n] !== undefined);
  if (contradictory.length) {
    process.stderr.write(
      `conductor: --clear ${contradictory.join(", --clear ")} contradicts ` +
      `--${contradictory.join(", --")} in the same invocation — set the field or unset it, ` +
      "not both. Nothing was written.\n");
    process.exit(1);
  }

  // --review-mode: a per-epic escalation-only override of the repo-global review-mode dial
  // (set-review-mode). It must never be usable to quietly de-escalate below the global dial —
  // that would let one epic silently weaken review rigor a human explicitly raised repo-wide.
  const reviewMode = str(f["review-mode"]);
  if (reviewMode !== undefined) {
    if (!KNOWN_REVIEW_MODES.includes(reviewMode)) {
      process.stderr.write(`conductor: --review-mode must be one of ${KNOWN_REVIEW_MODES.join("|")}\n`);
      process.exit(1);
    }
    const global = globalReviewMode(state);
    if (REVIEW_MODE_RANK[reviewMode] < REVIEW_MODE_RANK[global]) {
      process.stderr.write(
        `conductor: --review-mode '${reviewMode}' would de-escalate below the repo-global dial ` +
        `('${global}') — an epic-level override may only escalate above the global dial, never below it\n`);
      process.exit(1);
    }
  }

  // The valueless --description / --notes loop that stood here is requireFlagValues()' job now.
  const description = str(f.description);
  const note = str(f.notes);

  // --add-story "<title>" appends { title, done: false } to the epic's inline stories[]
  // (creating the array if this is its first inline story) -- closes the recurring
  // hand-edit-of-state.json risk (a naive JSON re-escape of an em dash has corrupted the
  // file before). --story <n> --done marks an existing story done; <n> is 1-indexed (the
  // natural reading for a human-facing CLI flag: "--story 1" means the first story).
  // `--add-story` is repeatable as of gh#95, so it arrives as an ARRAY and is parsed by the
  // same helper add-epic uses — one validation rule, not two that drift.
  let addedStories;
  try { addedStories = parseStoryFlags(f["add-story"]); }
  catch (e) { process.stderr.write(`conductor: ${e.message}\n`); process.exit(1); }

  // `--story <n>` now takes TWO mutations: `--done` (it shipped) and `--wont-do "<reason>"`
  // (it will not be done, and here is why). The second is the honest key to the archive gate's
  // pre-existing handoff refusal, whose other remedy — the `<!-- pm:lifecycle -->` marker —
  // cannot be applied to an inline story at all, there being no task source to write it in.
  const wontDo = f["wont-do"];
  let storyIndex, storyMutation;
  if (f.story !== undefined) {
    const asked = [f.done === true ? "done" : null, wontDo !== undefined ? "wont-do" : null].filter(Boolean);
    if (asked.length === 0) {
      process.stderr.write("conductor: --story <n> requires a mutation — --done (it shipped) or --wont-do \"<reason>\" (it will not be done, and why)\n");
      process.exit(1);
    }
    if (asked.length > 1) {
      process.stderr.write("conductor: --done and --wont-do are mutually exclusive — a story either shipped or it did not\n");
      process.exit(1);
    }
    storyMutation = asked[0];
    // The reason is validated BEFORE the range check reads state, so a valueless `--wont-do`
    // (which parseFlags yields as boolean `true`) is refused by its own rule and never falls
    // through str() into an exit-0-write-nothing.
    if (storyMutation === "wont-do") {
      const err = storyDispositionError({ state: "wont-do", reason: typeof wontDo === "string" ? wontDo : "" });
      if (err) { process.stderr.write(`conductor: ${err}\n`); process.exit(1); }
    }
    const n = Number(f.story);
    const stories = Array.isArray(epic.stories) ? epic.stories : [];
    if (!Number.isInteger(n) || n < 1 || n > stories.length) {
      process.stderr.write(`conductor: --story ${f.story} is out of range — '${id}' has ${stories.length} stor${stories.length === 1 ? "y" : "ies"} (1-indexed)\n`);
      process.exit(1);
    }
    storyIndex = n - 1;
    // The REPLACEMENT RULE, one level down from archiveGate()'s refusal to overwrite an
    // agent-recorded epic disposition, and for the same reason: a recorded terminal judgment is
    // somebody's decision and this verb does not silently destroy it. Correcting a mistaken
    // story disposition is deliberately not something this command does.
    const target = stories[storyIndex];
    if (isStoryDisposed(target)) {
      process.stderr.write(
        `conductor: story ${n} of '${id}' already carries a recorded disposition ` +
        `('${target.disposition.state}': ${target.disposition.reason}). Replacing it would ` +
        "destroy a judgment somebody made.\n");
      process.exit(1);
    }
    if (storyMutation === "wont-do" && target.done) {
      process.stderr.write(`conductor: story ${n} of '${id}' is already done — work that shipped cannot be dropped\n`);
      process.exit(1);
    }
  } else if (f.done === true) {
    process.stderr.write("conductor: --done requires --story <n>\n"); process.exit(1);
  } else if (wontDo !== undefined) {
    process.stderr.write("conductor: --wont-do requires --story <n>\n"); process.exit(1);
  }

  // --attribute-commit <sha>: append, in the order given, the commits this epic's work landed
  // in. The last entry is the endpoint a recorded Gate 2 `headSha` is compared against, so the
  // ORDER is the meaning and the engine appends exactly what it is handed.
  const attributed = f["attribute-commit"] === undefined
    ? [] : [].concat(f["attribute-commit"]).filter(v => typeof v === "string" && v.trim());
  if (f["attribute-commit"] !== undefined && !attributed.length) {
    process.stderr.write("conductor: --attribute-commit requires a commit sha\n"); process.exit(1);
  }

  // The archive transition's conditions live in archive-gate.mjs, which every path that can
  // leave an epic at `archived` imports. They were inline here, which is precisely how they
  // came to bind this one path and none of the other four. The gate returns a refusal; this
  // command owns the exit code and the stderr, as it does for every other validation above.
  //
  // This command therefore holds NO lane test of its own. The one it used to hold compared
  // `epic.lane === "openspec"` strictly, so a lane-less epic — openspec-lane on every rendered
  // surface since resolveEpics() started normalizing it — slipped the gate entirely. The gate
  // now decides membership through constants.mjs's isOpenspecLane, the single predicate every
  // such site goes through.
  // The deferral assertion is BUILT here and validated by the gate: three flags, one record.
  // `--no-deferrals` makes "there are none" sayable, which is the whole point — an absence is
  // otherwise indistinguishable from never having looked.
  // FIRST-COLON, and it is correct for `--deferral` for one reason: its left half is an EPIC ID,
  // which cannot contain a colon. So `--deferral "t2:design.md § Deferred: the tricky part"`
  // splits where it must and the section keeps its colons. Verified before this was written.
  //
  // `::` IS ACCEPTED TOO (gh#179), and takes precedence where both appear. Deferral is ONE
  // concept spelled three ways across two verbs, and the two inline forms differed by a colon
  // with nothing at the call site to say why — so a caller arriving from `--declined-deferral`
  // guessed wrong and paid a full round trip, because the failure surfaces as a parse error and
  // not as a hint. Accepting the STRICTER separator everywhere is always safe: it can only make
  // an explicit split explicit, never move one. The reverse — teaching `--declined-deferral` to
  // accept a single colon between two free-text halves — is NOT safe and is not done; that is
  // the truncation its ambiguity refusal exists to prevent.
  const pairs = (raw, a, b) => [].concat(raw === undefined ? [] : raw)
    .filter(v => typeof v === "string")
    .map(v => {
      const explicit = v.indexOf("::");
      if (explicit !== -1) return { [a]: v.slice(0, explicit).trim(), [b]: v.slice(explicit + 2).trim() };
      const i = v.indexOf(":");
      return i === -1
        ? { [a]: v.trim(), [b]: "" } : { [a]: v.slice(0, i).trim(), [b]: v.slice(i + 1).trim() };
    });

  // `--declined-deferral "<what>:<why not>"` is the OTHER shape and cannot use the same rule:
  // BOTH halves are free text. First-colon truncates a <what> that carries one — measured in the
  // wild, "Set alwaysLoad:false to reclaim RAM:declined because X" recorded what="Set alwaysLoad",
  // which reads as an instruction to DO the thing being declined and rendered that way in
  // PROJECT.md. Last-colon is no better and is arguably worse: a reason is a sentence, so it
  // carries a colon more often than a short label does.
  //
  // There is no correct guess between two free-text halves, so this stops guessing. `::` is the
  // explicit separator; a single colon keeps working exactly as before; and a value that is
  // AMBIGUOUS — two or more colons with no `::` — is REFUSED. A refusal costs one re-run; the
  // silent truncation it replaces corrupted the record that dispositions exist to preserve, and
  // stayed live in a repo because its author correctly would not hand-edit state.json to fix it.
  const declinedPairs = (raw) => [].concat(raw === undefined ? [] : raw)
    .filter(v => typeof v === "string")
    .map(v => {
      const explicit = v.indexOf("::");
      if (explicit !== -1) {
        // FIRST `::`, so a reason may itself contain one.
        return { what: v.slice(0, explicit).trim(), reason: v.slice(explicit + 2).trim() };
      }
      const colons = (v.match(/:/g) || []).length;
      if (colons === 0) {
        process.stderr.write(
          `conductor: --declined-deferral "${v}" has no separator — it must read ` +
          `"<what>:<why not>", or "<what>::<why not>" where <what> itself contains a colon. ` +
          `The reason is what distinguishes a deliberate decline from work nobody considered, ` +
          `so it is not optional.\n`);
        process.exit(1);
      }
      if (colons > 1) {
        process.stderr.write(
          `conductor: --declined-deferral "${v}" is ambiguous — it carries ${colons} colons, so ` +
          `where <what> ends cannot be inferred. Separate the halves explicitly with "::":\n` +
          `  --declined-deferral "<what>::<why not>"\n` +
          `Splitting on the first colon here would silently truncate <what> and dump the rest ` +
          `into the reason, which is the corruption this refusal replaces.\n`);
        process.exit(1);
      }
      const i = v.indexOf(":");
      return { what: v.slice(0, i).trim(), reason: v.slice(i + 1).trim() };
    })
    // BOTH HALVES MUST BE NON-EMPTY. Gate 2: `":"` recorded {what:"", reason:""} and SATISFIED the
    // archive gate — a deferral assertion asserting literally nothing, which is the exact silence
    // archive-gate.mjs:208 exists to make impossible. `"x:"` and `"x::"` recorded a decline with no
    // reason, while the zero-colon refusal two lines up says the reason "is not optional". The
    // code disagreed with its own message.
    .map(pair => {
      if (!pair.what || !pair.reason) {
        process.stderr.write(
          `conductor: --declined-deferral needs BOTH halves non-empty — got ` +
          `what="${pair.what}", reason="${pair.reason}". What was declined, and why not: a blank ` +
          `half records a decline nobody can read, which is the silence this assertion removes.\n`);
        process.exit(1);
      }
      return pair;
    });
  // A deferral assertion is written ONLY inside the `status === "archived"` branch below, so
  // supplying these flags on any other invocation computed the assertion, dropped it, and printed
  // "updated" — reporting a write that did not happen, in the project's own record. Refuse
  // instead, and NAME the correction path, because it exists and was merely undiscoverable:
  // re-archiving with --correct-disposition does overwrite the assertion cleanly (verified before
  // this guard was written, which is why this is a refusal rather than a new mechanism).
  const supplied = ["deferral", "declined-deferral", "no-deferrals"]
    .filter(k => f[k] !== undefined);
  if (supplied.length && str(f.status) !== "archived") {
    process.stderr.write(
      `conductor: ${supplied.map(k => `--${k}`).join(", ")} ` +
      `${supplied.length === 1 ? "is" : "are"} recorded only when an epic is ARCHIVED, and this ` +
      `invocation does not archive '${id}' — nothing would have been written.\n` +
      `  To record one: add --status archived --outcome <outcome> --reason "<why>".\n` +
      `  To CORRECT one already recorded: re-run the archive with ` +
      `--correct-disposition "<why the recorded one was wrong>" alongside the corrected flags.\n`);
    process.exit(1);
  }

  const asserted = f.deferral !== undefined || f["declined-deferral"] !== undefined || f["no-deferrals"] === true
    ? deferralAssertion({
        deferrals: pairs(f.deferral, "epic", "section"),
        declined: declinedPairs(f["declined-deferral"]),
      })
    : undefined;

  // `--correct-disposition "<why the recorded one was wrong>"`: the ONE way past the refusal
  // that protects an agent-recorded disposition (#130). Two refusals before any write, both
  // #79's shape:
  //   1. VALUELESS — parseFlags yields boolean `true`, str() drops it, and the correction would
  //      be silently downgraded to an ordinary (refused) archive with a confusing message.
  //   2. UNREACHABLE — the whole disposition block below sits inside `status === "archived"`,
  //      so `--correct-disposition` alone parses, writes nothing, exits 0 and prints "updated".
  //      Diagnosed by name rather than dropped.
  const correction = str(f["correct-disposition"]);
  if (f["correct-disposition"] !== undefined) {
    if (correction === undefined) {
      process.stderr.write(
        "conductor: --correct-disposition requires a reason saying why the recorded disposition " +
        "was wrong — it is kept on the record beside the one it supersedes\n");
      process.exit(1);
    }
    if (status !== "archived") {
      process.stderr.write(
        "conductor: --correct-disposition corrects a recorded disposition, which only happens " +
        "at the archive transition — pass --status archived together with the --outcome (and " +
        "--reason) you meant to record. Nothing was written.\n");
      process.exit(1);
    }
  }

  // ANNOUNCEMENTS OF A WRITE are buffered, never printed where the write happens. The archive
  // gate runs AFTER every field write below (it must decide on the record this call leaves), so
  // a line printed at the write would announce a cleared rank, parent or tombstone on a call the
  // gate then refuses — a report of a change that did not happen. Flushed only once every
  // refusal has had its turn, immediately before saveState().
  const announcements = [];

  // #166 — withdraw an attribution. Runs BEFORE the field writes below so a refusal leaves the
  // epic untouched, the same ordering every other guard in this file uses.
  if (f["withdraw-commit"] !== undefined) {
    const shas = [].concat(f["withdraw-commit"]).filter(v => typeof v === "string");
    // ITS OWN reason flag. `--reason` serves the DISPOSITION, and Gate 2 confirmed that borrowing
    // it made a withdrawal's reason become the reason the epic was delivered.
    const why = str(f["withdrawal-reason"]);
    if (!why) {
      process.stderr.write(
        `conductor: --withdraw-commit requires --withdrawal-reason "<why>" — a withdrawal is a ` +
        `correction, and a correction without its reason is indistinguishable from a deletion. ` +
        `(--reason is the DISPOSITION's, and is not reused here.)\n`);
      process.exit(1);
    }
    // CONTRADICTORY IN ONE INVOCATION. Attribution appends further down, so attributing and
    // withdrawing the same sha in one call left it in BOTH arrays and reported success.
    const alsoAttributed = [].concat(f["attribute-commit"] === undefined ? [] : f["attribute-commit"])
      .filter(v => typeof v === "string" && shas.includes(v));
    if (alsoAttributed.length) {
      process.stderr.write(
        `conductor: cannot attribute and withdraw ${alsoAttributed.join(", ")} in one ` +
        `invocation — the two record contradictory things about the same commit.\n`);
      process.exit(1);
    }
    const attributed = Array.isArray(epic.attributedCommits) ? epic.attributedCommits.slice() : [];
    const missing = shas.filter(sha => !attributed.includes(sha));
    if (missing.length) {
      process.stderr.write(
        `conductor: '${id}' never attributed ${missing.join(", ")} — nothing to withdraw. ` +
        `It currently attributes: ${attributed.length ? attributed.join(", ") : "(none)"}.\n`);
      process.exit(1);
    }
    // ONE OCCURRENCE PER REQUEST. The array does not de-duplicate, so a sha can appear twice;
    // filtering removed EVERY copy for a single request, deleting two entries and moving the
    // endpoint a Gate 2 headSha is compared against. Removing the LAST occurrence means the
    // endpoint moves only when the endpoint itself is what you withdrew.
    for (const sha of shas) {
      const at = attributed.lastIndexOf(sha);
      if (at !== -1) attributed.splice(at, 1);
    }
    epic.attributedCommits = attributed;
    epic.withdrawnCommits = (epic.withdrawnCommits || []).concat(
      shas.map(sha => ({ sha, reason: why, withdrawnAt: new Date().toISOString() })));
  }

  if (str(f.title) !== undefined) epic.title = str(f.title);
  if (str(f["external-id"]) !== undefined) epic.externalId = str(f["external-id"]);
  if (str(f["external-url"]) !== undefined) epic.externalUrl = str(f["external-url"]);
  if (str(f["external-updated-at"]) !== undefined) epic.externalUpdatedAt = str(f["external-updated-at"]);
  if (parent !== undefined) epic.parent = parent;
  if (status !== undefined) epic.status = status;
  // In-place field writes: the epic keeps its position in `state.epics[]`, its startedAt, its
  // gate verdicts, its links and its stories. Re-routing an epic must cost none of those — that
  // it used to is the whole reason remove-and-re-register was the only correction available.
  if (lane !== undefined) epic.lane = lane;
  if (planPath !== undefined) epic.planPath = planPath;
  if (specPath !== undefined) epic.specPath = specPath;
  // The ONE claim site outside pushEpic(): every other way an epic comes to hold a source
  // artifact is a creation, and creation routes through that sink. Attaching an artifact says
  // it is real work, so any sync-ignore tombstone saying it is not must go — the record must
  // not hold two opposite claims about one file, and this is the un-ignore path (derived from
  // an action the operator already takes, rather than a new verb nobody would find).
  for (const p of claimArtifacts(state, epic)) {
    announcements.push(`conductor: cleared the sync-ignore tombstone on '${p}' — \`${epic.id}\` now claims it\n`);
  }
  // A manual `rank` is a placement among ONE band's peers, so it does not survive a move to
  // another band — it would collide with that band's own 1..N numbering, and the number would
  // claim a position nobody chose in a set nobody compared. Cleared on a REAL band change only:
  // re-stating the priority an epic already has changes nothing and must not silently discard a
  // deliberate order. Announced on stderr rather than done silently — this is the one place
  // anything but `reorder` touches the field, and an unannounced clear is indistinguishable
  // from the rank never having been set. See lib/rank.mjs for the invariant.
  const newPriority = str(f.priority);
  if (newPriority !== undefined) {
    if (newPriority !== epic.priority && epic.rank !== undefined) {
      announcements.push(`conductor: cleared \`${epic.id}\`'s rank (${epic.rank}) — it was a ` +
        `placement among ${epic.priority} epics, and this moves it to ${newPriority}. ` +
        `Re-run \`reorder\` on the ${newPriority} band to place it.\n`);
      delete epic.rank;
    }
    epic.priority = newPriority;
  }
  // CLEAR then SUPPLY, in that order and in ONE write — which is what makes `--clear-links
  // --link a --link b` the atomic replace the repair needs. Supplying alone appends; clearing
  // alone empties; together they replace.
  if (clearedLinks) epic.links = [];
  // IDENTITY IS type + target, and the rule lives in mergeLinks() (links.mjs) rather than here:
  // it binds every write surface, and implemented at this one it reached neither `add-epic` nor
  // `add-many`.
  if (suppliedLinks !== undefined) epic.links = mergeLinks(epic.links, suppliedLinks);
  if (reviewMode !== undefined) epic.reviewMode = reviewMode;
  if (attributed.length) {
    if (!Array.isArray(epic.attributedCommits)) epic.attributedCommits = [];
    epic.attributedCommits.push(...attributed.map(v => v.trim()));
  }
  // `--description` REPLACES (durable rationale, one value); `--notes` APPENDS (an activity
  // trail). Writing either never touches the other, and an earlier note is never rewritten or
  // dropped — the two readings are both wanted, so neither may be collapsed into the other.
  if (description !== undefined) epic.description = description;
  if (note !== undefined) {
    if (!Array.isArray(epic.notes)) epic.notes = [];
    epic.notes.push(noteEntry(note));
  }
  if (addedStories.length) {
    if (!Array.isArray(epic.stories)) epic.stories = [];
    epic.stories.push(...addedStories);
  }
  if (storyIndex !== undefined) {
    // The ROW SURVIVES in both branches. Deletion is never the answer to "this will not be
    // done": removing it destroys the record that the work was ever projected, which is exactly
    // the history an archived epic's reader needs.
    if (storyMutation === "done") epic.stories[storyIndex].done = true;
    else epic.stories[storyIndex].disposition = storyDisposition({ state: "wont-do", reason: wontDo });
  }

  // The unsets. AFTER every field write above, and it costs nothing that they cannot collide:
  // setting and clearing the same field in one invocation was refused before loadState().
  // `delete`, never `= undefined` — an undefined value is not an absent key, and absence is the
  // legal state the nullable declaration is about. It is also the exact shape the dangling-
  // reference sweep already uses for this field (`epicReferences()` in links.mjs drops a parent
  // with `delete e.parent`), so clearing does not invent a second removal.
  //
  // ANNOUNCED where the row says removal costs something beyond the field. Two of them hold or
  // key on ANOTHER RECORD — `parent` is an epic id, `externalUrl` is the sync procedure's dedup
  // key — and a cross-record pointer disappearing silently is the DATA half of the call-site
  // sweep. Same precedent as the rank clear and the archived-claim clear just below: the write
  // happens, and the consequence is said out loud rather than discovered later.
  for (const row of clearedRows) {
    const had = row.key in epic;
    delete epic[row.key];
    if (had && row.clearNote) {
      announcements.push(`conductor: cleared \`${id}\`'s ${row.flag} — ${row.clearNote}\n`);
    }
  }

  // THE ARCHIVE GATE RUNS HERE, after every field write and unset above, so it decides on the
  // record this invocation LEAVES. It used to run before them, and one call could therefore
  // archive a record the gate refuses (`--lane openspec --status archived` on a claude-code epic
  // with no Gate 2; an `--attribute-commit` the verdict does not cover; an `--add-story`; a
  // `--withdraw-commit`) and refuse one it accepts (`--story 1 --done --status archived` on the
  // last outstanding story). Nothing between here and saveState() reads what it decides on: the
  // completedAt stamp, the claim clear and the active-pointer sync all run after it. Every
  // refusal still exits before saveState(), so a refused call writes nothing.
  //
  // Note `status === "archived"`, not "the status CHANGED to archived": an epic already at
  // `archived` runs the full gate again on this invocation and records the disposition the
  // agent supplies. Re-archiving is an established shape here — `completedAt` below is already
  // guarded on `!epic.completedAt` precisely because this verb can be run twice — and it is
  // the only moment the documented `/opsx:archive` -> heal -> record flow can say `delivered`.
  if (status === "archived") {
    const verdict = archiveGate(epic, {
      outcome: str(f.outcome), reason: str(f.reason),
      carriedTo: str(f["carried-to"]), deferralAssertion: asserted, correction,
    });
    if (!verdict.ok) { process.stderr.write(`conductor: ${verdict.message}\n`); process.exit(1); }
    // The gate BUILDS the record and this command writes it, so the disposition an epic ends
    // with is the one the gate validated — there is no second construction site to drift.
    if (verdict.disposition) epic.disposition = verdict.disposition;
    if (verdict.deferralAssertion) epic.deferralAssertion = verdict.deferralAssertion;
  }

  // Every refusal has now had its turn: the write is going to happen, so say what it cleared.
  for (const line of announcements) process.stderr.write(line);

  // Stamp completedAt the moment an epic transitions TO archived (not merely re-saved
  // while already archived) — supports velocity tracking off startedAt/completedAt.
  if (status === "archived" && !epic.completedAt) epic.completedAt = new Date().toISOString();

  // #84 — an ARCHIVED epic cannot still be OWNED. The claim is an advisory "I am working on
  // this"; the work has ended, so leaving it behind is the dangling-reference shape the DATA
  // half of the call-site sweep names, and it would show in `owners` as live ownership of
  // finished work forever. CLEARED here rather than REFUSED: refusing to archive because a
  // marker was left set is pm refusing to work over an advisory signal, which is the one thing
  // #84 rules out. `claim` refuses at the other end — you cannot claim an archived epic — so the
  // two directions close the loop without either of them blocking real work.
  //
  // The sibling removal sites, enumerated mechanically (`rg -n '\.claim' scripts/lib/`): the
  // holder's own `unclaim` (claims.mjs), and `remove-epic`, which needs no edit because the
  // claim is nested INSIDE the epic object and leaves with it. A detour PUSH/POP deliberately
  // does not clear it — parking an epic does not change who owns it, and the owner is exactly
  // who resumes it.
  if (status === "archived" && epic.claim) {
    process.stderr.write(
      `conductor: cleared the advisory claim held by '${epic.claim.session}' — '${id}' has ended\n`);
    delete epic.claim;
  }

  // Keep .active consistent with status — the two must never disagree.
  if (epic.status === "active") activate(state, id);
  else if (state.active === id) state.active = null;

  // The save's OWN answer to "did anything change", kept rather than discarded. saveState()
  // compares the whole body against disk and short-circuits a no-op; this command threw that
  // away and printed success unconditionally, which is why a same-valued --title, --status or
  // --priority ALREADY reported a write that did not happen. The rule binds the WRITE SURFACE
  // and not the two paths this change adds — a no-op link supply and a no-op clear are
  // INSTANCES of it, not its scope.
  const saved = saveState(state);
  render();

  // The success message is printed only after the record on disk is READ BACK and confirmed to
  // hold what this invocation claims to have written. Everything above verifies its own write;
  // this verifies the COMMAND, after render() has had its turn at the file too.
  if (attributed.length) {
    const wrote = attributed.map(v => v.trim());
    const missing = missingAttributions(loadState(), id, wrote);
    if (missing.length) {
      process.stderr.write(
        `conductor: --attribute-commit wrote ${wrote.join(", ")} to '${id}' and ` +
        `${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} NOT in .conductor/state.json ` +
        "afterwards. NOTHING has been recorded for those commits — do not treat this epic's " +
        "attribution as current. Re-run the attribution, then verify with `git show` against the " +
        "COMMIT rather than against the working tree.\n");
      process.exit(1);
    }
  }
  // I4 — the REMOVAL gets the same read-back the append has, and for the same reason: render()
  // writes the file again after saveState(), so a removal is exactly as vulnerable to being
  // silently undone as an append (#140's mechanism). Reporting a withdrawal that did not land
  // would be the false-write class this whole release is about, in the verb that fixes it.
  if (f["withdraw-commit"] !== undefined) {
    const asked = [].concat(f["withdraw-commit"]).filter(v => typeof v === "string");
    const after = loadState().epics.find(e => e.id === id);
    const stillThere = asked.filter(sha =>
      (after && Array.isArray(after.withdrawnCommits) ? after.withdrawnCommits : [])
        .every(w => w.sha !== sha));
    if (stillThere.length) {
      process.stderr.write(
        `conductor: --withdraw-commit did NOT land for ${stillThere.join(", ")} on '${id}' — ` +
        ".conductor/state.json holds no withdrawal record for them afterwards. Do not treat " +
        "this epic's attribution as corrected; re-run the withdrawal.\n");
      process.exit(1);
    }
  }
  // NOT an error, and not a success line either. The record is correct and nothing failed —
  // refusing would be wrong — but "updated" tells a reader something happened when nothing did.
  // Routed through the SHARED reporter rather than kept as this verb's own if/else: the rule
  // binds the write surface, and a rule implemented once at the verb that introduced it is how
  // twenty siblings came to print success on a save that wrote nothing.
  reportSave(saved, {
    changed: `conductor: updated '${id}'`,
    unchanged: `conductor: nothing changed on '${id}' — every value this invocation supplied is ` +
      "already the value the record holds. Nothing was written.",
  });
}
