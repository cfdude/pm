"""Turn a seed file (JSON list of item docs) into ArtifactData "batch" `writes` lists.

    python seed_to_batch.py example-seed.json > batch.json

Each item becomes a "set" on items/<id>; output is a list of batches of at most 50
writes (the ArtifactData batch limit), each passed as `writes` in one call. Ranks are renumbered 1000, 2000, ... within each
priority group in file order, so a hand-written seed never needs ranks of its own.
Load it from a full Claude Code session (headless `claude -p` has no ArtifactData tool).
"""

import json
import sys

LEVELS = ["Urgent", "High", "Medium", "Low"]
REQUIRED = {"id", "title", "sum", "cat", "prio", "status"}
DEFAULTS = {
    "det": "",
    "src": "",
    "needs": "",
    "deps": [],
    "docNotes": [],
    "effort": "",
    "values": [],
    "ds": False,
    "jira": "",
    "createdBy": None,
    "createdAt": None,
    "removed": None,
    "log": None,
}


def build(items):
    ids = {i["id"] for i in items}
    seen = {}
    ops = []
    for it in items:
        missing = REQUIRED - it.keys()
        if missing:
            sys.exit(f"{it.get('id', '?')}: missing {sorted(missing)}")
        if it["prio"] not in LEVELS:
            sys.exit(f"{it['id']}: priority {it['prio']!r} not in {LEVELS}")
        unknown = [d for d in it.get("deps", []) if d not in ids]
        if unknown:
            sys.exit(f"{it['id']}: depends on unknown {unknown}")
        group = "Delivered" if it["status"] == "Delivered" else it["prio"]
        seen[group] = seen.get(group, 0) + 1
        doc = {**DEFAULTS, **it, "rank": seen[group] * 1000}
        ops.append(
            {"op": "set", "collection": "items", "doc_id": it["id"], "data": doc}
        )
    return ops


if __name__ == "__main__":
    with open(sys.argv[1], encoding="utf-8") as f:
        ops = build(json.load(f))
    print(json.dumps([ops[i : i + 50] for i in range(0, len(ops), 50)], indent=1))
