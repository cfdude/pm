// scripts/test/fixtures/assert-harness.mjs
// THE ASSERTION HALF'S BINDING (task 5.1). Everything a test needs from `fixtures/helpers.mjs`,
// with `run`/`runCombined` bound to the in-process entry point AND to the git double.
//
// THE DOUBLE MODELS "there is no repository here", which is the truth about every assertion-half
// invocation: the half runs against a fresh temporary directory, and a test whose subject needs a
// real repository is in the functional half instead (design D5). See `fakeGit({noRepository:true})`
// and the frozen `noRepository` section of the capture, which 4.4 proves byte-identical to the real
// git's answers in exactly that world.
//
// THE ONE IMPORT LINE a moved test needs is this module in place of `./helpers.mjs`; everything
// else it used is re-exported below.

export * from "./helpers.mjs";

import { makeHarness, setRunner } from "./harness.mjs";

const harness = makeHarness({ fake: true });
export const run = harness.run;
export const runCombined = harness.runCombined;
// For a test that needs the STATUS rather than the throwing form — the same in-process
// invocation `run` is built on, and the shape a local `spawnSync` helper returned.
export const invokeEngine = harness.invokeEngine;
// Registered so the helpers that drive the engine themselves (parseBrief, setupHierarchy,
// nudgeAndReadLog) use THIS half's run rather than a second route.
setRunner(harness.run);
