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
    answer_excerpt: str | None = None
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
