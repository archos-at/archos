"""The state of one conversation with Piloti.

This is the CONVERSATION-scoped state — the one the checkpointer persists
between turns — as distinct from :class:`ResearchAgentState`, which is
one research turn's own working state and is never checkpointed.

NOTE: any new pydantic state type added below (or nested inside these fields)
MUST also be added to the checkpointer allow-list in
``agent/common/__init__.py`` (``_build_checkpointer_serde``). The
checkpointer deserializes with a STRICT msgpack allow-list; a type missing from
that list will break checkpoint restore for states that contain it.
"""

from typing import Annotated
from typing import Any
from typing import Literal

from langchain_core.messages import AnyMessage
from langgraph.graph.message import add_messages
from pydantic import BaseModel

from agent.common.plan_documents import PlanDocuments
from agent.common.wire_v2 import FocusRegion
from agent.common.wire_v2 import TurnTrigger
from agent.knowledge import AvailableDocument

RoutingDecision = Literal["meta", "shallow", "deep", "error"]


class ConversationState(BaseModel):
    """
    State for the conversation graph: one answering agent, one escalation path.

    Attributes:
        messages: Conversation history with LangGraph message reducer.
        user_info: Optional user information for personalization.
        data_sources: Optional list of user-selected data source IDs.
        escalate_to_deep: Whether this turn's answering agent asked for deep
            research (ADR-0052: the ask is the agent's own, made in its answer
            envelope, and this is the one bit the escalation edge reads).
        clarifier_result: Log from clarifier agent dialog.
        original_query: The latest user query, preserved for deep research.
        available_documents: User-uploaded documents with summaries for context.
        in_flight_documents: Filenames whose ingestion has not finished, so they
            are absent from ``available_documents`` AND unreachable by retrieval.
            The distinction matters: without it a just-attached plan looks
            exactly like a file that does not exist, and the answer omits it
            silently instead of saying it could not be read yet.
        focus_file_name: Filename of the composer's "Asking about <file>" subject.
        focus_shelf: Shelf that focused file sits on (session/project/office_shelf).
        skip_clarifier: When True the clarifier node is bypassed regardless of
            ``enable_clarifier``.  Set automatically for API-key and anonymous
            callers so headless workflows do not stall waiting for user input.
        deep_research_declined: Sticky per-conversation flag set when the user
            rejects or cancels a research plan; suppresses the deep route
            thereafter.
        deep_research_allowed: Whether the tenant may be offered a deep-research
            run at all (the `deep-research` flag, resolved per turn). False
            withdraws the hand-off before it is proposed.
        licensed_text_allowed: Whether licensed text may reach the model inside
            the call (the `licensed-seam` flag, resolved per turn).
        tasks_allowed: Whether the tenant may have work handed over via
            `create_task` (the `task-automation` flag, resolved per turn).
        confined: Whether this turn's signed scope holds a restricted folder's
            collection (ADR-0087), which withdraws both of the above.
    """

    messages: Annotated[list[AnyMessage], add_messages]
    user_info: dict[str, Any] | None = None
    data_sources: list[str] | None = None
    escalate_to_deep: bool | None = None
    escalation_ask_reason: str | None = None
    clarifier_result: str | None = None
    plan_documents: PlanDocuments | None = None
    original_query: str | None = None
    available_documents: list[AvailableDocument] | None = None
    in_flight_documents: list[str] | None = None
    collection_scope: list[str] | None = None
    focus_file_name: str | None = None
    focus_shelf: str | None = None
    focus_region: FocusRegion | None = None
    reply_in_thread: bool = False
    trigger: TurnTrigger | None = None
    skip_clarifier: bool = False
    deep_research_declined: bool | None = None
    deep_research_allowed: bool = True
    tasks_allowed: bool = True
    licensed_text_allowed: bool = False
    confined: bool = False
    project_context: str | None = None
    platform_lessons: str | None = None
    org_instructions: str | None = None
    reference_projects: str | None = None
    workspace_block: str | None = None
    run_id: str | None = None
    run_message_id: str | None = None
    answer_confidence: Literal["low", "medium", "high"] | None = None
    verified_sources: list[dict[str, Any]] | None = None
    read_sources: list[dict[str, Any]] | None = None
    already_read_digest: list[str] | None = None
    retrieval_ledger: list[dict[str, Any]] | None = None
    quote_stamps: list[dict[str, Any]] | None = None
    confidence_check: dict[str, Any] | None = None
    answer_confidence_version: int | None = None
    lookup_found_nothing: bool = False
    reasoning_effort: str | None = None
    routing_decision: RoutingDecision | None = None
    escalation_reason: str | None = None
    answer_confidence_capped_reason: (
        Literal[
            "ungrounded",
            "quote_unverified",
            "law_unsettled",
            "open_point",
            "normative_claim_uncited",
            "measurement_only",
            "citation_fallback",
        ]
        | None
    ) = None
    answer_confidence_reason: str | None = None
    citations_removed: dict[str, Any] | None = None
    answer_meta: dict[str, Any] | None = None
    research_truncated: bool | None = None
    job_admission_rejected: bool | None = None
    retry_after_seconds: int | None = None
    skills_activated: list[str] | None = None
    skills_hidden: list[str] | None = None
