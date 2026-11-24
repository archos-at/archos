from __future__ import annotations

import asyncio
import contextlib
import logging
from collections.abc import Iterator
from typing import Any

from agent.agents.deep_researcher.anatomy import ReportAnatomy
from agent.cards.generate import CardGenerationResult
from agent.cards.registry import CardRegistry
from agent.cards.registry import reset_card_registry
from agent.cards.registry import set_card_registry

logger = logging.getLogger(__name__)


@contextlib.contextmanager
def _bound_card_registry() -> Iterator[CardRegistry]:
    registry = CardRegistry()
    token = set_card_registry(registry)
    try:
        yield registry
    finally:
        reset_card_registry(token)


def _merge_job_cards(emitted: list[dict[str, Any]], generated: list[Any] | None) -> list[Any] | None:
    merged = [*emitted, *(generated or [])]
    return merged or None


def _produces_report(agent_cls: type) -> bool:
    return bool(getattr(agent_cls, "produces_report", True))


async def _run_report_passes(
    *,
    produces_report: bool,
    llm: Any,
    input_text: str,
    report: str,
    organization_id: str | None,
    **reflection_kwargs: Any,
) -> tuple[CardGenerationResult, ReportAnatomy, dict[str, Any] | None]:
    if not produces_report:
        return CardGenerationResult(cards=None), ReportAnatomy(), None
    cards_result, anatomy, follow_ups = await asyncio.gather(
        _generate_answer_cards(llm, input_text, report),
        _extract_report_anatomy(llm, input_text, report),
        _propose_report_follow_ups(llm, query=input_text, report=report, organization_id=organization_id),
    )
    await _run_deep_research_reflection(
        query=input_text, report=_reflection_text(report, anatomy.findings), **reflection_kwargs
    )
    return cards_result, anatomy, follow_ups


def _reflection_text(report: str, findings: dict[str, Any] | None) -> str:
    items = (findings or {}).get("items") if isinstance(findings, dict) else None
    if not isinstance(items, list) or not items:
        return report
    lines = []
    for item in items:
        if not isinstance(item, dict) or not item.get("requirement"):
            continue
        value = f" — {item['value']}" if item.get("value") else ""
        comment = f" ({item['comment']})" if item.get("comment") and item.get("status") in ("open", "not_met") else ""
        status = f" — {item['status']}" if item.get("status") else ""
        lines.append(f"- {item['requirement']}{value}{status}{comment}")
    return f"{report.rstrip()}\n\n## Befunde\n" + "\n".join(lines) if lines else report


async def _extract_report_anatomy(llm: Any, query: str, report: str) -> ReportAnatomy:
    try:
        from agent.agents.deep_researcher.anatomy import extract_report_anatomy

        anatomy = await extract_report_anatomy(llm, query, report)
        if anatomy.findings:
            logger.info("Extracted %d finding(s) from the deep-research report", len(anatomy.findings["items"]))
        return anatomy
    except Exception as e:  # noqa: BLE001 — additive; the report is already whole
        logger.warning("Report anatomy extraction failed (non-fatal): %s", e)
        return ReportAnatomy(failed=True)


async def _propose_report_follow_ups(
    llm: Any, *, query: str, report: str, organization_id: str | None
) -> dict[str, Any] | None:
    try:
        from agent.stages import StageContext
        from agent.stages import TurnFacts
        from agent.stages.flags import resolve_enabled_stages
        from agent.stages.follow_ups import FOLLOW_UPS

        enabled = await resolve_enabled_stages(organization_id=organization_id, memory_reflection_enabled=False)
        if FOLLOW_UPS.id not in enabled:
            return None
        facts = TurnFacts(query=query, answer=report, organization_id=organization_id)
        payload = await asyncio.wait_for(FOLLOW_UPS.handler(StageContext(facts=facts, llm=llm)), FOLLOW_UPS.timeout_s)
        return payload if isinstance(payload, dict) and payload.get("items") else None
    except Exception as e:  # noqa: BLE001 — additive; the report is already whole
        logger.warning("Report follow-ups failed (non-fatal): %s", e)
        return None


async def _generate_answer_cards(llm: Any, query: str, report: str) -> CardGenerationResult:
    try:
        from agent.cards.generate import generate_cards_result

        result = await generate_cards_result(llm, query, report)
        if result.cards:
            logger.info("Generated %d Grid card(s) for deep-research report", len(result.cards))
        return result
    except Exception as e:
        logger.warning("Grid card generation failed (non-fatal): %s", e)
        return CardGenerationResult(cards=None, failed=True)


async def _run_deep_research_reflection(
    *,
    builder: Any,
    job_id: str,
    reflection_llm_ref: str | None,
    reflection_enabled: bool,
    query: str,
    report: str,
    usage_context: dict | None,
    memory_digest: str | None,
    org_credential: Any,
    model_overrides: dict[str, str] | None,
    zdr_only: bool = True,
) -> None:
    if not reflection_enabled or not reflection_llm_ref or not report:
        return
    identity = _reflection_identity(usage_context)
    if identity is None:
        return
    from agent.stages.memory_reflection import REFLECTION_TIMEOUT_S

    try:
        reflection_llm = await _reflection_llm(builder, reflection_llm_ref, org_credential, model_overrides, zdr_only)
        await asyncio.wait_for(
            _reflect(reflection_llm, identity, job_id=job_id, query=query, report=report, memory_digest=memory_digest),
            timeout=REFLECTION_TIMEOUT_S,
        )
    except TimeoutError:
        logger.warning(
            "Job %s: deep-research memory reflection timed out after %ss (non-fatal)", job_id, REFLECTION_TIMEOUT_S
        )
    except Exception:
        logger.warning("Job %s: deep-research memory reflection failed (non-fatal)", job_id, exc_info=True)


def _reflection_identity(usage_context: dict | None) -> dict | None:
    identity = (usage_context or {}).get("identity") or {}
    return identity if identity.get("project_id") else None


async def _reflect(
    llm: Any, identity: dict, *, job_id: str, query: str, report: str, memory_digest: str | None
) -> None:
    from agent.common.cost_tracking import BudgetSnapshot
    from agent.common.cost_tracking import track_llm_costs
    from agent.common.profiler import track_agent_profile
    from agent.memory.reflection import run_memory_reflection

    with (
        track_agent_profile(agent_name="project_memory_reflection", job_id=job_id, identity=identity),
        track_llm_costs(job_id=job_id, identity=identity, budget=BudgetSnapshot()),
    ):
        await run_memory_reflection(
            llm=llm,
            query=query,
            answer=report,
            project_id=identity["project_id"],
            organization_id=identity.get("organization_id"),
            conversation_id=identity.get("conversation_id"),
            memory_digest=memory_digest,
        )


async def _reflection_llm(
    builder: Any, llm_ref: str, org_credential: Any, model_overrides: dict[str, str] | None, zdr_only: bool
) -> Any:
    from agent.common import AgentGroup
    from agent.common import apply_model_override
    from agent.common import apply_org_credential
    from agent.common import get_langchain_llm
    from agent.common import sanitize_model_overrides

    llm = await get_langchain_llm(builder, llm_ref)
    overrides = sanitize_model_overrides(model_overrides) if model_overrides else {}
    return apply_model_override(
        apply_org_credential(llm, org_credential), AgentGroup.MEMORY_REFLECTION, overrides, zdr_only=zdr_only
    )
