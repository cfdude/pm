// scripts/test/unit/conductor-16.test.mjs
// 4.1's migration of `assert/conductor-16.test.mjs` — the 23 VALUE-OBSERVING tests, moved from the
// file rung to the unit rung with every assertion unchanged.
//
// conductor-tells-the-truth, groups 14–15: release planning (#125's minimum slice) and the
// gate procedure pm EMITS. Split from conductor-13/14/15 for the same reason those were split
// from each other — one file per wave keeps each one's fixtures readable.
//
// Every assertion in group 15 is made against the RENDERED text (`rules`, `brief`, the shipped
// markdown), never against the generator's source. A test that greps `rules.mjs` passes for a
// line that is emitted on no reachable branch, which is the failure the emitted-procedure
// requirements exist to prevent.
//
// ─────────────── WHAT MOVED, AND WHAT DID NOT ───────────────
//
// Group 14 moved WHOLE. Every one of its questions is asked of the RECORD — "what is in this
// release", "is this epic still in the backlog", "what does the deferred list say" — and the two
// rendered surfaces it checks are store-owned artifacts: `projectMd(cwd)` becomes
// `engine.store.read("PROJECT.md").text` and `parseBrief(cwd)` becomes the `brief` verb's own
// stdout, parsed the same way. `render` is exercised here too, and it writes only PROJECT.md and
// the render stamp, both of which the memory store holds.
//
// Group 15 SPLIT, on the question 4.1 asks of every test — is the observable the TEXT pm emitted,
// or a FILE pm ships? The ten tests that read a shipped document (`skills/conductor/SKILL.md`,
// `commands/epic.md`, `commands/status.md`, `commands/feedback.md`, or every `commands/*.md`) stay
// on the file rung: those are repository files, `shipped()` reads them with `readFileSync`, and a
// document mirror is a source-shape subject by construction. The eight that assert on
// `rules`/`brief` OUTPUT moved — including the one that EXECUTES a command the block emits, which
// is a value derived from the text and then run.
//
// The mechanism that changed:
//
//   `tmpRepo()` + `run(["init"], { cwd })`  →  `memoryEngine(emptyRecord())`
//   `run(args, { cwd })`                    →  `engine(args)`
//   `runCombined(args, { cwd })`            →  `engine.combined(args)`
//   `readState(cwd)`                        →  `engine.store.record()`
//   `projectMd(cwd)`                        →  `engine.store.read("PROJECT.md").text`
//   `parseBrief(cwd)`                       →  `JSON.parse(engine(["brief"])).hookSpecificOutput.additionalContext`

import assert from "node:assert/strict";
import { emptyRecord, expectFail, memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";
import { GATE_PROCEDURE_ITEMS } from "../../lib/rules.mjs";
import { AGENT_OUTCOMES } from "../../lib/archive-gate.mjs";
import { KNOWN_PLATFORMS } from "../../lib/constants.mjs";

/** An initialized conductor with `n` superpowers-lane epics, so nothing depends on a change on
 *  disk. Returns the engine. */
function repoWithEpics(n) {
  const engine = memoryEngine(emptyRecord());
  for (let i = 0; i < n; i++) {
    engine(["add-epic", "--id", `e${i}`, "--title", `epic ${i}`, "--lane", "superpowers",
      "--priority", "P2", "--status", "queued"]);
  }
  return engine;
}
const readState = (engine) => engine.store.record();
const projectMd = (engine) => engine.store.read("PROJECT.md").text;
const parseBrief = (engine) =>
  JSON.parse(engine(["brief"])).hookSpecificOutput.additionalContext;

// ─────────────────── 14.1: a release is a first-class object ───────────────────
//
// The question this answers is "what is in this release", asked of `state.json` and of nothing
// else. Membership is recorded ONE-WAY on the epic (`epic.release`), so a member list on the
// release and a pointer on the epic can never disagree — there is only one of them.

unitTest("14.1 a release is a first-class object and its membership is answerable from state.json alone", () => {
  const engine = repoWithEpics(3);
  engine(["release", "0.27.0", "--intent", "conductor tells the truth", "--target", "2026-09-01"]);
  engine(["release", "0.27.0", "--member", "e0", "--member", "e1"]);

  const st = readState(engine);
  assert.equal(st.releases.length, 1);
  const rel = st.releases[0];
  assert.equal(rel.id, "0.27.0");
  assert.equal(rel.intent, "conductor tells the truth");
  assert.equal(rel.target, "2026-09-01");
  assert.deepEqual(rel.deferred, []);
  // Membership lives on the epic, and on the epic only — the release object carries no member
  // list to fall out of step with it.
  assert.equal(rel.members, undefined);
  const by = Object.fromEntries(st.epics.map(e => [e.id, e]));
  assert.equal(by.e0.release, "0.27.0");
  assert.equal(by.e1.release, "0.27.0");
  assert.equal(by.e2.release, undefined);
});

unitTest("14.1 an epic is associable with at most one release — a second association MOVES it", () => {
  const engine = repoWithEpics(1);
  engine(["release", "0.27.0", "--intent", "this one"]);
  engine(["release", "0.28.0", "--intent", "the next one"]);
  engine(["release", "0.27.0", "--member", "e0"]);
  engine(["release", "0.28.0", "--member", "e0"]);

  const st = readState(engine);
  const e0 = st.epics.find(e => e.id === "e0");
  assert.equal(e0.release, "0.28.0");
  assert.equal(typeof e0.release, "string");   // never an array of releases
});

unitTest("14.1 the engine proposes no membership — adding, re-prioritizing and archiving change none", () => {
  const engine = repoWithEpics(2);
  engine(["release", "0.27.0", "--intent", "conductor tells the truth"]);
  engine(["release", "0.27.0", "--member", "e0"]);

  engine(["add-epic", "--id", "later-one", "--title", "registered after the release existed",
    "--lane", "superpowers", "--priority", "P1", "--status", "queued"]);
  engine(["update-epic", "e1", "--priority", "P0"]);
  engine(["update-epic", "e1", "--status", "archived", "--outcome", "killed",
    "--reason", "not doing it", "--no-deferrals"]);

  const st = readState(engine);
  const membership = Object.fromEntries(st.epics.map(e => [e.id, e.release]));
  assert.deepEqual(membership, { e0: "0.27.0", e1: undefined, "later-one": undefined });
});

unitTest("14.1 re-stating a release updates it in place rather than registering a second one", () => {
  const engine = repoWithEpics(1);
  engine(["release", "0.27.0", "--intent", "first wording"]);
  engine(["release", "0.27.0", "--intent", "the wording that survived"]);
  const st = readState(engine);
  assert.equal(st.releases.length, 1);
  assert.equal(st.releases[0].intent, "the wording that survived");
});

unitTest("14.1 the release verb refuses what it cannot record, and writes nothing", () => {
  const engine = repoWithEpics(1);
  // No intent on a release that does not exist yet: intent prose is what makes a release
  // legible later, and a release created without it is an id nobody can read.
  const noIntent = expectFail(() => engine(["release", "0.27.0"]));
  assert.match(noIntent.stderr, /--intent/);
  assert.equal(readState(engine).releases, undefined);

  engine(["release", "0.27.0", "--intent", "conductor tells the truth"]);
  const unknownEpic = expectFail(() => engine(["release", "0.27.0", "--member", "nope"]));
  assert.match(unknownEpic.stderr, /'nope' is not a known epic id/);
  const noRelease = expectFail(() => engine(["release", "9.9.9", "--member", "e0"]));
  assert.match(noRelease.stderr, /9\.9\.9/);
  assert.equal(readState(engine).epics[0].release, undefined);
});

// ─────────────────── 14.2: an exclusion is a reason-bearing record ───────────────────
//
// The FOURTH scope of the one disposition record, not a parallel shape: the same required-reason
// rule, recorded against the epic/release pair. An exclusion is a scoping call about THIS
// release and never an ending — the epic stays in the backlog, carrying no disposition of its
// own, because it is still work someone may do.

unitTest("14.2 a deferral reason is stored against the epic/release pair and survives what happens next", () => {
  const engine = repoWithEpics(3);
  engine(["release", "0.27.0", "--intent", "conductor tells the truth"]);
  engine(["release", "0.27.0", "--member", "e0"]);
  engine(["release", "0.27.0", "--defer", "e1",
    "--reason", "depends on #133 landing and on a progress signal this release is still changing"]);

  const rel = readState(engine).releases[0];
  assert.equal(rel.deferred.length, 1);
  assert.equal(rel.deferred[0].epic, "e1");
  assert.match(rel.deferred[0].reason, /depends on #133 landing/);
  assert.match(rel.deferred[0].recordedAt, /^\d{4}-\d{2}-\d{2}T/);

  // Everything that happens after the call was made: the release is superseded by the next one,
  // the excluded epic is archived elsewhere, the record is re-saved several times over. The
  // reason is still there — that is the whole point of recording it outside a transcript.
  engine(["release", "0.28.0", "--intent", "the one after"]);
  engine(["update-epic", "e1", "--status", "archived", "--outcome", "delivered", "--no-deferrals"]);
  engine(["render"]);
  const after = readState(engine).releases.find(r => r.id === "0.27.0");
  assert.deepEqual(after.deferred, rel.deferred);
});

unitTest("14.2 an exclusion leaves the epic in the backlog rather than ending it", () => {
  const engine = repoWithEpics(2);
  engine(["release", "0.27.0", "--intent", "conductor tells the truth"]);
  engine(["release", "0.27.0", "--member", "e0"]);
  engine(["release", "0.27.0", "--defer", "e0", "--reason", "cut for scope"]);

  const st = readState(engine);
  const e0 = st.epics.find(e => e.id === "e0");
  assert.equal(e0.status, "queued");            // still backlog, not ended
  assert.equal(e0.disposition, undefined);      // an exclusion is not a terminal disposition
  assert.equal(e0.release, undefined);          // and it is no longer a member of that release
  assert.equal(st.releases[0].deferred[0].epic, "e0");
});

unitTest("14.2 an epic nobody considered is NEITHER in the release nor deferred from it", () => {
  const engine = repoWithEpics(3);
  engine(["release", "0.27.0", "--intent", "conductor tells the truth"]);
  engine(["release", "0.27.0", "--member", "e0"]);
  engine(["release", "0.27.0", "--defer", "e1", "--reason", "cut for scope"]);

  const st = readState(engine);
  const e2 = st.epics.find(e => e.id === "e2");
  assert.equal(e2.status, "queued");
  assert.equal(e2.release, undefined);
  assert.equal(st.releases[0].deferred.some(d => d.epic === "e2"), false);
});

unitTest("14.2 a deferral with no reason is refused and nothing is written", () => {
  const engine = repoWithEpics(1);
  engine(["release", "0.27.0", "--intent", "conductor tells the truth"]);
  // Asserted as the REFUSAL, not merely as a non-zero exit mentioning the word "reason": with
  // the rule disabled, the verb crashes on `reason.trim()` and node prints the offending source
  // line, which contains the word too. A crash is not a refusal, so the message is named and a
  // TypeError is explicitly excluded.
  const err = expectFail(() => engine(["release", "0.27.0", "--defer", "e0"]));
  assert.match(err.stderr, /requires a non-empty reason/);
  assert.doesNotMatch(err.stderr, /TypeError/);
  assert.deepEqual(readState(engine).releases[0].deferred, []);
  // A valueless --reason is the same silence with a flag in front of it.
  const blank = expectFail(() => engine(["release", "0.27.0", "--defer", "e0", "--reason"]));
  assert.match(blank.stderr, /requires a non-empty reason/);
  assert.doesNotMatch(blank.stderr, /TypeError/);
  assert.deepEqual(readState(engine).releases[0].deferred, []);
});

unitTest("14.2 re-deferring the same epic updates the reason rather than recording it twice", () => {
  const engine = repoWithEpics(1);
  engine(["release", "0.27.0", "--intent", "conductor tells the truth"]);
  engine(["release", "0.27.0", "--defer", "e0", "--reason", "first reading"]);
  engine(["release", "0.27.0", "--defer", "e0", "--reason", "the reason that survived"]);
  const rel = readState(engine).releases[0];
  assert.equal(rel.deferred.length, 1);
  assert.equal(rel.deferred[0].reason, "the reason that survived");
});

unitTest("14.2 re-including a deferred epic removes the record and SAYS so — never silently", () => {
  const engine = repoWithEpics(1);
  engine(["release", "0.27.0", "--intent", "conductor tells the truth"]);
  engine(["release", "0.27.0", "--defer", "e0", "--reason", "cut on Tuesday"]);
  const out = engine.combined(["release", "0.27.0", "--member", "e0"]);
  assert.match(out, /cut on Tuesday/);
  const st = readState(engine);
  assert.deepEqual(st.releases[0].deferred, []);
  assert.equal(st.epics[0].release, "0.27.0");
});

// ─────────────────── 14.3: a release renders on both surfaces ───────────────────
//
// One computation (releaseSummaries) feeding two renderers, exactly as gateSummary() feeds the
// gate-review table and the brief's GATE REVIEWS block: PROJECT.md and the briefing cannot
// report different counts for the same release, because there is only one count.

unitTest("14.3 a release with 12 members and 3 deferrals renders the same counts on both surfaces", () => {
  const engine = repoWithEpics(15);
  engine(["release", "0.27.0", "--intent", "conductor tells the truth"]);
  for (let i = 0; i < 12; i++) engine(["release", "0.27.0", "--member", `e${i}`]);
  const reasons = {
    e12: "depends on #133 landing first",
    e13: "depends on a progress signal this same release is still changing",
    e14: "no design agreed yet — a guess would be worse than an omission",
  };
  for (const [epic, reason] of Object.entries(reasons)) {
    engine(["release", "0.27.0", "--defer", epic, "--reason", reason]);
  }
  engine(["render"]);

  assert.match(projectMd(engine), /`0\.27\.0`: 12 epics, 3 deferred/);
  assert.match(parseBrief(engine), /`0\.27\.0`: 12 epics, 3 deferred/);

  // The reasons read back from the record itself — not from the surface, and not from the
  // session that made the call.
  const rel = readState(engine).releases[0];
  assert.deepEqual(Object.fromEntries(rel.deferred.map(d => [d.epic, d.reason])), reasons);
});

unitTest("14.3 a release with no members and no exclusions still renders, and the singular is right", () => {
  const engine = repoWithEpics(1);
  engine(["release", "0.27.0", "--intent", "conductor tells the truth"]);
  engine(["render"]);
  assert.match(projectMd(engine), /`0\.27\.0`: 0 epics, 0 deferred/);
  engine(["release", "0.27.0", "--member", "e0"]);
  engine(["render"]);
  assert.match(projectMd(engine), /`0\.27\.0`: 1 epic, 0 deferred/);
  assert.match(parseBrief(engine), /`0\.27\.0`: 1 epic, 0 deferred/);
});

unitTest("14.3 a repo with no releases renders no release section on either surface", () => {
  const engine = repoWithEpics(1);
  engine(["render"]);
  assert.doesNotMatch(projectMd(engine), /## Releases/);
  assert.doesNotMatch(parseBrief(engine), /RELEASES/);
});

unitTest("14.3 each deferral's reason is reachable from the rendered record, not only from state.json", () => {
  const engine = repoWithEpics(2);
  engine(["release", "0.27.0", "--intent", "conductor tells the truth"]);
  engine(["release", "0.27.0", "--defer", "e1", "--reason", "depends on #133 landing first"]);
  engine(["render"]);
  const md = projectMd(engine);
  assert.match(md, /depends on #133 landing first/);
  assert.match(md, /`e1`/);
});

// ═══════════════ group 15: the gate procedure pm EMITS (instruction layer) ═══════════════
//
// pm is an instruction layer, so the emitted text IS the product and a defect in it is a
// product defect. These bind the text pm OWNS — the managed rules block, the `conductor` skill,
// and the command docs — because a change's own `tasks.md` is authored by the `openspec`
// plugin, which pm neither owns nor writes.
//
// FORM is asserted, not just content. The measurement this release was built on: a rule carried
// by a mandatory task section reached 14/14 adoption across subsequent changes in the audited
// corpus; the same rule as a prose bullet reached 3/15. So every assertion below checks the item
// is NUMBERED and REQUIRED, and fails if it is downgraded to a bullet.
//
// THE TEN TESTS THAT READ A SHIPPED DOCUMENT STAY ON THE FILE RUNG. `shipped()` is a
// `readFileSync` of `skills/conductor/SKILL.md` or `commands/*.md`: those mirrors are repository
// files the store does not own, they are read from the test's own frame, and comparing a doc's
// prose to the generator is a source-shape subject. What is here is what `rules` and `brief`
// PRINT.

const GATE_PROCEDURE_HEADING = "## The gate procedure — required task items";
const rulesText = (engine, ...extra) => engine(["rules", ...extra]);

/** Every numbered item in the emitted text, as `<n>. <title>` — the FORM check. A bullet does
 *  not appear here, which is what makes "downgraded to a bullet" a failing test rather than a
 *  cosmetic difference. */
const numberedItems = (text) =>
  text.split("\n").filter(l => /^\d+\. /.test(l.trim())).map(l => l.trim());

unitTest("15.1 the emitted gate procedure carries the call-site sweep as a NUMBERED REQUIRED task item", () => {
  const engine = repoWithEpics(1);
  const block = rulesText(engine);
  assert.match(block, /## The gate procedure — required task items/);
  const items = numberedItems(block).join("\n");
  assert.match(items, /\*\*Call-site completeness sweep\.\*\*/);
  // The enumeration is named CONCRETELY — what to list, and what to say about each entry.
  assert.match(block, /enumerate ALL call sites/i);
  assert.match(block, /where the rule holds and where it does not/);
  assert.match(block, /justify each omission/);
  // Derived mechanically, never typed from memory: an enumeration that goes stale the moment a
  // caller is added is the defect, not the remedy.
  assert.match(block, /`rg`/);
  // Both gates are diff-scoped, so the unedited sibling site is invisible to them — the emitted
  // text has to say so, or the reader assumes the diff is the population.
  assert.match(block, /diff-scoped/);
  // NOT a prose bullet — 3/15 against 14/14 is the whole reason the form is asserted.
  assert.doesNotMatch(block, /^\s*[-*] \*\*Call-site completeness sweep/m);
});

unitTest("15.2 the emitted gate procedure verifies against the COMMIT and says the working tree does not count", () => {
  const engine = repoWithEpics(1);
  const block = rulesText(engine);
  const items = numberedItems(block).join("\n");
  assert.match(items, /\*\*Verify against the commit, not the working tree\.\*\*/);
  // The explicit statement, not merely an instruction to look at the commit: every layer that
  // missed the audited failure was reading the working tree and believed it was verifying.
  assert.match(block, /Reading a file in the working tree is NOT verification/);
  assert.match(block, /git show --stat/);
  // And the consequence, stated: a claimed file absent from its commit FAILS the task even
  // though the tree holds the edit and the suite is green.
  assert.match(block, /absent from its commit/);
  assert.doesNotMatch(block, /^\s*[-*] \*\*Verify against the commit/m);
});

// ─────────────────── 15.3: the lifecycle-marker obligation ───────────────────
//
// The engine infers lifecycle exclusion from NOTHING — the marker is agent-declared, one fixed
// literal on the task line. An obligation nobody is told about is a feature that is expressible
// and never exercised, so the literal token itself has to appear in the text pm emits, in the
// two places an agent actually reads: the rules block and the brief.

unitTest("15.3 the lifecycle-marker obligation names the literal token on both emitted surfaces", () => {
  const engine = repoWithEpics(1);
  for (const [surface, text] of [["rules block", rulesText(engine)], ["brief", parseBrief(engine)]]) {
    assert.match(text, /<!-- pm:lifecycle -->/, `the ${surface} must name the literal token`);
    // AUTHORED **or amended** — a source written before this capability existed never gets the
    // marker under an authoring-time-only rule, and those are exactly the sources whose archive
    // task is unmarked today.
    assert.match(text, /amend/i, `the ${surface} must cover amending an existing source`);
    // The always-qualifying case, named so it is not a judgment call.
    assert.match(text, /archives the change itself/i,
      `the ${surface} must name the self-referential archive task as always qualifying`);
  }
});

// ─────────────────── 15.5: no emitted surface offers removal as a way to END work ───────────────────
//
// Deletion removes the record of projected work, which is precisely what a disposition exists to
// preserve. The requirement binds the EMITTED TEXT, not the verb: `remove-epic` hard-deletes
// today and stays available and ungated for what it is for — an epic registered in error, a
// duplicate, a mistake made a minute ago — where there is no disposition to record because there
// was no work. The failure this closes is an agent reaching for deletion because the instructions
// it was handed offered it as a way to close something out.

unitTest("15.5 remove-epic still works, ungated, on an epic registered in error", () => {
  const engine = repoWithEpics(2);
  // No stories, no gate verdict, no disposition — an epic registered a minute ago by mistake.
  engine.combined(["remove-epic", "e1"]);
  const st = readState(engine);
  assert.deepEqual(st.epics.map(e => e.id), ["e0"]);
  // And nothing about it demanded a disposition on the way out: there was no work to preserve.
  assert.equal(st.epics[0].disposition, undefined);
});

// ─────── 15.6: item 5's emitted archive command runs exactly as written ───────
//
// "Every command pm emits must run as written" is this release's own standard (tracker-sync).
// Item 5 used to emit the disposition half ALONE, while the archive gate demands a deferral
// assertion in the SAME invocation — so an agent complying verbatim was refused and had to
// correct pm's own instruction to get past it. The refusal self-corrects, which is exactly why
// nothing caught it: the command was wrong and the outcome was still right.

unitTest("15.6 item 5's emitted archive command executes verbatim, with no flag left to discover", () => {
  const engine = repoWithEpics(1);
  const line = rulesText(engine).split("\n").find(l => l.includes("`update-epic <id> --status archived"));
  assert.ok(line, "the archive command must be emitted on ONE line inside ONE pair of backticks — " +
    "a command split across two lines cannot be copied and run");
  const cmd = line.slice(line.indexOf("`") + 1, line.lastIndexOf("`"));
  // Only the documented placeholders and the documented alternation are filled. Nothing is
  // added: whatever the block says is exactly what gets run.
  const argv = cmd
    .replace(/<id>/g, "e0")
    // DERIVED from the vocabulary, never re-typed: the emitted alternation grows whenever an
    // outcome is added (gh-112 added `declined`), and a literal here silently stops matching —
    // the alternation then survives into argv and the command fails on an unknown outcome.
    .replace(new RegExp(AGENT_OUTCOMES.join("\\|"), "g"), "delivered")
    .replace(/"<why>"/g, "shipped-in-full")
    .trim().split(/\s+/);
  engine(argv);                                        // exits 0 …
  const e0 = readState(engine).epics.find(e => e.id === "e0");
  assert.equal(e0.status, "archived");
  assert.equal(e0.disposition.outcome, "delivered");
  assert.deepEqual(e0.deferralAssertion.deferrals, [],
    "…and the deferral assertion the gate demands was carried by the same invocation");
});

// ───────── 15.7: item 1 also demands the INVERSE of every operation the change adds ─────────
//
// A call-site sweep enumerates the CALLERS of a thing that is written, and that enumeration
// never arrives at the question of whether the thing can be UNWRITTEN. So the sweep is blind to
// a whole class by construction, and six instances of it shipped past both gates here while the
// call-site obligation was already in force — the most consequential being pre-authorization
// grants that accumulate with no revoke.
//
// The assertions below slice the body of item 1 rather than searching the whole surface: an
// obligation appended to item 7, or dropped into a prose paragraph, would satisfy a whole-text
// grep while sitting outside the required task item the requirement names.

/** The lines belonging to numbered item `n` — its title line plus every continuation line up to
 *  the next numbered item. `numberedItems()` cannot do this: it keeps title lines only, so an
 *  obligation living in a BODY is invisible to it. */
const itemBody = (text, n, title) => {
  const lines = text.split("\n");
  const start = lines.findIndex(l => l.trim().startsWith(`${n}. **${title}**`));
  assert.ok(start !== -1, `no numbered item ${n}. **${title}** found`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex(l => /^\s*\d+\.\s+\*\*/.test(l));
  return [lines[start], ...(end === -1 ? rest : rest.slice(0, end))].join("\n");
};

const CALL_SITE_TITLE = "Call-site completeness sweep.";
/** Determiner-free, punctuation-stable fragments: the mirrors are deliberately reworded (they
 *  already say "the change" where the generator says "this change"), so a claim carrying a
 *  determiner passes the generator self-check and fails every mirror. */
const INVERSE_CLAIMS = [
  "set against unset, add against remove",
  "name and justify each inverse that is not shipped",
  "shipped without its inverse, and not justified, is a FINDING",
  "whether it can be unwritten",
];
const normClaim = (s) => s.replace(/[`*_]/g, "").replace(/\s+/g, " ").trim().toLowerCase();

unitTest("15.7 the rendered block carries the inverse-operation obligation INSIDE required task item 1", () => {
  const engine = repoWithEpics(1);
  const block = rulesText(engine);
  const body = normClaim(itemBody(block, 1, CALL_SITE_TITLE));
  for (const claim of INVERSE_CLAIMS) {
    assert.ok(body.includes(normClaim(claim)),
      `the rules block's item 1 is missing "${claim}" — the inverse obligation must live inside ` +
      "the numbered required task item, not in surrounding prose");
  }
  // FORM: still one numbered item, never downgraded to a bullet and never split into a nested
  // numbered sub-list, which would break the same-items-same-order guard at 15.4.
  assert.doesNotMatch(block, /^\s*[-*] \*\*Call-site completeness sweep/m);
  const continuations = itemBody(block, 1, CALL_SITE_TITLE).split("\n").slice(1);
  for (const l of continuations) {
    assert.doesNotMatch(l, /^\s*\d+\.\s/,
      `a continuation line of item 1 must not begin with a number: ${JSON.stringify(l)}`);
  }
});

unitTest("15.7 the inverse obligation is a DECLARED mustSay claim, not only text in `lines`", () => {
  const item = GATE_PROCEDURE_ITEMS[0];
  assert.equal(item.title, CALL_SITE_TITLE);
  const declared = item.mustSay.map(normClaim);
  for (const claim of INVERSE_CLAIMS) {
    assert.ok(declared.includes(normClaim(claim)),
      `"${claim}" is not declared in GATE_PROCEDURE_ITEMS[0].mustSay — the drift guard iterates ` +
      "mustSay ONLY, so an obligation added to `lines` alone leaves every mirror carrying the " +
      "older, narrower rule with the whole suite green");
  }
});

unitTest("15.7 the inverse obligation is emitted for every known platform, not just claude-code", () => {
  const engine = repoWithEpics(1);
  for (const platform of KNOWN_PLATFORMS) {
    const body = normClaim(itemBody(rulesText(engine, "--platform", platform), 1, CALL_SITE_TITLE));
    for (const claim of INVERSE_CLAIMS) {
      assert.ok(body.includes(normClaim(claim)),
        `the ${platform} rules block's item 1 is missing "${claim}"`);
    }
  }
});
