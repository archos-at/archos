import re
from typing import Any

from pydantic import BaseModel
from pydantic import field_validator

_MD_LINK = re.compile(r"!?\[([^\]\n]*)\]\(\s*<?([^)\s]*)>?(?:\s+\"[^\"\n]*\")?\s*\)")


_MD_STRONG = re.compile(r"(\*\*|__)(?=\S)(.+?)(?<=\S)\1", re.DOTALL)


_MD_CODE = re.compile(r"`+([^`\n]+)`+")


def _unwrap_link(match: re.Match[str]) -> str:
    label = match.group(1).strip()
    target = match.group(2).strip()
    if not target or target == label:
        return label
    if not label:
        return target
    return f"{label} ({target})"


def flatten_card_markup(value: str) -> str:
    flattened = _MD_LINK.sub(_unwrap_link, value)
    flattened = _MD_STRONG.sub(lambda m: m.group(2), flattened)
    return _MD_CODE.sub(lambda m: m.group(1), flattened)


def _flatten_markup_deep(value: Any) -> Any:
    if isinstance(value, str):
        return flatten_card_markup(value)
    if isinstance(value, list):
        return [_flatten_markup_deep(item) for item in value]
    return value


class CardModel(BaseModel):
    @field_validator("*", mode="after")
    @classmethod
    def _flatten_text_markup(cls, value: Any) -> Any:
        return _flatten_markup_deep(value)


def card_description(card_cls: type) -> str:
    return card_cls.model_config.get("json_schema_extra", {}).get("description", "")
