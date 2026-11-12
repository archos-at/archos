"""Project Memory client — backend write access via the internal BFF endpoint.

Strict separation of concerns: the ``app`` database has exactly ONE
writer, the Next.js BFF. The backend never opens a connection to it. The
``remember`` tool posts findings to the internal endpoint
``POST /api/internal/memory`` over the compose network, authenticated with a
shared service token (``INTERNAL_API_TOKEN`` set on both services).

See docs/architecture/project-memory-design.md.
"""

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
    """The memory route refused a write for a reason the caller handles by name."""


class CrossProjectMemoryRefusedError(ProjectMemoryError):
    """The frontend refused a write from a conversation that drew on another project (ADR-0094).

    Raised when ``POST /api/internal/memory`` answers 409 ``CROSS_PROJECT_MEMORY``.
    Nothing is remembered from such a conversation, at any scope and by any
    path: a caller must not offer the reader a way around it (a
    ``memory_proposal`` card would write the same finding through the reader's
    own session).
    """


class OrgMemoryDisabledError(ProjectMemoryError):
    """The frontend refused an agent organization-scoped write on purpose.

    Raised when ``POST /api/internal/memory`` returns 403 with the
    ``ORG_MEMORY_DISABLED`` code — i.e. ``ALLOW_AGENT_ORG_MEMORY`` is not
    enabled on the frontend service (audit finding S1 default-deny). This is a
    deployment-policy denial, NOT a service-token mismatch, so callers surface
    it to the user distinctly instead of retrying.
    """


class TemporaryConversationError(ProjectMemoryError):
    """The frontend refused a write from a temporary conversation (ADR-0180).

    Raised when ``POST /api/internal/memory`` or ``POST
    /api/internal/personal-memory`` answers 403 ``TEMPORARY_CONVERSATION``. A
    temporary conversation keeps nothing, at any scope and by any path, so a
    caller offers no way around it (no card) and does not retry.
    """


#: The refusal code both memory routes answer a temporary conversation's write with (403).
TEMPORARY_CONVERSATION_CODE = "TEMPORARY_CONVERSATION"

VALID_KINDS = {"decision", "constraint", "open_question", "derived_fact", "preference"}
VALID_CONFIDENCES = {"low", "medium", "high"}
VALID_SCOPES = {"project", "organization"}

_REQUEST_TIMEOUT_SECONDS = 5
# The digest read runs on the per-turn critical path, right before intent
# classification, so a slow BFF must never stall the turn for the full 5s the
# write calls allow. Keep it tight; on timeout fetch_memory_digest raises and
# the caller falls back to the frozen connection-time digest (fail-open).
# 2.5s, up from 1.5: the digest build now embeds the turn's question for
# relevance-ranked recall (the BFF gives that embed call ~1s of this budget).
# Still bounded and still fail-open to the frozen header digest — a slow BFF
# costs staleness, never the turn.
_DIGEST_TIMEOUT_SECONDS = 2.5


@dataclass(frozen=True)
class TurnMemoryNote:
    """One project or organization note a write created, as the answer's noted chip shows it.

    Never a personal note (ADR-0180): this record rides the reflection stage's
    frame, which is stored on a message other people read.
    """

    id: str
    kind: str
    content: str
    #: ``project`` or ``organization``: the shelf, and so who reads the note.
    scope: str
    #: The earlier note this one retired, quoted, when the BFF confirmed the retirement.
    supersedes: str | None = None
    #: Stored as restricted memory (ADR-0087): shown only to people cleared for its folders.
    restricted: bool = False

    def frame_item(self, *, in_turn: bool) -> dict[str, object]:
        """The note as an item of the ``memory_reflection`` frame; absent keys are the defaults."""
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
    """The turn's memory ledger: the digest it was shown and what it wrote."""

    #: The project-memory digest the agent was shown this turn (ADR-0087: its
    #: ``restricted`` lines are restricted content in the prompt).
    digest: str | None = None
    writes: list[str] = field(default_factory=list)
    #: The project and organization notes those writes CREATED, with their ids
    #: (a restated note the BFF refreshed in place is in ``writes`` only).
    notes: list[TurnMemoryNote] = field(default_factory=list)
    #: The subset of ``writes`` stored as restricted memory.
    restricted_writes: list[str] = field(default_factory=list)
    #: The conversation is temporary (ADR-0180): nothing from it is kept, so
    #: the ``remember`` tool answers without calling the BFF.
    temporary: bool = False
    #: The ``PERSONAL_MEMORY v1`` block of the person asking, for the chat
    #: prompt's turn context. Held here and not on the graph state: the
    #: state is checkpointed with the conversation and handed to deep research,
    #: and both are read by people the notes are not for.
    personal_memory: str | None = None
    #: The id of the answer the writes under this log belong to
    #: (``turn.response.answer_message_id``), which the browser holds as that
    #: answer's message id. A personal note is stored with it, so the answer's
    #: chip can show the note to its owner; None off the WebSocket path.
    answer_message_id: str | None = None
    #: Ids the route answered for a write that created nothing: a restated
    #: note, refreshed in place.
    refreshed: list[str] = field(default_factory=list)


#: What the ``remember`` tool wrote during THIS turn, per turn. The
#: post-answer reflection stage reflects against the digest the agent saw at
#: the start of the turn, so without this a fact the tool recorded mid-turn
#: is proposed again minutes later — and lands as a second row whenever the
#: BFF's dedup gates disagree on kind or wording. Same shape as the card
#: registry: bound per turn, never module-level state (AGENTS.md).
_turn_memory_log: ContextVar[_TurnMemoryLog | None] = ContextVar("turn_memory_log", default=None)


def begin_turn_memory_log(
    digest: str | None = None,
    *,
    temporary: bool = False,
    personal_memory: str | None = None,
    answer_message_id: str | None = None,
) -> Token:
    """Start recording this turn's memory writes; reset with the token.

    ``digest`` is the memory digest the agent is shown this turn, kept so the
    ``remember`` tool can tell which restricted notes were in its prompt.
    ``temporary`` and ``personal_memory`` are the turn context's (ADR-0180):
    whether the conversation keeps nothing, and the asker's personal notes.
    ``answer_message_id`` names the answer the writes belong to. The reflection
    stage binds a log of its own for its writes, after the turn's is gone.
    """
    return _turn_memory_log.set(
        _TurnMemoryLog(
            digest=digest, temporary=temporary, personal_memory=personal_memory, answer_message_id=answer_message_id
        )
    )


def end_turn_memory_log(token: Token) -> None:
    _turn_memory_log.reset(token)


def record_turn_memory_write(content: str, *, restricted: bool = False) -> None:
    """Note a write that landed this turn. No-op outside a turn."""
    log = _turn_memory_log.get()
    if log is not None and content:
        log.writes.append(content)
        if restricted:
            log.restricted_writes.append(content)


def turn_memory_notes() -> tuple[TurnMemoryNote, ...]:
    """The project and organization notes created under the bound log, in write order."""
    log = _turn_memory_log.get()
    return tuple(log.notes) if log is not None else ()


def turn_refreshed_memory_ids() -> frozenset[str]:
    """Ids of the notes a write under the bound log only refreshed (it created no row)."""
    log = _turn_memory_log.get()
    return frozenset(log.refreshed) if log is not None else frozenset()


def turn_answer_message() -> str | None:
    """The id of the answer the bound log's writes belong to; None outside a turn or off the WebSocket path."""
    log = _turn_memory_log.get()
    return log.answer_message_id if log is not None else None


def _record_write(body: object, payload: Mapping[str, object]) -> str | None:
    """Enter a stored write in the bound log and answer its id; None when the route named no item.

    The note is kept for the answer's chip only when the route created a row
    (``created``; an older BFF does not say, and is believed) and the earlier
    note counts as replaced only when the route retired one (``supersededId``).
    """
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
    """The memory digest the agent was shown this turn; None outside a turn."""
    log = _turn_memory_log.get()
    return log.digest if log is not None else None


def turn_is_temporary() -> bool:
    """Whether this turn's conversation is temporary (ADR-0180); False outside a turn."""
    log = _turn_memory_log.get()
    return log is not None and log.temporary


def turn_personal_memory() -> str | None:
    """The asker's ``PERSONAL_MEMORY v1`` block this turn; None outside a turn or without one."""
    log = _turn_memory_log.get()
    return log.personal_memory if log is not None else None


def turn_restricted_memory_writes() -> tuple[str, ...]:
    """The contents written this turn as restricted memory, in order."""
    log = _turn_memory_log.get()
    return tuple(log.restricted_writes) if log is not None else ()


def turn_memory_writes() -> tuple[str, ...]:
    """The contents written this turn, in order; empty outside a turn."""
    log = _turn_memory_log.get()
    return tuple(log.writes) if log is not None else ()


VALID_PROVENANCES = {"agent", "distillation"}

#: The longest topic the BFF keeps (``MEMORY_TOPIC_MAX_LENGTH``). A longer one is
#: dropped here, not sent: the note is still worth keeping, and the BFF would refuse it.
MEMORY_TOPIC_MAX_LENGTH = 40


def memory_topic(raw: object) -> str:
    """The topic to send with a note: trimmed, or "" when there is none or it is too long to keep."""
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
    """Fetch the CURRENT core-memory digest via the internal BFF endpoint.

    A signed-in chat turn reads its digest from the turn context (ADR-0077) and
    calls this only when its signed scope holds restricted collections. The job
    worker calls it too, and a turn where nobody signs in: its digest rides the
    ``x-grid-project-memory`` handshake header, frozen for the connection's life.

    The channel carries three blocks, not one: ``PROJECT_MEMORY``,
    ``PROPOSAL_DECISIONS`` and — when this turn belongs to a conversation —
    ``REVIEW_DECISIONS``, what a person decided about the drafts that
    conversation filed. ``conversation_id`` defaults to the ACTIVE conversation
    read off the agent runtime's context rather than to nothing, so a caller that has one
    need not thread it through: the digest fetch is per turn and the turn always
    knows which conversation it is. Pass it explicitly to override, or pass
    ``""`` to ask for no review block at all.

    ``restricted_collections`` are the restricted-folder collections this
    interactive chat turn may draw on (ADR-0087, ADR-0088), and ``user_id`` its
    signed asker. Their presence makes the turn eligible for restricted memory:
    a note whose source folders the asker may read now is served once the BFF
    has admitted (and recorded) those folders for the conversation against
    everyone who reads it. A caller passes exactly what its verified envelope
    carries — never a scope it read from an unsigned header, and nothing at all
    off the interactive chat path. When the BFF says it served restricted notes
    (``restrictedFoldersServed``), the turn's bound
    :class:`agent.knowledge.restricted_use.RestrictedUse` is confined.

    Returns the digest string, or ``None`` when there is no active memory (a valid
    empty result). Raises :class:`agent.common.bff_http.BffError` (a
    ``RuntimeError``) on configuration, refusal and transport problems alike, so
    the caller can fall back to the frozen header digest
    instead of dropping memory entirely. Blocking; call via ``asyncio.to_thread``
    — which copies the current context, so the default read below still sees it.
    """
    if not project_id and not organization_id:
        return None
    if conversation_id is None:
        # Imported here rather than at module scope: `project_context` is the
        # header layer and this module is a knowledge one, and the four other
        # readers of the agent runtime's context in this package do the same.
        from agent.project_context import get_conversation_id_from_context

        conversation_id = get_conversation_id_from_context()

    params = {}
    if project_id:
        params["projectId"] = project_id
    if organization_id:
        params["organizationId"] = organization_id
    if query and query.strip():
        # This turn's question. With it the BFF ranks recall by relevance
        # instead of serving the twenty most recently touched notes; without it
        # the digest is exactly what it was before. Bounded here as well as
        # there — a caller must not be able to post a transcript as a param.
        params["query"] = query.strip()[:2000]
    if conversation_id and conversation_id.strip():
        # Scopes the REVIEW_DECISIONS block. Not an authorization input on the
        # BFF side — the tenant is pinned from the project/organization above —
        # so an id that names nothing yields an empty block, which is also what
        # a conversation that has filed nothing looks like.
        params["conversationId"] = conversation_id.strip()[:200]
    restricted = [name.strip() for name in restricted_collections if isinstance(name, str) and name.strip()]
    if restricted:
        params["restrictedCollections"] = ",".join(dict.fromkeys(restricted))
    if user_id and user_id.strip():
        params["userId"] = user_id.strip()[:128]
    use = current_restricted_use()
    if restricted and use is not None and use.answer_message_id:
        # The answer this turn writes: marked when a restricted note is
        # admitted, in the same transaction (ADR-0093).
        params["answerMessageId"] = use.answer_message_id
    body = bff_http.get_json("/api/internal/memory/digest", timeout=_DIGEST_TIMEOUT_SECONDS, query=params)
    if not isinstance(body, dict):
        raise bff_http.BffMalformedResponseError("the memory digest answered with something that is not an object")
    if body.get("restrictedFoldersServed"):
        # Restricted notes entered the prompt: the BFF recorded their folders
        # for the conversation.
        use = current_restricted_use()
        if use is not None:
            use.note_recorded()
    digest = body.get("digest")
    return digest if isinstance(digest, str) and digest.strip() else None


# A memory row is durable, tenant-wide within its scope, and read into every
# later prompt, so a finding that carries a person's contact details or a
# secret must not be written by EITHER writer. This guard used to live only in
# the reflection stage; the in-turn ``remember`` tool wrote whatever the model
# handed it. It sits here now, on the one path both writers share. The rules
# are :mod:`agent.knowledge.memory_content_guard`, the twin of the refusal the
# BFF makes at its one writer; the agent's copy saves the round trip.


def looks_like_personal_data(content: str) -> bool:
    """Whether a memory finding holds a secret or a way to reach a person.

    A denylist of shapes, not a privacy guarantee (audit S4). Guards project
    and organization memory, which other people read.
    """
    return note_refusal(content, shared=True) is not None


def looks_like_secret(content: str) -> bool:
    """Whether a note holds a secret: the part of the denylist that guards personal memory too.

    A note about the person is what personal memory is for, so their contact
    details pass; an account number, an identity number or a credential does not.
    """
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
    """Record one memory item via the internal BFF endpoint.

    ``provenance_type`` distinguishes how the item was captured: ``agent`` for a
    deliberate in-turn ``remember`` call, ``distillation`` for the async
    post-answer reflection stage. It lets the UI label the two differently.

    ``supersedes_content`` is the verbatim content of an existing entry this
    finding makes obsolete, quoted back from the digest the caller was shown.
    It is how the agent CORRECTS memory instead of only appending to it: the
    frontend resolves the quote to an active item in the same scope, marks it
    ``superseded`` and links the new row via ``supersedes_id``. An unresolvable
    quote is ignored, and human-curated entries are never retired this way, so
    passing it is always safe — the write still happens either way.

    ``restricted_collections`` makes the item restricted memory (ADR-0087): the
    restricted-folder collections it depends on, as
    :mod:`agent.memory.restriction` decided. Project scope only — the BFF
    refuses a restricted organization write, and refuses (400) a collection that
    is not a current restricted collection of the project.

    ``restriction_judge`` is the memory judge's verdict on this item, when it
    was asked (``JudgeVerdict.as_payload``): the BFF records it in the audit
    trail with the item it was about. Collections only, never text.

    ``topic`` is the subject the note is filed under on its shelf, sent only when
    :func:`memory_topic` keeps one; the BFF normalizes it against the shelf's topics.

    Returns the new item id, or None when the target (project/org) is unknown.
    Raises :class:`agent.common.bff_http.BffError` (a ``RuntimeError``)
    for configuration, refusal and transport failures — callers translate these
    into friendly tool output.
    Blocking; call via ``asyncio.to_thread`` from async code.
    """
    if scope not in VALID_SCOPES:
        raise ValueError(f"Invalid scope '{scope}'. Must be one of: {sorted(VALID_SCOPES)}")
    if kind not in VALID_KINDS:
        raise ValueError(f"Invalid kind '{kind}'. Must be one of: {sorted(VALID_KINDS)}")
    if confidence not in VALID_CONFIDENCES:
        raise ValueError(f"Invalid confidence '{confidence}'. Must be one of: {sorted(VALID_CONFIDENCES)}")
    if provenance_type not in VALID_PROVENANCES:
        provenance_type = "agent"
    if looks_like_personal_data(content):
        # Not recorded, and not an error: the caller is told nothing was
        # written, the same way it is for an unknown project.
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
        # Write-time importance (0..1), elicited by the reflection stage. Sent
        # only when the caller rated it — the column's 0.5 default is the
        # neutral midpoint and must stay the fallback, not an explicit write.
        payload["salience"] = max(0.0, min(1.0, float(salience)))
    payload.update(_shelf_fields(restricted_collections, restriction_judge, topic))

    try:
        body = bff_http.post_json("/api/internal/memory", payload, timeout=_REQUEST_TIMEOUT_SECONDS)
    except bff_http.BffRefusedError as exc:
        if exc.status == 404:
            # Unknown project — nothing recorded, not a transport failure.
            return None
        _raise_named_refusal(exc)
        raise
    # The ledger entry, and the note the answer's chip shows, are made of what
    # was SENT and what the route answered: the stored text is the payload's
    # (stripped and capped), and only the route knows whether a row was created
    # or an earlier note retired.
    return _record_write(body, payload)


def _shelf_fields(
    restricted_collections: Sequence[str] | None,
    restriction_judge: Mapping[str, object] | None,
    topic: str | None,
) -> dict[str, object]:
    """The optional fields of a shelf write: the restriction the caller decided, and the note's topic."""
    fields: dict[str, object] = {}
    if restricted_collections:
        fields["restrictedCollections"] = sorted(set(restricted_collections))
    if restriction_judge:
        fields["restrictionJudge"] = dict(restriction_judge)
    if kept_topic := memory_topic(topic):
        fields["topic"] = kept_topic
    return fields


def _raise_named_refusal(exc: bff_http.BffRefusedError) -> None:
    """Log a refused write, and raise the named error for the three refusals a caller handles."""
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
        # Expected default-deny (audit finding S1), not a misconfiguration:
        # an agent's service token may not write org-wide memory, so the
        # caller routes the user to the confirmation-card path instead.
        # Logged at INFO (the caller logs the handled outcome); set
        # ALLOW_AGENT_ORG_MEMORY=true on the frontend to let agents
        # write org-wide directly.
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
    """Startup handshake against the internal API health endpoint.

    GETs ``/api/internal/health`` with the service token to make the internal
    write path's health visible AT DEPLOY TIME rather than only when the first
    ``remember`` call fails. Purely diagnostic and NON-FATAL: logs the outcome
    and never raises, so a not-yet-up (or misconfigured) frontend never blocks
    backend startup. Blocking; call via ``asyncio.to_thread`` / a background
    task. Returns ``True`` only on a confirmed 200.
    """
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
        # Connection refused / DNS / timeout — the frontend may simply not be up
        # yet at backend startup. Non-fatal; the first `remember` call re-checks.
        logger.warning(
            "Internal API health check could not reach %s (%s) — the frontend may not be up yet.",
            bff_http.internal_base_url(),
            exc,
        )
        return False
    logger.info("internal API reachable, service token accepted")
    return True
