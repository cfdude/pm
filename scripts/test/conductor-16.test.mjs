import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRepo, run, runCombined, readState, projectMd, parseBrief, expectFail } from "./helpers.mjs";
import { GATE_PROCEDURE_ITEMS } from "../lib/rules.mjs";
import { AGENT_OUTCOMES } from "../lib/archive-gate.mjs";

// conductor-tells-the-truth, groups 14–15: release planning (#125's minimum slice) and the
// gate procedure pm EMITS. Split from conductor-13/14/15 for the same reason those were split
// from each other — one file per wave keeps each one's fixtures readable.
//
// Every assertion in group 15 is made against the RENDERED text (`rules`, `brief`, the shipped
// markdown), never against the generator's source. A test that greps `rules.mjs` passes for a
// line that is emitted on no reachable branch, which is the failure the emitted-procedure
// requirements exist to prevent.

/** An initialized repo with `n` superpowers-lane epics, so nothing depends on a change on
 *  disk. Returns the cwd. */
function repoWithEpics(n) {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  for (let i = 0; i < n; i++) {
    run(["add-epic", "--id", `e${i}`, "--title", `epic ${i}`, "--lane", "superpowers",
      "--priority", "P2", "--status", "queued"], { cwd });
  }
  return cwd;
}

// ─────────────────── 14.1: a release is a first-class object ───────────────────
//
// The question this answers is "what is in this release", asked of `state.json` and of nothing
// else. Membership is recorded ONE-WAY on the epic (`epic.release`), so a member list on the
// release and a pointer on the epic can never disagree — there is only one of them.

test("14.1 a release is a first-class object and its membership is answerable from state.json alone", () => {
  const cwd = repoWithEpics(3);
  run(["release", "0.27.0", "--intent", "conductor tells the truth", "--target", "2026-09-01"], { cwd });
  run(["release", "0.27.0", "--member", "e0", "--member", "e1"], { cwd });

  const st = readState(cwd);
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

test("14.1 an epic is associable with at most one release — a second association MOVES it", () => {
  const cwd = repoWithEpics(1);
  run(["release", "0.27.0", "--intent", "this one"], { cwd });
  run(["release", "0.28.0", "--intent", "the next one"], { cwd });
  run(["release", "0.27.0", "--member", "e0"], { cwd });
  run(["release", "0.28.0", "--member", "e0"], { cwd });

  const st = readState(cwd);
  const e0 = st.epics.find(e => e.id === "e0");
  assert.equal(e0.release, "0.28.0");
  assert.equal(typeof e0.release, "string");   // never an array of releases
});

test("14.1 the engine proposes no membership — adding, re-prioritizing and archiving change none", () => {
  const cwd = repoWithEpics(2);
  run(["release", "0.27.0", "--intent", "conductor tells the truth"], { cwd });
  run(["release", "0.27.0", "--member", "e0"], { cwd });

  run(["add-epic", "--id", "later-one", "--title", "registered after the release existed",
    "--lane", "superpowers", "--priority", "P1", "--status", "queued"], { cwd });
  run(["update-epic", "e1", "--priority", "P0"], { cwd });
  run(["update-epic", "e1", "--status", "archived", "--outcome", "killed",
    "--reason", "not doing it", "--no-deferrals"], { cwd });

  const st = readState(cwd);
  const membership = Object.fromEntries(st.epics.map(e => [e.id, e.release]));
  assert.deepEqual(membership, { e0: "0.27.0", e1: undefined, "later-one": undefined });
});

test("14.1 re-stating a release updates it in place rather than registering a second one", () => {
  const cwd = repoWithEpics(1);
  run(["release", "0.27.0", "--intent", "first wording"], { cwd });
  run(["release", "0.27.0", "--intent", "the wording that survived"], { cwd });
  const st = readState(cwd);
  assert.equal(st.releases.length, 1);
  assert.equal(st.releases[0].intent, "the wording that survived");
});

test("14.1 the release verb refuses what it cannot record, and writes nothing", () => {
  const cwd = repoWithEpics(1);
  // No intent on a release that does not exist yet: intent prose is what makes a release
  // legible later, and a release created without it is an id nobody can read.
  const noIntent = expectFail(() => run(["release", "0.27.0"], { cwd }));
  assert.match(noIntent.stderr, /--intent/);
  assert.equal(readState(cwd).releases, undefined);

  run(["release", "0.27.0", "--intent", "conductor tells the truth"], { cwd });
  const unknownEpic = expectFail(() => run(["release", "0.27.0", "--member", "nope"], { cwd }));
  assert.match(unknownEpic.stderr, /'nope' is not a known epic id/);
  const noRelease = expectFail(() => run(["release", "9.9.9", "--member", "e0"], { cwd }));
  assert.match(noRelease.stderr, /9\.9\.9/);
  assert.equal(readState(cwd).epics[0].release, undefined);
});

// ─────────────────── 14.2: an exclusion is a reason-bearing record ───────────────────
//
// The FOURTH scope of the one disposition record, not a parallel shape: the same required-reason
// rule, recorded against the epic/release pair. An exclusion is a scoping call about THIS
// release and never an ending — the epic stays in the backlog, carrying no disposition of its
// own, because it is still work someone may do.

test("14.2 a deferral reason is stored against the epic/release pair and survives what happens next", () => {
  const cwd = repoWithEpics(3);
  run(["release", "0.27.0", "--intent", "conductor tells the truth"], { cwd });
  run(["release", "0.27.0", "--member", "e0"], { cwd });
  run(["release", "0.27.0", "--defer", "e1",
    "--reason", "depends on #133 landing and on a progress signal this release is still changing"], { cwd });

  const rel = readState(cwd).releases[0];
  assert.equal(rel.deferred.length, 1);
  assert.equal(rel.deferred[0].epic, "e1");
  assert.match(rel.deferred[0].reason, /depends on #133 landing/);
  assert.match(rel.deferred[0].recordedAt, /^\d{4}-\d{2}-\d{2}T/);

  // Everything that happens after the call was made: the release is superseded by the next one,
  // the excluded epic is archived elsewhere, the record is re-saved several times over. The
  // reason is still there — that is the whole point of recording it outside a transcript.
  run(["release", "0.28.0", "--intent", "the one after"], { cwd });
  run(["update-epic", "e1", "--status", "archived", "--outcome", "delivered", "--no-deferrals"], { cwd });
  run(["render"], { cwd });
  const after = readState(cwd).releases.find(r => r.id === "0.27.0");
  assert.deepEqual(after.deferred, rel.deferred);
});

test("14.2 an exclusion leaves the epic in the backlog rather than ending it", () => {
  const cwd = repoWithEpics(2);
  run(["release", "0.27.0", "--intent", "conductor tells the truth"], { cwd });
  run(["release", "0.27.0", "--member", "e0"], { cwd });
  run(["release", "0.27.0", "--defer", "e0", "--reason", "cut for scope"], { cwd });

  const st = readState(cwd);
  const e0 = st.epics.find(e => e.id === "e0");
  assert.equal(e0.status, "queued");            // still backlog, not ended
  assert.equal(e0.disposition, undefined);      // an exclusion is not a terminal disposition
  assert.equal(e0.release, undefined);          // and it is no longer a member of that release
  assert.equal(st.releases[0].deferred[0].epic, "e0");
});

test("14.2 an epic nobody considered is NEITHER in the release nor deferred from it", () => {
  const cwd = repoWithEpics(3);
  run(["release", "0.27.0", "--intent", "conductor tells the truth"], { cwd });
  run(["release", "0.27.0", "--member", "e0"], { cwd });
  run(["release", "0.27.0", "--defer", "e1", "--reason", "cut for scope"], { cwd });

  const st = readState(cwd);
  const e2 = st.epics.find(e => e.id === "e2");
  assert.equal(e2.status, "queued");
  assert.equal(e2.release, undefined);
  assert.equal(st.releases[0].deferred.some(d => d.epic === "e2"), false);
});

test("14.2 a deferral with no reason is refused and nothing is written", () => {
  const cwd = repoWithEpics(1);
  run(["release", "0.27.0", "--intent", "conductor tells the truth"], { cwd });
  // Asserted as the REFUSAL, not merely as a non-zero exit mentioning the word "reason": with
  // the rule disabled, the verb crashes on `reason.trim()` and node prints the offending source
  // line, which contains the word too. A crash is not a refusal, so the message is named and a
  // TypeError is explicitly excluded.
  const err = expectFail(() => run(["release", "0.27.0", "--defer", "e0"], { cwd }));
  assert.match(err.stderr, /requires a non-empty reason/);
  assert.doesNotMatch(err.stderr, /TypeError/);
  assert.deepEqual(readState(cwd).releases[0].deferred, []);
  // A valueless --reason is the same silence with a flag in front of it.
  const blank = expectFail(() => run(["release", "0.27.0", "--defer", "e0", "--reason"], { cwd }));
  assert.match(blank.stderr, /requires a non-empty reason/);
  assert.doesNotMatch(blank.stderr, /TypeError/);
  assert.deepEqual(readState(cwd).releases[0].deferred, []);
});

test("14.2 re-deferring the same epic updates the reason rather than recording it twice", () => {
  const cwd = repoWithEpics(1);
  run(["release", "0.27.0", "--intent", "conductor tells the truth"], { cwd });
  run(["release", "0.27.0", "--defer", "e0", "--reason", "first reading"], { cwd });
  run(["release", "0.27.0", "--defer", "e0", "--reason", "the reason that survived"], { cwd });
  const rel = readState(cwd).releases[0];
  assert.equal(rel.deferred.length, 1);
  assert.equal(rel.deferred[0].reason, "the reason that survived");
});

test("14.2 re-including a deferred epic removes the record and SAYS so — never silently", () => {
  const cwd = repoWithEpics(1);
  run(["release", "0.27.0", "--intent", "conductor tells the truth"], { cwd });
  run(["release", "0.27.0", "--defer", "e0", "--reason", "cut on Tuesday"], { cwd });
  const out = runCombined(["release", "0.27.0", "--member", "e0"], { cwd });
  assert.match(out, /cut on Tuesday/);
  const st = readState(cwd);
  assert.deepEqual(st.releases[0].deferred, []);
  assert.equal(st.epics[0].release, "0.27.0");
});

// ─────────────────── 14.3: a release renders on both surfaces ───────────────────
//
// One computation (releaseSummaries) feeding two renderers, exactly as gateSummary() feeds the
// gate-review table and the brief's GATE REVIEWS block: PROJECT.md and the briefing cannot
// report different counts for the same release, because there is only one count.

test("14.3 a release with 12 members and 3 deferrals renders the same counts on both surfaces", () => {
  const cwd = repoWithEpics(15);
  run(["release", "0.27.0", "--intent", "conductor tells the truth"], { cwd });
  for (let i = 0; i < 12; i++) run(["release", "0.27.0", "--member", `e${i}`], { cwd });
  const reasons = {
    e12: "depends on #133 landing first",
    e13: "depends on a progress signal this same release is still changing",
    e14: "no design agreed yet — a guess would be worse than an omission",
  };
  for (const [epic, reason] of Object.entries(reasons)) {
    run(["release", "0.27.0", "--defer", epic, "--reason", reason], { cwd });
  }
  run(["render"], { cwd });

  assert.match(projectMd(cwd), /`0\.27\.0`: 12 epics, 3 deferred/);
  assert.match(parseBrief(cwd), /`0\.27\.0`: 12 epics, 3 deferred/);

  // The reasons read back from the record itself — not from the surface, and not from the
  // session that made the call.
  const rel = readState(cwd).releases[0];
  assert.deepEqual(Object.fromEntries(rel.deferred.map(d => [d.epic, d.reason])), reasons);
});

test("14.3 a release with no members and no exclusions still renders, and the singular is right", () => {
  const cwd = repoWithEpics(1);
  run(["release", "0.27.0", "--intent", "conductor tells the truth"], { cwd });
  run(["render"], { cwd });
  assert.match(projectMd(cwd), /`0\.27\.0`: 0 epics, 0 deferred/);
  run(["release", "0.27.0", "--member", "e0"], { cwd });
  run(["render"], { cwd });
  assert.match(projectMd(cwd), /`0\.27\.0`: 1 epic, 0 deferred/);
  assert.match(parseBrief(cwd), /`0\.27\.0`: 1 epic, 0 deferred/);
});

test("14.3 a repo with no releases renders no release section on either surface", () => {
  const cwd = repoWithEpics(1);
  run(["render"], { cwd });
  assert.doesNotMatch(projectMd(cwd), /## Releases/);
  assert.doesNotMatch(parseBrief(cwd), /RELEASES/);
});

test("14.3 each deferral's reason is reachable from the rendered record, not only from state.json", () => {
  const cwd = repoWithEpics(2);
  run(["release", "0.27.0", "--intent", "conductor tells the truth"], { cwd });
  run(["release", "0.27.0", "--defer", "e1", "--reason", "depends on #133 landing first"], { cwd });
  run(["render"], { cwd });
  const md = projectMd(cwd);
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

const REPO = new URL("../../", import.meta.url).pathname;
const shipped = (rel) => fs.readFileSync(path.join(REPO, rel), "utf8");
/** The four surfaces pm emits its gate procedure on. The rules block is rendered (never read
 *  from `rules.mjs`); the other three are the files pm ships. */
const EMITTED_DOCS = ["skills/conductor/SKILL.md", "commands/epic.md", "commands/status.md"];
const GATE_PROCEDURE_HEADING = "## The gate procedure — required task items";
const rulesText = (cwd) => run(["rules"], { cwd });

/** Every numbered item in the emitted text, as `<n>. <title>` — the FORM check. A bullet does
 *  not appear here, which is what makes "downgraded to a bullet" a failing test rather than a
 *  cosmetic difference. */
const numberedItems = (text) =>
  text.split("\n").filter(l => /^\d+\. /.test(l.trim())).map(l => l.trim());

test("15.1 the emitted gate procedure carries the call-site sweep as a NUMBERED REQUIRED task item", () => {
  const cwd = repoWithEpics(1);
  const block = rulesText(cwd);
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

test("15.1 the call-site sweep is a numbered item on every emitted surface, not only the rules block", () => {
  for (const rel of EMITTED_DOCS) {
    const text = shipped(rel);
    const items = numberedItems(text).join("\n");
    assert.match(items, /\*\*Call-site completeness sweep\.\*\*/,
      `${rel} must carry the call-site sweep as a NUMBERED item`);
    assert.match(text, /enumerate ALL call sites/i, `${rel} must name the enumeration concretely`);
    assert.doesNotMatch(text, /^\s*[-*] \*\*Call-site completeness sweep/m,
      `${rel} must not carry it as a bullet`);
  }
});

test("15.2 the emitted gate procedure verifies against the COMMIT and says the working tree does not count", () => {
  const cwd = repoWithEpics(1);
  const block = rulesText(cwd);
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

test("15.2 commit-based verification is a numbered item on every emitted surface", () => {
  for (const rel of EMITTED_DOCS) {
    const text = shipped(rel);
    assert.match(numberedItems(text).join("\n"), /\*\*Verify against the commit, not the working tree\.\*\*/,
      `${rel} must carry commit-based verification as a NUMBERED item`);
    assert.match(text, /Reading a file in the working tree is NOT verification/,
      `${rel} must state that reading the working tree is not verification`);
    assert.match(text, /git show --stat/, `${rel} must name the command that reads the commit`);
    assert.doesNotMatch(text, /^\s*[-*] \*\*Verify against the commit/m, `${rel} must not carry it as a bullet`);
  }
});

// ─────────────────── 15.3: the lifecycle-marker obligation ───────────────────
//
// The engine infers lifecycle exclusion from NOTHING — the marker is agent-declared, one fixed
// literal on the task line. An obligation nobody is told about is a feature that is expressible
// and never exercised, so the literal token itself has to appear in the text pm emits, in the
// two places an agent actually reads: the rules block and the brief.

test("15.3 the lifecycle-marker obligation names the literal token on both emitted surfaces", () => {
  const cwd = repoWithEpics(1);
  for (const [surface, text] of [["rules block", rulesText(cwd)], ["brief", parseBrief(cwd)]]) {
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

test("15.3 the conductor skill carries the same obligation with the same literal", () => {
  const text = shipped("skills/conductor/SKILL.md");
  assert.match(text, /<!-- pm:lifecycle -->/);
  assert.match(text, /amend/i);
  assert.match(numberedItems(text).join("\n"), /\*\*Declare lifecycle bookkeeping\.\*\*/);
});

// ─────────────────── 15.4: the commit-attribution obligation ───────────────────
//
// Attribution is an explicit array the agent supplies and the engine infers from nothing —
// not the files a commit touches, not an epic id in a message. So the obligation AND its one
// exclusion have to be in the emitted text: attributing the archive-move commit makes the
// epic's own Gate 2 stale at the instant the archive gate reads it, because that commit lands
// after the reviewed range by construction.

const ATTRIBUTION_SURFACES = ["skills/conductor/SKILL.md", "commands/epic.md"];

test("15.4 every emitted surface names --attribute-commit AND names the archive move as not to attribute", () => {
  const cwd = repoWithEpics(1);
  const surfaces = [["rules block", rulesText(cwd)],
    ...ATTRIBUTION_SURFACES.map(rel => [rel, shipped(rel)])];
  for (const [name, text] of surfaces) {
    assert.match(text, /--attribute-commit/, `${name} must name the flag`);
    assert.match(numberedItems(text).join("\n"), /\*\*Attribute every commit to its epic\.\*\*/,
      `${name} must carry attribution as a NUMBERED item`);
    // The always-qualifying case: the per-task conventional commit of an apply loop.
    assert.match(text, /per-task/i, `${name} must name the per-task commit as always qualifying`);
    // Work already in flight — an epic whose commits were made before the obligation was read.
    assert.match(text, /already in flight|already made/i,
      `${name} must cover commits already made`);
    // THE exclusion, stated in the same text rather than left to inference.
    assert.match(text, /archive/i, `${name} must name the archive move`);
    assert.match(text, /MUST NOT be attributed/,
      `${name} must state the archive-move exclusion outright`);
    assert.match(text, /stale/i, `${name} must say why: it makes the epic's own Gate 2 stale`);
  }
});

test("15.4 the four emitted surfaces carry the SAME numbered items, in the same order", () => {
  const cwd = repoWithEpics(1);
  // Derived from the generator's own list, never from an enumeration typed here — an
  // enumeration goes stale the moment an item is added, which is the defect item 1 of this very
  // procedure forbids. Scoped to the gate-procedure SECTION so the surrounding numbered lists
  // (the operating rules, the autonomy rules) are excluded by structure rather than by a filter
  // that would also hide an item present on one surface and absent from the generator.
  const expected = GATE_PROCEDURE_ITEMS.map(i => i.title);
  const sectionTitles = (text) => {
    const start = text.indexOf(GATE_PROCEDURE_HEADING);
    assert.notEqual(start, -1, "every emitted surface carries the gate-procedure section");
    const rest = text.slice(start + GATE_PROCEDURE_HEADING.length);
    const nextHeading = rest.search(/\n## /);
    const items = numberedItems(nextHeading === -1 ? rest : rest.slice(0, nextHeading));
    // Contiguous from 1, per surface. "Item 3" naming the same obligation everywhere is the
    // whole claim; a doc that skips a number breaks it while still listing the right titles.
    assert.deepEqual(items.map(l => Number(l.match(/^(\d+)\./)[1])),
      items.map((_, i) => i + 1), "numbered items must run 1..N with no gap");
    return items.map(l => (l.match(/^\d+\. \*\*(.+?)\*\*/) || [])[1]).filter(Boolean);
  };
  assert.deepEqual(sectionTitles(rulesText(cwd)), expected,
    "the rules block must render exactly the generator's items, in order");
  for (const rel of EMITTED_DOCS) {
    assert.deepEqual(sectionTitles(shipped(rel)), expected,
      `${rel} must carry the same gate-procedure items, in the same order, as the generator`);
  }
});

// ─────────────── 15.5: no emitted surface offers removal as a way to END work ───────────────
//
// Deletion removes the record of projected work, which is precisely what a disposition exists to
// preserve. The requirement binds the EMITTED TEXT, not the verb: `remove-epic` hard-deletes
// today and stays available and ungated for what it is for — an epic registered in error, a
// duplicate, a mistake made a minute ago — where there is no disposition to record because there
// was no work. The failure this closes is an agent reaching for deletion because the instructions
// it was handed offered it as a way to close something out.

/** Removal, in any of the spellings the emitted surfaces use. */
const REMOVAL = /\b(remove-epic|remove (an |the |this )?epic|delete (an |the |this )?epic|hard-delete|deleting the record)\b/i;
/** Ending an epic, a story, a deferral or a release exclusion. */
const ENDING = /\b(end(s|ing)? (an |the |this )?(epic|story|deferral|exclusion)|close (it |them )?out|closing out|finish(ed|ing)?|no longer doing|not doing it|abandon(ed|ing)?|kill(ed|ing)?|supersed(e|ed)|wrap(ping)? up|mark(ing)? it done)\b/i;
/** The legitimate frame: an epic registered in error, where there is no work to disposition. */
const IN_ERROR = /registered in error|registered by mistake|mis-registered|duplicate|never existed|carries no work|no work to record/i;

const paragraphs = (text) => text.split(/\n\s*\n/);

test("15.5 no emitted surface presents removing the record as a way to end work", () => {
  const cwd = repoWithEpics(1);
  const surfaces = [["rules block", rulesText(cwd)],
    ...EMITTED_DOCS.map(rel => [rel, shipped(rel)]),
    ...fs.readdirSync(path.join(REPO, "commands"))
      .filter(f => f.endsWith(".md"))
      .map(f => [`commands/${f}`, shipped(`commands/${f}`)])];
  for (const [name, text] of surfaces) {
    for (const para of paragraphs(text)) {
      if (!REMOVAL.test(para) || !ENDING.test(para)) continue;
      assert.ok(IN_ERROR.test(para),
        `${name} offers removal in an ending context without framing it as an epic registered ` +
        `in error:\n${para}`);
    }
  }
});

test("15.5 every emitted surface names the disposition path, with its required reason, as the way to end an epic", () => {
  const cwd = repoWithEpics(1);
  const surfaces = [["rules block", rulesText(cwd)], ...EMITTED_DOCS.map(rel => [rel, shipped(rel)])];
  for (const [name, text] of surfaces) {
    assert.match(numberedItems(text).join("\n"), /\*\*End work by recording a disposition\.\*\*/,
      `${name} must carry the disposition path as a NUMBERED item`);
    assert.match(text, /--outcome/, `${name} must name the flag that records the outcome`);
    assert.match(text, /--reason/, `${name} must name the required reason`);
    assert.match(text, /never by removing the record/i,
      `${name} must say outright that removal is not how work ends`);
  }
});

test("15.5 remove-epic still works, ungated, on an epic registered in error", () => {
  const cwd = repoWithEpics(2);
  // No stories, no gate verdict, no disposition — an epic registered a minute ago by mistake.
  runCombined(["remove-epic", "e1"], { cwd });
  const st = readState(cwd);
  assert.deepEqual(st.epics.map(e => e.id), ["e0"]);
  // And nothing about it demanded a disposition on the way out: there was no work to preserve.
  assert.equal(st.epics[0].disposition, undefined);
});

// The title guard above proves each surface LISTS the same five obligations in the same order. It
// says nothing about what they say. Proven live: a mirror's body was edited to state the OPPOSITE
// of the generator — "only AFTER THE LAST attribution" against "only before the first" — and the
// whole suite stayed green. Four surfaces carry one rule and one fifth of it was guarded.
//
// The mirrors are deliberately reworded for markdown (only 1 of 5 bodies matches the generator
// verbatim), so this cannot compare prose. It compares the claims that must survive rewording,
// declared beside each item as `mustSay`.
test("15.5: every mirrored surface carries each item's load-bearing claims, not just its title", () => {
  const surfaces = ["commands/epic.md", "commands/status.md", "skills/conductor/SKILL.md"];
  const norm = (s) => s.replace(/[`*_]/g, "").replace(/\s+/g, " ").trim().toLowerCase();

  for (const item of GATE_PROCEDURE_ITEMS) {
    assert.ok(Array.isArray(item.mustSay) && item.mustSay.length,
      `${item.title} declares no mustSay — an item added without one widens the gap this test ` +
      "exists to close, so the absence is the failure");
    // Self-check first: a claim absent from the GENERATOR is a typo in this list, and without
    // this the test would fail against the mirrors and send the reader to edit the wrong file.
    // Cost me three wrong guesses before adding it.
    const generated = norm(item.lines.join(" "));
    for (const claim of item.mustSay) {
      assert.ok(generated.includes(norm(claim)),
        `"${claim}" is not in the generator's own text for "${item.title}" — fix the claim, ` +
        "not the mirrors");
    }
  }
  for (const file of surfaces) {
    const text = norm(fs.readFileSync(path.join(REPO, file), "utf8"));
    for (const item of GATE_PROCEDURE_ITEMS) {
      for (const claim of item.mustSay) {
        assert.ok(text.includes(norm(claim)),
          `${file} is missing "${claim}" from "${item.title}" — the surfaces list the same ` +
          "obligations, so they must also state the same thing about them");
      }
    }
  }
});

// ─────── 15.6: item 5's emitted archive command runs exactly as written ───────
//
// "Every command pm emits must run as written" is this release's own standard (tracker-sync).
// Item 5 used to emit the disposition half ALONE, while the archive gate demands a deferral
// assertion in the SAME invocation — so an agent complying verbatim was refused and had to
// correct pm's own instruction to get past it. The refusal self-corrects, which is exactly why
// nothing caught it: the command was wrong and the outcome was still right.

test("15.6 item 5's emitted archive command executes verbatim, with no flag left to discover", () => {
  const cwd = repoWithEpics(1);
  const line = rulesText(cwd).split("\n").find(l => l.includes("`update-epic <id> --status archived"));
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
  run(argv, { cwd });                                  // exits 0 …
  const e0 = readState(cwd).epics.find(e => e.id === "e0");
  assert.equal(e0.status, "archived");
  assert.equal(e0.disposition.outcome, "delivered");
  assert.deepEqual(e0.deferralAssertion.deferrals, [],
    "…and the deferral assertion the gate demands was carried by the same invocation");
});

test("15.6 every emitted surface names all three deferral-assertion flags, not just the default", () => {
  const cwd = repoWithEpics(1);
  const surfaces = [["rules block", rulesText(cwd)], ...EMITTED_DOCS.map(rel => [rel, shipped(rel)])];
  for (const [name, text] of surfaces) {
    for (const flag of ["--no-deferrals", "--deferral", "--declined-deferral"]) {
      assert.ok(text.includes(flag),
        `${name} must name ${flag} — emitting only one of the three teaches the assertion as a ` +
        "formality rather than as the claim it is");
    }
  }
});
