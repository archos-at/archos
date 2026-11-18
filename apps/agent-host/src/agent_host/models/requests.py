import logging
from typing import Annotated
from typing import Any
from typing import Literal

from pydantic import AliasChoices
from pydantic import BaseModel
from pydantic import ConfigDict
from pydantic import Field
from pydantic import StringConstraints
from pydantic import ValidationError
from pydantic import ValidationInfo
from pydantic import ValidatorFunctionWrapHandler
from pydantic import field_validator
from pydantic import model_validator

from agent.profile_names import normalize_profile_token

from ..object_store_url import ObjectStoreUrl
from .document_type_tag import DocumentTypeField
from .knowledge_mark import KnowledgeMarkFields
from .mail_facts import MailOrigin
from .mail_facts import MailThreadFacts

logger = logging.getLogger(__name__)

SCREENING_MAX_TERMS = 200
SCREENING_MIN_TERM_CHARS = 2
SCREENING_MAX_TERM_CHARS = 80


class CreateCollectionRequest(BaseModel):
    name: str = Field(..., description="Unique collection name")
    description: str | None = Field(None, description="Human-readable description")
    metadata: dict[str, Any] = Field(default_factory=dict, description="Backend-specific metadata")


class ScreeningPolicy(BaseModel):
    model_config = ConfigDict(extra="forbid")

    content_terms: list[str] = Field(
        default_factory=list,
        max_length=SCREENING_MAX_TERMS,
        description=(
            f"Terms that quarantine a document, each {SCREENING_MIN_TERM_CHARS}..{SCREENING_MAX_TERM_CHARS} "
            "characters after stripping; empty entries are dropped."
        ),
    )
    detectors: list[Literal["iban", "at_svnr", "credit_card", "de_svnr", "de_tax_id"]] = Field(
        default_factory=list,
        description="Identifiers that quarantine a document: IBAN, AT and DE social-insurance number, card, DE tax ID.",
    )

    @field_validator("content_terms")
    @classmethod
    def _strip_terms(cls, terms: list[str]) -> list[str]:
        stripped = [term.strip() for term in terms]
        kept = [term for term in stripped if term]
        for term in kept:
            if not SCREENING_MIN_TERM_CHARS <= len(term) <= SCREENING_MAX_TERM_CHARS:
                raise ValueError(
                    f"each screening term must be {SCREENING_MIN_TERM_CHARS}..{SCREENING_MAX_TERM_CHARS} characters"
                )
        return kept

    @property
    def is_empty(self) -> bool:
        return not self.content_terms and not self.detectors


ProjectStatus = Literal["active", "paused", "closed"]

_FactToken = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]


class ProjectFacts(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    federal_state: _FactToken | None = Field(
        None,
        validation_alias=AliasChoices("federal_state", "bundesland"),
        description="The Land token; null for a site abroad or unknown",
    )
    building_class: list[Annotated[int, Field(ge=1, le=5)]] = Field(
        default_factory=list,
        max_length=20,
        validation_alias=AliasChoices("building_class", "gebaeudeklasse"),
        description="Every building's Gebäudeklasse",
    )
    construction_method: list[_FactToken] = Field(
        default_factory=list, max_length=20, validation_alias=AliasChoices("construction_method", "bauweise")
    )
    uses: list[_FactToken] = Field(
        default_factory=list, max_length=40, validation_alias=AliasChoices("uses", "nutzungen")
    )
    work_type: list[_FactToken] = Field(
        default_factory=list, max_length=20, validation_alias=AliasChoices("work_type", "vorhabensart")
    )

    @model_validator(mode="after")
    def _english_tokens(self) -> ProjectFacts:
        if self.federal_state is not None:
            self.federal_state = normalize_profile_token("federal_state", self.federal_state)
        for name in ("construction_method", "uses", "work_type"):
            setattr(self, name, [normalize_profile_token(name, token) for token in getattr(self, name)])
        return self

    def to_store(self) -> dict[str, Any]:
        return self.model_dump(mode="json")


class ProjectFactsUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    facts: ProjectFacts = Field(default_factory=ProjectFacts)
    status: ProjectStatus = Field(..., description="The project's lifecycle state (ADR-0098)")


class IngestRequest(KnowledgeMarkFields):
    file_ref: ObjectStoreUrl = Field(..., description="Presigned GET of the original in the object store")
    collection: str = Field(..., description="Target collection name")
    document_id: str | None = Field(None, description="Optional document tracking ID")
    byte_size: int | None = Field(
        None, ge=0, description="The original's bytes: from `INGEST_HEAVY_FILE_BYTES` on, read on the high-memory pool."
    )
    project_id: str | None = Field(
        None,
        max_length=120,
        description="The document's project, so its ingestion spend is booked to it on the usage ledger.",
    )
    project_facts: ProjectFactsUpdate | None = Field(
        None,
        description=(
            "The project's facts and status as the BFF read them at dispatch, stamped onto every chunk "
            "the job writes to Qdrant so a new document is boosted and filtered like its siblings from its "
            "first search. Later changes arrive through `PUT /v1/collections/{c}/project-facts`. Absent "
            "for a document outside a project."
        ),
    )
    user_id: str | None = Field(
        None,
        max_length=120,
        description="The member who put the document there, so its ingestion spend is booked to them.",
    )

    @field_validator("project_facts", mode="wrap")
    @classmethod
    def _drop_unreadable_project_facts(
        cls, value: Any, handler: ValidatorFunctionWrapHandler, info: ValidationInfo
    ) -> ProjectFactsUpdate | None:
        try:
            return handler(value)
        except ValidationError as error:
            logger.warning(
                "Ingest into %s: dropping project facts that do not validate (%s)",
                info.data.get("collection"),
                "; ".join(".".join(str(part) for part in issue["loc"]) or "facts" for issue in error.errors()),
            )
            return None

    priority: Literal["interactive", "bulk"] = Field(
        "interactive",
        description=(
            "Who is waiting on this file. `interactive` (the default): a person uploaded it and watches "
            "it index. `bulk`: a reindex or a rescan of many documents. Inside one organisation an "
            "interactive job is claimed before a bulk one; between organisations the fair claim order "
            "decides, whatever the priority."
        ),
    )
    thumbnail_upload_url: ObjectStoreUrl | None = Field(None, description="Presigned PUT for the generated thumbnail")
    preview_ref: ObjectStoreUrl | None = Field(
        None,
        description=(
            "Presigned GET of an office original's PDF rendition (`<dir>/_render.pdf`, ADR-0070), read only to draw "
            "its thumbnail: the job downloads it once the file's screening has passed (ADR-0086), and not at all "
            "when `extraction_ref` is sent. Never logged: a presigned URL is a bearer credential."
        ),
    )
    extraction_ref: ObjectStoreUrl | None = Field(
        None,
        description=(
            "Presigned GET of the document's PDF rendition to EXTRACT from (ADR-0071), sent by the "
            "BFF for Word, presentation and legacy spreadsheet originals, which are indexed from it "
            "and nothing else: text, embedded images and drawing pages come from this PDF "
            "(page_label = PDF page), a .pptx/.pptm original adds its speaker notes per slide, and "
            "identity stays the original's (every chunk carries `file_name`). Such a file without a "
            "readable rendition fails with `office_rendition_required`. Gated like `file_ref` here, "
            "downloaded by the ingest job, never logged."
        ),
    )
    folder_path: str | None = Field(
        None,
        description=(
            "Materialised folder path the document is filed under "
            "(e.g. 'Brandschutz/Fluchtwege'). Omit or null for the project root."
        ),
    )
    document_type: DocumentTypeField = None

    file_name: str | None = Field(
        None,
        description=(
            "The document's identity inside the collection, as the BFF's `documents.filename`. "
            "Omit or null to derive it from the presigned URL's last path segment, which is what "
            "every caller did before this field existed. State it whenever the object key's "
            "basename is not the name the document is known by: the chunk `file_name` metadata "
            "is the join key every chunk purge addresses, and a name derived from the key is a "
            "guess about a string the BFF already knows."
        ),
    )
    revision_of: str | None = Field(
        None,
        validation_alias=AliasChoices("revision_of", "fassung_of"),
        max_length=512,
        description=(
            "File name of the document in this collection that this file replaces, when a person chose "
            "'als neue Fassung ablegen' in the upload dialog (CONTEXT.md, Fassung). Once the file has been "
            "read, the ingest job writes the same confirmed link `PUT /v1/collections/{c}/revision` writes, "
            "with the change summary. The BFF checks that the person may change the older document; an "
            "older file the collection does not hold, or a link that would close a loop, falls back to "
            "the ordinary suggestion. Omit for every other upload."
        ),
    )
    authored_by: str | None = Field(
        None,
        description=(
            "Who wrote the document: 'agent' for one Piloti wrote, absent for every human "
            "document. The first of four provenance keys stamped onto every chunk and onto the "
            "document metadata row; see agent.common.provenance."
        ),
    )
    approved_by: str | None = Field(
        None, description="Display name of the person who released an agent-authored document."
    )
    approved_at: str | None = Field(None, description="ISO timestamp of that release.")
    producer: str | None = Field(
        None,
        description="Which pipeline wrote an agent-authored document (`documents.authored_by_producer`).",
    )
    mail_thread: MailThreadFacts | None = Field(
        None,
        description=(
            "Sent for a filed E-Mail-Verlauf (ADR-0137): the document's chunks are stamped "
            "`source_format: mail`, which places them in the lane `project_mail`, and the newest "
            "message's date becomes the document's own date. Omit for every other document."
        ),
    )
    mail_origin: MailOrigin | None = Field(
        None,
        description=(
            "Sent for a file a person filed from a mail: the message it came with. Stored on the "
            "document's metadata row and printed by `list_files` and `read_passage`. Omit for every "
            "other document."
        ),
    )

    @model_validator(mode="after")
    def _a_thread_came_with_no_mail(self) -> IngestRequest:
        if self.mail_thread is not None and self.mail_origin is not None:
            raise ValueError("mail_thread and mail_origin describe different documents; send one")
        return self

    screening: ScreeningPolicy | None = Field(
        None,
        description=(
            "The organization's upload screening. The job checks the text it extracts locally "
            "against it before its first model call, and fails a matching file with its reasons "
            "on `quarantine` (the typed verdict). Absent, null or empty: not screened "
            "(the OIB base-corpus sync sends none)."
        ),
    )


class ProjectFactsResult(BaseModel):
    collection: str
    applied: bool = Field(
        ...,
        description=(
            "False when no point of the collection exists yet: nothing to write, and the first document's "
            "ingest job carries the facts itself."
        ),
    )


class UploadResponse(BaseModel):
    job_id: str = Field(..., description="Job ID for polling status")
    file_ids: list[str] = Field(default_factory=list, description="IDs of uploaded files")
    message: str | None = Field(None, description="Status message")


class OibSyncResponse(BaseModel):
    status: str
    message: str
    files_added: int
    files_total: int


class OibUploadedMember(BaseModel):
    file_name: str = Field(..., description="Member PDF basename.")
    status: str = Field(..., description="'pending' (queued for ingestion) or 'rejected'.")
    doc_class: str | None = Field(None, description="Pre-filled doc_class guess for accepted members.")
    reason: str | None = Field(None, description="Why the member was rejected (rejected members only).")


class OibDocumentUploadResponse(BaseModel):
    status: str = Field(..., description="'pending', 'success', 'failed', or 'timeout'.")
    file_name: str | None = Field(None, description="Uploaded PDF basename (single-file uploads).")
    message: str
    doc_class: str | None = Field(None, description="Stored/guessed doc_class (single-file uploads).")
    kind: str = Field("file", description="'file' for a single PDF, 'zip' for a bulk ZIP upload.")
    accepted: int | None = Field(None, description="Members queued for ingestion (ZIP uploads).")
    rejected: int | None = Field(None, description="Members skipped/rejected during extraction (ZIP uploads).")
    members: list[OibUploadedMember] | None = Field(None, description="Per-member outcome (ZIP uploads).")


class OibDocumentDeleteResponse(BaseModel):
    success: bool
    file_name: str
