// scripts/test/unit/quoted-dash-text-hint.test.mjs
// gh-cfdude-pm-207: a free-text value that begins with -- and was ALREADY quoted is refused, and the
// old hint ("quote the whole value") cannot help because the shell removed the quotes. The hint must
// name the = form where the verb has one, and say to reword where it has not.

import assert from "node:assert/strict";
import { unitTest } from "../fixtures/unit-harness.mjs";
import { checkCommandLine } from "../../lib/argv-surface.mjs";

const line = (...tokens) => ["node", "conductor.mjs", ...tokens];
const refuse = (...tokens) => {
  const v = checkCommandLine(tokens[0], line(...tokens), { initialized: true });
  assert.equal(v.kind, "refuse", tokens.join(" "));
  return v.message;
};

unitTest("207: a quoted value starting with -- on suggest-lane names the --ask= form", () => {
  const m = refuse("suggest-lane", "--limit=5 ignored");
  assert.match(m, /arrived as one quoted value/);
  assert.match(m, /suggest-lane --ask='--limit=5 ignored'/);
  assert.doesNotMatch(m, /quote the whole value/);
  assert.match(m, /Nothing was written\.$/);
});

unitTest("207: the = form it names is accepted by the same check", () => {
  const v = checkCommandLine("suggest-lane", line("suggest-lane", "--ask=--limit=5 ignored"), { initialized: true });
  assert.equal(v.kind, "ok");
});

unitTest("207: a free-text verb with no = form says to reword, not to quote", () => {
  const m = refuse("log-detour", "--bogus=5 ignored");
  assert.match(m, /arrived as one quoted value/);
  assert.match(m, /Reword so the text does not start with --/);
  assert.doesNotMatch(m, /quote the whole value/);
});

unitTest("207: an UNQUOTED flag-shaped word keeps the quoting hint, which is true for it", () => {
  const m = refuse("log-detour", "fixed", "--no-verify", "usage");
  assert.match(m, /'--no-verify' is part of the text, quote the whole value\./);
});
