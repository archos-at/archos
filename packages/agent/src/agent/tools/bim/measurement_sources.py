from __future__ import annotations

import contextvars
import hashlib
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from agent.common.source_kinds import MEASUREMENT_SOURCE_KIND
from agent.common.turn_status import record_lane_hit

MEASUREMENT_LANE = "measurement"
MEASUREMENT_LANE_LABEL = "Modellmessung"

PROVENANCE_LABELS: dict[str, str] = {
    "declared": "deklariert",
    "computed": "gemessen",
    "inferred": "vermutlich",
}


def note_model_read(filename: str | None, operation: str, detail: str | None = None) -> None:
    if not filename:
        return
    locus = f"{operation} · {detail}" if detail else operation
    record_lane_hit(str(filename), detail=locus or None)


@dataclass(frozen=True)
class MeasuredElement:
    global_id: str
    name: str | None = None
    ifc_type: str | None = None

    def to_wire(self) -> dict[str, Any]:
        payload = {"global_id": self.global_id, "name": self.name, "ifc_type": self.ifc_type}
        return {key: value for key, value in payload.items() if value}


@dataclass(frozen=True)
class MeasurementSource:
    headline: str
    statement: str
    provenance: str
    value_text: str
    tolerance_text: str | None
    method: str
    elements: tuple[MeasuredElement, ...] = ()
    model: str | None = None
    caveat: str | None = None

    @property
    def provenance_label(self) -> str:
        return PROVENANCE_LABELS.get(self.provenance, self.provenance)

    def identity(self) -> str:
        digest = hashlib.sha256(
            "\x1f".join(
                (
                    self.method,
                    self.value_text,
                    self.headline,
                    *(element.global_id for element in self.elements),
                )
            ).encode("utf-8")
        ).hexdigest()[:16]
        return f"measure:{digest}"

    def to_wire(self) -> dict[str, Any]:
        measurement: dict[str, Any] = {
            "provenance": self.provenance,
            "provenance_label": self.provenance_label,
            "value_text": self.value_text,
            "method": self.method,
            "statement": self.statement,
            "elements": [element.to_wire() for element in self.elements],
        }
        if self.tolerance_text:
            measurement["tolerance_text"] = self.tolerance_text
        if self.model:
            measurement["model"] = self.model
        if self.caveat:
            measurement["caveat"] = self.caveat
        return {
            "document_id": self.identity(),
            "title": self.headline,
            "content": self.statement,
            "kind": MEASUREMENT_SOURCE_KIND,
            "lane": MEASUREMENT_LANE,
            "lane_label": MEASUREMENT_LANE_LABEL,
            "source_type": "ifc_measurement",
            "tool": "ifc_measure",
            "measurement": measurement,
        }


_turn_measurements: contextvars.ContextVar[list[MeasurementSource] | None] = contextvars.ContextVar(
    "_turn_measurements", default=None
)


def begin_measurement_capture() -> contextvars.Token:
    return _turn_measurements.set([])


def end_measurement_capture(token: contextvars.Token) -> None:
    _turn_measurements.reset(token)


def record_measurements(entries: Sequence[MeasurementSource]) -> None:
    log = _turn_measurements.get()
    if log is not None:
        log.extend(entries)


def get_measurement_captures() -> list[MeasurementSource]:
    log = _turn_measurements.get()
    if not log:
        return []
    seen: set[str] = set()
    unique: list[MeasurementSource] = []
    for entry in log:
        identity = entry.identity()
        if identity in seen:
            continue
        seen.add(identity)
        unique.append(entry)
    return unique


def measurement_sources_to_wire(entries: Sequence[MeasurementSource]) -> list[dict[str, Any]]:
    return [entry.to_wire() for entry in entries]
