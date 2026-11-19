from __future__ import annotations

import json
import logging
from typing import TYPE_CHECKING
from typing import Any

from langchain_core.messages import HumanMessage
from langchain_core.messages import SystemMessage
from pydantic import ValidationError

from agent.common import get_latest_user_query
from agent.common import render_prompt_template
from agent.common.plan_documents import MAX_PLAN_DOCUMENTS
from agent.common.plan_documents import PlanDocuments
from agent.common.plan_documents import documents_from_plan
from agent.common.plan_vocabulary import modernize_plan
from agent.project_context import get_organization_id_from_context

from .clarify_dialog import parse_json_response
from .clarify_prompts import PLAN_GENERATION_PROMPT
from .models.clarify import ClarifyRequest
from .models.clarify import ClarifyResult
from .models.clarify import PlanDecision
from .models.clarify import PlanOutcome
from .models.clarify import PlanResponse
from .plan_decisions import PlanShape
from .plan_decisions import decide_plan_shape

if TYPE_CHECKING:
    from .clarify import ClarifyDeps

logger = logging.getLogger(__name__)

PLAN_REPLIES: dict[str, PlanDecision] = {
    "approve": "approved",
    "shallow": "shallow",
    "cancel": "cancelled",
    "no": "shallow",
    "nein": "shallow",
    "nope": "shallow",
    "reject": "shallow",
    "stop": "cancelled",
    "abbrechen": "cancelled",
}
"""Literal reply -> decision. Everything else is feedback for a plan revision."""

FALLBACK_PLAN_TITLE = "Research Report"
FALLBACK_PLAN_SECTIONS = ("Introduction", "Background", "Analysis", "Findings", "Conclusion")
"""The outline shown when the planner returns nothing usable."""


def unwrap_query(reply: str) -> str:
    try:
        data = json.loads(reply)
    except json.JSONDecodeError, TypeError:
        return reply
    if isinstance(data, dict) and isinstance(data.get("query"), str):
        return data["query"]
    return reply


def parse_plan_reply(reply: str) -> tuple[PlanDecision, str]:
    text = unwrap_query(reply).strip()
    decision = PLAN_REPLIES.get(text.lower())
    if decision is not None:
        return decision, ""
    head, _, rest = text.partition(" ")
    if head.lower() == "approve" and rest.strip().startswith("{"):
        return "approved", rest.strip()
    return "feedback", text


MAX_PLAN_SECTIONS = 12


def _parse_edits(edits_json: str) -> dict[str, Any] | None:
    try:
        edits = json.loads(edits_json)
    except ValueError:
        logger.warning("Plan edits did not parse; running the plan as shown")
        return None
    return edits if isinstance(edits, dict) else None


def _names(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [v.strip() for v in value if isinstance(v, str) and v.strip()][:MAX_PLAN_DOCUMENTS]


def apply_plan_edits(plan: PlanResponse, edits_json: str) -> PlanResponse:
    edits = _parse_edits(edits_json)
    if edits is None:
        return plan
    edits = modernize_plan(edits)
    data = plan.model_dump()
    sections = edits.get("sections")
    if isinstance(sections, list):
        kept = [s.strip()[:200] for s in sections if isinstance(s, str) and s.strip()][:MAX_PLAN_SECTIONS]
        if kept:
            data["sections"] = kept
    for key in ("genre", "depth"):
        if isinstance(edits.get(key), str):
            data[key] = edits[key]
    for key in ("basis", "excluded"):
        if isinstance(edits.get(key), list):
            data[key] = _names(edits[key])
    try:
        return PlanResponse.model_validate(data)
    except ValidationError as exc:
        logger.warning("Plan edits did not validate (%s); running the plan as shown", exc)
        return plan


def plan_data_sources(edits_json: str) -> list[str] | None:
    edits = _parse_edits(edits_json) if edits_json else None
    if edits is None or not isinstance(edits.get("data_sources"), list):
        return None
    return [s.strip() for s in edits["data_sources"] if isinstance(s, str) and s.strip()]


def plan_documents(plan: PlanResponse, inventory: list[dict[str, Any]] | None) -> PlanDocuments | None:
    return documents_from_plan(plan.basis, plan.excluded, inventory)


def _inventory_rows(inventory: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for row in inventory or []:
        if not isinstance(row, dict) or not isinstance(row.get("file_name"), str):
            continue
        entry: dict[str, Any] = {"name": row["file_name"]}
        if isinstance(row.get("display_title"), str) and row["display_title"].strip():
            entry["title"] = row["display_title"].strip()
        if isinstance(row.get("shelf"), str) and row["shelf"]:
            entry["shelf"] = row["shelf"]
        rows.append(entry)
        if len(rows) >= MAX_PLAN_INVENTORY_ROWS:
            break
    return rows


MAX_PLAN_INVENTORY_ROWS = 200


def format_plan_for_user(plan: PlanResponse, inventory: list[dict[str, Any]] | None = None) -> str:
    sections_text = "\n".join(f"  {i + 1}. {s}" for i, s in enumerate(plan.sections))
    payload: dict[str, Any] = plan.model_dump()
    rows = _inventory_rows(inventory)
    if rows:
        payload["documents"] = rows
    plan_json = json.dumps(payload, ensure_ascii=False)
    return (
        f"**Research Plan Preview**\n\n"
        f"**Title:** {plan.title}\n\n"
        f"**Sections:**\n{sections_text}\n\n"
        f"```plan_json\n{plan_json}\n```\n\n"
        f"---\n"
        f"Reply **approve** to proceed, **shallow** for a quick answer instead, "
        f"**cancel** to dismiss, or provide feedback to revise the plan."
    )


def _document_lines(docs: list[Any]) -> str:
    lines = []
    for doc in docs:
        where = f" [{doc.shelf}]" if doc.shelf else ""
        title = f"{doc.title} — " if doc.title and doc.title != doc.name else ""
        lines.append(f"- {title}{doc.name}{where}")
    return "\n".join(lines)


def approved_plan_context(plan: PlanResponse, documents: PlanDocuments | None = None) -> str:
    sections_text = "\n".join(f"- {s}" for s in plan.sections)
    text = (
        f"**Approved Research Plan**\n\nTitle: {plan.title}\nGenre: {plan.genre}\nDepth: {plan.depth}\n\n"
        f"Sections (required components, in this order):\n{sections_text}"
    )
    if documents and documents.basis:
        text += (
            "\n\nGrundlage (documents to read in full, each through its own research query; "
            f"a report that could not reach one names it as unread):\n{_document_lines(documents.basis)}"
        )
    if documents and documents.excluded:
        text += (
            "\n\nAusgeschlossen (documents that may not be used: never searched, never cited):\n"
            f"{_document_lines(documents.excluded)}"
        )
    return text


def _fallback_plan() -> PlanResponse:
    return PlanResponse(title=FALLBACK_PLAN_TITLE, sections=list(FALLBACK_PLAN_SECTIONS))


async def generate_plan(
    request: ClarifyRequest, deps: ClarifyDeps, log: str, feedback_history: list[str]
) -> PlanResponse:
    query = get_latest_user_query(list(request.messages)) or ""
    shape = await decide_plan_shape(query, request.project_context, organization_id=get_organization_id_from_context())
    system_prompt = render_prompt_template(
        PLAN_GENERATION_PROMPT,
        project_context=request.project_context,
        clarifier_context=log,
        feedback_history=feedback_history or None,
        preselected=_preselection_text(shape),
        available_documents=request.available_documents or [],
    )
    anchor = HumanMessage(
        content=(
            "Generate a research plan for the user's CURRENT request below. "
            "Earlier messages are background context only — do NOT plan around "
            "topics from earlier turns that the current request does not ask about.\n\n"
            f"Current request: {get_latest_user_query(list(request.messages))}"
        )
    )
    outgoing = [SystemMessage(content=system_prompt), *request.messages, anchor]
    response = await deps.planner_llm.ainvoke(outgoing, config=deps.run_config)
    plan = parse_json_response(response.content, PlanResponse)
    if plan is None or not plan.title or not plan.sections:
        logger.warning("Planner returned no usable plan; showing the generic outline")
        return _fallback_plan()
    return plan


def _preselection_text(shape: PlanShape) -> str | None:
    lines = []
    if shape.genre:
        lines.append(f"genre: {shape.genre}")
    if shape.depth:
        lines.append(f"depth: {shape.depth}")
    return "\n".join(lines) or None


def _outcome(
    log: str,
    plan: PlanResponse,
    outcome: PlanOutcome,
    *,
    inventory: list[dict[str, Any]] | None = None,
    data_sources: list[str] | None = None,
) -> ClarifyResult:
    if outcome != "approved":
        return ClarifyResult(research_context=log, outcome=outcome)
    documents = plan_documents(plan, inventory)
    return ClarifyResult(
        research_context=f"{log}\n\n{approved_plan_context(plan, documents)}",
        outcome="approved",
        data_sources=data_sources,
        documents=documents,
    )


def _decided(
    request: ClarifyRequest, log: str, plan: PlanResponse, decision: PlanOutcome, feedback: str
) -> ClarifyResult:
    data_sources = None
    if decision == "approved" and feedback:
        plan = apply_plan_edits(plan, feedback)
        data_sources = plan_data_sources(feedback)
    logger.info("Clarifier: plan %s by user", decision)
    return _outcome(log, plan, decision, inventory=request.available_documents, data_sources=data_sources)


async def preview_plan(request: ClarifyRequest, deps: ClarifyDeps, log: str) -> ClarifyResult:
    feedback_history: list[str] = []
    plan = _fallback_plan()

    for _ in range(deps.max_plan_iterations):
        plan = await generate_plan(request, deps, log, feedback_history)
        shown = format_plan_for_user(plan, request.available_documents)
        decision, feedback = parse_plan_reply(await deps.ask_user(shown, ()))
        if decision != "feedback":
            return _decided(request, log, plan, decision, feedback)
        logger.info("Clarifier: User provided feedback, regenerating plan")
        feedback_history.append(feedback)

    logger.warning("Clarifier: Max plan iterations reached, auto-approving")
    return _outcome(log, plan, "approved", inventory=request.available_documents)
