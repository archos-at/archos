from __future__ import annotations

from collections.abc import Sequence
from typing import Any

import ifcopenshell.util.element as ue

from ifc_spatial.briefing_constants import DECISIVE_PROPERTIES
from ifc_spatial.briefing_constants import DIALECT_SAMPLE_SIZE
from ifc_spatial.briefing_constants import MAX_DIALECT
from ifc_spatial.briefing_reading import _nodes_of
from ifc_spatial.briefing_records import BriefingDialectEntry
from ifc_spatial.briefing_records import DialectEntry

from .model import SpatialModel


def measure_dialect(
    model: SpatialModel, nodes: Sequence[Any] | None = None, sample_size: int = DIALECT_SAMPLE_SIZE
) -> tuple[list[DialectEntry], int, bool]:
    candidates = [
        e for e in (nodes if nodes is not None else _nodes_of(model)) if model.kind_of(e) in ("element", "space")
    ]
    sampled = len(candidates) > sample_size
    scan = candidates[:sample_size] if sampled else candidates

    acc: dict[tuple[str, str], dict[str, Any]] = {}
    for element in scan:
        try:
            psets = ue.get_psets(element) or {}
        except Exception:
            continue
        for set_name, values in psets.items():
            if not isinstance(values, dict):
                continue
            for property_name, value in values.items():
                if property_name == "id":
                    continue
                if value is None or value == "":
                    continue
                key = (set_name, property_name)
                entry = acc.get(key)
                if entry is None:
                    entry = {"filled": 0, "sample": []}
                    acc[key] = entry
                entry["filled"] += 1
                if len(entry["sample"]) < 6 and isinstance(value, (str, int, float, bool)):
                    if value not in entry["sample"]:
                        entry["sample"].append(value)

    entries = [
        DialectEntry(
            set=set_name,
            property=property_name,
            filled=data["filled"],
            candidates=len(scan),
            sample=list(data["sample"]),
        )
        for (set_name, property_name), data in acc.items()
    ]
    entries.sort(key=lambda e: (-e.filled, e.set, e.property))
    return entries, len(scan), sampled


def _summarise_dialect(
    entries: Sequence[DialectEntry],
) -> tuple[list[BriefingDialectEntry], int, list[dict[str, str]]]:
    concept_of = {property_name.lower(): concept for concept, property_name in DECISIVE_PROPERTIES}

    seen: set[str] = set()
    shaped: list[BriefingDialectEntry] = []
    for entry in entries:
        key = entry.property.lower()
        seen.add(key)
        shaped.append(
            BriefingDialectEntry(
                set=entry.set,
                property=entry.property,
                filled=entry.filled,
                scanned=entry.candidates,
                concept=concept_of.get(key),
                sample=list(entry.sample),
            )
        )

    ranked = sorted(shaped, key=lambda e: (0 if e.concept is not None else 1, -e.filled, f"{e.set}.{e.property}"))
    absent = [
        {"concept": concept, "property": property_name}
        for concept, property_name in DECISIVE_PROPERTIES
        if property_name.lower() not in seen
    ]
    return ranked[:MAX_DIALECT], max(0, len(ranked) - MAX_DIALECT), absent
