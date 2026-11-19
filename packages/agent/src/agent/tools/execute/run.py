from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import AsyncIterator
from collections.abc import Container
from contextlib import asynccontextmanager
from dataclasses import dataclass
from dataclasses import field

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
from .progress import FileRunProgress
from .project_state import changed_in_project
from .runner_client import WORKSPACE
from .runner_client import RunnerUnavailable
from .runner_client import RunResult
from .runner_client import run_code
from .tool_data import DataRefused
from .tool_data import hand_over
from .tool_data import is_erased
from .trace import KeptFile
from .trace import RunFacts
from .trace import record_run
from .workspace_files import MAX_FILE_BYTES
from .workspace_files import content_hash
from .workspace_files import derived_origin
from .workspace_files import not_loaded_message
from .workspace_files import over_budget_message
from .workspace_files import oversize_file_message

logger = logging.getLogger(__name__)

INPUT_DIR = f"{WORKSPACE}in/"

MAX_INPUT_BYTES = 50 * 1024 * 1024

MAX_DOCUMENTS = 10

UNNAMED_INPUT = "document"

MAX_TEXT_BACK = 8_000

DEFAULT_TIMEOUT_S = 60

MAX_TIMEOUT_S = 180


@dataclass
class _ConversationLock:
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    users: int = 0


_locks: dict[str, _ConversationLock] = {}

NO_CONVERSATION = "execute runs only inside a conversation: there is no working directory to read from or write to."

NO_RUNNER = "Code execution is not available in this deployment. Answer without running code."

NO_ENVELOPE = "This run carries no signed request context, so no project file can be read for the script."


class _Refusal(Exception):
    def __init__(self, message: str, code: str) -> None:
        super().__init__(message)
        self.code = code


@asynccontextmanager
async def _lock(conversation_id: str) -> AsyncIterator[None]:
    entry = _locks.setdefault(conversation_id, _ConversationLock())
    entry.users += 1
    try:
        async with entry.lock:
            yield
    finally:
        entry.users -= 1
        if entry.users == 0 and _locks.get(conversation_id) is entry:
            del _locks[conversation_id]


def _to_runner(path: str) -> str:
    return WORKSPACE + path[len(DRAFT_ROOT) :]


def _to_drafts(path: str) -> str:
    return DRAFT_ROOT + path[len(WORKSPACE) :]


def _headers() -> dict[str, str]:
    header, signature = project_context.get_request_envelope_from_context()
    if not (header and signature):
        raise _Refusal(NO_ENVELOPE, "no_envelope")
    return bff_http.SignedEnvelope(header=header, signature=signature).headers()


def _too_large(file_name: str, size: int | None, budget: int) -> _Refusal:
    if size is not None and size > MAX_FILE_BYTES:
        return _Refusal(oversize_file_message(file_name, size), "too_large")
    return _Refusal(over_budget_message(file_name, size or budget + 1, budget, MAX_INPUT_BYTES), "too_large")


async def _document_bytes(name: str, budget: int) -> tuple[str, str, bytes, str | None]:
    try:
        resolved = await resolve_document(name)
    except Refused as refused:
        raise _Refusal(str(refused), "unresolved") from refused
    if isinstance(resolved, str):
        raise _Refusal(resolved, "unresolved")
    if not resolved.collection:
        raise _Refusal(
            f"'{resolved.file_name}' is a base-corpus document; read it with read_file instead.", "base_corpus"
        )
    headers = _headers()
    try:
        bucket, key = await asyncio.to_thread(locate_stored_file, resolved.collection, resolved.file_name, headers)
        data = await asyncio.to_thread(read_stored_file, bucket, key, min(budget, MAX_FILE_BYTES))
    except StoredFileUnavailable as exc:
        if exc.reason == "too_large":
            raise _too_large(resolved.file_name, exc.size, budget) from exc
        raise _Refusal(
            f"'{resolved.file_name}' could not be read for the script ({exc.reason}).", "unreadable"
        ) from exc
    note_collections_read([resolved.collection])
    document_id = resolved.target.document_id if resolved.target else None
    return resolved.collection, resolved.file_name, data, document_id


def input_name(file_name: str) -> str:
    base = file_name.replace("\\", "/").rsplit("/", 1)[-1]
    base = "".join(char for char in base if char.isprintable()).strip()
    return base if base.strip(".") else UNNAMED_INPUT


def unique_input_path(file_name: str, taken: Container[str]) -> str:
    base = input_name(file_name)
    stem, dot, suffix = base.rpartition(".")
    if not stem:
        stem, dot, suffix = base, "", ""
    path, count = f"{INPUT_DIR}{base}", 1
    while path in taken:
        count += 1
        path = f"{INPUT_DIR}{stem} ({count}){dot}{suffix}"
    return path


@dataclass
class _Sent:
    files: dict[str, bytes] = field(default_factory=dict)
    inputs: list[tuple[str, str]] = field(default_factory=list)
    documents: list[tuple[str, str | None]] = field(default_factory=list)
    existing: dict[str, int] = field(default_factory=dict)
    not_loaded: list[str] = field(default_factory=list)
    origins: dict[str, dict[str, str]] = field(default_factory=dict)
    versions: dict[str, int] = field(default_factory=dict)
    data: list[tuple[str, str]] = field(default_factory=list)


async def _inputs(backend: DraftBackend, documents: list[str]) -> _Sent:
    drafts = {_to_runner(path): data for path, data in await backend.afiles()}
    sent = _Sent(dict(drafts), existing={path: len(data) for path, data in drafts.items()})
    sent.versions = await backend.aversions([_to_drafts(path) for path in drafts])
    used = sum(len(data) for data in sent.files.values())
    read: set[tuple[str, str]] = set()
    sent.not_loaded = list(dict.fromkeys(documents[MAX_DOCUMENTS:]))
    for name in documents[:MAX_DOCUMENTS]:
        collection, file_name, data, document_id = await _document_bytes(name, MAX_INPUT_BYTES - used)
        if (collection, file_name) in read:
            continue
        read.add((collection, file_name))
        path = unique_input_path(file_name, {**sent.existing, **sent.files})
        sent.files[path] = data
        sent.inputs.append((file_name, path))
        sent.documents.append((file_name, document_id))
        if document_id:
            sent.origins[path] = {
                "document_id": document_id,
                "name": input_name(file_name),
                "content_hash": content_hash(data),
            }
        used += len(data)
    return sent


def dropped_inputs(sent: dict[str, bytes], result: RunResult) -> list[str]:
    return [
        _dropped_input(path, path in sent)
        for path, data in sorted(result.files.items())
        if path.startswith(INPUT_DIR) and sent.get(path) != data
    ]


async def _keep(backend: DraftBackend, sent: _Sent, result: RunResult) -> tuple[list[KeptFile], dict[str, str]]:
    kept: list[KeptFile] = []
    refused: dict[str, str] = {}
    for path, data in sorted(result.files.items()):
        if path.startswith(INPUT_DIR):
            continue
        draft_path = _to_drafts(path)
        origin = derived_origin(path, sent.origins)
        refusal = await backend.awrite_run_file(draft_path, data, derived_from=origin)
        if refusal is None:
            kept.append(KeptFile(draft_path, len(data), new=path not in sent.existing))
        else:
            refused[draft_path] = refusal
    return kept, refused


async def _remove(backend: DraftBackend, sent: _Sent, result: RunResult) -> list[str]:
    gone = [path for path in result.deleted if path in sent.existing and not path.startswith(INPUT_DIR)]
    removed: list[str] = []
    for path in gone:
        draft = _to_drafts(path)
        if await backend.aremove(draft, version=sent.versions.get(draft, 0)):
            removed.append(draft)
    return removed


def _dropped_input(path: str, was_input: bool) -> str:
    if was_input:
        return (
            f"{path} was changed by the script; inputs are read-only, so the change was dropped. "
            f"Write the changed file to a path outside {INPUT_DIR} to keep it."
        )
    return f"{path} was dropped: nothing written under {INPUT_DIR} is kept. Write it elsewhere under {WORKSPACE}."


def _size(count: int) -> str:
    return f"{count / 1024:.1f} KB" if count < 1024 * 1024 else f"{count / (1024 * 1024):.1f} MB"


def _clip(text: str) -> str:
    return text if len(text) <= MAX_TEXT_BACK else text[:MAX_TEXT_BACK] + "\n… (cut)"


def _report(result: RunResult, sent: _Sent, kept: list[KeptFile], refused: dict[str, str]) -> str:
    lines = [f"status: {result.status} ({result.duration_ms} ms)"]
    if sent.inputs:
        lines.append("documents read: " + ", ".join(f"'{name}' at {path}" for name, path in sent.inputs))
    if sent.not_loaded:
        lines.append(not_loaded_message(sent.not_loaded, MAX_DOCUMENTS))
    if sent.data:
        lines.append("data read: " + ", ".join(f"{reference} at {path}" for reference, path in sent.data))
    if result.value is not None:
        lines.append("value: " + _clip(json.dumps(result.value, ensure_ascii=False, default=str)))
    if result.stdout:
        lines.append("stdout:\n" + _clip(result.stdout))
    if result.stderr:
        lines.append("stderr:\n" + _clip(result.stderr))
    written = ", ".join(f"{file.path} ({_size(file.size)})" for file in kept)
    lines.append("files written: " + (written or "none"))
    lines.extend(f"not kept: {reason}" for reason in refused.values())
    lines.extend(f"not kept: {reason}" for reason in dropped_inputs(sent.files, result))
    if kept:
        lines.append("A written file stays in the working directory; file_draft puts it into the project when asked.")
    return "\n".join(lines)


async def execute(
    runner_url: str,
    code: str,
    *,
    documents: list[str] | None = None,
    data: list[str] | None = None,
    timeout_seconds: int = 0,
) -> str:
    facts = RunFacts.of(code, documents, data)
    try:
        return await _execute(facts, runner_url, code, list(documents or []), list(data or []), timeout_seconds)
    finally:
        record_run(facts)


async def _with_data(sent: _Sent, conversation_id: str, data: list[str]) -> _Sent:
    try:
        handed = await hand_over(conversation_id, data, sent.files)
    except DataRefused as refused:
        raise _Refusal(str(refused), refused.code) from refused
    for entry in handed:
        sent.files[entry.path] = entry.data
        sent.data.append((entry.reference, entry.path))
        sent.documents.append((entry.about, None))
    if sum(len(body) for body in sent.files.values()) > MAX_INPUT_BYTES:
        raise _Refusal(
            "The files and data for this run exceed 50 MB. Hand over fewer or narrower results.", "too_large"
        )
    return sent


async def _execute(
    facts: RunFacts, runner_url: str, code: str, documents: list[str], data: list[str], timeout_seconds: int
) -> str:
    if not runner_url:
        facts.stop("unavailable", "no_runner")
        return NO_RUNNER
    conversation_id = project_context.get_conversation_id_from_context()
    if not conversation_id:
        facts.stop("refused", "no_conversation")
        return NO_CONVERSATION
    timeout_s = min(max(timeout_seconds or DEFAULT_TIMEOUT_S, 1), MAX_TIMEOUT_S)
    async with _lock(conversation_id):
        backend = await get_draft_backend(conversation_id)
        try:
            sent = await _with_data(await _inputs(backend, documents), conversation_id, data)
        except _Refusal as refusal:
            facts.stop("refused", refusal.code)
            return f"Nothing was run. {refusal}"
        facts.sent(sent.files, timeout_s)
        stale = await changed_in_project(backend, [_to_drafts(path) for path in sent.files if path in sent.existing])
        progress = FileRunProgress.begin(code, sent.existing, sent.documents)
        try:
            result = await run_code(runner_url, code, language="ts", files=sent.files, timeout_ms=timeout_s * 1000)
        except RunnerUnavailable as exc:
            logger.warning("execute: %s", exc)
            facts.stop("unavailable", exc.code)
            progress.finish("unavailable", kept=[], elapsed_ms=0)
            return f"Nothing was run: {exc}. Try once more; if it fails again, answer without running code."
        facts.ran(result.status, result.duration_ms, result.stderr)
        if await is_erased(conversation_id):
            facts.stop("refused", "erased")
            return NO_CONVERSATION
        kept, refused = await _keep(backend, sent, result)
        removed = await _remove(backend, sent, result) if result.status == "ok" else []
        if await is_erased(conversation_id):
            await backend.aerase()
            facts.stop("refused", "erased")
            return NO_CONVERSATION
        facts.kept, facts.files_refused = kept, len(refused)
        progress.finish(
            result.status, kept=kept, elapsed_ms=result.duration_ms, value=result.value, refused=tuple(refused)
        )
    later = [*(f"removed from the working directory: {path}" for path in removed), *stale]
    return "\n".join([_report(result, sent, kept, refused), *later])
