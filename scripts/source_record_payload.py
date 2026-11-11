"""A repository source record as the change-request payload an operator's agent proposes through the platform door.

A country's sources are platform records (ADR-0174); a repository file under
``configs/sources/`` is the old "built in" form the country-as-data plan
retires (step 4). This writes one file's record in the door's shape
(``records-propose``, ``type: source``, camel case, recorded responses inline),
under a record key of its own: a database record may not take a repository
record's id while the file still exists (``parse_inline_source``).

    .venv/bin/python scripts/source_record_payload.py            # rewrite the payloads
    .venv/bin/python scripts/source_record_payload.py --check    # fail when one is stale

``tests/test_source_record_payload.py`` runs ``--check`` on every commit, so the
payload cannot drift from the file it is made from while both exist.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

from public_sources.source import Source
from public_sources.source import get_source

ROOT = Path(__file__).resolve().parents[1]

#: Each payload: the repository record it is made from, the key it is proposed under, and the file it is written to.
PAYLOADS: tuple[tuple[str, str, Path], ...] = (
    ("at-ris", "at-ris-ogd", ROOT / "configs" / "knowledge-packs" / "at-sources.json"),
)

_STEPS = (
    "Source records to propose through the platform door (ADR-0174), generated from the repository record by "
    "scripts/source_record_payload.py; edit the record, not this file. One change request for the country: "
    "1) platform-knowledge-citation-capture of each citation URL below, 2) records-propose with the records, each "
    "citation replaced by its capture and a quote from it, 3) platform-knowledge-source-test, 4) validate, submit, "
    "review, publish. Until a record with a lookup block is released for the country, a lookup reads the repository "
    "record and says so in its log."
)


def _slug(name: str) -> str:
    """A fixture's name as the door takes it (``[a-z0-9][a-z0-9_-]*``, at most 60)."""
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:60].rstrip("-")


def _response(directory: Path, name: str) -> dict[str, str]:
    path = directory / "fixtures" / name
    content_type = "application/json" if path.suffix == ".json" else "text/html; charset=utf-8"
    return {"contentType": content_type, "body": path.read_text(encoding="utf-8")}


def door_record(source: Source, key: str) -> dict[str, object]:
    """The record in the door's shape (``wire/source.ts`` ``sourceRecordFields``), from a repository record."""
    record: dict[str, object] = {
        "type": "source",
        "key": key,
        "title": source.title,
        "territoryId": source.territory,
        "protocol": source.protocol,
        "format": source.format,
        "hosts": list(source.hosts),
        "dataFlow": source.data_flow,
        "terms": {
            "url": source.terms.url,
            "licence": source.terms.licence,
            "attribution": source.terms.attribution,
            "checked": source.terms.checked.isoformat(),
        },
        "monitor": {
            "kind": source.monitor.kind,
            "intervalHours": source.monitor.interval_hours,
            **({"probe": source.monitor.probe.model_dump()} if source.monitor.probe else {}),
        },
        "access": source.access,
        "engine": source.engine,
        "fixtures": [
            {
                "name": _slug(fixture.name),
                "operation": fixture.operation,
                "args": fixture.args,
                "responses": {url: _response(source.directory, name) for url, name in fixture.responses.items()},
                "expect": fixture.expect,
            }
            for fixture in source.fixtures
        ],
        "citations": [
            {"url": source.terms.url, "note": "the publisher's terms of use; capture it and quote the licence"}
        ],
    }
    if source.lookup is not None:
        record["lookup"] = source.lookup.model_dump(mode="json", exclude_defaults=True)
    return record


def payload(source_id: str, key: str) -> str:
    source = get_source(source_id)
    body = {"$comment": _STEPS, "countryId": source.territory[:2], "records": [door_record(source, key)]}
    return json.dumps(body, ensure_ascii=False, indent=2) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--check", action="store_true", help="fail when a committed payload is stale")
    args = parser.parse_args(argv)
    stale = []
    for source_id, key, target in PAYLOADS:
        text = payload(source_id, key)
        if args.check:
            if not target.exists() or target.read_text(encoding="utf-8") != text:
                stale.append(str(target.relative_to(ROOT)))
            continue
        target.write_text(text, encoding="utf-8")
    if stale:
        print(f"stale: {', '.join(stale)}; run .venv/bin/python scripts/source_record_payload.py", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
