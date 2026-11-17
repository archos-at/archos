from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date

from agent.common.source_kinds import AGENT_AUTHORED_LANE_LABEL

KEY_AUTHORED_BY = "authored_by"
KEY_APPROVED_BY = "approved_by"
KEY_APPROVED_AT = "approved_at"
KEY_PRODUCER = "producer"

AGENT_AUTHOR = "agent"


@dataclass(frozen=True)
class AgentProvenance:

    authored_by: str = AGENT_AUTHOR
    approved_by: str | None = None
    approved_at: str | None = None
    producer: str | None = None


def _text(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    return value.strip() or None


def is_agent_author(value: object) -> bool:
    return (_text(value) or "").lower() == AGENT_AUTHOR


def is_agent_authored(metadata: object) -> bool:
    if not isinstance(metadata, Mapping):
        return False
    return is_agent_author(metadata.get(KEY_AUTHORED_BY))


def parse_agent_provenance(metadata: object) -> AgentProvenance | None:
    if not isinstance(metadata, Mapping) or not is_agent_authored(metadata):
        return None
    return AgentProvenance(
        authored_by=AGENT_AUTHOR,
        approved_by=_text(metadata.get(KEY_APPROVED_BY)),
        approved_at=_text(metadata.get(KEY_APPROVED_AT)),
        producer=_text(metadata.get(KEY_PRODUCER)),
    )


def provenance_metadata(provenance: AgentProvenance) -> dict[str, str]:
    fields = {
        KEY_AUTHORED_BY: provenance.authored_by,
        KEY_APPROVED_BY: provenance.approved_by,
        KEY_APPROVED_AT: provenance.approved_at,
        KEY_PRODUCER: provenance.producer,
    }
    return {key: value for key, value in fields.items() if value}


_ISO_DATE_PREFIX_RE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})")


def german_date(value: str | None) -> str | None:
    text = (value or "").strip()
    match = _ISO_DATE_PREFIX_RE.match(text)
    if not match:
        return text or None
    year, month, day = (int(part) for part in match.groups())
    try:
        date(year, month, day)
    except ValueError:
        return text
    return f"{day:02d}.{month:02d}.{year}"


def provenance_label(provenance: AgentProvenance) -> str:
    approved_by = provenance.approved_by
    approved_at = german_date(provenance.approved_at)
    if approved_by and approved_at:
        return f"{AGENT_AUTHORED_LANE_LABEL} · freigegeben von {approved_by} am {approved_at}"
    if approved_by:
        return f"{AGENT_AUTHORED_LANE_LABEL} · freigegeben von {approved_by}"
    if approved_at:
        return f"{AGENT_AUTHORED_LANE_LABEL} · freigegeben am {approved_at}"
    return AGENT_AUTHORED_LANE_LABEL


_NON_WORD_RE = re.compile(r"[^0-9a-zäöüß]+")
_FILE_EXTENSION_RE = re.compile(r"\.[0-9a-z]{1,5}$")


def normalize_document_name(value: str | None) -> str:
    text = (value or "").strip().lower()
    if not text:
        return ""
    text = _FILE_EXTENSION_RE.sub("", text)
    return _NON_WORD_RE.sub(" ", text).strip()
