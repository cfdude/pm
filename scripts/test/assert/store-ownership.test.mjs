// scripts/test/assert/store-ownership.test.mjs
// 5.2 — DATA REFERENCES ARE CALL SITES, and the ownership table must not be maintained by hand.
//
// WHAT THIS IS FOR. The store's ownership table (design D1, and `store.mjs`'s header) names the
// artifacts the seam owns and, just as importantly, the ones it does NOT own — each with a reason.
// A table like that is exactly the stale enumeration this repository's lesson set is built on: it is
// written once from the write sites that existed THAT day, and the next module to write a file into
// `.conductor/` is a write site the table has never heard of. Nothing about reading the table can
// notice, because the omission is an ABSENT edit — the class both review gates are structurally
// unable to see.
//
// SO THE TABLE IS CHECKED AGAINST THE SOURCE. Every raw filesystem MUTATION in the engine is
// enumerated mechanically, and each one must be either (a) inside the store itself, or (b) named in
// the allowlist below WITH its reason. A new one anywhere else fails this test by name.
//
// WHAT IS DERIVED AND WHAT IS ASSERTED, stated because 5.2 asks for it explicitly: the WRITE SITES
// are derived — they come from the source, every run. The TABLE is asserted — it is a list of
// artifact + reason here, and what this test proves about it is that it agrees with the source. The
// direction matters: a table that DERIVED its own names from the source could never fail, and one
// that is asserted against the source fails the moment a write site moves into the engine without a
// decision being taken about it.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** The call shapes that put bytes on a disk or take a path away. Reads are deliberately absent: this
 *  check is about what the engine PERSISTS, and a read of a repository file is the engine's normal
 *  business (design D1 says so, and the unit rung's run-time counter is where those are reasoned
 *  about). */
const MUTATIONS = [
  "writeFileSync", "appendFileSync", "rmSync", "unlinkSync", "renameSync", "mkdirSync",
  "cpSync", "fsyncSync", "writeSync", "truncateSync", "chmodSync", "symlinkSync", "mkdtempSync",
];

/** Files whose raw filesystem mutations are legitimate, each with the REASON it is not the store —
 *  the same list design D1's table carries, in the form a check can read. */
const ALLOWED = {
  "scripts/lib/store.mjs":
    "the store ITSELF — the disk implementation is where the record's paths are legitimately written",
  "scripts/lib/rules.mjs":
    "`CLAUDE.md`'s managed block: a REPOSITORY file the engine writes into the repository, not into " +
    "the conductor record (design D1's does-NOT-own table)",
  "scripts/lib/subcommands.mjs":
    "`.gitignore` line management, reached through `platform.mjs`'s `ensureGitignore`; a repository " +
    "file, not a record, for the same reason as the rules block",
  "scripts/lib/commit-watch.mjs":
    "`.conductor/commit-observe.json` and its `.lock`: the lock's identity is an inode and a nonce " +
    "and it is broken by a stale-age rule reading the file's mtime — a filesystem primitive with no " +
    "in-memory meaning, and the record is useless without it (design D1)",
  "scripts/lib/activity-log.mjs":
    "activity retention's REMOVAL (`pruneToCap`), which takes a CALLER-SUPPLIED DIRECTORY — the suite " +
    "exercises exactly that against a scratch dir, and an artifact-keyed interface cannot name a file " +
    "in a directory the invocation does not own (design D1)",
};

function engineFiles() {
  const lib = path.join(REPO, "scripts", "lib");
  return [
    "scripts/conductor.mjs",
    ...fs.readdirSync(lib).filter((f) => f.endsWith(".mjs")).sort().map((f) => `scripts/lib/${f}`),
  ];
}

/** Every `fs.<mutation>(` in the engine, as `{ file, line }`. The call must be a MEMBER call on an
 *  identifier named `fs` — the shape every module in this engine uses — so a mention inside prose
 *  does not count and a local helper named like one of these would not be mistaken for one. */
export function mutationSites(read = (rel) => fs.readFileSync(path.join(REPO, rel), "utf8")) {
  const found = [];
  const re = new RegExp(`\\bfs\\.(${MUTATIONS.join("|")})\\s*\\(`, "g");
  for (const rel of engineFiles()) {
    const src = read(rel);
    for (const m of src.matchAll(re)) {
      found.push({ file: rel, op: m[1], line: src.slice(0, m.index).split("\n").length });
    }
  }
  return found;
}

/** The files with a mutation site that the allowlist does not name — the finding, by name. */
export function unnamedWriteSites(sites = mutationSites(), allowed = ALLOWED) {
  return [...new Set(sites.map((s) => s.file))].filter((f) => !(f in allowed)).sort();
}

test("5.2 every raw filesystem mutation in the engine is the store's or is named with its reason", () => {
  const unnamed = unnamedWriteSites();
  assert.deepEqual(unnamed, [],
    "a raw filesystem mutation outside the store is a WRITE SITE the ownership table does not name. " +
    "Move it onto the store's interface, or add it to ALLOWED in this file with the reason it is " +
    "not the store's — design D1's does-NOT-own list is the same decision written for a reader, and " +
    "the two must not be allowed to disagree silently.\n" +
    "Found in: " + unnamed.join(", "));
});

test("5.2 the sweep reaches the engine, so an empty walk cannot pass vacuously", () => {
  const sites = mutationSites();
  // A walk over nothing passes every assertion above. The floor is the store's own sites, which are
  // the ones this check is BUILT on: if the store stopped being scanned, the allowlist entry for it
  // would look like compliance rather than blindness.
  const inStore = sites.filter((s) => s.file === "scripts/lib/store.mjs");
  assert.ok(inStore.length >= 10,
    `the sweep found ${inStore.length} mutation sites in store.mjs; the disk implementation IS the ` +
    "sites this check exists to allow, and a walk that cannot see them is not checking anything");
  const files = new Set(sites.map((s) => s.file));
  assert.ok(files.size >= 4,
    `the sweep reached ${files.size} file(s); the engine writes in the store and in three named ` +
    "places, and a sweep that reached fewer is a sweep with a broken path");
});

test("5.2 the check DISCRIMINATES — an unnamed write site is refused BY NAME, with its reason", () => {
  // The deliberate violation, kept as a test: the same sweep, fed a source that writes into the
  // record directory from a module the table has never heard of.
  const fake = mutationSites((rel) => (rel === "scripts/lib/gate-guard.mjs"
    ? 'const fs = require("node:fs");\nfs.writeFileSync("/x/.conductor/whatever.log", "x");\n'
    : fs.readFileSync(path.join(REPO, rel), "utf8")));
  const unnamed = unnamedWriteSites(fake);
  assert.deepEqual(unnamed, ["scripts/lib/gate-guard.mjs"],
    "an unnamed write site must be reported, and reported by FILE — a finding that named the call " +
    "rather than the module would send a reader to a line instead of to a decision");
  // And a site the allowlist DOES name is not reported: the check must not be satisfied only by
  // having no write sites at all, which is the shape that would make it vacuous rather than strict.
  assert.deepEqual(unnamedWriteSites(fake.filter((s) => s.file !== "scripts/lib/gate-guard.mjs")), []);
});
