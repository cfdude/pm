// scripts/lib/tracker-dedup.mjs
// ONE tracker item maps to ONE epic — the rule, and its refusal, for every path that writes the
// dedup key (tracker-item-dedup-bypassed, code review 0.43.0 B2/E1).
//
// The rule used to live inline in addEpic(), inside `if (externalId !== undefined)`, so it ran
// for exactly one of the four writers: `add-epic --external-url U` with no `--external-id`,
// `update-epic --external-url U` and an `add-many` entry carrying `externalUrl` all wrote a
// second holder of one item, exit 0. The inward sync reaches the store only through the emitted
// `add-epic` line (sync's own pushEpic() sites write no URL), so it is covered through add-epic.
//
// WHAT COLLIDES is EPIC_DEDUP_KEYS' rule, unchanged: the URL against the URL when both sides
// carry one; the bare `externalId` only when NEITHER side carries a URL (an id is unique only
// within one tracker); one side URL-less is never a collision. Exact string equality.
//
// ARCHIVED HOLDERS COUNT. The emitted sync step 2 and the completion-writeback step both match
// ANY epic by `externalUrl`, whatever its status, so a second holder makes both ambiguous. A
// genuinely reopened item has a route, and the refusal names it: clear the old holder's URL.
//
// Pure: no state is read or written here. Callers decide WHICH epics are "others" — update-epic
// excludes the epic being written, so re-stating one's own URL is not a collision.

import { EPIC_DEDUP_KEYS, escapeControls, orNoRemedy, printedId } from "./constants.mjs";

const FLAG_OF = { externalUrl: "external-url", externalId: "external-id" };
const holds = (o, k) => !!o && typeof o === "object" && typeof o[k] === "string" && o[k] !== "";

/** The first of `others` already holding `candidate`'s tracker item, as `{holder, key}` where
 *  `key` is the state key that collided — or null. `candidate` is `{externalUrl?, externalId?}`
 *  as the record WILL stand after the write. */
export function trackerKeyHolder(others, candidate) {
  const { primary, fallback } = EPIC_DEDUP_KEYS;
  for (const e of others || []) {
    if (!e || typeof e !== "object") continue;
    if (holds(candidate, primary) && holds(e, primary)) {
      if (e[primary] === candidate[primary]) return { holder: e, key: primary };
      continue;
    }
    if (!holds(candidate, primary) && !holds(e, primary) &&
        holds(candidate, fallback) && holds(e, fallback) && e[fallback] === candidate[fallback]) {
      return { holder: e, key: fallback };
    }
  }
  return null;
}

/** The refusal for a hit — the key that ACTUALLY collided (E1: the message used to say
 *  external-id when the URL was the collision), its value, and the holder with its status. No
 *  `conductor:` prefix and no newline; each caller adds its own. `inBatch` says the holder is an
 *  earlier entry of the same add-many batch, which has no record yet to clear. */
export function trackerKeyRefusal({ holder, key }, candidate, { inBatch = false } = {}) {
  const flag = FLAG_OF[key] || key;
  if (inBatch) {
    return `${escapeControls(flag)} '${escapeControls(candidate[key])}' is already claimed by batch entry ` +
      `'${escapeControls(holder.id)}' — one tracker item maps to one epic. Nothing was written.`;
  }
  const status = typeof holder.status === "string" ? holder.status : "unknown status";
  return `${escapeControls(flag)} '${escapeControls(candidate[key])}' is already held by epic ` +
    `'${escapeControls(holder.id)}' (${escapeControls(status)}) — one tracker item maps to one epic. ` +
    `Update '${escapeControls(holder.id)}' instead, or, if it is genuinely no longer mirrored, free the key ` +
    `first: ${orNoRemedy(() => `\`update-epic ${printedId(holder.id)} --clear ${escapeControls(flag)}\``)}. ` +
    "Nothing was written.";
}
