from typing import Any

RETIRED_CARD_REPLACEMENTS: dict[str, str] = {
    "summary": "the answer's first sentence, or the `summary` field of your ```answer_json envelope",
    "verdict_header": "the `verdict` field of your ```answer_json envelope",
    "key_takeaways": "the `takeaways` field of your ```answer_json envelope",
    "callout": "the `callout` field of your ```answer_json envelope",
    "follow_ups": "nothing: follow-up questions are computed after the answer",
    "typed_table": "a Markdown table in the answer",
    "comparison_table": "a Markdown table with a column per variant",
    "requirement_checklist": "a Markdown table with a Status column (Anforderung | Ist | Soll | Status | Fundstelle)",
    "document_checklist": "a table with a Status column (erforderlich, bedingt, vorhanden, fehlt)",
    "deadline_timeline": "a numbered list, each Frist in bold as the Bestimmung words it",
    "norm_chain": "a table of the instruments, or a ```mermaid flowchart TD with the binding one on top",
    "change_impact": "a table with a row per consequence and its Fundstelle",
    "diagram": "a ```mermaid fence in the answer",
    "condition_tree": "a table of the cases, this project's case named once it is known",
    "process_map": "a numbered list, one step per line; a ```mermaid flowchart TD if it forks",
    "legal_basis": "a cited blockquote in the answer: > „<the passage verbatim>“ [N]",
    "fire_compartment": (
        "a table with a Status column (Anforderung | Ist | Soll | Status | Fundstelle); "
        "a calculation card where the area is worked out"
    ),
    "thermal_envelope": "a table with a Status column (Bauteil | Ist | Soll | Status | Fundstelle), the U-Wert in Ist",
    "energy_performance": "a table of the figures against their limits, the Energieeffizienzklasse named",
    "acoustic_check": "a table with a Status column (Bauteil | Ist | Soll | Status | Fundstelle), the Nachweis in Ist",
    "parking_requirement": (
        "a table of the figures against their limits; a calculation card where the count is worked out"
    ),
    "density_check": "a setback_plan card with `coverage` / `density`",
    "elevator_requirement": "a dimension_diagram card with shape `lift_cabin`",
}
RETIRED_CARD_TYPES: frozenset[str] = frozenset(RETIRED_CARD_REPLACEMENTS)


def retired_refusal(card_type: str) -> str:
    return f"card type '{card_type}' no longer exists: write {RETIRED_CARD_REPLACEMENTS[card_type]} instead."


_QUOTE_KEYS = ("original_text", "quote", "excerpt")
_TITLE_KEYS = ("title", "law", "subject")
_SKIPPED_KEYS = frozenset({"type", "lane", "highlight_index", "current_step", "v"})
_LABEL_CHARS = 40


def _cell(value: Any) -> str:
    if isinstance(value, dict):
        value = " · ".join(_cell(item) for item in value.values() if item not in (None, "", [], {}))
    elif isinstance(value, list):
        value = ", ".join(_cell(item) for item in value if item not in (None, "", [], {}))
    return str(value).replace("|", "\\|").replace("\n", " ").strip() if value is not None else ""


def _table(header: list[str], rows: list[list[Any]]) -> list[str]:
    width = len(header)
    lines = ["| " + " | ".join(_cell(cell) for cell in header) + " |", "|" + "---|" * width]
    for row in rows:
        cells = [_cell(cell) for cell in row][:width]
        lines.append("| " + " | ".join(cells + [""] * (width - len(cells))) + " |")
    return lines


def retired_card_markdown(payload: object) -> str | None:
    if not isinstance(payload, dict) or payload.get("type") not in RETIRED_CARD_TYPES:
        return None
    parts: list[str] = []
    title = next(
        (payload[key] for key in _TITLE_KEYS if isinstance(payload.get(key), str) and payload[key].strip()), None
    )
    labels = [
        value.strip()
        for key, value in payload.items()
        if key not in _SKIPPED_KEYS
        and key not in _TITLE_KEYS
        and key not in _QUOTE_KEYS
        and isinstance(value, str)
        and value.strip()
        and len(value) <= _LABEL_CHARS
    ]
    if title or labels:
        parts.append(" · ".join(([f"**{title.strip()}**"] if title else []) + labels))
    columns = payload.get("columns")
    rows = payload.get("rows")
    if isinstance(columns, list) and isinstance(rows, list) and rows and all(isinstance(row, list) for row in rows):
        header = [column.get("label", "") if isinstance(column, dict) else column for column in columns]
        parts.append("\n".join(_table(header, rows)))
    for key, value in payload.items():
        if key in _SKIPPED_KEYS or key in _TITLE_KEYS or key in ("columns", "rows") or value in (None, "", [], {}):
            continue
        if key in _QUOTE_KEYS and isinstance(value, str):
            parts.append(f"> „{value.strip()}“")
        elif isinstance(value, str) and len(value) > _LABEL_CHARS:
            parts.append(value.strip())
        elif isinstance(value, list) and value and all(isinstance(item, dict) for item in value):
            header = list(dict.fromkeys(name for item in value for name in item if name not in _SKIPPED_KEYS))
            parts.append("\n".join(_table(header, [[item.get(name) for name in header] for item in value])))
        elif isinstance(value, list) and value:
            parts.append("\n".join(f"- {_cell(item)}" for item in value))
    return "\n\n".join(parts) if parts else None
