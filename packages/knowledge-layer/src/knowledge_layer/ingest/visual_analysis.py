from __future__ import annotations

import json
import logging
import math
import re
from typing import Any

from agent.knowledge.title_block import TITLE_BLOCK_FIELDS
from agent.knowledge.title_block import normalise_revision_facts
from knowledge_layer.ingest.visual_domains import Domain
from knowledge_layer.ingest.visual_domains import DomainRegistry
from knowledge_layer.ingest.visual_domains import resolve_registry

logger = logging.getLogger(__name__)

SCHEMA_VERSION = 5

_MAX_SEGMENTS = 12
_MAX_LIST_ITEMS = 60
_MAX_STR = 2000

SOURCES = ("text", "visual", "inferred")
CONFIDENCES = ("high", "medium", "low")

UNKNOWN = "unknown"

_SOURCE_SET = frozenset(SOURCES)
_CONFIDENCE_SET = frozenset(CONFIDENCES)


def cache_prompt_type(registry: DomainRegistry) -> str:
    return f"visual:v{SCHEMA_VERSION}:{registry.fingerprint}"


def _clip(value: Any, limit: int = _MAX_STR) -> str | None:
    if value is None or isinstance(value, (dict, list, bool)):
        return None
    text = str(value).strip()
    return text[:limit] if text else None


def _str_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        single = _clip(value)
        return [part.strip() for part in single.split(",") if part.strip()][:_MAX_LIST_ITEMS] if single else []
    out: list[str] = []
    for item in value[:_MAX_LIST_ITEMS]:
        text = _clip(item)
        if text:
            out.append(text)
    return out


def _term(value: Any, allowed: frozenset[str]) -> str | None:
    if not isinstance(value, str):
        return None
    slug = value.strip().lower()
    return slug if slug in allowed else None


def _dict_list(value: Any, normalise_item) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    out: list[dict[str, Any]] = []
    for item in value[:_MAX_LIST_ITEMS]:
        if not isinstance(item, dict):
            continue
        normalised = normalise_item(item)
        if normalised:
            out.append(normalised)
    return out


def _normalise_entity(item: dict[str, Any], domain: Domain) -> dict[str, Any] | None:
    name = _clip(item.get("name"), 300)
    if not name:
        return None
    category = _term(item.get("category"), domain.category_keys) or "other"
    return {
        "name": name,
        "category": category,
        "role": _clip(item.get("role"), 300),
        "measure": _clip(item.get("measure"), 100),
    }


def _normalise_layer(item: dict[str, Any]) -> dict[str, Any] | None:
    material = _clip(item.get("material"), 300)
    if not material:
        return None
    return {
        "material": material,
        "thickness": _clip(item.get("thickness"), 100),
        "function": _clip(item.get("function"), 300),
    }


def _normalise_composition(item: dict[str, Any]) -> dict[str, Any] | None:
    component = _clip(item.get("component"), 300)
    layers = _dict_list(item.get("layers"), _normalise_layer)
    if not component and not layers:
        return None
    return {"component": component or "component", "layers": layers}


def _normalise_state(item: dict[str, Any], domain: Domain) -> dict[str, Any] | None:
    element = _clip(item.get("element"), 300)
    state = _term(item.get("state"), frozenset(domain.states))
    if not element or not state:
        return None
    return {"element": element, "state": state}


def _normalise_quantity(item: dict[str, Any]) -> dict[str, Any] | None:
    value = _clip(item.get("value"), 100)
    obj = _clip(item.get("object"), 300)
    if not value or not obj:
        return None
    return {
        "object": obj,
        "property": _clip(item.get("property"), 300) or "value",
        "value": value,
        "unit": _clip(item.get("unit"), 60),
        "source": _term(item.get("source"), _SOURCE_SET),
        "confidence": _term(item.get("confidence"), _CONFIDENCE_SET),
    }


def _normalise_relation(item: dict[str, Any]) -> dict[str, Any] | None:
    subject = _clip(item.get("subject"), 300)
    relation = _clip(item.get("relation"), 300)
    obj = _clip(item.get("object"), 300)
    if not (subject and relation and obj):
        return None
    return {"subject": subject, "relation": relation, "object": obj}


def _normalise_bbox(value: Any) -> list[float] | None:
    if not isinstance(value, (list, tuple)) or len(value) != 4:
        return None
    try:
        raw = [float(part) for part in value]
    except TypeError, ValueError:
        return None
    if not all(math.isfinite(part) for part in raw):
        return None
    coords = [min(1.0, max(0.0, part)) for part in raw]
    x0, y0, x1, y1 = coords
    if x1 <= x0 or y1 <= y0:
        return None
    return [round(part, 4) for part in coords]


def _normalise_segment(raw: Any, registry: DomainRegistry) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    domain = registry.get(_term(raw.get("domain"), frozenset(registry.domain_ids)))
    segment_type = _term(raw.get("segment_type"), domain.segment_type_keys)
    if segment_type is None:
        segment_type = "other" if "other" in domain.segment_type_keys else domain.segment_types[0].key

    segment = {
        "domain": domain.id,
        "segment_type": segment_type,
        "title": _clip(raw.get("title"), 300),
        "scale": _clip(raw.get("scale"), 100),
        "summary": _clip(raw.get("summary")) or "",
        "entities": _dict_list(raw.get("entities"), lambda item: _normalise_entity(item, domain)),
        "compositions": _dict_list(raw.get("compositions"), _normalise_composition),
        "states": _dict_list(raw.get("states"), lambda item: _normalise_state(item, domain)),
        "quantities": _dict_list(raw.get("quantities"), _normalise_quantity),
        "relations": _dict_list(raw.get("relations"), _normalise_relation),
        "annotations": _str_list(raw.get("annotations")),
        "bbox": _normalise_bbox(raw.get("bbox")),
        "source": _term(raw.get("source"), _SOURCE_SET),
        "confidence": _term(raw.get("confidence"), _CONFIDENCE_SET),
    }
    has_content = any(
        segment[key] for key in ("title", "scale", "summary", "entities", "compositions", "quantities", "annotations")
    )
    if segment["segment_type"] == "other" and not has_content:
        return None
    return segment


def _normalise_title_block(raw: Any) -> dict[str, str] | None:
    if not isinstance(raw, dict):
        return None
    facts = normalise_revision_facts({key: raw.get(key) for key in TITLE_BLOCK_FIELDS})
    return facts or None


def _normalise_document(raw: Any) -> dict[str, Any]:
    raw = raw if isinstance(raw, dict) else {}
    return {
        "title": _clip(raw.get("title"), 300),
        "subtitle": _clip(raw.get("subtitle"), 300),
        "slogans": _str_list(raw.get("slogans")),
        "author": _clip(raw.get("author"), 300),
        "institution": _clip(raw.get("institution"), 300),
        "supervision": _clip(raw.get("supervision"), 300),
        "location": _clip(raw.get("location"), 300),
        "strategies": _str_list(raw.get("strategies")),
        "process_steps": _str_list(raw.get("process_steps")),
        "watermark": _clip(raw.get("watermark"), 300),
        "summary": _clip(raw.get("summary"), 600) or "",
        "title_block": _normalise_title_block(raw.get("title_block")),
    }


_FENCE_RE = re.compile(r"^```[a-zA-Z]*\s*|\s*```$", re.MULTILINE)


def _read_segments(raw_segments: Any, registry: DomainRegistry) -> list[dict[str, Any]]:
    segments: list[dict[str, Any]] = []
    if not isinstance(raw_segments, list):
        return segments
    if len(raw_segments) > _MAX_SEGMENTS:
        logger.warning(
            "Visual analysis holds %d segments, keeping %d; excess depictions are not indexed",
            len(raw_segments),
            _MAX_SEGMENTS,
        )
    for item in raw_segments[:_MAX_SEGMENTS]:
        segment = _normalise_segment(item, registry)
        if segment:
            segments.append(segment)
    return segments


def parse_visual_analysis(reply: str | None, registry: DomainRegistry | None = None) -> dict[str, Any] | None:
    registry = registry or resolve_registry()
    if not reply:
        return None
    text = _FENCE_RE.sub("", reply.strip())
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        raw = json.loads(text[start : end + 1])
    except ValueError, TypeError:
        return None
    if not isinstance(raw, dict):
        return None

    segments = _read_segments(raw.get("segments"), registry)
    if not segments:
        return None
    return {
        "schema_version": SCHEMA_VERSION,
        "registry": registry.fingerprint,
        "segments": segments,
        "document": _normalise_document(raw.get("document")),
    }


def content_type_for(analysis: dict[str, Any], registry: DomainRegistry | None = None) -> str:
    registry = registry or resolve_registry()
    return registry.content_type_for(analysis.get("segments") or [])
