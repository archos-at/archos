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

from agent.knowledge.dossier import DocumentType
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


class ProjectFactsResult(BaseModel):
    collection: str
    applied: bool = Field(
        ...,
        description=(
            "False when no point of the collection exists yet: nothing to write, and the first document's "
            "ingest job carries the facts itself."
        ),
    )


class GenerateSummaryRequest(BaseModel):
    profile_text: str = Field(..., description="Human-readable project profile text (label: value lines)")
    locale: str = Field(
        default="de",
        description="UI locale ('de' or 'en') — the language the summary must be written in",
    )


class GenerateSummaryResponse(BaseModel):
    summary: str = Field(..., description="One-sentence generated project summary (empty string on failure)")
    error: str | None = Field(
        default=None,
        description=(
            "Failure code when summary generation could not complete "
            "(e.g. llm_not_configured, llm_request_failed, llm_response_malformed); "
            "None on success"
        ),
    )


class CleanupDocumentFacts(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(..., max_length=64)
    filename: str = Field(..., max_length=500)
    folder_path: str | None = Field(default=None, max_length=1000)
    content_type: str | None = Field(default=None, max_length=200)
    tags: list[str] = Field(default_factory=list, max_length=50)
    summary: str | None = Field(default=None, max_length=600)
    version_state: str | None = Field(default=None, max_length=40)
    authored_by: str | None = Field(default=None, max_length=40)
    uploaded_at: str | None = Field(default=None, max_length=40)


class CleanupProposalRequest(BaseModel):
    documents: list[CleanupDocumentFacts] = Field(..., max_length=2000)
    locale: str = Field(default="de", description="UI locale; the reasons are written in it")


class CleanupCandidate(BaseModel):
    id: str
    category: str = Field(
        ..., description="working_copy | superseded | duplicate | temporary | unpublished_draft | other"
    )
    reason: str


class CleanupProposalResponse(BaseModel):
    candidates: list[CleanupCandidate] = Field(default_factory=list)
    model: str | None = None
    error: str | None = None


class ConversationTitleMessage(BaseModel):
    role: str = Field(..., description="'user' or 'assistant'")
    content: str = Field(..., description="Plain-text message content (no cards/markup)")


class GenerateConversationTitleRequest(BaseModel):
    messages: list[ConversationTitleMessage] = Field(
        default_factory=list,
        description="Opening exchange, oldest first (first user question + optional assistant answer)",
    )
    allowed_tags: list[str] = Field(
        default_factory=list,
        description="Closed vocabulary of topic tag keys the model may choose from",
    )
    locale: str = Field(
        default="de",
        description="UI locale ('de' or 'en') — the language the title must be written in",
    )


class GenerateConversationTitleResponse(BaseModel):
    title: str = Field(..., description="Concise conversation title (empty string on failure)")
    tags: list[str] = Field(
        default_factory=list,
        description="Chosen topic tag keys (subset of allowed_tags; empty on failure or when none fit)",
    )
    error: str | None = Field(
        default=None,
        description=(
            "Failure code when naming could not complete "
            "(e.g. llm_not_configured, llm_request_failed, llm_response_malformed); "
            "None on success"
        ),
    )


MAX_DICTATION_AUDIO_BYTES = 4 * 1024 * 1024

DictationAudioFormat = Literal["webm", "ogg", "m4a"]


class DictationRequest(BaseModel):
    audio_base64: str = Field(
        ...,
        min_length=1,
        max_length=(MAX_DICTATION_AUDIO_BYTES * 4) // 3 + 4,
        description="The recording, base64-encoded (raw bytes, not a data URI)",
    )
    format: DictationAudioFormat = Field(..., description="Container format of the recording")
    duration_ms: int | None = Field(
        default=None,
        ge=0,
        le=120_000,
        description="Length the browser measured; recorded when the provider reports none",
    )
    locale: str | None = Field(
        default=None,
        max_length=16,
        description=(
            "The member's UI language. A hint for wording only: it is never sent as the "
            "transcription language, because a German sentence with English terms must stay mixed"
        ),
    )


class DictationResponse(BaseModel):
    text: str = Field(default="", description="Cleaned transcript; empty for silence or on failure")
    audio_seconds: float | None = Field(default=None, description="Seconds of audio transcribed")
    model: str | None = Field(default=None, description="The model that produced the transcript")
    error: str | None = Field(
        default=None,
        description=(
            "Failure code (transcription_not_configured, audio_invalid, audio_too_large, "
            "transcription_failed); None on success, including an empty transcript"
        ),
    )


MAX_DIGEST_SAMPLES = 60


class FeedbackDigestTopic(BaseModel):
    topic: str = Field(..., description="Conversation topic tag key (e.g. 'fire_safety')")
    up: int = Field(0, ge=0, description="Helpful votes on conversations carrying this tag")
    down: int = Field(0, ge=0, description="Unhelpful votes on conversations carrying this tag")


class FeedbackDigestOrgShare(BaseModel):
    up: int = Field(0, ge=0)
    down: int = Field(0, ge=0)


class FeedbackDigestSample(BaseModel):
    verdict: Literal["up", "down"] = Field(..., description="'up' or 'down'")
    reason: str | None = Field(None, description="Down-vote reason key, when the vote carried one")
    topics: list[str] = Field(default_factory=list, description="Topic tag keys of the conversation")
    question: str = Field(..., description="The user's question, truncated by the caller")
    comment: str | None = Field(
        None,
        max_length=400,
        description=(
            "The down-vote's free-text comment, truncated by the caller. Read only to label the vote's cause "
            "(ADR-0064, use 9) and quoted to the digest as data."
        ),
    )


class FeedbackDigestRequest(BaseModel):
    window_days: int = Field(30, ge=1, le=365, description="Days of history the aggregate covers")
    answers: int = Field(0, ge=0, description="Assistant answers produced in the window (the denominator)")
    up: int = Field(0, ge=0, description="Helpful votes")
    down: int = Field(0, ge=0, description="Unhelpful votes")
    voters: int = Field(0, ge=0, description="Distinct people who voted")
    down_voters: int = Field(0, ge=0, description="Distinct people behind the unhelpful votes")
    reasons: dict[str, int] = Field(
        default_factory=dict,
        description="Down-vote reason key → count",
    )
    topics: list[FeedbackDigestTopic] = Field(default_factory=list, description="Per-topic vote counts")
    organizations: list[FeedbackDigestOrgShare] = Field(
        default_factory=list,
        description="Per-organization vote counts, anonymised (see FeedbackDigestOrgShare)",
    )
    trend_delta_points: float | None = Field(
        None,
        description=(
            "Change in the helpful rate in percentage points, last third of the window "
            "against the first third. Positive = improving. None when too sparse to read."
        ),
    )
    samples: list[FeedbackDigestSample] = Field(
        default_factory=list,
        description="Bounded sample of rated questions, both directions",
        max_length=MAX_DIGEST_SAMPLES,
    )
    locale: str = Field("de", description="UI locale ('de' or 'en') — the language the digest is written in")


class FeedbackDigestResponse(BaseModel):
    headline: str = Field("", description="Two or three plain sentences summarising the window")
    strengths: list[str] = Field(default_factory=list, description="What the data says is working (0–3)")
    concerns: list[str] = Field(default_factory=list, description="What the data says needs attention (0–3)")
    recommendation: str | None = Field(
        None,
        description="One concrete next step, when the data supports one",
    )
    causes: dict[str, int] = Field(
        default_factory=dict,
        description=(
            "Sampled unhelpful votes by decided cause (feedback_causes.CAUSES keys), most frequent first; "
            "empty when no decision ran"
        ),
    )
    error: str | None = Field(
        default=None,
        description=(
            "Failure code when the digest could not be produced "
            "(llm_not_configured, llm_request_failed, llm_response_malformed); None on success"
        ),
    )


class ConsistencyCheckField(BaseModel):
    field: str = Field(..., description="Human-readable question label (echoed back in findings)")
    value: str = Field(..., description="Human-readable rendering of the user's answer")


class ConsistencyCheckRequest(BaseModel):
    free_text: list[ConsistencyCheckField] = Field(
        default_factory=list,
        description="Free-text answers to scrutinise (e.g. goal details, high-building details)",
    )
    structured: list[ConsistencyCheckField] = Field(
        default_factory=list,
        description="Structured answers as read-only context (never themselves flagged here)",
    )
    locale: str = Field(
        default="de",
        description="UI locale ('de' or 'en') — the language the user-facing explanations must be written in",
    )


class ConsistencyFinding(BaseModel):
    fields: list[str] = Field(
        default_factory=list,
        description="Labels of the answers involved in the contradiction (echoed from the request)",
    )
    severity: str = Field(..., description="'warning' (soft, worth a look) or 'inconsistency' (hard contradiction)")
    explanation: str = Field(..., description="User-facing explanation of the contradiction, in the request locale")


class ConsistencyCheckResponse(BaseModel):
    findings: list[ConsistencyFinding] | None = Field(
        default=None,
        description="Detected contradictions ([] = consistent); None when the check could not complete",
    )
    error: str | None = Field(
        default=None,
        description=(
            "Failure code when the check could not complete "
            "(llm_not_configured, llm_request_failed, llm_response_malformed); None on success"
        ),
    )


class SkillReviewRequest(BaseModel):
    name: str = Field(default="", description="Skill name as written in the SKILL.md frontmatter")
    description: str = Field(default="", description="Skill description (progressive-disclosure level 1)")
    body: str = Field(default="", description="Skill instruction markdown (progressive-disclosure level 2)")
    organization_id: str | None = Field(
        default=None,
        description=(
            "WorkOS organization id, so the review reaches the org's BYOK LLM credential. "
            "Falls back to the X-Grid-Organization-Id header when omitted."
        ),
    )


class SkillReviewFinding(BaseModel):
    severity: str = Field(..., description="'error' (breaks the skill), 'warning' (likely harmful), 'suggestion'")
    field: str = Field(..., description="Which part of the SKILL.md the finding is about: name, description or body")
    check: str = Field(
        default="",
        description="Rulebook check id this finding came from (e.g. '4.8-description-trigger-style'); '' if unknown",
    )
    message: str = Field(..., description="What is wrong, in the language of the skill being reviewed")
    fix: str = Field(..., description="Concrete rewrite/action that resolves the finding, in the same language")


class SkillReviewResponse(BaseModel):
    findings: list[SkillReviewFinding] | None = Field(
        default=None,
        description="Critiques ([] = the skill is good); None when the review could not complete",
    )
    error: str | None = Field(
        default=None,
        description=(
            "Failure code when the review could not complete "
            "(llm_not_configured, llm_request_failed, llm_response_malformed); None on success"
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


MAX_NOTE_EMBEDDING_TEXTS = 64


class NoteEmbeddingRequest(BaseModel):
    texts: list[str] = Field(
        default_factory=list,
        description="Short texts to embed, in order; the response's vectors match this order",
        max_length=MAX_NOTE_EMBEDDING_TEXTS,
    )


class NoteEmbeddingResponse(BaseModel):
    vectors: list[list[float]] = Field(default_factory=list, description="One vector per input text, in order")
    fingerprint: str = Field("", description="Embedding-model fingerprint to store beside each vector")
    dimensions: int = Field(0, ge=0, description="Vector dimensionality, 0 when nothing was embedded")
    error: str | None = Field(
        default=None,
        description=(
            "Failure code when embedding could not be done "
            "(embedder_not_configured, embedder_unavailable, embedding_failed); None on success"
        ),
    )
