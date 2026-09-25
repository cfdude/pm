// scripts/lib/triage.mjs
// INTAKE TRIAGE — the mechanical half of admitting an ask (gh-112).
//
// THE LINE THIS MODULE IS DRAWN ON, and the reason it can exist inside an instruction layer at
// all: **the engine computes a CANDIDATE SET and never a VERDICT.** Whether two asks are "the
// same ask" requires reading prose and holding intent, which is the interactive agent's job and
// is precisely what `pm` refuses to do in code. What is mechanical — and what the record needs
// before a human can judge anything — is the SET OF THINGS WORTH READING: which existing epics
// share distinctive vocabulary with this ask, which lane the repo's own routing picks for it,
// and what the backlog currently looks like as a whole. That is what this produces. It emits
// `verdict: null` as a machine-readable statement that the decision was not made here.
//
// Precedent: `suggest-lane` (lib/lane-routing.mjs) already does exactly this shape — it matches
// a repo's configured overrides against free text, prints what matched, and leaves the choice to
// the agent. This is the same mechanism applied to the backlog itself instead of to a rules list.
//
// Why lexical overlap and not something cleverer: it is deterministic, it is explainable (every
// candidate carries the tokens that put it there, so a reader can dismiss a bad hit in a second),
// and it needs no dependency, no network and no model. It is deliberately a RECALL device, not a
// precision one — its failure mode should be surfacing one epic too many, which costs a glance,
// never missing the twin, which costs a duplicate epic.

import { isInitialized, loadState } from "./state.mjs";
import { parseFlags, requireFlagValues } from "./add-epic.mjs";
import { laneSuggestion } from "./lane-routing.mjs";
import { supersededEpics } from "./links.mjs";
import { escapeControls, isFlagToken, jsonText } from "./constants.mjs";
import { checkedPositionals } from "./argv-surface.mjs";
import { die } from "./command-exit.mjs";
import { currentArgv, outStream } from "./invocation.mjs";

/** Words shorter than this carry no discriminating power and appear everywhere ("of", "to",
 *  "id", "pm"). A length floor is mechanical; a curated stopword list would be a second thing
 *  to keep current, and the weighting below already neutralizes common words on its own. */
const MIN_TOKEN_LENGTH = 3;

/** A token more than this share of the epics use carries no signal about WHICH epic — idfMap(). */
const COMMON_TOKEN_MAX_SHARE = 0.5;
/** …but only once the backlog is big enough for a share to be evidence rather than an accident. */
const COMMON_TOKEN_MIN_EPICS = 8;

/** Split free text into comparable tokens. Everything that is not a letter or digit is a
 *  separator, so `2026-07-14-epic-hierarchy-orchestration`, `conductor.mjs Module Split` and
 *  "Epic-Hierarchy Orchestration" all reduce to the same vocabulary — which is the whole point:
 *  the four duplicate pairs in this repository's own record differ in punctuation, date prefix
 *  and casing, and agree on words.
 *
 *  A LETTER IS ANY SCRIPT'S LETTER (code review 0.43.0, D1). The split was `[^a-z0-9]`, which made
 *  every letter outside ASCII a separator: a Cyrillic title and the identical ask both reduced to
 *  zero tokens, and triage answered `candidates: []` — indistinguishable from "no overlap" at
 *  intake's mandatory first step — while an umlaut cut a German word in two. Letters (`\p{L}`),
 *  their combining marks (`\p{M}`, which Devanagari and decomposed accents need inside a word) and
 *  digits (`\p{N}`) are word characters; NFC first, so a composed and a decomposed spelling of one
 *  word agree. The length floor counts CODE POINTS, not UTF-16 units. */
export function tokenize(text) {
  return String(text || "").normalize("NFC").toLowerCase().split(/[^\p{L}\p{M}\p{N}]+/u)
    .filter(t => [...t].length >= MIN_TOKEN_LENGTH);
}

/** The token SET of one epic — its id, title and description together. The id is included
 *  deliberately: a slug is often the most faithful statement of what an epic is, and in this
 *  repository's live duplicate pairs it is the field that actually carries the shared words. */
export function epicTokens(epic) {
  return new Set([
    ...tokenize(epic && epic.id),
    ...tokenize(epic && epic.title),
    ...tokenize(epic && epic.description),
  ]);
}

/** Inverse document frequency over THIS backlog: `ln((N + 1) / df)`.
 *
 *  A token appearing in nearly every epic ("conductor", "epic", "plan" in this repo) approaches
 *  zero weight on its own, with no hand-maintained stopword list to go stale — and the vocabulary
 *  that is ubiquitous differs per repository, which a fixed list could never track. A token
 *  appearing once is worth ln(N+1). The `+1` keeps every weight strictly positive, so a token
 *  present in ALL epics still counts for a little rather than making an all-common ask
 *  undefined (a plain ln(N/df) would put a zero in the denominator of the score below).
 *
 *  A token the backlog has never seen is treated as maximally rare. It can never be a shared
 *  token, so it only ever raises the denominator — correctly LOWERING the score of every
 *  candidate, because an ask full of words nothing in the backlog uses is probably new. */
export function idfMap(epics) {
  const n = epics.length;
  const df = new Map();
  for (const e of epics) {
    for (const t of epicTokens(e)) df.set(t, (df.get(t) || 0) + 1);
  }
  // A CORPUS-DERIVED stoplist, which is the only kind that cannot go stale: a token more than
  // half the epics use cannot distinguish one of them from another, whether it is English glue
  // ("the", "not", "does") or this repo's own house vocabulary ("conductor", "epic"). Measured
  // live before this cutoff existed, an ask sharing nothing but "does/only/not/the" scored 0.258
  // against a real twin's 0.63 — ranked correctly, but three junk rows the reader had to dismiss.
  //
  // It applies only from COMMON_TOKEN_MIN_EPICS up, because in a small backlog a frequency is
  // not evidence: two epics both about quokkas put "quokka" in 100% of the corpus, and dropping
  // it there would make the surface answer nothing at exactly the moment it is cheapest to be
  // right. Below that threshold every token keeps its weight and the ranking does the work alone.
  const cutoff = n >= COMMON_TOKEN_MIN_EPICS ? n * COMMON_TOKEN_MAX_SHARE : Infinity;
  const weight = (t) => {
    const seen = df.get(t) || 0;
    return seen > cutoff ? 0 : Math.log((n + 1) / Math.max(1, seen));
  };
  return { weight, df };
}

/** THE scorer. Pure: takes the epics and the ask, returns ranked candidates, reads no clock and
 *  no filesystem. `score` is the share of the ask's OWN distinctive weight that this epic
 *  accounts for — normalized by the ask rather than by the epic, so a long description neither
 *  wins by volume nor loses for it.
 *
 *  Ranking is by score, ties broken by id, so the output is stable across runs. */
export function candidateSet(epics, ask, { limit = 5 } = {}) {
  const list = Array.isArray(epics) ? epics.filter(e => e && typeof e.id === "string") : [];
  const askTokens = [...new Set(tokenize(ask))];
  if (!askTokens.length || !list.length) return [];
  const { weight } = idfMap(list);
  const total = askTokens.reduce((s, t) => s + weight(t), 0);

  // An epic superseded by another is already dead. Consolidating a fourth ask INTO it is the
  // mistake worth flagging, and it is mechanical: some other epic holds `supersedes: <this>`.
  // Read from links.mjs's ONE declaration, which `integrity`'s superseded-epic-never-ended check
  // also reads — a second local derivation would let the two surfaces disagree about which epics
  // are dead.
  const superseded = supersededEpics(list);

  const out = [];
  for (const e of list) {
    const tokens = epicTokens(e);
    // A zero-weight token is a word the whole backlog uses. It is not a reason to surface an
    // epic and it must not appear in the trail, where it reads as evidence and is not.
    const shared = askTokens.filter(t => tokens.has(t) && weight(t) > 0);
    if (!shared.length) continue;
    const earned = shared.reduce((s, t) => s + weight(t), 0);
    out.push({
      id: e.id,
      title: typeof e.title === "string" ? e.title : e.id,
      status: e.status || "queued",
      lane: e.lane || "openspec",
      priority: e.priority || "P?",
      // Rounded so the JSON is readable and so a formatting change cannot make two runs differ
      // in the last float digit. Ranking uses the rounded value too, so what a reader compares
      // is what the ordering used.
      score: Math.round((total > 0 ? earned / total : 0) * 1000) / 1000,
      // The engine SHOWING ITS WORK. A surface an agent cannot audit in a glance is a surface
      // it learns to skip.
      shared: shared.sort((a, b) => weight(b) - weight(a) || a.localeCompare(b)),
      superseded: superseded.has(e.id),
    });
  }
  return out
    .filter(c => c.score > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, Math.max(0, limit));
}

/** `triage "<free text>" [--limit N]`
 *
 *  READ-ONLY. Prints one JSON object: the ask, the lane the repo's own routing picks for it
 *  (`suggest-lane`'s answer, carried here so intake is one call and not two), the backlog's
 *  shape, the candidate set — and `verdict: null`, which is not decoration: it is this command
 *  stating that the decision an intake makes was not made here. */
export function triage() {
  if (!isInitialized()) { die("conductor: run /pm:init first\n"); }
  // The check's classified positional, never `process.argv[3]` (see suggest-lane's reader).
  const [ask] = checkedPositionals("triage");
  // gh-186. The old test was `ask.startsWith("--")`, which refused any ask whose own words begin
  // with a flag name — and CLAUDE.md makes this call STEP 1 of intake, "the ask, in its own
  // words", before any add-epic. A bug report ABOUT a flag is titled that way; this tracker had
  // one open at the time. Rewording to get past the guard defeats the lexical matching triage
  // exists to do, because the flag names ARE the distinctive tokens.
  //
  // NARROWED, not dropped. The guard had a real job: `triage --limit 5` supplies no ask, and
  // reading `--limit` as one returns a scored, confident, meaningless result. `isFlagToken` is
  // the same predicate gh-182 shipped for flag VALUES — it matches a token shaped exactly like a
  // flag, so a bare `--limit` is still a flag while "--story <n> is 1-indexed" is text.
  if (typeof ask !== "string" || !ask.trim() || isFlagToken(ask)) {
    die("usage: conductor.mjs triage \"<free text>\" [--limit N]\n");
  }
  const f = parseFlags(currentArgv().slice(4));
  requireFlagValues("triage", f);
  // An unrecognized flag is refused before dispatch by the pre-dispatch command-line check (lib/argv-surface.mjs) (VERB_FLAGS' `--limit` row):
  // parseFlags reads whatever it is handed, so without it a typo is dropped in silence and the caller
  // gets a confident answer to a question they did not ask.
  // REFUSED, never coerced. A valueless `--limit` arrives from parseFlags as boolean `true`, and
  // `Number(true)` is 1 — a coercing read answers with exactly ONE candidate and exits 0, which
  // is the #79 shape: plausible output, wrong result, no way to notice. `--limit abc` is the same
  // failure with a different value. A wrong bound on a recall device silently hides the twin the
  // whole command exists to surface, so it must not have a permissive reading.
  let limit = 5;
  if (f.limit !== undefined) {
    const n = typeof f.limit === "string" ? Number(f.limit) : NaN;
    if (!Number.isInteger(n) || n <= 0) {
      die(
        `conductor: triage: --limit must be a positive integer (got ` +
        `${f.limit === true ? "no value" : escapeControls(JSON.stringify(f.limit))})\n`);
    }
    limit = n;
  }
  const state = loadState();
  const epics = Array.isArray(state.epics) ? state.epics : [];

  const byStatus = {};
  for (const e of epics) byStatus[e.status || "queued"] = (byStatus[e.status || "queued"] || 0) + 1;

  outStream().write(jsonText({
    ask,
    lane: laneSuggestion(state, ask),
    backlog: {
      total: epics.length,
      open: epics.filter(e => e.status !== "archived").length,
      byStatus,
      active: typeof state.active === "string" ? state.active : null,
    },
    candidates: candidateSet(epics, ask, { limit }),
    // Stated, not implied. The engine surfaces what is worth reading; deciding whether any of
    // it is the SAME ask is judgment, and judgment is recorded by the agent with `--link
    // supersedes:<id>`, `--link relates-to:<id>`, or an `--outcome declined` disposition.
    verdict: null,
  }) + "\n");
}
