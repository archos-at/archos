from __future__ import annotations

import json
from typing import Any

from agent.knowledge.title_block import title_block_label
from knowledge_layer.ingest.visual_analysis import _MAX_STR
from knowledge_layer.ingest.visual_analysis import SCHEMA_VERSION
from knowledge_layer.ingest.visual_domains import Domain
from knowledge_layer.ingest.visual_domains import DomainRegistry
from knowledge_layer.ingest.visual_domains import resolve_registry


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


def _entity_lines(segment: dict[str, Any], domain: Domain) -> list[str]:
    labels = {category.key: category.label for category in domain.entity_categories}
    lines: list[str] = []
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
    return lines


def _composition_line(composition: dict[str, Any]) -> str:
    layer_bits = []
    for layer in composition["layers"]:
        bit = layer["material"]
        if layer.get("thickness"):
            bit += f" {layer['thickness']}"
        if layer.get("function"):
            bit += f" ({layer['function']})"
        layer_bits.append(bit)
    rendered_layers = " | ".join(layer_bits) if layer_bits else "layers not legible"
    return f"Build-up {composition['component']}: {rendered_layers}"


def render_segment_text(
    segment: dict[str, Any],
    registry: DomainRegistry | None = None,
    *,
    position: tuple[int, int] | None = None,
) -> str:
    registry = registry or resolve_registry()
    domain = registry.get(segment.get("domain"))

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
    lines.extend(_entity_lines(segment, domain))

    if segment.get("annotations"):
        lines.append(f"Annotations: {', '.join(segment['annotations'])}")

    for composition in segment.get("compositions") or []:
        lines.append(_composition_line(composition))

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


def _with_lead(text: str, document: dict[str, Any]) -> str:
    lead = [part for part in (document.get("summary"), render_document_text(document)) if part]
    return "\n".join(lead) + "\n\n" + text if lead else text


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
            text = _with_lead(text, document)
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
