from __future__ import annotations

import hashlib
import json
from typing import Annotated
from typing import Any
from typing import Literal

from pydantic import BaseModel
from pydantic import BeforeValidator
from pydantic import Field
from pydantic import TypeAdapter
from pydantic import WithJsonSchema
from pydantic import model_validator

from agent.common.source_kinds import LEGACY_SHELF_VALUES
from agent.common.wire_model import OpenWireModel as _OpenModel
from agent.common.wire_model import WireModel as _Model

WIRE_VERSION: Literal[2] = 2

CLOSE_CLIENT_OUTDATED = 4426

Scalar = str | int | float | bool


SourceKindKey = Literal["building_law", "office", "project", "web"]
Channel = Literal["live", "technical"]
Scope = Literal["chat", "deep"]


class TraceLaneSource(_Model):
    name: str = Field(min_length=1, description="Raw file name: the document identity.")
    title: str | None = Field(default=None, description="Display title, omitted when it would repeat `name`.")
    detail: str | None = Field(default=None, description="Locus, e.g. 'Pkt. 3.5.2 p.12'.")
    shelf: str | None = None
    round: int | None = Field(default=None, ge=0, description="The retrieval round that fetched it.")
    provenance: dict[str, str] | None = Field(default=None, description="Agent authorship keys (ADR-0061).")


class TraceLane(_Model):
    key: str = Field(min_length=1)
    label: str
    kind: SourceKindKey
    hit_count: int = Field(ge=0)
    sources: list[TraceLaneSource]


class WireSource(_OpenModel):
    content: str
    number: int | None = Field(default=None, ge=1)
    file_name: str | None = None
    page: int | None = None


class KeyedCard(_Model):
    key: str = Field(min_length=1, description="card_key(card): stable across the live event and the terminal.")
    card: dict[str, Any] = Field(description="A AnswerCard (cards/models.py); validated by answerCardSchema on render.")


def card_key(card: dict[str, Any]) -> str:
    canonical = json.dumps(card, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:16]


class _StepBase(_Model):
    id: str = Field(min_length=1, max_length=200)
    scope: Scope = "chat"


class StatusStep(_StepBase):
    kind: Literal["status"] = "status"
    slot: str = Field(min_length=1, description="e.g. 'synthesis', 'budget', 'decision:rerank'.")
    key: str | None = Field(default=None, description="i18n id (ALL_STATUS_KEYS); absent on technical records.")
    values: dict[str, str] = Field(default_factory=dict, description="Interpolation values ONLY.")
    channel: Channel = "live"
    detail: dict[str, Scalar | list[str]] = Field(
        default_factory=dict, description="Structured detail that is not part of the sentence (counts, reasons)."
    )


class RetrievalStep(_StepBase):
    kind: Literal["retrieval"] = "retrieval"
    round: int = Field(ge=0)
    key: str
    values: dict[str, str] = Field(default_factory=dict)
    tools: list[str] = Field(default_factory=list, description="Tool basenames this round called.")
    reason: str | None = Field(default=None, max_length=160, description="The model's conclusion, verbatim.")
    prefetch: bool = Field(
        default=False, description="Round 0 run before the model's first call; the Herleitung draws no row for it."
    )


class SourcesStep(_StepBase):
    kind: Literal["sources"] = "sources"
    round: int | None = Field(default=None, ge=0)
    tool: str = Field(min_length=1)
    lanes: list[TraceLane]
    call_id: str | None = Field(
        default=None, max_length=64, description="The action row of the call that returned these (ADR-0132)."
    )


class ToolStep(_StepBase):
    kind: Literal["tool"] = "tool"
    tool: str = Field(min_length=1)
    status: Literal["running", "ok", "error"] = "running"
    mount: Literal["drafts", "skills", "project", "office", "chat", "law", "estate"] | None = Field(
        default=None,
        description=(
            "Which part of the agent's filesystem a file tool reached (ADR-0133): a mount, or `estate` for a call "
            "over every mount the person may see. Absent on every other tool, and on a file tool of a turn "
            "stored before the field existed, which only ever reached the drafts."
        ),
    )


class SkillStep(_StepBase):
    kind: Literal["skill"] = "skill"
    phase: Literal["offered", "activated", "loaded"]
    skill: str | None = Field(default=None, description="Absent on the per-turn `offered` record.")
    title: str | None = None
    hidden: bool = False
    count: int | None = Field(default=None, ge=0, description="`offered`: how many skills the catalog held.")
    channel: Channel = "live"


class ClarificationStep(_StepBase):
    kind: Literal["clarification"] = "clarification"
    max_turns: int = Field(ge=1)


class LookStep(_StepBase):
    kind: Literal["look"] = "look"
    round: int | None = Field(default=None, ge=0, description="The retrieval round the look ran in.")
    document_name: str = Field(min_length=1, max_length=300, description="The file name.")
    document_id: str | None = Field(default=None, description="The workspace document's id; absent for Basiswissen.")
    revision_id: str | None = Field(default=None, description="The Fassung; absent means the current one.")
    shelf: Literal["stored", "base"] = "stored"
    page: int = Field(ge=1)
    region: list[float] | None = Field(
        default=None, min_length=4, max_length=4, description="[x, y, w, h], shares of the page; absent: whole page."
    )
    image_index: int | None = Field(default=None, ge=0, description="The embedded image looked at, if any.")
    where: str | None = Field(default=None, max_length=60, description="The region in words, e.g. 'oben rechts'.")
    question: str | None = Field(default=None, max_length=200)
    reading: str | None = Field(default=None, max_length=300, description="The first reading, when one was made.")


ActionVerb = Literal["search", "list", "read", "look", "lookup", "law", "web", "model", "workspace"]


class ActionCounts(_Model):
    hits: int | None = Field(default=None, ge=0, description="Passages or matches returned.")
    documents: int | None = Field(default=None, ge=0, description="Distinct documents the hits are in.")
    searched: int | None = Field(default=None, ge=0, description="Documents searched, the denominator.")
    files: int | None = Field(default=None, ge=0, description="Files a listing showed.")
    folders: int | None = Field(default=None, ge=0, description="Folders a listing showed.")


class ActionStep(_StepBase):
    kind: Literal["action"] = "action"
    call_id: str = Field(min_length=1, max_length=64, description="Shared with the sources step this call returned.")
    round: int | None = Field(default=None, ge=0, description="The retrieval round the call ran in.")
    verb: ActionVerb
    status: Literal["running", "ok", "empty", "error"] = "running"
    query: str | None = Field(default=None, max_length=160, description="What was searched for, the model's words.")
    mode: Literal["meaning", "exact", "regex"] | None = Field(default=None, description="A search's match mode.")
    target: str | None = Field(
        default=None, max_length=300, description="Folder path, document name, project or operation, in words."
    )
    document_id: str | None = Field(default=None, description="The workspace document a read or look opened.")
    pages: str | None = Field(
        default=None, max_length=40, description="The pages or Punkt read, e.g. '2-3', 'Pkt. 3.5'."
    )
    shelf: str | None = Field(default=None, max_length=40, description="Which shelf: project, office, base, web.")
    mount: Literal["project", "office", "chat", "law", "estate"] | None = Field(
        default=None,
        description=(
            "The place a path-based call reached (ADR-0133), `estate` for every place the person may see. "
            "With it, `target` is the folder inside that place, absent at its root."
        ),
    )
    incomplete: bool | None = Field(
        default=None,
        description=(
            "A literal search that could not search everything (a place did not answer, the scan ran out of "
            "time or stopped at its cap): its count is a floor, and no hit is no no."
        ),
    )
    missing: bool | None = Field(
        default=None,
        description=(
            "The folder or document the call named is not there (a restricted one answers the same, ADR-0088). "
            "Absent on an empty folder or a search without a hit, which are there and hold nothing."
        ),
    )
    counts: ActionCounts | None = None
    elapsed_ms: int | None = Field(default=None, ge=0)


Step = Annotated[
    StatusStep | RetrievalStep | SourcesStep | ToolStep | SkillStep | ClarificationStep | LookStep | ActionStep,
    Field(discriminator="kind"),
]


class AnswerSnapshot(_Model):
    text: str
    sources: list[WireSource] = Field(default_factory=list)
    answer_meta: dict[str, Any] | None = Field(default=None, description="Absent: the re-gate dropped the masthead.")


class CitationsRemoved(_Model):
    count: int = Field(ge=1)
    reasons: list[str]


class RunHandoff(_Model):
    run_id: str = Field(min_length=1)
    run_message_id: str = Field(min_length=1)


class QuoteStamp(_Model):
    text: str = Field(description="The wording between the quote marks, as the final text writes it.")
    status: Literal["verbatim", "not_found", "unchecked"]
    number: int | None = Field(default=None, ge=1)
    title: str | None = None
    file_name: str | None = None
    page: int | None = None
    clause: str | None = None
    url: str | None = None


class ConfidenceFinding(_Model):
    statement: str = Field(max_length=300)
    problem: Literal["unbacked", "contradicted"]
    reason: str = Field(max_length=300)
    source: str = Field(max_length=200)


class ConfidenceUnavailable(_Model):
    cause: Literal["no_judge", "timeout", "error", "unparseable", "no_reply"]
    error_type: str | None = Field(default=None, max_length=100)
    finish_reason: str | None = Field(default=None, max_length=40)
    truncated: bool = False
    elapsed_ms: int | None = Field(default=None, ge=0)
    evidence_chars: int | None = Field(default=None, ge=0)
    answer_chars: int | None = Field(default=None, ge=0)


class ConfidenceCheck(_Model):
    status: Literal["judged", "unavailable"]
    level: Literal["low", "medium", "high"] | None = None
    findings: list[ConfidenceFinding] = Field(default_factory=list)
    unavailable_reason: ConfidenceUnavailable | None = Field(
        default=None, json_schema_extra={"x-unknown-as-null": True}
    )


class TurnResult(_Model):
    message_id: str = Field(min_length=1, description="turn.response.answer_message_id(conversation, turn).")
    text: str
    cards: list[KeyedCard] = Field(default_factory=list)
    sources: list[WireSource] = Field(default_factory=list)
    read_sources: list[dict[str, Any]] = Field(default_factory=list)
    answer_meta: dict[str, Any] | None = None
    answer_confidence: Literal["low", "medium", "high"] | None = None
    answer_confidence_reason: str | None = Field(default=None, max_length=300)
    answer_confidence_capped_reason: Literal["ungrounded", "quote_unverified", "law_unsettled", "open_point"] | None = (
        Field(default=None, json_schema_extra={"x-unknown-as-null": True})
    )
    routing_decision: Literal["meta", "shallow", "deep", "error"] | None = None
    escalation_reason: str | None = None
    citations_removed: CitationsRemoved | None = None
    research_truncated: bool = False
    job_admission_rejected: bool = False
    retry_after_seconds: int | None = Field(default=None, ge=0)
    skills_activated: list[str] = Field(default_factory=list)
    skills_hidden: list[str] = Field(default_factory=list)
    retrieval_ledger: list[dict[str, Any]] = Field(default_factory=list)
    quote_stamps: list[QuoteStamp] = Field(default_factory=list)
    confidence_check: ConfidenceCheck | None = None
    answer_confidence_version: Literal[1, 2] | None = None
    lookup_found_nothing: bool = False
    run: RunHandoff | None = None
    reasoning_effort: Literal["none", "minimal", "low", "medium", "high", "xhigh"] | None = None


class Envelope(_Model):
    v: Literal[2] = WIRE_VERSION
    conversation_id: str = Field(min_length=1)
    turn_id: str = Field(min_length=1)
    seq: int = Field(ge=0)
    ts: int = Field(ge=0)


class RunStartedBody(_Model):
    type: Literal["RUN_STARTED"] = "RUN_STARTED"
    message_id: str = Field(min_length=1, description="The answer's id; the bubble is keyed by it from now on.")


class TextMessageStartBody(_Model):
    type: Literal["TEXT_MESSAGE_START"] = "TEXT_MESSAGE_START"
    message_id: str = Field(min_length=1)


class TextMessageContentBody(_Model):
    type: Literal["TEXT_MESSAGE_CONTENT"] = "TEXT_MESSAGE_CONTENT"
    message_id: str = Field(min_length=1)
    delta: str = Field(min_length=1)


class TextMessageEndBody(_Model):
    type: Literal["TEXT_MESSAGE_END"] = "TEXT_MESSAGE_END"
    message_id: str = Field(min_length=1)


class StateSnapshotBody(_Model):
    type: Literal["STATE_SNAPSHOT"] = "STATE_SNAPSHOT"
    snapshot: AnswerSnapshot


SubagentRunId = Annotated[str, Field(min_length=1, max_length=64)]


class StepStartedBody(_Model):
    type: Literal["STEP_STARTED"] = "STEP_STARTED"
    step: Step
    subagent_run_id: SubagentRunId | None = Field(
        default=None,
        description="The subagent invocation that took the step (AG-UI `subagentRunId`). Absent: the turn's own agent.",
    )


class StepFinishedBody(_Model):
    type: Literal["STEP_FINISHED"] = "STEP_FINISHED"
    step: Step
    subagent_run_id: SubagentRunId | None = Field(
        default=None,
        description="The subagent invocation that took the step (AG-UI `subagentRunId`). Absent: the turn's own agent.",
    )


class SubagentStartedBody(_Model):
    type: Literal["SUBAGENT_STARTED"] = "SUBAGENT_STARTED"
    subagent_run_id: SubagentRunId
    name: str = Field(min_length=1, max_length=64, description="Which subagent, e.g. 'planner-agent'; reusable.")
    description: str | None = Field(
        default=None, max_length=160, description="What this invocation is for, in the model's words, clipped."
    )
    parent_subagent_run_id: SubagentRunId | None = Field(
        default=None, description="The subagent invocation that spawned this one; absent: the turn's own agent did."
    )
    parent_tool_call_id: str | None = Field(
        default=None, max_length=128, description="The tool call that spawned it, when a subagent is a tool."
    )


class SubagentFinishedBody(_Model):
    type: Literal["SUBAGENT_FINISHED"] = "SUBAGENT_FINISHED"
    subagent_run_id: SubagentRunId


class SubagentErrorBody(_Model):
    type: Literal["SUBAGENT_ERROR"] = "SUBAGENT_ERROR"
    subagent_run_id: SubagentRunId
    message: str = Field(min_length=1, max_length=300, description="For a person to read; never the raw exception.")
    code: str | None = Field(default=None, max_length=64, description="Machine-readable, e.g. the exception class.")


class RunFinishedBody(_Model):
    type: Literal["RUN_FINISHED"] = "RUN_FINISHED"
    outcome: Literal["answered", "refused", "handed_off", "cancelled"]
    result: TurnResult


class RunErrorBody(_Model):
    type: Literal["RUN_ERROR"] = "RUN_ERROR"
    code: Literal["workflow_error", "auth_error", "interaction_expired"]
    message: str
    details: str | None = None


class MastheadValue(_Model):
    answer_meta: dict[str, Any]


class CardValue(_Model):
    index: int = Field(ge=0, description="Position in the terminal's order: `[[card:N]]` is index N-1.")
    key: str = Field(min_length=1)
    card: dict[str, Any]


class CardRefusedValue(_Model):
    index: int = Field(ge=0)


class EmptyValue(_Model):
    pass


class HeartbeatValue(_Model):
    every_ms: int = Field(gt=0)


class StageValue(_Model):
    stage: Literal["follow_ups", "memory_reflection"]
    status: Literal["ready", "empty", "failed"]
    payload: dict[str, Any] | None = Field(default=None, description="Only on `ready`.")


class InteractionOption(_Model):
    id: str = Field(min_length=1)
    label: str = Field(min_length=1)


class InteractionRequestValue(_Model):
    interaction_id: str = Field(min_length=1)
    input: Literal["text", "choice"]
    text: str
    options: list[InteractionOption] = Field(default_factory=list)
    placeholder: str | None = None
    expires_at: int = Field(ge=0, description="Epoch ms; after it the turn ends with RUN_ERROR interaction_expired.")


class InteractionResolvedValue(_Model):
    interaction_id: str = Field(min_length=1)
    outcome: Literal["answered", "expired", "cancelled"]


class RejectedValue(_Model):
    of: Literal["user_message", "interaction_response", "cancel_turn", "attach", "steer", "unknown"]
    code: Literal[
        "auth_expired",
        "conversation_mismatch",
        "duplicate_turn",
        "not_asker",
        "no_pending_interaction",
        "turn_not_found",
        "invalid_message",
        "busy",
        "steer_limit",
    ]
    message: str | None = None


class SteerReceivedValue(_Model):
    steer_id: str = Field(min_length=1, max_length=128)
    text: str = Field(min_length=1)


class SteerAppliedValue(_Model):
    steer_id: str = Field(min_length=1, max_length=128)
    round: int = Field(ge=1)


ViewerActionName = Literal[
    "open_document",
    "highlight_passage",
    "highlight_region",
    "compare_revisions",
    "focus_ifc_element",
]

VIEWER_ACTION_REQUIRES: dict[str, tuple[str, ...]] = {
    "open_document": (),
    "highlight_passage": ("page", "passage"),
    "highlight_region": ("page", "region"),
    "compare_revisions": ("against_document_id",),
    "focus_ifc_element": ("element",),
}

MAX_VIEWER_PASSAGE_CHARS = 400


class ViewerActionArgs(_Model):
    document_id: str = Field(min_length=1, max_length=128)
    document_name: str = Field(min_length=1, max_length=300, description="The file name, for the chat's row.")
    page: int | None = Field(default=None, ge=1, description="The page, from 1.")
    passage: str | None = Field(
        default=None, min_length=1, max_length=MAX_VIEWER_PASSAGE_CHARS, description="Text to mark on the page."
    )
    region: list[float] | None = Field(
        default=None, min_length=4, max_length=4, description="`[x, y, w, h]`, shares of the page as shown."
    )
    against_document_id: str | None = Field(
        default=None, min_length=1, max_length=128, description="The older Fassung a comparison is made against."
    )
    against_document_name: str | None = Field(default=None, min_length=1, max_length=300)
    element: str | None = Field(default=None, pattern=r"^[0-9A-Za-z_$]{22}$", description="An IFC GlobalId.")

    @model_validator(mode="after")
    def _region_on_the_page(self) -> ViewerActionArgs:
        if self.region is None:
            return self
        x, y, w, h = self.region
        inside = all(0 <= v <= 1 for v in self.region) and w > 0 and h > 0
        if not inside or x + w > 1 + _EDGE_EPSILON or y + h > 1 + _EDGE_EPSILON:
            raise ValueError("the region is not a box on the page: shares from 0 to 1, x + w and y + h at most 1")
        return self


class ViewerActionValue(_Model):
    tool_call_id: str = Field(min_length=1, max_length=64)
    tool_call_name: Annotated[
        ViewerActionName,
        WithJsonSchema({"type": "string", "minLength": 1, "maxLength": 64, "description": "A viewer action's name."}),
    ]
    args: ViewerActionArgs

    @model_validator(mode="after")
    def _has_what_it_needs(self) -> ViewerActionValue:
        missing = [name for name in VIEWER_ACTION_REQUIRES[self.tool_call_name] if getattr(self.args, name) is None]
        if missing:
            raise ValueError(f"{self.tool_call_name} needs {', '.join(missing)}")
        return self


class _CustomBody(_Model):
    type: Literal["CUSTOM"] = "CUSTOM"


class MastheadBody(_CustomBody):
    name: Literal["masthead"] = "masthead"
    value: MastheadValue


class CardBody(_CustomBody):
    name: Literal["card"] = "card"
    value: CardValue


class CardRefusedBody(_CustomBody):
    name: Literal["card_refused"] = "card_refused"
    value: CardRefusedValue


class AnswerRetractedBody(_CustomBody):
    name: Literal["answer_retracted"] = "answer_retracted"
    value: EmptyValue


class HeartbeatBody(_CustomBody):
    name: Literal["heartbeat"] = "heartbeat"
    value: HeartbeatValue


class StageBody(_CustomBody):
    name: Literal["stage"] = "stage"
    value: StageValue


class InteractionRequestBody(_CustomBody):
    name: Literal["interaction_request"] = "interaction_request"
    value: InteractionRequestValue


class InteractionResolvedBody(_CustomBody):
    name: Literal["interaction_resolved"] = "interaction_resolved"
    value: InteractionResolvedValue


class RejectedBody(_CustomBody):
    name: Literal["rejected"] = "rejected"
    value: RejectedValue


class SteerReceivedBody(_CustomBody):
    name: Literal["steer_received"] = "steer_received"
    value: SteerReceivedValue


class SteerAppliedBody(_CustomBody):
    name: Literal["steer_applied"] = "steer_applied"
    value: SteerAppliedValue


class ViewerActionBody(_CustomBody):
    name: Literal["viewer_action"] = "viewer_action"
    value: ViewerActionValue


ACCEPTED_CLIENT_FIELDS: tuple[str, ...] = (
    "cancel_turn.shown",
    "user_message.posthog_session_id",
    "user_message.focus_region",
    "user_message.reply_in_thread",
    "user_message.trigger",
    "user_message.if_idle",
    "user_message.client_tools",
    "user_message.answer_excerpt",
    "steer",
)


class HelloValue(_Model):
    build: str = Field(min_length=1, description="The deployed commit (GIT_SHA), or 'unknown', as /health has it.")
    accepts: list[str] = Field(
        default_factory=list,
        description=(
            "The optional client fields this server reads, as '<type>.<field>' (ACCEPTED_CLIENT_FIELDS). "
            "Free strings, not an enum: a newer server's entry must not make an older page refuse its hello."
        ),
    )


class Hello(_Model):
    v: Literal[2] = WIRE_VERSION
    type: Literal["CUSTOM"] = "CUSTOM"
    name: Literal["hello"] = "hello"
    ts: int = Field(ge=0)
    value: HelloValue


class RunStarted(Envelope, RunStartedBody):
    pass


class TextMessageStart(Envelope, TextMessageStartBody):
    pass


class TextMessageContent(Envelope, TextMessageContentBody):
    pass


class TextMessageEnd(Envelope, TextMessageEndBody):
    pass


class StateSnapshot(Envelope, StateSnapshotBody):
    pass


class StepStarted(Envelope, StepStartedBody):
    pass


class StepFinished(Envelope, StepFinishedBody):
    pass


class SubagentStarted(Envelope, SubagentStartedBody):
    pass


class SubagentFinished(Envelope, SubagentFinishedBody):
    pass


class SubagentError(Envelope, SubagentErrorBody):
    pass


class RunFinished(Envelope, RunFinishedBody):
    pass


class RunError(Envelope, RunErrorBody):
    pass


class Masthead(Envelope, MastheadBody):
    pass


class Card(Envelope, CardBody):
    pass


class CardRefused(Envelope, CardRefusedBody):
    pass


class AnswerRetracted(Envelope, AnswerRetractedBody):
    pass


class Heartbeat(Envelope, HeartbeatBody):
    pass


class Stage(Envelope, StageBody):
    pass


class InteractionRequest(Envelope, InteractionRequestBody):
    pass


class InteractionResolved(Envelope, InteractionResolvedBody):
    pass


class Rejected(Envelope, RejectedBody):
    pass


class SteerReceived(Envelope, SteerReceivedBody):
    pass


class SteerApplied(Envelope, SteerAppliedBody):
    pass


class ViewerAction(Envelope, ViewerActionBody):
    pass


CustomEvent = Annotated[
    Masthead
    | Card
    | CardRefused
    | AnswerRetracted
    | Heartbeat
    | Stage
    | InteractionRequest
    | InteractionResolved
    | Rejected
    | SteerReceived
    | SteerApplied
    | ViewerAction,
    Field(discriminator="name"),
]

WireEvent = Annotated[
    RunStarted
    | TextMessageStart
    | TextMessageContent
    | TextMessageEnd
    | StateSnapshot
    | StepStarted
    | StepFinished
    | SubagentStarted
    | SubagentFinished
    | SubagentError
    | RunFinished
    | RunError
    | CustomEvent,
    Field(discriminator="type"),
]

EventBody = (
    RunStartedBody
    | TextMessageStartBody
    | TextMessageContentBody
    | TextMessageEndBody
    | StateSnapshotBody
    | StepStartedBody
    | StepFinishedBody
    | SubagentStartedBody
    | SubagentFinishedBody
    | SubagentErrorBody
    | RunFinishedBody
    | RunErrorBody
    | MastheadBody
    | CardBody
    | CardRefusedBody
    | AnswerRetractedBody
    | HeartbeatBody
    | StageBody
    | InteractionRequestBody
    | InteractionResolvedBody
    | RejectedBody
    | SteerReceivedBody
    | SteerAppliedBody
    | ViewerActionBody
)

_EVENT_OF_BODY: dict[type[BaseModel], type[Envelope]] = {
    RunStartedBody: RunStarted,
    TextMessageStartBody: TextMessageStart,
    TextMessageContentBody: TextMessageContent,
    TextMessageEndBody: TextMessageEnd,
    StateSnapshotBody: StateSnapshot,
    StepStartedBody: StepStarted,
    StepFinishedBody: StepFinished,
    SubagentStartedBody: SubagentStarted,
    SubagentFinishedBody: SubagentFinished,
    SubagentErrorBody: SubagentError,
    RunFinishedBody: RunFinished,
    RunErrorBody: RunError,
    MastheadBody: Masthead,
    CardBody: Card,
    CardRefusedBody: CardRefused,
    AnswerRetractedBody: AnswerRetracted,
    HeartbeatBody: Heartbeat,
    StageBody: Stage,
    InteractionRequestBody: InteractionRequest,
    InteractionResolvedBody: InteractionResolved,
    RejectedBody: Rejected,
    SteerReceivedBody: SteerReceived,
    SteerAppliedBody: SteerApplied,
    ViewerActionBody: ViewerAction,
}


def stamp(body: EventBody, *, conversation_id: str, turn_id: str, seq: int, ts: int) -> Envelope:
    fields = {name: getattr(body, name) for name in type(body).model_fields}
    return _EVENT_OF_BODY[type(body)](conversation_id=conversation_id, turn_id=turn_id, seq=seq, ts=ts, **fields)


def to_frame(event: Envelope | Hello) -> dict[str, Any]:
    return event.model_dump(mode="json", exclude_defaults=True)


def _legacy_focus_shelf(value: object) -> object:
    return LEGACY_SHELF_VALUES.get(value, value) if isinstance(value, str) else value


class _ClientBase(_Model):
    v: Literal[2] = WIRE_VERSION
    conversation_id: str = Field(min_length=1)


_EDGE_EPSILON = 1e-6


class FocusRegion(_Model):
    page: int = Field(ge=1, description="The page, from 1.")
    x: float = Field(ge=0, le=1, description="Left edge, as a share of the page's width.")
    y: float = Field(ge=0, le=1, description="Top edge, as a share of the page's height.")
    w: float = Field(gt=0, le=1, description="Width, as a share of the page's width; x + w is at most 1.")
    h: float = Field(gt=0, le=1, description="Height, as a share of the page's height; y + h is at most 1.")
    annotation_id: str | None = Field(
        default=None,
        min_length=1,
        max_length=128,
        description="The Anmerkung this box is the region of, when the question was asked in its thread.",
    )

    @model_validator(mode="after")
    def _on_the_page(self) -> FocusRegion:
        if self.x + self.w > 1 + _EDGE_EPSILON or self.y + self.h > 1 + _EDGE_EPSILON:
            raise ValueError("the region reaches past the page: x + w and y + h are at most 1")
        return self


class TurnTrigger(_Model):
    kind: Literal["thread_mention", "thread_reply", "assigned", "agent_consult", "new_document"]
    event_id: str = Field(min_length=1, max_length=128)
    annotation_id: str | None = Field(default=None, min_length=1, max_length=128)


MAX_ANSWER_EXCERPT_CHARS = 2000


class UserMessage(_ClientBase):
    type: Literal["user_message"] = "user_message"
    message_id: str = Field(min_length=1, max_length=128, description="Becomes the turn_id.")
    text: str = Field(min_length=1)
    data_sources: list[str] | None = Field(
        default=None,
        description=(
            "The composer's source selection. Absent means not stated, so every source the "
            "organization allows; an empty list selects none. Headless senders (the MCP ask, "
            "annotation wakes, the document check) leave it out."
        ),
    )
    context_only: Literal[True] | None = None
    author_name: str | None = None
    focus_file_name: str | None = None
    focus_shelf: Annotated[
        Literal["session", "project", "office_shelf"] | None, BeforeValidator(_legacy_focus_shelf)
    ] = None
    source_preset: Literal["law", "project", "office"] | None = None
    focus_document_id: str | None = None
    focus_version_id: str | None = None
    focus_version_state: Literal["draft", "in_review", "changes_requested"] | None = None
    reasoning_effort: Literal["minimal", "low", "medium", "high", "xhigh"] | None = Field(
        default=None,
        description="The composer's Aufwand dial for this turn; absent keeps the platform level.",
    )
    posthog_session_id: str | None = Field(
        default=None,
        max_length=64,
        description=(
            "The browser's PostHog session id (posthog-js `get_session_id()`) when product analytics is on. "
            "Read per turn because the id rotates after 30 idle minutes. Bounded here and checked for the "
            "UUIDv7 shape where it is used (`langfuse_trace_attributes.record_posthog_session`): "
            "a malformed value costs the replay link, never the turn."
        ),
    )
    focus_region: FocusRegion | None = Field(
        default=None,
        description=(
            "A box drawn on a page of the conversation's document: the turn looks at that crop before it "
            "answers. Sent only to a server whose hello accepts 'user_message.focus_region'."
        ),
    )
    reply_in_thread: bool | None = Field(
        default=None,
        description=(
            "Post the answer as the agent's reply in the thread of focus_region.annotation_id, readable by everyone "
            "who can read the document. Ignored without an annotation_id. Sent only to a server whose hello "
            "accepts 'user_message.reply_in_thread'."
        ),
    )
    trigger: TurnTrigger | None = Field(
        default=None,
        description=(
            "The event that woke this turn (a reply or mention in an Anmerkung's thread, an assignment), when "
            "it was not typed. Rendered for the model as who woke it and where to answer. Sent only to a server "
            "whose hello accepts 'user_message.trigger'."
        ),
    )
    if_idle: bool | None = Field(
        default=None,
        description=(
            "Run only if the conversation has no running turn: a running one is never superseded, and the "
            "question is refused with rejected{busy} instead, so the sender can retry later. Sent only to a "
            "server whose hello accepts 'user_message.if_idle'."
        ),
    )
    client_tools: list[Annotated[str, Field(min_length=1, max_length=64)]] | None = Field(
        default=None,
        max_length=16,
        description=(
            "The frontend tools this page can run for this turn, by name (AG-UI's RunAgentInput.tools). A tool "
            "named here is offered to the model for this turn only; a name the server does not know is ignored. "
            "Absent or empty: none, which is what every headless sender gets. Sent only to a server whose hello "
            "accepts 'user_message.client_tools'."
        ),
    )
    answer_excerpt: str | None = Field(
        default=None,
        min_length=1,
        max_length=MAX_ANSWER_EXCERPT_CHARS,
        description=(
            "The part of an earlier answer in this conversation that the person selected and asks this "
            "question about. Rendered for the model as what the question refers to. Sent only to a server "
            "whose hello accepts 'user_message.answer_excerpt'."
        ),
    )


class InteractionResponse(_ClientBase):
    type: Literal["interaction_response"] = "interaction_response"
    turn_id: str = Field(min_length=1)
    interaction_id: str = Field(min_length=1)
    answer: TextAnswer | OptionAnswer


class TextAnswer(_Model):
    text: str = Field(min_length=1)


class OptionAnswer(_Model):
    option_id: str = Field(min_length=1)


class ShownAnswer(_Model):
    seq: int = Field(ge=0, description="The last seq of the turn the client had folded when Stop was pressed.")
    chars: int = Field(ge=0, description="How many characters of that text were on screen, in code points.")


class CancelTurn(_ClientBase):
    type: Literal["cancel_turn"] = "cancel_turn"
    turn_id: str = Field(min_length=1)
    shown: ShownAnswer | None = Field(
        default=None,
        description=(
            "What the asker saw: the stopped answer is cut to it. Sent only to a server whose hello "
            "accepts 'cancel_turn.shown'."
        ),
    )


MAX_STEER_CHARS = 2000


class Steer(_ClientBase):
    type: Literal["steer"] = "steer"
    turn_id: str = Field(min_length=1, description="The running turn (Codex's expectedTurnId).")
    steer_id: str = Field(min_length=1, max_length=128, description="Idempotency key and ack correlation.")
    text: str = Field(min_length=1, max_length=MAX_STEER_CHARS)
    focus_region: FocusRegion | None = Field(
        default=None, description="A box drawn on the canvas while the agent works: what the note is about."
    )


class Attach(_ClientBase):
    type: Literal["attach"] = "attach"
    turn_id: str = Field(min_length=1)
    after_seq: int = Field(ge=0)


ClientMessage = Annotated[
    UserMessage | InteractionResponse | CancelTurn | Attach | Steer,
    Field(discriminator="type"),
]

WIRE_EVENT: TypeAdapter[Any] = TypeAdapter(WireEvent)
CLIENT_MESSAGE: TypeAdapter[Any] = TypeAdapter(ClientMessage)
HELLO: TypeAdapter[Hello] = TypeAdapter(Hello)
