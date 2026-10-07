// scripts/test/unit/execution-profile-parser.test.mjs
// execution-profile-layered-settings 1.2 — the shared `<role>=<model>[:<effort>]` and `<field>` parsers.
// UNIT RUNG: values in, values out.

import assert from "node:assert/strict";
import { unitTest } from "../fixtures/unit-harness.mjs";

const load = () => import(new URL("../../lib/execution-profile.mjs", import.meta.url).href);

unitTest("a model pair with an effort parses to the whole pair", async () => {
  const { parseModelPair } = await load();
  assert.deepEqual(parseModelPair("implement=sonnet:medium"),
    { ok: true, role: "implement", value: { model: "sonnet", effort: "medium" } });
  assert.deepEqual(parseModelPair("review=opus:ultracode").value, { model: "opus", effort: "ultracode" });
});

unitTest("haiku without an effort parses to a pair with no effort key", async () => {
  const { parseModelPair } = await load();
  const r = parseModelPair("test=haiku");
  assert.deepEqual(r, { ok: true, role: "test", value: { model: "haiku" } });
  assert.ok(!("effort" in r.value));
});

unitTest("haiku with an effort is refused, naming haiku as a model that takes no effort", async () => {
  const { parseModelPair } = await load();
  const r = parseModelPair("test=haiku:low");
  assert.equal(r.ok, false);
  assert.match(r.message, /haiku is a model that takes no effort/);
});

unitTest("a non-haiku model without an effort is refused, naming the accepted efforts", async () => {
  const { parseModelPair } = await load();
  const r = parseModelPair("review=opus");
  assert.equal(r.ok, false);
  assert.match(r.message, /low\|medium\|high\|xhigh\|max\|ultracode/);
});

unitTest("an unknown role, model or effort is refused naming the offender and the accepted list", async () => {
  const { parseModelPair } = await load();
  let r = parseModelPair("deploy=opus:medium");
  assert.match(r.message, /'deploy'.*implement\|test\|review/);
  r = parseModelPair("implement=gpt:high");
  assert.match(r.message, /'gpt'.*fable\|opus\|sonnet\|haiku/);
  r = parseModelPair("implement=opus:huge");
  assert.match(r.message, /'huge'.*low\|medium\|high\|xhigh\|max\|ultracode/);
  r = parseModelPair("implement");
  assert.equal(r.ok, false);
  assert.match(r.message, /<role>=<model>/);
});

unitTest("review and verbosity values are checked against their lists", async () => {
  const { checkReview, checkVerbosity } = await load();
  assert.equal(checkReview("thorough").ok, true);
  assert.match(checkReview("max").message, /off\|standard\|thorough/);
  assert.equal(checkVerbosity("verbose").ok, true);
  assert.match(checkVerbosity("loud").message, /'loud'.*quiet\|verbose/);
});

unitTest("the unset field grammar is review | verbosity | model | model:<role>", async () => {
  const { parseUnsetField } = await load();
  assert.deepEqual(parseUnsetField("review"), { ok: true, field: "review" });
  assert.deepEqual(parseUnsetField("verbosity"), { ok: true, field: "verbosity" });
  assert.deepEqual(parseUnsetField("model"), { ok: true, field: "model" });
  assert.deepEqual(parseUnsetField("model:test"), { ok: true, field: "model", role: "test" });
  assert.match(parseUnsetField("model:deploy").message, /implement\|test\|review/);
  assert.match(parseUnsetField("colour").message, /review\|verbosity\|model\|model:<role>/);
});
