from __future__ import annotations

import logging
from collections.abc import Mapping
from collections.abc import Sequence
from contextvars import ContextVar
from contextvars import Token
from dataclasses import dataclass
from dataclasses import field

from agent.common import bff_http
from agent.knowledge.memory_content_guard import note_refusal
from agent.knowledge.restricted_use import current_restricted_use

logger = logging.getLogger(__name__)


class ProjectMemoryError(bff_http.BffError):
    ...


class CrossProjectMemoryRefusedError(ProjectMemoryError):
    ...


class OrgMemoryDisabledError(ProjectMemoryError):
    ...


class TemporaryConversationError(ProjectMemoryError):
    ...


TEMPORARY_CONVERSATION_CODE = "TEMPORARY_CONVERSATION"

VALID_KINDS = {"decision", "constraint", "open_question", "derived_fact", "preference"}
VALID_CONFIDENCES = {"low", "medium", "high"}
VALID_SCOPES = {"project", "organization"}

_REQUEST_TIMEOUT_SECONDS = 5
_DIGEST_TIMEOUT_SECONDS = 2.5


@dataclass(frozen=True)
class TurnMemoryNote:

    id: str
    kind: str
    content: str
    scope: str
    supersedes: str | None = None
    restricted: bool = False

    def frame_item(self, *, in_turn: bool) -> dict[str, object]:
        item: dict[str, object] = {"id": self.id, "kind": self.kind, "content": self.content}
        if in_turn:
            item["provenance"] = "agent"
        if self.scope == "organization":
            item["scope"] = "organization"
        if self.supersedes:
            item["supersedes"] = self.supersedes
        if self.restricted:
            item["restricted"] = True
        return item


@dataclass
class _TurnMemoryLog:

    digest: str | None = None
    writes: list[str] = field(default_factory=list)
    notes: list[TurnMemoryNote] = field(default_factory=list)
    restricted_writes: list[str] = field(default_factory=list)
    temporary: bool = False
    personal_memory: str | None = None
    answer_message_id: str | None = None
    refreshed: list[str] = field(default_factory=list)


_turn_memory_log: ContextVar[_TurnMemoryLog | None] = ContextVar("turn_memory_log", default=None)


def begin_turn_memory_log(
    digest: str | None = None,
    *,
    temporary: bool = False,
    personal_memory: str | None = None,
    answer_message_id: str | None = None,
) -> Token:
    return _turn_memory_log.set(
        _TurnMemoryLog(
            digest=digest, temporary=temporary, personal_memory=personal_memory, answer_message_id=answer_message_id
        )
    )


def end_turn_memory_log(token: Token) -> None:
    _turn_memory_log.reset(token)


def record_turn_memory_write(content: str, *, restricted: bool = False) -> None:
    log = _turn_memory_log.get()
    if log is not None and content:
        log.writes.append(content)
        if restricted:
            log.restricted_writes.append(content)


def turn_memory_notes() -> tuple[TurnMemoryNote, ...]:
    log = _turn_memory_log.get()
    return tuple(log.notes) if log is not None else ()


def turn_refreshed_memory_ids() -> frozenset[str]:
    log = _turn_memory_log.get()
    return frozenset(log.refreshed) if log is not None else frozenset()


def turn_answer_message() -> str | None:
    log = _turn_memory_log.get()
    return log.answer_message_id if log is not None else None


def _record_write(body: object, payload: Mapping[str, object]) -> str | None:
    answer = body if isinstance(body, dict) else {}
    item = answer.get("item")
    item_id = item.get("id") if isinstance(item, dict) else None
    if not item_id:
        return None
    content = str(payload["content"])
    restricted = bool(payload.get("restrictedCollections"))
    record_turn_memory_write(content, restricted=restricted)
    log = _turn_memory_log.get()
    if log is not None and answer.get("created") is False:
        log.refreshed.append(str(item_id))
    elif log is not None:
        retired = str(payload.get("supersedesContent") or "") if answer.get("supersededId") else ""
        log.notes.append(
            TurnMemoryNote(
                id=str(item_id),
                kind=str(payload["kind"]),
                content=content,
                scope=str(payload["scope"]),
                supersedes=retired or None,
                restricted=restricted,
            )
        )
    return str(item_id)


def turn_memory_digest() -> str | None:
    log = _turn_memory_log.get()
    return log.digest if log is not None else None


def turn_is_temporary() -> bool:
    log = _turn_memory_log.get()
    return log is not None and log.temporary


def turn_personal_memory() -> str | None:
    log = _turn_memory_log.get()
    return log.personal_memory if log is not None else None


def turn_restricted_memory_writes() -> tuple[str, ...]:
    log = _turn_memory_log.get()
    return tuple(log.restricted_writes) if log is not None else ()


def turn_memory_writes() -> tuple[str, ...]:
    log = _turn_memory_log.get()
    return tuple(log.writes) if log is not None else ()


VALID_PROVENANCES = {"agent", "distillation"}

MEMORY_TOPIC_MAX_LENGTH = 40


def memory_topic(raw: object) -> str:
    topic = raw.strip() if isinstance(raw, str) else ""
    return topic if len(topic) <= MEMORY_TOPIC_MAX_LENGTH else ""


def fetch_memory_digest(
    *,
    project_id: str | None,
    organization_id: str | None,
    query: str | None = None,
    conversation_id: str | None = None,
    restricted_collections: Sequence[str] = (),
    user_id: str | None = None,
) -> str | None:
    if not project_id and not organization_id:
        return None
    if conversation_id is None:
        from agent.project_context import get_conversation_id_from_context

        conversation_id = get_conversation_id_from_context()

    params = {}
    if project_id:
        params["projectId"] = project_id
    if organization_id:
        params["organizationId"] = organization_id
    if query and query.strip():
        params["query"] = query.strip()[:2000]
    if conversation_id and conversation_id.strip():
        params["conversationId"] = conversation_id.strip()[:200]
    restricted = [name.strip() for name in restricted_collections if isinstance(name, str) and name.strip()]
    if restricted:
        params["restrictedCollections"] = ",".join(dict.fromkeys(restricted))
    if user_id and user_id.strip():
        params["userId"] = user_id.strip()[:128]
    use = current_restricted_use()
    if restricted and use is not None and use.answer_message_id:
        params["answerMessageId"] = use.answer_message_id
    body = bff_http.get_json("/api/internal/memory/digest", timeout=_DIGEST_TIMEOUT_SECONDS, query=params)
    if not isinstance(body, dict):
        raise bff_http.BffMalformedResponseError("the memory digest answered with something that is not an object")
    if body.get("restrictedFoldersServed"):
        use = current_restricted_use()
        if use is not None:
            use.note_recorded()
    digest = body.get("digest")
    return digest if isinstance(digest, str) and digest.strip() else None




def looks_like_personal_data(content: str) -> bool:
    return note_refusal(content, shared=True) is not None


def looks_like_secret(content: str) -> bool:
    return note_refusal(content, shared=False) is not None


def insert_memory_item(
    *,
    scope: str,
    project_id: str | None,
    organization_id: str | None,
    kind: str,
    content: str,
    confidence: str = "medium",
    conversation_id: str | None = None,
    provenance_type: str = "agent",
    supersedes_content: str | None = None,
    salience: float | None = None,
    restricted_collections: Sequence[str] | None = None,
    restriction_judge: Mapping[str, object] | None = None,
    topic: str | None = None,
) -> str | None:
    if scope not in VALID_SCOPES:
        raise ValueError(f"Invalid scope '{scope}'. Must be one of: {sorted(VALID_SCOPES)}")
    if kind not in VALID_KINDS:
        raise ValueError(f"Invalid kind '{kind}'. Must be one of: {sorted(VALID_KINDS)}")
    if confidence not in VALID_CONFIDENCES:
        raise ValueError(f"Invalid confidence '{confidence}'. Must be one of: {sorted(VALID_CONFIDENCES)}")
    if provenance_type not in VALID_PROVENANCES:
        provenance_type = "agent"
    if looks_like_personal_data(content):
        logger.info("Memory item not recorded: content matches a personal-data shape (scope=%s)", scope)
        return None

    payload: dict[str, object] = {
        "scope": scope,
        "kind": kind,
        "content": content.strip()[:2000],
        "confidence": confidence,
        "provenanceType": provenance_type,
    }
    if project_id:
        payload["projectId"] = project_id
    if organization_id:
        payload["organizationId"] = organization_id
    if conversation_id:
        payload["sourceConversationId"] = conversation_id
    if supersedes_content and supersedes_content.strip():
        payload["supersedesContent"] = supersedes_content.strip()[:2000]
    if salience is not None:
        payload["salience"] = max(0.0, min(1.0, float(salience)))
    payload.update(_shelf_fields(restricted_collections, restriction_judge, topic))

    try:
        body = bff_http.post_json("/api/internal/memory", payload, timeout=_REQUEST_TIMEOUT_SECONDS)
    except bff_http.BffRefusedError as exc:
        if exc.status == 404:
            return None
        _raise_named_refusal(exc)
        raise
    return _record_write(body, payload)


def _shelf_fields(
    restricted_collections: Sequence[str] | None,
    restriction_judge: Mapping[str, object] | None,
    topic: str | None,
) -> dict[str, object]:
    fields: dict[str, object] = {}
    if restricted_collections:
        fields["restrictedCollections"] = sorted(set(restricted_collections))
    if restriction_judge:
        fields["restrictionJudge"] = dict(restriction_judge)
    if kept_topic := memory_topic(topic):
        fields["topic"] = kept_topic
    return fields


def _raise_named_refusal(exc: bff_http.BffRefusedError) -> None:
    if 300 <= exc.status < 400:
        logger.error(
            "Internal memory endpoint redirected (%s) — an auth middleware is "
            "intercepting %s/api/internal/memory. Exclude /api/internal/* from "
            "the frontend auth proxy (unauthenticatedPaths in proxy.ts).",
            exc.status,
            bff_http.internal_base_url(),
        )
    elif exc.status == 403 and exc.code == TEMPORARY_CONVERSATION_CODE:
        logger.info("Internal memory endpoint declined a write from a temporary conversation")
        raise TemporaryConversationError("the conversation is temporary", status=403, code=exc.code) from exc
    elif exc.status == 403 and exc.code == "ORG_MEMORY_DISABLED":
        logger.info(
            "Internal memory endpoint declined an agent organization-scoped write "
            "(403 ORG_MEMORY_DISABLED); routing to the user confirmation card"
        )
        raise OrgMemoryDisabledError(
            "agent organization-scoped memory is disabled on the frontend", status=403, code=exc.code
        ) from exc
    elif exc.status == 403:
        logger.error(
            "Internal memory endpoint rejected the service token (403) — INTERNAL_API_TOKEN "
            "mismatch between the aiq-agent and frontend services (the same value must be set on both)."
        )
    elif exc.status == 409 and exc.code == "CROSS_PROJECT_MEMORY":
        logger.info("Internal memory endpoint declined a write from a conversation that drew on another project")
        raise CrossProjectMemoryRefusedError(
            "the conversation drew on another project", status=409, code=exc.code
        ) from exc
    elif exc.status == 503:
        logger.error(
            "Internal memory endpoint disabled (503) — INTERNAL_API_TOKEN "
            "is unset, or is the dev default in a non-dev environment "
            "(set APP_ENV=development on the frontend or configure a real token)."
        )
    else:
        logger.warning("Internal memory endpoint returned %s", exc.status)


def check_internal_api() -> bool:
    try:
        bff_http.send("GET", "/api/internal/health", timeout=_REQUEST_TIMEOUT_SECONDS)
    except bff_http.BffNotConfiguredError:
        logger.error(
            "Cannot verify the internal API: INTERNAL_API_TOKEN is not configured on the "
            "aiq-agent service. The `remember` tool will not be able to write memory."
        )
        return False
    except bff_http.BffRefusedError as exc:
        if exc.status == 403:
            logger.error(
                "Internal API rejected the service token (403) — INTERNAL_API_TOKEN mismatch "
                "between the aiq-agent and frontend services (the same value must be set on both)."
            )
        elif exc.status == 503:
            logger.error(
                "Internal API disabled (503) — INTERNAL_API_TOKEN is unset on the frontend, "
                "or is the well-known dev default in a non-dev environment (set APP_ENV=development "
                "on the frontend or configure a real token)."
            )
        else:
            logger.warning("Internal API health check returned %s", exc.status)
        return False
    except bff_http.BffError as exc:
        logger.warning(
            "Internal API health check could not reach %s (%s) — the frontend may not be up yet.",
            bff_http.internal_base_url(),
            exc,
        )
        return False
    logger.info("internal API reachable, service token accepted")
    return True
