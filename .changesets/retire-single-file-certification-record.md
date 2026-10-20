* **The superseded `pm-suite-certification.json` is removed from a clone that still holds one.** Contributor tooling
  only; nothing a plugin user installs or runs changes. Nothing has read or written the file since 0.51.0 moved the
  record to `pm-suite-certification.d/`; the pre-commit hook now deletes a leftover copy with an idempotent
  `rm -f`, beside the existing cleanup of the retired `pm-isolation-flag`. The directory is never touched.
