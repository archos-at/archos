from __future__ import annotations

import csv
from collections.abc import Sequence
from dataclasses import asdict
from dataclasses import dataclass
from dataclasses import fields as dataclass_fields
from pathlib import Path


@dataclass(frozen=True)
class Question:
    id: str
    question: str
    family: str | None
    clause: str | None
    kind: str
    paragraph: str | None = None


@dataclass
class Observation:
    id: str = ""
    expected_family: str = ""
    expected_clause: str = ""
    expected_kind: str = ""
    kind: str = ""
    verdict: str = ""
    rounds: str = ""
    read_passage: str = ""
    clause_match: str = ""
    truncated: str = ""
    checkpoint_sources: str = ""
    family_coverage: str = ""
    repeat_query: str = ""
    locator_eligible: str = ""
    cap_retry: str = ""
    repair_fetch: str = ""
    cross_turn: str = ""
    family_overlap: str = ""
    ris_calls: str = ""
    paragraph_match: str = ""
    ris_citation_resolved: str = ""
    error: str = ""


FIELDS: tuple[str, ...] = tuple(f.name for f in dataclass_fields(Observation))


_DOUBLE_FETCH_FIELDS: tuple[str, ...] = (
    "repeat_query",
    "locator_eligible",
    "cap_retry",
    "repair_fetch",
    "cross_turn",
    "family_overlap",
)


_RIS_FIELDS: tuple[str, ...] = ("ris_calls", "paragraph_match", "ris_citation_resolved")


_BOOLEAN_FIELDS = ("verdict", "read_passage", "truncated", *_DOUBLE_FETCH_FIELDS, "ris_citation_resolved")


def _question_clause(row: dict) -> str | None:
    value = row.get("clause", row.get("punkt"))
    return None if value is None else str(value)


def load_questions(path: Path) -> list[Question]:
    import yaml

    raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    rows = raw.get("questions") or []
    return [
        Question(
            id=str(row["id"]),
            question=str(row["question"]).strip(),
            family=row.get("family"),
            clause=_question_clause(row),
            kind=str(row["kind"]),
            paragraph=None if row.get("paragraph") is None else str(row["paragraph"]),
        )
        for row in rows
    ]


def write_csv(path: Path, rows: Sequence[Observation]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(FIELDS))
        writer.writeheader()
        for row in rows:
            writer.writerow(asdict(row))


_LEGACY_COLUMNS = {"expected_punkt": "expected_clause", "punkt_match": "clause_match"}


def read_csv(path: Path) -> list[Observation]:
    with path.open(encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        header = tuple(_LEGACY_COLUMNS.get(name, name) for name in reader.fieldnames or ())
        reader.fieldnames = list(header)
        if header != FIELDS:
            _accept_older_columns(path, header)
        return [Observation(**{name: str(row.get(name) or "") for name in FIELDS}) for row in reader]


def _accept_older_columns(path: Path, header: tuple[str, ...]) -> None:
    missing = [name for name in FIELDS if name not in header]
    extra = [name for name in header if name not in FIELDS]
    added = {*_DOUBLE_FETCH_FIELDS, *_RIS_FIELDS}
    legacy_missing = [name for name in missing if name not in added]
    legacy_extra = [name for name in extra]
    if set(missing) <= added and not legacy_extra and not legacy_missing:
        return
    raise ValueError(
        f"{path} does not carry this script's columns "
        f"(missing={missing or '-'}, unexpected={extra or '-'}). Re-run the eval to produce it."
    )


def family_coverage(cell: str) -> list[tuple[str, int, int]]:
    out: list[tuple[str, int, int]] = []
    tokens = (cell or "").split()
    for family, ratio in zip(tokens[::2], tokens[1::2], strict=False):
        opened, _, listed = ratio.partition("/")
        if opened.isdigit() and listed.isdigit():
            out.append((family, int(opened), int(listed)))
    return out
