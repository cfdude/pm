// The DECLARED judgments of the per-interpolation output sweep (output-interpolations.mjs): every
// interpolation the mechanical rules cannot classify, with the class it was judged and why.
//
// TWO FORMS, and the difference is the point (Gate 2 U2-I1):
//   x(file, fn, { "<expression>": <occurrences> }, class, why) — EXACT expressions inside one top-level
//     declaration, each with the number of times it occurs there. A judgment is a claim about the values
//     its reason names, so it names them: a new interpolation in the same declaration is UNCLASSIFIED, a
//     second copy of a judged expression is EXCESS, and a removed one is STALE — all three fail the suite.
//   j(file, fn, ALL, class, why) — a WHOLE declaration, allowed only for the classes in
//     FUNCTION_WIDE_CLASSES: `sink-flow` (every line it builds is joined through a line sink, so no value
//     it interpolates can print raw) and `json` (its whole output is one JSON document). Any other class
//     judged function-wide is reported WIDE. Before this narrowing, 103 of 152 judgments covered a whole
//     function, and a raw `held.session` in claim() or a raw title in supersedeAmended() passed the sweep.
// Classes: sink-flow (reaches a line sink downstream), passthrough (text composed and swept where it was
// built), engine (numbers, registry and vocabulary values, validated values, engine paths, versions and
// shas), json (one JSON document), escaped, not-output (builds no printed text), justified.
export const JUDGED = [];
const file = (f) => (f === "conductor.mjs" ? "scripts/conductor.mjs" : `scripts/lib/${f}`);
const ALL = /.*/;
const j = (f, fn, re, cls, why) => JUDGED.push({ file: file(f), fn, re, class: cls, why });
const x = (f, fn, exprs, cls, why) => {
  for (const [exact, count] of Object.entries(exprs)) JUDGED.push({ file: file(f), fn, exact, count, class: cls, why });
};

// ── line-sink flow, and the first judgments of each sink's neighbours
j("briefing.mjs", "buildBrief", ALL, "sink-flow", "every line is pushed onto L, joined through L.map(escapeControls) at buildBrief's return");
j("briefing.mjs", "BRIEF_REMEDIES", ALL, "sink-flow", "each render() result is pushed onto buildBrief's L (briefRemedy) or its trackerLines, which join L's sink; ids in commands go through printedId/asCode");
j("render.mjs", "render", ALL, "sink-flow", "every PROJECT.md line is pushed onto md, joined through md.map(escapeControls); cells additionally through tableRow's escapeTableCell");
x("render.mjs", "tableRow", {
  "cells.map(escapeTableCell).join(\" | \")": 1,
}, "escaped", "each cell through escapeTableCell");
x("render.mjs", "normalizeForDiffSummary", {
  "out.slice(0, afterHeading)": 1,
  "out.slice(end)": 1,
}, "not-output", "slices PROJECT.md text for a diff comparison; prints nothing");
j("integrity.mjs", "CHECKS", ALL, "sink-flow", "every finding detail is printed only by formatIntegrity(), whose L joins through L.map(escapeControls); runIntegrity's sole caller is integrity(). Ids in commands go through printedId/orNoRemedy/asCode/commandValue, and the secondary tracker's shellQuote(t.repo) is reached only when CONTROL_CHARACTER.test(t.repo) is false");
j("integrity.mjs", "recordedShas", ALL, "sink-flow", "`where` labels (gate1/gate2 + engine key) feed CHECKS details only");
x("integrity.mjs", "integrity", {
  "formatIntegrity(runIntegrity(loadState()))": 1,
}, "escaped", "formatIntegrity() returns the sink-joined report");
j("rules.mjs", "rulesBlock", ALL, "sink-flow", "the managed block's lines join through lines.map(escapeControls)");
j("rules.mjs", "closedItemStep", ALL, "sink-flow", "a rules-block line builder: its only consumer is rulesBlock()'s lines (pmCmd also names a platform-vocabulary command prefix)");
j("rules.mjs", "gateProcedureLines", ALL, "sink-flow", "a rules-block line builder: its only consumer is rulesBlock()'s lines (pmCmd also names a platform-vocabulary command prefix)");
j("rules.mjs", "intakeLines", ALL, "sink-flow", "a rules-block line builder: its only consumer is rulesBlock()'s lines (pmCmd also names a platform-vocabulary command prefix)");
j("rules.mjs", "inwardListStep", ALL, "sink-flow", "a rules-block line builder: its only consumer is rulesBlock()'s lines (pmCmd also names a platform-vocabulary command prefix)");
j("rules.mjs", "registrationStep", ALL, "sink-flow", "a rules-block line builder: its only consumer is rulesBlock()'s lines (pmCmd also names a platform-vocabulary command prefix)");
j("rules.mjs", "reportingLines", ALL, "sink-flow", "a rules-block line builder: its only consumer is rulesBlock()'s lines (pmCmd also names a platform-vocabulary command prefix)");
j("rules.mjs", "watermarkStep", ALL, "sink-flow", "a rules-block line builder: its only consumer is rulesBlock()'s lines (pmCmd also names a platform-vocabulary command prefix)");
j("rules.mjs", "pmCmd", ALL, "sink-flow", "a rules-block line builder: its only consumer is rulesBlock()'s lines (pmCmd also names a platform-vocabulary command prefix)");
j("constants.mjs", "mirroredEpicIdPrefix", ALL, "sink-flow", "used only by rules.mjs registrationStep, inside the rules block sink; the scope is slugged");
x("rules.mjs", "secondaryTrackerKey", {
  "entry.system": 2,
  "entry.repo": 1,
  "entry.projectKey": 1,
}, "not-output", "a match key for upsert/remove; never printed");
x("rules.mjs", "writeRules", {
  "name": 4,
  "platform": 3,
  "existing.slice(0, end)": 1,
  "block.split(\"\\n\").join(\"\\r\\n\")": 1,
  "block": 1,
}, "engine", "`name` is the rules file basename from PLATFORM_RULES_CHAIN, `platform` a validated vocabulary value; `block` is rulesBlock()'s sink-joined text written to the file; `existing.slice(0, end)` is the rules file's own text outside the managed block, written back as it was");
x("rules.mjs", "rulesBlockAmbiguousMessage", {
  "shown": 2,
  "m.line": 1,
  "m.kind": 1,
}, "engine", "shown is the engine's own rules file path relative to ROOT; marker line numbers and kinds are engine-derived");
x("rules.mjs", "rulesBlockArrangement", {
  "file": 1,
}, "engine", "the engine's own rules file path");
x("releases.mjs", "releaseShow", {
  "rel.id": 1,
  "rel.intent": 1,
  "a.via": 1,
  "a.was": 1,
}, "sink-flow", "pushed onto out, printed through out.map(escapeControls)");
x("claims.mjs", "owners", {
  "formatOwners(rows)": 1,
}, "escaped", "formatOwners() returns its L through L.map(escapeControls)");
x("claims.mjs", "owners", {
  "jsonText({ quiescent: rows.length === 0, claims: rows }, null, 2)": 1,
}, "json", "--json: the whole stdout is one JSON document");
j("verify-specs.mjs", "danglingBlock", ALL, "sink-flow", "spread into verify-specs' L, joined through L.map(escapeControls)");
x("verify-specs.mjs", "verifySpecs", {
  "formatHeaderCandidates(headerCandidates(state, absRoot))": 1,
  "formatSpecCoverage(specCoverage(state, absRoot))": 1,
}, "escaped", "formatHeaderCandidates/formatSpecCoverage return sink-joined text");
x("activity-report.mjs", "activity", {
  "formatReport(report, { enabled: state ? activityEnabled(state) : null })": 1,
}, "escaped", "formatReport() returns its L through L.map(escapeControls)");
x("activity-report.mjs", "activity", {
  "jsonText({ enabled: state ? activityEnabled(state) : null, ...report }, null, 2)": 1,
}, "json", "--json: one JSON document");
x("activity-report.mjs", "activity", {
  "e.message": 1,
}, "passthrough", "a StateUnreadableError: its reason is escaped where readStateFile() builds it");
x("activity-report.mjs", "hrs", {
  "(ms / HOUR).toFixed(1)": 1,
}, "engine", "a number");
j("dependency-order.mjs", "dependencyNotes", ALL, "sink-flow", "notes are printed only by render() (md) and buildBrief() (L), both line sinks");
j("dependency-order.mjs", "blockedWithoutDependsOnNote", ALL, "sink-flow", "a BRIEF_REMEDIES entry and a dependencyNotes() note — brief and PROJECT.md sinks only; its command's id goes through printedId");
j("epic-progress.mjs", "bar", ALL, "sink-flow", "bar() is called only by render() and buildBrief(), both line sinks");
j("epic-progress.mjs", "orderQueueWithDependencies", ALL, "sink-flow", "its notes are printed only by buildBrief()'s L");
x("active-pointer.mjs", "staleMarker", {
  "d": 1,
}, "engine", "a day count; staleMarker() feeds render/brief sinks");
j("constants.mjs", "gateSummary", ALL, "sink-flow", "called only by gateTableRows(), printed only by render() and buildBrief()");
j("archive-gate.mjs", "gateTableRows", ALL, "sink-flow", "rows printed only by render() and buildBrief()");
j("cross-spec-review.mjs", "crossSpecLine", ALL, "sink-flow", "printed only by render(), buildBrief() and releaseShow()'s out — all line sinks");
j("disposition.mjs", "correctionMarking", ALL, "sink-flow", "printed only by render() and buildBrief()");
j("disposition.mjs", "correctionNote", ALL, "sink-flow", "printed only by render() and buildBrief()");
x("constants.mjs", "releaseLine", {
  "s.members": 1,
}, "engine", "a count (its id is escaped)");
x("detour-stack.mjs", "dropDetour", {
  "orNoRemedy(() => \"`pop-detour`\")": 1,
}, "engine", "a literal verb name inside orNoRemedy's code span — the no-frame refusal points at the resume verb; every other value the refusal quotes goes through escapeControls at the interpolation");
x("autonomy.mjs", "grantLabel", {
  "grant.category": 1,
}, "passthrough", "a grant's identity; its ONE printing consumer is setAutonomy()'s re-arm report, which wraps each label in escapeControls() at the print site — liveGrants() reads the label only for its is-it-named test");
j("links.mjs", "epicReferences", ALL, "sink-flow", "`where` labels are printed by integrity (sink) and by remove-epic, which escapes its citation (Gate 2 T-S2) and the stripped-holder list");
x("constants.mjs", "withdrawnGate", {
  "n": 1,
}, "engine", "a gate number");

// ── engine-composed: numbers, registry and vocabulary values, validated values, engine paths/versions/shas
x("conductor.mjs", "runInvocation", {
  "pluginVersion() || \"unknown\"": 1,
  "platform": 1,
}, "engine", "the engine's shipped version and a validated platform (its install directory is escaped: a self-hosted checkout engine lives in the workspace, Gate 2 W-I1)");
x("conductor.mjs", "runInvocation", {
  "rulesTarget(resolvePlatform({ platform: declared }, loadState()), engineRoot())": 1,
}, "justified", "rules-target prints ONE machine-read path (evals/observe.py opens it); escaping would name a different file. It is the rules file under the harness's CLAUDE_PROJECT_DIR");
x("conductor.mjs", "runInvocation", {
  "verdict.message": 1,
}, "passthrough", "an argv-surface refusal, whose caller tokens are escaped where it is built");
x("activity-log.mjs", "setActivityLog", {
  "arg": 2,
}, "engine", "arg is validated on|off before this line (activityDir() is escaped: it sits under CLAUDE_PROJECT_DIR, a governed value, Gate 2 W-I1)");
x("activity-log.mjs", "segmentName", {
  "at.toISOString().replace(/[:.]/g, \"-\")": 1,
}, "not-output", "a segment file name");
x("activity-log.mjs", "diffEvents", {
  "w && w.gate": 1,
}, "not-output", "an event field of a JSON-lines activity segment");
x("add-epic.mjs", "addEpic", {
  "EPIC_ID_FORMAT.source": 1,
  "lane": 1,
  "status": 1,
}, "engine", "the id-format regex source; lane and status are validated against KNOWN_LANES/KNOWN_STATUSES before");
x("add-epic.mjs", "addEpic", {
  "e.message": 2,
  "perr": 1,
}, "passthrough", "parseStoryFlags / parseLinkFlags / parentError messages, each escaping the values it quotes where it is built");
x("add-epic.mjs", "planHierarchy", {
  "jsonText(plan)": 1,
}, "json", "the plan is one JSON document");
x("add-epic.mjs", "requireFlagValues", {
  "err": 1,
}, "passthrough", "valuelessFlagError()'s message: registry flag names, the token quoted by flagInValuePositionMessage");
x("add-epic.mjs", "valuelessFlagError", {
  "flag": 1,
  "requires": 1,
}, "engine", "registry flag names and requirement text");
x("constants.mjs", "flagInValuePositionMessage", {
  "flag": 2,
  "requires": 1,
}, "engine", "registry flag name and requirement text (the token is escaped)");
x("add-many.mjs", "addMany", {
  "EPIC_ID_FORMAT.source": 1,
  "allowedKeys.join(\", \")": 1,
  "k": 1,
}, "engine", "the id-format source and the batch key allowlist; k is filtered to allowedKeys before");
x("add-many.mjs", "addMany", {
  "msg": 1,
}, "passthrough", "die(): every caller escapes the values it quotes");
x("archive-gate.mjs", "blockedDelivered", {
  "o.detail": 1,
}, "passthrough", "o.detail is a DELIVERED_OBLIGATIONS detail, escaped where it is built");
x("archive-gate.mjs", "DELIVERED_OBLIGATIONS", {
  "summary.outstanding": 1,
  "summary.claimed": 1,
}, "engine", "task counts from the source's checkboxes (esc() is resolved by the sweep as escapeControls, not judged)");
x("archive-gate.mjs", "deliveredArchiveInvocation", {
  "f": 1,
}, "engine", "carry flags from obligationArchiveFlags(): engine placeholders");
x("archive-gate.mjs", "dispositionInvocation", {
  "outcomes.join(\"|\")": 1,
  "echoed.join(\" \")": 1,
  "template": 1,
  "f": 1,
}, "engine", "AGENT_OUTCOMES vocabulary, the engine template, engine carry placeholders, and echoed tokens that echoedTokens() shell-quoted after replacing any control-character value with a placeholder");
x("archive-gate.mjs", "gateRemedy", {
  "base": 1,
  "head": 1,
}, "engine", "base/head are engine placeholders (`<sha>`, REPLACING constants)");
x("archive-gate.mjs", "outstandingSummary", {
  "p.done": 1,
  "p.total": 1,
}, "engine", "counts");
x("archive-gate.mjs", "archiveGate", {
  "invalid": 1,
  "cerr": 1,
  "gate2Failure.detail": 1,
  "refusal": 4,
  "lines[0]": 4,
  "lines[1]": 1,
  "handoffFailure.detail": 1,
  "named": 1,
  "remedy": 1,
}, "passthrough", "dispositionError/correctionError messages (escaped), the escaped refusal prefix, asCode() remedy lines, escaped obligation details, the escaped story list and engine remedy prose");
x("archive-gate.mjs", "archiveGate", {
  "outcomeOf(epic)": 1,
  "i.n": 1,
}, "engine", "outcomeOf() answers from KNOWN_OUTCOMES or `unknown`; a story number");
x("argv-surface.mjs", "checkCommandLine", {
  "badFlag.name": 2,
  "verb": 1,
}, "engine", "the dispatched verb (VERB_POSITIONALS has a row for it) and a DECLARED flag name");
x("argv-surface.mjs", "surplusMessage", {
  "verb": 2,
  "arity.max === 0 ? \"no positional arguments\" : arity.form": 1,
  "prev.name": 2,
}, "engine", "verb, registry arity form, and a declared flag's name (undeclared flags are refused first)");
x("argv-surface.mjs", "undeclaredFlagMessage", {
  "verb": 4,
  "f": 1,
  "pos.form": 1,
  "msg": 1,
}, "engine", "verb, registry flag list and positional form; the caller tokens are escaped");
x("changelog.mjs", "changelog", {
  "secs.map(s => s.body).join(\"\\n\\n\")": 1,
}, "engine", "sections of the plugin's own shipped CHANGELOG.md (design D0)");
x("claims.mjs", "claim", {
  "claimExpiry(readRepoClaim())": 1,
  "claimExpiry(epic.claim)": 1,
}, "engine", "claimExpiry() is an ISO string computed from a parsed date, or null");
// command-exit.mjs is the ONE exit path every refusal now goes through (0.47.0). Both of its
// interpolations are judged here rather than in the five module-local `die` helpers the sweep used
// to judge: those helpers are gone, and what replaced them is this pair.
x("command-exit.mjs", "conductorDie", {
  "msg": 1,
}, "passthrough", "callers pass a literal or an already-escaped refusal, and command-exit.mjs writes it verbatim — the `conductor: ` prefix is the caller's, which is why it is not prefixed here");
// The four modules that phrase their refusals as FRAGMENTS and add the `conductor: ` prefix in a
// one-line local spelling (`refuse`, in each module — see its definition). The judgments named
// `die` before 0.47.0's sweep: the wrapper took that name, the shared exit path now does, and the
// two cannot share it without the shared one shadowing the local one at every converted call site.
x("claims.mjs", "refuse", {
  "msg": 1,
}, "passthrough", "every caller escapes the values it quotes");
x("detour-stack.mjs", "refuse", {
  "msg": 1,
}, "passthrough", "every caller escapes the values it quotes");
x("purge-logs.mjs", "refuse", {
  "msg": 1,
}, "passthrough", "every caller passes a literal or a vocabulary list");
x("releases.mjs", "refuse", {
  "msg": 1,
}, "passthrough", "every caller escapes the values it quotes");
x("command-exit.mjs", "refusalSummary", {
  "code": 1,
}, "not-output", "the CommandExit Error message; never printed, because die() has already written the refusal to the invocation's stderr");
x("claims.mjs", "refuseHeld", {
  "claimExpiry(claim)": 1,
}, "engine", "a computed ISO string");
x("claims.mjs", "refuseHeld", {
  "what": 1,
  "verb": 1,
}, "passthrough", "callers pass literal verbs and `this repository` or an escaped epic id");
x("claims.mjs", "writeRepoClaim", {
  "JSON.stringify(claim, null, 2)": 1,
}, "not-output", "the claim record's file BODY — the temp-file name it used to build (and interpolate) moved into the store's writeAtomic operation, so this declaration now holds only the body");
x("commit-watch.mjs", "beginObservation", {
  "target": 1,
  "process.pid": 1,
  "JSON.stringify({ anchor: nextAnchor || record.anchor, reported: merged })": 1,
}, "not-output", "the observation file body and its temporary name");
x("commit-watch.mjs", "observeLockPaths", {
  "commitObservePath(root)": 1,
}, "not-output", "a lock path");
x("constants.mjs", "asCode", {
  "remedy": 1,
}, "passthrough", "a builder result whose own values were swept where it was built");
x("constants.mjs", "escapeControls", {
  "c.charCodeAt(0).toString(16).padStart(4, \"0\")": 1,
}, "engine", "the escaper's own hex digits");
x("constants.mjs", "noRemedyMessage", {
  "kind": 1,
}, "engine", "kind is the literal epic|release");
x("constants.mjs", "printedId", {
  "kind": 1,
}, "engine", "kind is the literal epic|release");
x("constants.mjs", "unstorableSkipLine", {
  "kind": 1,
}, "engine", "kind is a literal (change|plan|archive directory)");
x("constants.mjs", "shellQuote", {
  "String(token).replace(/'/g, \"'\\\\''\")": 1,
}, "justified", "the quoter itself; every printing caller is judged at its own site");
x("constants.mjs", "warnDetachedTree", {
  "tag": 1,
  "writes || \"state\"": 1,
}, "engine", "a git tag name (git refuses control characters in ref names) and a literal");
x("created-at.mjs", "idNeedle", {
  "epicId": 1,
}, "not-output", "a git -S search needle");
x("created-at.mjs", "recoverCreatedAt", {
  "recovered": 1,
  "unrecoverable": 1,
  "missing": 1,
  "summary": 1,
}, "engine", "counts");
x("cross-spec-review.mjs", "releaseSpecFiles", {
  "r.id": 1,
  "path.relative(r.root, abs).split(path.sep).join(\"/\")": 1,
}, "not-output", "a Map key; record-cross-spec-review prints only the spec COUNT");
x("detour-stack.mjs", "pushDetour", {
  "pushReport": 1,
  "note": 1,
}, "passthrough", "the escaped save report, and deferralNote() which escapes the detour ids (Gate 2 T-I5)");
x("detour-stack.mjs", "popDetour", {
  "[...new Set(targets.map(d => orNoRemedy(() => `\\`record-reconcile ${printedId(pausedEpic)} --detour ${printedId(d)} --verdict valid|invalidated\\``)))].join(\", \")": 1,
}, "escaped", "each id through escapeControls; each command through orNoRemedy/printedId");
x("detour-stack.mjs", "popDetour", {
  "detourId": 1,
}, "escaped", "appendHonchoMemory → honchoMemoryLine() escapes it (design D7)");
x("disposition.mjs", "storyDispositionError", {
  "state": 1,
}, "engine", "the only caller passes the literal `wont-do` past the vocabulary check");
x("gate-guard.mjs", "setGateGuard", {
  "val": 2,
  "out.join(\"\\n\")": 1,
}, "engine", "val is validated on|off; out holds engine lines and escaped ids");
x("gate-guard.mjs", "reconcileBlockMessage", {
  "shape": 1,
}, "engine", "a FIXED LABEL from the frozen WRITE_SHAPE_LABELS set — writeShape() returns a member of it or null, and gate-guard-write-paths.test.mjs asserts every non-null return is a member. The label is text the engine wrote: the message carries no target path and no matched fragment, which is why it needs neither escaping nor a length bound");
x("gate-guard.mjs", "trackerBlockMessage", {
  "shape": 1,
}, "engine", "the same FIXED LABEL, on the arm that keeps its inverse — see reconcileBlockMessage above");
x("git.mjs", "commitsNotReachedBy", {
  "head": 1,
  "[...list].sort().join(\" \")": 1,
}, "not-output", "a cache key of full object names");
x("git.mjs", "differsFromHead", {
  "p": 1,
}, "not-output", "a git argument");
x("git.mjs", "resolveCommits", {
  "v": 1,
}, "not-output", "a git argument — one line of the batch-check stdin payload, peeled to ^{commit}. It was SINK-FLOW inside the execFileSync `input` option until 4.2 moved the call to the injected gateway, which is why the judgment moves from the sink heuristic to here. A value reaching this point has already had whitespace and control characters filtered out above it, and the loop's own `unresolved` message escapes every value it names");
x("git.mjs", "unresolvedCommitsMessage", {
  "flags": 1,
}, "engine", "flags is a literal flag list passed by each caller; the values are escaped");
x("help.mjs", "flagLine", {
  "spec.flag": 2,
  "spec.requires": 1,
  "sig.padEnd(width)": 1,
  "marks.join(\", \")": 1,
  "sig": 1,
}, "engine", "flag registry rows");
x("help.mjs", "verbHelp", {
  "command": 1,
  "pos.form": 1,
  "s.flag": 2,
  "s.requires": 1,
  "head": 3,
  "epicBatchKeys().join(\", \")": 1,
  "POSITIONAL_USAGE[command]": 2,
  "out.join(\"\\n\")": 1,
}, "engine", "flag and positional registries, POSITIONAL_USAGE, epicBatchKeys()");
j("lane-routing.mjs", "suggestLane", ALL, "json", "one JSON document");
j("triage.mjs", "triage", ALL, "json", "one JSON document");
j("unconsidered.mjs", "unconsideredOutcomesReport", ALL, "json", "one JSON document");
j("worktree-hygiene.mjs", "changesets", ALL, "json", "one JSON document");
j("worktree-hygiene.mjs", "verifyWorktrees", ALL, "json", "one JSON document; the branch-derived epic id is a JSON string");
x("lessons.mjs", "adviceText", {
  "body": 1,
}, "escaped", "body is built from escapeControls(rule) and escapeControls(file)");
x("links.mjs", "ordinal", {
  "n": 2,
  "{ 1: \"st\", 2: \"nd\", 3: \"rd\" }[n % 10] || \"th\"": 1,
}, "engine", "a number and its suffix");
x("links.mjs", "unknownLinkTypeMessage", {
  "t.type": 1,
  "t.drives": 1,
  "LINK_TYPES_WRITTEN.map(t => t.type).join(\", \")": 1,
}, "engine", "the link-type registry (the caller values are escaped)");
x("purge-logs.mjs", "purgeLogs", {
  "kind": 1,
  "bytes": 1,
  "f.kind": 1,
}, "engine", "kind validated against PURGE_KINDS, a byte count, an engine log kind");
x("refusal.mjs", "refusalFor", {
  "err.message": 1,
  "message": 1,
}, "passthrough", "conflict messages hold revision numbers and engine lock paths; unreadableStateMessage() carries a reason escaped where readStateFile() builds it");
x("remove-epic.mjs", "epicSummaryTable", {
  "escapeControls(e.id).padEnd(24)": 1,
  "escapeControls(String(e.title)).slice(0, 50).padEnd(50)": 1,
}, "escaped", "escapeControls(...) then padding/slicing");
x("save-report.mjs", "reportSave", {
  "line": 1,
}, "passthrough", "each caller's changed/unchanged line is swept at the caller");
x("self-hosting.mjs", "delegateToCheckout", {
  "r.error.message": 1,
  "r.error ? r.error.message : \"the child never started\"": 1,
}, "engine", "spawn errors of the node binary, and a literal for the one unreachable arm (2.6: the child has always started whenever this text is reached — it is defensive, not a value from git); the target path is escaped");
// ── 0.48.0 task 1.2: the record's persistence MOVED from state.mjs into the store (lib/store.mjs).
// These judgments moved WITH the shape they describe, in the same commit — the rule the sweep
// exists to enforce about itself. A judgment left keyed on `state.mjs` reads STALE, which is the
// loud half; the quiet half would have been a judgment that silently stopped covering anything.
x("store.mjs", "ROOT_ARTIFACTS", {
  "expected": 1,
  "found": 1,
  "reason": 2,
  "verb": 1,
}, "engine", "the StateConflictError / StateUnreadableError / StatePersistError constructors: revision numbers, an engine verb name and an engine-composed reason. They are judged under this name, not under a class name, because the sweep's enclosing-declaration heuristic attributes a `class X { constructor() {} }` to the last top-level declaration above it");
x("store.mjs", "recordConflictOn", {
  "verb": 1,
  "expected": 1,
  "found": 1,
}, "engine", "an engine verb name and two revision numbers, in the conflict sidecar's own log line");
x("store.mjs", "describeHolder", {
  "info.kind": 1,
  "c.pid": 1,
}, "engine", "an integer pid and an engine holder kind (host and time are escaped)");
x("store.mjs", "lockRefusalMessage", {
  "shown": 4,
  "bShown": 2,
  "expected": 3,
  "stale": 3,
  "rm": 2,
  "describeHolder(lock.holder)": 1,
}, "engine", "revision numbers, stale seconds and the engine's own lock paths relative to the project directory");
x("store.mjs", "lockPaths", {
  "STATE_PATH": 2,
}, "not-output", "lock and break-lock FILE paths; lockRefusalMessage prints a lock path only relative to the root it was built from");
x("store.mjs", "persistFailure", {
  "expectedRevision": 1,
  "diskRevision === null || diskRevision === undefined ? \"unreadable\" : diskRevision": 1,
}, "engine", "revision numbers");
x("store.mjs", "shapeProblem", {
  "bad": 1,
}, "engine", "an array index");
x("store.mjs", "unreadableStateMessage", {
  "err.message": 1,
}, "passthrough", "StateUnreadableError message: an engine display path and a reason escaped where the strict read builds it");
x("store.mjs", "diskStore", {
  "STATE_PATH": 1,
  "process.pid": 2,
  "Date.now()": 2,
}, "not-output", "TWO temporary file names, neither ever printed: the one the state is written to and renamed from, and the one writeAtomic builds for an artifact (the second pair of pid/timestamp is that one)");
x("store.mjs", "diskStore", {
  "expected": 1,
}, "engine", "a revision number in the lock-taken-over refusal");
x("store.mjs", "diskStore", {
  "JSON.stringify(next, null, 2)": 1,
}, "not-output", "the state file body");
x("store.mjs", "diskStore", {
  "p": 1,
}, "not-output", "the artifact path writeAtomic derives its temp name from");
x("store.mjs", "memoryStore", {
  "ARTIFACT.RECORD": 1,
}, "engine", "the LOGICAL artifact name (never a path — a memory store has none), in the unreadable-record error");
x("store.mjs", "memoryStore", {
  "name": 1,
}, "not-output", "the artifact key of a rotated entry in the memory map");
x("subcommands.mjs", "appendHonchoMemory", {
  "line": 1,
}, "escaped", "honchoMemoryLine() escapes the epic id and reason (design D7)");
x("subcommands.mjs", "changedFiles", {
  "p": 1,
}, "not-output", "a git path list");
x("subcommands.mjs", "looksLikeUnloggedMinimalDetour", {
  "activeEpicId": 1,
}, "not-output", "a substring test against a commit subject");
x("subcommands.mjs", "ownArtifacts", {
  "epic.id": 1,
}, "not-output", "an artifact path compared against changed files");
x("subcommands.mjs", "retractDetour", {
  "commits.join(\", \")": 1,
  "label": 2,
}, "engine", "detours.log row shas, filtered to hexadecimal by rowShasOverlap(), or git's short sha");
x("subcommands.mjs", "retractDetour", {
  "msg": 1,
}, "passthrough", "refuse(): every caller escapes the values it quotes");
x("tracker-refresh-writeback.mjs", "recordTrackerRefresh", {
  "verdict": 2,
}, "engine", "verdict validated against the refresh verdict vocabulary before");
x("update-epic.mjs", "missingGateWithdrawals", {
  "r.gate": 1,
}, "not-output", "a state key");
x("write-conflicts.mjs", "recordConflict", {
  "verb": 1,
  "expected": 1,
  "found": 1,
}, "engine", "one log line: an engine verb name and two revision numbers");

// ── mixed declarations, per expression
x("migrations.mjs", "upgrade", {
  "running": 1,
  "newest": 1,
}, "engine", "plugin versions of the running and installed engine");
x("migrations.mjs", "upgrade", {
  "applied": 2,
  "state.pmVersion || \"unknown\"": 3,
  "rewritten.join(\" \")": 1,
}, "engine", "a count; pmVersion AFTER stampVersion() wrote the running engine's version; engine-known file names");
x("migrations.mjs", "upgrade", {
  "delta.map(s => s.body).join(\"\\n\\n\")": 1,
}, "engine", "sections of the shipped CHANGELOG.md");
x("migrations.mjs", "upgrade", {
  "l": 1,
}, "escaped", "openspecCurrencyLines() returns its lines escaped (Gate 2 T-S2)");
x("rank.mjs", "reorder", {
  "msg": 1,
}, "passthrough", "fail(): every caller escapes the values it quotes");
x("reconciler-writeback.mjs", "recordReconcile", {
  "why": 1,
  "owedPhrase": 1,
}, "passthrough", "refuse(): every caller escapes; owedPhrase is built from escaped ids");
x("releases.mjs", "epicReasonPair", {
  "flagName": 2,
}, "engine", "flagName is the literal unmember|undefer");
x("releases.mjs", "release", {
  "EPIC_ID_FORMAT.source": 1,
  "reasonFlags.join(\" and --\")": 1,
  "reasonFlags[0]": 1,
  "one.flag": 1,
  "others[0].flag": 1,
}, "engine", "the id-format source and literal flag names");
x("releases.mjs", "release", {
  "derr": 1,
}, "passthrough", "an epicReasonPair() refusal, escaped where built");
x("releases.mjs", "release", {
  "printedId(unmember.epic) && unmember.epic": 1,
  "printedId(undefer.epic) && undefer.epic": 1,
}, "escaped", "printedId() throws the no-remedy signal on a control character, so the raw id is reached only without one (Gate 2 T-S2)");
x("releases.mjs", "release", {
  "releaseLine(releaseSummaries(state, state.epics).find(s => s.id === id))": 1,
}, "escaped", "releaseLine() escapes the release id (Gate 2 T-I3); the rest are counts");
x("remove-epic.mjs", "removeEpic", {
  "epicSummaryTable([epic, ...descendants])": 1,
}, "escaped", "the summary table escapes each cell; each id through escapeControls (cite(), a whole call to escapeControls, is trusted as its alias since Gate 2 W-M2 stopped a \"; \" string ending its declaration)");
x("remove-epic.mjs", "removeEpic", {
  "[...new Set(owed.map(r => orNoRemedy(() => `\\`record-reconcile ${printedId(r.holder)} --detour ${printedId(r.epic)} --verdict valid|invalidated\\``)))].join(\", \")": 1,
}, "escaped", "each command through orNoRemedy/printedId");
x("remove-epic.mjs", "removeEpic", {
  "dropTargets.map(p => orNoRemedy(() => `\\`drop-detour ${printedId(p)} --reason \"<why>\"\\``)).join(\", \")": 1,
}, "escaped", "the frame arm's drop-detour remedy (Gate 2 I-I1): each command through orNoRemedy/printedId, over paused-epic ids already de-duplicated through a Set");
x("remove-epic.mjs", "removeEpic", {
  "dropLine": 1,
}, "passthrough", "a conditional `+` chain of literals and the escaped drop-detour command list, which is swept where it sits");
x("remove-epic.mjs", "removeEpic", {
  "flag": 1,
  "how": 1,
}, "engine", "a literal flag name and engine wording");
x("subcommands.mjs", "supersedeAmended", {
  "shortSha(entry.sha)": 1,
  "replaced": 1,
  "reason": 3,
  "label": 2,
  "commands.join(\", \")": 1,
}, "engine", "reflog object names and git short shas; the reason is `amended into <sha>`; commands through orNoRemedy/printedId; ids escaped");
x("subcommands.mjs", "attributionNudge", {
  "asCode(cmd(e))": 1,
  "asCode(cmd(epic))": 2,
}, "escaped", "cmd() is attributionNudge's local builder: orNoRemedy(() => a template of printedId(epic.id) and resolved commit names); asCode() only wraps it");
x("subcommands.mjs", "attributionNudge", {
  "s": 1,
  "exclusion": 3,
  "candidates.map(e => `- ${asCode(cmd(e))}` + (e.attributedCommits.length === 0 ? \" (attributes no commits yet)\" : \"\")).join(\"\\n\")": 1,
}, "engine", "full commit object names from the observation, engine exclusion prose, and commands through asCode/orNoRemedy/printedId");
x("subcommands.mjs", "runNudge", {
  "shortSha(c.sha)": 1,
  "named.join(\", \")": 1,
  "named[0]": 1,
  "r": 1,
  "shortSha(s)": 1,
  "dead.map(s => `\\`${shortSha(s)}\\``).join(\", \")": 1,
  "deadProvenance": 1,
  "deadSentence": 2,
  "detected": 3,
  "loggedRows.map(r => `\\`retract-detour ${r} --reason \"<why>\"\\``).join(\", \")": 1,
  "retractPointer": 2,
}, "engine", "git short shas, detours.log row shas written by the engine, and engine sentences built from them");
x("subcommands.mjs", "sync", {
  "claim.label": 1,
  "added": 2,
}, "engine", "a literal artifact label and a count");
x("subcommands.mjs", "sync", {
  "backfilled.join(\", \")": 2,
}, "engine", "backfilled ids passed STORABLE_EPIC_ID (no control character) before registration");
x("subcommands.mjs", "honchoMemory", {
  "note": 1,
}, "escaped", "deferralNote() escapes the detour ids (Gate 2 T-I5)");
x("gate-review-writeback.mjs", "recordGateReview", {
  "missingEvidence.join(\" and \")": 1,
  "baseSha": 1,
  "headSha": 1,
  "gate": 4,
}, "engine", "literal flag names, full object names resolved by git (unresolved values are refused first) and a validated gate number");
x("tracker.mjs", "setTracker", {
  "flag": 1,
  "field": 1,
  "kept": 1,
}, "engine", "a literal flag or field name and a direction from KNOWN_TRACKER_DIRECTIONS");
x("tracker.mjs", "setTracker", {
  "line": 1,
}, "passthrough", "notices built with escapeControls");
x("update-epic.mjs", "echoedTokens", {
  "name": 3,
  "shellQuote(`--${name}=`)": 1,
  "value(`--${name}`, inline)": 1,
}, "engine", "flag names are DECLARED (argv-surface refuses others first); values are shell-quoted only when they hold no control character, else REENTER_PLACEHOLDER");
x("update-epic.mjs", "regressionRefusal", {
  "asCode(l)": 1,
}, "escaped", "l is one line of obligationRemedy()'s output (remedyLines), a remedy builder composed through printedId/orNoRemedy; asCode() only wraps it (quoted() is resolved by the sweep as escapeControls)");
x("update-epic.mjs", "regressionRefusal", {
  "i.n": 1,
  "named": 1,
  "status": 1,
  "[...new Set(reenter)].join(\", \")": 1,
  "invocation": 1,
  "findings": 1,
  "remedies": 1,
}, "engine", "a story number; the escaped findings list; a validated status; declared flag names; dispositionInvocation()'s engine command or no-remedy prose; asCode() remedy lines");
x("update-epic.mjs", "updateEpic", {
  "linkTypeVocabulary()": 1,
  "twice": 1,
  "g": 3,
  "declared.setOnly": 1,
  "r.flag": 1,
  "r.key": 1,
  "contradictory.join(\", --clear \")": 1,
  "contradictory.join(\", --\")": 1,
  "n": 2,
  "colons": 1,
  "k": 1,
  "gate": 1,
  "row.flag": 1,
  "row.clearNote": 1,
  "stillThere.join(\", \")": 1,
  "notLanded.join(\", gate \")": 1,
  "flag": 1,
  "REFERENCE_WHY[kind]": 1,
}, "engine", "registry vocabularies and flag rows, validated gate numbers, story indices and colon counts, declared flag names, and resolved full commit names; the reference refusal's `flag` is one of two literal flag names its two call sites pass, and REFERENCE_WHY is a literal table keyed by storedEpicIdError()'s three-value vocabulary");
x("update-epic.mjs", "updateEpic", {
  "perr": 1,
  "e.message": 2,
  "err": 1,
  "verdict.message": 1,
}, "passthrough", "parentError / parseLinkFlags / parseStoryFlags / storyDispositionError / archiveGate messages, each escaping what it quotes where it is built");
x("remove-epic.mjs", "removeEpic", {
  "(owed.length ? `  ${owed.length} reconcile obligation link(s): ${cite(owed)}. Removing it would leave the owed ` + \"verdict nothing to be recorded against. Answer it first — \" + [...new Set(owed.map(r => orNoRemedy(() => `\\`record-reconcile ${printedId(r.holder)} --detour ${printedId(r.epic)} --verdict valid|invalidated\\``)))].join(\", \") + \" — then remove.\\n\" : \"\")": 1,
}, "passthrough", "a conditional `+` chain whose non-literal operands (the escaped citation, the orNoRemedy command list) are each swept where they sit");

// ── Gate 2 W-I2: ALL_CAPS names are no longer literal by their spelling. Each below lost that trust because
// its declaration is not a literal (the resolver in output-interpolations.mjs reads it), and is judged here.
x("commit-watch.mjs", "observeLockPaths", {
  "LOCK": 1,
}, "not-output", "a lock file path (LOCK is commitObservePath(root) + \".lock\")");
x("purge-logs.mjs", "purgeLogs", {
  "L.join(\"\\n\")": 1,
}, "passthrough", "L is a local array of templates and literals only (its file names through escapeControls), each value swept where it is built");
x("rules.mjs", "rulesBlockAmbiguousMessage", {
  "L.join(\"\\n\")": 1,
}, "passthrough", "L is a local array of templates and literals only (err.markers mapped to a template), each value swept where it is built");
