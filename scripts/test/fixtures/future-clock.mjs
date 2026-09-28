// scripts/test/fixtures/future-clock.mjs
// THE CLOCK-SHIFT PRELOAD. Dev-only, never shipped. It moves this process's idea of "now" forward by
// `PM_TEST_CLOCK_OFFSET_DAYS` whole days, so a test that only passes on the day it was written is
// caught the day it was written rather than the day the calendar reaches it.
//
//   PM_TEST_CLOCK_OFFSET_DAYS=400 NODE_OPTIONS="--import $PWD/scripts/test/fixtures/future-clock.mjs" \
//     node --test scripts/test/unit/*.test.mjs scripts/test/assert/*.test.mjs
//
// WHY NODE_OPTIONS AND NOT `--import` ON THE RUNNER: the runner starts one process per test file, and
// a test may spawn the engine as a node child. `--import` on the runner's own argv reaches neither;
// NODE_OPTIONS is inherited by every node process started under it, so the whole tree shares one
// shifted clock. Git's own dates stay real, and that is deliberate: this simulates the SUITE running
// on a later day, not a machine whose every clock is wrong.
//
// WHAT IS SHIFTED: `Date.now()`, `new Date()` with NO argument, and `Date()` called as a function.
// `new Date(<anything>)` is untouched — a fixture that names a date means that date. Unset or `0`, this
// module changes nothing.
//
// Introduced 2026-09-28 after 0.50.0's archive date rule turned every fixture with a hardcoded archive
// directory date into a time bomb: green on the day of the release, red on every commit two days later.

const days = Number(process.env.PM_TEST_CLOCK_OFFSET_DAYS || 0);
if (!Number.isFinite(days)) throw new Error(`future-clock: PM_TEST_CLOCK_OFFSET_DAYS is not a number: ${process.env.PM_TEST_CLOCK_OFFSET_DAYS}`);

if (days !== 0) {
  const OFFSET = days * 86_400_000;
  const RealDate = globalThis.Date;
  const realNow = RealDate.now.bind(RealDate);
  const shiftedNow = () => realNow() + OFFSET;
  globalThis.Date = new Proxy(RealDate, {
    construct(target, args, newTarget) {
      return Reflect.construct(target, args.length ? args : [shiftedNow()], newTarget === globalThis.Date ? target : newTarget);
    },
    apply() {
      return new RealDate(shiftedNow()).toString();
    },
    get(target, prop, receiver) {
      if (prop === "now") return shiftedNow;
      return Reflect.get(target, prop, receiver);
    },
  });
}
