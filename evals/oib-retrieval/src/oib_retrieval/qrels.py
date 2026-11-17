from __future__ import annotations

import json
from collections.abc import Iterable
from dataclasses import dataclass
from dataclasses import field
from pathlib import Path
from typing import Any
from typing import NamedTuple


class Unit(NamedTuple):
    file_name: str
    page: int


@dataclass(frozen=True)
class ClauseLabel:
    richtlinie: str
    punkt: str
    grade: int

    def __post_init__(self) -> None:
        if self.grade not in (1, 2, 3):
            raise ValueError(f"grade must be 1, 2 or 3; got {self.grade!r} for {self.richtlinie} Punkt {self.punkt}")


@dataclass(frozen=True)
class GoldenEntry:
    id: str
    need_id: str
    language: str
    question: str
    question_class: str
    relevant: tuple[ClauseLabel, ...]
    provenance: str
    label_method: str
    notes: str
    calibration_pending: bool
    variant_of: str | None = None

    @property
    def should_refuse(self) -> bool:
        return not self.relevant


@dataclass(frozen=True)
class GoldenSet:
    entries: tuple[GoldenEntry, ...]
    forbidden_file_prefixes: tuple[str, ...]
    description: str = ""
    schema_version: int = 1

    def by_language(self, language: str) -> tuple[GoldenEntry, ...]:
        return tuple(entry for entry in self.entries if entry.language == language)

    def primary(self) -> tuple[GoldenEntry, ...]:
        return tuple(entry for entry in self.entries if entry.variant_of is None)

    def sibling_pairs(self, left: str = "de", right: str = "en") -> tuple[tuple[GoldenEntry, GoldenEntry], ...]:
        by_need: dict[str, dict[str, GoldenEntry]] = {}
        for entry in self.primary():
            languages = by_need.setdefault(entry.need_id, {})
            if entry.language in languages:
                raise ValueError(
                    f"Golden set has two primary {entry.language!r} entries for need {entry.need_id!r} "
                    f"({languages[entry.language].id!r} and {entry.id!r}); "
                    "mark one as a variant_of the other or give it its own need_id."
                )
            languages[entry.language] = entry
        pairs = []
        for need_id in sorted(by_need):
            languages = by_need[need_id]
            if left in languages and right in languages:
                pairs.append((languages[left], languages[right]))
        return tuple(pairs)


class ForbiddenUnits:
    __slots__ = ("prefixes",)

    def __init__(self, prefixes: Iterable[str]) -> None:
        self.prefixes = tuple(prefixes)

    def __contains__(self, unit: object) -> bool:
        file_name = getattr(unit, "file_name", None)
        if file_name is None and isinstance(unit, tuple) and unit:
            file_name = unit[0]
        if not isinstance(file_name, str):
            return False
        return file_name.startswith(self.prefixes)


class ClauseIndex:
    __slots__ = ("_by_guideline", "unresolved")

    def __init__(self, payload: dict[str, Any]) -> None:
        self._by_guideline: dict[str, dict[str, dict[str, Any]]] = {
            key: value for key, value in payload.items() if key != "_unresolved"
        }
        self.unresolved: dict[str, Any] = payload.get("_unresolved", {})

    @property
    def guidelines(self) -> tuple[str, ...]:
        return tuple(sorted(self._by_guideline))

    def clauses(self, richtlinie: str) -> dict[str, dict[str, Any]]:
        try:
            return self._by_guideline[richtlinie]
        except KeyError:
            raise KeyError(
                f"Richtlinie {richtlinie!r} is not in the Punkt index; known: {', '.join(self.guidelines)}"
            ) from None

    def file_name(self, richtlinie: str) -> str:
        clauses = self.clauses(richtlinie)
        return next(iter(clauses.values()))["file_name"]

    def total_clauses(self) -> int:
        return sum(len(clauses) for clauses in self._by_guideline.values())

    def units(self, richtlinie: str, punkt: str) -> tuple[Unit, ...]:
        clauses = self.clauses(richtlinie)
        try:
            entry = clauses[punkt]
        except KeyError:
            raise KeyError(f"Punkt {punkt!r} is not in the index for Richtlinie {richtlinie!r}") from None
        return tuple(Unit(entry["file_name"], int(page)) for page in entry["pages"])

    def has_children(self, richtlinie: str, punkt: str) -> bool:
        prefix = f"{punkt}."
        return any(other != punkt and other.startswith(prefix) for other in self.clauses(richtlinie))

    def leaf_clauses(self, richtlinie: str) -> tuple[str, ...]:
        return tuple(punkt for punkt in self.clauses(richtlinie) if not self.has_children(richtlinie, punkt))


def load_clause_index(path: str | Path) -> ClauseIndex:
    with open(path, encoding="utf-8") as handle:
        return ClauseIndex(json.load(handle))


def load_golden(path: str | Path) -> GoldenSet:
    with open(path, encoding="utf-8") as handle:
        payload = json.load(handle)

    entries: list[GoldenEntry] = []
    seen_ids: set[str] = set()
    for raw in payload["entries"]:
        entry = GoldenEntry(
            id=raw["id"],
            need_id=raw["need_id"],
            language=raw["language"],
            question=raw["question"],
            question_class=raw["question_class"],
            relevant=tuple(
                ClauseLabel(richtlinie=str(label["richtlinie"]), punkt=str(label["punkt"]), grade=int(label["grade"]))
                for label in raw["relevant"]
            ),
            provenance=raw["provenance"],
            label_method=raw["label_method"],
            notes=raw["notes"],
            calibration_pending=bool(raw["calibration_pending"]),
            variant_of=raw.get("variant_of"),
        )
        if entry.id in seen_ids:
            raise ValueError(f"duplicate golden entry id: {entry.id!r}")
        if entry.language not in ("de", "en"):
            raise ValueError(f"{entry.id!r}: language must be 'de' or 'en', got {entry.language!r}")
        seen_ids.add(entry.id)
        entries.append(entry)

    for entry in entries:
        if entry.variant_of is not None and entry.variant_of not in seen_ids:
            raise ValueError(f"{entry.id!r}: variant_of {entry.variant_of!r} is not a golden entry id")

    return GoldenSet(
        entries=tuple(entries),
        forbidden_file_prefixes=tuple(payload["forbidden_file_prefixes"]),
        description=payload.get("description", ""),
        schema_version=int(payload.get("schema_version", 1)),
    )


def expand(entry: GoldenEntry, index: ClauseIndex) -> dict[Unit, int]:
    graded: dict[Unit, int] = {}
    for label in entry.relevant:
        for unit in index.units(label.richtlinie, label.punkt):
            graded[unit] = max(graded.get(unit, 0), label.grade)
    return graded


@dataclass(frozen=True)
class Judgements:
    entry: GoldenEntry
    graded: dict[Unit, int] = field(default_factory=dict)

    @property
    def relevant(self) -> frozenset[Unit]:
        return frozenset(self.graded)


def build_judgements(golden: GoldenSet, index: ClauseIndex) -> tuple[Judgements, ...]:
    return tuple(Judgements(entry=entry, graded=expand(entry, index)) for entry in golden.entries)


def assert_siblings_share_qrels(golden: GoldenSet, index: ClauseIndex) -> None:
    for german, english in golden.sibling_pairs():
        left = expand(german, index)
        right = expand(english, index)
        if left != right:
            raise ValueError(
                f"sibling qrels differ for need {german.need_id!r}: "
                f"{german.id} -> {sorted(left)} vs {english.id} -> {sorted(right)}"
            )
