from typing import Annotated
from typing import Any
from typing import Literal

from langchain_core.messages import AnyMessage
from langgraph.graph.message import add_messages
from pydantic import BaseModel
from pydantic import Field

from agent.common.message_utils import content_to_text
from agent.common.plan_documents import PlanDocuments
from agent.knowledge import AvailableDocument


def _merge_dict_state(left: dict[str, Any] | None, right: dict[str, Any] | None) -> dict[str, Any]:
    if not left:
        return right or {}
    if not right:
        return left
    merged = dict(left)
    merged.update(right)
    return merged


class DeepResearchAgentState(BaseModel):
    messages: Annotated[list[AnyMessage], add_messages]
    data_sources: list[str] | None = None
    user_info: dict[str, Any] | None = None
    todos: list[dict[str, Any]] = Field(default_factory=list)
    files: Annotated[dict[str, Any], _merge_dict_state] = Field(default_factory=dict)
    clarifier_result: str | None = None
    plan_documents: PlanDocuments | None = None
    basis_unread: list[str] | None = None
    available_documents: list[AvailableDocument] | None = None
    project_context: str | None = None
    platform_lessons: str | None = None
    citations_removed: dict[str, Any] | None = None
    research_truncated: bool | None = None
    truncation_reason: str | None = None
    degraded_reasons: list[str] | None = None
    organization_id: str | None = None
    verified_sources: list[dict[str, Any]] | None = None
    retrieval_ledger: list[dict[str, Any]] | None = None
    skills_activated: list[str] | None = None
    answer_confidence: Literal["low", "medium", "high"] | None = None
    answer_confidence_reason: str | None = None
    answer_confidence_capped_reason: (
        Literal[
            "ungrounded",
            "quote_unverified",
            "normative_claim_uncited",
            "measurement_only",
            "citation_fallback",
        ]
        | None
    ) = None
    skills_hidden: list[str] | None = None


def last_message_text(result: Any) -> str | None:
    messages = result.get("messages") if isinstance(result, dict) else getattr(result, "messages", None)
    if not messages:
        return None
    return content_to_text(getattr(messages[-1], "content", None)).strip() or None
