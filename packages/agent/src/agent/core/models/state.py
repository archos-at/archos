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
    return check.get("level") if check and check.get("status") == "judged" else None


ObservedRouting = Literal["meta", "shallow"]


class ResearchAgentState(BaseModel):
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
    answer_excerpt: str | None = None
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
        if not self.source_lookup_attempted and self.answer_confidence_marker is None:
            return "meta"
        return "shallow"

    @property
    def answer_confidence_version(self) -> int | None:
        return CONFIDENCE_RULE_VERSION if self.answer_confidence is not None else None

    @property
    def answer_confidence(self) -> ConfidenceLevel | None:
        return surface_checked_confidence(
            _checked_level(self.confidence_check),
            quotes_verified=self.answer_quotes_verified,
            citation_grounded=self.answer_citation_grounded,
            law_unsettled=self.answer_law_unsettled,
            ceiling=answer_ceiling(self.answer_open_points, self.answer_confidence_marker),
        )

    @property
    def answer_confidence_capped_reason(self) -> CappedReason | None:
        return checked_confidence_capped_reason(
            _checked_level(self.confidence_check),
            quotes_verified=self.answer_quotes_verified,
            citation_grounded=self.answer_citation_grounded,
            law_unsettled=self.answer_law_unsettled,
            ceiling=answer_ceiling(self.answer_open_points, self.answer_confidence_marker),
        )
