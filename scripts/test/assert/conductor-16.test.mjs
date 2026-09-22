import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRepo, run } from "../fixtures/assert-harness.mjs";
import { GATE_PROCEDURE_ITEMS } from "../../lib/rules.mjs";

// conductor-tells-the-truth, groups 14–15: release planning (#125's minimum slice) and the
// gate procedure pm EMITS. Split from conductor-13/14/15 for the same reason those were split
// from each other — one file per wave keeps each one's fixtures readable.
//
// Every assertion in group 15 is made against the RENDERED text (`rules`, `brief`, the shipped
// markdown), never against the generator's source. A test that greps `rules.mjs` passes for a
// line that is emitted on no reachable branch, which is the failure the emitted-procedure
// requirements exist to prevent.
//
// ─────────────── 4.1 SPLIT THIS FILE, AND THIS IS THE FILE-RUNG HALF ───────────────
//
// Group 14 — fifteen tests — moved WHOLE to `scripts/test/unit/conductor-16.test.mjs`: every one of
// its questions is asked of the RECORD, and the two rendered surfaces it checks are store-owned
// artifacts (`projectMd(cwd)` is `engine.store.read("PROJECT.md").text`, and `parseBrief` is the
// `brief` verb's own stdout, parsed the same way). Fourteen of group 15's eighteen moved with it.
//
// WHAT IS LEFT is the ten whose subject is the SHIPPED DOCUMENT rather than the emitted text:
//
//   * `shipped(rel)` reads `skills/conductor/SKILL.md`, `commands/epic.md` or `commands/status.md`
//     with `readFileSync` — repository files the store does not own, read from the test's own
//     frame, and for the mirrored-surfaces tests the comparison is against prose BY CONSTRUCTION;
//   * one test walks EVERY `commands/*.md` and checks the paragraphs that offer removal in an
//     ending context, which is a read of the repository's own file set.
//
// No assertion changed in either direction.

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

const REPO = new URL("../../../", import.meta.url).pathname;
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

// ─────────────────── group 15.1 ───────────────────

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

// ─────────────────── group 15.2 ───────────────────

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

// ─────────────────── 15.3: the lifecycle-marker obligation ───────────────────
//
// The engine infers lifecycle exclusion from NOTHING — the marker is agent-declared, one fixed
// literal on the task line. An obligation nobody is told about is a feature that is expressible
// and never exercised, so the literal token itself has to appear in the text pm emits, in the
// two places an agent actually reads: the rules block and the brief.

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

// ─────────────────── 15.4: the commit-attribution obligation ───────────────────
//
// Attribution is an explicit array the agent supplies and the engine infers from nothing —
// not the files a commit touches, not an epic id in a message. So the obligation AND its one
// exclusion have to be in the emitted text: attributing the archive-move commit makes the
// epic's own Gate 2 stale at the instant the archive gate reads it, because that commit lands
// after the reviewed range by construction.

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

// ─────────────── 15.5: no emitted surface offers removal as a way to END work ───────────────
//
// Deletion removes the record of projected work, which is precisely what a disposition exists to
// preserve. The requirement binds the EMITTED TEXT, not the verb: `remove-epic` hard-deletes
// today and stays available and ungated for what it is for — an epic registered in error, a
// duplicate, a mistake made a minute ago — where there is no disposition to record because there
// was no work. The failure this closes is an agent reaching for deletion because the instructions
// it was handed offered it as a way to close something out.

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

// ─────── 15.6: item 5's emitted archive command runs exactly as written ───────
//
// "Every command pm emits must run as written" is this release's own standard (tracker-sync).
// Item 5 used to emit the disposition half ALONE, while the archive gate demands a deferral
// assertion in the SAME invocation — so an agent complying verbatim was refused and had to
// correct pm's own instruction to get past it. The refusal self-corrects, which is exactly why
// nothing caught it: the command was wrong and the outcome was still right.
//
// THE COMMAND-EXECUTES TEST IS ON THE UNIT RUNG: the argv it builds is parsed out of the emitted
// text, which is a value, and running it writes only store-owned artifacts. What is here is the
// doc-mirror half of the same obligation.
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

// ───────── 15.7: item 1 also demands the INVERSE of every operation the change adds ─────────
//
// A call-site sweep enumerates the CALLERS of a thing that is written, and that enumeration
// never arrives at the question of whether the thing can be UNWRITTEN. So the sweep is blind to
// a whole class by construction, and six instances of it shipped past both gates here while the
// call-site obligation was already in force — the most consequential being pre-authorization
// grants that accumulate with no revoke.
//
// What is here is the doc-mirror half; the assertions that slice item 1's BODY on the rendered
// block, and the mustSay declaration, are on the unit rung with it.
test("15.7 every mirrored surface carries the inverse obligation inside its own item 1", () => {
  for (const rel of EMITTED_DOCS) {
    const body = normClaim(itemBody(shipped(rel), 1, CALL_SITE_TITLE));
    for (const claim of INVERSE_CLAIMS) {
      assert.ok(body.includes(normClaim(claim)),
        `${rel}'s item 1 is missing "${claim}"`);
    }
  }
});
