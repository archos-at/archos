from __future__ import annotations

from typing import Literal

from pydantic import BaseModel
from pydantic import ConfigDict
from pydantic import Field
from pydantic import model_validator


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class LocusUnit(_Strict):
    sign: str = Field(min_length=1, max_length=12)
    forms: tuple[str, ...] = Field(min_length=1)
    repeatable: bool = False
    dot: bool = False
    word: bool = True


class Locus(_Strict):
    units: tuple[LocusUnit, ...] = Field(min_length=1)
    subsection: tuple[str, ...] = Field(min_length=1)
    item: tuple[str, ...] = ()
    letter: tuple[str, ...] = ()
    sentence: str = ""
    conjunctions: tuple[str, ...] = ()
    range_words: tuple[str, ...] = ()
    see_also: tuple[str, ...] = ()


CollectionKind = Literal["statute", "gazette", "draft", "case_law", "decree"]
CollectionLevel = Literal["national", "subdivision"]


class Collection(_Strict):
    id: str = Field(min_length=1, max_length=40)
    kind: CollectionKind
    level: CollectionLevel = "national"
    consolidated: bool = False
    plannable: bool = True
    guide: str = Field(default="", max_length=400)


class Territory(_Strict):
    argument: str
    table: str
    names: dict[str, str] = Field(default_factory=dict)
    choices: tuple[str, ...] = ()
    fact_keys: tuple[str, ...] = ()
    fact_values: dict[str, str] = Field(default_factory=dict)


class Wording(_Strict):
    source: str
    subdivision: str
    subdivision_short: str = ""
    consolidated_note: str = ""
    example_territory: str = ""
    example_work: str = ""
    untitled: str = "Document"
    title_prefix: str = ""
    title_suffix: str = ""
    language: str = ""


class Reference(_Strict):
    argument: str = "reference"
    prefix_table: str = ""
    prefix_argument: str = ""
    url_parameters: tuple[str, ...] = ()


class Lookup(_Strict):
    language: str = Field(min_length=2, max_length=12)
    search: str = ""
    document: str = Field(default="document", min_length=1)
    locus: Locus
    collections: tuple[Collection, ...] = Field(min_length=1)
    territory: Territory | None = None
    case_law_signals: tuple[str, ...] = ()
    search_guidance: str = Field(default="", max_length=2000)
    unplaced_collection: str = ""
    wording: Wording
    namespace: str = ""
    consolidated_urls: tuple[str, ...] = ()
    reference: Reference = Reference()

    @model_validator(mode="after")
    def _collections_unique(self) -> Lookup:
        ids = [collection.id for collection in self.collections]
        if len(ids) != len(set(ids)):
            raise ValueError(f"lookup.collections ids repeat: {sorted({i for i in ids if ids.count(i) > 1})}")
        kinds = {(c.kind, c.level) for c in self.collections}
        if ("statute", "national") not in kinds and ("statute", "subdivision") not in kinds:
            raise ValueError("lookup.collections names no statute collection: a law lookup has nothing to read")
        return self

    def collection(self, collection_id: str) -> Collection | None:
        return next((c for c in self.collections if c.id == collection_id), None)

    def statute(self, *, subdivision: bool) -> Collection:
        level = "subdivision" if subdivision else "national"
        exact = [c for c in self.collections if c.kind == "statute" and c.level == level]
        return (exact or [c for c in self.collections if c.kind == "statute"])[0]

    def consolidated(self) -> frozenset[str]:
        return frozenset(c.id for c in self.collections if c.consolidated)

    def case_law(self) -> tuple[str, ...]:
        return tuple(c.id for c in self.collections if c.kind == "case_law")
