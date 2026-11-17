from __future__ import annotations

import json
import logging
import math
import re
from typing import Any

from knowledge_layer.ingest.visual_domains import Domain
from knowledge_layer.ingest.visual_domains import DomainRegistry
from knowledge_layer.ingest.visual_domains import resolve_registry

from agent.knowledge.title_block import TITLE_BLOCK_FIELDS
from agent.knowledge.title_block import normalise_revision_facts
from agent.knowledge.title_block import title_block_label

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




def json_schema(registry: DomainRegistry) -> dict[str, Any]:

    def nullable_string(description: str) -> dict[str, Any]:
        return {"type": ["string", "null"], "description": description}

    def string_array(description: str) -> dict[str, Any]:
        return {"type": "array", "items": {"type": "string"}, "description": description}

    def obj(properties: dict[str, Any]) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": properties,
            "required": list(properties),
            "additionalProperties": False,
        }

    entity = obj(
        {
            "name": {"type": "string", "description": "The thing as it is named on the image."},
            "category": {
                "type": "string",
                "enum": list(registry.category_keys()),
                "description": "Category from the vocabulary of this segment's domain.",
            },
            "role": nullable_string("What it is for, when stated."),
            "measure": nullable_string("A size or quantity belonging to this entity, e.g. '24.5 m²'."),
        }
    )

    layer = obj(
        {
            "material": {"type": "string"},
            "thickness": nullable_string("e.g. '200 mm'."),
            "function": nullable_string("e.g. 'load-bearing', 'insulation'."),
        }
    )

    composition = obj(
        {
            "component": {"type": "string", "description": "The assembled component, e.g. 'external wall'."},
            "layers": {
                "type": "array",
                "items": layer,
                "description": "Layers in order, outside to inside.",
            },
        }
    )

    state = obj(
        {
            "element": {"type": "string"},
            "state": {"type": "string", "enum": list(registry.state_keys())},
        }
    )

    quantity = obj(
        {
            "object": {"type": "string", "description": "What the number is ABOUT. Never omit this."},
            "property": {"type": "string", "description": "Which property of it, e.g. 'share', 'area'."},
            "value": {"type": "string"},
            "unit": nullable_string("e.g. '%', 'm²', 'mm'."),
            "source": {"type": "string", "enum": [*SOURCES, UNKNOWN]},
            "confidence": {"type": "string", "enum": [*CONFIDENCES, UNKNOWN]},
        }
    )

    relation = obj(
        {
            "subject": {"type": "string"},
            "relation": {"type": "string", "description": "e.g. 'connects', 'is above', 'serves'."},
            "object": {"type": "string"},
        }
    )

    segment = obj(
        {
            "domain": {
                "type": "string",
                "enum": list(registry.domain_ids),
                "description": "Which domain vocabulary this segment was read with.",
            },
            "segment_type": {
                "type": "string",
                "enum": list(registry.segment_type_keys()),
                "description": "What this depiction is, from that domain's vocabulary.",
            },
            "title": nullable_string("Title of this depiction, from the sheet."),
            "scale": nullable_string("Scale of THIS depiction, e.g. '1:100'."),
            "summary": {"type": "string", "description": "One or two sentences, in the document's language."},
            "entities": {"type": "array", "items": entity},
            "compositions": {"type": "array", "items": composition},
            "states": {"type": "array", "items": state},
            "quantities": {"type": "array", "items": quantity},
            "relations": {"type": "array", "items": relation},
            "annotations": string_array("Verbatim dimension and label strings."),
            "bbox": {
                "type": ["array", "null"],
                "items": {"type": "number"},
                "description": "Approximate [x0, y0, x1, y1] within the image, normalised 0-1.",
            },
            "source": {"type": "string", "enum": [*SOURCES, UNKNOWN]},
            "confidence": {"type": "string", "enum": [*CONFIDENCES, UNKNOWN]},
        }
    )

    title_block = obj(
        {
            "document_number": nullable_string("Plannummer / Zeichnungsnummer exactly as printed."),
            "revision": nullable_string("The Index as printed: a letter or a number, e.g. 'C' or '07'."),
            "revision_date": nullable_string("Date of that Index or the plan's Stand, ISO 'YYYY-MM-DD'."),
            "scale": nullable_string("Maßstab of the sheet as printed, e.g. '1:100'."),
            "title": nullable_string("Planinhalt / Bezeichnung of the sheet as printed."),
        }
    )

    document = obj(
        {
            "title": nullable_string("Project or document title from the title block."),
            "subtitle": nullable_string("Subtitle — never merged with the title."),
            "slogans": string_array("Graphic headlines — never merged with the title."),
            "author": nullable_string(""),
            "institution": nullable_string(""),
            "supervision": nullable_string(""),
            "location": nullable_string(""),
            "strategies": string_array("Stated strategies or approaches."),
            "process_steps": string_array("Ordered process or phasing steps."),
            "watermark": nullable_string("Licence/watermark text, quarantined here and nowhere else."),
            "summary": {"type": "string", "description": "ONE sentence about the whole image."},
            "title_block": title_block,
        }
    )

    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "title": "VisualAnalysis",
        "description": (
            "Structured reading of one image: a list of depictions (segments), each read "
            "with one domain's vocabulary, plus the document-level facts printed on it."
        ),
        **obj(
            {
                "segments": {"type": "array", "items": segment, "description": "One entry per depiction."},
                "document": document,
            }
        ),
    }




def _sketch(node: dict[str, Any], indent: int = 0) -> str:
    pad = "  " * indent
    node_type = node.get("type")
    types = node_type if isinstance(node_type, list) else [node_type]

    if "object" in types:
        lines = ["{"]
        properties: dict[str, Any] = node.get("properties", {})
        for name, child in properties.items():
            rendered = _sketch(child, indent + 1)
            description = child.get("description", "")
            comment = f"   // {description}" if description and "\n" not in rendered else ""
            lines.append(f'{pad}  "{name}": {rendered},{comment}')
        lines.append(pad + "}")
        return "\n".join(lines)

    if "array" in types:
        return f"[{_sketch(node.get('items', {}), indent)}]"

    if node.get("enum"):
        allowed = [str(value) for value in node["enum"] if value is not None]
        suffix = "|null" if None in node["enum"] or "null" in types else ""
        return "|".join(allowed) + suffix

    base = next((t for t in types if t and t != "null"), "string")
    return f"{base}|null" if "null" in types else base


def build_prompt(registry: DomainRegistry, *, context: str | None = None) -> str:
    domain_blocks: list[str] = []
    for domain in registry.domains:
        types = "\n".join(
            f"    - {segment_type.key}: {segment_type.label}" for segment_type in domain.active_segment_types
        )
        categories = "\n".join(
            f"    - {category.key}: {category.label}" + (f" ({category.hint})" if category.hint else "")
            for category in domain.active_entity_categories
        )
        states = (
            f"\n  states: {', '.join(domain.states)}" if domain.states else "\n  states: none — leave the list empty"
        )
        guidance = "".join(f"\n  - {line}" for line in domain.guidance)
        domain_blocks.append(
            f"""### domain "{domain.id}" — {domain.label}
  Use for {domain.applies_to}.
  segment_type:
{types}
  entity categories:
{categories}
  measure: "{domain.measure_label}"{states}{guidance}"""
        )

    domains_text = "\n\n".join(domain_blocks)
    schema_text = _sketch(json_schema(registry))

    prompt = f"""You are reading ONE image taken from an uploaded document. It may be a \
rendered page, a picture embedded in a PDF, or an uploaded image file.

Work in two steps.
1. LOOK: find every distinct depiction in the image. A single sheet often \
carries several — a plan, a section, a detail, a legend, a photograph, a chart.
2. RECORD: return ONE JSON object matching the schema below. No text before or \
after it, and no markdown fences.

Rules:
- One entry in "segments" per depiction. If the image shows only one thing, \
return exactly one segment.
- Repeated depictions of the same kind side by side are SEPARATE segments. \
Two floor plans next to each other are two segments, even when both are \
"floor_plan" — never merge them into one. Give each its own title, scale, \
summary and bbox. When in doubt whether two regions are one depiction or \
two, split them: an extra segment is cheap, a merged one loses a drawing.
- Choose the "domain" that fits each depiction, and take its "segment_type" and \
its entity "category" values from THAT domain's vocabulary below. Different \
segments of the same image may use different domains.
- "scale" belongs to the segment, not to the image.
- "bbox" is the approximate position of the depiction within the image as \
[x0, y0, x1, y1], normalised 0-1 with (0,0) at the top left; null when unsure.
- Never record a number without its meaning: every figure goes into \
"quantities" as object + property + value + unit. "71" alone is useless; \
{{"object": "existing fabric retained", "property": "share", "value": "71", "unit": "%"}} is not.
- Record relationships as triples in "relations", for example \
{{"subject": "ramp", "relation": "connects", "object": "courtyard level and roof landscape"}}.
- Record layered build-ups in "compositions", layers in order, with material, \
thickness and function.
- "source" says how you know: "text" when it is written on the image, "visual" \
when you read it from the depiction, "inferred" when you concluded it. \
"confidence" is high, medium or low. Never present an inference as certain.
- Put licence or watermark text (for example "VECTORWORKS EDUCATIONAL VERSION") \
in "document.watermark" and nowhere else. Never let it reach a summary.
- "document.title_block" is the PLANKOPF (Schriftfeld) of a drawing sheet, once \
for the whole image: "document_number" is the Plannummer or Zeichnungsnummer exactly \
as printed; "revision" is the Index of THIS state as printed (a letter or a number \
only, without the word "Index"); when the sheet has a revision table \
(Änderungs- or Indexfeld), take its LAST (newest) row; "revision_date" is the \
date printed with that Index or the Plandatum/Stand, written YYYY-MM-DD; "scale" is \
the Maßstab of the sheet; "title" is the Planinhalt. Read these ONLY from the title \
block itself, never from the drawing body or from a file name, and leave a field \
null when it is not printed or not legible. A photo, chart, poster or text page has \
no title block: every field null. Never guess an Index, a number or a date.
- Unknown fields: null, or an empty list. Invent nothing.
- Write free text (summaries, titles, names) in the LANGUAGE OF THE DOCUMENT, \
not in English.

## Domain vocabularies

{domains_text}

## Shape

{schema_text}"""
    if context:
        prompt += f"\n\nKnown about this image (from the file, not the pixels): {context}"
    return prompt




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

    raw_segments = raw.get("segments")
    segments: list[dict[str, Any]] = []
    if isinstance(raw_segments, list):
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




def legacy_fields(analysis: dict[str, Any]) -> dict[str, str]:
    segments = analysis.get("segments") or []
    document = analysis.get("document") or {}
    out: dict[str, str] = {}

    types = list(dict.fromkeys(segment["segment_type"] for segment in segments))
    if types:
        out["drawing_type"] = ", ".join(types)
    scales = list(dict.fromkeys(s["scale"] for s in segments if s.get("scale")))
    if scales:
        out["scale"] = ", ".join(scales)
    if document.get("title"):
        out["title"] = document["title"]

    entities = [entity for segment in segments for entity in segment.get("entities") or []]
    names = list(dict.fromkeys(entity["name"] for entity in entities))
    if names:
        out["elements"] = ", ".join(names[:25])
    roles = list(dict.fromkeys(entity["role"] for entity in entities if entity.get("role")))
    if roles:
        out["use"] = ", ".join(roles[:10])
    materials = list(dict.fromkeys(e["name"] for e in entities if e["category"] == "material"))
    if materials:
        out["materials"] = ", ".join(materials[:15])

    dims = [
        f"{q['object']} {q['property']}: {q['value']}{' ' + q['unit'] if q.get('unit') else ''}"
        for segment in segments
        for q in segment.get("quantities") or []
    ]
    if dims:
        out["dimensions"] = "; ".join(dims[:15])

    relations = [
        f"{r['subject']} {r['relation']} {r['object']}" for segment in segments for r in segment.get("relations") or []
    ]
    if relations:
        out["spatial_relations"] = ". ".join(relations[:10])

    details = [segment["summary"] for segment in segments if segment.get("summary")]
    if details:
        out["detail"] = " ".join(details)[:_MAX_STR]

    if document.get("watermark"):
        out["watermark"] = document["watermark"]
    if document.get("summary"):
        out["summary"] = document["summary"]
    elif details:
        out["summary"] = details[0][:600]
    return out




def render_segment_text(
    segment: dict[str, Any],
    registry: DomainRegistry | None = None,
    *,
    position: tuple[int, int] | None = None,
) -> str:
    registry = registry or resolve_registry()
    domain = registry.get(segment.get("domain"))
    labels = {category.key: category.label for category in domain.entity_categories}

    lines: list[str] = []
    header = segment["segment_type"].replace("_", " ").capitalize()
    if position is not None:
        header += f" {position[0]} of {position[1]}"
    if segment.get("title"):
        header += f" — {segment['title']}"
    if segment.get("scale"):
        header += f" ({domain.measure_label} {segment['scale']})"
    lines.append(header)
    if segment.get("summary"):
        lines.append(segment["summary"])

    grouped: dict[str, list[str]] = {}
    for entity in segment.get("entities") or []:
        rendered = entity["name"]
        extras = [part for part in (entity.get("role"), entity.get("measure")) if part]
        if extras:
            rendered += f" ({', '.join(extras)})"
        grouped.setdefault(entity["category"], []).append(rendered)
    for category in domain.entity_categories:
        values = grouped.get(category.key)
        if values:
            lines.append(f"{category.label}: {', '.join(values)}")
    for key, values in grouped.items():
        if key not in labels:
            lines.append(f"{key}: {', '.join(values)}")

    if segment.get("annotations"):
        lines.append(f"Annotations: {', '.join(segment['annotations'])}")

    for composition in segment.get("compositions") or []:
        layer_bits = []
        for layer in composition["layers"]:
            bit = layer["material"]
            if layer.get("thickness"):
                bit += f" {layer['thickness']}"
            if layer.get("function"):
                bit += f" ({layer['function']})"
            layer_bits.append(bit)
        rendered_layers = " | ".join(layer_bits) if layer_bits else "layers not legible"
        lines.append(f"Build-up {composition['component']}: {rendered_layers}")

    if segment.get("states"):
        state_bits = [f"{item['element']}: {item['state']}" for item in segment["states"]]
        lines.append(f"State: {', '.join(state_bits)}")

    for quantity in segment.get("quantities") or []:
        unit = f" {quantity['unit']}" if quantity.get("unit") else ""
        lines.append(f"Figure: {quantity['object']} — {quantity['property']}: {quantity['value']}{unit}")

    for relation in segment.get("relations") or []:
        lines.append(f"Relation: {relation['subject']} → {relation['relation']} → {relation['object']}")

    if segment.get("source") or segment.get("confidence"):
        bits = [
            b
            for b in (
                segment.get("source") and f"Source: {segment['source']}",
                segment.get("confidence") and f"Confidence: {segment['confidence']}",
            )
            if b
        ]
        if bits:
            lines.append(", ".join(bits))

    return "\n".join(lines)


def render_document_text(document: dict[str, Any]) -> str:
    lines: list[str] = []
    title_bits = [part for part in (document.get("title"), document.get("subtitle")) if part]
    if title_bits:
        lines.append("Project: " + " — ".join(title_bits))
    meta_bits = [
        part
        for part in (
            document.get("author"),
            document.get("institution"),
            document.get("supervision"),
            document.get("location"),
        )
        if part
    ]
    if meta_bits:
        lines.append("Details: " + ", ".join(meta_bits))
    title_block = document.get("title_block") or {}
    label = title_block_label(title_block)
    if label:
        extras = [f"Scale {title_block['scale']}" if title_block.get("scale") else "", title_block.get("title") or ""]
        lines.append("Title block: " + ", ".join(part for part in (label, *extras) if part))
    if document.get("slogans"):
        lines.append("Headlines: " + ", ".join(document["slogans"]))
    if document.get("strategies"):
        lines.append("Strategies: " + ", ".join(document["strategies"]))
    if document.get("process_steps"):
        lines.append("Process: " + " → ".join(document["process_steps"]))
    return "\n".join(lines)


def render_analysis_text(analysis: dict[str, Any], registry: DomainRegistry | None = None) -> str:
    registry = registry or resolve_registry()
    document = analysis.get("document") or {}
    parts: list[str] = []
    if document.get("summary"):
        parts.append(document["summary"])
    document_text = render_document_text(document)
    if document_text:
        parts.append(document_text)
    for segment in analysis.get("segments") or []:
        parts.append(render_segment_text(segment, registry))
    return "\n\n".join(part for part in parts if part)




def segment_payloads(analysis: dict[str, Any], registry: DomainRegistry | None = None) -> list[dict[str, Any]]:
    registry = registry or resolve_registry()
    document = analysis.get("document") or {}
    segments = analysis.get("segments") or []
    totals: dict[str, int] = {}
    for segment in segments:
        segment_key = str(segment.get("segment_type") or "")
        totals[segment_key] = totals.get(segment_key, 0) + 1
    seen: dict[str, int] = {}
    payloads: list[dict[str, Any]] = []
    for index, segment in enumerate(segments):
        segment_key = str(segment.get("segment_type") or "")
        position: tuple[int, int] | None = None
        if totals.get(segment_key, 0) > 1:
            seen[segment_key] = seen.get(segment_key, 0) + 1
            position = (seen[segment_key], totals[segment_key])
        text = render_segment_text(segment, registry, position=position)
        if index == 0:
            lead = [part for part in (document.get("summary"), render_document_text(document)) if part]
            if lead:
                text = "\n".join(lead) + "\n\n" + text
        payloads.append(
            {
                "text": text,
                "drawing_type": segment["segment_type"],
                "drawing_scale": segment.get("scale") or "",
                "segment_index": index,
                "segment_count": len(segments),
                "drawing_data": json.dumps(
                    {
                        "schema_version": analysis.get("schema_version", SCHEMA_VERSION),
                        "registry": analysis.get("registry", registry.fingerprint),
                        "segment": segment,
                        "document": document,
                    },
                    ensure_ascii=False,
                ),
            }
        )
    return payloads
