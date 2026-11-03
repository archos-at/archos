"""Files the ingest job downloads itself, when it reaches them.

``POST /v1/ingest`` answers the BFF within its ten-second budget by downloading
nothing: it gates each object-store URL and hands the job a zero-argument
callable in place of a path (``agent_host.routes.ingest.DeferredObjectDownload``).
The original rides in ``submit_job``'s ``file_paths``, its PDF rendition in
``config["extraction_paths"]`` (``knowledge_layer.ingest.renditions``). Calling one
downloads to a new temp file and returns its path, which the job then owns and
deletes whether or not it owns the caller's files; a failure raises.

Every other caller (the multipart upload, the OIB sync) passes local paths, and
a path passes through untouched.

A failed download is tried again inside the job when the failure says "not
now": a refused or dropped connection, or a 502/503/504, the answers of an
object store that is restarting (2026-11-02: five restarts of the single
SeaweedFS pod in fifteen minutes, and every download in those seconds failed
its whole file). The waits double from ``DOWNLOAD_RETRY_FIRST_WAIT_SECONDS``,
and no attempt starts past ``DOWNLOAD_RETRY_BUDGET_SECONDS``. Any other answer
(an expired signature's 403, a missing object's 404, a redirect, a 500 about
the request itself) is final at once: asking again reads nothing new.

Shared by both ingestors, so it imports nothing either of them brings: the
failures are recognised by class name, as ``agent.knowledge.ingest_failures``
recognises them.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Callable
from typing import Any

logger = logging.getLogger(__name__)

#: The file error for an original the job could not download. A stable,
#: machine-readable prefix, like ``office_rendition_required``: the
#: failed-document UX and anyone grepping logs key on it.
ORIGINAL_DOWNLOAD_FAILED = (
    "original_download_failed: the uploaded file could not be read from storage for indexing "
    "(the link expired, the object is gone, or storage was unreachable)"
)


def is_deferred(entry: Any) -> bool:
    """Whether ``entry`` is a download the job runs rather than a local path."""
    return callable(entry)


def resolve_original(entry: str | Callable[[], str], downloaded: list[str]) -> str | None:
    """The local path of one original: as given, or what its deferred download wrote.

    A downloaded path is appended to ``downloaded``, the job's own files.
    ``None`` when the download failed; the caller fails the file with
    ``ORIGINAL_DOWNLOAD_FAILED``.
    """
    if not is_deferred(entry):
        return entry
    path = run_deferred_download(entry, "original")
    if path:
        downloaded.append(path)
    return path


#: The first wait before a download is tried again; each later wait doubles.
DOWNLOAD_RETRY_FIRST_WAIT_SECONDS = 3.0
#: No attempt starts once this long has passed since the first: waits of 3, 6,
#: 12 and 24 s, four more tries over 45 s, longer than a restart of the store.
DOWNLOAD_RETRY_BUDGET_SECONDS = 50.0

#: Exceptions (by name, anywhere in the MRO) that say the store was not there:
#: httpx's connect, read and write errors (``NetworkError``), a connection
#: dropped mid-answer, a connect that timed out, and the builtin family. A read
#: that timed out is not among them: it already waited a full minute.
_RETRYABLE_ERRORS = frozenset({"NetworkError", "RemoteProtocolError", "ConnectTimeout", "ConnectionError"})
#: The answers of a store that is restarting, or of a proxy in front that lost it.
_RETRYABLE_STATUSES = frozenset({502, 503, 504})

#: Seams for the tests: the wait and the clock.
_sleep = time.sleep
_monotonic = time.monotonic


def _status_of(error: BaseException) -> int | None:
    status = getattr(getattr(error, "response", None), "status_code", None)
    return status if isinstance(status, int) else None


def is_retryable_download_error(error: BaseException) -> bool:
    """Whether a download that raised ``error`` may succeed if it is simply asked again."""
    status = _status_of(error)
    if status is not None:
        return status in _RETRYABLE_STATUSES
    return bool({cls.__name__ for cls in type(error).__mro__} & _RETRYABLE_ERRORS)


def run_deferred_download(source: Callable[[], str], what: str) -> str | None:
    """Run a download the route deferred, again while it fails for the moment; ``None`` when it failed.

    The class and the HTTP status only: an httpx error's text carries the
    presigned URL, which is a bearer credential.
    """
    started = _monotonic()
    wait = DOWNLOAD_RETRY_FIRST_WAIT_SECONDS
    attempt = 1
    while True:
        try:
            return source()
        except Exception as error:  # noqa: BLE001 — the caller decides what a missing file costs
            status = _status_of(error)
            detail = f" (HTTP {status})" if status is not None else ""
            in_budget = _monotonic() + wait - started <= DOWNLOAD_RETRY_BUDGET_SECONDS
            if not (in_budget and is_retryable_download_error(error)):
                logger.warning("Download of the %s failed: %s%s", what, type(error).__name__, detail)
                return None
            logger.info(
                "Download of the %s failed (%s%s, attempt %d); trying again in %.0f s",
                what,
                type(error).__name__,
                detail,
                attempt,
                wait,
            )
        _sleep(wait)
        wait *= 2
        attempt += 1
