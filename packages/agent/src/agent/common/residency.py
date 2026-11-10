"""Where a model call is processed, and whether this deployment may send it there (ADR-0167).

Every model call leaves through the seam in ``common/openrouter.py`` (an httpx transport for the bespoke call
sites) or the chat-request contract in ``common/llm_factory.py`` (every LangChain chat model). Both ask this
module about the URL they are about to call:

- :func:`routed_url` rewrites it into the cell's zone where the zone names a rewrite (``openrouter.ai`` to
  ``eu.openrouter.ai`` for ``eu``), so a call that can stay inside the zone does;
- :func:`route_for` says where the request is processed (``processing_location``) and by whom
  (``subprocessor``), read per host from the data-flow register's ``endpoints``, and whether that is allowed;
- :func:`enforce` refuses a request whose location the cell's zone does not hold. A host the register does not
  place has location ``unknown`` and is in no zone: unknown is never allowed.

Residency is switched on by naming the deployment's cell in ``RESIDENCY_CELL`` (``configs/residency/cells.yaml``).
Unset, nothing is rewritten or refused, and every generation still records where it went, so the
``processing-location-compliant`` score measures the gap before anyone switches it on. A cell the file does not
know refuses the boot (:func:`assert_residency`) and every call.

The office's side of it: an organization is placed in a cell (``organizations.residency_cell``) and has a
processing policy (``organization_processing_policies``: the purposes it allows, ``purpose_ok`` on its traces).
:class:`ProcessingPolicy` is what the BFF reports for one organization; an organization placed in another cell is
refused here, and a policy that cannot be read allows ``service`` alone.
"""

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

# @environment_variable RESIDENCY_CELL
# @category Agent
# @type str
# @default (unset)
# @required false
# The residency cell this deployment is (`configs/residency/cells.yaml`, e.g. `eu-at-1`). Set, every model call
# is routed into the cell's zone and refused outside it, zero data retention cannot be switched off, and the boot
# refuses a model endpoint outside the zone (ADR-0167). Unset, routing is unchanged. Set it on the BFF too.
RESIDENCY_CELL_ENV = "RESIDENCY_CELL"

CELLS_FILE = Path("configs") / "residency" / "cells.yaml"
REGISTER_DIR = Path("configs") / "subprocessors"

#: A host the register does not place.
UNKNOWN = "unknown"

#: The purposes an organization's data may be processed for (design 6.1). ``service`` is always allowed.
PURPOSES = ("service", "quality_evaluation", "human_review", "product_improvement")
DEFAULT_PURPOSES = frozenset({"service", "quality_evaluation", "human_review"})
#: What an organization whose policy cannot be read allows: the service it asked for, nothing else.
FAIL_CLOSED_PURPOSES = frozenset({"service"})

#: The trace tag a Langfuse judge rule requires (include-only, ``langfuse_catalog.RULES``).
QUALITY_EVALUATION_TAG = "purpose_ok:quality_evaluation"

#: Model endpoints whose base URL the boot check reads. Each is a variable a deployment points at a provider.
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
#: The one a cell must name: the chat models read it (``configs/config_oib_openrouter.yml``), and they are
#: built once at boot, so nothing can rewrite them per call.
CHAT_BASE_URL_ENV = "OPENROUTER_BASE_URL"


class ResidencyError(RuntimeError):
    """The deployment's residency configuration is not one this process can serve."""


class ResidencyViolation(RuntimeError):
    """A model call that would be processed outside where its organization's data may go."""


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
    """Where one request is processed, by whom, and whether that is allowed."""

    host: str
    processing_location: str
    subprocessor: str
    compliant: bool

    def metadata(self) -> dict[str, Any]:
        """The generation metadata that records this route (design 7.3)."""
        return {
            "processing_location": self.processing_location,
            "subprocessor": self.subprocessor,
            "processing_location_compliant": self.compliant,
        }


@dataclass(frozen=True)
class ProcessingPolicy:
    """One organization's processing policy, as the BFF reports it."""

    residency_cell: str | None = None
    purposes: frozenset[str] = DEFAULT_PURPOSES
    version: int = 1
    #: False when the policy could not be read: the purposes are then the fail-closed set.
    known: bool = True

    def allows(self, purpose: str) -> bool:
        return purpose in self.purposes


UNREADABLE_POLICY = ProcessingPolicy(purposes=FAIL_CLOSED_PURPOSES, known=False)


def parse_policy(payload: object) -> ProcessingPolicy:
    """The BFF's ``processingPolicy`` object as a :class:`ProcessingPolicy`; the fail-closed one when malformed."""
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
    """The inverse of :func:`parse_policy`, for the shared cache."""
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
    """Every host the register places: ``host -> (subprocessor id, processing locations)``."""
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
    """The cell ``cell_id`` names; :class:`ResidencyError` when ``configs/residency/cells.yaml`` has none."""
    cell = _cells().get(cell_id)
    if cell is None:
        raise ResidencyError(f"{RESIDENCY_CELL_ENV}={cell_id!r} is not a cell in {CELLS_FILE}; refusing to serve")
    return cell


def active_cell(env: Mapping[str, str] | None = None) -> Cell | None:
    """This deployment's cell, or None when residency is not switched on. An unknown cell raises."""
    name = ((env if env is not None else os.environ).get(RESIDENCY_CELL_ENV) or "").strip()
    return cell_named(name) if name else None


def _host(url: object) -> str:
    text = str(url or "")
    return ((urlsplit(text).hostname if "://" in text else text.split("/", 1)[0]) or "").lower()


def routed_url(url: str, cell: Cell | None) -> str:
    """``url`` with its host rewritten into ``cell``'s zone, where the zone names a rewrite for it."""
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
    """Where a request to ``url`` is processed, and whether ``cell`` allows it. Pure.

    Without a cell any placed location is allowed; an unplaced host is never.
    """
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
    """The URL to send to and its route; :class:`ResidencyViolation` when the cell's zone does not hold it.

    ``rewrite=False`` judges ``url`` as it is, for a client whose address is fixed at construction (a LangChain
    chat model). The route is recorded on the generation it belongs to (:func:`record_route`), refused or not.
    """
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
    """Refuse to serve an organization placed in a cell other than this deployment's, or whose placement is unknown.

    An organization with no cell is served by the cell it reaches, under that cell's zone. A policy that could
    not be read is refused: its organization may be placed anywhere. Without residency switched on nothing is
    refused.
    """
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


def check_current_organization() -> None:
    """:func:`check_organization` for the organization the current request runs for. Blocking on a cache miss."""
    if active_cell() is None:
        return
    organization_id = _current_organization()
    if not organization_id:
        return
    from agent.common.model_overrides import resolve_org_processing_policy

    check_organization(resolve_org_processing_policy(organization_id) or UNREADABLE_POLICY)


async def acheck_current_organization() -> None:
    """:func:`check_current_organization` off the event loop: the cached policy, else a worker thread."""
    if active_cell() is None:
        return
    organization_id = _current_organization()
    if not organization_id:
        return
    import asyncio

    from agent.common.model_overrides import resolve_org_processing_policy

    policy = resolve_org_processing_policy(organization_id, cached_only=True)
    if policy is None:
        policy = await asyncio.to_thread(resolve_org_processing_policy, organization_id)
    check_organization(policy)


# --- Recording -------------------------------------------------------------------------------------------------

#: Routes already scored on a trace, so a turn of fifty calls posts one score per distinct route.
_scored: dict[tuple[str, str], None] = {}
_SCORED_MAX = 4096

#: A sink the enclosing generation installs (``direct_trace.observed_generation``) to receive its route.
_route_sink: contextvars.ContextVar[Any] = contextvars.ContextVar("residency_route_sink", default=None)


def route_sink() -> contextvars.ContextVar[Any]:
    """The context variable a generation sets to a callable taking a :class:`Route`."""
    return _route_sink


def record_route(route: Route) -> None:
    """Record ``route`` on the enclosing generation and as the trace's compliance score. Never raises."""
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
    """``message`` (an AIMessage or chunk) carrying ``route`` in its ``response_metadata``.

    The span exporter keeps ``response_metadata`` in the generation's ``nat.metadata``, which is where
    ``ProcessingLocationProcessor`` reads it back onto the Langfuse generation.
    """
    if route is None or message is None:
        return message
    metadata = getattr(message, "response_metadata", None)
    if isinstance(metadata, dict):
        metadata["processing_route"] = route.metadata()
    return message


def stamp_result(result: Any, route: Route | None) -> Any:
    """Every generation of a ``ChatResult`` stamped with ``route``."""
    for generation in getattr(result, "generations", None) or ():
        stamp_message(getattr(generation, "message", None), route)
    return result


def stamp_chunk(chunk: Any, route: Route | None) -> Any:
    """A ``ChatGenerationChunk`` stamped with ``route``: the stream's first chunk only, since chunks merge."""
    stamp_message(getattr(chunk, "message", None), route)
    return chunk


# --- Trace metadata --------------------------------------------------------------------------------------------


def turn_trace_metadata(policy: ProcessingPolicy, cell: Cell | None) -> tuple[dict[str, str], list[str]]:
    """The trace metadata and tags that say where a turn ran and what it may be used for. Pure.

    ``purpose_ok`` lists the purposes the organization allows; a judge rule runs only on a trace tagged
    ``purpose_ok:quality_evaluation``, so an organization whose policy is unreadable is never judged.
    """
    metadata = {
        "cell": cell.id if cell is not None else "none",
        "purpose_ok": ",".join(sorted(policy.purposes)),
        "processing_policy_version": str(policy.version) if policy.known else "unreadable",
    }
    tags = [QUALITY_EVALUATION_TAG] if policy.allows("quality_evaluation") else []
    return metadata, tags


def record_turn_residency(policy: ProcessingPolicy) -> None:
    """Put ``cell`` and ``purpose_ok`` on the current turn's trace. Never raises.

    Call it in the turn's own context (not on a worker thread): trace contributions are a context variable.
    """
    try:
        from agent.observability.langfuse_trace_attributes import add_trace_tag
        from agent.observability.langfuse_trace_attributes import record_trace_metadata

        metadata, tags = turn_trace_metadata(policy, active_cell())
        record_trace_metadata(**metadata)
        for tag in tags:
            add_trace_tag(tag)
    except Exception:  # noqa: BLE001 - a missing tag fails closed: the turn is simply not judged
        logger.warning("Could not record the turn's residency metadata", exc_info=True)


# --- Boot ------------------------------------------------------------------------------------------------------


def boot_errors(env: Mapping[str, str], urls: Iterable[tuple[str, str]] = ()) -> list[str]:
    """What keeps this deployment from serving its cell; empty when it can, or when no cell is named. Pure.

    ``urls`` adds further ``(name, url)`` endpoints to judge, beside :data:`MODEL_BASE_URL_ENVS`.
    """
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
    """Refuse the boot when this deployment would route a model call outside its cell's zone."""
    errors = boot_errors(os.environ if env is None else env)
    if errors:
        raise ResidencyError("; ".join(errors) + "; refusing to start (ADR-0167)")
