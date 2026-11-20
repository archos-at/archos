from typing import Literal

from pydantic import BaseModel
from pydantic import ConfigDict
from pydantic import Field


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
