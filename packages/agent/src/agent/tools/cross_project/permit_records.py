"""A permit record from another project, as the text of a citable source.

What ``project_lookup`` (:mod:`.register`) shows of each permit record a search
returned: its title, the procedure and every requirement, capped to one
source's length. Pure: a record in, text out; ``register`` builds the hit.
"""

from __future__ import annotations

from datetime import date
from typing import Any

from agent.knowledge.permit_extraction import canonical_record_kind
from agent.knowledge.permit_extraction import canonical_requirement_kind


def plain_text(value: object) -> str:
    """``value`` as one line, whitespace collapsed; ``""`` for ``None``."""
    return " ".join(str(value).split()) if value is not None else ""


#: How a record's kind reads in a permit source: labels for the closed enums the BFF stores, not a reading of any text.
_PERMIT_KIND = {
    "approval": "Bewilligung",
    "information_request": "Nachforderung",
    "refusal": "Ablehnung",
    "other": "Bescheid",
}
_PERMIT_REQUIREMENT_KIND = {"condition": "Auflage", "information_request": "Nachforderung", "note": "Hinweis"}


def permits_of(body: dict[str, Any]) -> list[dict[str, Any]]:
    """The permit records of a search answer that name their project, file and collection."""
    raw = body.get("permits") if isinstance(body.get("permits"), list) else []
    usable = (item for item in raw if isinstance(item, dict) and isinstance(item.get("project"), dict))
    return [item for item in usable if item.get("fileName") and item.get("collection")]


def _german_day(value: object) -> str:
    """``2020-03-12`` as ``12.03.2020``; anything else as it came."""
    try:
        return date.fromisoformat(str(value)).strftime("%d.%m.%Y")
    except ValueError:
        return plain_text(value)


def _requirement_line(item: dict[str, Any]) -> str:
    kind = item.get("kind")
    label = _PERMIT_REQUIREMENT_KIND.get(canonical_requirement_kind(kind), plain_text(kind) or "Auflage")
    page = item.get("page")
    line = f"{label}{f' (p. {page})' if isinstance(page, int) and page > 0 else ''}: {plain_text(item.get('content'))}"
    if evidence := plain_text(item.get("evidence")):
        line += f" Evidence: {evidence}"
    if basis := plain_text(item.get("legalBasis")):
        line += f" Legal basis: {basis}"
    return line


def permit_title(item: dict[str, Any]) -> str:
    kind = _PERMIT_KIND.get(canonical_record_kind(item.get("kind")), "Bescheid")
    title = f"{kind} – {plain_text(item.get('authority'))}" if plain_text(item.get("authority")) else kind
    return f"{title}, {_german_day(item['issuedOn'])}" if item.get("issuedOn") else title


def permit_body(item: dict[str, Any]) -> str:
    procedure = ", ".join(
        part
        for part in (
            f"Gemeinde {plain_text(item.get('municipality'))}" if plain_text(item.get("municipality")) else "",
            f"Geschäftszahl {plain_text(item.get('reference'))}" if plain_text(item.get("reference")) else "",
        )
        if part
    )
    requirements = [
        _requirement_line(requirement)
        for requirement in item.get("requirements") or []
        if isinstance(requirement, dict)
    ]
    return "\n".join(([f"Procedure: {procedure}"] if procedure else []) + requirements)


#: A passage is capped at 900 characters; a record's requirements are several short items.
PERMIT_BODY_MAX_CHARS = 2400


def capped_body(text: str) -> tuple[str, bool]:
    """``text`` cut to PERMIT_BODY_MAX_CHARS, and whether it was cut; the renderer marks a cut body itself."""
    if len(text) <= PERMIT_BODY_MAX_CHARS:
        return text, False
    return text[:PERMIT_BODY_MAX_CHARS].rstrip(), True
