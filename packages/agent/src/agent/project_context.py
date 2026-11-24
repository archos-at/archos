import base64
import hashlib
import hmac
import json
import logging
import os
from dataclasses import dataclass
from typing import Any
from typing import Literal

from agent.profile_names import normalize_profile_token

PROJECT_CONTEXT_HEADER = "x-grid-project-context"
PROJECT_MEMORY_HEADER = "x-grid-project-memory"
MEMORY_HEADER_MAX_CHARS = 3000
ORG_INSTRUCTIONS_HEADER = "x-grid-org-instructions"

ORG_INSTRUCTIONS_MAX_CHARS = 1500

ORG_INSTRUCTIONS_TRUNCATED_MARKER = f"[Cut off at {ORG_INSTRUCTIONS_MAX_CHARS} characters — the rest was not sent.]"

PROJECT_ID_HEADER = "x-grid-project-id"
MEMORY_REFLECTION_FEATURE_HEADER = "x-grid-feature-memory-reflection"
ORGANIZATION_ID_HEADER = "x-grid-organization-id"
USER_ID_HEADER = "x-grid-user-id"

REQUEST_CONTEXT_ENVELOPE_HEADER = "x-grid-request-context"
REQUEST_CONTEXT_ENVELOPE_SIG_HEADER = "x-grid-request-context-sig"

TOOL_CONTEXT_REQUIREMENTS: dict[str, tuple[str, ...]] = {
    "project_memory_remember": (PROJECT_ID_HEADER, ORGANIZATION_ID_HEADER),
    "propose_file_change": (PROJECT_ID_HEADER, REQUEST_CONTEXT_ENVELOPE_HEADER, REQUEST_CONTEXT_ENVELOPE_SIG_HEADER),
    "file_draft": (PROJECT_ID_HEADER, REQUEST_CONTEXT_ENVELOPE_HEADER, REQUEST_CONTEXT_ENVELOPE_SIG_HEADER),
    "create_task": (PROJECT_ID_HEADER, REQUEST_CONTEXT_ENVELOPE_HEADER, REQUEST_CONTEXT_ENVELOPE_SIG_HEADER),
    "project_lookup": (REQUEST_CONTEXT_ENVELOPE_HEADER, REQUEST_CONTEXT_ENVELOPE_SIG_HEADER),
    "document_canvas": (REQUEST_CONTEXT_ENVELOPE_HEADER, REQUEST_CONTEXT_ENVELOPE_SIG_HEADER),
    "show_in_viewer": (REQUEST_CONTEXT_ENVELOPE_HEADER, REQUEST_CONTEXT_ENVELOPE_SIG_HEADER),
    "workspace_tools": (REQUEST_CONTEXT_ENVELOPE_HEADER, REQUEST_CONTEXT_ENVELOPE_SIG_HEADER),
    "project_intake_agent": (REQUEST_CONTEXT_ENVELOPE_HEADER, REQUEST_CONTEXT_ENVELOPE_SIG_HEADER),
}


COLLECTION_SCOPE_HEADER = "x-grid-collection-scope"
MODEL_OVERRIDES_HEADER = "x-grid-model-overrides"
BUDGET_HEADER = "x-grid-budget"
DISABLED_SOURCES_HEADER = "x-grid-disabled-sources"

_FEDERAL_STATE_TOKENS = frozenset(
    {
        "vienna",
        "lower_austria",
        "upper_austria",
        "styria",
        "carinthia",
        "salzburg",
        "tyrol",
        "vorarlberg",
        "burgenland",
        "outside_austria",
    }
)

logger = logging.getLogger(__name__)


def _normalize_federal_state(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    token = normalize_profile_token("federal_state", value.strip().lower())
    if token in _FEDERAL_STATE_TOKENS:
        return token
    if token:
        logger.debug("RequestContext: unknown federal_state token %r — treating as absent", token)
    return None


def normalize_project_context(value: str | None, *, max_chars: int = 4000) -> str | None:
    if not value:
        return None
    value = value.strip()
    if not value:
        return None
    if len(value) > max_chars:
        value = value[:max_chars]
        value = value.rsplit("\n", 1)[0]
    return value


def normalize_org_instructions(value: str | None) -> str | None:
    if not value:
        return None
    text = value.strip()
    if not text:
        return None
    if len(text) <= ORG_INSTRUCTIONS_MAX_CHARS:
        return text
    return f"{text[:ORG_INSTRUCTIONS_MAX_CHARS].rstrip()}\n{ORG_INSTRUCTIONS_TRUNCATED_MARKER}"


def _read_header(name: str) -> str | None:
    try:
        from nat.plugin_api import Context

        ctx = Context.get()
        if ctx is None or ctx.metadata is None:
            return None
        return ctx.metadata.headers.get(name)
    except Exception:
        logger.debug("Failed to read %s from NAT context", name, exc_info=True)
        return None


def _base64url_decode_text(raw: str) -> str:
    try:
        padded = raw + "=" * (-len(raw) % 4)
        return base64.urlsafe_b64decode(padded.encode("ascii")).decode("utf-8")
    except Exception:
        return raw


def _read_encoded_header(name: str) -> str | None:
    raw = _read_header(name)
    if not raw:
        return None
    return _base64url_decode_text(raw)


def _read_json_header(name: str) -> Any | None:
    raw = _read_header(name)
    if not raw:
        return None
    try:
        return json.loads(_base64url_decode_text(raw))
    except Exception:
        logger.debug("Failed to decode/parse %s as JSON", name, exc_info=True)
        return None


def _normalize_raw_id(value: str | None) -> str | None:
    if not value:
        return None
    value = value.strip()
    return value or None


REQUESTER_FIELD_MAX_CHARS = 120


def _one_line(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    line = " ".join(value.split())[:REQUESTER_FIELD_MAX_CHARS].strip()
    return line or None


def _as_requester(value: Any) -> dict[str, str | None] | None:
    if not isinstance(value, dict):
        return None
    requester = {field: _one_line(value.get(field)) for field in ("name", "email", "organizationName")}
    return requester if any(requester.values()) else None


def _as_str_list(value: Any) -> list[str] | None:
    if isinstance(value, list) and all(isinstance(item, str) for item in value):
        return value
    return None


def _as_scope_entries(value: Any) -> list[Any] | None:
    if not isinstance(value, list):
        return None
    for item in value:
        if isinstance(item, str):
            continue
        if isinstance(item, dict) and isinstance(item.get("collection"), str):
            continue
        return None
    return value


def _scope_names(entries: list[Any] | None) -> list[str] | None:
    if entries is None:
        return None
    names = [item if isinstance(item, str) else item["collection"] for item in entries]
    return [name for name in names if name.strip()]


def _as_str_dict(value: Any) -> dict[str, str] | None:
    if isinstance(value, dict) and all(isinstance(k, str) and isinstance(v, str) for k, v in value.items()):
        return value
    return None


def _as_dict(value: Any) -> dict[str, Any] | None:
    return value if isinstance(value, dict) else None


def _as_epoch_millis(value: Any) -> int | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return int(value)


def _read_memory_reflection_flag() -> bool:
    raw = _read_header(MEMORY_REFLECTION_FEATURE_HEADER)
    return (raw or "").strip().lower() == "true"


@dataclass(frozen=True)
class RequestContext:
    organization_id: str | None = None
    user_id: str | None = None
    project_id: str | None = None
    collection_scope: list[str] | None = None
    collection_scope_entries: list[Any] | None = None
    project_context: str | None = None
    project_memory: str | None = None
    org_instructions: str | None = None
    model_overrides: dict[str, str] | None = None
    budget: dict[str, Any] | None = None
    disabled_sources: list[str] | None = None
    memory_reflection_enabled: bool = False
    federal_state: str | None = None
    conversation_id: str | None = None
    issued_at: int | None = None
    envelope_header: str | None = None
    envelope_signature: str | None = None
    context_transport: Literal["bff"] | None = None
    requester: dict[str, str | None] | None = None

    @classmethod
    def from_context(cls) -> RequestContext:
        envelope = cls.from_envelope(
            _read_header(REQUEST_CONTEXT_ENVELOPE_HEADER),
            _read_header(REQUEST_CONTEXT_ENVELOPE_SIG_HEADER),
            os.environ.get("INTERNAL_API_TOKEN"),
        )
        if envelope is not None:
            return envelope

        scope_entries = _as_scope_entries(_read_json_header(COLLECTION_SCOPE_HEADER))
        return cls(
            organization_id=_normalize_raw_id(_read_header(ORGANIZATION_ID_HEADER)),
            user_id=_normalize_raw_id(_read_header(USER_ID_HEADER)),
            project_id=_normalize_raw_id(_read_header(PROJECT_ID_HEADER)),
            collection_scope=_scope_names(scope_entries),
            collection_scope_entries=scope_entries,
            project_context=normalize_project_context(_read_encoded_header(PROJECT_CONTEXT_HEADER)),
            project_memory=normalize_project_context(
                _read_encoded_header(PROJECT_MEMORY_HEADER), max_chars=MEMORY_HEADER_MAX_CHARS
            ),
            org_instructions=normalize_org_instructions(_read_encoded_header(ORG_INSTRUCTIONS_HEADER)),
            model_overrides=_as_str_dict(_read_json_header(MODEL_OVERRIDES_HEADER)),
            budget=_as_dict(_read_json_header(BUDGET_HEADER)),
            disabled_sources=_as_str_list(_read_json_header(DISABLED_SOURCES_HEADER)),
            memory_reflection_enabled=_read_memory_reflection_flag(),
        )

    @classmethod
    def from_envelope(
        cls,
        header_value: str | None,
        sig: str | None,
        secret: str | None,
    ) -> RequestContext | None:
        if not header_value:
            return None

        try:
            raw_json = _base64url_decode_text(header_value)
        except Exception:
            logger.warning("Failed to base64url-decode X-Grid-Request-Context envelope", exc_info=True)
            return None

        if secret:
            expected = hmac.new(secret.encode("utf-8"), raw_json.encode("utf-8"), hashlib.sha256).hexdigest()
            if not sig or not hmac.compare_digest(expected, sig):
                logger.warning(
                    "X-Grid-Request-Context envelope signature missing or invalid; "
                    "treating the envelope as absent (possible tamper)"
                )
                return None

        try:
            payload = json.loads(raw_json)
        except Exception:
            logger.warning("Failed to JSON-parse X-Grid-Request-Context envelope", exc_info=True)
            return None
        if not isinstance(payload, dict):
            logger.warning("X-Grid-Request-Context envelope JSON is not an object; ignoring")
            return None

        scope_entries = _as_scope_entries(payload.get("collectionScope"))
        return cls(
            organization_id=_normalize_raw_id(payload.get("organizationId")),
            user_id=_normalize_raw_id(payload.get("userId")),
            project_id=_normalize_raw_id(payload.get("projectId")),
            collection_scope=_scope_names(scope_entries),
            collection_scope_entries=scope_entries,
            project_context=normalize_project_context(payload.get("projectContext"), max_chars=4000),
            project_memory=normalize_project_context(payload.get("projectMemory"), max_chars=MEMORY_HEADER_MAX_CHARS),
            org_instructions=normalize_org_instructions(payload.get("orgInstructions")),
            model_overrides=_as_str_dict(payload.get("modelOverrides")),
            budget=_as_dict(payload.get("budget")),
            disabled_sources=_as_str_list(payload.get("disabledSources")),
            memory_reflection_enabled=bool(payload.get("memoryReflectionEnabled", False)),
            federal_state=_normalize_federal_state(payload.get("federalState", payload.get("bundesland"))),
            conversation_id=_normalize_raw_id(payload.get("conversationId")),
            issued_at=_as_epoch_millis(payload.get("issuedAt")),
            envelope_header=header_value,
            envelope_signature=sig,
            context_transport="bff" if payload.get("contextTransport") == "bff" else None,
            requester=_as_requester(payload.get("requester")),
        )

    @classmethod
    def from_headers(cls, headers: dict[str, str], *, secret: str | None = None) -> RequestContext:
        lower = {k.lower(): v for k, v in headers.items()}

        def raw(name: str) -> str | None:
            return lower.get(name)

        envelope = cls.from_envelope(
            raw(REQUEST_CONTEXT_ENVELOPE_HEADER),
            raw(REQUEST_CONTEXT_ENVELOPE_SIG_HEADER),
            secret,
        )
        if envelope is not None:
            return envelope

        def json_field(name: str) -> Any | None:
            value = raw(name)
            if not value:
                return None
            try:
                return json.loads(_base64url_decode_text(value))
            except Exception:
                return None

        def text_field(name: str, max_chars: int) -> str | None:
            value = raw(name)
            if not value:
                return None
            return normalize_project_context(_base64url_decode_text(value), max_chars=max_chars)

        scope_entries = _as_scope_entries(json_field(COLLECTION_SCOPE_HEADER))
        return cls(
            organization_id=_normalize_raw_id(raw(ORGANIZATION_ID_HEADER)),
            user_id=_normalize_raw_id(raw(USER_ID_HEADER)),
            project_id=_normalize_raw_id(raw(PROJECT_ID_HEADER)),
            collection_scope=_scope_names(scope_entries),
            collection_scope_entries=scope_entries,
            project_context=text_field(PROJECT_CONTEXT_HEADER, 4000),
            project_memory=text_field(PROJECT_MEMORY_HEADER, 2000),
            org_instructions=normalize_org_instructions(
                _base64url_decode_text(raw(ORG_INSTRUCTIONS_HEADER) or "") or None
            ),
            model_overrides=_as_str_dict(json_field(MODEL_OVERRIDES_HEADER)),
            budget=_as_dict(json_field(BUDGET_HEADER)),
            disabled_sources=_as_str_list(json_field(DISABLED_SOURCES_HEADER)),
            memory_reflection_enabled=(raw(MEMORY_REFLECTION_FEATURE_HEADER) or "").strip().lower() == "true",
        )


def get_profile_context_from_context() -> str | None:
    return RequestContext.from_context().project_context


def get_memory_digest_from_context() -> str | None:
    return RequestContext.from_context().project_memory


def compose_project_context(context: str | None, memory: str | None) -> str | None:
    if context and memory:
        return f"{context}\n\n{memory}"
    return context or memory


def get_project_context_from_context() -> str | None:
    ctx = RequestContext.from_context()
    return compose_project_context(ctx.project_context, ctx.project_memory)


def get_org_instructions_from_context() -> str | None:
    return RequestContext.from_context().org_instructions


def get_project_id_from_context() -> str | None:
    return RequestContext.from_context().project_id


def get_organization_id_from_context() -> str | None:
    return RequestContext.from_context().organization_id


def get_memory_reflection_enabled_from_context() -> bool:
    return RequestContext.from_context().memory_reflection_enabled


def get_user_message_id_from_context() -> str | None:
    try:
        from nat.plugin_api import Context

        ctx = Context.get()
        if ctx is None:
            return None
        user_message_id = getattr(ctx, "user_message_id", None)
        if not user_message_id or str(user_message_id) == "default_id":
            return None
        return str(user_message_id)
    except Exception:
        logger.debug("Failed to read user message id from NAT context", exc_info=True)
        return None


def get_signed_request_context() -> RequestContext | None:
    return RequestContext.from_envelope(
        _read_header(REQUEST_CONTEXT_ENVELOPE_HEADER),
        _read_header(REQUEST_CONTEXT_ENVELOPE_SIG_HEADER),
        os.environ.get("INTERNAL_API_TOKEN"),
    )


def get_request_envelope_from_context() -> tuple[str | None, str | None]:
    ctx = RequestContext.from_context()
    return ctx.envelope_header, ctx.envelope_signature


def get_conversation_id_from_context() -> str | None:
    try:
        from nat.plugin_api import Context

        ctx = Context.get()
        if ctx is None:
            return None
        conversation_id = getattr(ctx, "conversation_id", None)
        return str(conversation_id) if conversation_id else None
    except Exception:
        logger.debug("Failed to read conversation id from NAT context", exc_info=True)
        return None
