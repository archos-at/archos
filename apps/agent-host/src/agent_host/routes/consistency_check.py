import asyncio
import logging
import os

import httpx
from fastapi import APIRouter
from fastapi import Header

from agent.common import provider_limiter
from agent.common.credential_resolution import ResolvedCredential
from agent.common.openrouter import limited_async_http_client
from agent.observability.direct_trace import observed_generation

from ..models.requests import ConsistencyCheckRequest
from ..models.requests import ConsistencyCheckResponse
from ..models.requests import ConsistencyFinding
from ._llm_json import extract_json_object
from ._llm_json import message_content

logger = logging.getLogger(__name__)

_VALID_SEVERITIES = {"warning", "inconsistency"}

SYSTEM_PROMPT = (
    "You are a building-code intake reviewer for an Austrian (OIB) architectural "
    "platform. A user filled in a project-intake wizard. You are given two lists "
    "of field/value pairs: FREE-TEXT ANSWERS (free-form notes the user typed) and "
    "STRUCTURED ANSWERS (fixed choices/numbers, given only as read-only context). "
    "Your ONLY job is to judge the FREE-TEXT answers: report a finding when a "
    "free-text answer CONTRADICTS one of the structured answers, or contradicts "
    "another free-text answer, or is internally self-contradictory. "
    "Only ever flag a free-text field. NEVER flag a contradiction that is purely "
    "between two structured answers — those are checked elsewhere. "
    "Do NOT report missing, skipped, or unknown answers — incompleteness is fine. "
    "Do NOT invent facts, apply external requirements, or nitpick style/wording; "
    "only report clear contradictions. If there is no contradiction, return an "
    "empty findings list. "
    "Respond with ONLY a JSON object of the form "
    '{"findings": [{"fields": ["<exact field label>", ...], '
    '"severity": "warning" | "inconsistency", "explanation": "<one or two sentences>"}]}. '
    'Each finding\'s "fields" MUST include the free-text field label, plus any '
    "structured field label it contradicts (echoed EXACTLY as given). "
    'Use "inconsistency" for a hard contradiction and "warning" for something '
    "merely worth double-checking. No prose outside the JSON, no markdown fences."
)


def _llm_settings(organization_id: str | None = None) -> ResolvedCredential:
    from agent.common.credential_resolution import read_api_key_env
    from agent.common.credential_resolution import resolve_llm_credential

    openrouter_key = read_api_key_env("OPENROUTER_API_KEY")
    default_model = "openai/gpt-6-luna" if openrouter_key else "gpt-4o-mini"
    default_base = "https://openrouter.ai/api/v1" if openrouter_key else "https://api.openai.com/v1"

    model = os.getenv("CONSISTENCY_LLM_MODEL", os.getenv("LLM_MODEL", default_model))
    base_url = os.getenv("CONSISTENCY_LLM_BASE_URL", os.getenv("LLM_BASE_URL", default_base))

    cred = resolve_llm_credential(
        primary_env="CONSISTENCY_LLM_API_KEY",
        fallback_envs=("LLM_API_KEY", "OPENROUTER_API_KEY"),
        default_base_url=base_url,
        default_model=model,
        organization_id=organization_id,
    )
    if not cred.api_key:
        logger.warning(
            "No API key for consistency-check LLM (BYOK / CONSISTENCY_LLM_API_KEY / LLM_API_KEY / OPENROUTER_API_KEY)"
        )
    return cred


def _render_fields(fields: list) -> str:
    return "\n".join(f"- {item.field}: {item.value}" for item in fields)


def _parse_findings(content: str | None) -> list[ConsistencyFinding] | None:
    try:
        data = extract_json_object(content)
    except ValueError:
        return None

    raw_findings = data.get("findings")
    if raw_findings is None:
        return []
    if not isinstance(raw_findings, list):
        return None

    findings: list[ConsistencyFinding] = []
    for entry in raw_findings:
        if not isinstance(entry, dict):
            continue
        explanation = entry.get("explanation")
        if not isinstance(explanation, str) or not explanation.strip():
            continue
        severity = entry.get("severity")
        if severity not in _VALID_SEVERITIES:
            severity = "warning"
        raw_fields = entry.get("fields")
        fields = [f for f in raw_fields if isinstance(f, str)] if isinstance(raw_fields, list) else []
        findings.append(ConsistencyFinding(fields=fields, severity=severity, explanation=explanation.strip()))
    return findings


def add_consistency_check_routes(router: APIRouter) -> None:

    @router.post(
        "/v1/consistency-check",
        response_model=ConsistencyCheckResponse,
        tags=["projects"],
        summary="Detect internal contradictions between intake answers",
        description=(
            "Calls an LLM to detect internal contradictions between the intake "
            "answers the wizard collected. Best-effort: always HTTP 200; failures "
            "return an error code with findings=null so the wizard can save anyway."
        ),
    )
    async def consistency_check(
        request: ConsistencyCheckRequest,
        x_grid_organization_id: str | None = Header(default=None),
    ) -> ConsistencyCheckResponse:
        if not request.free_text:
            return ConsistencyCheckResponse(findings=[])

        cred = await asyncio.to_thread(_llm_settings, x_grid_organization_id)
        if not cred.api_key:
            return ConsistencyCheckResponse(findings=None, error="llm_not_configured")

        language = "German" if request.locale.lower().startswith("de") else "English"
        structured_block = (
            f"Structured answers (read-only context — do NOT flag these against each other):\n"
            f"{_render_fields(request.structured)}\n\n"
            if request.structured
            else ""
        )
        user_content = (
            f"Write every explanation in {language}.\n\n"
            f"{structured_block}"
            "Free-text answers (scrutinise these):\n"
            f"{_render_fields(request.free_text)}"
        )

        headers = {"Content-Type": "application/json", "Authorization": f"Bearer {cred.api_key}"}
        payload = cred.request_body(
            {
                "model": cred.model,
                "temperature": 0.1,
                "max_tokens": 800,
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
                    "consistency-check", model=cred.model, messages=payload.get("messages")
                ) as generation,
                limited_async_http_client(cls=provider_limiter.INTERACTIVE, timeout=30.0) as client,
            ):
                response = await client.post(f"{cred.base_url}/chat/completions", json=payload, headers=headers)
                response.raise_for_status()
                data = response.json()
                generation.finish(data)
        except httpx.HTTPStatusError as exc:
            logger.warning(
                "Consistency-check LLM returned an error status: %s (%s)",
                exc.response.status_code if exc.response is not None else "unknown",
                type(exc).__name__,
            )
            return ConsistencyCheckResponse(findings=None, error="llm_request_failed")
        except httpx.RequestError as exc:
            logger.warning("Consistency-check LLM request failed: %s", type(exc).__name__)
            return ConsistencyCheckResponse(findings=None, error="llm_request_failed")
        except Exception:
            logger.exception("Unexpected error calling consistency-check LLM")
            return ConsistencyCheckResponse(findings=None, error="llm_request_failed")

        try:
            content, finish_reason = message_content(data)
        except ValueError:
            logger.warning("Consistency-check LLM response had an unexpected shape")
            return ConsistencyCheckResponse(findings=None, error="llm_response_malformed")

        findings = _parse_findings(content)
        if findings is None:
            logger.warning(
                "Consistency-check LLM returned unparseable findings JSON (finish_reason=%s, %d chars)",
                finish_reason,
                len(content or ""),
            )
            return ConsistencyCheckResponse(findings=None, error="llm_response_malformed")

        return ConsistencyCheckResponse(findings=findings)
