from __future__ import annotations

import json
from types import UnionType
from typing import Any
from typing import Literal
from typing import Union
from typing import get_args
from typing import get_origin

from pydantic import BaseModel

from agent.common.answer_envelope import ANSWER_KINDS
from agent.common.answer_envelope import TAKEAWAYS_MAX_ITEMS
from agent.common.answer_envelope import WORK_ITEMS_MAX
from agent.common.answer_envelope import WORK_SECTIONS
from agent.common.answer_envelope import AnswerMeta
from agent.common.answer_envelope import AnswerMetaCallout
from agent.common.answer_envelope import AnswerMetaConfidence
from agent.common.answer_envelope import AnswerMetaTakeaway
from agent.common.answer_envelope import AnswerMetaVerdict
from agent.common.answer_envelope import AnswerMetaWork
from agent.common.answer_envelope import AnswerMetaWorkItem
from agent.common.envelope_gates import ANATOMY_FIELDS


def _shape(model_cls: type[BaseModel]) -> str:
    parts: list[str] = []
    for name, info in model_cls.model_fields.items():
        type_str = _shape_type(info.annotation)
        req = "*" if info.is_required() else ""
        desc = f" ({info.description})" if info.description else ""
        parts.append(f"{name}{req}: {type_str}{desc}")
    return "{ " + ", ".join(parts) + " }"


def _shape_type(annotation: Any) -> str:
    origin = getattr(annotation, "__args__", None)
    if annotation is str or (origin and str in origin):
        return "string"
    if getattr(annotation, "__origin__", None) is Literal or "Literal" in str(annotation):
        return " | ".join(json.dumps(a) for a in annotation.__args__)  # type: ignore[union-attr]
    if isinstance(annotation, type) and issubclass(annotation, BaseModel):
        return _shape(annotation)
    if origin:
        inner = next((a for a in origin if a is not type(None)), str)
        if isinstance(inner, type) and issubclass(inner, BaseModel):
            return _shape(inner)
    return "string"


def _strict_property(annotation: object, *, required: bool) -> dict:
    origin = get_origin(annotation)
    if origin is Union or origin is UnionType:
        members = [a for a in get_args(annotation) if a is not type(None)]
        nullable = len(members) < len(get_args(annotation)) or not required
        core: object = members[0]
    else:
        nullable = not required
        core = annotation

    schema: dict
    if core is str:
        schema = {"type": "string"}
    elif core is bool:
        schema = {"type": "boolean"}
    elif get_origin(core) is Literal:
        schema = {"type": "string", "enum": list(get_args(core))}
    elif isinstance(core, type) and issubclass(core, BaseModel):
        schema = _strict_object(core)
    elif get_origin(core) is list:
        (item,) = get_args(core)
        schema = {"type": "array", "items": _strict_property(item, required=True)}
    else:
        raise TypeError(f"envelope field type {annotation!r} has no strict-schema rendering")

    if not nullable:
        return schema
    if isinstance(schema.get("type"), str) and schema["type"] != "object" and "enum" not in schema:
        return {**schema, "type": [schema["type"], "null"]}
    return {"anyOf": [schema, {"type": "null"}]}


def _strict_object(model_cls: type[BaseModel]) -> dict:
    properties: dict[str, dict] = {}
    for name, info in model_cls.model_fields.items():
        extra = info.json_schema_extra if isinstance(info.json_schema_extra, dict) else {}
        if extra.get("strict_schema") == "omit":
            continue
        prop = _strict_property(info.annotation, required=info.is_required())
        if info.description:
            prop = {**prop, "description": info.description}
        properties[name] = prop
    return {
        "type": "object",
        "properties": properties,
        "required": list(properties),
        "additionalProperties": False,
    }


MASTHEAD_FIELDS = ("kind", "topic", "context", "verdict", "summary")


def _masthead_first(properties: dict) -> dict:
    head = {name: properties[name] for name in MASTHEAD_FIELDS if name in properties}
    answer = {"answer": properties["answer"]} if "answer" in properties else {}
    rest = {name: value for name, value in properties.items() if name not in head and name != "answer"}
    return {**head, **answer, **rest}


def render_envelope_response_format() -> dict:
    schema = _strict_object(AnswerMeta)
    schema["properties"] = _masthead_first(
        {
            "answer": {
                "type": "string",
                "description": "the full written answer: markdown prose with [N] citations and the sources section",
            },
            **schema["properties"],
        }
    )
    schema["required"] = list(schema["properties"])
    return {
        "type": "json_schema",
        "json_schema": {"name": "answer_envelope", "strict": True, "schema": schema},
    }


def _masthead_lines_first(lines: list[str]) -> list[str]:
    named = {line.split(":", 1)[0].rstrip("*"): line for line in lines}
    order = [*MASTHEAD_FIELDS, "answer"]
    head = [named[name] for name in order if name in named]
    return head + [line for line in lines if line not in head]


def render_envelope_schema() -> str:
    lines = [
        "answer*: string (the full written answer: markdown prose with [N] citations and the sources section)",
        f"confidence: {_shape(AnswerMetaConfidence)}",
        "escalate_to_deep: boolean (true when the question needs deep research: a commissioned report "
        "(never a document: a document is drafted, not researched), many sources to read against each "
        "other, or retrieved sources that cannot support an adequate answer)",
        "escalation_reason: string (with escalate_to_deep: one short clause saying why, in the answer's language)",
        f"skills_applied: [string] ({AnswerMeta.model_fields['skills_applied'].description})",
    ]
    field_models: dict[str, type[BaseModel] | None] = {
        "verdict": AnswerMetaVerdict,
        "callout": AnswerMetaCallout,
    }
    for field in ANATOMY_FIELDS:
        if field.name == "kind":
            kinds = " | ".join(json.dumps(k) for k in ANSWER_KINDS)
            lines.append(f"kind: {kinds}")
            continue
        if field.name == "takeaways":
            lines.append(f"takeaways: [{_shape(AnswerMetaTakeaway)}] (2-{TAKEAWAYS_MAX_ITEMS} items)")
            continue
        if field.name == "work":
            sections = ", ".join(
                f"{name}: [item] ({AnswerMetaWork.model_fields[name].description})" for name in WORK_SECTIONS
            )
            lines.append(
                f"work: {{ {sections} }} (only for kind=work; up to {WORK_ITEMS_MAX} lines each; "
                f"item = {_shape(AnswerMetaWorkItem)})"
            )
            continue
        model_cls = field_models.get(field.name)
        if model_cls is not None:
            suffix = " (only for kind=ruling)" if field.name == "verdict" else ""
            lines.append(f"{field.name}: {_shape(model_cls)}{suffix}")
            continue
        if field.name in AnswerMeta.model_fields:
            description = AnswerMeta.model_fields[field.name].description
            lines.append(f"{field.name}: string ({description})")
    cards_description = AnswerMeta.model_fields["cards"].description
    lines.append(f"cards: [ {{ type*: string, …the fields of that type }} ] ({cards_description})")
    lines = _masthead_lines_first(lines)
    rendered = "\n".join(f"  {line}" for line in lines)
    from agent.cards.envelope import render_envelope_cards_contract

    return rendered + "\n\nCARDS (the `cards` field):\n" + render_envelope_cards_contract()
