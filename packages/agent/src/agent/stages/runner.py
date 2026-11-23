from __future__ import annotations

import asyncio
import logging
import os
import time
import weakref
from collections import OrderedDict
from collections.abc import Mapping
from typing import Any

from agent.common.model_overrides import AgentGroup
from agent.common.wire_v2 import StageValue
from agent.stages.delivery import deliver_stage_frame
from agent.stages.registry import iter_stages
from agent.stages.spec import StageContext
from agent.stages.spec import StageEmpty
from agent.stages.spec import StageOutcome
from agent.stages.spec import StageSpec
from agent.stages.spec import TurnFacts

logger = logging.getLogger(__name__)

_MAX_CONCURRENCY = int(os.environ.get("STAGE_MAX_CONCURRENCY", "4"))
_MAX_PENDING = int(os.environ.get("STAGE_MAX_PENDING", "16"))

_background_tasks: set[asyncio.Task] = set()
_handler_tasks: set[asyncio.Task] = set()

_semaphores: weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, asyncio.Semaphore] = weakref.WeakKeyDictionary()

_MAX_REMEMBERED_KEYS = 1024
_claimed_keys: OrderedDict[tuple[str, str, str], None] = OrderedDict()


def _loop_semaphore(loop: asyncio.AbstractEventLoop) -> asyncio.Semaphore:
    semaphore = _semaphores.get(loop)
    if semaphore is None:
        semaphore = asyncio.Semaphore(_MAX_CONCURRENCY)
        _semaphores[loop] = semaphore
    return semaphore


def _claim(spec: StageSpec, facts: TurnFacts) -> bool:
    turn_key = facts.turn_key
    if turn_key is None:
        return True
    key = (turn_key[0], turn_key[1], spec.id)
    if key in _claimed_keys:
        return False
    _claimed_keys[key] = None
    while len(_claimed_keys) > _MAX_REMEMBERED_KEYS:
        _claimed_keys.popitem(last=False)
    return True


def stage_value(spec: StageSpec, outcome: StageOutcome) -> StageValue:
    status = "failed" if outcome.status == "timeout" else outcome.status
    payload = outcome.payload if outcome.status == "ready" else None
    return StageValue(stage=spec.id, status=status, payload=payload)


def resolve_group_llm(base: Any, agent_group: AgentGroup, *, label: str) -> Any:
    if base is None:
        return None
    from agent.common import apply_model_override
    from agent.common import apply_org_credential
    from agent.common import apply_zdr_routing

    try:
        return apply_model_override(apply_org_credential(base), agent_group)
    except Exception:
        logger.warning("%s: model override/credential swap failed; using the configured model", label)
    try:
        return apply_zdr_routing(base)
    except Exception:
        logger.error("%s: could not pin the configured model to ZDR; not running", label)
        return None


def _resolve_llm(spec: StageSpec, llms: Mapping[AgentGroup, Any] | None) -> Any:
    llm = resolve_group_llm((llms or {}).get(spec.agent_group), spec.agent_group, label=f"Stage {spec.id}")
    if llm is None:
        return None
    if spec.max_output_tokens is not None:
        try:
            llm = llm.bind(max_tokens=spec.max_output_tokens)
        except Exception:
            logger.warning("Stage %s: could not bind max_tokens=%s", spec.id, spec.max_output_tokens)
    return llm


def _pre_run_outcome(spec: StageSpec, facts: TurnFacts) -> StageOutcome | None:
    if not facts.stage_enabled(spec.id):
        return StageOutcome(stage_id=spec.id, status="disabled", reason="flag_off")
    decision = spec.gate(facts)
    if not decision.run:
        return StageOutcome(stage_id=spec.id, status="skipped", reason=decision.reason or "gate")
    return None


def schedule_post_answer_stages(
    facts: TurnFacts,
    *,
    llms: Mapping[AgentGroup, Any] | None = None,
) -> list[asyncio.Task]:
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        logger.debug("Post-answer stages skipped: no running event loop")
        return []

    tasks: list[asyncio.Task] = []
    for spec in iter_stages():
        try:
            task = _schedule_one(loop, spec, facts, llms)
        except Exception:
            logger.exception("Could not schedule post-answer stage %s (non-fatal)", spec.id)
            continue
        if task is not None:
            tasks.append(task)
    return tasks


def _schedule_one(
    loop: asyncio.AbstractEventLoop,
    spec: StageSpec,
    facts: TurnFacts,
    llms: Mapping[AgentGroup, Any] | None,
) -> asyncio.Task | None:
    outcome = _pre_run_outcome(spec, facts)
    llm: Any = None
    if outcome is None:
        llm = _resolve_llm(spec, llms)
        if llm is None:
            outcome = StageOutcome(stage_id=spec.id, status="disabled", reason="no_llm")
    if outcome is None and len(_handler_tasks) >= _MAX_PENDING:
        outcome = StageOutcome(stage_id=spec.id, status="skipped", reason="pending_cap")
    if outcome is None and not _claim(spec, facts):
        outcome = StageOutcome(stage_id=spec.id, status="skipped", reason="duplicate")

    if outcome is not None:
        return _track(loop.create_task(_record_only(spec, facts, outcome)), handler=False)

    return _track(loop.create_task(_run_stage(spec, StageContext(facts=facts, llm=llm))), handler=True)


def _track(task: asyncio.Task, *, handler: bool) -> asyncio.Task:
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)
    if handler:
        _handler_tasks.add(task)
        task.add_done_callback(_handler_tasks.discard)
    return task


def _answer_message_id(facts: TurnFacts) -> str | None:
    if not facts.ws_parent_id:
        return None
    from agent.turn.response import answer_message_id

    return answer_message_id(facts.conversation_id, facts.ws_parent_id)


def _identity(facts: TurnFacts) -> dict[str, str | None]:
    return {"organization_id": facts.organization_id, "conversation_id": facts.conversation_id}


async def _record_only(spec: StageSpec, facts: TurnFacts, outcome: StageOutcome) -> StageOutcome:
    await _emit_span(spec, facts, outcome)
    return outcome


async def _emit_span(spec: StageSpec, facts: TurnFacts, outcome: StageOutcome) -> None:
    try:
        from agent.common.profiler import track_agent_profile

        metadata = {"stage": spec.id, "outcome": outcome.status, "reason": outcome.reason}
        with track_agent_profile(agent_name=f"stage:{spec.id}", identity=_identity(facts), metadata=metadata):
            pass
    except Exception:
        logger.warning("Could not record the span for stage %s", spec.id, exc_info=True)


async def _run_stage(spec: StageSpec, ctx: StageContext) -> StageOutcome:
    facts = ctx.facts
    started = time.monotonic()
    payload: dict[str, Any] | None = None
    status = "failed"
    reason: str | None = "unknown"

    from agent.common.cost_tracking import BudgetSnapshot
    from agent.common.cost_tracking import track_llm_costs
    from agent.common.profiler import track_agent_profile

    metadata: dict[str, Any] = {"stage": spec.id, "outcome": "failed", "reason": "unknown"}
    try:
        loop = asyncio.get_running_loop()
        async with _loop_semaphore(loop):
            with (
                track_agent_profile(agent_name=f"stage:{spec.id}", identity=_identity(facts), metadata=metadata),
                track_llm_costs(
                    identity={
                        "organization_id": facts.organization_id,
                        "user_id": facts.user_id,
                        "project_id": facts.project_id,
                        "conversation_id": facts.conversation_id,
                        "message_id": _answer_message_id(facts),
                    },
                    budget=BudgetSnapshot(),
                ) as tracker,
            ):
                try:
                    result = await asyncio.wait_for(spec.handler(ctx), timeout=spec.timeout_s)
                except TimeoutError:
                    status, reason = "timeout", None
                    logger.warning("Stage %s timed out after %ss", spec.id, spec.timeout_s)
                except asyncio.CancelledError:
                    raise
                except Exception as exc:
                    status, reason = "failed", type(exc).__name__
                    logger.exception("Stage %s failed (non-fatal)", spec.id)
                else:
                    status, reason, payload = _validate(spec, result)
                metadata["outcome"] = status
                metadata["reason"] = reason
                metadata.update(_cost_metadata(tracker))
    except asyncio.CancelledError:
        raise
    except Exception:
        status, reason = "failed", "runner_error"
        logger.exception("Stage %s: the runner itself failed (non-fatal)", spec.id)

    outcome = StageOutcome(
        stage_id=spec.id,
        status=status,  # type: ignore[arg-type]
        reason=reason if status in {"skipped", "failed", "disabled", "empty"} else None,
        payload=payload if status == "ready" else None,
        duration_ms=max(0, round((time.monotonic() - started) * 1000)),
    )
    if spec.delivery == "frame" and status in {"ready", "empty", "failed", "timeout"}:
        await deliver_stage_frame(facts.conversation_id, facts.ws_parent_id, stage_value(spec, outcome))
    return outcome


def _cost_metadata(tracker: Any) -> dict[str, Any]:
    if tracker is None:
        return {}
    try:
        return {
            "prompt_tokens": tracker.prompt_tokens,
            "completion_tokens": tracker.completion_tokens,
            "cost_usd": round(tracker.turn_cost_usd, 6),
            "llm_calls": tracker.events_recorded,
        }
    except Exception:
        logger.warning("Could not read stage cost from the tracker", exc_info=True)
        return {}


def _validate(spec: StageSpec, result: Any) -> tuple[str, str | None, dict[str, Any] | None]:
    if result is None:
        return "empty", None, None
    if isinstance(result, StageEmpty):
        return "empty", result.reason, None
    if spec.payload_model is not None:
        try:
            validated = spec.payload_model.model_validate(result)
        except Exception:
            logger.warning("Stage %s returned a payload its own model rejects", spec.id, exc_info=True)
            return "failed", "invalid_payload", None
        return "ready", None, validated.model_dump(mode="json", exclude_none=True)
    if not isinstance(result, dict):
        return "failed", "invalid_payload", None
    return "ready", None, result
