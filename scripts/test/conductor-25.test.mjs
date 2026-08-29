// gh-136 / gh-131 / gh-105 / gh-85 — four small, independent gaps, batched.
//
// The thread joining them is the one docs/lessons/a-guard-can-check-the-wrong-half.md names: a
// guard proves the half it ASSERTS, not the half it is named for. #136 is a flag that parsed,
// matched a registry and wrote nothing while a registration guard stayed green. #131 is a
// recovery path with no test that can fail when it is deleted. #85 is a mutation nobody
// DECLARED, so no guard could be pointed at it. Each test below asserts BEHAVIOUR — a value read
// back off disk, a heal that landed, a tree that did not move — and never a declaration.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tmpRepo, run, readState, writeState, expectFail } from "./helpers.mjs";

const CONSTANTS = new URL("../lib/constants.mjs", import.meta.url).href;
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// ───────────────────────────── gh-136: registered ≠ honoured ─────────────────────────────
//
// `add-epic --notes` was accepted, exited 0 and stored nothing (#136, on 0.26.0). The fix
// shipped; what did NOT ship is a guard that would catch the next flag to do it. The two
// existing round-trip checks in conductor-13 catch OPPOSITE directions and neither covers
// add-epic:
//
//   * "every add-many key the registry declares round-trips" is REGISTRY-driven — it catches
//     `registered but not honoured`, which is exactly #136's shape.
//   * "every DOCUMENTED update-epic flag …" is DOCUMENTATION-driven — it catches `documented
//     but not registered`, and its own comment explains why registry-driving would be vacuous
//     for THAT direction (an unregistered flag is simply absent from the registry).
//
// `add-epic` had neither. This is the registry-driven half for it, and it does not supersede
// the documentation-driven one — they fail on different mistakes.

/** How to exercise each `add-epic` flag, and what reading it back looks like. The ENUMERATION
 *  is the registry projection, never this table: a row added to EPIC_FLAGS for `add-epic` with
 *  no entry here is a hard failure naming the flag, not a silent skip. */
const ADD_EPIC_EXERCISE = {
  // `--id` and `--lane` are on every invocation; they are still exercised explicitly so the
  // check's enumeration can stay the whole registry projection rather than a filtered one.
  "id": { args: [], check: (e) => assert.equal(e.id, "subject") },
  "lane": { args: ["--lane", "superpowers"], check: (e) => assert.equal(e.lane, "superpowers") },
  "title": { args: ["--title", "A registered title"], check: (e) => assert.equal(e.title, "A registered title") },
  "priority": { args: ["--priority", "P1"], check: (e) => assert.equal(e.priority, "P1") },
  "status": { args: ["--status", "later"], check: (e) => assert.equal(e.status, "later") },
  "parent": { args: ["--parent", "other"], check: (e) => assert.equal(e.parent, "other") },
  "external-id": { args: ["--external-id", "JOB-7"], check: (e) => assert.equal(e.externalId, "JOB-7") },
  "external-url": { args: ["--external-url", "https://example.test/7"], check: (e) => assert.equal(e.externalUrl, "https://example.test/7") },
  "external-updated-at": { args: ["--external-updated-at", "2026-08-23T09:30:00Z"], check: (e) => assert.equal(e.externalUpdatedAt, "2026-08-23T09:30:00Z") },
  "plan": { args: ["--plan", "docs/superpowers/plans/p.md"], check: (e) => assert.equal(e.planPath, "docs/superpowers/plans/p.md") },
  "spec": { args: ["--spec", "docs/superpowers/specs/d.md"], check: (e) => assert.equal(e.specPath, "docs/superpowers/specs/d.md") },
  "link": { args: ["--link", "blocks:other:because"], check: (e) => assert.deepEqual(e.links, [{ type: "blocks", epic: "other", reason: "because" }]) },
  "description": { args: ["--description", "durable rationale"], check: (e) => assert.equal(e.description, "durable rationale") },
  // THE regression this file is named for. A note reads back as an ENTRY — {at, actor, text} —
  // so asserting on the text alone would pass against an implementation that stored the raw
  // string and lost the append-only trail.
  "notes": {
    args: ["--notes", "the evidence block that was being dropped"],
    check: (e) => {
      assert.ok(Array.isArray(e.notes), "notes must be the append-only entry array, not a string");
      assert.equal(e.notes.at(-1).text, "the evidence block that was being dropped");
      assert.equal(typeof e.notes.at(-1).at, "string");
    },
  },
  "add-story": { args: ["--add-story", "a milestone"], check: (e) => assert.equal(e.stories.at(-1).title, "a milestone") },
};

test("gh-136: every EPIC_FLAGS row registered on add-epic is HONOURED, not merely accepted", async () => {
  const { EPIC_FLAGS } = await import(CONSTANTS);
  const registered = EPIC_FLAGS.filter(f => f.commands.includes("add-epic")).map(f => f.flag);
  assert.ok(registered.length >= 12,
    `the registry projection yielded only ${registered.length} add-epic flags — the projection is broken, not the command`);

  for (const flag of registered) {
    const spec = ADD_EPIC_EXERCISE[flag];
    assert.ok(spec,
      `EPIC_FLAGS registers --${flag} on add-epic but this check has no exercise entry for it — ` +
      "a registered flag must be invoked and read back, never skipped for being unknown here " +
      "(#136: --notes parsed, matched the registry, exited 0 and wrote nothing)");

    const cwd = tmpRepo();
    run(["init"], { cwd });
    run(["add-epic", "--id", "other", "--lane", "claude-code"], { cwd });
    const err = expectFail(() =>
      run(["add-epic", "--id", "subject", "--lane", "claude-code", ...spec.args], { cwd }));
    assert.equal(err, null,
      `add-epic rejected --${flag}, which its own registry says it accepts: ${err && String(err.stderr || err.message)}`);
    const epic = readState(cwd).epics.find(e => e.id === "subject");
    assert.ok(epic, `add-epic --${flag} created no epic at all`);
    spec.check(epic);
  }
});

test("gh-136: a valueless --notes is REFUSED, never accepted and dropped", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const err = expectFail(() => run(["add-epic", "--id", "e1", "--lane", "claude-code", "--notes"], { cwd }));
  assert.ok(err, "a valueless --notes must refuse rather than exit 0 having written nothing");
  assert.match(String(err.stderr || err.message), /--notes requires a value/);
  assert.equal(readState(cwd).epics.length, 0, "a refused registration must create no epic");
});

// ───────────────────────── gh-131: the retry half of retry-once-then-skip ─────────────────────
//
// 0.26.0 specified hook writes as RETRY ONCE, THEN SKIP and shipped the retry at two sites.
// Measured on 0.32.0 before this file existed: delete the retry from BOTH sites and all 856
// tests still pass. The heal is idempotent and hook-driven, so a later hook covers for the
// missing retry and the suite never notices — the same property that makes the defect benign
// most of the time is the property that hides it.
//
// Three things are asserted here, because no ONE of them is sufficient:
//   1. the POLICY, as a unit — including that the retry RE-LOADS and RE-HEALS rather than
//      re-saving the stale in-hand object, which no black-box test can observe;
//   2. the policy END TO END at the `render` site, through a real conflict injected between
//      loadState() and saveState() inside ONE invocation;
//   3. that BOTH hook-write sites reach the policy, by source scan — because a live helper
//      called by dead code passes every test of the helper.
//
// HONEST SCOPE. The commit-nudge site cannot be covered by (2) and that is not an oversight:
// commitNudge() calls render() unconditionally two lines later, and render()'s own heal is
// idempotent, so whether commit-nudge's retry ran is invisible from outside a single
// invocation — identical final state, identical revision, identical conflict log. That cover is
// the exact mechanism that hid this defect, so (3) is what binds that site.

const HOOK_WRITE = new URL("../lib/hook-write.mjs", import.meta.url).href;

test("gh-131: the policy retries ONCE after a conflict, and the retry re-loads and re-heals", async () => {
  const { saveHookHeal } = await import(HOOK_WRITE);
  const calls = [];
  // Two distinct objects: `stale` is what the caller already holds, `fresh` is what a reload
  // returns. Asserting the SECOND save receives `fresh` is the whole point — re-saving `stale`
  // would clobber the newer revision the guard exists to protect.
  const stale = { tag: "stale" };
  const fresh = { tag: "fresh" };
  const res = saveHookHeal({
    state: stale,
    verb: "render",
    load: () => { calls.push("load"); return fresh; },
    heal: (s) => { calls.push(`heal:${s.tag}`); return true; },
    save: (s) => {
      calls.push(`save:${s.tag}`);
      return { ok: s.tag === "fresh" };
    },
  });
  assert.deepEqual(calls, ["save:stale", "load", "heal:fresh", "save:fresh"],
    "after a conflicting first save the policy must reload, re-run the heal, and save the RELOADED state");
  assert.equal(res.ok, true);
  assert.equal(res.retried, true);
});

test("gh-131: the policy retries at most ONCE — a second conflict skips, it does not loop", async () => {
  const { saveHookHeal } = await import(HOOK_WRITE);
  let saves = 0;
  const res = saveHookHeal({
    state: {}, verb: "render",
    load: () => ({}), heal: () => true,
    save: () => { saves++; return { ok: false }; },
  });
  assert.equal(saves, 2, "retry ONCE, then skip — never a loop on a permanently contended file");
  assert.equal(res.ok, false);
  assert.equal(res.retried, true);
});

test("gh-131: a first save that succeeds neither reloads nor saves twice", async () => {
  const { saveHookHeal } = await import(HOOK_WRITE);
  let loads = 0, saves = 0;
  const res = saveHookHeal({
    state: {}, verb: "render",
    load: () => { loads++; return {}; }, heal: () => true,
    save: () => { saves++; return { ok: true }; },
  });
  assert.equal(saves, 1);
  assert.equal(loads, 0, "the uncontended path must not re-read state.json");
  assert.equal(res.retried, false);
});

test("gh-131: the reloaded state having nothing left to heal is a SKIP, not a blind re-save", async () => {
  const { saveHookHeal } = await import(HOOK_WRITE);
  const saved = [];
  const res = saveHookHeal({
    state: { tag: "stale" }, verb: "render",
    load: () => ({ tag: "fresh" }),
    // Someone else's write already applied the heal; re-saving would write a state built on a
    // superseded revision for no gain.
    heal: () => false,
    save: (s) => { saved.push(s.tag); return { ok: false }; },
  });
  assert.deepEqual(saved, ["stale"], "a fresh state with nothing to heal must not be written");
  assert.equal(res.ok, false);
});

// The conflict-injection seam. It is a NODE PRELOAD living entirely under scripts/test/ — no
// test-only branch, env var or verb is shipped in the engine, which is why an earlier
// `--conflict-selftest` verb was dropped during 0.26.0. It bumps state.json's on-disk revision
// on saveState()'s first filesystem call, i.e. after the hook's loadState() and before the
// revision comparison, inside ONE invocation. It writes a marker file when it fires so this
// test cannot pass vacuously on an injection that never happened.
const INJECT = path.join(REPO, "scripts", "test", "inject-state-conflict.cjs");

/** A repo whose state needs exactly one reconcileArchived() heal: `active` points at an epic
 *  that is already archived, which the heal clears. */
function repoNeedingHeal() {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  writeState(cwd, {
    version: 1, revision: 1, active: "shipped", detourStack: [],
    epics: [{
      id: "shipped", title: "shipped", priority: "P1", status: "archived", role: "epic",
      lane: "claude-code", links: [], reconcileNeeded: false, attributedCommits: [],
      disposition: { outcome: "delivered", recordedBy: "agent", at: "2026-08-01T00:00:00Z" },
    }],
  });
  return cwd;
}

function withInjection(cwd) {
  const marker = path.join(cwd, ".conductor", "injected.marker");
  return {
    marker,
    env: {
      NODE_OPTIONS: `--require ${INJECT}`,
      PM_INJECT_CONFLICT_DIR: path.join(cwd, ".conductor"),
      PM_INJECT_CONFLICT_MARKER: marker,
    },
  };
}

test("gh-131: a hook write that conflicts on its first attempt still lands the heal — render", () => {
  const cwd = repoNeedingHeal();
  const { marker, env } = withInjection(cwd);
  run(["render"], { cwd, env });

  // NON-VACUITY, asserted before the behaviour: if the seam never fired there was no conflict,
  // and a green result below would mean nothing.
  assert.ok(fs.existsSync(marker),
    "the conflict seam never fired — this test would otherwise pass without a conflict ever occurring");

  const after = readState(cwd);
  assert.equal(after.active, null,
    "the heal must LAND within the invocation whose first save conflicted — this is the retry, " +
    "and deleting it from render.mjs leaves `active` pointing at the archived epic");
  assert.ok(after.revision >= 3,
    `expected the injected bump plus the retry's write; revision was ${after.revision}`);
});

test("gh-131: BOTH hook-write sites reach the shared policy — neither re-implements it", () => {
  // A source scan, and it is the only thing that can bind the commit-nudge site: see the HONEST
  // SCOPE note above for why that site's retry is unobservable from outside one invocation.
  const sites = [
    ["scripts/lib/render.mjs", "render"],
    ["scripts/lib/subcommands.mjs", "commit-nudge"],
  ];
  for (const [rel, verb] of sites) {
    const src = fs.readFileSync(path.join(REPO, rel), "utf8");
    assert.match(src, /saveHookHeal\(/,
      `${rel} must route its hook write through saveHookHeal() — an inline retry is a second ` +
      "copy of the policy, and the copy that is missing a retry is invisible to every other test");
    assert.doesNotMatch(src, new RegExp(`saveState\\([^)]*onConflict:\\s*"skip"[^)]*verb:\\s*"${verb}"`),
      `${rel} still calls saveState({onConflict:"skip"}) directly for '${verb}' — the retry must ` +
      "not be re-implemented at the call site");
  }
});

// ─────────────────── gh-105: the undeclared `gh` + GitHub-account dependency ───────────────────
//
// `/pm:feedback` and the emitted inward tracker-sync step both shell out to `gh`, and neither the
// README, the install instructions nor the command doc said so. It works for the maintainer — gh
// installed, logged in, tracker repo their own — and none of those hold for a general user, who
// gets a bare shell error that explains nothing.
//
// The two halves are fixed DIFFERENTLY and deliberately:
//   * feedback is OUTWARD and has credential-free fallbacks — a prefilled `issues/new` URL needs
//     no token, no CLI and no account, and attributes the issue to whoever hit the bug;
//   * inward SYNC is a READ, and anonymous listing does not exist. The only honest fix there is
//     to declare the dependency and refuse the section rather than report a sync nobody ran.
// Fixing one and leaving the other is the absent-edit class, so both are asserted here.

test("gh-105: the emitted `gh issue list` step declares its preflight — PRIMARY tracker", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["set-tracker", "--system", "github-issues", "--repo", "acme/widgets", "--direction", "inward"], { cwd });
  const out = run(["rules"], { cwd });
  assert.match(out, /gh issue list --repo acme\/widgets/, "the vendor step must still be emitted");
  assert.match(out, /command -v gh/, "the emitted step must name the `gh` presence check");
  assert.match(out, /gh auth status/, "…and the authentication check — installed but logged out is a distinct failure");
  assert.match(out, /STOP this section/,
    "an unavailable dependency must stop the section, never silently produce an empty sync");
});

test("gh-105: the SECONDARY tracker's `gh issue list` step carries the SAME preflight", () => {
  // The sibling site. It is emitted by a different loop from a different predicate, which is
  // exactly how a rule lands at one of two sites and looks complete in the diff.
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["set-tracker", "--system", "jira", "--project", "PM", "--direction", "outward"], { cwd });
  run(["set-tracker", "--system", "github-issues", "--repo", "acme/widgets", "--role", "secondary"], { cwd });
  const out = run(["rules"], { cwd });
  const secondary = out.slice(out.indexOf("## Secondary tracker sync"));
  assert.ok(secondary.length > 200, "the secondary section must still be emitted");
  assert.match(secondary, /gh issue list --repo acme\/widgets/);
  assert.match(secondary, /command -v gh/,
    "the secondary inward step needs the same preflight — the dependency does not depend on the tracker's role");
  assert.match(secondary, /gh auth status/);
});

test("gh-105: a non-GitHub tracker gets NO gh preflight — the declaration is vendor-scoped", () => {
  // Non-vacuity in the other direction: a check that matched everything would pass against an
  // implementation that pasted the preflight into the vendor-neutral phrasing too.
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["set-tracker", "--system", "jira", "--project", "PM", "--direction", "inward"], { cwd });
  const out = run(["rules"], { cwd });
  assert.doesNotMatch(out, /command -v gh/,
    "a jira tracker must not be told to preflight a GitHub CLI it never uses");
});

test("gh-105: commands/feedback.md declares the dependency and all three channels", () => {
  const doc = fs.readFileSync(path.join(REPO, "commands", "feedback.md"), "utf8");
  for (const [what, re] of [
    ["the presence check", /command -v gh/],
    ["the auth check", /gh auth status/],
    ["the local file written before any channel", /\.conductor\/feedback/],
    ["the prefilled issue form", /issues\/new\?title=/],
    ["the measured URL ceiling", /~3 ?KB/],
    ["the email channel", /bugs@pm-plugin\.dev/],
  ]) {
    assert.match(doc, re, `commands/feedback.md must document ${what} — it is the whole of #105`);
  }
  // The ORDER is the maintainer's ruling and the reverse of the issue body's first proposal:
  // gh-when-available is preferred, not merely faster.
  assert.ok(doc.indexOf("command -v gh") < doc.indexOf("issues/new?title="),
    "the `gh` channel is documented BEFORE the prefilled URL — it is the preferred path when available");
});
