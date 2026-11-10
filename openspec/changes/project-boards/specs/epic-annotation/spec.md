## ADDED Requirements

### Requirement: An epic carries a one-line summary and a why-now

An epic SHALL carry two optional one-line fields: `summary`, what the epic is in plain words, and `whyNow`, why it
matters now. `add-epic`, `update-epic` and `add-many` SHALL accept `--summary <text>` and `--why-now <text>`, and an
`add-many` batch document SHALL accept the keys `summary` and `whyNow`. Neither field SHALL modify `description` or
`notes`.

#### Scenario: Set on every epic-writing surface

- **WHEN** `add-epic --id a --summary "s" --why-now "w"`, `update-epic b --summary "s"` and an `add-many` document with `summary` run
- **THEN** each epic's `summary` and `whyNow` read back through `board --json` exactly as given

### Requirement: Summary and why-now are validated and clearable

`summary` SHALL be one line of at most 200 characters, and `whyNow` one line of at most 300. An empty value, or one
containing a newline, SHALL be refused, naming the field and its limit, and the command SHALL write nothing. Both
fields SHALL be declared nullable in the flag registry and cleared with `update-epic <id> --clear summary` or
`--clear why-now`.

#### Scenario: Clear is the inverse

- **WHEN** `update-epic a --clear summary` runs
- **THEN** `board --json` reports `summary: null` for a, and its `description` is unchanged

#### Scenario: A multi-line summary is refused

- **WHEN** `update-epic a --summary $'line one\nline two'` runs
- **THEN** it exits non-zero naming `summary` and its one-line limit, and the state file is byte-identical to before

### Requirement: Leaving untriaged without a summary or why-now warns

An epic-writing command SHALL warn after it moves an epic out of `untriaged`, or registers one, into any status other
than `untriaged` or `archived`, if the epic then lacks `summary` or `whyNow`. The write SHALL still happen. The warning
is one stderr line naming the epic, each missing field and the flag that sets it. It SHALL NOT change the exit code.
This release SHALL NOT refuse such a write.

#### Scenario: Triage without a summary warns

- **WHEN** `update-epic a --status queued` runs on an untriaged epic with no summary and no why-now
- **THEN** the status becomes `queued`, the exit code is 0, and stderr names `a`, `--summary` and `--why-now`

#### Scenario: Complete epic does not warn

- **WHEN** the same move runs on an epic with both fields set
- **THEN** stderr carries no summary warning

### Requirement: Archiving and unchanged status never warn

A move to `archived`, or a write that leaves the status unchanged, SHALL NOT print the summary warning.

#### Scenario: Declining does not warn

- **WHEN** an untriaged epic is archived with `--outcome declined`
- **THEN** no summary warning is printed

#### Scenario: A notes-only write does not warn

- **WHEN** `update-epic a --notes "x"` runs on a queued epic with no summary
- **THEN** no summary warning is printed
