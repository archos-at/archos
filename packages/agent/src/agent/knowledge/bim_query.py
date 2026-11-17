from __future__ import annotations

import logging
from typing import Any

from agent.common import bff_http

logger = logging.getLogger(__name__)

_REQUEST_TIMEOUT_SECONDS = 10

_LONG_OPERATIONS = frozenset({"compare", "compliance", "compliance-diff", "schedule", "takeoff", "profile"})
_LONG_TIMEOUT_SECONDS = 35


def _timeout_for(query: dict[str, Any]) -> int:
    return _LONG_TIMEOUT_SECONDS if query.get("op") in _LONG_OPERATIONS else _REQUEST_TIMEOUT_SECONDS


class BimQueryUnavailableError(bff_http.BffError):
    ...


class BimQueryRejectedError(bff_http.BffError, ValueError):
    ...


def _issue_summary(details: Any) -> str:
    if not isinstance(details, list):
        return ""
    parts: list[str] = []
    for issue in details[:3]:
        if not isinstance(issue, dict):
            continue
        message = issue.get("message")
        if not isinstance(message, str) or not message:
            continue
        path = issue.get("path")
        where = ".".join(str(step) for step in path) if isinstance(path, list) else ""
        parts.append(f"{where}: {message}" if where else message)
    return "; ".join(parts)[:300]


def _rejection_message(exc: bff_http.BffRefusedError) -> str:
    body = exc.body
    headline = body.get("error") or body.get("message")
    headline = headline if isinstance(headline, str) and 0 < len(headline) <= 300 else ""
    issues = _issue_summary(body.get("details"))

    if headline and issues:
        return f"{headline} — {issues}"
    return headline or issues or f"the query was refused ({exc.status})"


def is_correctable(exc: bff_http.BffRefusedError) -> bool:
    return 400 <= exc.status < 500 and exc.status not in (401, 403, 429)


def run_bim_query(
    *,
    organization_id: str,
    project_id: str | None,
    query: dict[str, Any],
    model_id: str | None = None,
    model_name: str | None = None,
    compare_with_name: str | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {"organizationId": organization_id, "query": query}
    if project_id:
        payload["projectId"] = project_id
    if model_id:
        payload["modelId"] = model_id
    if model_name:
        payload["modelName"] = model_name
    if compare_with_name:
        payload["compareWithName"] = compare_with_name

    try:
        parsed = bff_http.post_json("/api/internal/bim/query", payload, timeout=_timeout_for(query))
    except bff_http.BffNotConfiguredError as exc:
        raise BimQueryUnavailableError(str(exc)) from exc
    except bff_http.BffRefusedError as exc:
        logger.warning("BIM query rejected by the frontend (status=%s)", exc.status)
        if is_correctable(exc):
            raise BimQueryRejectedError(_rejection_message(exc)) from exc
        raise BimQueryUnavailableError(f"internal BIM endpoint returned {exc.status}") from exc
    except bff_http.BffMalformedResponseError as exc:
        raise BimQueryUnavailableError("internal BIM endpoint returned a non-JSON body") from exc
    except bff_http.BffError as exc:
        logger.warning("BIM query could not reach the frontend: %s", type(exc.__cause__).__name__)
        raise BimQueryUnavailableError("internal BIM endpoint unreachable") from exc

    if not isinstance(parsed, dict):
        raise BimQueryUnavailableError("internal BIM endpoint returned an unexpected body")
    return parsed
