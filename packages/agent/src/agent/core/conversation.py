import contextlib
import logging
from collections.abc import AsyncIterator
from collections.abc import Awaitable
from collections.abc import Callable
from collections.abc import Sequence
from typing import Any

from langchain_core.messages import AIMessage
from langchain_core.messages import BaseMessage
from langchain_core.messages import HumanMessage
from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.graph import END
from langgraph.graph import StateGraph
from langgraph.graph.state import CompiledStateGraph
from langgraph.types import Command

from agent.agents.deep_researcher.models import DeepResearchAgentState
from agent.auth.errors import AuthError
from agent.citations.entries import EmptySourceRegistryError
from agent.common import get_latest_user_query
from agent.common.action_rows import ToolStepCallback
from agent.common.canned_replies import GENERIC_ERROR_MESSAGE
from agent.common.canned_replies import ZDR_MODEL_REFUSED_MESSAGE
from agent.common.job_admission import JobAdmissionError
from agent.common.openrouter import is_data_policy_refusal
from agent.common.plan_documents import PlanDocuments
from agent.common.platform_lessons import render_lessons_block
from agent.common.profiler import profiled_node
from agent.common.retrieval_status import emit_escalation
from agent.common.tool_validation import format_no_sources_message
from agent.common.wire_v2 import EventBody
from agent.knowledge.inventory import set_listing_shelf
from agent.knowledge.inventory import shelf_hint_from_query
from agent.observability.turn_phases import observed_phase
from agent.turn.commission import CommissionedRun
from agent.turn.commission import CommissionRefused

from .clarify import ClarifyFn
from .history import compact_tool_results
from .history import history_window
from .markers import detect_and_strip_confidence_marker
from .markers import detect_and_strip_escalation_marker
from .models import ClarifyRequest
from .models import ConversationState
from .models import ResearchAgentState

logger = logging.getLogger(__name__)

PLAN_CANCELLED_MESSAGE = (
    "In Ordnung, ich habe die geplante Recherche verworfen. "
    "Wenn Sie doch eine Antwort möchten, stellen Sie Ihre Frage einfach erneut – "
    "ich beantworte sie dann direkt, ohne einen neuen Rechercheplan vorzuschlagen."
)
"""The receipt for an explicit plan cancellation.

German because the product is German-first and this string reaches the user
verbatim (there is no UI envelope to localize it, unlike the plan preview).
It must say two things: that nothing is being researched — the turn really is
over, by the user's own choice, not by a failure — and how to get an answer
after all. The second half is literally true: the cancellation sets
``deep_research_declined`` on the conversation, so re-asking the question
routes straight to the agent instead of producing plan number two.
"""

LEGACY_ESCALATION_REASON = "Shallow agent emitted insufficiency marker"

DEEP_RESEARCH_UNAVAILABLE_NOTE = (
    "Hinweis: Eine Tiefenrecherche steht in diesem Arbeitsbereich derzeit nicht zur Verfügung. "
    "Ich habe die Frage direkt beantwortet, so weit die vorliegenden Quellen tragen. "
    "Grenzen Sie die Frage gern enger ein, dann komme ich näher heran."
)
"""Appended when the agent asks to escalate and the tenant has no deep research.

German for the same reason as :data:`PLAN_CANCELLED_MESSAGE`: it reaches the
reader verbatim. It exists because the ask and the ANSWER are one message. A
turn that asks to escalate writes either a partial answer (the insufficiency
case) or a single sentence naming what it will research (the commissioned
case), and suppressing the route silently would leave the second one as a
promise nothing keeps. The prompt already tells the model the capability is
absent, so this is the line for the turn where it asked anyway — not the
normal path.
"""

CONFINED_DEEP_RESEARCH_NOTE = (
    "Hinweis: Aus dieser Unterhaltung lässt sich keine Tiefenrecherche starten, weil sie auf einen Ordner "
    "mit eingeschränktem Zugriff zugreift: Recherche, Titel und Bericht wären für alle im Projekt sichtbar, "
    "auch für Personen, die für diesen Ordner nicht freigegeben sind. Ich habe die Frage direkt beantwortet, "
    "so weit die vorliegenden Quellen tragen."
)
"""The same line for a turn whose scope holds a restricted folder's collection
(ADR-0087): the capability is there, this conversation may not use it, and the
reader is told why rather than that the workspace lacks it."""

CONVERSATION_SCOPED_FIELDS: frozenset[str] = frozenset({"messages", "deep_research_declined", "already_read_digest"})
TURN_SCOPED_FIELDS: frozenset[str] = frozenset(ConversationState.model_fields) - CONVERSATION_SCOPED_FIELDS

ANSWER_LIFTS: tuple[tuple[str, str], ...] = (
    ("observed_routing", "routing_decision"),
    ("answer_confidence", "answer_confidence"),
    ("answer_confidence_marker_reason", "answer_confidence_reason"),
    ("answer_confidence_capped_reason", "answer_confidence_capped_reason"),
    ("verified_sources", "verified_sources"),
    ("read_sources", "read_sources"),
    ("already_read_digest", "already_read_digest"),
    ("citations_removed", "citations_removed"),
    ("skills_activated", "skills_activated"),
    ("skills_hidden", "skills_hidden"),
    ("answer_meta", "answer_meta"),
    ("retrieval_ledger", "retrieval_ledger"),
    ("quote_stamps", "quote_stamps"),
    ("confidence_check", "confidence_check"),
    ("answer_confidence_version", "answer_confidence_version"),
    ("answer_lookup_found_nothing", "lookup_found_nothing"),
    ("reasoning_effort", "reasoning_effort"),
)


def _error_update(message: str) -> dict[str, Any]:
    return {
        "messages": [AIMessage(content=message)],
        "routing_decision": "error",
        "escalate_to_deep": False,
    }


def _no_sources_message(research_type: str, exc: EmptySourceRegistryError) -> str:
    return format_no_sources_message(research_type, exc.unavailable_tools, exc.available_count)


def _escalation_update(message: BaseMessage, result: ResearchAgentState) -> dict[str, Any]:
    return {
        "messages": [message],
        "escalate_to_deep": True,
        "escalation_ask_reason": result.answer_escalation_reason or LEGACY_ESCALATION_REASON,
        "verified_sources": result.verified_sources,
        **({"already_read_digest": list(result.already_read_digest)} if result.already_read_digest else {}),
    }


def _answer_update(
    message: BaseMessage, result: ResearchAgentState, turn_messages: Sequence[BaseMessage] = ()
) -> dict[str, Any]:
    update: dict[str, Any] = {field: getattr(result, source) for source, field in ANSWER_LIFTS}
    cited = {
        str(source.get("citation_key"))
        for source in (result.verified_sources or [])
        if isinstance(source, dict) and source.get("citation_key")
    }
    kept = compact_tool_results([m for m in turn_messages if m is not message], cited)
    update["messages"] = [*kept, message]
    update["escalate_to_deep"] = False
    update["research_truncated"] = True if result.research_truncated else None
    return update


def _stripped(content: str) -> str:
    without_escalation, _ = detect_and_strip_escalation_marker(content)
    clean, _, _ = detect_and_strip_confidence_marker(without_escalation)
    return clean


def _finalize_answer(
    message: BaseMessage,
    result: ResearchAgentState,
    *,
    deep_research_allowed: bool = True,
    turn_messages: Sequence[BaseMessage] = (),
    confined: bool = False,
) -> dict[str, Any]:
    content = message.content
    if not isinstance(content, str):
        return {"messages": [message]}
    clean_content = _stripped(content)
    escalating = bool(result.escalation_requested)
    if escalating and not deep_research_allowed:
        logger.info("Escalation refused: deep research is not enabled for this tenant")
        escalating = False
        handoff_only = result.answer_is_handoff or not clean_content.strip()
        note = CONFINED_DEEP_RESEARCH_NOTE if confined else DEEP_RESEARCH_UNAVAILABLE_NOTE
        clean_content = note if handoff_only else f"{clean_content.rstrip()}\n\n{note}"
    if not clean_content.strip() and not escalating:
        logger.error("Research produced an empty answer")
        return _error_update(GENERIC_ERROR_MESSAGE)
    updated = message.model_copy(update={"content": clean_content}) if clean_content != content else message
    if escalating:
        return _escalation_update(updated, result)
    return _answer_update(updated, result, [m for m in turn_messages if m is not message])


def _answer_only(text: str) -> dict[str, Any]:
    return {
        "messages": [AIMessage(content=text)],
        "routing_decision": "meta",
        "escalate_to_deep": False,
    }


def _answer_message(new_messages: list[BaseMessage]) -> BaseMessage | None:
    final = next((m for m in reversed(new_messages) if isinstance(m, AIMessage) and not m.tool_calls), None)
    if final is not None:
        return final
    return new_messages[-1] if new_messages else None


def _deep_handoff(
    original_query: str | None,
    escalation_reason: str | None,
    clarifier_result: str | None = None,
    *,
    data_sources: list[str] | None = None,
    plan_documents: PlanDocuments | None = None,
) -> Command:
    update: dict[str, Any] = {
        "original_query": original_query,
        "escalation_reason": escalation_reason,
        "routing_decision": "deep",
    }
    if clarifier_result is not None:
        update["clarifier_result"] = clarifier_result
    if data_sources is not None:
        update["data_sources"] = data_sources
    if plan_documents is not None:
        update["plan_documents"] = plan_documents
    return Command(goto="deep_research", update=update)


def _plan_cancelled(original_query: str | None) -> Command:
    logger.info("Conversation: Plan cancelled by user, ending the turn with a receipt")
    return Command(
        goto=END,
        update={
            "messages": [AIMessage(content=PLAN_CANCELLED_MESSAGE)],
            "original_query": original_query,
            "deep_research_declined": True,
            "routing_decision": "meta",
            "escalation_reason": None,
            "escalate_to_deep": False,
        },
    )


def _plan_rejected(original_query: str | None) -> Command:
    logger.info("Conversation: Plan rejected by user, answering on the shallow path instead")
    return Command(
        goto="shallow_research",
        update={
            "original_query": original_query,
            "deep_research_declined": True,
            "escalation_reason": None,
            "escalate_to_deep": False,
        },
    )


class ConversationGraph:
    def __init__(
        self,
        research_fn: Callable[[ResearchAgentState], Awaitable[ResearchAgentState]],
        deep_research_fn: Callable[[DeepResearchAgentState], Awaitable[DeepResearchAgentState]],
        clarifier_fn: ClarifyFn | None,
        *,
        max_history_tokens: int = 40000,
        commission_run_fn: Callable[[ConversationState], Awaitable[CommissionedRun]] | None = None,
        checkpointer: BaseCheckpointSaver | None = None,
        validate_deep_research_tools_fn: Callable[[list[str] | None], tuple[bool, str]] | None = None,
    ) -> None:
        self.research_fn = research_fn
        self.deep_research_fn = deep_research_fn
        self.clarifier_fn = clarifier_fn
        self.max_history_tokens = max_history_tokens
        self.commission_run_fn = commission_run_fn
        self.checkpointer = checkpointer
        self.validate_deep_research_tools_fn = validate_deep_research_tools_fn
        self._graph = self._build_graph()

    def _trimmed(self, state: ConversationState) -> list[BaseMessage]:
        return history_window(state.messages, self.max_history_tokens)

    async def _clarifier_node(self, state: ConversationState) -> Command:
        original_query = get_latest_user_query(state.messages)
        escalation_reason = state.escalation_ask_reason
        if self.validate_deep_research_tools_fn:
            is_valid, error_msg = self.validate_deep_research_tools_fn(state.data_sources)
            if not is_valid:
                logger.error("Deep research tools validation failed: %s", error_msg)
                return Command(
                    goto=END, update={"messages": [AIMessage(content=error_msg)], "original_query": original_query}
                )
        if state.skip_clarifier or self.clarifier_fn is None:
            return _deep_handoff(original_query, escalation_reason)
        available_docs = [doc.model_dump() for doc in (state.available_documents or [])]
        result = await self.clarifier_fn(
            ClarifyRequest(
                messages=self._trimmed(state),
                data_sources=state.data_sources,
                available_documents=available_docs or None,
                project_context=state.project_context,
            )
        )
        if result.outcome == "cancelled":
            return _plan_cancelled(original_query)
        if result.outcome == "shallow":
            return _plan_rejected(original_query)
        return _deep_handoff(
            original_query,
            escalation_reason,
            result.research_context,
            data_sources=result.data_sources,
            plan_documents=result.documents,
        )

    def _research_input(self, state: ConversationState, trimmed: list[BaseMessage]) -> ResearchAgentState:
        return ResearchAgentState(
            messages=trimmed,
            data_sources=state.data_sources,
            user_info=state.user_info,
            available_documents=state.available_documents,
            in_flight_documents=state.in_flight_documents,
            already_read_digest=list(state.already_read_digest) if state.already_read_digest else None,
            project_context=state.project_context,
            platform_lessons=state.platform_lessons,
            org_instructions=state.org_instructions,
            reference_projects=state.reference_projects,
            workspace_block=state.workspace_block,
            focus_file_name=state.focus_file_name,
            focus_shelf=state.focus_shelf,
            focus_region=state.focus_region,
            reply_in_thread=state.reply_in_thread,
            trigger=state.trigger,
            answer_excerpt=state.answer_excerpt,
            deep_research_allowed=state.deep_research_allowed,
            tasks_allowed=state.tasks_allowed,
            licensed_text_allowed=state.licensed_text_allowed,
            confined=state.confined,
        )

    async def _run_research(self, research_state: ResearchAgentState) -> ResearchAgentState | dict[str, Any]:
        try:
            return await self.research_fn(research_state)
        except EmptySourceRegistryError as exc:
            logger.warning("Research produced no verifiable sources")
            return _error_update(_no_sources_message("research", exc))
        except AuthError as exc:
            logger.warning("Auth error in research: %s", exc)
            return _error_update(str(exc))
        except Exception as exc:  # noqa: BLE001 - the turn answers with an error rather than dying
            if is_data_policy_refusal(exc):
                logger.warning("Research refused by the provider's data policy: %s", exc)
                return _error_update(ZDR_MODEL_REFUSED_MESSAGE)
            logger.exception("Error in research: %s", exc)
            return _error_update(GENERIC_ERROR_MESSAGE)

    async def _research_node(self, state: ConversationState) -> dict[str, Any]:
        with observed_phase("history.trim", messages=len(state.messages)) as trim:
            trimmed = self._trimmed(state)
            trim["kept"] = len(trimmed)
        logger.debug("research_node: available_documents = %s", state.available_documents)
        set_listing_shelf(shelf_hint_from_query(get_latest_user_query(state.messages) or ""))
        result = await self._run_research(self._research_input(state, trimmed))
        if isinstance(result, dict):
            return result
        if not result.messages:
            logger.error("The agent returned no messages")
            return _error_update(GENERIC_ERROR_MESSAGE)
        new_messages = result.messages[len(trimmed) :]
        message = _answer_message(new_messages)
        if message is None:
            return {"messages": []}
        update = _finalize_answer(
            message,
            result,
            deep_research_allowed=state.deep_research_allowed,
            turn_messages=new_messages,
            confined=state.confined,
        )
        if isinstance(result, ResearchAgentState) and not update.get("already_read_digest"):
            if state.already_read_digest:
                update["already_read_digest"] = list(state.already_read_digest)
        return update

    async def _commission_run(self, state: ConversationState) -> dict[str, Any]:
        assert self.commission_run_fn is not None
        try:
            run = await self.commission_run_fn(state)
        except JobAdmissionError as exc:
            logger.info("Research run refused by admission control: %s", exc)
            return {
                "messages": [AIMessage(content=str(exc))],
                "job_admission_rejected": True,
                "retry_after_seconds": exc.retry_after_seconds,
            }
        except CommissionRefused as refusal:
            if refusal.reason == "busy":
                logger.info("Research run refused by admission control: %s", refusal)
                return {
                    "messages": [AIMessage(content=str(refusal))],
                    "job_admission_rejected": True,
                    "retry_after_seconds": refusal.retry_after_seconds,
                }
            if refusal.reason == "confined":
                logger.info("Research run refused: the conversation drew on a restricted folder")
                return _answer_only(CONFINED_DEEP_RESEARCH_NOTE)
            if refusal.reason == "forbidden":
                logger.info("Research run refused as a capability the tenant does not have: %s", refusal)
                return _answer_only(DEEP_RESEARCH_UNAVAILABLE_NOTE)
            logger.info("Question could not be commissioned as a run (%s); researching in process", refusal.reason)
            return await self._run_deep_inline(state)
        return {
            "messages": [AIMessage(content="")],
            "run_id": run.run_id,
            "run_message_id": run.run_message_id,
        }

    async def _run_deep_inline(self, state: ConversationState) -> dict[str, Any]:
        research_query = state.original_query or get_latest_user_query(state.messages)
        deep_state = DeepResearchAgentState(
            messages=self._trimmed(state) + [HumanMessage(content=research_query)],
            data_sources=state.data_sources,
            clarifier_result=state.clarifier_result,
            plan_documents=state.plan_documents,
            available_documents=state.available_documents,
            user_info=state.user_info,
            project_context=state.project_context,
            platform_lessons=render_lessons_block(state.platform_lessons),
        )
        try:
            result = await self.deep_research_fn(deep_state)
        except EmptySourceRegistryError as exc:
            logger.warning("Deep research produced no verifiable sources")
            return {"messages": [AIMessage(content=_no_sources_message("deep research", exc))]}
        except AuthError as exc:
            logger.warning("Auth error in deep research: %s", exc)
            return {"messages": [AIMessage(content=str(exc))]}
        if not result.messages:
            logger.error("An error occurred during deep research.")
            return {"messages": [AIMessage(content="An error occurred during deep research.")]}
        update: dict[str, Any] = {"messages": [result.messages[-1]]}
        if result.citations_removed:
            update["citations_removed"] = result.citations_removed
        return update

    async def _deep_research_node(self, state: ConversationState) -> dict[str, Any]:
        if self.commission_run_fn is not None:
            return await self._commission_run(state)
        return await self._run_deep_inline(state)

    @staticmethod
    def _should_escalate(state: ConversationState) -> str:
        if not state.deep_research_allowed:
            logger.info("Escalation suppressed: deep research is not enabled for this tenant")
            return "END"
        if state.deep_research_declined:
            logger.info("Escalation suppressed: the user rejected a research plan in this conversation")
            return "END"
        if not state.escalate_to_deep:
            return "END"
        try:
            emit_escalation(state.escalation_ask_reason)
        except Exception:  # noqa: BLE001 - a status line is never worth the answer
            logger.warning("Escalation notice failed to emit; routing to deep research anyway", exc_info=True)
        return "deep_research"

    def _build_graph(self) -> CompiledStateGraph:
        graph = StateGraph(ConversationState)
        graph.add_node("shallow_research", profiled_node("shallow_research", self._research_node))
        graph.add_node("clarifier", profiled_node("clarifier", self._clarifier_node))
        graph.add_node("deep_research", profiled_node("deep_research", self._deep_research_node))
        graph.set_entry_point("shallow_research")
        graph.add_conditional_edges(
            "shallow_research", self._should_escalate, {"deep_research": "clarifier", "END": END}
        )
        graph.add_edge("deep_research", END)
        return graph.compile(checkpointer=self.checkpointer)

    async def _merged_digest(self, graph_config: RunnableConfig, state: ConversationState) -> list[str] | None:
        caller = list(state.already_read_digest or [])
        checkpoint: list[str] = []
        try:
            snapshot = await self._graph.aget_state(graph_config)
            values = getattr(snapshot, "values", None) or {}
            checkpoint = [line for line in (values.get("already_read_digest") or []) if isinstance(line, str)]
        except Exception:  # noqa: BLE001 - no checkpointer (or an empty thread) reads as no lines
            checkpoint = []
        if not checkpoint and not caller:
            return None
        return list(dict.fromkeys([*checkpoint, *caller]))

    async def stream(
        self, state: ConversationState, thread_id: str | None = None
    ) -> AsyncIterator[EventBody | ConversationState]:
        graph_config: RunnableConfig = {"configurable": {"thread_id": thread_id}}
        logger.info("Conversation: Starting turn")
        input_state = {name: getattr(state, name) for name in TURN_SCOPED_FIELDS}
        input_state["messages"] = state.messages
        with observed_phase("setup.checkpoint_digest"):
            merged_digest = await self._merged_digest(graph_config, state)
        if merged_digest is not None:
            input_state["already_read_digest"] = merged_digest
        if state.messages:
            logger.info("Query: %s...", str(state.messages[-1].content)[:100])
        run_config: RunnableConfig = {**graph_config, "callbacks": [ToolStepCallback()]}
        final: dict[str, Any] | None = None
        run = self._graph.astream(input_state, config=run_config, stream_mode=["custom", "values"], subgraphs=True)
        async with contextlib.aclosing(run) as chunks:
            async for namespace, mode, chunk in chunks:
                if mode == "custom":
                    yield chunk
                elif not namespace:
                    final = chunk
        logger.info("Conversation: Turn complete")
        yield ConversationState.model_validate(final)

    async def append_context_message(self, thread_id: str, text: str) -> None:
        if not thread_id or not text:
            return
        graph_config: RunnableConfig = {"configurable": {"thread_id": thread_id}}
        await self._graph.aupdate_state(graph_config, {"messages": [HumanMessage(content=text)]})
        logger.info("Conversation: ingested %d chars of context (thread %s)", len(text), thread_id)

    @property
    def graph(self) -> CompiledStateGraph:
        return self._graph
