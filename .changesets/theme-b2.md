* **A release can record that it delivered.** `release <id> --deliver` sets a `delivered` marker on the release
  and `--undeliver` removes it. `integrity`'s `delivered-release-epic-left-open` reads the marker when it is there:
  every open member not in the release's `deferred[]` is reported, `active` or not. A release with no marker keeps
  the member-derived reading, and its finding now says it is inferred and prints `release <id> --deliver`; the
  `--status active` workaround wording is gone. `release show` renders the marker. Nothing needs migrating.
* **An epic can claim its OpenSpec change by name.** `--plan` / `--spec` naming a file under
  `openspec/changes/[archive/]<name>/` now holds that change for `integrity`'s `archive-directory-has-no-epic` and
  for `sync`'s archive backfill, so a change proposed under a different name than its premise epic is no longer
  reported as unheld (or registered a second time). `--clear spec` / `--clear plan` is the inverse. (gh#200)
* **New `integrity` checks.** `tracker-item-held-by-two-epics` names two epics holding one tracker item (the
  pre-0.50.0 duplicates) with `update-epic <one> --clear external-url` (gh#231). `archived-change-also-live` names a
  change present both live and under `archive/` with identical content, the shape upstream `openspec archive`
  left in cfdude/pm#215, with `git rm -r` of the live copy as the remedy. `late-failing-gate-review` reports a
  failing verdict recorded after the merge as the real retrospective review it is, and
  `gate-recorded-as-bookkeeping` no longer reports it (gh#201).
  `archived-delivered-fails-delivered-obligation` names an archived `delivered` epic that no longer meets what
  `delivered` requires by a path no gate sees (a Gate 2 flipped to fail after the archive, a stripped
  `carriedTo`, tasks changed on disk).
* **`archive-directory-has-no-epic` also reports an archive directory the date rule set aside,** in the same
  words `sync` uses for it.
* **A printed archive invocation never carries a bare `--no-deferrals`.** Every printer of `dispositionInvocation()`
  now prints the deferral placeholder (`<--no-deferrals | --deferral "<epicId>:<section>">`) because the bare flag is
  a claim the agent has not made.
* **`update-epic --status <non-archived>` no longer claims a status the heal undoes.** On an epic whose change
  directory is archived on disk the success line now says the `--status` was not kept.
