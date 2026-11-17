from __future__ import annotations

import asyncio
import logging
import re
from typing import Any
from typing import Literal

from langchain_core.messages import HumanMessage
from langchain_core.messages import SystemMessage
from pydantic import BaseModel
from pydantic import ConfigDict
from pydantic import Field
from pydantic import ValidationError
from pydantic import model_validator

from agent.common.bff_http import SignedEnvelope
from agent.common.json_utils import extract_json
from agent.common.structured_reply import structured_reply
from agent.knowledge.personal_memory import VALID_PERSONAL_KINDS
from agent.knowledge.personal_memory import forget_personal_memory_item
from agent.knowledge.personal_memory import insert_personal_memory_item
from agent.knowledge.project_memory import VALID_CONFIDENCES
from agent.knowledge.project_memory import insert_memory_item
from agent.knowledge.project_memory import looks_like_personal_data
from agent.knowledge.project_memory import looks_like_secret
from agent.knowledge.project_memory import memory_topic
from agent.memory.reflection_prompt import MAX_NEW_ITEMS
from agent.memory.reflection_prompt import REFLECTION_SYSTEM_PROMPT
from agent.memory.restriction import RestrictionDecision
from agent.memory.restriction import RestrictionEvidence
from agent.memory.restriction import restriction_decisions

logger = logging.getLogger(__name__)

_MAX_CONTENT_CHARS = 500
_MAX_ANSWER_CHARS = 4000
_MAX_QUERY_CHARS = 2000
_MAX_DIGEST_CHARS = 6000
_MAX_PERSONAL_CHARS = 1600
_NEUTRAL_IMPORTANCE = 5


def _lowered(value: Any) -> Any:
    return value.strip().lower() if isinstance(value, str) else value


def _one_of(value: Any, allowed: set[str], fallback: str) -> str:
    text = _lowered(value)
    return text if text in allowed else fallback


_PROJECT_ONLY_KINDS = frozenset({"decision", "constraint", "open_question", "derived_fact"})


def _about(value: Any, kind: Any) -> str | None:
    about = _lowered(value)
    if about in ("project", "person"):
        return about
    if kind in _PROJECT_ONLY_KINDS:
        return "project"
    return "person" if kind == "profile" else None


def _clamped_importance(value: Any) -> int:
    try:
        importance = int(value)
    except TypeError, ValueError:
        return _NEUTRAL_IMPORTANCE
    return min(10, max(1, importance))


class _ReflectionFinding(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        json_schema_extra={
            "description": (
                "One durable finding proposed by the reflection stage, about the project or about the person."
            )
        },
    )

    about: Literal["project", "person"] = Field(
        description=(
            "Whom the finding is about. 'person': the person asking (how they want the assistant to work, "
            "their role, responsibilities, recurring topics, anything said in confidence); kept where only "
            "they read it. 'project': the project itself; read by every member of the project."
        )
    )
    kind: Literal["decision", "constraint", "open_question", "derived_fact", "preference", "profile"] = Field(
        description=(
            "Finding category. About the person: 'preference' or 'profile'. About the project: 'decision', "
            "'constraint', 'open_question', 'derived_fact', or 'preference' for how the team wants the "
            "assistant to work on this project."
        )
    )
    content: str = Field(
        description="One concise, self-contained sentence. Empty only to remove the personal note named in supersedes."
    )
    confidence: Literal["low", "medium", "high"] = Field(description="Confidence in the finding.")
    importance: int = Field(
        ge=1,
        le=10,
        description=(
            "How much future answers depend on this finding, 1-10. 1-3: incidental detail "
            "(a preference about wording). 4-6: useful context. 7-8: shapes answers "
            "(a chosen construction method, a binding constraint). 9-10: getting this wrong "
            "invalidates answers (the Bundesland, the building class, a legal deadline)."
        ),
    )
    supersedes: str = Field(
        description=(
            "When this finding CORRECTS an entry in the existing memory shown to you, the "
            "verbatim content of that entry, copied exactly. Empty string when the finding "
            "adds something new instead of replacing anything."
        )
    )
    topic: str = Field(
        description=(
            "The subject the finding is filed under on its shelf: one to three words in the person's "
            "language, reusing a topic already shown in memory when one fits. Empty string if none."
        )
    )

    @model_validator(mode="before")
    @classmethod
    def _tolerate_a_loose_reply(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data
        known = {key: value for key, value in data.items() if key in cls.model_fields}
        known["kind"] = _lowered(known.get("kind"))
        known["about"] = _about(known.get("about"), known["kind"])
        if known["about"] == "person" and known["kind"] not in VALID_PERSONAL_KINDS:
            known["kind"] = "profile"
        known["content"] = str(known.get("content") or "").strip()[:_MAX_CONTENT_CHARS]
        known["confidence"] = _one_of(known.get("confidence"), VALID_CONFIDENCES, "medium")
        known["importance"] = _clamped_importance(known.get("importance"))
        known["supersedes"] = str(known.get("supersedes") or "").strip()
        known["topic"] = memory_topic(known.get("topic"))
        return known


class ReflectionOutput(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        json_schema_extra={
            "description": (
                "Strict structured-output contract for the memory-reflection stage.\n"
                "\n"
                "Strict-valid (all fields required, no extras) so it can drive OpenRouter\n"
                "native json_schema structured output. ``findings`` is an empty list when the\n"
                "turn established nothing durable — the common, correct outcome."
            )
        },
    )

    findings: list[_ReflectionFinding] = Field(description="Durable findings; empty list if none.")


def _build_user_prompt(query: str, answer: str, memory_digest: str | None, personal_memory: str | None = None) -> str:
    existing = memory_digest.strip() if memory_digest else "(no project memory recorded yet)"
    if len(existing) > _MAX_DIGEST_CHARS:
        existing = existing[:_MAX_DIGEST_CHARS] + "\n… (project memory truncated)"
    personal = (personal_memory or "").strip()[:_MAX_PERSONAL_CHARS] or "(no personal memory recorded yet)"
    return (
        "## Existing project memory\n"
        f"{existing}\n\n"
        "## Existing personal memory of the person asking\n"
        f"{personal}\n\n"
        "## User question\n"
        f"{query.strip()[:_MAX_QUERY_CHARS]}\n\n"
        "## Assistant answer\n"
        f"{answer.strip()[:_MAX_ANSWER_CHARS]}"
    )


def _normalize(text: str) -> str:
    return re.sub(r"[^a-z0-9äöüß]+", " ", text.lower()).strip()


_DIGEST_ENTRY_RE = re.compile(r'^\s*-\s*\[[^\]]*\]\s*"(.*)"\s*$')


def _digest_entry_contents(memory_digest: str | None) -> frozenset[str]:
    matches = (_DIGEST_ENTRY_RE.match(line) for line in (memory_digest or "").splitlines())
    return frozenset(filter(None, (_normalize(match.group(1)) for match in matches if match)))


def _content_in_digest(content: str, normalized_digest: str) -> bool:
    normalized_content = _normalize(content)
    return bool(normalized_content) and normalized_content in normalized_digest


def _person_finding(
    finding: _ReflectionFinding,
    *,
    normalized_personal: str,
    can_write_personal: bool,
    personal_entries: frozenset[str] = frozenset(),
) -> _ReflectionFinding | None:
    if not can_write_personal:
        logger.info("Memory reflection: dropped a personal finding; no envelope names its owner")
        return None
    if finding.supersedes and _normalize(finding.supersedes) not in personal_entries:
        logger.info("Memory reflection: ignoring a supersedes quote that is not a shown personal note")
        finding = finding.model_copy(update={"supersedes": ""})
    if not finding.content:
        return finding if finding.supersedes else None
    if _content_in_digest(finding.content, normalized_personal):
        return None
    if looks_like_secret(finding.content):
        logger.warning("Memory reflection: dropped a personal %s finding matching a secret pattern", finding.kind)
        return None
    return finding


def _finding_from_entry(
    entry: Any,
    *,
    normalized_digest: str,
    digest_entries: frozenset[str],
    normalized_personal: str = "",
    can_write_personal: bool = False,
    personal_entries: frozenset[str] = frozenset(),
) -> _ReflectionFinding | None:
    try:
        finding = _ReflectionFinding.model_validate(entry)
    except ValidationError:
        return None
    if finding.about == "person":
        if finding.content and _content_in_digest(finding.content, normalized_digest):
            return None
        return _person_finding(
            finding,
            normalized_personal=normalized_personal,
            can_write_personal=can_write_personal,
            personal_entries=personal_entries,
        )
    if not finding.content:
        return None
    if _content_in_digest(finding.content, normalized_digest):
        return None
    if finding.kind == "profile":
        return None
    if looks_like_personal_data(finding.content):
        logger.warning("Memory reflection: dropped a %s finding matching a PII/secret pattern", finding.kind)
        return None
    if not finding.supersedes or _normalize(finding.supersedes) in digest_entries:
        return finding
    logger.info("Memory reflection: ignoring a supersedes quote that is not a shown digest entry")
    return finding.model_copy(update={"supersedes": ""})


def _sanitize_findings(
    raw: Any,
    *,
    has_project: bool,
    memory_digest: str | None = None,
    personal_memory: str | None = None,
    can_write_personal: bool = False,
) -> list[_ReflectionFinding]:
    if not isinstance(raw, list) or not has_project:
        return []
    checks = {
        "normalized_digest": _normalize(memory_digest or ""),
        "digest_entries": _digest_entry_contents(memory_digest),
        "normalized_personal": _normalize(personal_memory or ""),
        "can_write_personal": can_write_personal,
        "personal_entries": _digest_entry_contents(personal_memory),
    }
    proposed = (_finding_from_entry(entry, **checks) for entry in raw)
    return [finding for finding in proposed if finding is not None][:MAX_NEW_ITEMS]


async def _write_personal_finding(
    finding: _ReflectionFinding, *, envelope: SignedEnvelope | None, conversation_id: str | None
) -> dict[str, str] | None:
    if envelope is None:
        return None
    if finding.supersedes:
        forgot = await asyncio.to_thread(forget_personal_memory_item, envelope=envelope, content=finding.supersedes)
        if forgot.removed_id is None:
            logger.info("Memory reflection: a personal correction was not written; its note was %s", forgot.refused)
            return None
        logger.info("Memory reflection: removed personal note %s", forgot.removed_id)
    if not finding.content:
        return None
    written = await asyncio.to_thread(
        insert_personal_memory_item,
        envelope=envelope,
        kind=finding.kind,
        content=finding.content,
        conversation_id=conversation_id,
        provenance_type="distillation",
        topic=finding.topic,
    )
    if written is None:
        return None
    return {"id": written.id, "kind": finding.kind, "content": finding.content, "about": "person"}


async def _write_finding(
    finding: _ReflectionFinding,
    *,
    project_id: str | None,
    organization_id: str | None,
    conversation_id: str | None,
    decision: RestrictionDecision | None = None,
    envelope: SignedEnvelope | None = None,
) -> dict[str, str] | None:
    if finding.about == "person":
        return await _write_personal_finding(finding, envelope=envelope, conversation_id=conversation_id)
    decision = decision or RestrictionDecision(None)
    item_id = await asyncio.to_thread(
        insert_memory_item,
        scope="project",
        project_id=project_id,
        organization_id=organization_id,
        kind=finding.kind,
        content=finding.content,
        confidence=finding.confidence,
        conversation_id=conversation_id,
        provenance_type="distillation",
        salience=round(finding.importance / 10.0, 2),
        supersedes_content=finding.supersedes or None,
        topic=finding.topic,
        restricted_collections=decision.restriction,
        restriction_judge=decision.judge.as_payload() if decision.judge else None,
    )
    if not item_id:
        return None
    if finding.supersedes:
        logger.info("Memory reflection: recorded %s item %s as a correction", finding.kind, item_id)
    return {"id": item_id, "kind": finding.kind, "content": finding.content, "about": "project"}


async def _record_findings(
    findings: list[_ReflectionFinding],
    *,
    project_id: str | None,
    organization_id: str | None,
    conversation_id: str | None,
    decisions: list[RestrictionDecision] | None = None,
    envelope: SignedEnvelope | None = None,
) -> list[dict[str, str]]:
    decisions = decisions if decisions is not None else [RestrictionDecision(None)] * len(findings)
    results = await asyncio.gather(
        *(
            _write_finding(
                finding,
                project_id=project_id,
                organization_id=organization_id,
                conversation_id=conversation_id,
                decision=decision,
                envelope=envelope,
            )
            for finding, decision in zip(findings, decisions, strict=True)
        ),
        return_exceptions=True,
    )
    recorded: list[dict[str, str]] = []
    for finding, result in zip(findings, results, strict=True):
        if isinstance(result, BaseException):
            logger.warning("Memory reflection: failed to record a %s finding (%r)", finding.kind, result)
        elif result is not None:
            recorded.append(result)
    return recorded


async def _project_restrictions(
    findings: list[_ReflectionFinding], restriction: RestrictionEvidence | None, llm: Any
) -> list[RestrictionDecision]:
    project = [finding for finding in findings if finding.about == "project"]
    judged = iter(
        await restriction_decisions(
            [finding.content for finding in project], restriction or RestrictionEvidence(), llm=llm
        )
        if project
        else []
    )
    return [next(judged) if finding.about == "project" else RestrictionDecision(None) for finding in findings]


async def run_memory_reflection(
    *,
    llm: Any,
    query: str,
    answer: str,
    project_id: str | None,
    organization_id: str | None,
    conversation_id: str | None,
    memory_digest: str | None,
    restriction: RestrictionEvidence | None = None,
    personal_memory: str | None = None,
    envelope: SignedEnvelope | None = None,
) -> list[dict[str, str]]:
    messages = [
        SystemMessage(content=REFLECTION_SYSTEM_PROMPT),
        HumanMessage(content=_build_user_prompt(query, answer, memory_digest, personal_memory)),
    ]
    parsed = extract_json(await structured_reply(llm, messages, ReflectionOutput))
    findings = _sanitize_findings(
        parsed.get("findings") if isinstance(parsed, dict) else None,
        has_project=bool(project_id),
        memory_digest=memory_digest,
        personal_memory=personal_memory,
        can_write_personal=envelope is not None,
    )
    if not findings:
        logger.info("Memory reflection: no new durable findings for this turn")
        return []

    recorded = await _record_findings(
        findings,
        project_id=project_id,
        organization_id=organization_id,
        conversation_id=conversation_id,
        decisions=await _project_restrictions(findings, restriction, llm),
        envelope=envelope,
    )
    if recorded:
        logger.info("Memory reflection recorded %d new memory item(s)", len(recorded))
    return recorded
