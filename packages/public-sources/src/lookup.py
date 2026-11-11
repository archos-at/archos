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

    #: How the lookup labels a provision of this kind: ``§``, ``Art``.
    sign: str = Field(min_length=1, max_length=12)
    forms: tuple[str, ...] = Field(min_length=1)
    repeatable: bool = False
    dot: bool = False
    #: Whether a form is a word (bounded by ``\\b``) rather than a symbol like ``§``.
    word: bool = True


class Locus(_Strict):
    """The citation grammar of the source's texts: what a reference to a provision looks like."""

    #: The provision kinds, the first one preferred when a reference names more than one.
    units: tuple[LocusUnit, ...] = Field(min_length=1)
    #: The words for a numbered part of a provision (``Abs``, ``Absatz``); the first is its label.
    subsection: tuple[str, ...] = Field(min_length=1)
    #: The words for a numbered item inside a part (``Z``, ``Ziffer``).
    item: tuple[str, ...] = ()
    #: The words for a lettered item (``lit``).
    letter: tuple[str, ...] = ()
    #: The word an ordinal sentence reference ends in (``2. Satz``); empty when the language has none.
    sentence: str = ""
    #: The words joining two items of one list (``und``, ``sowie``, ``u.``).
    conjunctions: tuple[str, ...] = ()
    #: The words making a range of two items (``bis``); a dash is always a range.
    range_words: tuple[str, ...] = ()
    #: The words that introduce a further reference (``siehe``, ``vgl.``), dropped when left dangling.
    see_also: tuple[str, ...] = ()


CollectionKind = Literal["statute", "gazette", "draft", "case_law", "decree"]
CollectionLevel = Literal["national", "subdivision"]


class Collection(_Strict):
    """One search scope the source offers: the argument value its search operation takes."""

    id: str = Field(min_length=1, max_length=40)
    kind: CollectionKind
    #: Whose law it holds; ``subdivision`` takes the territory filter.
    level: CollectionLevel = "national"
    #: A consolidated (informational) text rather than the authentic promulgation.
    consolidated: bool = False
    #: Offered to the search planner, which chooses among these alone.
    plannable: bool = True
    #: One line for the search planner: what this collection holds and when to choose it.
    guide: str = Field(default="", max_length=400)


class Territory(_Strict):
    """How a territory becomes the source's filter: an argument of the search and its table."""

    #: The search operation's argument the territory's name goes into.
    argument: str
    #: The access type's table that knows the names (its keys, folded, are the names it accepts).
    table: str
    #: Territory ids (``AT-9``) to the name the table knows; the turn's site is given by id.
    names: dict[str, str] = Field(default_factory=dict)
    #: The territories a reference or a question may name, as the planner may choose them.
    choices: tuple[str, ...] = ()


class Wording(_Strict):
    """The words the lookup writes back to the model for this source, in the source's terms."""

    #: The source's short name (``RIS``), in "No RIS passage answered …".
    source: str
    #: The word for the subdivision the territory filter selects (``Bundesland``).
    subdivision: str
    #: Its short form, where a sentence uses one ("not narrowed to one Land"); empty means ``subdivision``.
    subdivision_short: str = ""
    #: The note a passage from a consolidated collection carries.
    consolidated_note: str = ""
    #: A territory and a work named in a retry hint.
    example_territory: str = ""
    example_work: str = ""
    #: The fallback title of a text the source names no title for.
    untitled: str = "Document"
    #: Title noise the source adds (its name as a prefix, a retrieval-date stamp), dropped from a file name.
    title_prefix: str = ""
    title_suffix: str = ""
    #: The question language the tool asks for (``German``).
    language: str = ""


class Reference(_Strict):
    """How a document's reference (a document number) becomes the document operation's arguments, and back."""

    #: The document operation's argument the reference goes into.
    argument: str = "reference"
    #: The access table whose keys are reference prefixes, checked in order, and whose values fill
    #: ``prefix_argument``: a bare number names the part of the source it lives in by its prefix.
    prefix_table: str = ""
    prefix_argument: str = ""
    #: Query parameters of a source URL that carry a document's reference, read back for a stable name.
    url_parameters: tuple[str, ...] = ()


class Lookup(_Strict):
    """A source's ``lookup`` block. See the module docstring."""

    #: BCP 47 language of the source's texts (``de``).
    language: str = Field(min_length=2, max_length=12)
    #: The access type's operations the lookup uses: a search (empty for a source that offers none, whose
    #: documents the record lists) and a document by its reference.
    search: str = ""
    document: str = "document"
    locus: Locus
    collections: tuple[Collection, ...] = Field(min_length=1)
    territory: Territory | None = None
    #: Words in a question that mean case law, not statute; such a question is searched, not looked up.
    case_law_signals: tuple[str, ...] = ()
    #: The search planner's guidance on terms, after the collections (``Prefer the statutory term …``).
    search_guidance: str = Field(default="", max_length=2000)
    wording: Wording
    #: The first segment of the collection id a passage states (``ris`` in ``ris/LrKons/Wien``), which the
    #: lanes and the citation reader know the source by; also the namespace of its cache keys. Empty: the source id.
    namespace: str = ""
    #: Fragments of a document URL that mark a consolidated (informational) text; such a passage carries
    #: ``wording.consolidated_note``.
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
