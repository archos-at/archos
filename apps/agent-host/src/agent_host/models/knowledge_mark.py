from __future__ import annotations

from typing import Any
from typing import Literal

from pydantic import BaseModel
from pydantic import Field

LicenceClass = Literal["public_open", "public_restricted", "licensed"]


class KnowledgeMarkFields(BaseModel):
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
        return self.model_dump(include=_MARK_FIELDS, exclude_none=True)


_MARK_FIELDS = {"licence_class", "ai_processing_attested", "quote_max_chars", "knowledge_edition_id"}


class KnowledgeMarkUpdate(BaseModel):
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
        description="The country whose pack a base-corpus text belongs to (ADR-0173); None clears it",
    )
    released: bool | None = Field(
        None,
        description=(
            "Whether a base-corpus text is released (ADR-0173): false withdraws it from every office and keeps its "
            "country; None clears it"
        ),
    )


class KnowledgeMarkResult(BaseModel):
    collection: str
    file_name: str
    licence_class: LicenceClass | None
    edition_id: str | None
    released: bool | None = None
    chunks: int


class OibCorpusMark(BaseModel):
    country_id: str | None = Field(None, pattern=r"^[A-Z]{2}$", description="ISO 3166-1 alpha-2 of the pack")
    edition_id: str | None = Field(None, min_length=1, max_length=200, description="The knowledge edition's record id")


class OibReingestRequest(BaseModel):
    file_names: list[str] = Field(..., description="Base-corpus PDF basenames to re-ingest.", min_length=1)
    marks: dict[str, OibCorpusMark] = Field(
        default_factory=dict,
        description="Per basename, the country and edition it is the text of (ADR-0173): {country_id, edition_id}.",
    )

    def file_marks(self) -> dict[str, Any]:
        from agent.corpus_store import FileMark

        return {name: FileMark(**mark.model_dump(), released=True) for name, mark in self.marks.items()}


class CorpusReingestResponse(BaseModel):
    status: str = Field(..., description="'pending' when at least one document was queued, else 'noop'.")
    queued: list[str] = Field(default_factory=list, description="Basenames now re-ingesting.")
    unknown: list[str] = Field(default_factory=list, description="Basenames that match no corpus document.")
    released: list[str] = Field(
        default_factory=list,
        description=(
            "Queued basenames whose release mark was recorded as released (ADR-0173). The BFF checks every marked "
            "name is here: a backend from before the flag leaves a withdrawn row withdrawn, so its answer is retried."
        ),
    )
    message: str
