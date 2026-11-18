import uuid
from datetime import datetime
from enum import StrEnum
from typing import Any
from typing import Literal

from pydantic import BaseModel
from pydantic import Field
from pydantic import SerializerFunctionWrapHandler
from pydantic import model_serializer
from pydantic import model_validator


class ContentType(StrEnum):
    TEXT = "text"
    TABLE = "table"
    CHART = "chart"
    IMAGE = "image"
    DRAWING = "drawing"


class Chunk(BaseModel):
    chunk_id: str = Field(..., description="Unique ID for citation tracking.")
    content: str = Field(
        ...,
        description="The main text. If this is a visual/table, this MUST be the summary or caption.",
    )
    score: float = Field(0.0, ge=0.0, le=1.0, description="Similarity score (0.0 to 1.0).")

    file_name: str = Field(..., description="Original filename (for example, 'Q3_Report.pdf').")
    page_number: int | None = Field(
        None,
        ge=1,
        description="The page number (1-based). None if not applicable (for example, JSON/TXT).",
    )
    display_citation: str = Field(
        ...,
        description="User-facing citation label. Adapters MUST populate this.",
    )

    content_type: ContentType = Field(
        ...,
        description="The semantic category of this chunk.",
    )
    content_subtype: str | None = Field(
        None,
        description="Granular subtype (for example, 'bar_chart', 'pie_chart').",
    )

    structured_data: str | None = Field(
        None,
        description="Raw code/data representation for Code Interpreter analysis.",
    )

    image_storage_uri: str | None = Field(
        None,
        description="Internal S3/SeaweedFS URI for system access.",
    )
    image_url: str | None = Field(
        None,
        description="Presigned HTTP URL for frontend display.",
    )

    retrieval_rank: int | None = Field(
        None,
        ge=0,
        description=(
            "0-based rank of this chunk within the collection that produced it, after "
            "intra-collection fusion. None when the producing backend did not stamp one."
        ),
    )
    fusion_score: float | None = Field(
        None,
        description=(
            "Diagnostic reciprocal-rank-fusion score from the cross-collection merge. "
            "Never displayed to the user or the LLM; `score` remains the true similarity."
        ),
    )

    metadata: dict[str, Any] = Field(
        default_factory=dict,
        description="Passthrough for extra backend-specific metadata.",
    )

    @model_validator(mode="before")
    @classmethod
    def ensure_content_string(cls, data: Any) -> Any:
        if isinstance(data, dict):
            if data.get("content") is None:
                data["content"] = ""
        return data


class RetrievalResult(BaseModel):
    chunks: list[Chunk] = Field(default_factory=list)
    total_tokens: int = Field(0, ge=0, description="Estimated token count for context management.")
    query: str = Field(..., description="The original query that produced these results.")
    backend: str = Field(..., description="The backend that produced these results.")
    success: bool = Field(default=True, description="Whether retrieval succeeded.")
    error_message: str | None = Field(default=None, description="Error details if retrieval failed.")


class JobState(StrEnum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class FileStatus(StrEnum):
    UPLOADING = "uploading"
    INGESTING = "ingesting"
    SUCCESS = "success"
    FAILED = "failed"


_FILE_ID_NAMESPACE = uuid.UUID("6f1c0a52-3b7e-4d8a-9c41-5e2d7a90b3f6")


def stable_file_id(collection_name: str, file_name: str) -> str:
    return str(uuid.uuid5(_FILE_ID_NAMESPACE, f"{collection_name}\x00{file_name}"))


class CollectionInfo(BaseModel):
    name: str = Field(..., description="Unique collection name.")
    description: str | None = Field(None, description="Human-readable description.")
    file_count: int = Field(0, ge=0, description="Number of files in this collection.")
    chunk_count: int = Field(0, ge=0, description="Total number of chunks/vectors.")
    created_at: datetime | None = Field(None, description="When the collection was created.")
    updated_at: datetime | None = Field(None, description="Last modification time.")
    backend: str = Field(..., description="Backend that manages this collection.")
    metadata: dict[str, Any] = Field(
        default_factory=dict,
        description="Backend-specific metadata (e.g., embedding model, vector dimensions).",
    )


class QuarantineReason(BaseModel):
    kind: str = Field(..., min_length=1, description="`term`, or the detector that matched.")
    term: str | None = Field(None, description="The office's term, as it wrote it; only for `kind == 'term'`.")
    count: int = Field(..., ge=0, description="How often it was found.")
    pages: list[int] = Field(default_factory=list, description="The pages it was found on, ascending, capped.")
    pages_truncated: bool = Field(False, description="`pages` is not every page it was found on.")
    sample: str | None = Field(None, description="A detector's MASKED sample; never the value.")

    @model_serializer(mode="wrap")
    def _compact(self, handler: SerializerFunctionWrapHandler) -> dict[str, Any]:
        data = handler(self)
        for key in ("term", "sample"):
            if data.get(key) is None:
                data.pop(key, None)
        if not data.get("pages_truncated"):
            data.pop("pages_truncated", None)
        return data


class QuarantineVerdict(BaseModel):
    reasons: list[QuarantineReason] = Field(default_factory=list)
    checked: Literal["full", "partial"] = Field(
        ..., description="`partial` when some of the file's content went unscreened (pages without a text layer)."
    )
    omitted: int = Field(0, ge=0, description="Reasons found and not listed.")
    after_transcription: bool = Field(
        False,
        description=(
            "The match was in the vision model's transcript of the file's scanned pages: the vision model saw "
            "those pages, and no later model call (summary, tags, embeddings) saw anything of the file."
        ),
    )

    @model_serializer(mode="wrap")
    def _compact(self, handler: SerializerFunctionWrapHandler) -> dict[str, Any]:
        data = handler(self)
        if not data.get("omitted"):
            data.pop("omitted", None)
        if not data.get("after_transcription"):
            data.pop("after_transcription", None)
        return data


class FileInfo(BaseModel):
    file_id: str = Field(..., description="Unique file identifier.")
    file_name: str = Field(..., description="Original filename.")
    collection_name: str = Field(..., description="Collection this file belongs to.")
    status: FileStatus = Field(default=FileStatus.UPLOADING, description="Current processing status.")
    file_size: int | None = Field(None, ge=0, description="File size in bytes.")
    chunk_count: int = Field(0, ge=0, description="Number of chunks created from this file.")
    uploaded_at: datetime | None = Field(None, description="When the file was uploaded.")
    ingested_at: datetime | None = Field(None, description="When ingestion completed.")
    expiration_date: datetime | None = Field(None, description="When the file will be auto-deleted.")
    error_message: str | None = Field(None, description="Error message if processing failed.")
    quarantine: QuarantineVerdict | None = Field(
        None,
        description=(
            "Why the upload screen held the file back (ADR-0086), when it did: the job's typed verdict "
            "(ADR-0113). Read this, never the `quarantined:` text `error_message` still carries for older readers."
        ),
    )
    summary: str | None = Field(None, description="One-sentence summary of the document content, if generated.")
    tags: list[str] | None = Field(
        None,
        description="Controlled ingestion-generated tags (document type + OIB discipline), if classified.",
    )
    folder_path: str | None = Field(
        None,
        description=(
            "Materialised folder path the document is filed under "
            "(e.g. 'Brandschutz/Fluchtwege'). None means the project root."
        ),
    )
    topics: list[str] | None = Field(
        None,
        description=(
            "Open topics (Themen) the agent recognised in the document, or set by a person; "
            "free terms such as 'Attika', beside the controlled tags."
        ),
    )
    capture: dict[str, Any] | None = Field(
        None,
        description=(
            "What the camera wrote into a photo: captured_at (ISO 8601), latitude, longitude, camera; "
            "present keys only. Coordinates are for the BFF and the people who may open the file, "
            "never for a model."
        ),
    )
    dossier: dict[str, Any] | None = Field(
        None,
        description=(
            "What the ingest read the document to be: document_type, title, summary, parties, dates, place and "
            "facts with page and quote (docs/architecture/document-dossier.md)."
        ),
    )
    doc_references: list[dict[str, Any]] | None = Field(
        None,
        description="What the document points at: norms, laws, plans, named documents, each with its pages.",
    )
    coverage: dict[str, Any] | None = Field(
        None,
        description="How much of the document was read: pages, read as text, transcribed, drawings read, not read.",
    )
    superseded_by: str | None = Field(
        None,
        description=(
            "File name of the newer Fassung in this collection that a PERSON confirmed replaces this one. "
            "The agent never sets it on its own."
        ),
    )
    supersedes: list[str] | None = Field(
        None,
        description="File names this document replaces by a person's confirmation (the reverse of superseded_by).",
    )
    revision_suggestion: dict[str, Any] | None = Field(
        None,
        description=(
            "The agent's open suggestion that this document is a newer Fassung of another: of (the older file name), "
            "confidence (0..1), reason (German, short), basis ('title_block', 'name' or 'content'). "
            "Absent once dismissed."
        ),
    )
    revision_facts: dict[str, Any] | None = Field(
        None,
        description=(
            "What the title block (Plankopf) of the first drawing page that has one says, read during ingestion: "
            "document_number, revision (the Index as printed), revision_date (ISO), scale, title and the page "
            "they were read on; present keys only. Absent when no page has a legible title block."
        ),
    )
    change_summary: str | None = Field(
        None,
        description="German bullet lines on what changed against the Fassung it replaces (change_basis).",
    )
    change_basis: str | None = Field(
        None,
        description="File name the change_summary compared against (this file's own name: its previous upload).",
    )
    metadata: dict[str, Any] = Field(
        default_factory=dict,
        description="File-specific metadata (e.g., page count, content types).",
    )


class FileProgress(BaseModel):
    file_id: str = Field(default="", description="Unique identifier for the file.")
    file_name: str = Field(..., description="Name of the file being processed.")
    status: FileStatus = Field(default=FileStatus.UPLOADING, description="Current processing status.")
    progress_percent: float = Field(0.0, ge=0.0, le=100.0, description="Processing progress (0-100).")
    error_message: str | None = Field(default=None, description="Error message if processing failed.")
    chunks_created: int = Field(0, ge=0, description="Number of chunks created from this file.")
    pages_failed: int = Field(
        0,
        ge=0,
        description="PDF pages that could not be read and are missing from the index (below the failure threshold).",
    )
    metadata: dict[str, Any] = Field(
        default_factory=dict,
        description=(
            "Extraction counts for this file that the chunk count does not show, e.g. "
            "`images_over_cap`: embedded images left unanalysed by MAX_IMAGES_PER_DOCUMENT; "
            "`images_over_pixel_budget`: embedded images refused before decoding by "
            "MAX_IMAGE_PIXELS; "
            "`pages_transcribed`, `pages_transcription_failed`, `pages_over_ocr_cap`, "
            "`pages_not_transcribed_no_vlm`: scanned or garbled PDF pages and what became of them; "
            "`drawing_pages_over_cap`: drawing pages past MAX_RENDERED_PAGES; "
            "`pages_read_without_layout`: PDF pages over PDF_PAGE_MAX_OBJECTS, whose text was "
            "read without tables or line styles."
        ),
    )
    screening: Literal["clean", "partial", "unchecked", "quarantined"] | None = Field(
        default=None,
        description=(
            "What the upload screen made of this file, when the job carried screening rules "
            "(null otherwise): `clean` (all its content was screened, nothing matched), "
            "`partial` (its text layer was clean, but some pages go to OCR or drawing analysis "
            "unscreened), `unchecked` (an image, or no local text at all), `quarantined` "
            "(a match; the file FAILED and `quarantine` says why)."
        ),
    )
    quarantine: QuarantineVerdict | None = Field(
        default=None,
        description=(
            "Why the upload screen held the file back, set with `screening == 'quarantined'` and null otherwise "
            "(ADR-0113). The typed verdict: reasons (kind, term, count, pages, pages_truncated, masked sample), "
            "`checked`, and `omitted`. `error_message` still carries the same verdict as `quarantined:{json}` "
            "for one release, for a BFF that predates this field; nothing new reads that string."
        ),
    )
    failure_category: str | None = Field(
        default=None,
        description=(
            "Why a FAILED file failed, as a machine category (`agent.knowledge.ingest_failures`): "
            "`transient` (interrupted, timed out, a download or upstream call failed: reading it again "
            "may work), `configuration` (the deployment lacks something, e.g. a vision model: reading it "
            "again works once that is configured), `deterministic` (the bytes themselves: empty, "
            "encrypted, unparseable, unreadable pages; the same reader fails the same way), "
            "`quarantined` (not a failure: the content check held the file), or `unknown`. "
            "Null while the file has not failed."
        ),
    )
    retryable: bool | None = Field(
        default=None,
        description=(
            "Whether reading the same bytes again with the same reader can succeed; follows "
            "`failure_category` (false for `deterministic` and `quarantined`). Null while the file "
            "has not failed."
        ),
    )


class IngestionJobStatus(BaseModel):
    job_id: str = Field(..., description="Unique identifier for this ingestion job.")
    status: JobState = Field(default=JobState.PENDING, description="Overall job status.")
    submitted_at: datetime = Field(..., description="When the job was submitted.")
    started_at: datetime | None = Field(None, description="When processing started.")
    completed_at: datetime | None = Field(None, description="When processing completed.")
    total_files: int = Field(0, ge=0, description="Total number of files to process.")
    processed_files: int = Field(0, ge=0, description="Number of files processed so far.")
    file_details: list[FileProgress] = Field(
        default_factory=list,
        description="Detailed progress for each file.",
    )
    collection_name: str = Field(..., description="Target collection/index name.")
    backend: str = Field(..., description="Ingestion backend used.")
    error_message: str | None = Field(None, description="Error message if job failed.")
    reader_version: str | None = Field(
        None,
        description=(
            "The extraction logic that read the files (`knowledge_layer.ingest.INGEST_READER_VERSION`), "
            "stamped when a worker starts the job. A file that failed "
            "`deterministic` under one reader may read under a newer one. Null until the job runs."
        ),
    )

    metadata: dict[str, Any] = Field(
        default_factory=dict,
        description="Backend-specific metadata. Contains db info for retrieval.",
    )

    @property
    def progress_percent(self) -> float:
        if self.total_files == 0:
            return 0.0
        return (self.processed_files / self.total_files) * 100.0

    @property
    def is_terminal(self) -> bool:
        return self.status in (JobState.COMPLETED, JobState.FAILED, JobState.CANCELLED)

    @property
    def is_success(self) -> bool:
        return self.status == JobState.COMPLETED and self.processed_files > 0


class AvailableDocument(BaseModel):
    file_name: str
    summary: str | None = None
    tags: list[str] | None = None
    doc_class: str | None = None
    display_title: str | None = None
    folder_path: str | None = None
    topics: list[str] | None = None
    capture: dict[str, Any] | None = None
    superseded_by: str | None = None
    supersedes: list[str] | None = None
    revision_suggestion: dict[str, Any] | None = None
    revision_facts: dict[str, Any] | None = None
    change_summary: str | None = None
    change_basis: str | None = None
    page_count: int | None = None
    dossier: dict[str, Any] | None = None
    doc_references: list[dict[str, Any]] | None = None
    coverage: dict[str, Any] | None = None
    mail_thread: dict[str, Any] | None = None
    mail_origin: dict[str, Any] | None = None
    added_at: str | None = None
    collection: str | None = None
    shelf: str | None = None
