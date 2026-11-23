import json
import types
import typing
from typing import Any
from typing import Literal

from pydantic import BaseModel
from pydantic_core import PydanticUndefined


def _annotation_str(annotation: object, nested: list[type]) -> str:
    origin = typing.get_origin(annotation)
    args = typing.get_args(annotation)

    if origin in (typing.Union, types.UnionType):
        non_none = [a for a in args if a is not type(None)]
        return " | ".join(_annotation_str(a, nested) for a in non_none)
    if origin in (list, typing.List):  # noqa: UP006
        return f"[{_annotation_str(args[0], nested)}]"
    if origin is Literal:
        return " | ".join(json.dumps(a, ensure_ascii=False) for a in args)
    if isinstance(annotation, type) and issubclass(annotation, BaseModel):
        if annotation not in nested:
            nested.append(annotation)
        return annotation.__name__
    return {str: "string", float: "number", int: "integer", bool: "boolean"}.get(
        annotation, getattr(annotation, "__name__", str(annotation))
    )


def _field_constraints(field_info: object) -> list[str]:
    out: list[str] = []
    for meta in getattr(field_info, "metadata", []) or []:
        gt = getattr(meta, "gt", None)
        ge = getattr(meta, "ge", None)
        min_length = getattr(meta, "min_length", None)
        if gt is not None:
            out.append(f"> {gt}")
        elif ge is not None:
            out.append(f">= {ge}")
        if min_length:
            out.append("non-empty")
    default = getattr(field_info, "default", PydanticUndefined)
    if default not in (PydanticUndefined, None) and not field_info.is_required():
        out.append(f"default {json.dumps(default, ensure_ascii=False)}")
    return out


def _is_discriminator(field_name: str, field_info: Any) -> bool:
    if field_name != "type":
        return False
    return len(getattr(field_info.annotation, "__args__", ())) == 1


def _shape(model_cls: type, nested: list[type], *, with_desc: bool) -> str:
    from agent.cards.proposal_cards import SERVER_SET_CARD_FIELDS  # models import this module

    parts: list[str] = []
    for field_name, field_info in model_cls.model_fields.items():
        if _is_discriminator(field_name, field_info) or field_name in SERVER_SET_CARD_FIELDS:
            continue
        req = "*" if field_info.is_required() else ""
        type_str = _annotation_str(field_info.annotation, nested)
        notes: list[str] = []
        if with_desc and field_info.description:
            notes.append(field_info.description)
        notes.extend(_field_constraints(field_info))
        suffix = f" ({'; '.join(notes)})" if notes else ""
        parts.append(f"{field_name}{req}: {type_str}{suffix}")
    return "{ " + ", ".join(parts) + " }"


def _card_shape(card_cls: type, nested: list[type]) -> str:
    return _shape(card_cls, nested, with_desc=False)


def _field_specs(model_cls: type, nested: list[type]) -> list[dict[str, Any]]:
    specs: list[dict[str, Any]] = []
    for field_name, field_info in model_cls.model_fields.items():
        if _is_discriminator(field_name, field_info):
            continue
        specs.append(
            {
                "name": field_name,
                "type": _annotation_str(field_info.annotation, nested),
                "required": field_info.is_required(),
                "description": field_info.description or "",
                "constraints": _field_constraints(field_info),
            }
        )
    return specs
