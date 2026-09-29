// Task 7.2: the after-measure with the SHIPPED derivation. For every non-merge commit in <base>..<head>,
// judge the commit with the functions drift judges a commit with, imported from THIS checkout's
// scripts/test/certification.mjs: `bucketDemanded()` over `bucketSubject(bucket)` of the commit's own
// tree (subject(index)), and of its first parent's tree (subject(HEAD), which judges a deletion).
// Each tree is read through a reader of the shape drift's `indexReaders()` returns, backed by
// `ls-tree` + `cat-file --batch` (cached by blob id), so no checkout is made.
// usage: node measure-shipped.mjs <repo> <base> <head>
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const [repo, base, head] = process.argv.slice(2);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const cert = await import(pathToFileURL(path.resolve(HERE, "../../../scripts/test/certification.mjs")).href);
const git = (args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 512 << 20 });

const blobs = new Map();
function readBlobs(ids) {
  const need = [...new Set(ids)].filter((id) => !blobs.has(id));
  if (!need.length) return;
  const out = execFileSync("git", ["-C", repo, "cat-file", "--batch"], { input: need.join("\n") + "\n", maxBuffer: 1 << 30 });
  let i = 0;
  while (i < out.length) {
    const nl = out.indexOf(10, i);
    const [id, , size] = out.subarray(i, nl).toString().split(" ");
    const n = Number(size);
    blobs.set(id, out.subarray(nl + 1, nl + 1 + n).toString("utf8"));
    i = nl + 1 + n + 1;
  }
}

const ROOT = "/measured-tree";
const trees = new Map();
function treeReaders(commit) {
  if (trees.has(commit)) return trees.get(commit);
  const entries = new Map();
  for (const rec of git(["ls-tree", "-r", "-z", commit]).split("\0").filter(Boolean)) {
    const tab = rec.indexOf("\t");
    const [, type, id] = rec.slice(0, tab).split(" ");
    if (type === "blob") entries.set(rec.slice(tab + 1), id);
  }
  readBlobs([...entries.values()]);
  const paths = [...entries.keys()];
  const rel = (abs) => path.posix.relative(ROOT, abs);
  const readdir = (abs) => {
    const prefix = rel(abs) ? `${rel(abs)}/` : "";
    const names = new Set();
    for (const f of paths) if (f.startsWith(prefix)) names.add(f.slice(prefix.length).split("/")[0]);
    return [...names].sort();
  };
  const readFile = (abs) => (entries.has(rel(abs)) ? blobs.get(entries.get(rel(abs))) : "");
  const r = { root: ROOT, readdir, readFile, paths };
  trees.set(commit, r);
  return r;
}

const commits = git(["rev-list", "--no-merges", "--reverse", `${base}..${head}`]).split("\n").filter(Boolean);
const tally = { functional: 0, sweeps: 0, either: 0, errors: 0, deletionOnlyDemands: 0 };
const perCommit = [];
for (const c of commits) {
  const parent = git(["rev-list", "--parents", "-n", "1", c]).trim().split(" ")[1];
  const staged = git(["diff", "--name-only", "--no-renames", parent || "4b825dc642cb6eb9a060e54bf8d69288fbee4904", c]).split("\n").filter(Boolean);
  const now = treeReaders(c);
  const row = { c: c.slice(0, 8) };
  try {
    for (const bucket of cert.BUCKETS) {
      const args = {
        stagedPaths: staged,
        indexPaths: new Set(now.paths),
        subjectIndex: () => cert.bucketSubject(bucket, now),
        subjectHead: () => (parent ? cert.bucketSubject(bucket, treeReaders(parent)) : []),
      };
      const demanded = cert.demandedPaths(args);
      row[bucket] = demanded.length > 0;
      if (row[bucket]) tally[bucket]++;
      if (bucket === "functional" && demanded.length && demanded.every((p) => !now.paths.includes(p))) tally.deletionOnlyDemands++;
    }
    if (row.functional || row.sweeps) tally.either++;
  } catch (e) {
    row.error = String(e && e.message).split("\n")[0];
    tally.errors++;
  }
  perCommit.push(row);
}
const headTree = treeReaders(git(["rev-parse", head]).trim());
const out = {
  range: `${base}..${head}`,
  derivation: "SHIPPED bucketSubject()/demandedPaths() from this checkout's scripts/test/certification.mjs",
  nonMergeCommits: commits.length,
  functionalDemanded: tally.functional,
  sweepsDemanded: tally.sweeps,
  eitherDemanded: tally.either,
  functionalDemandedOnlyByADeletion: tally.deletionOnlyDemands,
  derivationErrors: tally.errors,
  headSubjectSizes: { functional: cert.bucketSubject("functional", headTree).length, sweeps: cert.bucketSubject("sweeps", headTree).length },
  errors: perCommit.filter((r) => r.error),
  perCommit,
};
process.stdout.write(JSON.stringify(out, null, 1) + "\n");
