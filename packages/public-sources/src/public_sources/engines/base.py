from __future__ import annotations

from dataclasses import dataclass
from dataclasses import field
from typing import ClassVar

from pydantic import BaseModel
from pydantic import ConfigDict


class EngineError(ValueError): ...


class EngineConfig(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


@dataclass(frozen=True)
class Passage:
    anchor: str
    number: str
    heading: str
    text: str


@dataclass(frozen=True)
class ParsedDocument:
    title: str
    uri: str
    version: str = ""
    passages: tuple[Passage, ...] = field(default_factory=tuple)

    def passage(self, anchor: str) -> Passage | None:
        return next((p for p in self.passages if p.anchor == anchor), None)


class Engine:
    name: ClassVar[str]
    config_model: ClassVar[type[EngineConfig]]
    in_force_from: ClassVar[str] = ""
    in_force_until: ClassVar[str] = ""
    territory_field: ClassVar[str] = ""
    provision_field: ClassVar[str] = ""

    def __init__(self, config: EngineConfig | dict | None = None) -> None:
        if isinstance(config, EngineConfig):
            self.config = config
        else:
            self.config = self.config_model.model_validate(config or {})

    def document(self, body: bytes, *, url: str = "") -> ParsedDocument:
        raise NotImplementedError

    def public_host(self, url: str) -> str:
        return url

    def text(self, markup: str) -> tuple[str, str]:
        parsed = self.document(markup.encode("utf-8"))
        lines: list[str] = []
        for passage in parsed.passages:
            if passage.heading:
                lines.append(passage.heading)
            lines.append(f"{passage.number}. {passage.text}" if passage.number else passage.text)
        return parsed.title, "\n".join(lines)

    def recorded_document(self, text: str, *, url: str = "", content_type: str = "") -> ParsedDocument:
        raise EngineError(
            f"a {self.name} fixture cannot be read from a capture, which keeps the page's text and not its body; "
            "record the response inline"
        )


def collapse(text: str) -> str:
    import re

    lines = [re.sub(r"[ \t\xa0]+", " ", line).strip() for line in text.splitlines()]
    out: list[str] = []
    for line in lines:
        if line:
            out.append(line)
        elif out and out[-1] != "":
            out.append("")
    return "\n".join(out).strip()
