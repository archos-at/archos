from __future__ import annotations

import base64
import binascii
import contextvars
import hashlib
import hmac
import json
import logging
import os
import time
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from agent.common import bff_http

logger = logging.getLogger(__name__)

TURN_DECISION_PATH = "/api/internal/turn-decision"
DECISION_HEADER = "x-turn-decision"
SIGNATURE_HEADER = "x-turn-decision-signature"
MAX_AGE_MS = 30 * 60 * 1000
_TIMEOUT_SECONDS = 5.0

_KINDS = frozenset({"chat", "run", "headless", "external"})
_WORKSPACE_READS = frozenset({"none", "document+projectFacts", "all"})
_REACHES = frozenset({"none", "every-reader", "chat-projects"})
_SHELVES = frozenset({"office_shelf", "project", "session", "base"})


@dataclass(frozen=True)
class TurnDecision:
    header: str
    signature: str
    conversation_id: str | None
    answer_message_id: str | None
    kind: str
    solo: bool
    recorded_restricted: bool
    audience_version: int | None
    issued_at: int
    shelves: tuple[Mapping[str, Any], ...]
    restricted_collections: frozenset[str]
    other_projects_reach: str
    restricted_folders: bool
    personal_memory: bool
    personal_shelf: bool
    workspace_read: str
    deep_research: bool
    tasks: bool

    def headers(self) -> dict[str, str]:
        return {DECISION_HEADER: self.header, SIGNATURE_HEADER: self.signature}

    def trace_metadata(self) -> dict[str, Any]:
        return {
            "context.kind": self.kind,
            "context.solo": self.solo,
            "context.audienceVersion": self.audience_version,
            "context.shelves": [str(entry.get("collection")) for entry in self.shelves],
            "context.personalMemory": self.personal_memory,
            "context.personalShelf": self.personal_shelf,
            "context.features": {"deepResearch": self.deep_research, "tasks": self.tasks},
        }


class _Missing:
    def __repr__(self) -> str:
        return "MISSING_DECISION"


MISSING = _Missing()

_bound: contextvars.ContextVar[TurnDecision | _Missing | None] = contextvars.ContextVar("turn_decision", default=None)


def bind_turn_decision(decision: TurnDecision | None) -> contextvars.Token:
    bff_http.bind_turn_headers(decision.headers() if decision is not None else None)
    return _bound.set(decision if decision is not None else MISSING)


def reset_turn_decision(token: contextvars.Token) -> None:
    bff_http.bind_turn_headers(None)
    _bound.reset(token)


def current_turn_decision() -> TurnDecision | None:
    bound = _bound.get()
    return bound if isinstance(bound, TurnDecision) else None


def decision_missing() -> bool:
    return isinstance(_bound.get(), _Missing)


def decision_required() -> bool:
    return (os.environ.get("REQUIRE_AUTH") or "").lower() == "true"


def _decode(header: str) -> bytes | None:
    try:
        return base64.urlsafe_b64decode(header + "=" * (-len(header) % 4))
    except binascii.Error, ValueError:
        return None


def _bool(value: Any) -> bool:
    if not isinstance(value, bool):
        raise ValueError("not a boolean")
    return value


def _strings(value: Any) -> list[str]:
    if not isinstance(value, list) or not all(isinstance(item, str) and item for item in value):
        raise ValueError("not a list of names")
    return value


def _shelf(entry: Any) -> Mapping[str, Any]:
    if not isinstance(entry, dict) or not isinstance(entry.get("collection"), str) or not entry["collection"]:
        raise ValueError("not a scoped collection")
    if set(entry) - {"collection", "shelf", "countries"}:
        raise ValueError("unknown scoped-collection key")
    if "shelf" in entry and entry["shelf"] not in _SHELVES:
        raise ValueError("unknown shelf")
    if "countries" in entry:
        _strings(entry["countries"])
    return dict(entry)


def _optional_str(value: Any) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str) or not value:
        raise ValueError("not a string")
    return value


def _build(header: str, signature: str, payload: Any) -> TurnDecision:
    if not isinstance(payload, dict):
        raise ValueError("not an object")
    may = payload["may"]
    if not isinstance(may, dict):
        raise ValueError("may is not an object")
    version = payload["audienceVersion"]
    if version is not None and (isinstance(version, bool) or not isinstance(version, int) or version < 0):
        raise ValueError("bad audience version")
    issued_at = payload["issuedAt"]
    if isinstance(issued_at, bool) or not isinstance(issued_at, int):
        raise ValueError("bad issuedAt")
    if payload["kind"] not in _KINDS or may["workspaceRead"] not in _WORKSPACE_READS:
        raise ValueError("unknown kind or workspace read")
    other, features = may["otherProjects"], may["features"]
    if not isinstance(other, dict) or other.get("reach") not in _REACHES or not isinstance(features, dict):
        raise ValueError("bad otherProjects or features")
    if not isinstance(may["shelves"], list):
        raise ValueError("shelves is not a list")
    return TurnDecision(
        header=header,
        signature=signature,
        conversation_id=_optional_str(payload["conversationId"]),
        answer_message_id=_optional_str(payload["answerMessageId"]),
        kind=payload["kind"],
        solo=_bool(payload["solo"]),
        recorded_restricted=_bool(payload["recordedRestricted"]),
        audience_version=version,
        issued_at=issued_at,
        shelves=tuple(_shelf(entry) for entry in may["shelves"]),
        restricted_collections=frozenset(_strings(may["restrictedCollections"])),
        other_projects_reach=other["reach"],
        restricted_folders=_bool(other["restrictedFolders"]),
        personal_memory=_bool(may["personalMemory"]),
        personal_shelf=_bool(may["personalShelf"]),
        workspace_read=may["workspaceRead"],
        deep_research=_bool(features["deepResearch"]),
        tasks=_bool(features["tasks"]),
    )


def verify_decision(
    header: str | None, signature: str | None, secret: str | None, *, now_ms: int | None = None
) -> TurnDecision | None:
    if not header or not signature or not secret:
        return None
    raw = _decode(header)
    if raw is None:
        return None
    expected = hmac.new(secret.encode("utf-8"), raw, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, signature):
        logger.warning("Turn decision signature mismatch: refused")
        return None
    try:
        decision = _build(header, signature, json.loads(raw.decode("utf-8")))
    except KeyError, ValueError, TypeError, UnicodeDecodeError:
        logger.warning("Turn decision malformed: refused", exc_info=True)
        return None
    now = now_ms if now_ms is not None else int(time.time() * 1000)
    if abs(now - decision.issued_at) > MAX_AGE_MS:
        logger.warning("Turn decision stale: refused")
        return None
    return decision


def fetch_turn_decision(
    envelope: bff_http.SignedEnvelope | None, *, conversation_id: str | None, answer_message_id: str | None
) -> TurnDecision | None:
    if envelope is None:
        return None
    body = {"answerMessageId": answer_message_id} if answer_message_id else {}
    try:
        answer = bff_http.send(
            "POST", TURN_DECISION_PATH, timeout=_TIMEOUT_SECONDS, body=body, headers=envelope.headers()
        )
        parsed = json.loads(answer.body.decode("utf-8"))
    except bff_http.BffError:
        logger.warning("The turn decision could not be fetched", exc_info=True)
        return None
    except ValueError, UnicodeDecodeError:
        logger.warning("The turn decision answer is not JSON")
        return None
    if not isinstance(parsed, dict):
        return None
    decision = verify_decision(parsed.get("decision"), parsed.get("signature"), bff_http.internal_token())
    if decision is not None and decision.conversation_id != conversation_id:
        logger.warning("The turn decision names another conversation: refused")
        return None
    return decision
