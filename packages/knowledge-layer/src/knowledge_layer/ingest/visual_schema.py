from __future__ import annotations

from typing import Any

from knowledge_layer.ingest.visual_analysis import CONFIDENCES
from knowledge_layer.ingest.visual_analysis import SOURCES
from knowledge_layer.ingest.visual_analysis import UNKNOWN
from knowledge_layer.ingest.visual_domains import DomainRegistry


def _nullable_string(description: str) -> dict[str, Any]:
    return {"type": ["string", "null"], "description": description}


def _string_array(description: str) -> dict[str, Any]:
    return {"type": "array", "items": {"type": "string"}, "description": description}


def _obj(properties: dict[str, Any]) -> dict[str, Any]:
    return {
        "type": "object",
        "properties": properties,
        "required": list(properties),
        "additionalProperties": False,
    }


def _entity_schema(registry: DomainRegistry) -> dict[str, Any]:
    return _obj(
        {
            "name": {"type": "string", "description": "The thing as it is named on the image."},
            "category": {
                "type": "string",
                "enum": list(registry.category_keys()),
                "description": "Category from the vocabulary of this segment's domain.",
            },
            "role": _nullable_string("What it is for, when stated."),
            "measure": _nullable_string("A size or quantity belonging to this entity, e.g. '24.5 m²'."),
        }
    )


def _composition_schema() -> dict[str, Any]:
    layer = _obj(
        {
            "material": {"type": "string"},
            "thickness": _nullable_string("e.g. '200 mm'."),
            "function": _nullable_string("e.g. 'load-bearing', 'insulation'."),
        }
    )

    return _obj(
        {
            "component": {"type": "string", "description": "The assembled component, e.g. 'external wall'."},
            "layers": {
                "type": "array",
                "items": layer,
                "description": "Layers in order, outside to inside.",
            },
        }
    )


def _quantity_schema() -> dict[str, Any]:
    return _obj(
        {
            "object": {"type": "string", "description": "What the number is ABOUT. Never omit this."},
            "property": {"type": "string", "description": "Which property of it, e.g. 'share', 'area'."},
            "value": {"type": "string"},
            "unit": _nullable_string("e.g. '%', 'm²', 'mm'."),
            "source": {"type": "string", "enum": [*SOURCES, UNKNOWN]},
            "confidence": {"type": "string", "enum": [*CONFIDENCES, UNKNOWN]},
        }
    )


def _segment_schema(registry: DomainRegistry) -> dict[str, Any]:
    entity = _entity_schema(registry)
    composition = _composition_schema()

    state = _obj(
        {
            "element": {"type": "string"},
            "state": {"type": "string", "enum": list(registry.state_keys())},
        }
    )

    quantity = _quantity_schema()

    relation = _obj(
        {
            "subject": {"type": "string"},
            "relation": {"type": "string", "description": "e.g. 'connects', 'is above', 'serves'."},
            "object": {"type": "string"},
        }
    )

    return _obj(
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
            "title": _nullable_string("Title of this depiction, from the sheet."),
            "scale": _nullable_string("Scale of THIS depiction, e.g. '1:100'."),
            "summary": {"type": "string", "description": "One or two sentences, in the document's language."},
            "entities": {"type": "array", "items": entity},
            "compositions": {"type": "array", "items": composition},
            "states": {"type": "array", "items": state},
            "quantities": {"type": "array", "items": quantity},
            "relations": {"type": "array", "items": relation},
            "annotations": _string_array("Verbatim dimension and label strings."),
            "bbox": {
                "type": ["array", "null"],
                "items": {"type": "number"},
                "description": "Approximate [x0, y0, x1, y1] within the image, normalised 0-1.",
            },
            "source": {"type": "string", "enum": [*SOURCES, UNKNOWN]},
            "confidence": {"type": "string", "enum": [*CONFIDENCES, UNKNOWN]},
        }
    )


def _document_schema() -> dict[str, Any]:
    title_block = _obj(
        {
            "document_number": _nullable_string("Plannummer / Zeichnungsnummer exactly as printed."),
            "revision": _nullable_string("The Index as printed: a letter or a number, e.g. 'C' or '07'."),
            "revision_date": _nullable_string("Date of that Index or the plan's Stand, ISO 'YYYY-MM-DD'."),
            "scale": _nullable_string("Maßstab of the sheet as printed, e.g. '1:100'."),
            "title": _nullable_string("Planinhalt / Bezeichnung of the sheet as printed."),
        }
    )

    return _obj(
        {
            "title": _nullable_string("Project or document title from the title block."),
            "subtitle": _nullable_string("Subtitle — never merged with the title."),
            "slogans": _string_array("Graphic headlines — never merged with the title."),
            "author": _nullable_string(""),
            "institution": _nullable_string(""),
            "supervision": _nullable_string(""),
            "location": _nullable_string(""),
            "strategies": _string_array("Stated strategies or approaches."),
            "process_steps": _string_array("Ordered process or phasing steps."),
            "watermark": _nullable_string("Licence/watermark text, quarantined here and nowhere else."),
            "summary": {"type": "string", "description": "ONE sentence about the whole image."},
            "title_block": title_block,
        }
    )


def json_schema(registry: DomainRegistry) -> dict[str, Any]:
    segment = _segment_schema(registry)
    document = _document_schema()

    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "title": "VisualAnalysis",
        "description": (
            "Structured reading of one image: a list of depictions (segments), each read "
            "with one domain's vocabulary, plus the document-level facts printed on it."
        ),
        **_obj(
            {
                "segments": {"type": "array", "items": segment, "description": "One entry per depiction."},
                "document": document,
            }
        ),
    }
