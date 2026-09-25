---
description: Inventory which design documents have epics drawn from them, and which have none
argument-hint: "[--root <path>] [--headers]"
allowed-tools: Bash, Read
---

An epic can record the design document its work was drawn from (`--spec <path>` on `add-epic` or
`update-epic`, or `specPath` in an `add-many` batch), and one document may back many epics.
`verify-specs` is the set difference: for every `.md` file under a root, how many epics claim it
and which — then the epics whose `specPath` names a document that is not on disk.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/conductor.mjs" verify-specs [--root <path>] [--headers]
```

If `${CLAUDE_PLUGIN_ROOT}` is empty:
`ENGINE="${CLAUDE_PLUGIN_ROOT:+$CLAUDE_PLUGIN_ROOT/scripts/conductor.mjs}"; [ -f "$ENGINE" ] || ENGINE=$(ls -t ~/.claude/plugins/cache/*/pm/*/scripts/conductor.mjs 2>/dev/null | head -1); node "$ENGINE" verify-specs [--root <path>] [--headers]`

- `--root <path>` — the directory to inventory (recursively, minus `README`/`INDEX`/`CONTRIBUTING`).
  Point it at a plans directory to ask the same question about plans.
- `--headers` — for every UNCOVERED document, read its leading metadata block (`**Epic:** \`<id>\``
  and the like) and print the epic ids it names with the `update-epic <id> --spec <path>` line
  that would attach each. It proposes and never applies; a header id that names no epic is
  reported.

It is an inventory, not an audit: coverage is status-blind (an archived epic is coverage), it
always exits 0, and a document with no epic is often fine — a note, a reference, a sketch. An
absent root says **no spec root** rather than reporting zero uncovered. Deciding what a design
implies stays with you; `add-many` registers several chunks naming one `specPath` in one write.
