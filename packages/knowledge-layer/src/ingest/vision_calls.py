from __future__ import annotations

import logging
import random
import time
from typing import Any

from knowledge_layer.env import env_int

from agent.common import credit_retry
from agent.common.cost_tracking import USAGE_ROLE_INGEST_VISION
from agent.common.cost_tracking import meter_openai_client

logger = logging.getLogger(__name__)

VLM_REQUEST_TIMEOUT_SECONDS = max(1, env_int("VLM_TIMEOUT_SECONDS", 180))

VLM_FLEET_CONCURRENCY = env_int("VLM_FLEET_CONCURRENCY", 32)

VLM_RATE_LIMIT_RETRIES = max(0, env_int("VLM_RATE_LIMIT_RETRIES", 4))

_VLM_SLOT_KEY = "ingest:vlm:inflight"
_VLM_BACKOFF_CAP_SECONDS = 60.0

CREDIT_WAIT_BUDGET_SECONDS = 60.0

_CREDIT_FIRST_STEP = 2

VISION_GENERATION_NAME = "ingest-vision"


def _vlm_slot():
    from agent.common import lease_slots

    return lease_slots.hold(
        _VLM_SLOT_KEY,
        VLM_FLEET_CONCURRENCY,
        lease_seconds=VLM_REQUEST_TIMEOUT_SECONDS + 30,
        max_wait_seconds=VLM_REQUEST_TIMEOUT_SECONDS * 3,
        lane=_vision_lane(),
    )


def _vision_lane() -> str | None:
    from agent.common.cost_tracking import cost_tracker_var

    tracker = cost_tracker_var.get()
    organization_id = getattr(tracker, "organization_id", None)
    return str(organization_id) if organization_id else None


def page_cache_body(client: Any, request: dict[str, Any], prompt_id: str | None) -> dict[str, Any]:
    from agent.common import prompt_caching
    from agent.common.openrouter import targets_openrouter

    if not prompt_id or not targets_openrouter(getattr(client, "base_url", None)):
        return request
    model = request.get("model")
    key = prompt_caching.prompt_cache_key(system_prompt=prompt_id, organization_id=_vision_lane(), model=model)
    extra = prompt_caching.with_prompt_cache_routing(request.get("extra_body"), key)
    return {**request, "extra_body": prompt_caching.with_cache_marker(extra, model)}


def _observed_vlm_call(client: Any, request: dict[str, Any]) -> Any:
    from agent.common.openrouter import vision_extra_body
    from agent.observability.direct_trace import observed_generation

    request = dict(request)
    prompt_id = request.pop("prompt_id", None)
    request = page_cache_body(client, {**vision_extra_body(client), **request}, prompt_id)
    with observed_generation(
        VISION_GENERATION_NAME, model=request.get("model"), messages=request.get("messages")
    ) as generation:
        response = client.chat.completions.create(**request)
        dump = getattr(response, "model_dump", None)
        generation.finish(dump() if callable(dump) else {})
        return response


def _rate_limited_for(error: Exception) -> float | None:
    if getattr(error, "status_code", None) != 429 and "rate_limit" not in str(error).lower():
        return None
    headers = getattr(getattr(error, "response", None), "headers", None) or {}
    try:
        stated = float(headers.get("retry-after", ""))
    except TypeError, ValueError:
        return 0.0
    return min(max(stated, 0.0), _VLM_BACKOFF_CAP_SECONDS)


def is_in_flight_credit_402(error: Exception) -> bool:
    if getattr(error, "status_code", None) != 402:
        return False
    text = f"{error} {getattr(error, 'body', '') or ''}"
    return credit_retry.is_transient_credit_402(402, text.encode("utf-8", "replace"))


def waits_out(error: Exception) -> bool:
    from agent.knowledge.ingest_failures import no_allowed_provider

    return is_in_flight_credit_402(error) or no_allowed_provider(None, error)


def retry_wait(error: Exception, *, rate_limited: int, credit_waits: int, spent: float) -> float | None:
    stated = _rate_limited_for(error)
    if stated is not None:
        if rate_limited >= VLM_RATE_LIMIT_RETRIES:
            return None
        wait = stated or min(_VLM_BACKOFF_CAP_SECONDS, 2.0 ** (rate_limited + 1))
        return wait * (0.8 + 0.4 * random.random())
    if not waits_out(error):
        return None
    remaining = CREDIT_WAIT_BUDGET_SECONDS - spent
    wait = min(remaining, credit_retry.delay_seconds(credit_waits + _CREDIT_FIRST_STEP))
    return wait if wait > 0 else None


def _vlm_create_fairly(client, **request):
    started = time.monotonic()
    rate_limited = credit_waits = 0
    waited = 0.0
    while True:
        try:
            with _vlm_slot():
                return _observed_vlm_call(client, request)
        except Exception as error:
            spent = max(time.monotonic() - started, waited)
            wait = retry_wait(error, rate_limited=rate_limited, credit_waits=credit_waits, spent=spent)
            if wait is None:
                raise
            credit = waits_out(error)
            credit_waits += credit
            rate_limited += not credit
            logger.info(
                "VLM call %s; retrying in %.1fs", "waiting for the provider" if credit else "rate-limited", wait
            )
            waited += wait
            time.sleep(wait)


def _vlm_client(base_url: str, api_key: str, *, role: str = USAGE_ROLE_INGEST_VISION):
    from agent.common.openrouter import openai_client
    from agent.common.openrouter import scoped_data_policy

    return meter_openai_client(
        openai_client(
            base_url=base_url,
            api_key=api_key,
            policy=scoped_data_policy().for_page_reads(),
            timeout=VLM_REQUEST_TIMEOUT_SECONDS,
            max_retries=1,
        ),
        role=role,
    )


def _vlm_chat_create(
    client,
    *,
    model: str,
    messages: list,
    max_tokens: int,
    temperature: float = 0.2,
    prompt_id: str | None = None,
) -> str:
    request = {"model": model, "messages": messages, "temperature": temperature, "prompt_id": prompt_id}
    response = _vlm_create_fairly(client, max_tokens=max_tokens, **request)
    choice = response.choices[0]
    if getattr(choice, "finish_reason", None) != "length":
        return choice.message.content or ""

    partial = choice.message.content or ""
    logger.warning("VLM response truncated at %d tokens; retrying with %d", max_tokens, max_tokens * 2)
    with_options = getattr(client, "with_options", None)
    retry_client = client
    if callable(with_options):
        try:
            retry_client = with_options(max_retries=0)
        except Exception:  # pragma: no cover - defensive, SDK-shape dependent
            retry_client = client
    try:
        with _vlm_slot():
            response = _observed_vlm_call(retry_client, {**request, "max_tokens": max_tokens * 2})
    except Exception as exc:
        logger.warning("VLM truncation retry failed (%s); keeping the truncated caption", exc)
        return partial
    choice = response.choices[0]
    if getattr(choice, "finish_reason", None) == "length":
        logger.warning("VLM response still truncated at %d tokens; storing partial caption", max_tokens * 2)
    return choice.message.content or partial
