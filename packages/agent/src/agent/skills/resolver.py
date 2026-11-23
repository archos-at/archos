from __future__ import annotations

import logging
import os
from typing import Any

from agent.common import cache as shared_cache
from agent.skills.builtin import discover_builtin_skills
from agent.skills.legacy_names import metadata_value
from agent.skills.models import MAX_NAME_CHARS
from agent.skills.models import Skill
from agent.skills.models import SkillValidationError
from agent.skills.models import build_skill_from_payload

logger = logging.getLogger(__name__)

_DEFAULT_TTL_SECONDS = 60
_REQUEST_TIMEOUT_SECONDS = 5.0

KNOWN_AGENTS = frozenset({"researcher", "deep_researcher"})

AGENT_ALIASES: dict[str, str] = {"shallow_researcher": "researcher"}


def canonical_agent(name: str) -> str:
    return AGENT_ALIASES.get(name, name)


def _cache_ttl_seconds() -> float:
    raw = os.environ.get("SKILLS_CACHE_TTL_SECONDS")
    if not raw:
        return float(_DEFAULT_TTL_SECONDS)
    try:
        ttl = int(raw)
    except ValueError:
        return float(_DEFAULT_TTL_SECONDS)
    return float(ttl) if ttl > 0 else float(_DEFAULT_TTL_SECONDS)


METADATA_CATALOG = "catalog"
CATALOG_CURATED = "curated"


def _is_curated(skill: Skill) -> bool:
    return (metadata_value(skill.metadata, METADATA_CATALOG) or "").strip().lower() == CATALOG_CURATED


def _agent_allows(skill: Skill, agent: str | None) -> bool:
    if agent is None:
        return True
    allowed = metadata_value(skill.metadata, "agents")
    if not allowed:
        return True
    agent = canonical_agent(agent)
    names = {canonical_agent(name.strip()) for name in allowed.split(",") if name.strip()}
    unknown = names - KNOWN_AGENTS
    if unknown:
        logger.warning(
            "Skill %r lists unknown agent(s) in agents: %s (known: %s)",
            skill.name,
            sorted(unknown),
            sorted(KNOWN_AGENTS),
        )
    known = names & KNOWN_AGENTS
    if not known:
        return True
    return agent in known


def _skill_applies_to_agent(skill: Skill, agent: str | None) -> bool:
    return _agent_allows(skill, agent)


def _build_org_skills(payload: Any) -> list[Skill]:
    if not isinstance(payload, list):
        return []
    skills: list[Skill] = []
    for row in payload:
        if not isinstance(row, dict):
            logger.warning("Dropping malformed org skill row (not an object)")
            continue
        payload_flat = {
            "name": row.get("name"),
            "description": row.get("description"),
            "body": row.get("body"),
            "metadata": row.get("metadata") or {},
            "license": row.get("license"),
            "compatibility": row.get("compatibility"),
            "allowed_tools": row.get("allowed_tools"),
        }
        try:
            skill = build_skill_from_payload(payload_flat, origin="org")
        except SkillValidationError as exc:
            logger.warning("Dropping invalid org skill row: %s", exc)
            continue
        skills.append(skill)
    return skills


class SkillResolver:
    def __init__(self, agent: str | None = None) -> None:
        self.agent = agent
        self._builtin_by_name: dict[str, Skill] | None = None

    @property
    def builtin(self) -> tuple[Skill, ...]:
        if self._builtin_by_name is None:
            self._builtin_by_name = {s.name: s for s in discover_builtin_skills()}
        return tuple(self._builtin_by_name.values())

    @property
    def always_on(self) -> tuple[Skill, ...]:
        return tuple(skill for skill in self.builtin if not _is_curated(skill))

    def resolve(self, organization_id: str | None = None) -> tuple[Skill, ...]:
        merged_by_name: dict[str, Skill] = {s.name: s for s in self.always_on}
        if organization_id:
            merged_by_name.update({s.name: s for s in self._resolve_org_skills(organization_id)})
        return tuple(skill for skill in merged_by_name.values() if _skill_applies_to_agent(skill, self.agent))

    def _resolve_org_skills(self, organization_id: str) -> tuple[Skill, ...]:
        from agent.common.profiler import annotate_current_span

        cache_key = f"skills:{organization_id}:{self.agent or '_all'}"
        cached = shared_cache.get_json(cache_key)
        if cached is not None and isinstance(cached, list):
            known = self._known_org_names(cached)
            if known is not None:
                annotate_current_span(cache_skills="hit")
                return self._org_skills_from_rows(cached, known)
        annotate_current_span(cache_skills="miss")
        try:
            rows = self._fetch_org_skills(organization_id)
        except Exception as exc:  # noqa: BLE001 - fail open to builtins by design
            logger.warning("Org skill resolution failed for org %s: %s", organization_id, type(exc).__name__)
            return ()
        known = self._known_org_names(rows)
        if known is None:
            return ()
        shared_cache.set_json(cache_key, rows, _cache_ttl_seconds())
        return self._org_skills_from_rows(rows, known)

    def _known_org_names(self, rows: Any) -> set[str] | None:
        if not isinstance(rows, list):
            logger.warning("Org skill payload is not a list; ignoring")
            return None
        names: set[str] = set()
        for row in rows:
            if not isinstance(row, dict):
                logger.warning("Dropping malformed org skill row (not an object)")
                continue
            name = row.get("name")
            if not isinstance(name, str) or not (0 < len(name) <= MAX_NAME_CHARS):
                logger.warning("Dropping org skill row without a valid name")
                continue
            names.add(name)
        return names

    def _org_skills_from_rows(self, rows: list[Any], known: set[str]) -> tuple[Skill, ...]:
        return tuple(s for s in _build_org_skills(rows) if s.name in known)

    def _fetch_org_skills(self, organization_id: str) -> list[Any]:
        token = os.environ.get("INTERNAL_API_TOKEN")
        if not token:
            raise RuntimeError("INTERNAL_API_TOKEN unset; org skills unavailable")
        import httpx

        base_url = (os.environ.get("FRONTEND_INTERNAL_URL") or "http://frontend:3000").rstrip("/")
        params = {"organization_id": organization_id}
        if self.agent:
            params["agent"] = self.agent
        response = httpx.get(
            f"{base_url}/api/internal/skills/resolve",
            params=params,
            headers={"x-internal-token": token},
            timeout=_REQUEST_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        payload = response.json()
        if not isinstance(payload, dict):
            raise ValueError("skills/resolve returned a non-object payload")
        return payload.get("skills", [])


def resolve_served_skills(agent: str, organization_id: str | None) -> tuple[Skill, ...]:
    try:
        resolved = SkillResolver(agent=agent).resolve(organization_id)
    except Exception as exc:  # noqa: BLE001 - skills are additive; a run must survive their absence
        logger.warning("Skill resolution failed for agent %s: %s", agent, type(exc).__name__)
        return ()
    machinery = {skill.name for skill in discover_builtin_skills() if not _is_curated(skill)}
    return tuple(skill for skill in resolved if skill.name not in machinery)
