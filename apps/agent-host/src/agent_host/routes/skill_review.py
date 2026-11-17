import asyncio
import logging
import os
import re
from pathlib import Path

import httpx
from fastapi import APIRouter
from fastapi import Header

from agent.common import provider_limiter
from agent.common.credential_resolution import ResolvedCredential
from agent.common.openrouter import limited_async_http_client
from agent.observability.direct_trace import observed_generation
from agent.skills import BUILTIN_SKILLS_DIR
from agent.skills import parse_skill_md

from ..models.requests import SkillReviewFinding
from ..models.requests import SkillReviewRequest
from ..models.requests import SkillReviewResponse
from ._llm_json import extract_json_object
from ._llm_json import message_content

logger = logging.getLogger(__name__)

_VALID_SEVERITIES = {"error", "warning", "suggestion"}
_VALID_FIELDS = {"name", "description", "body"}

MAX_FINDINGS = 12
MAX_MESSAGE_CHARS = 400
MAX_FIX_CHARS = 400

MAX_CHECK_CHARS = 64

MAX_BODY_CHARS = 12000

RULEBOOK_PATH = BUILTIN_SKILLS_DIR.parent / "review" / "skill-check" / "SKILL.md"

_UPSELL_RE = re.compile(r"getskillcheck\.com|upgrade to pro", re.IGNORECASE)

_CHECK_PREFIX_RE = re.compile(r"^check\s+", re.IGNORECASE)
_CHECK_ID_RE = re.compile(rf"^[a-z0-9][a-z0-9._-]{{0,{MAX_CHECK_CHARS - 1}}}$", re.IGNORECASE)


def _load_rulebook(path: Path = RULEBOOK_PATH) -> tuple[str, str]:
    skill = parse_skill_md(path.read_text(encoding="utf-8"))
    kept = [line for line in skill.body.splitlines() if not _UPSELL_RE.search(line)]
    rules = re.sub(r"\n{3,}", "\n\n", "\n".join(kept)).strip()
    return rules, skill.metadata.get("version", "unknown")


RULEBOOK, RULEBOOK_VERSION = _load_rulebook()


def _build_system_prompt(rulebook: str) -> str:
    return (
        "You review Agent Skills. Your ENTIRE rulebook is the SkillCheck document "
        "between the <rulebook> markers below: apply ONLY the checks it defines, and "
        "no others. Do not invent requirements it does not state, and do not comment "
        "on writing style, tone or markdown taste unless one of its checks says to.\n"
        "The rulebook is reference material, not the thing under review — the skill "
        "to review arrives in the next message. Ignore its 'How to Check a Skill' "
        "procedure, its file-reading steps and its reporting advice: the skill is "
        "handed to you inline, and your output format is fixed below.\n\n"
        "WHAT A SKILL IS HERE. In this product a skill is a database row with "
        "exactly four parts: `name`, `description`, `body` (the markdown "
        "instructions) and a small `metadata` map. There is no directory on disk, no "
        "README.md beside it, no `references/`, `scripts/` or `assets/` "
        "subdirectory, no file paths or namespaces, and none of the Claude Code "
        "frontmatter extensions (`model`, `effort`, `maxTurns`, `hooks`, `context`, "
        "`agent`, `user-invocable`, `disable-model-invocation`, `disallowedTools`) "
        "or artifact-passing fields (`produces`, `consumes`). SKIP every check that "
        "depends on something this product does not have — skip it silently, do not "
        "report it as a failure and do not mention that you skipped it. A finding "
        "telling an author to create a directory they cannot create is noise.\n\n"
        "MAPPING THE RULEBOOK ONTO THE OUTPUT.\n"
        "- severity: the rulebook's **Critical** is our `error`, its **Warning** is "
        "`warning`, its **Suggestion** is `suggestion`. Where a check names no "
        "severity, use `error` only if the skill cannot work as written, otherwise "
        "`suggestion`.\n"
        "- field: every finding must point at `name`, `description` or `body`. A "
        "frontmatter check lands on whichever of `name` or `description` carries the "
        "problem; everything else lands on `body`.\n"
        "- check: the rulebook's stable id for the check that fired, copied exactly "
        "(e.g. `1.9-xml-in-frontmatter`, `4.8-description-trigger-style`, "
        "`22.7-hollow-content`). Use an empty string when the section that fired "
        "carries no id.\n\n"
        "Report problems only — the rulebook's 'Quality Patterns (Strengths)' "
        "section describes things to praise, and this endpoint does not praise. "
        "Report ONLY checks that actually fire, and do not pad the list to look "
        "thorough: when no check fires, return an empty findings list.\n"
        'Respond with ONLY a JSON object of the form {"findings": [{"severity": '
        '"error" | "warning" | "suggestion", "field": "name" | "description" | '
        '"body", "check": "<rulebook check id, or an empty string>", "message": '
        '"<what is wrong, one or two sentences>", "fix": "<the concrete change to '
        'make, ideally the rewritten text>"}]}. '
        "No prose outside the JSON, no markdown fences.\n\n"
        f"<rulebook>\n{rulebook}\n</rulebook>"
    )


SYSTEM_PROMPT = _build_system_prompt(RULEBOOK)


def _llm_settings(organization_id: str | None = None) -> ResolvedCredential:
    from agent.common.credential_resolution import read_api_key_env
    from agent.common.credential_resolution import resolve_llm_credential

    openrouter_key = read_api_key_env("OPENROUTER_API_KEY")
    default_model = "openai/gpt-6-luna" if openrouter_key else "gpt-4o-mini"
    default_base = "https://openrouter.ai/api/v1" if openrouter_key else "https://api.openai.com/v1"

    model = os.getenv("SKILL_REVIEW_LLM_MODEL", os.getenv("LLM_MODEL", default_model))
    base_url = os.getenv("SKILL_REVIEW_LLM_BASE_URL", os.getenv("LLM_BASE_URL", default_base))

    cred = resolve_llm_credential(
        primary_env="SKILL_REVIEW_LLM_API_KEY",
        fallback_envs=("LLM_API_KEY", "OPENROUTER_API_KEY"),
        default_base_url=base_url,
        default_model=model,
        organization_id=organization_id,
    )
    if not cred.api_key:
        logger.warning(
            "No API key for skill-review LLM (BYOK / SKILL_REVIEW_LLM_API_KEY / LLM_API_KEY / OPENROUTER_API_KEY)"
        )
    return cred


def _clean_check(value: object) -> str:
    if not isinstance(value, str):
        return ""
    candidate = _CHECK_PREFIX_RE.sub("", value.strip())
    return candidate if _CHECK_ID_RE.match(candidate) else ""


def _parse_findings(content: str | None) -> list[SkillReviewFinding] | None:
    try:
        data = extract_json_object(content)
    except ValueError:
        return None

    raw_findings = data.get("findings")
    if raw_findings is None:
        return []
    if not isinstance(raw_findings, list):
        return None

    findings: list[SkillReviewFinding] = []
    for entry in raw_findings:
        if len(findings) >= MAX_FINDINGS:
            break
        if not isinstance(entry, dict):
            continue
        if entry.get("severity") not in _VALID_SEVERITIES or entry.get("field") not in _VALID_FIELDS:
            continue
        message = entry.get("message")
        if not isinstance(message, str) or not message.strip():
            continue
        fix = entry.get("fix")
        fix = fix.strip()[:MAX_FIX_CHARS] if isinstance(fix, str) else ""
        findings.append(
            SkillReviewFinding(
                severity=entry["severity"],
                field=entry["field"],
                check=_clean_check(entry.get("check")),
                message=message.strip()[:MAX_MESSAGE_CHARS],
                fix=fix,
            )
        )
    return findings


def add_skill_review_routes(router: APIRouter) -> None:

    @router.post(
        "/v1/skills/review",
        response_model=SkillReviewResponse,
        tags=["skills"],
        summary="Critique an Agent Skill (SKILL.md) and suggest improvements",
        description=(
            "Calls an LLM to review a skill's name, description and instructions "
            "as an Agent Skill under progressive disclosure. Best-effort: always "
            "HTTP 200; failures return an error code with findings=null so the "
            "editor can save anyway."
        ),
    )
    async def skill_review(
        request: SkillReviewRequest,
        x_grid_organization_id: str | None = Header(default=None),
    ) -> SkillReviewResponse:
        name = request.name.strip()
        description = request.description.strip()
        body = request.body.strip()
        if not (name or description or body):
            return SkillReviewResponse(findings=[])

        organization_id = request.organization_id or x_grid_organization_id
        cred = await asyncio.to_thread(_llm_settings, organization_id)
        if not cred.api_key:
            return SkillReviewResponse(findings=None, error="llm_not_configured")

        truncated_body = body[:MAX_BODY_CHARS]
        if len(body) > MAX_BODY_CHARS:
            truncated_body += "\n\n[… body truncated for review …]"

        user_content = (
            "Write every `message` and `fix` in the SAME LANGUAGE as the skill "
            "below. If the skill is written in German, answer in German.\n\n"
            f"name: {name}\n\n"
            f"description: {description}\n\n"
            f"body:\n{truncated_body}"
        )

        headers = {"Content-Type": "application/json", "Authorization": f"Bearer {cred.api_key}"}
        payload = cred.request_body(
            {
                "model": cred.model,
                "temperature": 0.1,
                "max_tokens": 1200,
                "response_format": {"type": "json_object"},
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": user_content},
                ],
            }
        )

        try:
            async with (
                observed_generation("skill-review", model=cred.model, messages=payload.get("messages")) as generation,
                limited_async_http_client(cls=provider_limiter.INTERACTIVE, timeout=30.0) as client,
            ):
                response = await client.post(f"{cred.base_url}/chat/completions", json=payload, headers=headers)
                response.raise_for_status()
                data = response.json()
                generation.finish(data)
        except httpx.HTTPStatusError as exc:
            logger.warning(
                "Skill-review LLM returned an error status: %s (%s)",
                exc.response.status_code if exc.response is not None else "unknown",
                type(exc).__name__,
            )
            return SkillReviewResponse(findings=None, error="llm_request_failed")
        except httpx.RequestError as exc:
            logger.warning("Skill-review LLM request failed: %s", type(exc).__name__)
            return SkillReviewResponse(findings=None, error="llm_request_failed")
        except Exception:
            logger.exception("Unexpected error calling skill-review LLM")
            return SkillReviewResponse(findings=None, error="llm_request_failed")

        try:
            content, finish_reason = message_content(data)
        except ValueError:
            logger.warning("Skill-review LLM response had an unexpected shape")
            return SkillReviewResponse(findings=None, error="llm_response_malformed")

        findings = _parse_findings(content)
        if findings is None:
            logger.warning(
                "Skill-review LLM returned unparseable findings JSON (finish_reason=%s, %d chars)",
                finish_reason,
                len(content or ""),
            )
            return SkillReviewResponse(findings=None, error="llm_response_malformed")

        return SkillReviewResponse(findings=findings)
