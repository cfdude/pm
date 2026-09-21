// scripts/test/fixtures/functional-harness.mjs
// THE FUNCTIONAL HALF'S BINDING (task 5.1). Everything a test needs from `fixtures/helpers.mjs`,
// with `run`/`runCombined` bound to the in-process entry point and NO gateway injected — so
// `lib/invocation.mjs` builds the REAL one over the invocation's own context and every git call the
// engine makes is the real git against the fixture's real repository.
//
// THAT IS THE HALF'S SUBJECT, and it is why the invocation is still in-process rather than a spawn:
// what the functional half has to exercise is the REAL GATEWAY, not the process boundary. The
// boundary is exercised where the boundary IS the subject — the conformance set's CLI route and the
// hook verbs' end-to-end invocations, each of which spawns for itself.

export * from "./helpers.mjs";

import { makeHarness, setRunner } from "./harness.mjs";

const harness = makeHarness({ fake: false });
export const run = harness.run;
export const runCombined = harness.runCombined;
// For a test that needs the STATUS rather than the throwing form — the same in-process
// invocation `run` is built on, and the shape a local `spawnSync` helper returned.
export const invokeEngine = harness.invokeEngine;
// Registered so the helpers that drive the engine themselves (parseBrief, setupHierarchy,
// nudgeAndReadLog) use THIS half's run rather than a second route.
setRunner(harness.run);
