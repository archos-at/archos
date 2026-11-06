"""A source's licence mark on its search-index points: the class and the knowledge edition (office base knowledge).

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
    knowledge_edition_id: str | None = Field(
        None, min_length=1, max_length=200, description="The knowledge edition the source belongs to"
    )

    def licence_mark(self) -> dict[str, Any]:
        """The fields stated, as the job config spells them (``writes.enrichment`` reads them there)."""
        return self.model_dump(include={"licence_class", "knowledge_edition_id"}, exclude_none=True)


class KnowledgeMarkUpdate(BaseModel):
    """Body of ``PUT /v1/collections/{c}/knowledge-mark``: the mark to set on every chunk of one file; None clears."""

    file_name: str = Field(..., min_length=1, max_length=1024, description="The file whose chunks are marked")
    licence_class: LicenceClass | None = Field(None, description="How the source may be used; None clears it")
    edition_id: str | None = Field(
        None, min_length=1, max_length=200, description="The knowledge edition the source belongs to; None clears it"
    )


class KnowledgeMarkResult(BaseModel):
    """What was marked: the file's chunks in the collection."""

    collection: str
    file_name: str
    licence_class: LicenceClass | None
    edition_id: str | None
    chunks: int
