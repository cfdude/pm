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

import { EPIC_FLAGS, VERB_FLAGS, VERB_POSITIONALS, cliFlagsFor, escapeControls, flagInValuePositionMessage, isFlagToken, splitFlagToken } from "./constants.mjs";
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
 *  valueless flag never consumes (which is what makes `--cascade yes` a positional — parseFlags()
 *  decides by shape alone and cannot, because it has no verb); an undeclared flag consumes nothing.
 *
 *  A `--`-leading token that is NOT flag-shaped (`--Steal`, `--dry_run`, `"--story <n> is …"`) is
 *  a positional only on a verb whose positionals are free text (gh-186's rule). On every other verb
 *  it is an UNDECLARED FLAG: parseFlags(), positionalArgs() and the `argv[0]` id guards all skip any
 *  `--`-leading token, so reading it as a positional would pass this check while the verb acted
 *  without it — `claim --repo --session s --Steal` would write the repo claim. */
export function classify(verb, tokens) {
  const spec = surfaceOf(verb);
  const idFirst = !!(VERB_POSITIONALS[verb] && VERB_POSITIONALS[verb].idFirst);
  const freeText = !!(VERB_POSITIONALS[verb] && VERB_POSITIONALS[verb].freeText);
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
    if (t.startsWith("--") && !freeText) {
      out.push({ kind: "flag", token: t, at: i, name: t.slice(2), inline: undefined, declared: false,
        valueless: false, argvLevel: false, requires: null });
      continue;
    }
    out.push({ kind: "positional", token: t, at: i });
  }
  return out;
}

/** The positional arity that governs this command line — `release`'s `show` branch where its first
 *  positional selects it, the verb's own row otherwise. */
function arityFor(verb, positionals) {
  const row = VERB_POSITIONALS[verb];
  const branch = row.byFirst && positionals.length && row.byFirst[positionals[0]];
  return branch ? { ...row, ...branch } : row;
}

/** The verdict for one command line: `{ kind: "help" }`, `{ kind: "refuse", class, message }`, or
 *  `{ kind: "ok", positionals }`. `argv` is the whole process.argv; `initialized` is whether
 *  `.conductor/state.json` exists, passed in so hook dormancy stays pure.
 *
 *  Decisions in order, first match wins (D2):
 *    1. a help token in a non-value position → help, whatever else the line carries — a caller who
 *       typed one asked for help, and nothing is written;
 *    2. a hook verb in a repository without pm → ok: its own dormancy returns silently, and a hook
 *       line the engine would refuse must not print an error into a project that never ran init;
 *    3. `--help` in a value position → refuse (the #187 case), with valuelessFlagError()'s words;
 *    4. the first flag finding, in command-line order → refuse: a flag the verb does not declare
 *       (naming it and what the verb accepts), or a valueless flag written `--name=value` (it would
 *       otherwise be accepted with its value ignored, `--force=1`, or accepted inline where the
 *       space form is refused, `--cascade=true`);
 *    5. more positionals than the verb's MAXIMUM → refuse, naming the first surplus token. The
 *       minimum stays each verb's own refusal (VERB_POSITIONALS' header says why);
 *    6. otherwise ok, with the canonical argv the verb is handed (D10).
 *
 *  Every refusal carries a `class` — `help-in-value-position`, `id-as-flag`, `unknown-flag`,
 *  `value-on-valueless-flag` or `extra-positional` — beside its message. The message is prose other
 *  changes edit; the class is the stable value the emitted-invocation sweep compares against a
 *  shipped document's `<!-- pm:refused <class> -->` marker (emitted-commands-run-as-written). */
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
    return { kind: "refuse", class: "help-in-value-position", message: flagInValuePositionMessage(misplaced.flag, flag.requires, misplaced.token) };
  }
  const badFlag = items.find(x => x.kind === "flag" && (!x.declared || (x.valueless && x.inline !== undefined)));
  if (badFlag && !badFlag.declared) {
    return { kind: "refuse", class: badFlag.idMistake ? "id-as-flag" : "unknown-flag", message: undeclaredFlagMessage(verb, badFlag, items) };
  }
  if (badFlag) {
    return { kind: "refuse", class: "value-on-valueless-flag", message: `conductor: --${badFlag.name} takes no value — '${escapeControls(badFlag.token)}' gives ` +
      `it one, and ${verb} would ignore it. Write --${badFlag.name} on its own. Nothing was written.` };
  }
  const positionals = items.filter(x => x.kind === "positional");
  const arity = arityFor(verb, positionals.map(x => x.token));
  if (positionals.length > arity.max) {
    return { kind: "refuse", class: "extra-positional", message: surplusMessage(verb, arity, positionals[arity.max], items) };
  }
  // D10 — the order every verb reads: the positionals in their original order, then every flag with
  // its value in its original relative order (`--attribute-commit` order decides the Gate 2
  // endpoint), argv-level flags last. So each `argv[0]` reader sees its positional first, a joined
  // text never contains `--force`, and saveState()'s `process.argv.includes("--force")` still sees it.
  // Reordering cannot re-pair a flag with a value: a positional is by definition a token no declared
  // flag consumed, and a flag moves together with its value.
  const flagTokens = (argvLevel) => items
    .filter(x => x.kind === "flag" && x.argvLevel === argvLevel)
    .flatMap(x => (x.value !== undefined ? [x.token, x.value] : [x.token]));
  return {
    kind: "ok",
    positionals: positionals.map(x => x.token),
    canonicalArgv: [...positionals.map(x => x.token), ...flagTokens(false), ...flagTokens(true)],
  };
}

/** The positionals the command-line check classified, for every verb that reads a positional by
 *  place rather than by `argv[0]`'s `--` guard — never the raw argv tail, which carries every flag
 *  too. Two defects this closes: `log-detour fixed it --force` logged `fixed it --force` (a joined
 *  tail), and `set-gate-guard --force` printed usage where bare `set-gate-guard` reads the guard,
 *  because with no positional the canonical rewrite leaves the argv-level flag at `argv[3]`. Read
 *  from the canonical argv conductor.mjs installed, which classifies identically. */
export const checkedPositionals = (verb, argv = process.argv) => checkCommandLine(verb, argv).positionals || [];

/** D4's surplus-positional refusal: the form the verb takes and the first token it does not read,
 *  plus the likeliest cause where one is visible — a value given to a valueless flag, or an
 *  unquoted multi-word value (the token directly follows a flag's value, or the verb reads one text).
 *  Every caller token a refusal here quotes back goes through escapeControls(): a newline in it would
 *  otherwise start a line the engine never wrote — a forged hint or a runnable invocation. */
function surplusMessage(verb, arity, surplus, items) {
  const prev = items[items.indexOf(surplus) - 1];
  let msg = `conductor: ${verb} takes ${arity.max === 0 ? "no positional arguments" : arity.form} — ` +
    `'${escapeControls(surplus.token)}' is an extra argument it does not read. Nothing was written.`;
  if (prev && prev.kind === "flag" && prev.valueless && prev.at === surplus.at - 1) {
    msg += `\n  --${prev.name} takes no value.`;
  } else if (prev && prev.kind === "flag" && prev.value !== undefined) {
    msg += `\n  If '${escapeControls(surplus.token)}' belongs to --${prev.name}'s value, quote the whole value.`;
  } else if (VERB_POSITIONALS[verb].freeText && arity.max === 1) {
    msg += `\n  ${verb} reads ONE text argument — quote it.`;
  }
  return msg;
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
      `\`${verb} <id> ...\`, i.e. \`${escapeControls(`${verb} ${value}${rest.length ? ` ${rest.join(" ")}` : ""}`)}\`. ` +
      "Nothing was written.";
  }
  const accepted = cliFlagsFor(verb);
  let msg = `conductor: unknown flag --${escapeControls(flag.name)} for ${verb} — ` +
    (accepted.length ? `it accepts: ${accepted.map(f => `--${f}`).join(", ")}` : "it accepts no flags");
  if (pos && pos.max > 0) msg += `\nusage: conductor.mjs ${verb} ${pos.form} [flags]`;
  // A free-text verb is where a flag-shaped WORD is likeliest to be text the caller did not quote —
  // `log-detour fixed --no-verify usage` — so the refusal carries surplusMessage()'s quoting hint.
  if (pos && pos.freeText) {
    msg += `\n  If '${escapeControls(flag.token)}' is part of the text, quote the whole value.`;
  }
  return msg + "\nNothing was written.";
}
