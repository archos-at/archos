from __future__ import annotations

import atexit
import logging
import os
import tempfile
import threading
import urllib.error
import urllib.request
from typing import Any

from agent.common import bff_http
from agent.knowledge.bim_query import BimQueryRejectedError
from agent.knowledge.bim_query import BimQueryUnavailableError

logger = logging.getLogger(__name__)

_RESOLVE_TIMEOUT_SECONDS = 10

_DOWNLOAD_TIMEOUT_SECONDS = 120

PARSE_FOOTPRINT_RATIO = 20

_MIN_MODEL_BYTES = 16 * 1024 * 1024
_MAX_MODEL_BYTES_CAP = 512 * 1024 * 1024


def _container_memory_bytes() -> int | None:
    for path in ("/sys/fs/cgroup/memory.max", "/sys/fs/cgroup/memory/memory.limit_in_bytes"):
        try:
            with open(path, encoding="ascii") as handle:
                raw = handle.read().strip()
        except OSError:
            continue
        if raw == "max":
            break
        try:
            value = int(raw)
        except ValueError:
            continue
        if 0 < value < (1 << 62):
            return value
    try:
        return os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES")
    except ValueError, OSError, AttributeError:
        return None


def _derive_max_model_bytes() -> int:
    override = os.environ.get("BIM_SPATIAL_MAX_MODEL_BYTES", "").strip()
    if override:
        try:
            chosen = int(override)
        except ValueError:
            logger.warning("BIM_SPATIAL_MAX_MODEL_BYTES is not a number: %r — ignored", override)
        else:
            if chosen > 0:
                return chosen
            logger.warning("BIM_SPATIAL_MAX_MODEL_BYTES must be positive: %r — ignored", override)

    available = _container_memory_bytes()
    if not available:
        return _MIN_MODEL_BYTES
    derived = int(available * 0.5) // PARSE_FOOTPRINT_RATIO
    return max(_MIN_MODEL_BYTES, min(_MAX_MODEL_BYTES_CAP, derived))


MAX_MODEL_BYTES = _derive_max_model_bytes()


class SpatialEngineUnavailableError(RuntimeError):
    ...


class ModelTooLargeError(BimQueryUnavailableError):

    def __init__(self, model_bytes: int | None, limit_bytes: int) -> None:
        self.model_bytes = model_bytes
        self.limit_bytes = limit_bytes
        size = f"{model_bytes / (1024 * 1024):.0f} MB" if model_bytes else "the model"
        super().__init__(f"{size} exceeds the {limit_bytes // (1024 * 1024)} MB this worker can hold")


class ModelUnreadableError(BimQueryUnavailableError):
    ...


class SpatialToolError(ValueError):
    ...


def resolve_model_source(
    *,
    organization_id: str,
    project_id: str | None,
    model_name: str | None = None,
) -> dict[str, Any]:
    from agent.knowledge.bim_query import _rejection_message
    from agent.knowledge.bim_query import is_correctable

    payload: dict[str, Any] = {"organizationId": organization_id}
    if project_id:
        payload["projectId"] = project_id
    if model_name:
        payload["modelName"] = model_name

    try:
        parsed = bff_http.post_json("/api/internal/bim/source", payload, timeout=_RESOLVE_TIMEOUT_SECONDS)
    except bff_http.BffNotConfiguredError as exc:
        raise BimQueryUnavailableError(str(exc)) from exc
    except bff_http.BffRefusedError as exc:
        logger.warning("BIM source lookup refused by the frontend (status=%s)", exc.status)
        if is_correctable(exc):
            raise BimQueryRejectedError(_rejection_message(exc)) from exc
        raise BimQueryUnavailableError(f"internal BIM source endpoint returned {exc.status}") from exc
    except bff_http.BffMalformedResponseError as exc:
        raise BimQueryUnavailableError("internal BIM source endpoint returned a non-JSON body") from exc
    except bff_http.BffError as exc:
        logger.warning("BIM source lookup could not reach the frontend: %s", type(exc.__cause__).__name__)
        raise BimQueryUnavailableError("internal BIM source endpoint unreachable") from exc
    if not isinstance(parsed, dict):
        raise BimQueryUnavailableError("internal BIM source endpoint returned an unexpected body")
    return parsed


def source_identity(result: dict[str, Any]) -> str:
    model = result.get("model") or {}
    source = result.get("source") or {}
    etag = source.get("etag")
    if isinstance(etag, str) and etag:
        return f"etag:{etag}"
    return f"model:{model.get('modelId')}:{model.get('updatedAt')}"


def _http_only_opener() -> urllib.request.OpenerDirector:
    opener = urllib.request.OpenerDirector()
    for handler in (
        urllib.request.HTTPHandler,
        urllib.request.HTTPSHandler,
        urllib.request.HTTPRedirectHandler,
        urllib.request.HTTPErrorProcessor,
        urllib.request.UnknownHandler,
    ):
        opener.add_handler(handler())
    return opener


_HTTP_ONLY_OPENER = _http_only_opener()


def _download(url: str, expected_bytes: Any = None) -> bytes:
    if not isinstance(url, str) or not url.lower().startswith(("http://", "https://")):
        raise BimQueryUnavailableError("the model source URL was not usable")
    if isinstance(expected_bytes, (int, float)) and expected_bytes > MAX_MODEL_BYTES:
        raise ModelTooLargeError(int(expected_bytes), MAX_MODEL_BYTES)
    try:
        with _HTTP_ONLY_OPENER.open(url, timeout=_DOWNLOAD_TIMEOUT_SECONDS) as response:
            data = response.read(MAX_MODEL_BYTES + 1)
            encoding = (response.headers.get("Content-Encoding") or "").lower()
            missing = response.length
    except Exception as exc:  # noqa: BLE001
        logger.warning("the model source could not be downloaded: %s", type(exc).__name__)
        raise BimQueryUnavailableError("the model file could not be downloaded") from exc

    if len(data) > MAX_MODEL_BYTES:
        raise ModelTooLargeError(len(data), MAX_MODEL_BYTES)
    if missing:
        logger.warning("the model source arrived incomplete: %d bytes, %d missing", len(data), missing)
        raise BimQueryUnavailableError("the model file arrived incomplete")
    if "gzip" in encoding:
        import gzip

        try:
            data = gzip.decompress(data)
        except OSError as exc:
            raise BimQueryUnavailableError("the model file arrived compressed and could not be read") from exc
    return data



MAX_RESIDENT_MODELS = 2

_LOCK = threading.Lock()

_OPEN_LOCK = threading.Lock()

# Process-local and bounded by MAX_RESIDENT_MODELS: a table keyed per tenant file that grew without bound would retain tenant model data.
_PATH_BY_SOURCE: dict[str, str] = {}
_HANDLE_BY_SOURCE: dict[str, str] = {}
_OPEN_HANDLES: list[str] = []
_SPILLED: list[str] = []
_CACHE: Any = None
_TOOLS: Any = None


@atexit.register
def _remove_spilled_files() -> None:
    for path in _SPILLED:
        try:
            os.unlink(path)
        except OSError:
            pass


def _engine() -> tuple[Any, Any]:
    global _CACHE, _TOOLS
    with _LOCK:
        if _TOOLS is None:
            try:
                from ifc_spatial.cache import SpatialCache
                from ifc_spatial.tools import create_tools
            except ImportError as exc:  # pragma: no cover — deployment shape
                raise SpatialEngineUnavailableError(str(exc)) from exc
            _CACHE = SpatialCache(max_entries=MAX_RESIDENT_MODELS)
            _TOOLS = create_tools(_CACHE)
        return _CACHE, _TOOLS


def _spill(identity: str, data: bytes) -> str:
    with _LOCK:
        existing = _PATH_BY_SOURCE.get(identity)
    if existing and os.path.isfile(existing):
        return existing

    handle, path = tempfile.mkstemp(prefix="ifc-", suffix=".ifc")
    with os.fdopen(handle, "wb") as file:
        file.write(data)
    with _LOCK:
        _PATH_BY_SOURCE[identity] = path
        _SPILLED.append(path)
    return path


def _open_failure(refusal: Exception) -> BimQueryUnavailableError:
    from ifc_spatial.model import ModelTooLargeError as EngineTooLargeError
    from ifc_spatial.model import ModelUnreadableError as EngineUnreadableError

    cause = refusal.__cause__
    if isinstance(cause, EngineTooLargeError):
        return ModelTooLargeError(cause.size, cause.limit)
    if isinstance(cause, EngineUnreadableError):
        return ModelUnreadableError(cause.reason)
    return BimQueryUnavailableError(str(refusal))


def open_model(result: dict[str, Any]) -> str:
    global _TOOLS

    cache, _ = _engine()
    identity = source_identity(result)

    with _LOCK:
        known = _HANDLE_BY_SOURCE.get(identity)
        if known and known in _OPEN_HANDLES:
            return known
        path = _PATH_BY_SOURCE.get(identity)

    source = result.get("source") or {}
    if not path or not os.path.isfile(path):
        path = _spill(identity, _download(source.get("url"), source.get("bytes")))

    from ifc_spatial.tools import ToolError
    from ifc_spatial.tools import call
    from ifc_spatial.tools import create_tools

    with _OPEN_LOCK:
        with _LOCK:
            known = _HANDLE_BY_SOURCE.get(identity)
            if known and known in _OPEN_HANDLES:
                return known
            if len(_OPEN_HANDLES) >= MAX_RESIDENT_MODELS:
                _TOOLS = create_tools(cache)
                _OPEN_HANDLES.clear()
            tools = _TOOLS

        try:
            opened = call(tools, "open_model", {"path": path})
        except ToolError as exc:
            raise _open_failure(exc) from None

        handle = str(opened.get("contentHash") or "")
        with _LOCK:
            _HANDLE_BY_SOURCE[identity] = handle
            if handle not in _OPEN_HANDLES:
                _OPEN_HANDLES.append(handle)
        return handle


def call_spatial_tool(handle: str, name: str, args: dict[str, Any]) -> Any:
    _engine()
    with _LOCK:
        tools = _TOOLS

    from ifc_spatial.tools import ToolError
    from ifc_spatial.tools import call

    try:
        return call(tools, name, {**args, "model": handle})
    except ToolError as exc:
        raise SpatialToolError(str(exc)) from None


def reset_cache_for_tests() -> None:
    global _CACHE, _TOOLS
    with _LOCK:
        if _CACHE is not None:
            _CACHE.clear()
        _PATH_BY_SOURCE.clear()
        _HANDLE_BY_SOURCE.clear()
        _OPEN_HANDLES.clear()
        _CACHE = None
        _TOOLS = None


__all__ = [
    "MAX_MODEL_BYTES",
    "MAX_RESIDENT_MODELS",
    "ModelTooLargeError",
    "ModelUnreadableError",
    "PARSE_FOOTPRINT_RATIO",
    "SpatialEngineUnavailableError",
    "SpatialToolError",
    "call_spatial_tool",
    "open_model",
    "reset_cache_for_tests",
    "resolve_model_source",
    "source_identity",
]
