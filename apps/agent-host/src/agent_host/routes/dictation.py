from __future__ import annotations

import asyncio
import base64
import binascii
import logging
import math
import os
from dataclasses import dataclass
from dataclasses import replace
from typing import Any

import httpx
from fastapi import APIRouter
from fastapi import Header
from fastapi import Request

from agent.common import provider_limiter
from agent.common.cost_tracking import USAGE_ACTIVITY_DICTATION
from agent.common.cost_tracking import USAGE_ROLE_DICTATION
from agent.common.cost_tracking import CostTracker
from agent.common.cost_tracking import UsageEvent
from agent.common.credential_resolution import ResolvedCredential
from agent.common.credential_resolution import read_api_key_env
from agent.common.credential_resolution import resolve_llm_credential
from agent.common.openrouter import PLATFORM_FIXED
from agent.common.openrouter import limited_async_http_client
from agent.common.openrouter import targets_openrouter

from ..models.requests import MAX_DICTATION_AUDIO_BYTES
from ..models.requests import DictationRequest
from ..models.requests import DictationResponse
from ._dictation_text import clean_transcript
from .internal_auth import _require_internal_token

logger = logging.getLogger(__name__)

MODEL_ENV = "DICTATION_MODEL"
FALLBACK_MODEL_ENV = "DICTATION_FALLBACK_MODEL"
DEFAULT_MODEL = "elevenlabs/scribe-v2"
DEFAULT_FALLBACK_MODEL = "openai/whisper-large-v3-turbo"
OWN_KEY_MODELS = ("gpt-4o-transcribe", "whisper-1")

_OPENROUTER_BASE = "https://openrouter.ai/api/v1"
_OPENAI_BASE = "https://api.openai.com/v1"

_ATTEMPT_TIMEOUT_SECONDS = 25.0

_MIME_TYPES = {"webm": "audio/webm", "ogg": "audio/ogg", "m4a": "audio/mp4"}

_WORDING_HINTS = {
    "de": "Okay, wir prüfen das laut OIB-Richtlinie 2. The fire rating of the Stiegenhaus needs a review.",
    "en": "Okay, we check this against OIB-Richtlinie 2. Das Stiegenhaus braucht noch eine Prüfung.",
}
_PROMPT_PROVIDER_SLUGS = ("openai", "groq")


@dataclass(frozen=True)
class Transcription:
    text: str
    model: str
    audio_seconds: float | None
    cost_usd: float | None
    is_byok: bool | None
    generation_id: str | None
    input_tokens: int
    output_tokens: int


def dictation_models(base_url: str | None = None) -> tuple[str, ...]:
    if base_url is not None and not targets_openrouter(base_url):
        return OWN_KEY_MODELS
    primary = os.getenv(MODEL_ENV, "").strip() or DEFAULT_MODEL
    fallback = os.getenv(FALLBACK_MODEL_ENV, DEFAULT_FALLBACK_MODEL).strip()
    return (primary,) if not fallback or fallback == primary else (primary, fallback)


def wording_hint(locale: str | None) -> str:
    return _WORDING_HINTS["en" if (locale or "").lower().startswith("en") else "de"]


def _credential(organization_id: str | None) -> ResolvedCredential:
    base_url = _OPENROUTER_BASE if read_api_key_env("OPENROUTER_API_KEY") else _OPENAI_BASE
    cred = resolve_llm_credential(
        primary_env="",
        default_base_url=base_url,
        default_model=dictation_models()[0],
        organization_id=organization_id,
    )
    return cred if cred.source == "byok" else replace(cred, data_policy=PLATFORM_FIXED)


async def _post_audio(
    client: httpx.AsyncClient, cred: ResolvedCredential, model: str, audio: bytes, audio_format: str, hint: str
) -> httpx.Response:
    url = f"{cred.base_url}/audio/transcriptions"
    headers = {"Authorization": f"Bearer {cred.api_key}"}
    if targets_openrouter(cred.base_url):
        body = cred.request_body(
            {
                "model": model,
                "input_audio": {"data": base64.b64encode(audio).decode("ascii"), "format": audio_format},
                "temperature": 0,
                "provider": {"options": {slug: {"prompt": hint} for slug in _PROMPT_PROVIDER_SLUGS}},
            }
        )
        return await client.post(url, json=body, headers=headers)
    form = cred.request_body({"model": model, "prompt": hint, "temperature": "0", "response_format": "json"})
    files = {"file": (f"dictation.{audio_format}", audio, _MIME_TYPES[audio_format])}
    return await client.post(url, data=form, files=files, headers=headers)


def _number(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    return float(value) if math.isfinite(value) and value >= 0 else None


def parse_transcription(data: Any, *, model: str, own_key: bool, generation_id: str | None) -> Transcription:
    if not isinstance(data, dict) or not isinstance(data.get("text"), str):
        raise ValueError("transcription response has no text")
    usage = data.get("usage") if isinstance(data.get("usage"), dict) else {}
    reported_byok = usage.get("is_byok")
    return Transcription(
        text=data["text"],
        model=model,
        audio_seconds=_number(usage.get("seconds")) or _number(data.get("duration")),
        cost_usd=_number(usage.get("cost")),
        is_byok=True if own_key else (reported_byok if isinstance(reported_byok, bool) else None),
        generation_id=generation_id,
        input_tokens=int(_number(usage.get("input_tokens")) or 0),
        output_tokens=int(_number(usage.get("output_tokens")) or 0),
    )


async def _attempt(cred: ResolvedCredential, model: str, audio: bytes, audio_format: str, hint: str):
    try:
        async with limited_async_http_client(
            cls=provider_limiter.INTERACTIVE, timeout=_ATTEMPT_TIMEOUT_SECONDS
        ) as client:
            response = await _post_audio(client, cred, model, audio, audio_format, hint)
            response.raise_for_status()
            data = response.json()
        return parse_transcription(
            data,
            model=model,
            own_key=cred.source == "byok",
            generation_id=response.headers.get("x-generation-id"),
        )
    except httpx.HTTPStatusError as exc:
        logger.warning("Dictation model %s returned HTTP %s", model, exc.response.status_code)
    except (httpx.HTTPError, ValueError) as exc:
        logger.warning("Dictation model %s failed: %s", model, type(exc).__name__)
    return None


async def transcribe(cred: ResolvedCredential, audio: bytes, audio_format: str, hint: str) -> Transcription | None:
    for model in dictation_models(cred.base_url):
        result = await _attempt(cred, model, audio, audio_format, hint)
        if result is not None:
            return result
    return None


def record_dictation_cost(
    organization_id: str | None, user_id: str | None, result: Transcription, duration_ms: int | None
) -> None:
    if not organization_id:
        return
    seconds = result.audio_seconds if result.audio_seconds is not None else (duration_ms or 0) / 1000
    tracker = CostTracker(organization_id=organization_id, user_id=user_id, activity=USAGE_ACTIVITY_DICTATION)
    tracker.record(
        UsageEvent(
            model=result.model,
            requested_model=result.model,
            generation_id=result.generation_id,
            prompt_tokens=result.input_tokens,
            completion_tokens=result.output_tokens,
            total_tokens=result.input_tokens + result.output_tokens,
            cached_tokens=0,
            reasoning_tokens=0,
            cost_usd=result.cost_usd or 0.0,
            cost_source="usage_field" if result.cost_usd is not None else "missing",
            is_byok=result.is_byok,
            role=USAGE_ROLE_DICTATION,
            audio_seconds=round(seconds, 2),
        )
    )
    tracker.flush(wait=False)


def _decode_audio(audio_base64: str) -> bytes | str:
    try:
        audio = base64.b64decode(audio_base64, validate=True)
    except binascii.Error, ValueError:
        return "audio_invalid"
    if not audio:
        return "audio_invalid"
    return audio if len(audio) <= MAX_DICTATION_AUDIO_BYTES else "audio_too_large"


def add_dictation_routes(router: APIRouter) -> None:

    @router.post(
        "/v1/dictation",
        response_model=DictationResponse,
        tags=["conversations"],
        summary="Transcribe one dictated utterance for the chat composer",
        description="Transcribes recorded audio without fixing its language and removes filler sounds.",
    )
    async def dictation(
        request: DictationRequest,
        http_request: Request,
        x_grid_organization_id: str | None = Header(default=None),
        x_grid_user_id: str | None = Header(default=None),
    ) -> DictationResponse:
        _require_internal_token(http_request)
        audio = _decode_audio(request.audio_base64)
        if isinstance(audio, str):
            return DictationResponse(error=audio)

        cred = await asyncio.to_thread(_credential, x_grid_organization_id)
        if not cred.api_key:
            return DictationResponse(error="transcription_not_configured")

        result = await transcribe(cred, audio, request.format, wording_hint(request.locale))
        if result is None:
            return DictationResponse(error="transcription_failed")

        record_dictation_cost(x_grid_organization_id, x_grid_user_id, result, request.duration_ms)
        return DictationResponse(
            text=clean_transcript(result.text), audio_seconds=result.audio_seconds, model=result.model
        )
