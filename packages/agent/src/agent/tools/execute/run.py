from __future__ import annotations

import asyncio
import json
import logging
from collections import OrderedDict

from agent import project_context
from agent.common import bff_http
from agent.common.stored_file import StoredFileUnavailable
from agent.common.stored_file import locate_stored_file
from agent.common.stored_file import read_stored_file
from agent.knowledge.restricted_use import note_collections_read

from ..canvas.calls import Refused
from ..documents.draft_store import DRAFT_ROOT
from ..documents.draft_store import DraftBackend
from ..documents.draft_store import get_draft_backend
from ..look.resolve import resolve_document
from .runner_client import WORKSPACE
from .runner_client import RunnerUnavailable
from .runner_client import RunResult
from .runner_client import run_code

logger = logging.getLogger(__name__)

INPUT_DIR = f"{WORKSPACE}in/"

MAX_INPUT_BYTES = 50 * 1024 * 1024

MAX_DOCUMENTS = 10

MAX_TEXT_BACK = 8_000

DEFAULT_TIMEOUT_S = 60

MAX_TIMEOUT_S = 180

_MAX_LOCKS = 512
_locks: OrderedDict[str, asyncio.Lock] = OrderedDict()

NO_CONVERSATION = "execute runs only inside a conversation: there is no working directory to read from or write to."

NO_RUNNER = "Code execution is not available in this deployment. Answer without running code."

NO_ENVELOPE = "This run carries no signed request context, so no project file can be read for the script."


class _Refusal(Exception): ...


def _lock(conversation_id: str) -> asyncio.Lock:
    lock = _locks.get(conversation_id)
    if lock is None:
        lock = _locks[conversation_id] = asyncio.Lock()
        while len(_locks) > _MAX_LOCKS:
            _locks.popitem(last=False)
    _locks.move_to_end(conversation_id)
    return lock


def _to_runner(path: str) -> str:
    return WORKSPACE + path[len(DRAFT_ROOT) :]


def _to_drafts(path: str) -> str:
    return DRAFT_ROOT + path[len(WORKSPACE) :]


def _headers() -> dict[str, str]:
    header, signature = project_context.get_request_envelope_from_context()
    if not (header and signature):
        raise _Refusal(NO_ENVELOPE)
    return bff_http.SignedEnvelope(header=header, signature=signature).headers()


async def _document_bytes(name: str, budget: int) -> tuple[str, bytes]:
    try:
        resolved = await resolve_document(name)
    except Refused as refused:
        raise _Refusal(str(refused)) from refused
    if isinstance(resolved, str):
        raise _Refusal(resolved)
    if not resolved.collection:
        raise _Refusal(f"'{resolved.file_name}' is a base-corpus document; read it with read_file instead.")
    headers = _headers()
    try:
        bucket, key = await asyncio.to_thread(locate_stored_file, resolved.collection, resolved.file_name, headers)
        data = await asyncio.to_thread(read_stored_file, bucket, key, budget)
    except StoredFileUnavailable as exc:
        if exc.reason == "too_large":
            raise _Refusal(f"'{resolved.file_name}' is too large: a run takes at most 50 MB of files.") from exc
        raise _Refusal(f"'{resolved.file_name}' could not be read for the script ({exc.reason}).") from exc
    note_collections_read([resolved.collection])
    return resolved.file_name, data


async def _inputs(backend: DraftBackend, documents: list[str]) -> dict[str, bytes]:
    files = {_to_runner(path): data for path, data in await backend.afiles()}
    used = sum(len(data) for data in files.values())
    for name in documents[:MAX_DOCUMENTS]:
        file_name, data = await _document_bytes(name, MAX_INPUT_BYTES - used)
        files[f"{INPUT_DIR}{file_name.rsplit('/', 1)[-1]}"] = data
        used += len(data)
    if used > MAX_INPUT_BYTES:
        raise _Refusal("The files for this run exceed 50 MB. Name fewer documents.")
    return files


async def _keep(backend: DraftBackend, sent: dict[str, bytes], result: RunResult) -> tuple[list[str], list[str]]:
    kept: list[str] = []
    refused: list[str] = []
    for path, data in sorted(result.files.items()):
        if path.startswith(INPUT_DIR):
            continue
        draft_path = _to_drafts(path)
        refusal = await backend.awrite_run_file(draft_path, data, previous_size=len(sent.get(path, b"")))
        if refusal is None:
            kept.append(f"{draft_path} ({_size(len(data))})")
        else:
            refused.append(refusal)
    return kept, refused


def _size(count: int) -> str:
    return f"{count / 1024:.1f} KB" if count < 1024 * 1024 else f"{count / (1024 * 1024):.1f} MB"


def _clip(text: str) -> str:
    return text if len(text) <= MAX_TEXT_BACK else text[:MAX_TEXT_BACK] + "\n… (cut)"


def _report(result: RunResult, kept: list[str], refused: list[str]) -> str:
    lines = [f"status: {result.status} ({result.duration_ms} ms)"]
    if result.value is not None:
        lines.append("value: " + _clip(json.dumps(result.value, ensure_ascii=False, default=str)))
    if result.stdout:
        lines.append("stdout:\n" + _clip(result.stdout))
    if result.stderr:
        lines.append("stderr:\n" + _clip(result.stderr))
    lines.append("files written: " + (", ".join(kept) if kept else "none"))
    lines.extend(f"not kept: {reason}" for reason in refused)
    if kept:
        lines.append("A written file stays in the working directory; file_draft puts it into the project when asked.")
    return "\n".join(lines)


async def execute(runner_url: str, code: str, *, documents: list[str] | None = None, timeout_seconds: int = 0) -> str:
    if not runner_url:
        return NO_RUNNER
    conversation_id = project_context.get_conversation_id_from_context()
    if not conversation_id:
        return NO_CONVERSATION
    timeout_s = min(max(timeout_seconds or DEFAULT_TIMEOUT_S, 1), MAX_TIMEOUT_S)
    async with _lock(conversation_id):
        backend = await get_draft_backend(conversation_id)
        try:
            sent = await _inputs(backend, list(documents or []))
        except _Refusal as refusal:
            return f"Nothing was run. {refusal}"
        try:
            result = await run_code(runner_url, code, language="ts", files=sent, timeout_ms=timeout_s * 1000)
        except RunnerUnavailable as exc:
            logger.warning("execute: %s", exc)
            return f"Nothing was run: {exc}. Try once more; if it fails again, answer without running code."
        kept, refused = await _keep(backend, sent, result)
    return _report(result, kept, refused)
