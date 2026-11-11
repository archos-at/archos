"""What every format engine returns: a document of anchored passages.

An engine reads one FORMAT (Akoma Ntoso, an HTML statute page, the RIS search
payload) and never a country: what differs between two publishers of the same
format (which element is a provision, which notes to drop, which language to
title it in) is the source's ``engine`` configuration.

A passage carries an ``anchor``: the provision's stable id inside the
document, an Akoma Ntoso eId where the format has one (``art_16_b/para_1``)
and one built the same way where it has not. A citation resolves to
``document URI + anchor``, and a change monitor compares passages by it.
"""

from __future__ import annotations

from dataclasses import dataclass
from dataclasses import field
from typing import ClassVar

from pydantic import BaseModel
from pydantic import ConfigDict


class EngineError(ValueError):
    """Bytes the engine cannot read as its format."""


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
    #: The version the document states about itself (an expression date), or empty.
    version: str = ""
    passages: tuple[Passage, ...] = field(default_factory=tuple)

    def passage(self, anchor: str) -> Passage | None:
        return next((p for p in self.passages if p.anchor == anchor), None)


class Engine:
    """Base of the format engines. Subclasses set ``name`` and ``config_model``."""

    name: ClassVar[str]
    config_model: ClassVar[type[EngineConfig]]
    #: The labels a search hit's metadata states a version's in-force window and its territory under,
    #: empty for a format whose hits state none.
    in_force_from: ClassVar[str] = ""
    in_force_until: ClassVar[str] = ""
    territory_field: ClassVar[str] = ""

    def __init__(self, config: EngineConfig | dict | None = None) -> None:
        if isinstance(config, EngineConfig):
            self.config = config
        else:
            self.config = self.config_model.model_validate(config or {})

    def document(self, body: bytes, *, url: str = "") -> ParsedDocument:
        raise NotImplementedError

    def public_host(self, url: str) -> str:
        """``url`` on the host the source's citations use; the same URL for a format with one host."""
        return url

    def recorded_document(self, text: str, *, url: str = "", content_type: str = "") -> ParsedDocument:
        """The document read from a citation capture's text instead of the body (a fixture's recording).

        Only a format whose capture text is what the engine itself reads offers
        it (``pdf_document``: one PDF pipeline). Any other format's fixture
        carries its response inline, since a capture keeps a page's text and
        not its markup.
        """
        raise EngineError(
            f"a {self.name} fixture cannot be read from a capture, which keeps the page's text and not its body; "
            "record the response inline"
        )


def collapse(text: str) -> str:
    """Whitespace runs to one space, per line; blank-line runs to one blank line."""
    import re

    lines = [re.sub(r"[ \t\xa0]+", " ", line).strip() for line in text.splitlines()]
    out: list[str] = []
    for line in lines:
        if line:
            out.append(line)
        elif out and out[-1] != "":
            out.append("")
    return "\n".join(out).strip()
