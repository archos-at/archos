from __future__ import annotations

import asyncio
import json
import logging
import re
from collections.abc import AsyncIterator
from collections.abc import Container
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Any

from agent import project_context
from agent.common.turn_status import current_step_scope

from ..documents import draft_store
from .runner_client import WORKSPACE

logger = logging.getLogger(__name__)

INPUT_DIR = f"{WORKSPACE}in/"

MAX_DATA_BYTES = 8 * 1024 * 1024

MAX_KEPT = 20

MAX_DATA_PER_RUN = 10

INDEX_KEY = "index"

ERASED_KEY = "erased"

WORKSPACE_ABOUT: dict[str, str] = {
    "project-profile-get": "Projektprofil",
    "project-get": "Projektdaten",
    "project-overview-get": "Projektübersicht",
}

_REFERENCE = re.compile(r"r[1-9][0-9]{0,6}")

_locks: dict[str, tuple[asyncio.Lock, int]] = {}


def data_namespace(conversation_id: str) -> tuple[str, str, str]:
    return ("conversation", conversation_id, "tool-data")


@dataclass(frozen=True)
class ToolData:
    tool: str
    operation: str
    about: str
    content: dict[str, Any]
    rows: int | None = None
    row_noun: str = "rows"
    model: str | None = None
    provenance: str = ""


@dataclass(frozen=True)
class HandedData:
    reference: str
    about: str
    path: str
    data: bytes


class DataRefused(Exception):
    def __init__(self, message: str, code: str) -> None:
        super().__init__(message)
        self.code = code


@asynccontextmanager
async def _lock(conversation_id: str) -> AsyncIterator[None]:
    lock, users = _locks.get(conversation_id) or (asyncio.Lock(), 0)
    _locks[conversation_id] = (lock, users + 1)
    try:
        async with lock:
            yield
    finally:
        lock, users = _locks[conversation_id]
        if users <= 1:
            del _locks[conversation_id]
        else:
            _locks[conversation_id] = (lock, users - 1)


def _size(count: int) -> str:
    return f"{count / 1024:.1f} KB" if count < 1024 * 1024 else f"{count / (1024 * 1024):.1f} MB"


def file_name(tool: str, reference: str) -> str:
    return f"{tool}-{reference}.json"


def _document(data: ToolData, reference: str) -> bytes:
    document = {
        "reference": reference,
        "tool": data.tool,
        "operation": data.operation,
        "about": data.about,
        "model": data.model,
        "provenance": data.provenance,
        "rows": data.rows,
        "result": data.content,
    }
    return json.dumps(document, ensure_ascii=False, default=str).encode("utf-8")


def _count(data: ToolData, size: int) -> str:
    rows = f"{data.rows} {data.row_noun}, " if data.rows is not None else ""
    return f"{rows}{_size(size)}"


async def keep_tool_data(data: ToolData) -> str:
    conversation_id = project_context.get_conversation_id_from_context()
    if not conversation_id or current_step_scope() != "chat":
        return ""
    try:
        return await _keep(conversation_id, data)
    except Exception:
        logger.warning("A %s result could not be kept for execute", data.tool, exc_info=True)
        return ""


async def _write(store: Any, namespace: tuple[str, ...], reference: str, value: dict, kept: list[str]) -> None:
    number = int(reference[1:])
    try:
        await store.aput(namespace, reference, value)
        kept = [*kept, reference]
        for dropped in kept[:-MAX_KEPT]:
            await store.adelete(namespace, dropped)
        await store.aput(namespace, INDEX_KEY, {"next": number + 1, "references": kept[-MAX_KEPT:]})
    except BaseException:
        await store.adelete(namespace, reference)
        raise


async def _keep(conversation_id: str, data: ToolData) -> str:
    async with _lock(conversation_id):
        store = await draft_store.get_draft_store()
        namespace = data_namespace(conversation_id)
        index = await store.aget(namespace, INDEX_KEY)
        kept = list((index.value if index else {}).get("references") or [])
        number = int((index.value if index else {}).get("next") or 1)
        reference = f"r{number}"
        body = _document(data, reference)
        if len(body) > MAX_DATA_BYTES:
            return (
                f"This result is too large to hand to execute ({_size(len(body))}, at most "
                f"{MAX_DATA_BYTES // (1024 * 1024)} MB): narrow the query to hand it over."
            )
        if await store.aget(namespace, ERASED_KEY) is not None:
            return ""
        await _write(store, namespace, reference, {"tool": data.tool, "about": data.about, "json": body.decode()}, kept)
        if await store.aget(namespace, ERASED_KEY) is not None:
            await _drop_all(store, namespace, frozenset({ERASED_KEY}))
            return ""
    path = INPUT_DIR + file_name(data.tool, reference)
    return (
        f'Data for execute: {reference} ({_count(data, len(body))}). execute(data=["{reference}"]) reads every '
        f"row of it exactly, as JSON at {path}; do not copy these figures into code."
    )


def _unknown(reference: str, kept: list[str]) -> DataRefused:
    held = f"This conversation holds {', '.join(kept)}." if kept else "This conversation holds no tool results yet."
    return DataRefused(
        f"No tool result '{reference}' to hand over. {held} Only the latest {MAX_KEPT} are kept: run the tool "
        "again and pass the reference its 'Data for execute' line names.",
        "unknown_data",
    )


async def hand_over(conversation_id: str, references: list[str], taken: Container[str]) -> list[HandedData]:
    wanted = list(dict.fromkeys(reference.strip() for reference in references if reference.strip()))
    if len(wanted) > MAX_DATA_PER_RUN:
        raise DataRefused(
            f"A run takes at most {MAX_DATA_PER_RUN} tool results; {len(wanted)} were named. Name fewer.",
            "too_many_data",
        )
    if not wanted:
        return []
    store = await draft_store.get_draft_store()
    namespace = data_namespace(conversation_id)
    index = await store.aget(namespace, INDEX_KEY)
    kept = list((index.value if index else {}).get("references") or [])
    handed: list[HandedData] = []
    for reference in wanted:
        item = await store.aget(namespace, reference) if _REFERENCE.fullmatch(reference) else None
        if item is None:
            raise _unknown(reference, kept)
        path = _free_path(str(item.value.get("tool") or "data"), reference, taken, {entry.path for entry in handed})
        handed.append(HandedData(reference, str(item.value.get("about") or ""), path, item.value["json"].encode()))
    return handed


def _free_path(tool: str, reference: str, taken: Container[str], handed: set[str]) -> str:
    candidates = [file_name(tool, reference), file_name("data", reference)]
    candidates += [file_name(f"data-{number}", reference) for number in range(2, MAX_DATA_PER_RUN + 3)]
    for name in candidates:
        path = INPUT_DIR + name
        if path not in taken and path not in handed:
            return path
    raise DataRefused(f"No free name under {INPUT_DIR} for tool result '{reference}'.", "data_path_taken")


async def _drop_all(store: Any, namespace: tuple[str, ...], keep: frozenset[str] = frozenset()) -> int:
    seen: set[str] = set(keep)
    dropped = 0
    while True:
        page = await store.asearch(namespace, limit=100)
        keys = [item.key for item in page if item.key not in seen]
        if not keys:
            return dropped
        seen.update(keys)
        for key in keys:
            await store.adelete(namespace, key)
            dropped += key not in (INDEX_KEY, ERASED_KEY)


async def delete_conversation_tool_data(conversation_id: str) -> int:
    store = await draft_store.get_draft_store()
    namespace = data_namespace(conversation_id)
    await store.aput(namespace, ERASED_KEY, {"erased": True})
    async with _lock(conversation_id):
        return await _drop_all(store, namespace, frozenset({ERASED_KEY}))
