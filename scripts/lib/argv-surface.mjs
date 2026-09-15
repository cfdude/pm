// scripts/lib/argv-surface.mjs
// every-verb-refuses-what-it-does-not-read — THE pre-dispatch command-line check.
//
// ONE function decides, for every dispatched verb, what its command line may carry, and conductor.mjs
// acts on the answer before the root-divergence warning, the banner, the activity snapshot and
// dispatch. The population is the dispatch table (VERB_EFFECTS, asserted set-equal to it by
// conductor-25), so no verb opts out by omission and a verb added later is bound the moment it is
// dispatched — the shape docs/lessons/bind-rules-to-functions-not-enumerations.md argues for. The
// per-verb alternative (a requireKnownFlags() call at the top of each verb) is the enumeration that
// produced the defect: 38 of 50 verbs accepted an undeclared flag because nobody had placed the call.
//
// A LEAF, deliberately: constants.mjs and verb-effects.mjs only, so the help path and every refusal
// load no verb module, and the function is pure (argv and `initialized` in, a verdict out) so each
// decision is testable without a subprocess.

import { EPIC_FLAGS, VERB_FLAGS, VERB_POSITIONALS, cliFlagsFor, flagInValuePositionMessage, isFlagToken, splitFlagToken } from "./constants.mjs";
import { VERB_EFFECTS } from "./verb-effects.mjs";

export const isHelpToken = (t) => t === "--help" || t === "-h";

/** What `verb` declares on its command line, projected from the registry and nothing else:
 *  `cliFlagsFor()` for the names (never `flagsFor()`, which for add-many answers its batch keys),
 *  and each row's `valueless`/`argvLevel` markers. */
function surfaceOf(verb) {
  const names = new Set(cliFlagsFor(verb));
  const rows = [...EPIC_FLAGS, ...VERB_FLAGS].filter(r => r.commands.includes(verb) && names.has(r.flag));
  const spec = new Map();
  for (const r of rows) {
    if (spec.has(r.flag)) continue;
    spec.set(r.flag, {
      valueless: r.valueless === true,
      argvLevel: r.argvLevel === true,
      requires: r.requires || "a value",
    });
  }
  return spec;
}

/** Walk the tokens after the verb once, left to right (design.md D2), classifying each as a HELP
 *  token (with whether it sits in a value position), a FLAG (with the value it consumed, if any), or
 *  a POSITIONAL. Help tokens are tested FIRST: `--help` is flag-shaped and would otherwise read as a
 *  flag. A value-bearing DECLARED flag written without `=` consumes the next token when that token
 *  exists and is not flag-shaped — so `-h` there is its value, exactly as parseFlags() reads it. A
 *  valueless flag never consumes; an undeclared flag consumes nothing. */
export function classify(verb, tokens) {
  const spec = surfaceOf(verb);
  const idFirst = !!(VERB_POSITIONALS[verb] && VERB_POSITIONALS[verb].idFirst);
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (isHelpToken(t)) {
      const prev = out[out.length - 1];
      const valuePosition = t === "--help" && !!prev && prev.kind === "flag" && prev.declared &&
        !prev.valueless && prev.inline === undefined && prev.value === undefined && prev.at === i - 1;
      out.push({ kind: "help", token: t, at: i, valuePosition, flag: valuePosition ? prev.name : undefined });
      continue;
    }
    if (isFlagToken(t)) {
      const [name, inline] = splitFlagToken(t);
      const s = spec.get(name);
      const flag = { kind: "flag", token: t, at: i, name, inline, declared: !!s,
        valueless: s ? s.valueless : false, argvLevel: s ? s.argvLevel : false, requires: s ? s.requires : null };
      if (s && !s.valueless && inline === undefined && i + 1 < tokens.length &&
          !isFlagToken(tokens[i + 1])) {
        flag.value = tokens[++i];
      } else if (!s && name === "id" && idFirst && !out.some(x => x.kind === "positional")) {
        // D4: `--id` where the verb's first positional is an epic id, before any positional, is the
        // #71 mistake — so its value is consumed exactly as update-epic's diagnosis always consumed
        // it. Otherwise `update-epic --id e1 --priority P1` would read e1 as the positional and the
        // diagnosis would never fire.
        flag.idMistake = true;
        if (inline === undefined && i + 1 < tokens.length && !isFlagToken(tokens[i + 1]) && !isHelpToken(tokens[i + 1])) {
          flag.value = tokens[++i];
        }
      }
      out.push(flag);
      continue;
    }
    out.push({ kind: "positional", token: t, at: i });
  }
  return out;
}

/** The verdict for one command line: `{ kind: "help" }`, `{ kind: "refuse", message }`, or
 *  `{ kind: "ok", positionals }`. `argv` is the whole process.argv; `initialized` is whether
 *  `.conductor/state.json` exists, passed in so hook dormancy stays pure.
 *
 *  Decisions in order, first match wins (D2):
 *    1. a help token in a non-value position → help, whatever else the line carries — a caller who
 *       typed one asked for help, and nothing is written;
 *    2. a hook verb in a repository without pm → ok: its own dormancy returns silently, and a hook
 *       line the engine would refuse must not print an error into a project that never ran init;
 *    3. `--help` in a value position → refuse (the #187 case), with valuelessFlagError()'s words;
 *    4. the first flag the verb does not declare → refuse, naming it and what the verb accepts. */
export function checkCommandLine(verb, argv, { initialized = true } = {}) {
  if (!Object.prototype.hasOwnProperty.call(VERB_EFFECTS, verb) ||
      !Object.prototype.hasOwnProperty.call(VERB_POSITIONALS, verb)) {
    // An unknown verb keeps today's path: the caller falls through to USAGE.
    return { kind: "ok", positionals: [] };
  }
  const items = classify(verb, argv.slice(3));
  if (items.some(x => x.kind === "help" && !x.valuePosition)) return { kind: "help" };
  if (VERB_EFFECTS[verb].hook === true && !initialized) return { kind: "ok", positionals: [] };
  const misplaced = items.find(x => x.kind === "help" && x.valuePosition);
  if (misplaced) {
    const flag = items.find(x => x.kind === "flag" && x.name === misplaced.flag);
    return { kind: "refuse", message: flagInValuePositionMessage(misplaced.flag, flag.requires, misplaced.token) };
  }
  const undeclared = items.find(x => x.kind === "flag" && !x.declared);
  if (undeclared) return { kind: "refuse", message: undeclaredFlagMessage(verb, undeclared, items) };
  return { kind: "ok", positionals: items.filter(x => x.kind === "positional").map(x => x.token) };
}

/** D4's refusal. `unknown flag --<name> for <verb> — it accepts: …` keeps the prefix five existing
 *  assertions match, names what the verb DOES accept (projected, so it cannot drift from what the
 *  check enforces), and adds the positional form when the verb reads positionals. The `--id` mistake
 *  gets update-epic's #71 diagnosis instead, generalised to every verb whose first positional is an
 *  epic id, including its rewrite of the line the caller meant. */
function undeclaredFlagMessage(verb, flag, items) {
  const pos = VERB_POSITIONALS[verb];
  if (flag.idMistake) {
    const value = flag.inline !== undefined ? flag.inline : (flag.value !== undefined ? flag.value : "<id>");
    const rest = [];
    for (const x of items) {
      if (x === flag) continue;
      rest.push(x.token);
      if (x.kind === "flag" && x.value !== undefined) rest.push(x.value);
    }
    return `conductor: ${verb} takes its epic id POSITIONALLY, not as --id — write ` +
      `\`${verb} <id> ...\`, i.e. \`${verb} ${value}${rest.length ? ` ${rest.join(" ")}` : ""}\`. ` +
      "Nothing was written.";
  }
  const accepted = cliFlagsFor(verb);
  let msg = `conductor: unknown flag --${flag.name} for ${verb} — ` +
    (accepted.length ? `it accepts: ${accepted.map(f => `--${f}`).join(", ")}` : "it accepts no flags");
  if (pos && pos.max > 0) msg += `\nusage: conductor.mjs ${verb} ${pos.form} [flags]`;
  return msg + "\nNothing was written.";
}
