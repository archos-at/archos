from __future__ import annotations

import asyncio
import base64
import logging
import os
import unicodedata
from dataclasses import dataclass
from dataclasses import field
from datetime import UTC
from datetime import datetime

from deepagents.backends.protocol import EditResult
from deepagents.backends.protocol import WriteResult
from deepagents.backends.store import StoreBackend
from langgraph.store.base import BaseStore
from langgraph.store.base import Item

from agent.common import is_postgres_dsn

from .cards import emit_draft_card
from .draft_values import BASE64
from .draft_values import DERIVED_FROM_KEY
from .draft_values import PREVIOUS_CONTENT_KEY
from .draft_values import PREVIOUS_ENCODING_KEY
from .draft_values import PREVIOUS_KEYS
from .draft_values import PREVIOUS_VERSION_KEY
from .draft_values import derived_from_value
from .draft_values import draft_bytes
from .draft_values import history_of
from .draft_values import previous_bytes
from .draft_values import previous_size
from .draft_values import stored_bytes
from .draft_values import stored_size

logger = logging.getLogger(__name__)

DRAFT_ROOT = "/drafts/"

LEGACY_DRAFT_ROOT = "/entwuerfe/"

MAX_DRAFT_BYTES = 256 * 1024

MAX_RUN_FILE_BYTES = 25 * 1024 * 1024


VERSION_KEY = "grid_draft_version"

FILED_DOCUMENT_KEY = "grid_filed_document_id"
FILED_VERSION_KEY = "grid_filed_version_id"
FILED_HASH_KEY = "grid_filed_content_hash"
FILED_STATE_KEY = "grid_filed_state"

FILING_KEYS = (FILED_DOCUMENT_KEY, FILED_VERSION_KEY, FILED_HASH_KEY, FILED_STATE_KEY)

FILED_AT_DRAFT_VERSION_KEY = "grid_filed_at_draft_version"

MADE_BY_KEY = "made_by"

MADE_BY_RUN = "execute"

_DRAFT_ROOT_BARE = DRAFT_ROOT.rstrip("/")

_PAGE_SIZE = 100

_DSN_ENV = "CHECKPOINT_DB"

_stores: dict[str, BaseStore] = {}
_store_lock = asyncio.Lock()


def draft_namespace(conversation_id: str) -> tuple[str, str, str]:
    return ("conversation", conversation_id, "drafts")


def modernize_draft_path(path: str) -> str:
    candidate = path.strip()
    legacy_bare = LEGACY_DRAFT_ROOT.rstrip("/")
    if candidate == legacy_bare or candidate.startswith(LEGACY_DRAFT_ROOT):
        return DRAFT_ROOT.rstrip("/") + candidate[len(legacy_bare) :]
    if candidate == legacy_bare.lstrip("/") or candidate.startswith(LEGACY_DRAFT_ROOT.lstrip("/")):
        return DRAFT_ROOT.rstrip("/") + "/" + candidate[len(legacy_bare) :].lstrip("/")
    return path


def normalize_draft_text(text: str) -> str:
    if not text:
        return text
    return unicodedata.normalize("NFC", text)


@dataclass(frozen=True)
class DraftUsage:
    total_bytes: int
    content: str | None
    version: int
    filing: dict[str, str] = field(default_factory=dict)
    filed_at_version: int = 0
    encoding: str = "utf-8"
    file_bytes: int = 0
    made_by: str = ""
    previous_version: int = 0
    derived_from: dict[str, str] = field(default_factory=dict)

    @property
    def is_binary(self) -> bool:
        return self.encoding == BASE64

    @property
    def filed_unchanged(self) -> bool:
        return bool(self.filing.get(FILED_DOCUMENT_KEY)) and 0 < self.filed_at_version == self.version


def filing_from_value(value: dict) -> dict[str, str]:
    return {key: value[key] for key in FILING_KEYS if isinstance(value.get(key), str) and value[key]}


def filing_record(body: dict) -> dict[str, str]:
    version = body.get("version")
    version = version if isinstance(version, dict) else {}
    return {
        FILED_DOCUMENT_KEY: str(body.get("documentId") or version.get("documentId") or ""),
        FILED_VERSION_KEY: str(body.get("versionId") or version.get("id") or ""),
        FILED_HASH_KEY: str(body.get("contentHash") or version.get("contentHash") or ""),
        FILED_STATE_KEY: str(body.get("state") or version.get("state") or ""),
    }


def usage_from_items(items: list[Item], file_path: str) -> DraftUsage:
    total = 0
    file_bytes = 0
    content: str | None = None
    version = 0
    encoding = "utf-8"
    filing: dict[str, str] = {}
    filed_at_version = 0
    made_by = ""
    previous_version = 0
    derived_from: dict[str, str] = {}
    for item in items:
        raw = item.value.get("content")
        text = "\n".join(raw) if isinstance(raw, list) else str(raw or "")
        size = stored_size(item.value)
        file_bytes += size + previous_size(item.value)
        if item.value.get("encoding") != BASE64 and item.value.get(MADE_BY_KEY) != MADE_BY_RUN:
            total += size
        if str(item.key) == file_path:
            content = text
            encoding = str(item.value.get("encoding") or "utf-8")
            version = int(item.value.get(VERSION_KEY) or 0)
            filing = filing_from_value(item.value)
            filed_at_version = int(item.value.get(FILED_AT_DRAFT_VERSION_KEY) or 0)
            made_by = str(item.value.get(MADE_BY_KEY) or "")
            previous_version = int(item.value.get(PREVIOUS_VERSION_KEY) or 0)
            derived_from = derived_from_value(item.value)
    return DraftUsage(
        total_bytes=total,
        content=content,
        version=version,
        filing=filing,
        filed_at_version=filed_at_version,
        encoding=encoding,
        file_bytes=file_bytes,
        made_by=made_by,
        previous_version=previous_version,
        derived_from=derived_from,
    )


RUN_TEXT_SUFFIXES = (".md", ".txt", ".csv", ".json", ".svg", ".html", ".xml", ".js", ".mjs", ".ts")

MAX_RUN_TEXT_BYTES = 64 * 1024


def run_file_value(file_path: str, data: bytes) -> dict:
    if file_path.lower().endswith(RUN_TEXT_SUFFIXES) and len(data) <= MAX_RUN_TEXT_BYTES:
        try:
            return {"content": normalize_draft_text(data.decode("utf-8")), "encoding": "utf-8"}
        except UnicodeDecodeError:
            pass
    return {"content": base64.b64encode(data).decode("ascii"), "encoding": BASE64}


def path_refusal(file_path: str) -> str | None:
    normalized = file_path.rstrip("/") or "/"
    if ".." not in file_path and (normalized == _DRAFT_ROOT_BARE or normalized.startswith(f"{_DRAFT_ROOT_BARE}/")):
        return None
    return (
        f"Cannot write to {file_path} because this conversation's working directory only holds "
        f"files under {DRAFT_ROOT}. List `{DRAFT_ROOT}` with `ls`, then read the draft with "
        f"`read_file` on its `{DRAFT_ROOT}<name>.md` path."
    )


def _root_write_refusal(file_path: str) -> str | None:
    if (file_path.rstrip("/") or "/") != _DRAFT_ROOT_BARE:
        return None
    return (
        f"Cannot write to {file_path} because it is this conversation's working directory, "
        f"not a file. Write to {DRAFT_ROOT}<name>.md instead."
    )


def ceiling_refusal(projected_bytes: int, file_path: str) -> str | None:
    if projected_bytes <= MAX_DRAFT_BYTES:
        return None
    return (
        f"Cannot write to {file_path} because this conversation's working directory would exceed its "
        f"limit of {MAX_DRAFT_BYTES // 1024} KB ({projected_bytes // 1024} KB after this change). "
        "Shorten the document, or edit the existing file instead of writing another copy."
    )


def _overwrite_refusal(usage: DraftUsage, file_path: str) -> str | None:
    if usage.content is None:
        return None
    return (
        f"Cannot write to {file_path} because it already exists. "
        "Read it and revise it with `edit_file`, or write to a new path."
    )


def write_refusal(usage: DraftUsage, file_path: str, content: str) -> str | None:
    refusal = path_refusal(file_path)
    if refusal is not None:
        return refusal
    refusal = _root_write_refusal(file_path)
    if refusal is not None:
        return refusal
    refusal = _overwrite_refusal(usage, file_path)
    if refusal is not None:
        return refusal
    projected = usage.total_bytes - draft_bytes(usage.content or "") + draft_bytes(content)
    return ceiling_refusal(projected, file_path)


def edit_refusal(
    usage: DraftUsage, file_path: str, old_string: str, new_string: str, *, replace_all: bool
) -> str | None:
    refusal = path_refusal(file_path)
    if refusal is not None:
        return refusal
    refusal = _root_write_refusal(file_path)
    if refusal is not None:
        return refusal
    if usage.content is None:
        return None
    if usage.is_binary:
        return (
            f"Cannot edit {file_path} because it is a binary file a script wrote. "
            "Change it by running a script with `execute` that reads it and writes it again."
        )
    occurrences = usage.content.count(old_string) if replace_all else 1
    growth = occurrences * (draft_bytes(new_string) - draft_bytes(old_string))
    return ceiling_refusal(usage.total_bytes + growth, file_path)


class DraftBackend(StoreBackend):
    def __init__(self, *, store: BaseStore, conversation_id: str) -> None:
        super().__init__(store=store, namespace=lambda _runtime: draft_namespace(conversation_id))
        self.conversation_id = conversation_id

    def _usage(self, file_path: str) -> DraftUsage:
        store = self._get_store()
        namespace = self._get_namespace()
        items = self._search_store_paginated(store, namespace, page_size=_PAGE_SIZE)
        return usage_from_items(items, file_path)

    async def ausage(self, file_path: str) -> DraftUsage:
        store = self._get_store()
        namespace = self._get_namespace()
        items: list[Item] = []
        offset = 0
        while True:
            page = await store.asearch(namespace, limit=_PAGE_SIZE, offset=offset)
            items.extend(page)
            if len(page) < _PAGE_SIZE:
                break
            offset += _PAGE_SIZE
        return usage_from_items(items, file_path)

    def _record(self, file_path: str, version: int, filing: dict[str, str]) -> None:
        store = self._get_store()
        namespace = self._get_namespace()
        item = store.get(namespace, file_path)
        if item is None:
            return
        value = {**item.value, VERSION_KEY: version, **filing}
        store.put(namespace, file_path, value)
        emit_draft_card(
            path=file_path,
            content=str(value.get("content") or ""),
            version=version,
            filing=filing,
            filed_at_version=int(value.get(FILED_AT_DRAFT_VERSION_KEY) or 0),
        )

    async def _arecord(self, file_path: str, version: int, filing: dict[str, str]) -> None:
        store = self._get_store()
        namespace = self._get_namespace()
        item = await store.aget(namespace, file_path)
        if item is None:
            return
        value = {**item.value, VERSION_KEY: version, **filing}
        await store.aput(namespace, file_path, value)
        emit_draft_card(
            path=file_path,
            content=str(value.get("content") or ""),
            version=version,
            filing=filing,
            filed_at_version=int(value.get(FILED_AT_DRAFT_VERSION_KEY) or 0),
        )

    async def arecord_filing(
        self,
        file_path: str,
        filing: dict[str, str],
        *,
        draft_version: int | None = None,
    ) -> None:
        store = self._get_store()
        namespace = self._get_namespace()
        item = await store.aget(namespace, file_path)
        if item is None:
            return
        stamp = {FILED_AT_DRAFT_VERSION_KEY: draft_version} if draft_version is not None else {}
        await store.aput(namespace, file_path, {**item.value, **filing, **stamp})

    def write(self, file_path: str, content: str) -> WriteResult:
        text = normalize_draft_text(content)
        usage = self._usage(file_path)
        refusal = write_refusal(usage, file_path, text)
        if refusal is not None:
            return WriteResult(error=refusal)
        result = super().write(file_path, text)
        if result.error is None:
            self._record(file_path, usage.version + 1, usage.filing)
        return result

    async def awrite(self, file_path: str, content: str) -> WriteResult:
        text = normalize_draft_text(content)
        usage = await self.ausage(file_path)
        refusal = write_refusal(usage, file_path, text)
        if refusal is not None:
            return WriteResult(error=refusal)
        result = await super().awrite(file_path, text)
        if result.error is None:
            await self._arecord(file_path, usage.version + 1, usage.filing)
        return result

    def edit(
        self,
        file_path: str,
        old_string: str,
        new_string: str,
        replace_all: bool = False,  # noqa: FBT001, FBT002 - positional, to match the backend protocol
    ) -> EditResult:
        old_text = normalize_draft_text(old_string)
        new_text = normalize_draft_text(new_string)
        usage = self._usage(file_path)
        refusal = edit_refusal(usage, file_path, old_text, new_text, replace_all=replace_all)
        if refusal is not None:
            return EditResult(error=refusal)
        result = super().edit(file_path, old_text, new_text, replace_all)
        if result.error is None:
            self._record(file_path, usage.version + 1, usage.filing)
        return result

    async def aedit(
        self,
        file_path: str,
        old_string: str,
        new_string: str,
        replace_all: bool = False,  # noqa: FBT001, FBT002 - positional, to match the backend protocol
    ) -> EditResult:
        old_text = normalize_draft_text(old_string)
        new_text = normalize_draft_text(new_string)
        usage = await self.ausage(file_path)
        refusal = edit_refusal(usage, file_path, old_text, new_text, replace_all=replace_all)
        if refusal is not None:
            return EditResult(error=refusal)
        result = await super().aedit(file_path, old_text, new_text, replace_all)
        if result.error is None:
            await self._arecord(file_path, usage.version + 1, usage.filing)
        return result

    async def afiles(self) -> list[tuple[str, bytes]]:
        store = self._get_store()
        namespace = self._get_namespace()
        files: list[tuple[str, bytes]] = []
        offset = 0
        while True:
            page = await store.asearch(namespace, limit=_PAGE_SIZE, offset=offset)
            files.extend((str(item.key), stored_bytes(item.value)) for item in page)
            if len(page) < _PAGE_SIZE:
                break
            offset += _PAGE_SIZE
        return files

    async def aread_bytes(self, file_path: str) -> tuple[bytes, DraftUsage] | None:
        usage = await self.ausage(file_path)
        if usage.content is None:
            return None
        data = base64.b64decode(usage.content) if usage.is_binary else usage.content.encode("utf-8")
        return data, usage

    async def awrite_run_file(
        self, file_path: str, data: bytes, *, derived_from: dict[str, str] | None = None
    ) -> str | None:
        refusal = path_refusal(file_path) or _root_write_refusal(file_path)
        if refusal is not None:
            return refusal
        usage = await self.ausage(file_path)
        store = self._get_store()
        namespace = self._get_namespace()
        existing = await store.aget(namespace, file_path)
        kept = {key: value for key, value in (existing.value if existing is not None else {}).items()}
        held = stored_size(kept) + previous_size(kept) if existing is not None else 0
        without_history = usage.file_bytes - held + len(data)
        if without_history > MAX_RUN_FILE_BYTES:
            return (
                f"Cannot keep {file_path} because this conversation's files would exceed "
                f"{MAX_RUN_FILE_BYTES // (1024 * 1024)} MB. Write fewer or smaller files."
            )
        history = history_of(kept, usage.version) if existing is not None else {}
        if history and without_history + stored_size(kept) > MAX_RUN_FILE_BYTES:
            history = {}
        for key in PREVIOUS_KEYS:
            kept.pop(key, None)
        now = datetime.now(UTC).isoformat()
        origin = derived_from or derived_from_value(kept)
        value = {
            **kept,
            **run_file_value(file_path, data),
            **history,
            **({DERIVED_FROM_KEY: origin} if origin else {}),
            "created_at": kept.get("created_at", now),
            "modified_at": now,
            VERSION_KEY: usage.version + 1,
            MADE_BY_KEY: MADE_BY_RUN,
        }
        await store.aput(namespace, file_path, value)
        self._card(file_path, value, size=len(data))
        return None

    def _card(self, file_path: str, value: dict, *, size: int, removed: bool = False) -> None:
        emit_draft_card(
            path=file_path,
            content="",
            version=int(value.get(VERSION_KEY) or 1),
            filing=filing_from_value(value),
            size=size,
            filed_at_version=int(value.get(FILED_AT_DRAFT_VERSION_KEY) or 0),
            previous_version=int(value.get(PREVIOUS_VERSION_KEY) or 0),
            derived_from=derived_from_value(value),
            removed=removed,
        )

    async def aremove(self, file_path: str) -> bool:
        store = self._get_store()
        namespace = self._get_namespace()
        existing = await store.aget(namespace, file_path)
        if existing is None:
            return False
        await store.adelete(namespace, file_path)
        self._card(file_path, existing.value, size=stored_size(existing.value), removed=True)
        return True

    async def arestore_previous(self, file_path: str) -> int | None:
        store = self._get_store()
        namespace = self._get_namespace()
        existing = await store.aget(namespace, file_path)
        if existing is None or not existing.value.get(PREVIOUS_VERSION_KEY):
            return None
        value = dict(existing.value)
        version = int(value.get(VERSION_KEY) or 0) + 1
        restored = {"content": value[PREVIOUS_CONTENT_KEY], "encoding": value.get(PREVIOUS_ENCODING_KEY) or "utf-8"}
        value.update(
            {
                **restored,
                **history_of(existing.value, int(existing.value.get(VERSION_KEY) or 0)),
                VERSION_KEY: version,
                "modified_at": datetime.now(UTC).isoformat(),
            }
        )
        await store.aput(namespace, file_path, value)
        self._card(file_path, value, size=stored_size(value))
        return version

    async def aread_version(self, file_path: str, version: int) -> bytes | None:
        store = self._get_store()
        existing = await store.aget(self._get_namespace(), file_path)
        if existing is None:
            return None
        if int(existing.value.get(VERSION_KEY) or 0) == version:
            return stored_bytes(existing.value)
        if int(existing.value.get(PREVIOUS_VERSION_KEY) or 0) == version:
            return previous_bytes(existing.value)
        return None


async def _build_store(dsn: str) -> BaseStore:
    if not is_postgres_dsn(dsn):
        logger.warning(
            "No Postgres checkpoint DSN (%s=%r): the chat working directory is in memory, "
            "so drafts do not survive a restart of this process.",
            _DSN_ENV,
            dsn,
        )
        from langgraph.store.memory import InMemoryStore

        return InMemoryStore()

    from langgraph.store.postgres import AsyncPostgresStore

    from agent.common import get_checkpoint_pool
    from agent.knowledge.leader_lock import keyed_lock_async

    store = AsyncPostgresStore(get_checkpoint_pool(dsn))
    async with keyed_lock_async("langgraph-setup:store"):
        await store.setup()
    await rename_legacy_draft_keys(store)
    logger.info("Chat working directory on Postgres store (shared checkpoint pool).")
    return store


async def rename_legacy_draft_keys(store: BaseStore) -> int:
    pool = getattr(store, "conn", None)
    if pool is None or not hasattr(pool, "connection"):
        return 0
    prefix_len = len(LEGACY_DRAFT_ROOT) + 1
    statement = (
        "UPDATE store SET key = %(new)s || substr(key, %(cut)s) "
        "WHERE prefix LIKE 'conversation.%%.drafts' AND key LIKE %(like)s "
        "AND NOT EXISTS (SELECT 1 FROM store twin WHERE twin.prefix = store.prefix "
        "AND twin.key = %(new)s || substr(store.key, %(cut)s))"
    )
    try:
        async with pool.connection() as conn:
            cursor = await conn.execute(
                statement, {"new": DRAFT_ROOT, "cut": prefix_len, "like": f"{LEGACY_DRAFT_ROOT}%"}
            )
            moved = cursor.rowcount or 0
    except Exception:
        logger.warning("Could not rename legacy draft keys; they stay readable under their old root", exc_info=True)
        return 0
    if moved:
        logger.info("Moved %d draft keys from %s to %s", moved, LEGACY_DRAFT_ROOT, DRAFT_ROOT)
    return moved


async def get_draft_store(dsn: str | None = None) -> BaseStore:
    key = dsn if dsn is not None else os.environ.get(_DSN_ENV, "")
    store = _stores.get(key)
    if store is not None:
        return store
    async with _store_lock:
        store = _stores.get(key)
        if store is not None:
            return store
        store = await _build_store(key)
        _stores[key] = store
        return store


async def get_draft_backend(conversation_id: str, dsn: str | None = None) -> DraftBackend:
    return DraftBackend(store=await get_draft_store(dsn), conversation_id=conversation_id)


async def delete_conversation_drafts(conversation_id: str, dsn: str | None = None) -> int:
    store = await get_draft_store(dsn)
    namespace = draft_namespace(conversation_id)
    seen: set[str] = set()
    while True:
        page = await store.asearch(namespace, limit=_PAGE_SIZE)
        keys = [item.key for item in page if item.key not in seen]
        if not keys:
            logger.info("Working directory of conversation %s dropped: %d file(s)", conversation_id, len(seen))
            return len(seen)
        seen.update(keys)
        for key in keys:
            await store.adelete(namespace, key)


def reset_draft_stores() -> None:
    _stores.clear()
