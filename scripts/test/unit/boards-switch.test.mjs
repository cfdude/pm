// scripts/test/unit/boards-switch.test.mjs
// project-boards 5.1 (spec feature-switches): the boards switch as VALUES. UNIT rung. A successful `set-boards` refreshes CLAUDE.md,
// which the unit rung's guard refuses, so this file drives the PURE `applyBoards()` and the readers, and the verb only for its
// REFUSALS and for `board --json` while off. The bytes a switch leaves behind are in assert/boards-switch.test.mjs.

import assert from "node:assert/strict";
import { emptyRecord, expectFail, memoryEngine, unitTest } from "../fixtures/unit-harness.mjs";
import { applyBoards } from "../../lib/set-boards.mjs";
import { BOARDS_RELEASE, boardsBriefLine, boardsEnabled, boardsSectionText } from "../../lib/boards-switch.mjs";
import { OPT_INS, boardsAnnouncement, optInLines } from "../../lib/opt-ins.mjs";
import { VERB_EFFECTS } from "../../lib/verb-effects.mjs";

unitTest("5.1 an absent setting reads as on, and only a recorded off turns the boards off", () => {
  assert.equal(boardsEnabled(emptyRecord()), true);
  assert.equal(boardsEnabled({ boards: {} }), true);
  assert.equal(boardsEnabled({ boards: { enabled: false } }), false);
  assert.ok(boardsSectionText(emptyRecord()).startsWith("## Boards"));
  assert.equal(boardsSectionText({ boards: { enabled: false } }), "");
  assert.equal(boardsBriefLine({ boards: { enabled: false } }), "");
});

unitTest("5.1 set-boards off then on is an exact inverse: the record is byte-identical to the one that never touched the switch", () => {
  const s = emptyRecord();
  const before = JSON.stringify(s);
  assert.equal(applyBoards(s, "off"), true);
  assert.deepEqual(s.boards, { enabled: false });
  assert.equal(applyBoards(s, "on"), true);
  assert.equal(JSON.stringify(s), before, "on removes the setting rather than writing enabled: true");
});

unitTest("5.1 a repeat of either direction changes nothing", () => {
  const s = emptyRecord();
  assert.equal(applyBoards(s, "on"), false, "on over an absent setting is already on");
  assert.equal(s.boards, undefined, "init and `on` never write the setting");
  applyBoards(s, "off");
  const once = JSON.stringify(s);
  assert.equal(applyBoards(s, "off"), false);
  assert.equal(JSON.stringify(s), once);
});

unitTest("5.1 anything but on|off, and a missing argument, is refused naming on|off, and writes nothing", () => {
  const engine = memoryEngine(emptyRecord());
  const before = JSON.stringify(engine.store.record());
  assert.match(expectFail(() => engine(["set-boards", "maybe"])).stderr, /on\|off/);
  expectFail(() => engine(["set-boards"]));
  expectFail(() => engine(["set-boards", "on", "off"]));
  expectFail(() => engine(["set-boards", "--on"]));
  assert.equal(JSON.stringify(engine.store.record()), before);
});

unitTest("5.1 the OPT_INS row for boards names the verb and the command doc, is adopted by default, and has a runnable example", () => {
  const row = OPT_INS.find((o) => o.id === "boards");
  assert.ok(row, "a boards row");
  assert.equal(row.verb, "set-boards");
  assert.equal(row.doc, "boards");
  assert.equal(row.isSet(emptyRecord()), true, "default on counts as adopted");
  assert.equal(row.isSet({ boards: { enabled: false } }), false);
  assert.equal(row.describe(emptyRecord()), "boards: on (default)");
  assert.deepEqual(row.example.slice(0, 1), ["set-boards"]);
  assert.ok(row.example.length === 2 && ["on", "off"].includes(row.example[1]), "an argv the engine accepts");
  assert.ok(row.command.startsWith("set-boards"));
});

unitTest("5.1 a fresh record lists boards as on (default); a repo that turned them off is told how to turn them back on", () => {
  assert.match(optInLines(emptyRecord())[0], /boards: on \(default\)/);
  const off = optInLines({ ...emptyRecord(), boards: { enabled: false } });
  assert.ok(off.some((l) => /NOT SET: boards/.test(l) && /set-boards on/.test(l)), JSON.stringify(off));
});

unitTest("5.1 the upgrade announcement appears only when crossing from below the release that adds the switch", () => {
  assert.equal(BOARDS_RELEASE, "0.55.0");
  const line = boardsAnnouncement("0.54.0", "0.55.0");
  assert.match(line, /boards are ON by default/);
  assert.match(line, /set-boards off/);
  assert.equal(boardsAnnouncement("0.55.0", "0.55.0"), "", "starting at the release: nothing");
  assert.equal(boardsAnnouncement("0.56.1", "0.57.0"), "", "starting above it: nothing");
  assert.match(boardsAnnouncement("0.0.0", "0.56.0"), /set-boards off/, "an unstamped repo crosses it too");
  assert.equal(boardsAnnouncement("0.53.0", "0.54.0"), "", "an upgrade that does not reach the release does not announce it");
  assert.equal(boardsAnnouncement(undefined, "0.55.0"), "");
});

unitTest("5.1 the export still works while boards are off", () => {
  const engine = memoryEngine({ ...emptyRecord(), boards: { enabled: false } });
  const r = engine.result(["board", "--json"]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).boardsEnabled, false);
});

unitTest("5.1 set-boards is a mutating verb that rewrites the block itself", () => {
  assert.equal(VERB_EFFECTS["set-boards"].effect, "mutates");
});
