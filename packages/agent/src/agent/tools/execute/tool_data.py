from __future__ import annotations

import asyncio
import json
import logging
import re
from collections import OrderedDict
from collections.abc import Container
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

WORKSPACE_ABOUT: dict[str, str] = {
    "project-profile-get": "Projektprofil",
    "project-get": "Projektdaten",
    "project-overview-get": "Projektübersicht",
}

_REFERENCE = re.compile(r"r[1-9][0-9]{0,6}")

_MAX_LOCKS = 512
_locks: OrderedDict[str, asyncio.Lock] = OrderedDict()


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


def _lock(conversation_id: str) -> asyncio.Lock:
    lock = _locks.get(conversation_id)
    if lock is None:
        lock = _locks[conversation_id] = asyncio.Lock()
        while len(_locks) > _MAX_LOCKS:
            _locks.popitem(last=False)
    _locks.move_to_end(conversation_id)
    return lock


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
        await store.aput(namespace, reference, {"tool": data.tool, "about": data.about, "json": body.decode("utf-8")})
        kept.append(reference)
        for dropped in kept[:-MAX_KEPT]:
            await store.adelete(namespace, dropped)
        await store.aput(namespace, INDEX_KEY, {"next": number + 1, "references": kept[-MAX_KEPT:]})
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
        path = INPUT_DIR + file_name(str(item.value.get("tool") or "data"), reference)
        if path in taken:
            path = INPUT_DIR + file_name("data", reference)
        handed.append(HandedData(reference, str(item.value.get("about") or ""), path, item.value["json"].encode()))
    return handed


async def delete_conversation_tool_data(conversation_id: str) -> int:
    store = await draft_store.get_draft_store()
    namespace = data_namespace(conversation_id)
    seen: set[str] = set()
    while True:
        page = await store.asearch(namespace, limit=100)
        keys = [item.key for item in page if item.key not in seen]
        if not keys:
            return len(seen - {INDEX_KEY})
        seen.update(keys)
        for key in keys:
            await store.adelete(namespace, key)
