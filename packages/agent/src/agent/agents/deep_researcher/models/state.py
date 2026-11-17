"""State models for deep research agent."""

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
    """
    State for deep research agent.

    The deepagents-based DeepResearcherAgent manages its own internal state
    through the deepagents library. This state primarily handles the interface
    with the orchestrator.

    Attributes:
        messages: Conversation history with LangGraph message reducer.
        data_sources: List of data sources selected by the user.
        user_info: Optional user information.
        todos: Todo list managed by TodoListMiddleware.
        files: Virtual filesystem managed by FilesystemMiddleware.
        clarifier_result: Log from clarifier agent dialog.
        available_documents: User-uploaded documents with summaries for context.
    """

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
    """The final message's text from a graph state (dict or object), or None when blank.

    The writer normally persists its report to ``/shared/output.md``; this is
    the fallback when it did not, and the researcher's fallback when a worker
    put its notes in prose instead of the structured channel. Structured block
    content is joined as text rather than repr'd.
    """
    messages = result.get("messages") if isinstance(result, dict) else getattr(result, "messages", None)
    if not messages:
        return None
    return content_to_text(getattr(messages[-1], "content", None)).strip() or None
