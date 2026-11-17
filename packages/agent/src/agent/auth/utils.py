import base64
import json
import logging
import threading
from collections.abc import Callable

from pydantic import BaseModel

logger = logging.getLogger(__name__)

_token_fetchers: list[tuple[int, Callable[[], str | None]]] = []
_fetcher_lock = threading.Lock()


def register_token_fetcher(fetcher: Callable[[], str | None], priority: int = 0) -> None:
    with _fetcher_lock:
        if any(f is fetcher for _, f in _token_fetchers):
            logger.debug("Token fetcher already registered, skipping duplicate")
            return
        _token_fetchers.append((priority, fetcher))
        _token_fetchers.sort(key=lambda x: x[0], reverse=True)
    logger.debug("Registered token fetcher (priority=%d), total fetchers: %d", priority, len(_token_fetchers))


def unregister_token_fetcher(fetcher: Callable[[], str | None]) -> None:
    with _fetcher_lock:
        before = len(_token_fetchers)
        _token_fetchers[:] = [(p, f) for p, f in _token_fetchers if f is not fetcher]
        removed = before - len(_token_fetchers)
    if removed:
        logger.debug("Unregistered token fetcher, total fetchers: %d", len(_token_fetchers))


def clear_token_fetchers() -> None:
    with _fetcher_lock:
        _token_fetchers.clear()


class UserInfo(BaseModel):
    email: str | None = None
    name: str | None = None


class Principal(BaseModel):
    type: str
    sub: str
    email: str | None = None
    name: str | None = None
    organization_name: str | None = None


def decode_unverified_jwt_payload(token: str) -> dict:
    try:
        parts = token.split(".")
        if len(parts) != 3:
            raise ValueError("Invalid JWT token format")

        payload = parts[1]
        padding = len(payload) % 4
        if padding:
            payload += "=" * (4 - padding)

        decoded_bytes = base64.urlsafe_b64decode(payload)
        return json.loads(decoded_bytes)
    except Exception as e:
        logger.error("Failed to decode JWT token: %s", e)
        return {}


def get_user_info_from_unverified_token(id_token: str) -> UserInfo:
    payload = decode_unverified_jwt_payload(id_token)

    email = payload.get("email")
    name = (
        payload.get("name") or payload.get("given_name") or payload.get("preferred_username") or payload.get("nickname")
    )

    return UserInfo(email=email, name=name)


def decode_jwt_payload(token: str) -> dict:
    logger.warning("decode_jwt_payload() is deprecated; use decode_unverified_jwt_payload()")
    return decode_unverified_jwt_payload(token)


def get_user_info_from_token(id_token: str) -> UserInfo:
    logger.warning("get_user_info_from_token() is deprecated; use get_user_info_from_unverified_token()")
    return get_user_info_from_unverified_token(id_token)


def get_auth_token() -> str | None:
    for _priority, fetcher in list(_token_fetchers):
        try:
            token = fetcher()
            if token:
                logger.debug("Token provided by registered fetcher")
                return token
        except Exception as e:
            logger.debug("Registered token fetcher failed: %s", e)

    try:
        from nat.plugin_api import Context

        context_metadata = Context.get().metadata

        if context_metadata and context_metadata.cookies:
            id_token = context_metadata.cookies.get("idToken")
            if id_token:
                logger.debug("Using token from Context cookies")
                return id_token.strip()

        if context_metadata and context_metadata.headers:
            auth_header = context_metadata.headers.get("authorization", "")
            if auth_header.startswith("Bearer eyJ"):
                logger.debug("Using token from Authorization header")
                return auth_header[7:].strip()
    except Exception as e:
        logger.debug("Failed to retrieve token from Context: %s", e)

    return None


def get_current_principal() -> Principal | None:
    from .request_identity import get_current_user

    try:
        current_user = get_current_user()
    except Exception as e:
        logger.debug("Failed to read current user from middleware context: %s", e)
        return None

    if not isinstance(current_user, dict):
        logger.debug("Ignoring non-dict current user context")
        return None

    principal_type = current_user.get("type")
    sub = current_user.get("sub")
    if not principal_type or not sub:
        return None

    return Principal(
        type=str(principal_type),
        sub=str(sub),
        email=current_user.get("email"),
        name=current_user.get("name"),
        organization_name=current_user.get("organization_name"),
    )


def get_verified_current_user() -> Principal | None:
    return get_current_principal()


def get_current_user_info() -> UserInfo | None:
    principal = get_current_principal()
    if principal is None:
        return None
    return UserInfo(email=principal.email, name=principal.name)
