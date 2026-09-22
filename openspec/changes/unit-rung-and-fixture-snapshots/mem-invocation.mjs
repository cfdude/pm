// Task 6.5 — one engine invocation over the MEMORY store, in-process, n = 200.
// The unit rung's acceptance unit: "~1 ms per unit-rung test" is measured against this,
// because a unit-rung TEST is one or more of these.
//
//   node .../mem-invocation.mjs
//
// Reads the repo by absolute path; writes nothing anywhere. `pwd` is the scratch dir.
import path from "node:path";

const REPO = "/Users/robsherman/Documents/Repos/pm";
if (process.cwd().startsWith(REPO)) {
  console.error("refusing to run from inside the pm repo");
  process.exit(2);
}

const { invokeEngine } = await import(path.join(REPO, "scripts/test/fixtures/assert-harness.mjs"));
const { memoryStore } = await import(path.join(REPO, "scripts/lib/store.mjs"));
const { emptyRecord } = await import(path.join(REPO, "scripts/test/fixtures/unit-harness.mjs"));

const VIRTUAL_ROOT = "/pm-unit-rung/no-such-directory";

const percentiles = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { p25: q(0.25), median: q(0.5), p75: q(0.75), p90: q(0.9), max: s[s.length - 1] };
};

function measure(label, build, args, n) {
  const ts = [];
  for (let i = 0; i < n; i++) {
    const store = memoryStore(build());
    const t0 = process.hrtime.bigint();
    const r = invokeEngine(args, { cwd: VIRTUAL_ROOT, store });
    const t1 = process.hrtime.bigint();
    if (r.status !== 0) { console.error(`${label} FAILED: ${r.stderr}`); process.exit(1); }
    ts.push(Number(t1 - t0) / 1e6);
  }
  const p = percentiles(ts);
  console.log(
    `${label.padEnd(34)} n=${n}  median=${p.median.toFixed(3)} ms  ` +
    `p25=${p.p25.toFixed(3)}  p75=${p.p75.toFixed(3)}  p90=${p.p90.toFixed(3)}  max=${p.max.toFixed(3)}`,
  );
  return p;
}

// 1. An EMPTY record — the floor the rung starts from.
//
// `init` is deliberately NOT here: it calls `ensureGitignore()`, which writes `.gitignore`
// through raw `fs` (`scripts/lib/subcommands.mjs:90`), so it CANNOT be invoked over the memory
// store at all — `memoryStore()` gives `resolve() === null` and the write lands on
// `/pm-unit-rung/no-such-directory/.gitignore` and throws ENOENT. That is one of the seam edges
// the migration's `stayed` columns are made of, and it is why the unit rung's `repo()` helper
// seeds `emptyRecord()` and calls `add-epic` rather than initializing a directory.
measure("add-epic over an empty record", () => emptyRecord(),
  ["add-epic", "--id", "a", "--lane", "claude-code"], 200);

// 2. a small record: the shape most migrated fixtures build.
const small = () => {
  const s = emptyRecord();
  s.epics = ["p", "d", "d2", "other", "x"].map((id) => ({
    id, lane: "claude-code", status: "planned", createdAt: "2026-09-22T00:00:00.000Z",
    touchedAt: "2026-09-22T00:00:00.000Z", disposition: null, autoresolve: null, links: [],
  }));
  s.active = "p";
  return s;
};
measure("brief over a 5-epic record", small, ["brief"], 200);

// 3. the write path on the same shape — the one every migrated fixture pays 5 times.
measure("add-epic over a 5-epic record", small,
  ["add-epic", "--id", "z", "--lane", "claude-code"], 200);

// 4. A RECORD-RUN, not one call: what `owingRepo()` actually costs, since reconcile-obligation
//    builds it 42 times and is the rung's most expensive file.
function owingBuild() {
  const store = memoryStore(emptyRecord());
  const call = (args) => {
    const r = invokeEngine(args, { cwd: VIRTUAL_ROOT, store });
    if (r.status !== 0) { console.error(`owingRepo step failed: ${args.join(" ")}\n${r.stderr}`); process.exit(1); }
  };
  for (const id of ["p", "d", "d2", "other", "x"]) call(["add-epic", "--id", id, "--lane", "claude-code"]);
  call(["set-active", "p"]);
  call(["push-detour", "p", "--detour", "d", "--reason", "r", "--reconcile"]);
  call(["pop-detour", "p"]);
  return store;
}
{
  const ts = [];
  for (let i = 0; i < 60; i++) {
    const t0 = process.hrtime.bigint();
    owingBuild();
    const t1 = process.hrtime.bigint();
    ts.push(Number(t1 - t0) / 1e6);
  }
  const p = percentiles(ts);
  console.log(
    `owingRepo() build, 9 invocations   n=60  median=${p.median.toFixed(3)} ms  ` +
    `p25=${p.p25.toFixed(3)}  p75=${p.p75.toFixed(3)}  p90=${p.p90.toFixed(3)}  max=${p.max.toFixed(3)}`,
  );
}
