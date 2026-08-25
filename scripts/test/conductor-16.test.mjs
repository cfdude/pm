import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRepo, run, runCombined, readState, projectMd, parseBrief, expectFail } from "./helpers.mjs";

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
