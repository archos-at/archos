import asyncio
import logging

import httpx
from fastapi import APIRouter
from fastapi import Header

from agent.common import provider_limiter
from agent.common.openrouter import limited_async_http_client
from agent.observability.direct_trace import observed_generation

from ..models.writing_requests import GenerateConversationTitleRequest
from ..models.writing_requests import GenerateConversationTitleResponse
from ._llm_json import extract_json_object
from ._llm_json import message_content
from .generate_summary import _llm_settings

logger = logging.getLogger(__name__)

_MAX_CHARS_PER_MESSAGE = 1200
_MAX_TITLE_CHARS = 80

_MAX_COMPLETION_TOKENS = 300

SYSTEM_PROMPT = (
    "You name chat conversations for an Austrian building-code (OIB Richtlinien) "
    "compliance assistant. Given the opening messages of a conversation, produce "
    "a SHORT, specific title describing what the inquiry was about — like the "
    "auto-generated titles in ChatGPT. Rules for the title: 3 to 6 words, no "
    "trailing punctuation, no surrounding quotes, no markdown, Title Case is not "
    "required. Then choose 0 to 3 topic tags STRICTLY from the provided list that "
    "match the subject; if none clearly fit, return an empty tag list. "
    'Respond with ONLY a JSON object: {"title": string, "tags": string[]}.'
)


def _build_transcript(messages: list, locale_name: str) -> str:
    lines: list[str] = []
    for message in messages:
        content = (message.content or "").strip()
        if not content:
            continue
        if len(content) > _MAX_CHARS_PER_MESSAGE:
            content = content[:_MAX_CHARS_PER_MESSAGE] + "…"
        role = "User" if message.role == "user" else "Assistant"
        lines.append(f"{role}: {content}")
    return "\n\n".join(lines)


def _parse_llm_json(raw: str | None) -> tuple[str, list[str]]:
    data = extract_json_object(raw)

    title = data.get("title", "")
    if not isinstance(title, str):
        raise ValueError("title is not a string")

    raw_tags = data.get("tags", [])
    tags = [t for t in raw_tags if isinstance(t, str)] if isinstance(raw_tags, list) else []
    return title, tags


def _clean_title(title: str) -> str:
    cleaned = title.strip().strip("\"'").strip()
    cleaned = cleaned.rstrip(".")
    if len(cleaned) > _MAX_TITLE_CHARS:
        cleaned = cleaned[: _MAX_TITLE_CHARS - 1].rstrip() + "…"
    return cleaned


def add_generate_conversation_title_routes(router: APIRouter) -> None:

    @router.post(
        "/v1/generate-conversation-title",
        response_model=GenerateConversationTitleResponse,
        tags=["conversations"],
        summary="Name a conversation and assign OIB topic tags",
        description=(
            "Calls an LLM to produce a concise conversation title and 0–3 topic "
            "tags (from a closed vocabulary) for the opening exchange of a chat."
        ),
    )
    async def generate_conversation_title(
        request: GenerateConversationTitleRequest,
        x_grid_organization_id: str | None = Header(default=None),
    ) -> GenerateConversationTitleResponse:
        language = "German" if request.locale.lower().startswith("de") else "English"
        transcript = _build_transcript(request.messages, language)
        if not transcript:
            return GenerateConversationTitleResponse(title="", tags=[])

        allowed = [t.strip() for t in request.allowed_tags if isinstance(t, str) and t.strip()]

        cred = await asyncio.to_thread(_llm_settings, x_grid_organization_id)
        if not cred.api_key:
            return GenerateConversationTitleResponse(title="", tags=[], error="llm_not_configured")

        headers = {"Content-Type": "application/json", "Authorization": f"Bearer {cred.api_key}"}

        allowed_line = ", ".join(allowed) if allowed else "(none — return an empty tags list)"
        user_content = f"Write the title in {language}.\nAllowed tags: {allowed_line}\n\nConversation:\n{transcript}"

        payload = cred.request_body(
            {
                "model": cred.model,
                "temperature": 0.3,
                "max_tokens": _MAX_COMPLETION_TOKENS,
                "response_format": {"type": "json_object"},
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": user_content},
                ],
            }
        )

        try:
            async with (
                observed_generation(
                    "conversation-title", model=cred.model, messages=payload.get("messages")
                ) as generation,
                limited_async_http_client(cls=provider_limiter.INTERACTIVE, timeout=30.0) as client,
            ):
                response = await client.post(f"{cred.base_url}/chat/completions", json=payload, headers=headers)
                response.raise_for_status()
                data = response.json()
                generation.finish(data)
        except httpx.HTTPStatusError as exc:
            logger.warning(
                "Conversation-title LLM returned an error status: %s (%s)",
                exc.response.status_code if exc.response is not None else "unknown",
                type(exc).__name__,
            )
            return GenerateConversationTitleResponse(title="", tags=[], error="llm_request_failed")
        except httpx.RequestError as exc:
            logger.warning("Conversation-title LLM request failed: %s", type(exc).__name__)
            return GenerateConversationTitleResponse(title="", tags=[], error="llm_request_failed")
        except Exception:
            logger.exception("Unexpected error calling conversation-title LLM")
            return GenerateConversationTitleResponse(title="", tags=[], error="llm_request_failed")

        try:
            raw, finish_reason = message_content(data)
        except ValueError:
            logger.warning("Conversation-title LLM response had an unexpected shape")
            return GenerateConversationTitleResponse(title="", tags=[], error="llm_response_malformed")

        try:
            raw_title, raw_tags = _parse_llm_json(raw)
        except ValueError:
            logger.warning(
                "Conversation-title LLM did not return usable JSON (finish_reason=%s, %d chars)",
                finish_reason,
                len(raw or ""),
            )
            return GenerateConversationTitleResponse(title="", tags=[], error="llm_response_malformed")

        title = _clean_title(raw_title)
        if not title:
            logger.warning("Conversation-title LLM returned JSON without a usable title")
        allowed_set = set(allowed)
        seen: list[str] = []
        for tag in raw_tags:
            key = tag.strip().lower()
            if key in allowed_set and key not in seen:
                seen.append(key)
            if len(seen) >= 3:
                break

        return GenerateConversationTitleResponse(title=title, tags=seen)
