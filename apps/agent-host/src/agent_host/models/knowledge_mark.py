"""A source's licence mark on its search-index points (office base knowledge).

The mark is the class, whether the office stated its licence covers AI
processing, the quote cap the licensed seam reads (ADR-0159), and the
knowledge edition.

Two carriers: ``PUT /v1/collections/{c}/knowledge-mark`` sets it on a file
already indexed, and an ingest job (``IngestRequest``, which takes
:class:`KnowledgeMarkFields`) carries it so a re-ingest writes it again
(``vector_store.writes.licence_mark``).
"""

from __future__ import annotations

from typing import Any
from typing import Literal

from pydantic import BaseModel
from pydantic import Field

#: The licence classes a point may carry; ``vector_store.schema.LICENCE_CLASSES``, which a test holds equal.
LicenceClass = Literal["public_open", "public_restricted", "licensed"]


class KnowledgeMarkFields(BaseModel):
    """The mark an ingest job carries for a base-knowledge copy; absent for every other document."""

    licence_class: LicenceClass | None = Field(None, description="How the source may be used (office base knowledge)")
    ai_processing_attested: bool | None = Field(
        None, description="Whether the office stated its licence covers processing by the hosted AI services"
    )
    quote_max_chars: int | None = Field(
        None, gt=0, description="The longest quote of the source's text a model may see"
    )
    knowledge_edition_id: str | None = Field(
        None, min_length=1, max_length=200, description="The knowledge edition the source belongs to"
    )

    def licence_mark(self) -> dict[str, Any]:
        """The fields stated, as the job config spells them (``writes.enrichment`` reads them there)."""
        return self.model_dump(include=_MARK_FIELDS, exclude_none=True)


_MARK_FIELDS = {"licence_class", "ai_processing_attested", "quote_max_chars", "knowledge_edition_id"}


class KnowledgeMarkUpdate(BaseModel):
    """Body of ``PUT /v1/collections/{c}/knowledge-mark``: the mark to set on every chunk of one file; None clears."""

    file_name: str = Field(..., min_length=1, max_length=1024, description="The file whose chunks are marked")
    licence_class: LicenceClass | None = Field(None, description="How the source may be used; None clears it")
    ai_processing_attested: bool | None = Field(
        None, description="Whether the office stated its licence covers AI processing; None clears it"
    )
    quote_max_chars: int | None = Field(None, gt=0, description="The longest quote a model may see; None clears it")
    edition_id: str | None = Field(
        None, min_length=1, max_length=200, description="The knowledge edition the source belongs to; None clears it"
    )
    country_id: str | None = Field(
        None,
        pattern=r"^[A-Z]{2}$",
        description="The country whose pack a base-corpus text belongs to (ADR-0173); ZZ for none; None clears it",
    )


class KnowledgeMarkResult(BaseModel):
    """What was marked: the file's chunks in the collection."""

    collection: str
    file_name: str
    licence_class: LicenceClass | None
    edition_id: str | None
    chunks: int


class OibCorpusMark(BaseModel):
    """The platform record a base-corpus file is the text of: its country's pack and its edition (ADR-0173)."""

    country_id: str | None = Field(None, pattern=r"^[A-Z]{2}$", description="ISO 3166-1 alpha-2 of the pack")
    edition_id: str | None = Field(None, min_length=1, max_length=200, description="The knowledge edition's record id")


class OibReingestRequest(BaseModel):
    """Which base-corpus documents to re-index, by basename, with the mark the platform recorded for each."""

    file_names: list[str] = Field(..., description="Base-corpus PDF basenames to re-ingest.", min_length=1)
    marks: dict[str, OibCorpusMark] = Field(
        default_factory=dict,
        description="Per basename, the country and edition it is the text of (ADR-0173): {country_id, edition_id}.",
    )

    def file_marks(self) -> dict[str, Any]:
        """The marks as the corpus stores them (``agent.corpus_store.FileMark``)."""
        from agent.corpus_store import FileMark

        return {name: FileMark(**mark.model_dump()) for name, mark in self.marks.items()}
