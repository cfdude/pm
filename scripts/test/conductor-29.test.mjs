// gh#100 — the link-type vocabulary: a known set, derived from what the code READS, validated
// on write, and reported (never rewritten) where a record already holds something else.
// gh#94 — serial deferral: made VISIBLE where a stack already renders, with no threshold and
// no imperative. See the header comment on deferralHistory() in lib/links.mjs for why.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { run, runCombined, tmpRepo, writeState, readState, parseBrief, expectFail } from "./helpers.mjs";
import {
  KNOWN_LINK_TYPES, LINK_TYPES_READ, LINK_TYPES_WRITTEN, LINK_TYPES_ANNOTATION,
  isKnownLinkType, deferralHistory, ordinal,
} from "../lib/links.mjs";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function seed(cwd, epics, extra = {}) {
  writeState(cwd, { version: 1, active: null, epics, detourStack: [], ...extra });
}
const epic = (id, over = {}) => ({
  id, title: id, priority: "P2", status: "queued", role: "epic", lane: "claude-code",
  stories: [], links: [], ...over,
});

// ---------------------------------------------------------------- gh#100: the known set

test("KNOWN_LINK_TYPES is the union of the three bands, with no duplicates", () => {
  const expected = [
    ...LINK_TYPES_READ.map(t => t.type),
    ...LINK_TYPES_WRITTEN.map(t => t.type),
    ...LINK_TYPES_ANNOTATION,
  ];
  assert.deepEqual(KNOWN_LINK_TYPES, expected);
  assert.equal(new Set(KNOWN_LINK_TYPES).size, KNOWN_LINK_TYPES.length);
  assert.ok(isKnownLinkType("depends-on"));
  assert.ok(!isKnownLinkType("depends_on"));
});

test("`rg KNOWN_ constants.mjs` finds the link-type set, or the pointer to where it lives", () => {
  // gh#100 asks for the constant in constants.mjs because that is where an agent already greps
  // — "in a repo, an agent reads code before fetching a website". It is NOT declared there:
  // constants.mjs's first line is "No dependencies on any other lib module", and the bands name
  // the consumer files that read each type, which is link knowledge. A re-export would have made
  // constants depend on links and inverted the leaf. So constants carries a pointer that answers
  // the same grep, and this test keeps the pointer truthful.
  const src = fs.readFileSync(path.join(REPO, "scripts", "lib", "constants.mjs"), "utf8");
  const line = src.split("\n").find(l => l.includes("KNOWN_LINK_TYPES"));
  assert.ok(line, "constants.mjs no longer mentions KNOWN_LINK_TYPES — the grep an agent runs comes back empty");
  assert.match(line, /links\.mjs/, "the pointer does not say where the set actually lives");
});

// The drift guard. The set above is an enumeration, and
// docs/lessons/bind-rules-to-functions-not-enumerations.md is about exactly this: an
// enumeration goes stale the moment a caller is added. These two tests bind it to the source
// in both directions, so the set cannot quietly stop describing the code.

/** Every engine source file, from a WALK rather than a glob: a consumer landing in `hooks/` or
 *  in `scripts/conductor.mjs` must not slip past the guard by living outside `scripts/lib/`. */
function engineSources() {
  const out = [];
  const visit = (abs) => {
    for (const ent of fs.readdirSync(abs, { withFileTypes: true })) {
      const child = path.join(abs, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === "test" || ent.name === "node_modules") continue;
        visit(child);
      } else if (/\.(mjs|js|cjs)$/.test(ent.name)) out.push(child);
    }
  };
  for (const root of ["scripts", "hooks"]) {
    const abs = path.join(REPO, root);
    if (fs.existsSync(abs)) visit(abs);
  }
  return out;
}

/** Link-type string literals the engine actually compares against or writes.
 *  Scoped to lines that mention an epic or a link, because `type` is a generic word; a line
 *  carrying the marker `pm:not-a-link-type` opts out explicitly. `typeof x.type === "string"`
 *  is stripped first — it is a shape guard, not a vocabulary. */
function linkTypeLiterals() {
  const found = [];
  for (const file of engineSources()) {
    const rel = path.relative(REPO, file);
    fs.readFileSync(file, "utf8").split("\n").forEach((raw, i) => {
      if (raw.includes("pm:not-a-link-type")) return;
      if (!/epic|link/i.test(raw)) return;
      const line = raw.replace(/typeof\s+[\w.]+\s*[!=]==\s*"[^"]*"/g, "");
      for (const re of [/\.type\s*[!=]==\s*"([^"]+)"/g, /\btype:\s*"([^"]+)"/g]) {
        for (const m of line.matchAll(re)) found.push({ type: m[1], where: `${rel}:${i + 1}` });
      }
    });
  }
  return found;
}

test("drift guard: every link type the engine source names is in KNOWN_LINK_TYPES", () => {
  const literals = linkTypeLiterals();
  // A relation, not a count: docs/lessons/hardcoded-live-data-claims-rot.md. (Dated snapshot,
  // 2026-08-29: five sites — depends-on x3, supersedes x1, may-invalidate x1.)
  assert.ok(literals.length > 0, "the extractor found nothing — it has stopped seeing the source");
  const strays = literals.filter(l => !isKnownLinkType(l.type));
  assert.deepEqual(strays, [],
    `a consumer switches on a link type the known set does not carry: ${strays.map(s => `${s.type} @ ${s.where}`).join(", ")}`);
});

test("drift guard: every declared READ/WRITTEN type is still named by the file that claims it", () => {
  // The other direction — a declaration whose consumer was deleted or renamed. Without this,
  // the set could keep promising behaviour the engine no longer has.
  for (const entry of [...LINK_TYPES_READ, ...LINK_TYPES_WRITTEN]) {
    const files = entry.readBy || entry.writtenBy;
    assert.ok(files && files.length, `${entry.type} declares no consumer file`);
    for (const f of files) {
      const abs = path.join(REPO, "scripts", "lib", f);
      assert.ok(fs.existsSync(abs), `${entry.type} claims ${f}, which does not exist`);
      assert.match(fs.readFileSync(abs, "utf8"), new RegExp(`"${entry.type}"`),
        `${f} no longer names "${entry.type}" — the declaration is orphaned`);
    }
  }
});

// ---------------------------------------------------------------- gh#100: validation on write

test("add-epic --link refuses an unknown type and names the valid set", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  seed(cwd, [epic("a")]);
  const err = expectFail(() => run(["add-epic", "--id", "b", "--title", "B", "--lane", "claude-code",
    "--link", "depends_on:a"], { cwd }));
  assert.ok(err, "an unknown link type was accepted");
  const msg = err.stderr || String(err);
  assert.match(msg, /depends_on/);
  assert.match(msg, /not a known link type/);
  for (const t of KNOWN_LINK_TYPES) assert.ok(msg.includes(t), `the refusal does not name '${t}'`);
  // The wholesale-replace trap is the actual back-compat wall: a user hits this while
  // re-passing a link they did not author. The message must say what to do about it.
  assert.match(msg, /--clear-links|replaces/);
  assert.ok(!readState(cwd).epics.some(e => e.id === "b"), "the epic was written anyway");
});

test("update-epic --link refuses an unknown type, and leaves the existing links untouched", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  seed(cwd, [epic("a"), epic("b", { links: [{ type: "relates-to", epic: "a" }] })]);
  const err = expectFail(() => run(["update-epic", "b", "--link", "realtes-to:a"], { cwd }));
  assert.ok(err, "an unknown link type was accepted");
  assert.match(err.stderr || String(err), /realtes-to/);
  assert.deepEqual(readState(cwd).epics.find(e => e.id === "b").links, [{ type: "relates-to", epic: "a" }]);
});

test("every known type is accepted on write", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  seed(cwd, [epic("a"), epic("b")]);
  for (const t of KNOWN_LINK_TYPES) {
    run(["update-epic", "b", "--link", `${t}:a:why`], { cwd });
    assert.deepEqual(readState(cwd).epics.find(e => e.id === "b").links, [{ type: t, epic: "a", reason: "why" }]);
  }
});

test("add-many refuses an unknown type too — the sibling write path, not just parseLinkFlags", () => {
  // The call-site sweep's finding: `--link` goes through parseLinkFlags, but an add-many batch
  // entry's `links` is a JSON array copied verbatim. A guard at one and not the other is the
  // absent edit neither gate can see.
  const cwd = tmpRepo();
  run(["init"], { cwd });
  seed(cwd, [epic("a")]);
  const batch = JSON.stringify({ epics: [
    { id: "b", lane: "claude-code", links: [{ type: "depends_on", epic: "a" }] }] });
  const err = expectFail(() => run(["add-many", "--from", "-"], { cwd, input: batch }));
  assert.ok(err, "add-many accepted an unknown link type");
  assert.match(err.stderr || String(err), /depends_on/);
  assert.ok(!readState(cwd).epics.some(e => e.id === "b"));

  const ok = JSON.stringify({ epics: [
    { id: "b", lane: "claude-code", links: [{ type: "depends-on", epic: "a" }] }] });
  run(["add-many", "--from", "-"], { cwd, input: ok });
  assert.deepEqual(readState(cwd).epics.find(e => e.id === "b").links, [{ type: "depends-on", epic: "a" }]);
});

test("the usage line publishes the vocabulary, not just the syntax", () => {
  // gh#100 item 5: "the help string is where an agent looks first". update-epic is the verb
  // that HAS a usage line (add-epic refuses per-flag instead of printing one), so this is where
  // the vocabulary goes; add-epic's surface is the refusal message, covered above.
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const out = runCombined(["update-epic"], { cwd });
  assert.match(out, /--link/);
  for (const t of KNOWN_LINK_TYPES) {
    assert.ok(out.includes(t), `update-epic's usage does not name the link type '${t}'`);
  }
});

test("commands/epic.md documents the vocabulary and no longer claims only the epic is checked", () => {
  const doc = fs.readFileSync(path.join(REPO, "commands", "epic.md"), "utf8");
  for (const t of KNOWN_LINK_TYPES) {
    assert.ok(doc.includes(t), `commands/epic.md does not name the link type '${t}'`);
  }
});

// ------------------------------------------- gh#100: records already holding an unknown type

test("a stored unknown type still loads and still renders — validation is on WRITE only", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  seed(cwd, [epic("a"), epic("b", { links: [{ type: "relates", epic: "a", reason: "legacy" }] })]);
  run(["render"], { cwd });
  const project = fs.readFileSync(path.join(cwd, "PROJECT.md"), "utf8");
  assert.match(project, /relates→a/, "a legacy link stopped rendering — the record became unreadable");
  assert.deepEqual(readState(cwd).epics.find(e => e.id === "b").links,
    [{ type: "relates", epic: "a", reason: "legacy" }], "the stored type was rewritten");
});

test("integrity reports a stored unknown type as an inert edge, and repairs nothing", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  seed(cwd, [epic("a"), epic("b", { links: [{ type: "relates", epic: "a" }] })]);
  const before = fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8");
  const out = runCombined(["integrity"], { cwd });
  assert.match(out, /link-of-unknown-type — 1 finding/);
  assert.match(out, /relates/);
  assert.equal(fs.readFileSync(path.join(cwd, ".conductor", "state.json"), "utf8"), before,
    "integrity wrote to the record it is auditing");
});

test("integrity says nothing when every stored type is known", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  seed(cwd, [epic("a"), epic("b", { links: [{ type: "depends-on", epic: "a" }] })]);
  assert.match(runCombined(["integrity"], { cwd }), /link-of-unknown-type — 0 finding/);
});

// ---------------------------------------------------------------- gh#94: deferral visibility

test("deferralHistory counts DISTINCT detours recorded against an epic, live frame included", () => {
  const state = {
    epics: [{ id: "p", links: [
      { type: "may-invalidate", epic: "d1" },
      { type: "may-invalidate", epic: "d2" },
      { type: "relates-to", epic: "d3" },
    ] }],
    detourStack: [{ pausedEpic: "p", pausedAt: "2026-08-01T00:00:00.000Z", spawnedDetour: "d2" },
      { pausedEpic: "p", pausedAt: "2026-08-10T00:00:00.000Z", spawnedDetour: "d4" }],
  };
  const h = deferralHistory(state, "p");
  assert.deepEqual(h.detours, ["d1", "d2", "d4"]);
  assert.equal(h.count, 3);
  assert.equal(h.pausedAt, "2026-08-01T00:00:00.000Z", "the OLDEST live pause is the one that matters");
  assert.deepEqual(deferralHistory(state, "nobody"), { count: 0, detours: [], pausedAt: null });
});

test("ordinal reads as English for the numbers a deferral count can reach", () => {
  assert.equal(ordinal(1), "1st");
  assert.equal(ordinal(2), "2nd");
  assert.equal(ordinal(3), "3rd");
  assert.equal(ordinal(4), "4th");
  assert.equal(ordinal(11), "11th");
  assert.equal(ordinal(21), "21st");
});

test("the brief's detour stack shows how long a pause has run and how often it has recurred", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  const elevenDaysAgo = new Date(Date.now() - 11 * 864e5).toISOString();
  seed(cwd, [
    epic("p", { status: "paused", links: [
      { type: "may-invalidate", epic: "d1" }, { type: "may-invalidate", epic: "d2" }] }),
    epic("d1", { status: "archived", role: "detour" }),
    epic("d2", { status: "active", role: "detour" }),
  ], { detourStack: [{ pausedEpic: "p", pausedAt: elevenDaysAgo, reason: "blocked", spawnedDetour: "d2", reconcileOnResume: true }] });
  const brief = parseBrief(cwd);
  assert.match(brief, /paused 11d/);
  assert.match(brief, /2nd deferral/);
  assert.match(brief, /d1, d2/);
  // Information, not judgment: the engine has no evidence for a threshold, so it must not
  // issue one. See the deferralHistory() header comment.
  const line = brief.split("\n").find(l => /2nd deferral/.test(l));
  assert.doesNotMatch(line, /should|too many|stop|⚠/);
});

test("a first deferral gets no recurrence clause — the first detour is the mechanism working", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  seed(cwd, [epic("p", { status: "paused" }), epic("d1", { status: "active", role: "detour" })],
    { detourStack: [{ pausedEpic: "p", pausedAt: new Date().toISOString(), reason: "blocked", spawnedDetour: "d1" }] });
  const brief = parseBrief(cwd);
  assert.match(brief, /paused `p`/);
  assert.doesNotMatch(brief, /deferral/);
});

test("honcho-memory push discloses a repeat deferral on stderr, leaving stdout paste-clean", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  seed(cwd, [epic("p", { links: [{ type: "may-invalidate", epic: "d1" }, { type: "may-invalidate", epic: "d2" }] }),
    epic("d1"), epic("d2")]);
  const combined = runCombined(["honcho-memory", "push", "p", "a blocker"], { cwd });
  assert.match(combined, /2nd deferral/);
  assert.match(combined, /d1, d2/);
  // The stdout contract is a line an agent pastes into Honcho verbatim; a disclosure that
  // leaked into it would be pasted too.
  assert.equal(run(["honcho-memory", "push", "p", "a blocker"], { cwd }), "paused p for a blocker\n");
});

test("honcho-memory push says nothing extra on a first deferral", () => {
  const cwd = tmpRepo();
  run(["init"], { cwd });
  seed(cwd, [epic("p", { links: [{ type: "may-invalidate", epic: "d1" }] }), epic("d1")]);
  assert.doesNotMatch(runCombined(["honcho-memory", "push", "p", "a blocker"], { cwd }), /deferral/);
});
