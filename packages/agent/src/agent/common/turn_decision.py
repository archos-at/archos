from __future__ import annotations

import base64
import binascii
import contextvars
import hashlib
import hmac
import json
import logging
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
_TIMEOUT_SECONDS = 2.5

_KINDS = frozenset({"chat", "run", "headless", "external"})
_WORKSPACE_READS = frozenset({"none", "document+projectFacts", "all"})
_REACHES = frozenset({"none", "every-reader", "chat-projects"})
_SOCKET_TURN_KINDS = frozenset({"chat", "headless"})
_SHELVES = frozenset({"office_shelf", "project", "session", "base", "personal"})


@dataclass(frozen=True)
class TurnDecision:
    header: str
    signature: str
    organization_id: str
    user_id: str
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

    def fresh(self, now_ms: int | None = None) -> bool:
        now = now_ms if now_ms is not None else int(time.time() * 1000)
        return abs(now - self.issued_at) <= MAX_AGE_MS

    def trace_metadata(self) -> dict[str, Any]:
        features = [name for name, on in (("deepResearch", self.deep_research), ("tasks", self.tasks)) if on]
        return {
            "context.decision": "bound",
            "context.kind": self.kind,
            "context.solo": self.solo,
            "context.audienceVersion": "null" if self.audience_version is None else self.audience_version,
            "context.shelves": [str(entry.get("collection")) for entry in self.shelves],
            "context.personalMemory": self.personal_memory,
            "context.personalShelf": self.personal_shelf,
            "context.features": ",".join(features) or "none",
        }


MISSING_TRACE = {"context.decision": "missing"}


class _Missing:
    def __repr__(self) -> str:
        return "MISSING_DECISION"


MISSING = _Missing()

_bound: contextvars.ContextVar[TurnDecision | _Missing | None] = contextvars.ContextVar("turn_decision", default=None)


def _decision_headers() -> dict[str, str] | None:
    decision = current_turn_decision()
    return decision.headers() if decision is not None and decision.fresh() else None


def bind_turn_decision(decision: TurnDecision | None) -> contextvars.Token:
    token = _bound.set(decision if decision is not None else MISSING)
    bff_http.bind_turn_headers(_decision_headers)
    return token


def reset_turn_decision(token: contextvars.Token) -> None:
    _bound.reset(token)


def current_turn_decision() -> TurnDecision | None:
    bound = _bound.get()
    return bound if isinstance(bound, TurnDecision) else None


def decision_missing() -> bool:
    return isinstance(_bound.get(), _Missing)


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


_DECISION_KEYS = frozenset(
    {
        "organizationId",
        "userId",
        "conversationId",
        "answerMessageId",
        "kind",
        "solo",
        "recordedRestricted",
        "audienceVersion",
        "issuedAt",
        "may",
    }
)
_MAY_KEYS = frozenset(
    {
        "shelves",
        "restrictedCollections",
        "otherProjects",
        "personalMemory",
        "personalShelf",
        "workspaceRead",
        "features",
    }
)


def _build(header: str, signature: str, payload: Any) -> TurnDecision:
    if not isinstance(payload, dict) or set(payload) != _DECISION_KEYS:
        raise ValueError("not a decision object")
    may = payload["may"]
    if not isinstance(may, dict) or set(may) != _MAY_KEYS:
        raise ValueError("may is not a decision's may")
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
    organization_id, user_id = payload["organizationId"], payload["userId"]
    if not isinstance(organization_id, str) or not organization_id or not isinstance(user_id, str) or not user_id:
        raise ValueError("no asker")
    return TurnDecision(
        header=header,
        signature=signature,
        organization_id=organization_id,
        user_id=user_id,
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
    envelope: bff_http.SignedEnvelope | None,
    *,
    conversation_id: str | None,
    answer_message_id: str | None,
    user_id: str | None = None,
    organization_id: str | None = None,
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
    if decision is None:
        return None
    if decision.conversation_id != conversation_id or decision.answer_message_id != answer_message_id:
        logger.warning("The turn decision names another conversation or answer: refused")
        return None
    if user_id is not None and decision.user_id != user_id:
        logger.warning("The turn decision names another asker: refused")
        return None
    if organization_id is not None and decision.organization_id != organization_id:
        logger.warning("The turn decision names another organization: refused")
        return None
    if decision.kind not in _SOCKET_TURN_KINDS:
        logger.warning("The turn decision is not for a socket turn: refused")
        return None
    return decision
