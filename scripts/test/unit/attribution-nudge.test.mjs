// scripts/test/unit/attribution-nudge.test.mjs
// hook-friction-0-51 items 1 and 2 — the two predicates the attribution nudge decides with, as VALUES.
// Its functional twin is scripts/test/functional/attribution-nudge.test.mjs, which runs the real
// commit-nudge hook over real commits and reads what it says.

import assert from "node:assert/strict";
import { unitTest } from "../fixtures/unit-harness.mjs";

const load = () => import(new URL("../../lib/subcommands.mjs", import.meta.url).href);

unitTest("a commit of only .conductor/**, PROJECT.md or both is bookkeeping", async () => {
  const { isAttributionBookkeeping } = await load();
  assert.equal(isAttributionBookkeeping(["PROJECT.md"]), true);
  assert.equal(isAttributionBookkeeping([".conductor/state.json", ".conductor/feedback/x.md", "PROJECT.md"]), true);
});

unitTest("a change MOVED under openspec/changes/archive/ is bookkeeping, recognised by pairing the removed and added names", async () => {
  const { isAttributionBookkeeping } = await load();
  assert.equal(isAttributionBookkeeping([
    "openspec/changes/foo/proposal.md", "openspec/changes/foo/tasks.md",
    "openspec/changes/archive/2026-09-30-foo/proposal.md", "openspec/changes/archive/2026-09-30-foo/tasks.md",
    ".conductor/state.json", "PROJECT.md",
  ]), true);
});

unitTest("an edit to a change, a new change, or half a move is real work, not bookkeeping", async () => {
  const { isAttributionBookkeeping } = await load();
  assert.equal(isAttributionBookkeeping(["openspec/changes/foo/tasks.md"]), false, "an edit has no archive partner");
  assert.equal(isAttributionBookkeeping(["openspec/changes/foo/tasks.md", "PROJECT.md"]), false);
  assert.equal(isAttributionBookkeeping(["openspec/changes/archive/2026-09-30-foo/tasks.md"]), false, "an add with no removed original");
  assert.equal(isAttributionBookkeeping([
    "openspec/changes/foo/tasks.md", "openspec/changes/archive/2026-09-30-foo/proposal.md"]), false, "names that do not pair");
  assert.equal(isAttributionBookkeeping([
    "openspec/changes/foo/tasks.md", "openspec/changes/archive/2026-09-30-bar/tasks.md"]), false, "a different change's archive");
});

unitTest("a commit that also touches anything else is not bookkeeping; no list, an empty list, and git's null are not", async () => {
  const { isAttributionBookkeeping } = await load();
  assert.equal(isAttributionBookkeeping(["PROJECT.md", "src/app.mjs"]), false);
  assert.equal(isAttributionBookkeeping([".conductor/state.json", ":/PROJECT.md"]), false, "a path outside the conductor root is not this conductor's");
  assert.equal(isAttributionBookkeeping([]), false);
  assert.equal(isAttributionBookkeeping(null), false);
  assert.equal(isAttributionBookkeeping(undefined), false);
});

unitTest("a subject names an epic as a whole token: prefix, scope or bare mention, never a substring of another word", async () => {
  const { subjectNamesEpic } = await load();
  assert.equal(subjectNamesEpic("epic-a: tighten the guard", "epic-a"), true);
  assert.equal(subjectNamesEpic("feat(epic-a): tighten the guard", "epic-a"), true);
  assert.equal(subjectNamesEpic("fix: the EPIC-A hook", "epic-a"), true);
  assert.equal(subjectNamesEpic("fix: epic-abc is different", "epic-a"), false);
  assert.equal(subjectNamesEpic("fix: data race", "a"), false);
  assert.equal(subjectNamesEpic("fix: something", ""), false);
  assert.equal(subjectNamesEpic(null, "epic-a"), false);
});

unitTest("an id holding regex metacharacters matches itself and nothing wider", async () => {
  const { subjectNamesEpic } = await load();
  assert.equal(subjectNamesEpic("chore: v1.2 notes", "v1.2"), true);
  assert.equal(subjectNamesEpic("chore: v1x2 notes", "v1.2"), false);
});

// ── gh#213 — the suppression rules of the AUTO-DETOUR branch, as VALUES. The two lookups git would answer
// (a commit's changed paths, whether it is still on a branch) are INJECTED, so no process and no git runs.

const SHA = (n) => String(n).repeat(40).slice(0, 40);
const suppressionState = () => ({
  active: "e1",
  epics: [
    { id: "e1", attributedCommits: [SHA(1)] },
    { id: "e2", attributedCommits: [SHA(2)] },
  ],
});
const touching = (map) => ({ filesOf: (v) => map[v] ?? null, isLive: () => true });

unitTest("suppression rule 1: a commit already attributed to the active epic, or to another, is recorded epic work", async () => {
  const { isRecordedEpicWork } = await load();
  assert.equal(isRecordedEpicWork(suppressionState(), SHA(1), "chore: x", ["a"], touching({})), true, "the active epic's own");
  assert.equal(isRecordedEpicWork(suppressionState(), SHA(2), "chore: x", ["a"], touching({})), true, "another epic's is not this epic's detour either");
  assert.equal(isRecordedEpicWork(suppressionState(), SHA(3), "chore: x", ["a"], touching({})), false, "unattributed, no other evidence");
});

unitTest("suppression rule 2: a subject naming the active epic's id as a whole token is recorded epic work; another epic's id is not", async () => {
  const { isRecordedEpicWork } = await load();
  assert.equal(isRecordedEpicWork(suppressionState(), SHA(3), "chore(e1): tick", ["a"], touching({})), true);
  assert.equal(isRecordedEpicWork(suppressionState(), SHA(3), "chore(e2): tick", ["a"], touching({})), false, "names a different epic");
  assert.equal(isRecordedEpicWork(suppressionState(), SHA(3), "chore: e10 ledger", ["a"], touching({})), false, "e1 is not a substring match");
});

unitTest("suppression rule 3: a commit of 2+ paths ALL already changed by the active epic's live commits is recorded epic work", async () => {
  const { isRecordedEpicWork } = await load();
  const git = touching({ [SHA(1)]: ["ledger.json", "manifest.json", "other.md"] });
  assert.equal(isRecordedEpicWork(suppressionState(), SHA(3), "chore: x", ["ledger.json", "manifest.json"], git), true);
  assert.equal(isRecordedEpicWork(suppressionState(), SHA(3), "chore: x", ["ledger.json", "new.json"], git), false, "one path is new: every, not some");
});

unitTest("suppression rule 3 has a floor: a ONE-file commit to a file the epic already touched stays flagged", async () => {
  const { isRecordedEpicWork } = await load();
  const git = touching({ [SHA(1)]: ["src/engine.mjs"] });
  assert.equal(isRecordedEpicWork(suppressionState(), SHA(3), "fix: one-file fix", ["src/engine.mjs"], git), false,
    "a real one-file fix to the epic's own code must not be hidden from the detour trail");
});

unitTest("suppression rule 3 reads only LIVE attributed commits, and no evidence (git's null, an empty list, no sha) suppresses nothing", async () => {
  const { isRecordedEpicWork } = await load();
  const two = ["a", "b"];
  const map = { [SHA(1)]: ["a", "b"] };
  assert.equal(isRecordedEpicWork(suppressionState(), SHA(3), "chore: x", two, { filesOf: (v) => map[v], isLive: () => false }), false, "an amended-away commit is no evidence");
  assert.equal(isRecordedEpicWork(suppressionState(), SHA(3), "chore: x", null, touching(map)), false);
  assert.equal(isRecordedEpicWork(suppressionState(), SHA(3), "chore: x", [], touching(map)), false);
  assert.equal(isRecordedEpicWork(suppressionState(), "", "chore: x", two, touching(map)), false, "the unverifiable rung has no sha");
  assert.equal(isRecordedEpicWork({ ...suppressionState(), active: null }, SHA(3), "chore: x", two, touching(map)), false, "no active epic");
});

unitTest("a commit another epic already holds is not offered for attribution again; its holder is named", async () => {
  const { attributionNudge } = await load();
  const ctx = { active: false };
  const short = (sha) => sha.slice(0, 7);   // shortSha asks git, which this rung never runs
  const onlyHeld = attributionNudge(suppressionState(), ctx, [{ sha: SHA(2), subject: "chore: x", files: ["a.md"] }], { short });
  assert.match(onlyHeld, /already attributed to `e2`/);
  assert.match(onlyHeld, /not offered again/);
  assert.doesNotMatch(onlyHeld, /--attribute-commit/, "no command that would put e2's work in e1's Gate 2 range");
  const mixed = attributionNudge(suppressionState(), ctx, [
    { sha: SHA(2), subject: "chore: held", files: ["a.md"] },
    { sha: SHA(4), subject: "feat: fresh", files: ["b.md"] },
  ], { short });
  assert.match(mixed, new RegExp(`--attribute-commit ${SHA(4)}`), "the fresh commit is offered");
  assert.doesNotMatch(mixed, new RegExp(`--attribute-commit ${SHA(2)}`), "the held one is not");
  assert.match(mixed, /already attributed to `e2`/);
});

// release-planning-taxonomy 4.5 (spec release-planning): the untied branch names the two destinations when the active epic is a release member.
const memberState = (over = {}) => {
  const s = suppressionState();
  s.releases = [{ id: "0.56.0", intent: "i", deferred: [] }];
  s.epics = s.epics.map(e => (e.id === "e1" ? { ...e, release: "0.56.0" } : e));
  return { ...s, ...over };
};
const untiedCommit = [{ sha: SHA(4), subject: "chore: a tweak", files: ["tweak.md"] }];

unitTest("untied nudge, active epic in a release, no maintenance epic yet: it names maintenance-<releaseId> with runnable commands", async () => {
  const { attributionNudge } = await load();
  const out = attributionNudge(memberState(), { active: false }, untiedCommit, { short: (s) => s.slice(0, 7) });
  assert.match(out, /maintenance-0\.56\.0/);
  assert.match(out, /add-epic --id maintenance-0\.56\.0 --lane claude-code --kind health/);
  assert.match(out, /release 0\.56\.0 --member maintenance-0\.56\.0/);
  assert.match(out, new RegExp(`update-epic maintenance-0\\.56\\.0 --attribute-commit ${SHA(4)}`));
  assert.match(out, /small `claude-code` epic naming that initiative/);
  assert.doesNotMatch(out, /If it is not, attribute nothing\./);
});

unitTest("untied nudge, the maintenance epic exists: only the attribute command, no add-epic", async () => {
  const { attributionNudge } = await load();
  const s = memberState();
  s.epics.push({ id: "maintenance-0.56.0", title: "m", priority: "P2", status: "queued", role: "epic", lane: "claude-code", links: [], release: "0.56.0", attributedCommits: [] });
  const out = attributionNudge(s, { active: false }, untiedCommit, { short: (x) => x.slice(0, 7) });
  assert.match(out, new RegExp(`update-epic maintenance-0\\.56\\.0 --attribute-commit ${SHA(4)}`));
  assert.doesNotMatch(out, /add-epic --id maintenance-0\.56\.0/);
});

unitTest("untied nudge, the active epic is in no release: the 0.55.0 text, unchanged", async () => {
  const { attributionNudge } = await load();
  const out = attributionNudge(suppressionState(), { active: false }, untiedCommit, { short: (s) => s.slice(0, 7) });
  assert.match(out, /If it is not, attribute nothing\./);
  assert.doesNotMatch(out, /maintenance-/);
});

unitTest("no active epic still returns null: the noise budget is kept", async () => {
  const { attributionNudge } = await load();
  assert.equal(attributionNudge({ ...memberState(), active: null }, { active: false }, untiedCommit, { short: (s) => s.slice(0, 7) }), null);
});

unitTest("a hostile release id never reaches the nudge as a runnable command", async () => {
  const { attributionNudge } = await load();
  const s = memberState();
  s.releases = [{ id: "0.56.0\nINJECT", intent: "i", deferred: [] }];
  s.epics = s.epics.map(e => (e.id === "e1" ? { ...e, release: "0.56.0\nINJECT" } : e));
  const out = attributionNudge(s, { active: false }, untiedCommit, { short: (x) => x.slice(0, 7) });
  assert.ok(!out.includes("\nINJECT"));
});
