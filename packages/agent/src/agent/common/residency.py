from __future__ import annotations

import contextvars
import functools
import logging
import os
from collections.abc import Iterable
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit
from urllib.parse import urlunsplit

import yaml

logger = logging.getLogger(__name__)

RESIDENCY_CELL_ENV = "RESIDENCY_CELL"

CELLS_FILE = Path("configs") / "residency" / "cells.yaml"
REGISTER_DIR = Path("configs") / "subprocessors"

UNKNOWN = "unknown"

PURPOSES = ("service", "quality_evaluation", "human_review", "product_improvement")
DEFAULT_PURPOSES = frozenset({"service", "quality_evaluation", "human_review"})
FAIL_CLOSED_PURPOSES = frozenset({"service"})

QUALITY_EVALUATION_TAG = "purpose_ok:quality_evaluation"

MODEL_BASE_URL_ENVS = (
    "OPENROUTER_BASE_URL",
    "LLM_BASE_URL",
    "EMBED_BASE_URL",
    "VLM_BASE_URL",
    "RERANKER_BASE_URL",
    "SUMMARY_LLM_BASE_URL",
    "CONSISTENCY_LLM_BASE_URL",
    "BACKFILL_SUMMARY_BASE_URL",
    "SKILL_REVIEW_LLM_BASE_URL",
    "DECISIONS_URL",
)
CHAT_BASE_URL_ENV = "OPENROUTER_BASE_URL"


class ResidencyError(RuntimeError): ...


class ResidencyViolation(RuntimeError): ...


@dataclass(frozen=True)
class Zone:
    id: str
    locations: frozenset[str]
    rewrites: Mapping[str, str]


@dataclass(frozen=True)
class Cell:
    id: str
    zone: Zone
    country: str


@dataclass(frozen=True)
class Route:
    host: str
    processing_location: str
    subprocessor: str
    compliant: bool

    def metadata(self) -> dict[str, Any]:
        return {
            "processing_location": self.processing_location,
            "subprocessor": self.subprocessor,
            "processing_location_compliant": self.compliant,
        }


@dataclass(frozen=True)
class ProcessingPolicy:
    residency_cell: str | None = None
    purposes: frozenset[str] = DEFAULT_PURPOSES
    version: int = 1
    known: bool = True

    def allows(self, purpose: str) -> bool:
        return purpose in self.purposes


UNREADABLE_POLICY = ProcessingPolicy(purposes=FAIL_CLOSED_PURPOSES, known=False)


def parse_policy(payload: object) -> ProcessingPolicy:
    if not isinstance(payload, Mapping):
        return UNREADABLE_POLICY
    purposes = payload.get("purposes")
    cell = payload.get("residencyCell")
    version = payload.get("version")
    if not isinstance(purposes, list) or not all(isinstance(p, str) for p in purposes):
        return UNREADABLE_POLICY
    if cell is not None and not isinstance(cell, str):
        return UNREADABLE_POLICY
    allowed = frozenset(p for p in purposes if p in PURPOSES) | {"service"}
    return ProcessingPolicy(
        residency_cell=cell or None,
        purposes=allowed,
        version=version if isinstance(version, int) else 1,
    )


def policy_to_json(policy: ProcessingPolicy) -> dict[str, Any]:
    return {"residencyCell": policy.residency_cell, "purposes": sorted(policy.purposes), "version": policy.version}


def _config_dir(relative: Path) -> Path | None:
    candidates = [Path.cwd() / relative] + [parent / relative for parent in Path(__file__).resolve().parents]
    return next((path for path in candidates if path.exists()), None)


@functools.lru_cache(maxsize=1)
def _cells() -> dict[str, Cell]:
    path = _config_dir(CELLS_FILE)
    if path is None:
        return {}
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    zones = {
        zone_id: Zone(
            id=zone_id,
            locations=frozenset(str(code) for code in spec.get("locations") or ()),
            rewrites={str(k): str(v) for k, v in (spec.get("rewrites") or {}).items()},
        )
        for zone_id, spec in (data.get("zones") or {}).items()
    }
    return {
        cell_id: Cell(id=cell_id, zone=zones[spec["zone"]], country=str(spec.get("country") or ""))
        for cell_id, spec in (data.get("cells") or {}).items()
        if spec.get("zone") in zones
    }


@functools.lru_cache(maxsize=1)
def endpoints() -> dict[str, tuple[str, tuple[str, ...]]]:
    directory = _config_dir(REGISTER_DIR)
    placed: dict[str, tuple[str, tuple[str, ...]]] = {}
    if directory is None:
        return placed
    for path in sorted(directory.glob("*.yaml")):
        row = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        for endpoint in row.get("endpoints") or ():
            placed[str(endpoint["host"])] = (str(row["id"]), tuple(str(c) for c in endpoint["processing_location"]))
    return placed


def cell_named(cell_id: str) -> Cell:
    cell = _cells().get(cell_id)
    if cell is None:
        raise ResidencyError(f"{RESIDENCY_CELL_ENV}={cell_id!r} is not a cell in {CELLS_FILE}; refusing to serve")
    return cell


def active_cell(env: Mapping[str, str] | None = None) -> Cell | None:
    name = ((env if env is not None else os.environ).get(RESIDENCY_CELL_ENV) or "").strip()
    return cell_named(name) if name else None


def _host(url: object) -> str:
    text = str(url or "")
    return ((urlsplit(text).hostname if "://" in text else text.split("/", 1)[0]) or "").lower()


def routed_url(url: str, cell: Cell | None) -> str:
    if cell is None:
        return url
    host = _host(url)
    target = cell.zone.rewrites.get(host)
    if target is None or "://" not in url:
        return url
    parts = urlsplit(url)
    netloc = parts.netloc.replace(parts.hostname or host, target, 1)
    return urlunsplit(parts._replace(netloc=netloc))


def route_for(url: object, cell: Cell | None) -> Route:
    host = _host(url)
    subprocessor, locations = endpoints().get(host, (UNKNOWN, ()))
    known = bool(locations)
    allowed = known and (cell is None or set(locations) <= cell.zone.locations)
    return Route(
        host=host,
        processing_location=",".join(locations) if known else UNKNOWN,
        subprocessor=subprocessor,
        compliant=allowed,
    )


def enforce(url: str, *, rewrite: bool = True) -> tuple[str, Route]:
    cell = active_cell()
    target = routed_url(url, cell) if rewrite else url
    route = route_for(target, cell)
    record_route(route)
    if cell is not None and not route.compliant:
        raise ResidencyViolation(
            f"a model call to {route.host} is processed in {route.processing_location}, outside zone "
            f"{cell.zone.id} of cell {cell.id}; refused (ADR-0167)"
        )
    return target, route


def check_organization(policy: ProcessingPolicy) -> None:
    cell = active_cell()
    if cell is None:
        return
    if not policy.known:
        raise ResidencyViolation(f"the organization's placement cannot be read; cell {cell.id} refuses (ADR-0167)")
    if policy.residency_cell not in (None, cell.id):
        raise ResidencyViolation(
            f"the organization is placed in cell {policy.residency_cell}; this deployment is cell {cell.id} (ADR-0167)"
        )


def _current_organization() -> str | None:
    try:
        from agent.project_context import get_organization_id_from_context

        return get_organization_id_from_context()
    except Exception:  # noqa: BLE001 - no request context: nothing to place
        return None


def _runs_for_a_tenant() -> bool:
    try:
        from agent.project_context import RequestContext

        context = RequestContext.from_context()
    except Exception:  # noqa: BLE001 - no request context: platform work
        return False
    return bool(context.user_id or context.project_id or context.conversation_id)


def _organization_to_place(cell: Cell) -> str | None:
    organization_id = _current_organization()
    if organization_id:
        return organization_id
    if _runs_for_a_tenant():
        raise ResidencyViolation(f"tenant work names no organization to place; cell {cell.id} refuses (ADR-0167)")
    return None


def check_current_organization() -> None:
    cell = active_cell()
    if cell is None:
        return
    organization_id = _organization_to_place(cell)
    if not organization_id:
        return
    from agent.common.model_overrides import resolve_org_processing_policy

    check_organization(resolve_org_processing_policy(organization_id) or UNREADABLE_POLICY)


async def acheck_current_organization() -> None:
    cell = active_cell()
    if cell is None:
        return
    organization_id = _organization_to_place(cell)
    if not organization_id:
        return
    import asyncio

    from agent.common.model_overrides import resolve_org_processing_policy

    policy = resolve_org_processing_policy(organization_id, cached_only=True)
    if policy is None:
        policy = await asyncio.to_thread(resolve_org_processing_policy, organization_id)
    check_organization(policy)


_scored: dict[tuple[str, str], None] = {}
_SCORED_MAX = 4096

_route_sink: contextvars.ContextVar[Any] = contextvars.ContextVar("residency_route_sink", default=None)


def route_sink() -> contextvars.ContextVar[Any]:
    return _route_sink


def record_route(route: Route) -> None:
    try:
        sink = _route_sink.get()
        if sink is not None:
            sink(route)
        _score(route)
    except Exception:  # noqa: BLE001 - recording must never fail the call it records
        logger.debug("Could not record a model call's processing location", exc_info=True)


def _score(route: Route) -> None:
    from agent.observability.langfuse_scores import RuntimeScore
    from agent.observability.langfuse_scores import emit_scores
    from agent.observability.turn_trace import current_trace_id_hex

    trace_id = current_trace_id_hex()
    if not trace_id:
        return
    item = f"{route.subprocessor}:{route.processing_location}"
    if (trace_id, item) in _scored:
        return
    _scored[(trace_id, item)] = None
    while len(_scored) > _SCORED_MAX:
        _scored.pop(next(iter(_scored)))
    score = RuntimeScore(
        "processing-location-compliant",
        1 if route.compliant else 0,
        item=item,
        metadata=route.metadata(),
    )
    emit_scores([score], writer="agent", trace_id=trace_id)


def stamp_message(message: Any, route: Route | None) -> Any:
    if route is None or message is None:
        return message
    metadata = getattr(message, "response_metadata", None)
    if isinstance(metadata, dict):
        metadata["processing_route"] = route.metadata()
    return message


def stamp_result(result: Any, route: Route | None) -> Any:
    for generation in getattr(result, "generations", None) or ():
        stamp_message(getattr(generation, "message", None), route)
    return result


def stamp_chunk(chunk: Any, route: Route | None) -> Any:
    stamp_message(getattr(chunk, "message", None), route)
    return chunk


def turn_trace_metadata(policy: ProcessingPolicy, cell: Cell | None) -> tuple[dict[str, str], list[str]]:
    metadata = {
        "cell": cell.id if cell is not None else "none",
        "purpose_ok": ",".join(sorted(policy.purposes)),
        "processing_policy_version": str(policy.version) if policy.known else "unreadable",
    }
    tags = [QUALITY_EVALUATION_TAG] if policy.allows("quality_evaluation") else []
    return metadata, tags


def record_turn_residency(policy: ProcessingPolicy) -> None:
    try:
        from agent.observability.langfuse_trace_attributes import add_trace_tag
        from agent.observability.langfuse_trace_attributes import record_trace_metadata

        metadata, tags = turn_trace_metadata(policy, active_cell())
        record_trace_metadata(**metadata)
        for tag in tags:
            add_trace_tag(tag)
    except Exception:  # noqa: BLE001 - a missing tag fails closed: the turn is simply not judged
        logger.warning("Could not record the turn's residency metadata", exc_info=True)


def boot_errors(env: Mapping[str, str], urls: Iterable[tuple[str, str]] = ()) -> list[str]:
    try:
        cell = active_cell(env)
    except ResidencyError as error:
        return [str(error)]
    if cell is None:
        return []
    errors = []
    if not (env.get(CHAT_BASE_URL_ENV) or "").strip():
        errors.append(f"{CHAT_BASE_URL_ENV} is unset, so the chat models would call the global gateway")
    named = [(name, (env.get(name) or "").strip()) for name in MODEL_BASE_URL_ENVS]
    for name, url in [*named, *urls]:
        if not url:
            continue
        target = url if name == CHAT_BASE_URL_ENV else routed_url(url, cell)
        route = route_for(target, cell)
        if not route.compliant:
            errors.append(f"{name} reaches {route.host}, processed in {route.processing_location}")
    return [f"cell {cell.id} (zone {cell.zone.id}): {error}" for error in errors]


def assert_residency(env: Mapping[str, str] | None = None) -> None:
    errors = boot_errors(os.environ if env is None else env)
    if errors:
        raise ResidencyError("; ".join(errors) + "; refusing to start (ADR-0167)")
