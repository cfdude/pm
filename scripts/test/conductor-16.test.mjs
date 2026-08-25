import { test } from "node:test";
import assert from "node:assert/strict";
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
