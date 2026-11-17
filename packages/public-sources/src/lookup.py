"""How a law lookup reads a source: the record's ``lookup`` block (ADR-0162, country as data).

A statute database answers a legal question in four steps: read the reference
out of the question, find the work, ask the source for its text, cut the
provision out. Every one of those steps needs words and tables that belong to
one publisher and one legal language, never to the code that runs them:

* **the locus grammar**: the signs a provision is cited by (``§``, ``Art``),
  the words for its parts (``Abs``, ``Z``, ``lit.``, ``Satz``) and for lists
  (``und``, ``bis``), as the source's own texts write them. The same
  vocabulary parses the caller's reference and cuts the source's text;
* **the collections** the source's search offers (statute law of the nation,
  of a subdivision, gazettes, drafts, case law), each with what it holds, so
  the search planner's choices are the record's and not a list in a prompt;
* **the territory parameter**: which argument and which of the access type's
  tables turn a territory (by id or by name) into the source's own filter;
* **the words the tool writes back**: the source's short name, the word for a
  subdivision, the note a consolidated text carries, and the examples a retry
  hint gives.

The lookup itself (``agent.knowledge.law_lookup``) reads these and names no
country. A second country's statute database on a known protocol and format
is a record with this block, never code. Formats and protocols stay code:
:mod:`public_sources.engines`, :mod:`public_sources.access`.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel
from pydantic import ConfigDict
from pydantic import Field
from pydantic import model_validator


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class LocusUnit(_Strict):
    """One kind of provision a text is divided into, as it is cited: ``§ 63``, ``Art. 5``.

    ``forms`` are the spellings a reference may use, longest first is not required: the
    grammar sorts them. ``repeatable`` lets the sign be doubled for a plural (``§§ 2 bis 4``).
    ``dot`` lets a form be followed by a full stop (``Art. 5``).
    """

    sign: str = Field(min_length=1, max_length=12)
    forms: tuple[str, ...] = Field(min_length=1)
    repeatable: bool = False
    dot: bool = False
    word: bool = True


class Locus(_Strict):
    """The citation grammar of the source's texts: what a reference to a provision looks like."""

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
    """One search scope the source offers: the argument value its search operation takes."""

    id: str = Field(min_length=1, max_length=40)
    kind: CollectionKind
    level: CollectionLevel = "national"
    consolidated: bool = False
    plannable: bool = True
    guide: str = Field(default="", max_length=400)


class Territory(_Strict):
    """How a territory becomes the source's filter: an argument of the search and its table."""

    argument: str
    table: str
    names: dict[str, str] = Field(default_factory=dict)
    choices: tuple[str, ...] = ()
    fact_keys: tuple[str, ...] = ()
    fact_values: dict[str, str] = Field(default_factory=dict)


class Wording(_Strict):
    """The words the lookup writes back to the model for this source, in the source's terms."""

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
    """How a document's reference (a document number) becomes the document operation's arguments, and back."""

    argument: str = "reference"
    prefix_table: str = ""
    prefix_argument: str = ""
    url_parameters: tuple[str, ...] = ()


class Lookup(_Strict):
    """A source's ``lookup`` block. See the module docstring."""

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
        """The statute collection for a question with (or without) a territory to filter by."""
        level = "subdivision" if subdivision else "national"
        exact = [c for c in self.collections if c.kind == "statute" and c.level == level]
        return (exact or [c for c in self.collections if c.kind == "statute"])[0]

    def consolidated(self) -> frozenset[str]:
        return frozenset(c.id for c in self.collections if c.consolidated)

    def case_law(self) -> tuple[str, ...]:
        return tuple(c.id for c in self.collections if c.kind == "case_law")
