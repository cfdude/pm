* **`add-many` saves what it accepts or refuses it by name.** Four kinds of input used to vanish
  with exit 0:
  * a string link such as `"depends-on:base"` was dropped;
  * a link to an epic that does not exist was stored, pointing at nothing;
  * a link with no target was stored, and it could never render;
  * a misspelled top-level key, such as `"epic"` for `"epics"`, created the parent and silently
    skipped every child.

  The batch must now be a JSON object whose only keys are `parent` and `epics`. Each `links`
  element is either a `"<type>:<epic>[:<reason>]"` string, the same grammar as `--link`, or a
  `{type, epic, reason}` object. It must name an epic that is in the record or anywhere in the
  batch, and it must use a known link type. Any other input refuses the whole batch, and nothing
  is created.
