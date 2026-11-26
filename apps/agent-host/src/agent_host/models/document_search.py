from typing import Annotated
from typing import Literal

from pydantic import AliasChoices
from pydantic import BaseModel
from pydantic import ConfigDict
from pydantic import Field
from pydantic import StringConstraints

from agent.knowledge.dossier import DocumentType

from .requests import ProjectFacts
from .requests import ProjectStatus
from .requests import _FactToken


class DocumentSearchRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=1000, description="Natural-language search query")
    top_k: int = Field(40, ge=1, le=100, description="Max chunks to retrieve before document-centric aggregation")
    top_k_files: int = Field(20, ge=1, le=100, description="Max documents to return after aggregation")
    snippet_max_chars: int = Field(
        300,
        ge=100,
        le=1500,
        description=(
            "Max characters kept from each document's best-matching chunk. 300 for a hit list a person scans; "
            "the cross-project lookups (ADR-0094) ask for more, because their snippet is the evidence the agent "
            "answers from and cites: it cannot open another project's document further."
        ),
    )


class DocumentSearchHit(BaseModel):
    file_name: str = Field(..., description="Original filename of the matched document")
    score: float = Field(..., description="Similarity score (0.0 to 1.0) of the file's best-matching chunk")
    snippet: str = Field(..., description="Snippet (300 chars unless asked for more) of the best-matching chunk")
    page_number: int | None = Field(None, description="Page number of the best-matching chunk (None if N/A)")
    collection: str = Field(..., description="Collection the document belongs to")
    document_id: str | None = Field(
        None, description="The BFF's id of the document, when its chunks carry it (the search joins hits by it)"
    )
    grid_document_id: str | None = Field(
        None, description="Deprecated: `document_id` under its old name, for a BFF one release old"
    )
    lexical: bool | None = Field(
        None,
        description=(
            "The grouped search only: whether one of the document's ranked passages holds a word of the query "
            "(the BM25 or an exact-term channel ranked it), rather than matching by meaning alone"
        ),
    )


class DocumentSearchResponse(BaseModel):
    hits: list[DocumentSearchHit] = Field(
        default_factory=list, description="Matched documents (one per file), sorted by score descending"
    )


_DocumentId = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        to_lower=True,
        pattern=r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$",
    ),
]

_FileName = Annotated[str, StringConstraints(min_length=1, max_length=500)]

_ReferenceText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]


class SimilarityWeights(BaseModel):
    model_config = ConfigDict(extra="forbid")

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    federal_state: float = Field(0, ge=0, le=100, validation_alias=AliasChoices("federal_state", "bundesland"))
    building_class: float = Field(0, ge=0, le=100, validation_alias=AliasChoices("building_class", "gebaeudeklasse"))
    building_class_adjacent: float = Field(
        0, ge=0, le=100, validation_alias=AliasChoices("building_class_adjacent", "gebaeudeklasse_adjacent")
    )
    construction_method: float = Field(
        0, ge=0, le=100, validation_alias=AliasChoices("construction_method", "bauweise")
    )
    use: float = Field(0, ge=0, le=100, validation_alias=AliasChoices("use", "nutzung"))
    use_max: float = Field(0, ge=0, le=100, validation_alias=AliasChoices("use_max", "nutzung_max"))
    work_type: float = Field(0, ge=0, le=100, validation_alias=AliasChoices("work_type", "vorhabensart"))

    def to_store(self) -> dict[str, float]:
        return self.model_dump()


class SearchBoost(BaseModel):
    model_config = ConfigDict(extra="forbid")

    facts: ProjectFacts
    weights: SimilarityWeights


class GroupedSearchFilters(BaseModel):
    model_config = ConfigDict(extra="forbid")

    document_types: list[_FactToken] = Field(
        default_factory=list,
        max_length=40,
        description="The document's tags of the document-type group (Plan, Detail, ...). Not `reading_types`.",
    )
    disciplines: list[_FactToken] = Field(default_factory=list, max_length=40)
    document_ids: list[_DocumentId] = Field(
        default_factory=list,
        max_length=1000,
        description="Only passages of these documents (the BFF's document ids, `document_id` on the chunks).",
    )
    file_names: list[_FileName] = Field(
        default_factory=list,
        max_length=1000,
        description=(
            "The same documents' file names, for the passages that carry no `document_id` (written before "
            "the field existed, or copied from Chroma): any of `document_ids` or of these. Only with `document_ids`."
        ),
    )
    reading_types: list[DocumentType] = Field(
        default_factory=list,
        max_length=24,
        description=(
            "The dossier's document type, as ingestion read it (`fire_safety_concept`, `site_plan`, ...). "
            "Not `document_types`, which reads the tags a person or the tagger set."
        ),
    )
    refers_to: list[_ReferenceText] = Field(
        default_factory=list,
        max_length=8,
        description=(
            "Documents that refer to any of these: what a person types (`ÖNORM B 1600`, `EP-05`, "
            "`Brandschutzkonzept`) or a `kind:key` token as the projection holds it (`norm:önorm b 1600`). "
            "A text no reference is read from matches nothing."
        ),
    )
    project_facts: ProjectFacts | None = Field(
        None,
        description=(
            "Only projects holding any of each listed fact's values (a fact left empty does not filter). "
            "Read from the facts mirrored onto the points, so a project whose facts were never mirrored "
            "does not match."
        ),
    )
    project_status: list[ProjectStatus] = Field(default_factory=list, max_length=3)


class GroupedDocumentSearchRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=1000, description="Natural-language search query")
    collections: list[str] = Field(..., min_length=1, max_length=500, description="Collections to rank together")
    groups: int = Field(20, ge=1, le=200, description="Max collections in the answer, best first")
    files_per_group: int = Field(3, ge=1, le=20, description="Max documents per collection")
    snippet_max_chars: int = Field(300, ge=100, le=1500, description="Max characters of each document's snippet")
    filters: GroupedSearchFilters | None = Field(None, description="Narrow the search before ranking")
    boost: SearchBoost | None = Field(None, description="The current project's facts, to lift similar projects")
    purpose: Literal["workspace_search"] | None = Field(
        None,
        description=(
            "Who asks, when this route should trace the search itself: `workspace_search` (the BFF's search, "
            "ADR-0136) is a `retrieve.workspace_search` observation. Absent for the cross-project lookup, which "
            "Piloti's `project_lookup` tool already traces."
        ),
    )
