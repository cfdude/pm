// gh-92 / gh-93 — the epic↔design-document association, and the coverage question it makes
// answerable.
//
// #92: an epic can record the plan it came from (`planPath`) but not the DESIGN DOCUMENT that
// generated it. A Tier-2 design enumerating six implementation chunks produced exactly one
// epic — the chunk that happened to also get a plan file — and the other five were found by
// hand 11 days later, having blocked every release in between. The missing concept is
// MANY-TO-ONE: one document, N epics. Another scan root would have produced one epic per spec,
// which closes when chunk 1 ships.
//
// #93: `verify-specs` — read-only, reports and never repairs, and reports an uncovered document
// as INVENTORY rather than as a defect. A document with no epic may be a note, a reference or an
// abandoned sketch; a check that called every one of them a finding is the noise #138 removed
// from the freshness warning.
//
// The claim this file exists to test, from source-artifacts.mjs' own header: `specPath` costs
// "ONE ROW here plus its `EPIC_FLAGS` entry in constants.mjs" and inherits five behaviours. Two
// of the five write surfaces (`add-epic`, `update-epic`) write their fields BY HAND, so the row
// buys registration on those surfaces and not the write — the exit-0-write-nothing shape of #79.
// Every test below asserts the ROUND TRIP (set it, read it back off disk), never the registry.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpRepo, run, runCombined, readState, writeState, expectFail } from "./helpers.mjs";

const SPECS = ["docs", "superpowers", "specs"];
const specRel = (name) => [...SPECS, name].join("/");

function withSpec(cwd, name, body = "# Design\n") {
  const abs = path.join(cwd, ...SPECS, name);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
  return specRel(name);
}

function epic(over = {}) {
  return {
    id: "e1", title: "e1", priority: "P1", status: "queued", role: "epic",
    lane: "superpowers", links: [], reconcileNeeded: false, ...over,
  };
}

function seed(cwd, epics, extra = {}) {
  run(["init"], { cwd });
  writeState(cwd, { version: 1, active: null, detourStack: [], epics, ...extra });
}

const readEpic = (cwd, id) => readState(cwd).epics.find(e => e.id === id);

// ─────────────── #92: the field, on all three write surfaces ───────────────

test("gh-92: add-epic --spec stores specPath — the registry row does not write it", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "chunk-1", "--lane", "superpowers",
    "--spec", "docs/superpowers/specs/2026-08-05-mi-dev-to-prod-workflow-design.md"], { cwd });
  assert.equal(readEpic(cwd, "chunk-1").specPath,
    "docs/superpowers/specs/2026-08-05-mi-dev-to-prod-workflow-design.md");
});

test("gh-92: a valueless --spec is REFUSED at creation, not stored as boolean true", () => {
  // `--plan` on add-epic silently drops a valueless flag (str() filters it) while update-epic
  // refuses it — an asymmetry inherited, not introduced. `--spec` refuses on BOTH surfaces:
  // exit-0-write-nothing is the #79 shape, and a new field must not ship with it.
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const err = expectFail(() => run(["add-epic", "--id", "e1", "--lane", "superpowers", "--spec"], { cwd }));
  assert.ok(err, "a valueless --spec must fail, not exit 0 having written nothing");
  assert.match(String(err.stderr), /--spec requires a value/);
  assert.equal(readState(cwd).epics.length, 0, "a refused creation must create no epic");
});

test("gh-92: update-epic --spec attaches a design doc to an epic created without one", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "e1", "--lane", "superpowers"], { cwd });
  assert.equal(readEpic(cwd, "e1").specPath, undefined);
  run(["update-epic", "e1", "--spec", "docs/superpowers/specs/d.md"], { cwd });
  assert.equal(readEpic(cwd, "e1").specPath, "docs/superpowers/specs/d.md");
});

test("gh-92: update-epic refuses a valueless --spec instead of persisting a path nothing opens", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  run(["add-epic", "--id", "e1", "--lane", "superpowers"], { cwd });
  const err = expectFail(() => run(["update-epic", "e1", "--spec"], { cwd }));
  assert.ok(err, "a valueless --spec must fail");
  assert.match(String(err.stderr), /--spec requires a value/);
  assert.equal(readEpic(cwd, "e1").specPath, undefined);
});

test("gh-92: an add-many batch entry carries specPath — the fan-out shape the issue asks for", () => {
  // add-many is the surface #92 names by name: atomic parent+children creation is exactly the
  // shape a six-chunk design fan-out needs, and every chunk names the SAME document.
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const doc = "docs/superpowers/specs/big-design.md";
  const batch = path.join(cwd, "batch.json");
  fs.writeFileSync(batch, JSON.stringify({
    parent: { id: "big", lane: "superpowers", specPath: doc },
    epics: [
      { id: "chunk-1", lane: "superpowers", specPath: doc },
      { id: "chunk-2", lane: "superpowers", specPath: doc },
    ],
  }));
  run(["add-many", "--from", batch], { cwd });
  for (const id of ["big", "chunk-1", "chunk-2"]) {
    assert.equal(readEpic(cwd, id).specPath, doc, `${id} must carry the batch's specPath`);
  }
});

// ─────────────── #92: many-to-one, which the existing enumerator cannot express ───────────────

test("gh-92: every epic claiming one document is enumerable, not just the first", async () => {
  // claimedSourceArtifacts() is first-claimant-wins BY DESIGN — naming one epic is all a sync
  // skip message needs. That is the wrong shape for "how many epics cover this document", which
  // is the entire question #93 asks, so the family gets a COUNTING enumerator beside it.
  const { artifactClaimants, claimedSourceArtifacts } = await import("../lib/source-artifacts.mjs");
  const doc = "docs/superpowers/specs/big-design.md";
  const state = { epics: [
    epic({ id: "chunk-1", specPath: doc }),
    epic({ id: "chunk-2", specPath: `./${doc}` }),
    epic({ id: "chunk-3", specPath: doc }),
  ] };
  assert.deepEqual(artifactClaimants(state).get(doc).map(c => c.epic),
    ["chunk-1", "chunk-2", "chunk-3"],
    "all three claimants, in registration order — a first-wins map cannot answer the coverage question");
  assert.equal(claimedSourceArtifacts(state).get(doc).epic, "chunk-1",
    "the first-wins projection must keep behaving exactly as it did");
});

test("gh-92: a claimant enumerated for one document spans both artifact fields", async () => {
  const { artifactClaimants } = await import("../lib/source-artifacts.mjs");
  const p = "docs/shared.md";
  const claims = artifactClaimants({ epics: [
    epic({ id: "by-plan", planPath: p }),
    epic({ id: "by-spec", specPath: p }),
  ] }).get(p);
  assert.deepEqual(claims.map(c => c.key), ["planPath", "specPath"],
    "the enumerator reads the family table, so a field added to it is counted by both arms");
});

// ─────────────── #92: the five inherited behaviours, asserted rather than assumed ───────────────

test("gh-92: attaching a spec to an epic clears that path's sync-ignore tombstone", () => {
  const cwd = tmpRepo();
  const doc = "docs/superpowers/specs/d.md";
  seed(cwd, [epic({ id: "e1" })], { syncIgnore: [{ path: doc, at: "2026-08-01T00:00:00Z" }] });
  run(["update-epic", "e1", "--spec", doc], { cwd });
  assert.deepEqual(readState(cwd).syncIgnore, [],
    "claiming an artifact contradicts a tombstone saying it is not work — the record must not hold both");
});

test("gh-92: remove-epic tombstones the removed epic's specPath and names --spec, not --plan", () => {
  // The instruction the tombstone message prints is the un-ignore path. Hardcoded as `--plan`,
  // it tells the operator to run a command that would attach the design document as a PLAN —
  // the wrong field, and a progress source pointing at a document with no checkboxes.
  const cwd = tmpRepo();
  const doc = "docs/superpowers/specs/d.md";
  seed(cwd, [epic({ id: "e1", specPath: doc })]);
  const out = runCombined(["remove-epic", "e1"], { cwd });
  assert.deepEqual(readState(cwd).syncIgnore.map(i => i.path), [doc]);
  assert.match(out, /--spec/, "the un-ignore instruction must name the flag that writes THIS field");
  assert.doesNotMatch(out, /--plan/, "a spec tombstone must not tell the operator to attach it as a plan");
});

test("gh-92: a spec path is normalized the way every other artifact path is", () => {
  const cwd = tmpRepo();
  seed(cwd, [epic({ id: "e1", specPath: "./docs/superpowers/specs/d.md" })]);
  runCombined(["remove-epic", "e1"], { cwd });
  assert.deepEqual(readState(cwd).syncIgnore.map(i => i.path), ["docs/superpowers/specs/d.md"],
    "two spellings of one file must never read as two artifacts");
});

// ─────────────── #93: verify-specs ───────────────

test("gh-93: verify-specs counts the epics drawn from each design document", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const doc = withSpec(cwd, "2026-08-05-fanout-design.md");
  writeState(cwd, { version: 1, active: null, detourStack: [], epics: [
    epic({ id: "chunk-1", specPath: doc }),
    epic({ id: "chunk-2", specPath: doc }),
  ] });
  const out = run(["verify-specs"], { cwd });
  assert.match(out, /2\s+docs\/superpowers\/specs\/2026-08-05-fanout-design\.md/);
  assert.match(out, /chunk-1/);
  assert.match(out, /chunk-2/);
});

test("gh-93: a document no epic names is reported as inventory and exits 0", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  withSpec(cwd, "orphan-design.md");
  const out = run(["verify-specs"], { cwd });
  assert.match(out, /0\s+docs\/superpowers\/specs\/orphan-design\.md/);
  assert.match(out, /1 document\(s\) with no epic/i);
  // Inventory, not a defect: the verb must not call an uncovered document a FINDING, which is
  // the vocabulary `integrity` reserves for shapes that cannot be true.
  assert.doesNotMatch(out, /finding/i);
});

test("gh-93: an absent spec root reads differently from a root with nothing uncovered", () => {
  const bare = tmpRepo();
  run(["init"], { cwd: bare });
  const absent = run(["verify-specs"], { cwd: bare });
  assert.match(absent, /no spec root/i,
    "a repository keeping its designs elsewhere must not get a confidently empty report");

  const covered = tmpRepo();
  run(["init"], { cwd: covered });
  const doc = withSpec(covered, "d.md");
  writeState(covered, { version: 1, active: null, detourStack: [], epics: [epic({ id: "e1", specPath: doc })] });
  const clean = run(["verify-specs"], { cwd: covered });
  assert.doesNotMatch(clean, /no spec root/i);
  assert.notEqual(absent, clean, "silence and clean must never look the same");
});

test("gh-93: --root points the check at a repository that keeps its designs elsewhere", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  fs.mkdirSync(path.join(cwd, "design"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "design", "one.md"), "# One\n");
  const dflt = run(["verify-specs"], { cwd });
  assert.match(dflt, /no spec root/i);
  const out = run(["verify-specs", "--root", "design"], { cwd });
  assert.match(out, /0\s+design\/one\.md/);
  assert.doesNotMatch(out, /no spec root/i);
});

test("gh-93: --root with no value is refused rather than silently falling back to the default", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const err = expectFail(() => run(["verify-specs", "--root"], { cwd }));
  assert.ok(err, "a valueless --root must fail");
  assert.match(String(err.stderr), /--root requires a value/);
});

test("gh-93: an unknown flag is refused, naming the flags the verb does take", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const err = expectFail(() => run(["verify-specs", "--roots", "design"], { cwd }));
  assert.ok(err);
  assert.match(String(err.stderr), /--roots/);
  assert.match(String(err.stderr), /--root/);
});

test("gh-93: an epic naming a document that is not on disk is reported — the other half of the difference", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  withSpec(cwd, "present.md");
  writeState(cwd, { version: 1, active: null, detourStack: [], epics: [
    epic({ id: "e1", specPath: "docs/superpowers/specs/present.md" }),
    epic({ id: "e2", specPath: "docs/superpowers/specs/moved-away.md" }),
  ] });
  const out = run(["verify-specs"], { cwd });
  assert.match(out, /moved-away\.md/);
  assert.match(out, /e2/);
  assert.doesNotMatch(out.split("not on disk")[1] || "", /\be1\b/,
    "an epic whose document exists must not appear in the dangling arm");
});

test("gh-93: the dangling arm reports the NORMALIZED path, not the spelling the epic happens to hold", () => {
  // Caught by mutation testing, not by writing it down first: dropping normalizeArtifactPath()
  // from this arm survived the whole suite, because `path.join(ROOT, "./x")` resolves either
  // way and the covered-document case therefore never notices. What it changes is the path the
  // report PRINTS — `./docs/…` here and `docs/…` in the coverage arm above, two spellings of
  // one document in one report, which is precisely the confusion the normal form exists to end.
  const cwd = tmpRepo();
  run(["init"], { cwd });
  withSpec(cwd, "present.md");
  writeState(cwd, { version: 1, active: null, detourStack: [], epics: [
    epic({ id: "e1", specPath: "./docs/superpowers/specs/gone.md" }),
  ] });
  const arm = run(["verify-specs"], { cwd }).split("not on disk")[1] || "";
  assert.match(arm, /→ docs\/superpowers\/specs\/gone\.md/);
  assert.doesNotMatch(arm, /→ \.\//);
});

test("gh-93: a dangling planPath is NOT reported here — that noise is #138's, already removed", () => {
  // 7 of 8 epics carrying a planPath in this repository dangled, and all 7 were archived and
  // moved. epicProgress() exempts exactly that case; re-reporting it from a second surface
  // would put the warning back with the exemption stripped off.
  const cwd = tmpRepo();
  run(["init"], { cwd });
  withSpec(cwd, "d.md");
  writeState(cwd, { version: 1, active: null, detourStack: [], epics: [
    epic({ id: "e1", specPath: "docs/superpowers/specs/d.md", planPath: "docs/superpowers/plans/gone.md" }),
  ] });
  const out = run(["verify-specs"], { cwd });
  assert.doesNotMatch(out, /gone\.md/);
});

test("gh-93: a directory's own index file is not a design document", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  withSpec(cwd, "README.md", "# Superpowers Specs\n");
  withSpec(cwd, "real-design.md");
  const out = run(["verify-specs"], { cwd });
  assert.doesNotMatch(out, /README\.md/);
  assert.match(out, /real-design\.md/);
});

test("gh-93: documents nested under the root are found", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const abs = path.join(cwd, ...SPECS, "archive", "old-design.md");
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, "# Old\n");
  const out = run(["verify-specs"], { cwd });
  assert.match(out, /docs\/superpowers\/specs\/archive\/old-design\.md/);
});

test("gh-93: coverage is path-normalized — ./docs/… and docs/… are one document", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const doc = withSpec(cwd, "d.md");
  writeState(cwd, { version: 1, active: null, detourStack: [], epics: [epic({ id: "e1", specPath: `./${doc}` })] });
  const out = run(["verify-specs"], { cwd });
  assert.match(out, /1\s+docs\/superpowers\/specs\/d\.md/);
  assert.doesNotMatch(out, /not on disk[\s\S]*e1/,
    "a leading-dot spelling must not read as a second, missing document");
});

test("gh-93: coverage is status-blind — an archived epic still covers its document", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const doc = withSpec(cwd, "d.md");
  writeState(cwd, { version: 1, active: null, detourStack: [], epics: [
    epic({ id: "shipped", status: "archived", specPath: doc }),
  ] });
  const out = run(["verify-specs"], { cwd });
  assert.match(out, /1\s+docs\/superpowers\/specs\/d\.md/,
    "chunk 1 shipping IS coverage of chunk 1 — the same reason claimedSourceArtifacts is status-blind");
});

test("gh-93: a sync-ignore tombstone does NOT hide a document from the coverage report", () => {
  // Deliberate, and it is what keeps remove-epic's one-to-many mis-fit inert: removing ONE of
  // six epics drawn from a design tombstones the whole document, and a report that read
  // syncIgnore would then call a document five epics still cover "deliberately uncovered".
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const doc = withSpec(cwd, "d.md");
  writeState(cwd, { version: 1, active: null, detourStack: [], epics: [],
    syncIgnore: [{ path: doc, at: "2026-08-01T00:00:00Z", removedEpic: "gone" }] });
  const out = run(["verify-specs"], { cwd });
  assert.match(out, /0\s+docs\/superpowers\/specs\/d\.md/);
});

test("gh-93: verify-specs writes nothing — state.json is byte-identical afterwards", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  withSpec(cwd, "d.md");
  const sp = path.join(cwd, ".conductor", "state.json");
  const before = fs.readFileSync(sp);
  run(["verify-specs"], { cwd });
  assert.deepEqual(fs.readFileSync(sp), before, "read-only means the file is unchanged, not merely unrepaired");
});

test("gh-93: verify-specs is dispatched and named in the usage line", () => {
  const usage = fs.readFileSync(new URL("../conductor.mjs", import.meta.url), "utf8");
  const line = usage.split("\n").find(l => l.includes("usage: conductor.mjs"));
  assert.ok(line.includes("verify-specs"), "a dispatched subcommand absent from the usage line is undiscoverable");
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const err = expectFail(() => run(["verify-specs"], { cwd }));
  assert.equal(err, null, "verify-specs must be wired into the dispatch table");
});
