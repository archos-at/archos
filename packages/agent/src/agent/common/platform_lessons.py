import hashlib
import logging
import os
import re
import threading
import time
from dataclasses import dataclass
from typing import Literal

logger = logging.getLogger(__name__)

_POSITIVE_TTL_SECONDS = 60.0
_NEGATIVE_TTL_SECONDS = 30.0
_REQUEST_TIMEOUT_SECONDS = 3.0

_MAX_DIGEST_CHARS = 2400

_EXPECTED_HEADER = "PLATFORM_LESSONS"

_LESSON_ID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
_MAX_LESSON_IDS = 20

LessonsArm = Literal["treated", "holdout", "off"]


@dataclass(frozen=True)
class LessonsResolution:
    digest: str | None
    arm: LessonsArm
    lesson_ids: tuple[str, ...] = ()


class _CacheEntry:
    __slots__ = ("digest", "expires_at", "lesson_ids")

    def __init__(self, digest: str | None, ttl: float, lesson_ids: tuple[str, ...] = ()) -> None:
        self.digest = digest
        self.lesson_ids = lesson_ids
        self.expires_at = time.monotonic() + ttl


_cache: _CacheEntry | None = None
_cache_lock = threading.Lock()


def reset_platform_lessons_cache() -> None:
    global _cache
    with _cache_lock:
        _cache = None


def sanitize_lessons_digest(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    digest = value.strip()
    if not digest or not digest.startswith(_EXPECTED_HEADER):
        return None
    if len(digest) > _MAX_DIGEST_CHARS:
        digest = digest[:_MAX_DIGEST_CHARS]
    return digest


def sanitize_lesson_ids(value: object) -> tuple[str, ...]:
    if not isinstance(value, list):
        return ()
    ids: list[str] = []
    for item in value:
        if not isinstance(item, str):
            continue
        candidate = item.strip().lower()
        if _LESSON_ID.fullmatch(candidate) and candidate not in ids:
            ids.append(candidate)
        if len(ids) >= _MAX_LESSON_IDS:
            break
    return tuple(ids)


def _fetch_digest() -> tuple[str | None, tuple[str, ...]]:
    token = os.environ.get("INTERNAL_API_TOKEN")
    if not token:
        return None, ()

    import httpx

    base_url = (os.environ.get("FRONTEND_INTERNAL_URL") or "http://frontend:3000").rstrip("/")
    response = httpx.get(
        f"{base_url}/api/internal/platform-lessons/digest",
        headers={"x-internal-token": token},
        timeout=_REQUEST_TIMEOUT_SECONDS,
    )
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, dict):
        return None, ()
    digest = sanitize_lessons_digest(payload.get("digest"))
    return digest, sanitize_lesson_ids(payload.get("lessonIds")) if digest else ()


def is_in_holdout_slice(conversation_id: str, holdout_pct: int) -> bool:
    if holdout_pct <= 0 or not conversation_id:
        return False
    if holdout_pct >= 100:
        return True
    digest = hashlib.sha256(conversation_id.encode("utf-8")).digest()
    return int.from_bytes(digest[:4], "big") % 100 < holdout_pct


def _holdout_arm(conversation_id: str | None) -> LessonsArm:
    if not conversation_id:
        return "off"
    try:
        from agent.common.retrieval_settings import get_retrieval_setting

        holdout_pct = get_retrieval_setting("lessons.holdout_pct", 0)
        if holdout_pct <= 0:
            return "off"
        return "holdout" if is_in_holdout_slice(conversation_id, holdout_pct) else "treated"
    except Exception:  # noqa: BLE001 - fail open: measurement never blocks answering
        logger.debug("Holdout resolution failed; treating this turn as treated", exc_info=True)
        return "off"


def resolve_platform_lessons(conversation_id: str | None = None) -> LessonsResolution:
    arm = _holdout_arm(conversation_id)
    if arm == "holdout":
        return LessonsResolution(digest=None, arm=arm)
    global _cache
    now = time.monotonic()
    with _cache_lock:
        if _cache is not None and _cache.expires_at > now:
            return LessonsResolution(digest=_cache.digest, arm=arm, lesson_ids=_cache.lesson_ids)

    try:
        digest, lesson_ids = _fetch_digest()
        ttl = _POSITIVE_TTL_SECONDS if digest else _NEGATIVE_TTL_SECONDS
    except Exception as exc:  # noqa: BLE001 - fail open by design
        logger.warning("Platform-lessons resolution failed: %s", type(exc).__name__)
        digest, lesson_ids, ttl = None, (), _NEGATIVE_TTL_SECONDS

    with _cache_lock:
        _cache = _CacheEntry(digest, ttl, lesson_ids)
    return LessonsResolution(digest=digest, arm=arm, lesson_ids=lesson_ids)


def get_platform_lessons_digest(conversation_id: str | None = None) -> str | None:
    return resolve_platform_lessons(conversation_id).digest


_LESSONS_BLOCK_HEADER = (
    "### PLATFORM_LESSONS — process cautions from reported failures. Meta-level only.\n"
    "A `PLATFORM_LESSONS v1` block follows. Each line is a caution distilled from answers users "
    "reported as bad — anonymized, deduplicated, tagged `[category | Nx]` (N = how often reported).\n"
    "\n"
    "These are **meta-level process cautions, not knowledge, and most turns they simply do not "
    "apply**. A lesson may adjust HOW you work — what to double-check, when to retrieve deeper, "
    "when to ask — and never WHAT is true. They carry zero factual authority: never cite one, "
    "never treat one as evidence about any norm, document or project, and never let one override "
    "retrieval, uploaded documents, the project profile or the current conversation — every one of "
    "those outranks every lesson. Do not mention lessons in answers or go looking for ways to apply "
    "them; act on one only when its failure pattern exactly matches the turn in front of you, and "
    "otherwise ignore this block entirely.\n"
)


def render_lessons_block(digest: str | None) -> str | None:
    if not digest or not digest.strip():
        return None
    return f"{_LESSONS_BLOCK_HEADER}\n{digest.strip()}\n"
