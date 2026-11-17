from __future__ import annotations

from typing import Any
from typing import Literal

from pydantic import BaseModel
from pydantic import ConfigDict
from pydantic import Field

FINDINGS_VERSION = 1

FindingStatus = Literal["met", "not_met", "open", "not_applicable"]
FindingGrounding = Literal["sourced", "derived", "open"]

FINDING_STATUSES: tuple[FindingStatus, ...] = ("met", "not_met", "open", "not_applicable")
FINDING_GROUNDINGS: tuple[FindingGrounding, ...] = ("sourced", "derived", "open")

LEGACY_FINDING_STATUS: dict[str, FindingStatus] = {
    "erfuellt": "met",
    "nicht_erfuellt": "not_met",
    "offen": "open",
    "nicht_anwendbar": "not_applicable",
}
LEGACY_FINDING_GROUNDING: dict[str, FindingGrounding] = {
    "belegt": "sourced",
    "abgeleitet": "derived",
    "offen": "open",
}

MAX_FINDINGS = 40
MAX_LABEL_CHARS = 200
MAX_VALUE_CHARS = 120
MAX_COMMENT_CHARS = 600
MAX_CITATIONS = 8


class FindingReference(BaseModel):
    model_config = ConfigDict(extra="forbid")

    document: str = Field(min_length=1, max_length=MAX_LABEL_CHARS, description="e.g. 'OIB-Richtlinie 2'")
    section: str | None = Field(
        default=None, max_length=MAX_LABEL_CHARS, description="e.g. 'Pkt. 3.1.1' or 'Tabelle 1b'"
    )
    page: int | None = Field(default=None, ge=1)


class Finding(BaseModel):
    model_config = ConfigDict(extra="forbid")

    requirement: str = Field(min_length=1, max_length=MAX_LABEL_CHARS, description="the requirement, as a noun phrase")
    value: str | None = Field(default=None, max_length=MAX_VALUE_CHARS, description="the copyable value, e.g. 'REI 60'")
    status: FindingStatus | None = None
    grounding: FindingGrounding
    reference: FindingReference | None = None
    citations: list[int] = Field(default_factory=list, max_length=MAX_CITATIONS, description="the [N] the report cites")
    comment: str | None = Field(default=None, max_length=MAX_COMMENT_CHARS, description="what qualifies the status")
    area: str | None = Field(default=None, max_length=MAX_LABEL_CHARS, description="the section the finding belongs to")


class Findings(BaseModel):
    model_config = ConfigDict(extra="forbid")

    v: int = FINDINGS_VERSION
    items: list[Finding] = Field(min_length=1, max_length=MAX_FINDINGS)

    def counts(self) -> dict[str, int]:
        return {status: sum(1 for item in self.items if item.status == status) for status in FINDING_STATUSES}

    def judged(self) -> bool:
        return any(item.status is not None for item in self.items)


def sanitize_findings(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    items = raw.get("items")
    if not isinstance(items, list):
        return None
    kept: list[Finding] = []
    for item in items[:MAX_FINDINGS]:
        if not isinstance(item, dict):
            continue
        try:
            kept.append(Finding.model_validate(_trimmed(item)))
        except ValueError:
            continue
    if not kept:
        return None
    return Findings(items=kept).model_dump(exclude_none=True)


def _trimmed(item: dict[str, Any]) -> dict[str, Any]:
    out = dict(item)
    status = out.get("status")
    if isinstance(status, str):
        out["status"] = LEGACY_FINDING_STATUS.get(status, status)
    grounding = out.get("grounding")
    if isinstance(grounding, str):
        out["grounding"] = LEGACY_FINDING_GROUNDING.get(grounding, grounding)
    for key, limit in (
        ("requirement", MAX_LABEL_CHARS),
        ("value", MAX_VALUE_CHARS),
        ("comment", MAX_COMMENT_CHARS),
        ("area", MAX_LABEL_CHARS),
    ):
        value = out.get(key)
        if isinstance(value, str):
            value = value.strip()
            out[key] = value[:limit] if value else None
    reference = out.get("reference")
    if isinstance(reference, dict):
        ref = dict(reference)
        for key in ("document", "section"):
            value = ref.get(key)
            if isinstance(value, str):
                ref[key] = value.strip()[:MAX_LABEL_CHARS] or None
        out["reference"] = ref if ref.get("document") else None
    citations = out.get("citations")
    if isinstance(citations, list):
        out["citations"] = [n for n in citations if isinstance(n, int) and n > 0][:MAX_CITATIONS]
    else:
        out["citations"] = []
    return out
