from __future__ import annotations

import asyncio
import base64
import logging
from collections.abc import Mapping
from dataclasses import dataclass
from dataclasses import replace
from typing import Any

import httpx

from agent.common import provider_limiter
from agent.common.credential_resolution import ResolvedCredential
from agent.common.image_redaction import redact_inline_images
from agent.common.json_utils import extract_json
from agent.common.openrouter import limited_async_http_client
from agent.common.openrouter import vision_reasoning_body
from agent.observability.direct_trace import observed_generation
from agent.project_context import get_organization_id_from_context

logger = logging.getLogger(__name__)

TRACE_NAME = "look-reading"
PROMPT_VERSION = 1

DEFAULT_QUESTION = "What does this region show: labels, dimensions, symbols, counts?"

MAX_READINGS = 8
MAX_READING_CHARS = 400
MAX_SUMMARY_CHARS = 400
KINDS = ("dimension", "count", "date", "label", "symbol", "other")
CONFIDENCES = ("high", "medium", "low")
MAX_COMPLETION_TOKENS = 900
REQUEST_TIMEOUT_SECONDS = 60.0

PROMPT = (
    "You read a drawing for an architect. Below is one crop of a page (or the page itself) and a question. "
    "Answer ONLY from what is printed or drawn in the image. Copy dimensions, labels, dates and numbers exactly "
    "as written, with their unit; do not compute, convert or infer a value that is not there. If something the "
    "question needs is not visible in this crop, say so in the summary instead of guessing. Reply with ONLY a "
    'JSON object: {"readings": [{"text": string, "kind": "dimension"|"count"|"date"|"label"|"symbol"|"other", '
    '"confidence": "high"|"medium"|"low"}], "summary": string}. At most '
    f"{MAX_READINGS} readings, each under {MAX_READING_CHARS} characters; the summary is one short sentence. "
    "Write the readings in the language of the drawing."
)


@dataclass(frozen=True)
class ReadingLine:
    text: str
    kind: str
    confidence: str


@dataclass(frozen=True)
class Reading:
    lines: tuple[ReadingLine, ...] = ()
    summary: str = ""
    model: str = ""
    failure: str = ""

    @property
    def usable(self) -> bool:
        return not self.failure and bool(self.lines or self.summary)


def _clip(value: Any, limit: int) -> str:
    return " ".join(value.split())[:limit].rstrip() if isinstance(value, str) else ""


def parse_reading(data: Mapping[str, Any], model: str = "") -> Reading:
    raw = data.get("readings")
    lines: list[ReadingLine] = []
    for item in raw if isinstance(raw, list) else ():
        if not isinstance(item, Mapping):
            continue
        text = _clip(item.get("text"), MAX_READING_CHARS)
        if not text:
            continue
        kind, confidence = item.get("kind"), item.get("confidence")
        lines.append(
            ReadingLine(
                text,
                kind if kind in KINDS else "other",
                confidence if confidence in CONFIDENCES else "low",
            )
        )
        if len(lines) == MAX_READINGS:
            break
    return Reading(tuple(lines), _clip(data.get("summary"), MAX_SUMMARY_CHARS), model)


def _vision_settings(organization_id: str | None) -> ResolvedCredential:
    from knowledge_layer.ingest import resolve_vlm_credential

    cred = resolve_vlm_credential(organization_id)
    if not organization_id:
        return cred
    try:
        from agent.common.model_overrides import AgentGroup
        from agent.common.model_overrides import resolve_org_model_overrides

        override = resolve_org_model_overrides(organization_id).get(AgentGroup.INGEST_VLM.value)
    except Exception:  # noqa: BLE001 - model selection must never take a look down
        logger.warning("Vision model override could not be read for a reading", exc_info=True)
        override = None
    return replace(cred, model=override) if override else cred


def build_messages(question: str, jpeg: bytes) -> list[dict[str, Any]]:
    image = f"data:image/jpeg;base64,{base64.b64encode(jpeg).decode('ascii')}"
    return [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": PROMPT},
                {"type": "text", "text": f"Question: {question}"},
                {"type": "image_url", "image_url": {"url": image}},
            ],
        }
    ]


def _reply_text(data: Any) -> str:
    try:
        content = data["choices"][0]["message"]["content"]
    except KeyError, IndexError, TypeError:
        return ""
    return content if isinstance(content, str) else ""


def _book(data: Any, cred: ResolvedCredential) -> None:
    if not isinstance(data, Mapping):
        return
    from agent.common.cost_tracking import USAGE_ROLE_LOOK_READING
    from agent.common.cost_tracking import record_completion_usage

    record_completion_usage(
        data, role=USAGE_ROLE_LOOK_READING, requested_model=cred.model, is_byok=cred.source == "byok"
    )


async def read_region(jpeg: bytes, question: str, *, region: bool = False) -> Reading:
    try:
        cred = await asyncio.to_thread(_vision_settings, get_organization_id_from_context())
    except Exception:  # noqa: BLE001 - a look must not fail over its second reader
        logger.warning("look: the vision endpoint could not be resolved", exc_info=True)
        return Reading(failure="the vision model could not be resolved")
    if not cred.api_key:
        return Reading(failure="no vision model is configured", model=cred.model)

    messages = build_messages(question, jpeg)
    body = cred.request_body(
        {
            "model": cred.model,
            "temperature": 0,
            "max_tokens": MAX_COMPLETION_TOKENS,
            "messages": messages,
            **vision_reasoning_body(cred.base_url),
        }
    )
    headers = {"Content-Type": "application/json", "Authorization": f"Bearer {cred.api_key}"}
    try:
        async with (
            observed_generation(
                TRACE_NAME,
                model=cred.model,
                messages=redact_inline_images(messages),
                metadata={"prompt_version": PROMPT_VERSION, "region": region},
            ) as generation,
            limited_async_http_client(cls=provider_limiter.INTERACTIVE, timeout=REQUEST_TIMEOUT_SECONDS) as client,
        ):
            response = await client.post(f"{cred.base_url}/chat/completions", json=body, headers=headers)
            response.raise_for_status()
            data = response.json()
            generation.finish(data)
            _book(data, cred)
    except (httpx.HTTPError, ValueError) as exc:
        logger.warning("look: the reading request failed: %s", type(exc).__name__)
        return Reading(failure="the vision model could not be reached", model=cred.model)
    except Exception:  # noqa: BLE001 - never raises
        logger.warning("look: the reading failed", exc_info=True)
        return Reading(failure="the vision model failed", model=cred.model)

    parsed = extract_json(_reply_text(data))
    if not isinstance(parsed, dict):
        return Reading(failure="the vision model did not answer in the requested form", model=cred.model)
    reading = parse_reading(parsed, cred.model)
    if not reading.usable:
        return Reading(failure="the vision model read nothing in this crop", model=cred.model)
    return reading


VALUE_KINDS = ("dimension", "count", "date")
MAX_CARD_VALUE_LINES = 2


def card_reading(reading: Reading) -> str:
    if not reading.usable:
        return ""
    values = [
        line.text
        for line in reading.lines
        if line.kind in VALUE_KINDS or (line.kind in ("label", "symbol") and any(c.isdigit() for c in line.text))
    ]
    if values:
        return "; ".join(values[:MAX_CARD_VALUE_LINES])
    return reading.summary or (reading.lines[0].text if reading.lines else "")


def render_readings_parts(reading: Reading, *, blind: bool) -> tuple[str, str]:
    if reading.failure:
        return render_readings(reading, blind=blind), ""
    head, _, rows = render_readings(reading, blind=blind).partition("\n")
    return head, rows


def render_readings(reading: Reading, *, blind: bool) -> str:
    if reading.failure:
        tail = (
            " You cannot see the image either: say plainly that you could not read this region, and do not guess "
            "what it shows."
            if blind
            else " Look at the image yourself."
        )
        return f"No reading was made ({reading.failure}).{tail}"
    head = (
        "Readings of this region, made by a second reader (a vision model) from the image: a reading of the "
        "drawing, not a measurement. "
        + (
            "You cannot see the image, so these are all you have: attribute them to the reading, never present "
            "them as measured."
            if blind
            else "Say so if you see otherwise."
        )
    )
    rows = [f"Gelesen: {line.text} ({line.kind}, {line.confidence})" for line in reading.lines]
    if reading.summary:
        rows.append(f"Summary: {reading.summary}")
    return "\n".join([head, *rows])
