import hmac
import logging
import os
from hashlib import sha256
from importlib import import_module
from typing import Any

from starlette.types import Scope

from agent_host.legacy_headers import legacy_header

logger = logging.getLogger(__name__)

TRACE_USER_IDENTITY_MODES = frozenset({"none", "id", "full"})
TRACE_CLIENT_ID_MODES = frozenset({"none", "ip"})
TRACE_ACCESS_CHANNELS = frozenset(
    {
        "ui",
        "api",
        "headless",
        "anonymous",
        "internal",
        "unknown",
    }
)


def _load_trace_user_identity_mode() -> str:
    raw = os.getenv("TRACE_USER_IDENTITY_MODE", "none").strip().lower()
    aliases = {
        "0": "none",
        "false": "none",
        "off": "none",
        "1": "id",
        "true": "id",
        "on": "id",
        "basic": "id",
    }
    mode = aliases.get(raw, raw)
    if mode not in TRACE_USER_IDENTITY_MODES:
        logger.warning(
            "Invalid TRACE_USER_IDENTITY_MODE=%r; expected one of %s. Falling back to 'none'.",
            raw,
            sorted(TRACE_USER_IDENTITY_MODES),
        )
        return "none"
    return mode


def _load_trace_user_identity_secret() -> str | None:
    secret = os.getenv("TRACE_USER_IDENTITY_HMAC_SECRET", "").strip()
    return secret or None


def _load_trace_client_id_mode() -> str:
    raw = os.getenv("TRACE_CLIENT_ID_MODE", "none").strip().lower()
    aliases = {
        "0": "none",
        "false": "none",
        "off": "none",
        "1": "ip",
        "true": "ip",
        "on": "ip",
    }
    mode = aliases.get(raw, raw)
    if mode not in TRACE_CLIENT_ID_MODES:
        logger.warning(
            "Invalid TRACE_CLIENT_ID_MODE=%r; expected one of %s. Falling back to 'none'.",
            raw,
            sorted(TRACE_CLIENT_ID_MODES),
        )
        return "none"
    return mode


def _load_trace_client_id_secret() -> str | None:
    secret = os.getenv("TRACE_CLIENT_ID_HMAC_SECRET", "").strip()
    if secret:
        return secret
    return _load_trace_user_identity_secret()


def _load_trace_client_ip_headers() -> list[str]:
    raw = os.getenv("TRACE_CLIENT_IP_HEADERS", "x-real-ip,x-forwarded-for")
    return [header.strip().lower() for header in raw.split(",") if header.strip()]


HEADERS = {
    "mode": ("x-chat-mode", legacy_header("x-chat-mode")),
    "access-channel": ("x-access-channel", "x-aiq-access-channel"),
}

TRACE_TAG_KEYS = frozenset(
    {
        "user.id",
        "user.email",
        "user.name",
        "auth.type",
        "auth.transport",
        "auth.verified",
        "caller.type",
        "access.channel",
        "client.id",
    }
)
TRACE_TAG_PREFIX = "app."
LEGACY_TRACE_TAG_PREFIX = "aiq."


def _header(headers: dict[bytes, bytes], meaning: str) -> str | None:
    name, legacy = HEADERS[meaning]
    return _extract_header_text(headers, name) or _extract_header_text(headers, legacy)


def is_headless_request(headers: dict[bytes, bytes]) -> bool:
    return (_header(headers, "mode") or "").lower() == "headless"


def _build_pseudonymous_trace_user_id(principal_type: str, principal_sub: str, secret: str | None) -> str | None:
    if not secret:
        return None

    payload = f"{principal_type}:{principal_sub}".encode()
    return hmac.new(secret.encode(), payload, sha256).hexdigest()


def _build_pseudonymous_trace_client_id(client_value: str, secret: str | None) -> str | None:
    if not secret or not client_value:
        return None

    return hmac.new(secret.encode(), f"client:{client_value}".encode(), sha256).hexdigest()


def _extract_auth_transport(headers: dict[bytes, bytes]) -> str:
    auth = headers.get(b"authorization", b"").decode()
    if auth.startswith("Bearer "):
        return "bearer"

    cookie = headers.get(b"cookie", b"").decode()
    for part in cookie.split(";"):
        if part.strip().startswith("idToken="):
            return "cookie"
    return "none"


def _extract_header_text(headers: dict[bytes, bytes], name: str) -> str | None:
    value = headers.get(name.encode())
    if not value:
        return None
    decoded = value.decode().strip()
    return decoded or None


def _extract_client_ip(headers: dict[bytes, bytes], scope: Scope, header_names: list[str]) -> str | None:
    for header_name in header_names:
        value = _extract_header_text(headers, header_name)
        if not value:
            continue
        candidate = value.split(",")[0].strip() if header_name == "x-forwarded-for" else value
        if candidate:
            return candidate

    client = scope.get("client")
    if isinstance(client, (list, tuple)) and client:
        host = client[0]
        if isinstance(host, str) and host.strip():
            return host.strip()
    return None


def _extract_explicit_access_channel(headers: dict[bytes, bytes], *, allow_override: bool) -> str | None:
    if not allow_override:
        return None

    value = _header(headers, "access-channel")
    if not value:
        return None
    channel = value.lower()
    if channel in TRACE_ACCESS_CHANNELS:
        return channel
    logger.warning("Ignoring unsupported X-Access-Channel=%r", value)
    return None


def _infer_access_channel(
    headers: dict[bytes, bytes],
    user: dict[str, Any],
    auth_transport: str,
    *,
    allow_explicit_override: bool,
) -> str:
    if explicit := _extract_explicit_access_channel(headers, allow_override=allow_explicit_override):
        return explicit

    caller_type = str(user.get("type") or "")
    headless = is_headless_request(headers)
    if auth_transport == "cookie":
        return "ui"
    if headless and auth_transport == "bearer":
        return "headless"
    if caller_type == "anonymous":
        return "anonymous"
    if caller_type == "internal":
        return "internal"
    if auth_transport == "bearer":
        return "api"
    return "unknown"


def _is_verified_trace_user(user: dict[str, Any]) -> bool:
    principal_sub = user.get("sub")
    principal_type = str(user.get("type") or "")
    return bool(principal_sub and principal_type not in {"anonymous", "internal", "unverified_jwt"})


def _build_trace_user_tags(user: dict[str, Any], mode: str, secret: str | None) -> dict[str, str]:
    if mode == "none" or not _is_verified_trace_user(user):
        return {}

    principal_sub = user.get("sub")
    principal_type = user.get("type")
    if not principal_sub or not principal_type:
        return {}

    pseudonymous_id = _build_pseudonymous_trace_user_id(str(principal_type), str(principal_sub), secret)
    if pseudonymous_id is None:
        logger.warning(
            "TRACE_USER_IDENTITY_MODE=%s but TRACE_USER_IDENTITY_HMAC_SECRET is not set; "
            "skipping user identity trace tags.",
            mode,
        )
        return {}

    tags = {
        "enduser.id": pseudonymous_id,
        "user.id": pseudonymous_id,
        "auth.type": str(principal_type),
    }
    if mode == "full":
        if email := user.get("email"):
            tags["user.email"] = str(email)
        if name := user.get("name"):
            tags["user.name"] = str(name)
    return tags


def _build_common_trace_tags(
    headers: dict[bytes, bytes],
    scope: Scope,
    user: dict[str, Any],
    *,
    trust_access_channel_override: bool,
    client_id_mode: str,
    client_id_secret: str | None,
    client_ip_headers: list[str],
) -> dict[str, str]:
    auth_transport = _extract_auth_transport(headers)
    tags = {
        "caller.type": str(user.get("type") or "unknown"),
        "auth.transport": auth_transport,
        "auth.verified": "true" if _is_verified_trace_user(user) else "false",
        "access.channel": _infer_access_channel(
            headers,
            user,
            auth_transport,
            allow_explicit_override=trust_access_channel_override,
        ),
    }

    if client_id_mode == "ip":
        client_ip = _extract_client_ip(headers, scope, client_ip_headers)
        client_id = _build_pseudonymous_trace_client_id(client_ip or "", client_id_secret)
        if client_id:
            tags["client.id"] = client_id

    return tags


def _tag_current_ddtrace_span(tags: dict[str, str]) -> None:
    if not tags:
        return

    try:
        tracer = import_module("ddtrace").tracer
        span = tracer.current_span()
    except Exception:
        return

    if span is None:
        return

    for key, value in tags.items():
        try:
            span.set_tag(key, value)
        except Exception:
            logger.debug("Failed to set Datadog span tag %s", key, exc_info=True)


def _tag_current_otel_span(tags: dict[str, str]) -> None:
    if not tags:
        return

    try:
        span = import_module("opentelemetry.trace").get_current_span()
    except Exception:
        return

    for key, value in tags.items():
        try:
            span.set_attribute(key, value)
        except Exception:
            logger.debug("Failed to set OpenTelemetry span attribute %s", key, exc_info=True)


def build_request_trace_tags(
    headers: dict[bytes, bytes],
    scope: Scope,
    user: dict[str, Any],
    *,
    trust_access_channel_override: bool,
    user_identity_mode: str,
    user_identity_secret: str | None,
    client_id_mode: str,
    client_id_secret: str | None,
    client_ip_headers: list[str],
) -> dict[str, str]:
    tags = _build_common_trace_tags(
        headers,
        scope,
        user,
        trust_access_channel_override=trust_access_channel_override,
        client_id_mode=client_id_mode,
        client_id_secret=client_id_secret,
        client_ip_headers=client_ip_headers,
    )
    tags.update(_build_trace_user_tags(user, user_identity_mode, user_identity_secret))
    namespaced = {}
    for key, value in tags.items():
        prefixes = (TRACE_TAG_PREFIX, LEGACY_TRACE_TAG_PREFIX) if key in TRACE_TAG_KEYS else ("",)
        namespaced.update({prefix + key: value for prefix in prefixes})
    return namespaced


def attach_request_to_active_trace(
    headers: dict[bytes, bytes],
    scope: Scope,
    user: dict[str, Any],
    *,
    trust_access_channel_override: bool,
    user_identity_mode: str,
    user_identity_secret: str | None,
    client_id_mode: str,
    client_id_secret: str | None,
    client_ip_headers: list[str],
) -> dict[str, str]:
    tags = build_request_trace_tags(
        headers,
        scope,
        user,
        trust_access_channel_override=trust_access_channel_override,
        user_identity_mode=user_identity_mode,
        user_identity_secret=user_identity_secret,
        client_id_mode=client_id_mode,
        client_id_secret=client_id_secret,
        client_ip_headers=client_ip_headers,
    )

    _tag_current_ddtrace_span(tags)
    _tag_current_otel_span(tags)
    return tags
