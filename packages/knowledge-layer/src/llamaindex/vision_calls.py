"""One vision call of an ingest: its client, its fleet slot, its waits, its trace and its cache key.

Every page an ingest reads with a vision model (a drawing, an image, an embedded
raster, a scanned page's transcription) goes through :func:`_vlm_chat_create`.
It used to live in ``adapter.py``; it is here so that file can shrink.

Three things this module owns, each a decision:

* **Waiting out the provider, in place.** A 429 waits (Retry-After, else 2, 4,
  8 … s) up to ``VLM_RATE_LIMIT_RETRIES`` times. A 402 "would exceed your
  available credits given your current in-flight requests" clears as soon as the
  key's other requests finish, so it waits too, for at most
  :data:`CREDIT_WAIT_BUDGET_SECONDS` in all. A plain "insufficient credits" 402
  is an empty balance and stays final. The OpenRouter transport already retries
  the in-flight 402 three times in about 7 s (``common.credit_retry``); that time
  is inside the budget, because the budget is measured on the clock from the
  first attempt, so the two never stack into minutes. On 2026-11-02, 126 pages
  went unread in two minutes for want of this wait.
* **Prompt caching.** The fixed prompt leads every page read (about 2,160 tokens
  for a drawing), so it is a cacheable prefix, and the cache rate was 1%: no
  sticky key was sent, and the zero-data-retention routing carried a manual
  ``provider.order``, which switches OpenRouter's sticky routing off
  (``common/prompt_caching.py``). A call now carries the key
  ``prompt_caching.prompt_cache_key`` builds from the organization, the model and
  the prompt's identity (its schema version and vocabulary fingerprint, never
  the page or any tenant text). A zero-data-retention organization keeps the
  EU-first ``provider.order`` on its page reads, by the owner's decision on
  2026-11-03, and so caches less: OpenRouter does not route a request with a
  manual order stickily. An organization without ZDR sends no order, and its
  page reads stay on their cache's shard.
* **The trace.** Each call is one ``ingest-vision`` generation, nested under its
  file's ``ingest-file`` trace by the context the vision pools copy.
"""

from __future__ import annotations

import logging
import random
import time
from typing import Any

from agent.common import credit_retry
from agent.common.cost_tracking import USAGE_ROLE_INGEST_VISION
from agent.common.cost_tracking import meter_openai_client

from .env import env_int

logger = logging.getLogger(__name__)

# @environment_variable VLM_TIMEOUT_SECONDS
# @category Knowledge Layer
# @type int
# @default 180
# @required false
# Per-request timeout for VLM captioning calls. The OpenAI SDK default (~600s,
# with 2 built-in retries) lets one hung provider pin an enrichment worker for
# up to ~20 minutes; 180s with a single retry bounds a hung request to ~6
# minutes. ``_vlm_chat_create`` may issue one extra request when the first
# response comes back truncated, but that retry runs with SDK retries disabled,
# so the ceiling for one caption is ~9 minutes — and only on the path where the
# provider answered once and then hung. Retries are kept (rather than dropped to
# 0) because a transient 429/5xx now costs an indexed chunk: failure
# placeholders are skipped, not embedded. Clamped like the sibling knobs: a
# misconfigured 0 or negative value would fail every VLM request immediately and
# silently disable captioning altogether.
VLM_REQUEST_TIMEOUT_SECONDS = max(1, env_int("VLM_TIMEOUT_SECONDS", 180))

# @environment_variable VLM_FLEET_CONCURRENCY
# @category Knowledge Layer
# @type int
# @default 32
# @required false
# Vision-model calls in flight across EVERY ingest process at once (a lease pool
# on the shared cache, `common.lease_slots`); a call waits for a slot. This, not
# the number of ingest workers, is what the provider sees, so scaling the ingest
# tier out queues calls here instead of turning into upstream 429s. 0 disables.
# Every vision call also holds a slot in its model's own provider-limiter pool
# (`PROVIDER_MODEL_LIMIT_CEILING`, 32), so a pool above that never fills:
# keep the two together.
VLM_FLEET_CONCURRENCY = env_int("VLM_FLEET_CONCURRENCY", 32)

# @environment_variable VLM_RATE_LIMIT_RETRIES
# @category Knowledge Layer
# @type int
# @default 4
# @required false
# Retries of a vision-model call the provider rate-limited (HTTP 429), with
# exponential backoff or the provider's Retry-After, before the caption fails.
VLM_RATE_LIMIT_RETRIES = max(0, env_int("VLM_RATE_LIMIT_RETRIES", 4))

_VLM_SLOT_KEY = "ingest:vlm:inflight"
_VLM_BACKOFF_CAP_SECONDS = 60.0

#: How long one page read may wait out in-flight-credit 402s, from its first attempt,
#: the transport's own retries included. Waits 4, 8, 16, 32 s with jitter, cut at the budget.
CREDIT_WAIT_BUDGET_SECONDS = 60.0

#: The first wait is ``credit_retry.delay_seconds`` of this step (4 s): the transport
#: already spent 1, 2 and 4 s on the same 402 before it reached us.
_CREDIT_FIRST_STEP = 2

#: The Langfuse name of one vision call made by an ingest (a drawing page, an image, a raster).
VISION_GENERATION_NAME = "ingest-vision"


def _vlm_slot():
    """One of the fleet's ``VLM_FLEET_CONCURRENCY`` vision-call slots, for as long as the call may last.

    Shared fairly between organisations (``lease_slots.FAIR_ACQUIRE_LUA``): an
    office's 300-sheet upload takes every slot while it is alone, and gives one
    up to the next office's first page as soon as that office waits. The lane is
    the organisation on the job's cost ledger (``_ingest_cost_scope``), which the
    vision pool's threads inherit; a call outside a job has none and is unlaned.
    """
    from agent.common import lease_slots

    return lease_slots.hold(
        _VLM_SLOT_KEY,
        VLM_FLEET_CONCURRENCY,
        lease_seconds=VLM_REQUEST_TIMEOUT_SECONDS + 30,
        max_wait_seconds=VLM_REQUEST_TIMEOUT_SECONDS * 3,
        lane=_vision_lane(),
    )


def _vision_lane() -> str | None:
    """The organisation the running ingest job reads for, or ``None`` outside one."""
    from agent.common.cost_tracking import cost_tracker_var

    tracker = cost_tracker_var.get()
    organization_id = getattr(tracker, "organization_id", None)
    return str(organization_id) if organization_id else None


def page_cache_body(client: Any, request: dict[str, Any], prompt_id: str | None) -> dict[str, Any]:
    """``request`` with the sticky-routing key and cache marker for its fixed prompt, on OpenRouter only.

    ``prompt_id`` names the prompt (``visual_analysis.cache_prompt_type``: schema
    and vocabulary fingerprint), never the page: the key is the organization,
    the model and that name, so every page of one office read with one prompt
    shares a shard, and no tenant text is in it. Without a ``prompt_id``, or off
    OpenRouter (the fields are OpenRouter's), the request is returned unchanged.
    """
    from agent.common import prompt_caching
    from agent.common.openrouter import targets_openrouter

    if not prompt_id or not targets_openrouter(getattr(client, "base_url", None)):
        return request
    model = request.get("model")
    key = prompt_caching.prompt_cache_key(system_prompt=prompt_id, organization_id=_vision_lane(), model=model)
    extra = prompt_caching.with_prompt_cache_routing(request.get("extra_body"), key)
    return {**request, "extra_body": prompt_caching.with_cache_marker(extra, model)}


def _observed_vlm_call(client: Any, request: dict[str, Any]) -> Any:
    """One vision call, as a Langfuse generation under the file's trace (images redacted from the span)."""
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
    """Seconds to wait before retrying a call the provider rate-limited; None when it was not a 429."""
    if getattr(error, "status_code", None) != 429 and "rate_limit" not in str(error).lower():
        return None
    headers = getattr(getattr(error, "response", None), "headers", None) or {}
    try:
        stated = float(headers.get("retry-after", ""))
    except TypeError, ValueError:
        return 0.0
    return min(max(stated, 0.0), _VLM_BACKOFF_CAP_SECONDS)


def is_in_flight_credit_402(error: Exception) -> bool:
    """Whether ``error`` is the provider's transient in-flight-credit 402, not an empty balance."""
    if getattr(error, "status_code", None) != 402:
        return False
    text = f"{error} {getattr(error, 'body', '') or ''}"
    return credit_retry.is_transient_credit_402(402, text.encode("utf-8", "replace"))


def retry_wait(error: Exception, *, rate_limited: int, credit_waits: int, spent: float) -> float | None:
    """Seconds to wait before the next attempt of a failed page read, or None when it is final. Pure but for jitter.

    ``rate_limited`` and ``credit_waits`` are the 429 and 402 retries so far;
    ``spent`` is how much of :data:`CREDIT_WAIT_BUDGET_SECONDS` the read has used.
    A 429 is counted (``VLM_RATE_LIMIT_RETRIES``); an in-flight 402 is bounded by
    the budget, so a call that has waited the budget out fails as it would have.
    """
    stated = _rate_limited_for(error)
    if stated is not None:
        if rate_limited >= VLM_RATE_LIMIT_RETRIES:
            return None
        wait = stated or min(_VLM_BACKOFF_CAP_SECONDS, 2.0 ** (rate_limited + 1))
        return wait * (0.8 + 0.4 * random.random())
    if not is_in_flight_credit_402(error):
        return None
    remaining = CREDIT_WAIT_BUDGET_SECONDS - spent
    wait = min(remaining, credit_retry.delay_seconds(credit_waits + _CREDIT_FIRST_STEP))
    return wait if wait > 0 else None


def _vlm_create_fairly(client, **request):
    """``client.chat.completions.create`` inside a fleet slot, waiting out the provider's 429s and in-flight 402s.

    The OpenAI SDK retries a 429 once on its own (``max_retries=1``) and a 402
    never; a burst of ingest workers outlasts both. Each further attempt waits
    OUTSIDE the slot (:func:`retry_wait`), so a waiting call never holds capacity
    another call could use once the limit lifts.
    """
    started = time.monotonic()
    rate_limited = credit_waits = 0
    waited = 0.0
    while True:
        try:
            with _vlm_slot():
                return _observed_vlm_call(client, request)
        except Exception as error:
            # The clock, or the waits when the clock is not moving (a test): whichever is further.
            spent = max(time.monotonic() - started, waited)
            wait = retry_wait(error, rate_limited=rate_limited, credit_waits=credit_waits, spent=spent)
            if wait is None:
                raise
            credit = is_in_flight_credit_402(error)
            credit_waits += credit
            rate_limited += not credit
            logger.info(
                "VLM call %s; retrying in %.1fs", "waiting for in-flight credits" if credit else "rate-limited", wait
            )
            waited += wait
            time.sleep(wait)


def _vlm_client(base_url: str, api_key: str, *, role: str = USAGE_ROLE_INGEST_VISION):
    """The vision client for one ingest call, under the ingest job's data policy and on its cost ledger.

    The ingest job enters ``openrouter.data_policy_scope`` for its organization;
    anything that reaches here without one (the base corpus sync, a thread that
    lost the context) is pinned to zero-data-retention endpoints. A ZDR policy
    keeps its EU-first ``provider.order``, which switches off the sticky routing
    the cache key drives: ZDR organizations cache less, by the owner's decision
    on 2026-11-03 (EU hosting preferred over the cache). Each call's usage is
    recorded under ``role`` in the job's tracker (``_ingest_cost_scope``).
    """
    from agent.common.openrouter import openai_client
    from agent.common.openrouter import scoped_data_policy

    return meter_openai_client(
        openai_client(
            base_url=base_url,
            api_key=api_key,
            policy=scoped_data_policy(),
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
    """One VLM chat completion with a single truncation retry.

    ``prompt_id`` names the fixed prompt the messages lead with, for the cache key
    (:func:`page_cache_body`); never anything read from the page.

    A response clipped at ``max_tokens`` (``finish_reason == "length"``) loses
    the trailing fields of the structured drawing format — exactly the
    ZUSAMMENFASSUNG the document summary is built from — so retry ONCE with a
    doubled budget. Returns the message content (possibly empty); a still-
    truncated response is returned as-is with a warning rather than silently
    treated as complete.

    The retry is a best-effort improvement on a caption we ALREADY have, so it
    is deliberately cheap and never destructive:

    - It runs with the SDK retries disabled. The first call already spends the
      client's ``max_retries`` budget, and letting the second call spend it
      again would double the worst-case latency of a single caption on top of
      an attempt that, by definition, already succeeded.
    - A failure is swallowed and the truncated first caption is returned.
      Raising here would discard usable content and — since failure placeholders
      are no longer indexed — drop the chunk entirely over a partial success.
    """
    request = {"model": model, "messages": messages, "temperature": temperature, "prompt_id": prompt_id}
    response = _vlm_create_fairly(client, max_tokens=max_tokens, **request)
    choice = response.choices[0]
    if getattr(choice, "finish_reason", None) != "length":
        return choice.message.content or ""

    partial = choice.message.content or ""
    logger.warning("VLM response truncated at %d tokens; retrying with %d", max_tokens, max_tokens * 2)
    # ``with_options`` is the OpenAI SDK's per-call override; guarded because
    # the drawing/image call sites are exercised with lightweight fake clients.
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
