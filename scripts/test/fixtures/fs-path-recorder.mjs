// scripts/test/fixtures/fs-path-recorder.mjs
// RECORD EVERY PATH THE ENGINE TOUCHES during one call — the observer for "a disabled repo pays
// nothing on any hot path" (token-spend-tracking-per-epic, task 3.4).
//
// WHY NOT fs-work-counter.mjs. That counter answers a narrower question — did a UNIT test do
// filesystem work — and keeps only writes and the test's own reads. This one keeps every path any
// wrapped call received, from any depth, so a test can assert that NOTHING under a given directory was
// opened, stat'ed, listed or probed with `existsSync`. (`observe-reads.mjs` is certify's own observer
// and cannot see paths nobody tracked.)
//
// SCOPE: it wraps the `fs` default export's callable members for the duration of ONE synchronous
// call and restores them, so layering over fs-work-counter's wrappers is safe. Like that counter, its
// known limit is a module that captured an `fs` function before the wrap; the engine's modules all
// call through the `fs` object, which is what makes the observation meaningful.

import fs from "node:fs";

const NAMES = [
  "readFileSync", "readdirSync", "statSync", "lstatSync", "existsSync", "accessSync", "openSync",
  "readlinkSync", "realpathSync", "opendirSync", "createReadStream", "readSync", "fstatSync",
  "writeFileSync", "appendFileSync", "mkdirSync", "rmSync", "rmdirSync", "unlinkSync", "renameSync",
  "copyFileSync", "cpSync", "truncateSync", "chmodSync", "symlinkSync", "linkSync", "mkdtempSync", "utimesSync",
];

/** Run `fn` and return `{ result, touched }` — every string / URL path argument, in call order. */
export function recordFsPaths(fn) {
  const touched = [];
  const originals = new Map();
  for (const name of NAMES) {
    const original = fs[name];
    if (typeof original !== "function") continue;
    originals.set(name, original);
    fs[name] = function (...args) {
      const p = args[0];
      if (typeof p === "string") touched.push(p);
      else if (p instanceof URL) touched.push(p.pathname);
      else if (Buffer.isBuffer(p)) touched.push(p.toString());
      return original.apply(fs, args);
    };
  }
  try {
    return { result: fn(), touched };
  } finally {
    for (const [name, original] of originals) fs[name] = original;
  }
}

/** The recorded paths that sit under any of `dirs`. */
export const touchedUnder = (touched, ...dirs) => touched.filter((p) => dirs.some((d) => p === d || p.startsWith(d.endsWith("/") ? d : d + "/")));
