// scripts/lib/claims.mjs
// #84 — the ADVISORY claim: who owns an epic right now, and is it safe to write in this repo.
//
// WHAT MAKES IT ADVISORY, PRECISELY. An advisory marker nobody honours is worse than none,
// because it looks like coordination. So exactly one surface honours it, and it is stated
// rather than implied:
//
//   * `claim` and `unclaim` REFUSE (exit 1) when another session's claim is LIVE. That refusal
//     is what makes the marker mean something — the claim verb is the coordination protocol,
//     and a protocol that never says no is a comment.
//   * NOTHING ELSE in the engine refuses anything because of a claim. `update-epic`,
//     `record-gate-review`, `sync`, the hooks — all proceed exactly as before against a claimed
//     epic. That is #84's own ruling ("it should make coordination expressible, not make pm
//     refuse to work when a marker is stale") and it is why the ENFORCEMENT half is a separate
//     issue (#83, optimistic concurrency on state.json, already shipped in saveState()).
//
// SO WHAT HAPPENS WHEN TWO SESSIONS BOTH CLAIM? The second one is told, by name, who holds it
// and until when, and exits non-zero having written NOTHING. It is not silent corruption
// because it is not a write. If it genuinely needs the epic it says so with `--steal`, which
// succeeds and reports the takeover on stderr. And if the two race so closely that both pass
// the holder check, saveState()'s revision guard catches the second — the two halves compose.
//
// WHAT EXPIRES A CLAIM. Its TTL, stated on the record itself (`ttlMinutes`) rather than read
// from a constant at inspection time, so a claim taken under one default keeps its own meaning
// when the default changes. Nothing sweeps expired claims: expiry is a READING of the record,
// not an edit to it, which is what lets `owners` and `integrity` agree without either of them
// writing. Re-claiming by the holder extends it. See constants.mjs for why this is a TTL and
// not #84's suggested `heartbeatAt`.
//
// WHAT REPORTS A STALE ONE. Three surfaces, and they read through the same predicates below:
// `owners` (the direct question), `integrity` (the audit — a live claim on an ARCHIVED epic is
// a shape that cannot be true), and the takeover message `claim` prints when it steps over one.
//
// WHERE EACH MARKER LIVES, and the split is deliberate:
//   * An EPIC claim lives on the epic in state.json. It is a fact about that epic, it wants the
//     revision guard, and `claim` is an interactive verb so a conflict throws.
//   * The REPO quiescence marker lives in a git-ignored SIDECAR, `.conductor/session-claim.json`.
//     Same argument write-conflicts.mjs opens with: it answers "is it safe to write to
//     state.json right now", so putting it INSIDE state.json — where setting and clearing it
//     bump `revision` and can themselves conflict — inverts the purpose of the marker.

import fs from "node:fs";
import path from "node:path";
import { isInitialized, loadState, saveState } from "./state.mjs";
import { CLAIM_DEFAULT_TTL_MINUTES, REPO_CLAIM_DEFAULT_TTL_MINUTES, epicFlagsFor } from "./constants.mjs";
import { parseFlags, requireFlagValues } from "./add-epic.mjs";
import { resolveSession, SESSION_HINT } from "./session-identity.mjs";
import { claimExpiry, isLiveClaim } from "./claim-shape.mjs";

export { claimExpiry, isLiveClaim };

export const CLAIM_FLAGS = epicFlagsFor("claim");
export const UNCLAIM_FLAGS = epicFlagsFor("unclaim");

/** The repo-level quiescence marker's path. Re-derived per call for the same reason
 *  write-conflicts.mjs does it: the tests cache-bust by moving CLAUDE_PROJECT_DIR. */
export function repoClaimPath() {
  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  return path.join(root, ".conductor", "session-claim.json");
}

/** A claim record, or null. Shape: {session, claimedAt, ttlMinutes}. */
function makeClaim(session, ttlMinutes) {
  return { session, claimedAt: new Date().toISOString(), ttlMinutes };
}

/** The repo marker as recorded, or null when absent/corrupt. */
export function readRepoClaim() {
  try {
    const c = JSON.parse(fs.readFileSync(repoClaimPath(), "utf8"));
    return c && typeof c === "object" && typeof c.session === "string" ? c : null;
  } catch { return null; }
}

function writeRepoClaim(claim) {
  const p = repoClaimPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(claim, null, 2) + "\n");
}

function clearRepoClaim() {
  try { fs.rmSync(repoClaimPath(), { force: true }); } catch { /* best effort */ }
}

function die(msg) {
  process.stderr.write(`conductor: ${msg}\n`);
  process.exit(1);
}

/** The shared refusal when someone else holds a LIVE claim. One phrasing, both verbs, so the
 *  two surfaces cannot describe the same situation differently. */
function refuseHeld(what, claim, verb) {
  die(`${what} is claimed by session '${claim.session}' since ${claim.claimedAt} ` +
    `(live until ${claimExpiry(claim)}). Nothing was written. ` +
    `Wait for it, or take it deliberately with \`${verb} … --steal\`.`);
}

/** Minutes from `--ttl`, validated. Refuses anything that is not a positive finite number: a
 *  `--ttl abc` silently falling back to the default would produce a claim whose stated lifetime
 *  is not the one the caller asked for, which is the record saying something nobody wrote. */
function ttlFrom(f, fallback) {
  if (f.ttl === undefined) return fallback;
  const n = Number(Array.isArray(f.ttl) ? f.ttl[f.ttl.length - 1] : f.ttl);
  if (!Number.isFinite(n) || n <= 0) die("--ttl requires a positive number of minutes");
  return n;
}

function unknownFlags(argv, known, verb) {
  for (const a of argv) {
    if (!a.startsWith("--")) continue;
    const k = a.slice(2);
    if (!known.includes(k)) die(`unknown flag --${k} for ${verb}`);
  }
}

// ─────────────────────────────── claim ───────────────────────────────

/** `claim <epicId> --session <name> [--ttl <minutes>] [--steal]`
 *  `claim --repo --session <name> [--ttl <minutes>] [--steal]` */
export function claim() {
  if (!isInitialized()) die("run /pm:init first");
  const argv = process.argv.slice(3);
  unknownFlags(argv, CLAIM_FLAGS, "claim");
  const f = parseFlags(argv);
  requireFlagValues("claim", f);

  const session = resolveSession(f);
  if (!session) die(`claim requires a session identity — ${SESSION_HINT}`);
  const steal = f.steal === true;
  // The epic id is a POSITIONAL, scanned rather than read off argv[0]: `claim --repo --session x`
  // has none at all, and `claim --session x e1` legitimately has one after two flags.
  const positional = positionalArgs(argv);

  if (f.repo === true) {
    if (positional.length) die("claim --repo takes no epic id — it marks the whole repository");
    const ttl = ttlFrom(f, REPO_CLAIM_DEFAULT_TTL_MINUTES);
    const held = readRepoClaim();
    if (held && held.session !== session && isLiveClaim(held) && !steal) {
      refuseHeld("this repository", held, "claim --repo");
    }
    if (held && held.session !== session) {
      process.stderr.write(
        `conductor: took over the repository marker from session '${held.session}' ` +
        `(${isLiveClaim(held) ? "STOLEN while live" : "its claim had expired"})\n`);
    }
    writeRepoClaim(makeClaim(session, ttl));
    process.stderr.write(
      `conductor: repository marked busy by '${session}' until ${claimExpiry(readRepoClaim())}\n`);
    return;
  }

  if (positional.length !== 1) {
    die("usage: conductor.mjs claim <epic-id> --session <name> [--ttl <minutes>] [--steal]\n" +
      "       conductor.mjs claim --repo --session <name> [--ttl <minutes>] [--steal]");
  }
  const epicId = positional[0];
  const ttl = ttlFrom(f, CLAIM_DEFAULT_TTL_MINUTES);
  const state = loadState();
  const epic = state.epics.find(e => e.id === epicId);
  if (!epic) die(`epic '${epicId}' not found`);
  // An ARCHIVED epic has ENDED. Claiming one would record ownership of work that is over, which
  // is the same dangling shape `integrity` reports below — refused at the source rather than
  // only audited after the fact.
  if (epic.status === "archived") die(`epic '${epicId}' is archived — there is no work to claim`);

  const held = epic.claim;
  if (held && held.session !== session && isLiveClaim(held) && !steal) {
    refuseHeld(`epic '${epicId}'`, held, "claim");
  }
  if (held && held.session !== session) {
    process.stderr.write(
      `conductor: took over '${epicId}' from session '${held.session}' ` +
      `(${isLiveClaim(held) ? "STOLEN while live" : "its claim had expired"})\n`);
  }
  epic.claim = makeClaim(session, ttl);
  saveState(state);
  process.stderr.write(
    `conductor: '${epicId}' claimed by '${session}' until ${claimExpiry(epic.claim)}\n`);
}

// ────────────────────────────── unclaim ──────────────────────────────

/** `unclaim <epicId> --session <name> [--steal]` / `unclaim --repo --session <name> [--steal]`
 *
 *  NOT named `release`: that verb already means "a version of this project" here.
 *
 *  Releasing a marker you do not hold is refused, because that is the move that turns an
 *  advisory marker into a lie — the holder keeps working believing it is still theirs. `--steal`
 *  is the deliberate override, and it says so on stderr.
 *
 *  Unclaiming something that is not claimed is a NO-OP that exits 0. It is idempotent on
 *  purpose: the natural caller is a session cleaning up on its way out, and a cleanup path that
 *  fails when there is nothing to clean up is a cleanup path people stop running. */
export function unclaim() {
  if (!isInitialized()) die("run /pm:init first");
  const argv = process.argv.slice(3);
  unknownFlags(argv, UNCLAIM_FLAGS, "unclaim");
  const f = parseFlags(argv);
  requireFlagValues("unclaim", f);

  const session = resolveSession(f);
  if (!session) die(`unclaim requires a session identity — ${SESSION_HINT}`);
  const steal = f.steal === true;
  const positional = positionalArgs(argv);

  if (f.repo === true) {
    if (positional.length) die("unclaim --repo takes no epic id — it clears the whole repository's marker");
    const held = readRepoClaim();
    if (!held) { process.stderr.write("conductor: the repository marker was not set — nothing to clear\n"); return; }
    if (held.session !== session && isLiveClaim(held) && !steal) {
      refuseHeld("this repository", held, "unclaim --repo");
    }
    if (held.session !== session) {
      process.stderr.write(`conductor: cleared a marker held by '${held.session}', not '${session}'\n`);
    }
    clearRepoClaim();
    process.stderr.write("conductor: repository marker cleared\n");
    return;
  }

  if (positional.length !== 1) {
    die("usage: conductor.mjs unclaim <epic-id> --session <name> [--steal]\n" +
      "       conductor.mjs unclaim --repo --session <name> [--steal]");
  }
  const epicId = positional[0];
  const state = loadState();
  const epic = state.epics.find(e => e.id === epicId);
  if (!epic) die(`epic '${epicId}' not found`);
  const held = epic.claim;
  if (!held) { process.stderr.write(`conductor: '${epicId}' was not claimed — nothing to release\n`); return; }
  if (held.session !== session && isLiveClaim(held) && !steal) {
    refuseHeld(`epic '${epicId}'`, held, "unclaim");
  }
  if (held.session !== session) {
    process.stderr.write(`conductor: cleared a claim held by '${held.session}', not '${session}'\n`);
  }
  delete epic.claim;
  saveState(state);
  process.stderr.write(`conductor: '${epicId}' released\n`);
}

// ─────────────────────────────── owners ──────────────────────────────

/** Every bare (non-flag, non-flag-value) argument. parseFlags consumes the token AFTER a flag
 *  as its value, so a naive "everything not starting with --" would read `--session` 's value as
 *  a positional epic id. Mirrors parseFlags' own scan exactly, which is why it lives beside it
 *  in shape rather than being re-derived from its output. */
export function positionalArgs(argv) {
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      if (argv[i + 1] !== undefined && !argv[i + 1].startsWith("--")) i++;
      continue;
    }
    out.push(a);
  }
  return out;
}

/** The report rows — pure, so the formatting and the reading are separately testable. */
export function ownerRows(state, repoClaim, now = Date.now()) {
  const rows = [];
  if (repoClaim) {
    rows.push({
      scope: "repo", id: null, session: repoClaim.session, claimedAt: repoClaim.claimedAt,
      expiresAt: claimExpiry(repoClaim), live: isLiveClaim(repoClaim, now),
    });
  }
  for (const e of state.epics || []) {
    if (!e.claim) continue;
    rows.push({
      scope: "epic", id: e.id, session: e.claim.session, claimedAt: e.claim.claimedAt,
      expiresAt: claimExpiry(e.claim), live: isLiveClaim(e.claim, now),
      epicStatus: e.status || null,
    });
  }
  return rows;
}

export function formatOwners(rows) {
  const L = ["OWNERS — advisory claims. Reported, never enforced: no other verb refuses because of one.", ""];
  if (!rows.length) {
    L.push("QUIESCENT — no repository marker and no epic claims.");
    L.push("");
    L.push("Quiescent means nothing has SAID it is mid-operation. It is a cooperative signal, not a lock:");
    L.push("a session that never claimed is invisible here.");
    return L.join("\n");
  }
  const repo = rows.find(r => r.scope === "repo");
  L.push(repo
    ? `repository: ${repo.live ? "BUSY" : "STALE"} — '${repo.session}' since ${repo.claimedAt}, ` +
      `${repo.live ? "live until" : "expired at"} ${repo.expiresAt}`
    : "repository: no marker set");
  L.push("");
  const epics = rows.filter(r => r.scope === "epic");
  L.push(`${epics.length} epic claim(s):`);
  for (const r of epics) {
    L.push(`  • \`${r.id}\` — ${r.live ? "HELD" : "STALE"} by '${r.session}' since ${r.claimedAt}, ` +
      `${r.live ? "live until" : "expired at"} ${r.expiresAt}` +
      (r.epicStatus === "archived" ? "  ⚠ epic is ARCHIVED" : ""));
  }
  const stale = rows.filter(r => !r.live).length;
  if (stale) {
    L.push("");
    L.push(`${stale} stale marker(s) — a session that died mid-epic looks exactly like this. ` +
      "Take one over with `claim <id> --session <you>`; it does not need --steal once expired.");
  }
  return L.join("\n");
}

/** `owners` — read-only. Writes nothing, renders nothing, exits 0 whatever it finds.
 *
 *  Deliberately does NOT call render(), for the reason integrity() does not: an orchestrator's
 *  whole use for this verb is inspecting a repo it does not own (#85), and a verb that dirtied
 *  that repo on the way to answering "is it safe to write here" would be answering its own
 *  question wrongly. */
export function owners() {
  if (!isInitialized()) die("run /pm:init first");
  const rows = ownerRows(loadState(), readRepoClaim());
  if (process.argv.includes("--json")) {
    process.stdout.write(JSON.stringify({ quiescent: rows.length === 0, claims: rows }, null, 2) + "\n");
    return;
  }
  process.stdout.write(formatOwners(rows) + "\n");
}
