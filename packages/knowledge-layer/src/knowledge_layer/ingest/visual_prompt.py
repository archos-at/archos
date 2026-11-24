from __future__ import annotations

from typing import Any

from knowledge_layer.ingest.visual_domains import Domain
from knowledge_layer.ingest.visual_domains import DomainRegistry
from knowledge_layer.ingest.visual_schema import json_schema

_PROMPT = """You are reading ONE image taken from an uploaded document. It may be a \
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


def _domain_block(domain: Domain) -> str:
    types = "\n".join(f"    - {segment_type.key}: {segment_type.label}" for segment_type in domain.active_segment_types)
    categories = "\n".join(
        f"    - {category.key}: {category.label}" + (f" ({category.hint})" if category.hint else "")
        for category in domain.active_entity_categories
    )
    states = f"\n  states: {', '.join(domain.states)}" if domain.states else "\n  states: none — leave the list empty"
    guidance = "".join(f"\n  - {line}" for line in domain.guidance)
    return f"""### domain "{domain.id}" — {domain.label}
  Use for {domain.applies_to}.
  segment_type:
{types}
  entity categories:
{categories}
  measure: "{domain.measure_label}"{states}{guidance}"""


def build_prompt(registry: DomainRegistry, *, context: str | None = None) -> str:
    domain_blocks: list[str] = []
    for domain in registry.domains:
        domain_blocks.append(_domain_block(domain))

    domains_text = "\n\n".join(domain_blocks)
    schema_text = _sketch(json_schema(registry))

    prompt = _PROMPT.format(domains_text=domains_text, schema_text=schema_text)
    if context:
        prompt += f"\n\nKnown about this image (from the file, not the pixels): {context}"
    return prompt
