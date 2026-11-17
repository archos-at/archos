"""State models for research agent."""

from typing import Annotated
from typing import Any
from typing import Literal

from langchain_core.messages import AnyMessage
from langgraph.graph.message import add_messages
from pydantic import BaseModel

from agent.common.steering import AppliedSteer
from agent.common.wire_v2 import FocusRegion
from agent.common.wire_v2 import TurnTrigger
from agent.knowledge import AvailableDocument

from ..markers import CONFIDENCE_RULE_VERSION
from ..markers import CappedReason
from ..markers import ConfidenceLevel
from ..markers import answer_ceiling
from ..markers import checked_confidence_capped_reason
from ..markers import surface_checked_confidence


def _checked_level(check: dict[str, Any] | None) -> ConfidenceLevel | None:
    """The level a judged answer check gave; None when it was unavailable or never ran."""
    return check.get("level") if check and check.get("status") == "judged" else None


ObservedRouting = Literal["meta", "shallow"]


class ResearchAgentState(BaseModel):
    """
    State for research agent subgraph.

    Attributes:
        messages: Conversation history with LangGraph message reducer.
        data_sources: List of data sources selected by the user.
        user_info: Optional user information.
        tools_info: Information about available tools.
        available_documents: User-uploaded documents with summaries for context.
        focus_file_name: Filename of the composer's "Asking about <file>" subject.
        focus_shelf: Shelf that focused file sits on (session/project/office_shelf).
        collection_name: Knowledge collection name (for fetching documents).
        tool_iterations: Counter for tool-calling ROUNDS (the research budget).
        source_lookup_attempted: Whether the turn called a data-source tool at
            all. Set by ``run()``. With the self-assessment it is what the chat
            node reads the observed routing from: neither → a direct reply.
        answer_citation_grounded: Whether the final answer carries at least one
            verified citation after citation verification. Set by ``run()`` — it
            is True only when verification kept a valid citation the model
            wrote, and False when the registry was empty or no citation held.
            Rule 1 of the overconfidence guard (a state without claim stamps)
            reads it as the only route to "high"; rule 2 reads the stamps.
            Defaults to False (conservative).
    """

    messages: Annotated[list[AnyMessage], add_messages]
    data_sources: list[str] | None = None
    user_info: dict[str, Any] | None = None
    tools_info: list[dict[str, Any]] | None = None
    available_documents: list[AvailableDocument] | None = None
    in_flight_documents: list[str] | None = None
    deep_research_allowed: bool = True
    tasks_allowed: bool = True
    licensed_text_allowed: bool = False
    confined: bool = False
    answer_is_handoff: bool = False
    collection_name: str | None = None
    tool_iterations: int = 0
    retrieval_round: int = 0
    retrieval_rounds: list[dict[str, Any]] = []
    executed_fetches: list[str] = []
    fetch_results: dict[str, str] = {}
    project_context: str | None = None
    platform_lessons: str | None = None
    org_instructions: str | None = None
    reference_projects: str | None = None
    workspace_block: str | None = None
    focus_file_name: str | None = None
    focus_shelf: str | None = None
    focus_region: FocusRegion | None = None
    reply_in_thread: bool = False
    trigger: TurnTrigger | None = None
    steering: list[AppliedSteer] = []
    source_lookup_attempted: bool = False
    answer_citation_grounded: bool = False
    answer_quotes_verified: bool = True
    answer_law_unsettled: bool = False
    answer_open_points: list[str] = []
    answer_measurement_grounded: bool = False
    confidence_check: dict[str, Any] | None = None
    answer_lookup_found_nothing: bool = False
    escalation_requested: bool | None = None
    answer_confidence_marker: Literal["low", "medium", "high"] | None = None
    answer_confidence_marker_reason: str | None = None
    answer_escalation_reason: str | None = None
    answer_meta: dict[str, Any] | None = None
    verified_sources: list[dict[str, Any]] | None = None
    read_sources: list[dict[str, Any]] | None = None
    already_read_digest: list[str] | None = None
    retrieval_ledger: list[dict[str, Any]] | None = None
    quote_stamps: list[dict[str, Any]] | None = None
    skills_block: str | None = None
    card_shapes_block: str | None = None
    skills_activated: list[str] | None = None
    skills_applied: list[str] | None = None
    skills_hidden: list[str] | None = None
    reasoning_effort: str | None = None
    research_truncated: bool | None = None
    citations_removed: dict[str, Any] | None = None
    cached_system_prompt: str | None = None
    cached_turn_context: str | None = None
    cached_conversation_context: str | None = None

    @property
    def observed_routing(self) -> ObservedRouting:
        """What kind of turn this was, read off what the turn did.

        Nothing classifies a turn up front (ADR-0052); the model has every tool
        on every turn and picks the reply's shape itself. Two facts of the
        finished answer say which shape it picked: whether it consulted a data
        source, and whether it graded itself (a direct reply — a greeting, a
        shelf listing, an off-topic decline, "what can you do" — carries no
        confidence marker, because there is nothing to grade). Neither →
        ``meta``, the transparency surface's word for a direct reply. Either →
        ``shallow``: a researched answer, or at least one the model presented
        as one.
        """
        if not self.source_lookup_attempted and self.answer_confidence_marker is None:
            return "meta"
        return "shallow"

    @property
    def answer_confidence_version(self) -> int | None:
        """Which rule computed :attr:`answer_confidence`; None when nothing is surfaced.

        A checked answer travels as :data:`CONFIDENCE_RULE_VERSION` (2): an open
        tab reads the field as ``1 | 2``, and ``confidence_check`` tells the
        check apart from a stored per-sentence turn.
        """
        return CONFIDENCE_RULE_VERSION if self.answer_confidence is not None else None

    @property
    def answer_confidence(self) -> ConfidenceLevel | None:
        """The answer check's level under the gates (ADR-0139); None when no check graded the answer.

        The self-report ``answer_confidence_marker`` says the answer is one to
        grade and is a ceiling: the check may lower it, never raise it. An open
        point the check read in the answer holds it to medium.
        """
        return surface_checked_confidence(
            _checked_level(self.confidence_check),
            quotes_verified=self.answer_quotes_verified,
            citation_grounded=self.answer_citation_grounded,
            law_unsettled=self.answer_law_unsettled,
            ceiling=answer_ceiling(self.answer_open_points, self.answer_confidence_marker),
        )

    @property
    def answer_confidence_capped_reason(self) -> CappedReason | None:
        """``quote_unverified``, ``law_unsettled`` or ``open_point`` when a gate lowered the checked level."""
        return checked_confidence_capped_reason(
            _checked_level(self.confidence_check),
            quotes_verified=self.answer_quotes_verified,
            citation_grounded=self.answer_citation_grounded,
            law_unsettled=self.answer_law_unsettled,
            ceiling=answer_ceiling(self.answer_open_points, self.answer_confidence_marker),
        )
