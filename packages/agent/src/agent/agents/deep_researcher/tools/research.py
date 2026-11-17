from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import re
from collections.abc import Iterator
from collections.abc import Sequence
from dataclasses import dataclass
from dataclasses import field
from typing import Any
from typing import cast

from langchain.tools import ToolRuntime
from langchain_core.messages import HumanMessage
from langchain_core.tools import BaseTool
from langchain_core.tools import tool
from langgraph.errors import GraphRecursionError

from agent.common import RunBudgetExceededError
from agent.common import extract_json
from agent.common.cost_tracking import BudgetExceededError
from agent.common.retrieval_rounds import repeat_fetches
from agent.common.retrieval_status import record_round_announcement
from agent.common.tool_calls import fetch_signature
from agent.common.turn_notices import emit_repeat_fetch
from agent.common.turn_status import retrieval_round_scope
from agent.common.turn_status import subagent_run

from ..control import note_write_now_honoured
from ..control import take_added_documents
from ..control import write_now_requested
from ..models import ResearchGap
from ..models import ResearchNotes
from ..models import ResearchQuery
from ..models import last_message_text

_NO_TOOL_RUNTIME = cast(ToolRuntime, None)

ADDED_DOCUMENTS_NOTICE = (
    "The reader added documents to the Grundlage during this run. Each MUST be read in full: plan ONE "
    "dedicated ResearchQuery per document in the NEXT batch, naming the file exactly, knowledge tool first.\n{lines}"
)

WRITE_NOW_NOTICE = (
    "The reader asked for the report to be written now. Do not run further research batches: "
    "proceed to the writer with the research notes already under /shared and state in the report "
    "which planned components were not researched."
)
logger = logging.getLogger(__name__)
_NOTE_SLUG_MAX_LENGTH = 64

RESEARCHER_AGENT = "researcher-agent"


def _positive_int_env(name: str, default: int) -> int:
    try:
        value = int(os.environ.get(name, ""))
    except TypeError, ValueError:
        return default
    return value if value > 0 else default


RESEARCHER_RECURSION_LIMIT = _positive_int_env("RESEARCHER_RECURSION_LIMIT", 100)

MAX_QUERY_SUBMISSIONS = _positive_int_env("MAX_QUERY_SUBMISSIONS", 3)

RESEARCH_NOTE_MAX_CHARS = 40_000
_RESEARCH_NOTE_TRUNCATION_SUFFIX = "\n\n[... truncated: research note exceeded the size budget ...]"

_UNRESEARCHABLE_SUMMARY = "Dieser Aspekt konnte nach mehrmaligen Versuchen nicht recherchiert werden."
_UNRESEARCHABLE_NARRATIVE = (
    "Der Worker hat wiederholt das Schritt- oder Wiederholungslimit erreicht, ohne verwertbare Ergebnisse zu liefern."
)


class ResearcherExhaustedError(Exception): ...


@dataclass
class RetrievalRounds:
    announcements: list[dict[str, Any]] = field(default_factory=list)
    results: dict[str, dict[str, Any]] = field(default_factory=dict)


def _query_call(query: ResearchQuery, conclusion: str) -> dict[str, Any]:
    return {
        "name": query.preferred_tools[0],
        "args": {"query": query.query, "conclusion": conclusion},
        "id": _query_digest(query),
    }


def _split_batch(calls: list[dict[str, Any]], executed: Sequence[str]) -> tuple[list[int], list[str]]:
    withheld = {id(call) for call in repeat_fetches(calls, executed)}
    running = [index for index, call in enumerate(calls) if id(call) not in withheld]
    repeats = [signature for call in calls if id(call) in withheld and (signature := fetch_signature(call)) is not None]
    return running, repeats


def format_research_request(query: ResearchQuery) -> str:
    query_json = json.dumps(query.model_dump(mode="json"), indent=2, ensure_ascii=False)
    return (
        "Batch research invocation. Execute this ResearchQuery and return a structured ResearchNotes response. "
        "Do not call write_file or edit_file; run_research_batch will persist the returned ResearchNotes under "
        "/shared/ after you return.\n\n"
        "ResearchQuery JSON:\n"
        f"{query_json}"
    )


def researcher_invoke_state(query: ResearchQuery, runtime: ToolRuntime | None) -> dict[str, Any]:
    invoke_state: dict[str, Any] = {
        "messages": [HumanMessage(content=format_research_request(query))],
    }
    parent_state = getattr(runtime, "state", None) if runtime is not None else None
    if isinstance(parent_state, dict) and "files" in parent_state:
        invoke_state["files"] = parent_state["files"]
    return invoke_state


def _structured_research_notes(result: Any) -> ResearchNotes:
    structured = result.get("structured_response") if isinstance(result, dict) else None
    if structured is None:
        text = last_message_text(result) if isinstance(result, dict) else None
        structured = extract_json(text) if text else None
    if structured is None:
        raise ValueError("researcher worker did not return structured ResearchNotes")
    return ResearchNotes.model_validate(structured)


def _worker_config(callbacks: list[Any]) -> dict[str, Any]:
    worker_callbacks = [cb.for_new_run() if hasattr(cb, "for_new_run") else cb for cb in callbacks]
    config: dict[str, Any] = {"recursion_limit": RESEARCHER_RECURSION_LIMIT}
    if worker_callbacks:
        config["callbacks"] = worker_callbacks
    return config


async def _run_research_query(
    *,
    query: ResearchQuery,
    researcher_runnable: Any,
    runtime: ToolRuntime | None,
    callbacks: list[Any],
    semaphore: asyncio.Semaphore,
) -> ResearchNotes:
    async with semaphore, subagent_run(RESEARCHER_AGENT, description=query.query):
        try:
            result = await researcher_runnable.ainvoke(
                researcher_invoke_state(query, runtime), config=_worker_config(callbacks)
            )
        except RunBudgetExceededError, BudgetExceededError:
            raise
        except GraphRecursionError:
            raise ResearcherExhaustedError(
                f"researcher worker exceeded the step budget ({RESEARCHER_RECURSION_LIMIT} steps) "
                f"for query {query.query!r}"
            ) from None
        except Exception as exc:  # noqa: BLE001 - captured as per-item failure
            raise RuntimeError(f"researcher worker failed for query {query.query!r}: {exc}") from exc

        note = _structured_research_notes(result)
        if not note.findings and not note.summary.strip():
            raise ValueError(
                f"researcher worker returned an empty ResearchNotes (no findings and blank summary) "
                f"for query {query.query!r}"
            )
    return note


def _research_note_slug(text: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "_", text.lower()).strip("_")
    slug = slug[:_NOTE_SLUG_MAX_LENGTH].strip("_")
    return slug or "research_note"


def _research_note_path(query: ResearchQuery) -> str:
    digest_input = json.dumps(query.model_dump(mode="json"), sort_keys=True, ensure_ascii=False)
    digest = hashlib.sha1(digest_input.encode("utf-8")).hexdigest()[:8]
    slug = _research_note_slug(query.query)
    return f"/shared/research_note_{slug}_{digest}.json"


def _string_leaves(container: Any, key: Any, value: Any) -> Iterator[tuple[Any, Any, str]]:
    if isinstance(value, str):
        yield container, key, value
        return
    children = value.items() if isinstance(value, dict) else enumerate(value) if isinstance(value, list) else ()
    for child_key, child in children:
        yield from _string_leaves(value, child_key, child)


def _largest_string_leaf(obj: Any) -> tuple[Any, Any] | None:
    leaves = list(_string_leaves(None, None, obj))
    if not leaves:
        return None
    container, key, _ = max(leaves, key=lambda leaf: len(leaf[2]))
    return container, key


def _truncate_research_note(note: ResearchNotes) -> ResearchNotes:
    data = note.model_dump(mode="json")

    def payload_len() -> int:
        return len(json.dumps(data, indent=2, ensure_ascii=False))

    while payload_len() > RESEARCH_NOTE_MAX_CHARS:
        leaf = _largest_string_leaf(data)
        if leaf is None:
            break
        container, key = leaf
        current = container[key]
        overshoot = payload_len() - RESEARCH_NOTE_MAX_CHARS
        keep = max(0, len(current) - overshoot - len(_RESEARCH_NOTE_TRUNCATION_SUFFIX))
        new_value = current[:keep] + _RESEARCH_NOTE_TRUNCATION_SUFFIX
        if len(new_value) >= len(current):
            break
        container[key] = new_value
    return ResearchNotes.model_validate(data)


def _research_note_files(queries: list[ResearchQuery], notes: list[ResearchNotes]) -> list[tuple[str, bytes]]:
    files: list[tuple[str, bytes]] = []
    for query, note in zip(queries, notes, strict=False):
        payload = json.dumps(note.model_dump(mode="json"), indent=2, ensure_ascii=False)
        if len(payload) > RESEARCH_NOTE_MAX_CHARS:
            note = _truncate_research_note(note)
            payload = json.dumps(note.model_dump(mode="json"), indent=2, ensure_ascii=False)
        files.append((_research_note_path(query), payload.encode("utf-8")))
    return files


async def _persist_research_notes(
    *,
    backend: Any | None,
    queries: list[ResearchQuery],
    notes: list[ResearchNotes],
) -> None:
    if backend is None or not notes:
        return

    responses = await backend.aupload_files(_research_note_files(queries, notes))
    errors = [f"{response.path}: {response.error}" for response in responses if getattr(response, "error", None)]
    if errors:
        raise RuntimeError(f"failed to persist research note file(s): {'; '.join(errors)}")


def _collect_worker_results(
    queries: list[ResearchQuery],
    raw_results: list[Any],
) -> tuple[list[ResearchQuery], list[ResearchNotes], list[str]]:
    successful_queries: list[ResearchQuery] = []
    notes: list[ResearchNotes] = []
    errors: list[str] = []
    for query, raw_result in zip(queries, raw_results, strict=False):
        if isinstance(raw_result, (RunBudgetExceededError, BudgetExceededError)):
            raise raw_result
        if isinstance(raw_result, ResearcherExhaustedError):
            successful_queries.append(query)
            notes.append(_terminal_unresearchable_note(query))
            continue
        if isinstance(raw_result, BaseException):
            errors.append(f"{query.query}: {str(raw_result) or raw_result.__class__.__name__}")
            continue
        successful_queries.append(query)
        notes.append(raw_result)
    return successful_queries, notes, errors


async def _run_research_queries(
    *,
    queries: list[ResearchQuery],
    researcher_runnable: Any,
    runtime: ToolRuntime | None,
    callbacks: list[Any],
    max_concurrency: int,
) -> tuple[list[ResearchQuery], list[ResearchNotes], list[str]]:
    semaphore = asyncio.Semaphore(min(max_concurrency, len(queries)))
    raw_results = await asyncio.gather(
        *(
            _run_research_query(
                query=query,
                researcher_runnable=researcher_runnable,
                runtime=runtime,
                callbacks=callbacks,
                semaphore=semaphore,
            )
            for query in queries
        ),
        return_exceptions=True,
    )
    return _collect_worker_results(queries, list(raw_results))


def _assert_batch_size(queries: list[ResearchQuery], max_research_concurrency: int) -> None:
    if len(queries) <= max_research_concurrency:
        return
    raise ValueError(
        f"run_research_batch accepts at most {max_research_concurrency} curated queries. "
        f"Received {len(queries)}. Rank, merge, or drop lower-priority queries and call again."
    )


def _assert_preferred_tools_available(queries: list[ResearchQuery], researcher_tool_names: set[str]) -> None:
    missing = {
        tool_name for query in queries for tool_name in query.preferred_tools if tool_name not in researcher_tool_names
    }
    if missing:
        available = ", ".join(sorted(researcher_tool_names)) or "(none)"
        raise ValueError(
            f"run_research_batch received queries whose preferred_tools are not available to researcher "
            f"workers: {', '.join(sorted(missing))}. Available researcher tools: {available}. "
            "Re-plan the queries to use only available tools."
        )


def _query_digest(query: ResearchQuery) -> str:
    return hashlib.sha256(
        json.dumps(query.model_dump(mode="json"), sort_keys=True, ensure_ascii=False).encode("utf-8")
    ).hexdigest()


def _terminal_unresearchable_note(query: ResearchQuery) -> ResearchNotes:
    return ResearchNotes(
        query_topic=_research_note_slug(query.query),
        target_components=query.target_components,
        summary=_UNRESEARCHABLE_SUMMARY,
        findings=[],
        gaps=[
            ResearchGap(
                description=f"Query: {query.query}",
                impact=_UNRESEARCHABLE_NARRATIVE,
                suggested_follow_up_queries=[],
            )
        ],
        sources=[],
        narrative_notes=_UNRESEARCHABLE_NARRATIVE,
        language="Deutsch",
        evidence_judgment=None,
    )


def _partition_by_submission_budget(
    queries: list[ResearchQuery],
    submission_counts: dict[str, int],
) -> tuple[list[ResearchQuery], list[ResearchQuery]]:
    runnable: list[ResearchQuery] = []
    exhausted: list[ResearchQuery] = []
    for query in queries:
        digest = _query_digest(query)
        submission_counts[digest] = submission_counts.get(digest, 0) + 1
        (exhausted if submission_counts[digest] > MAX_QUERY_SUBMISSIONS else runnable).append(query)
    return runnable, exhausted


def _batch_failure_message(
    errors: list[str],
    *,
    total_queries: int,
    successful_count: int,
    registered: bool,
    persisted: bool,
) -> str:
    message = (
        f"run_research_batch failed for {len(errors)} of {total_queries} researcher worker(s). "
        f"Errors: {'; '.join(errors)}."
    )
    if not successful_count:
        return message
    actions = [name for name, done in (("registered", registered), ("persisted under /shared/", persisted)) if done]
    retained = " and ".join(actions) or "retained"
    return (
        f"{message} {successful_count} successful researcher worker(s) were {retained}; "
        "resubmit only the failed queries."
    )


def _announce_round(rounds: RetrievalRounds, calls: list[dict[str, Any]]) -> int | None:
    index = len(rounds.announcements)
    announcement = record_round_announcement(round_index=index, calls=calls, conclusion=None)
    if announcement is None:
        return None
    rounds.announcements.append(announcement)
    return index


def _record_batch_results(
    rounds: RetrievalRounds,
    queries: Sequence[ResearchQuery],
    notes: Sequence[ResearchNotes],
    conclusion: str,
) -> None:
    for query, note in zip(queries, notes, strict=False):
        signature = fetch_signature(_query_call(query, conclusion))
        if signature is not None:
            rounds.results.setdefault(signature, note.model_dump(mode="json", exclude_none=True))


def _log_withheld(rounds: RetrievalRounds, repeats: Sequence[str], total: int) -> None:
    if not repeats:
        return
    emit_repeat_fetch(round_index=len(rounds.announcements), withheld=len(repeats))
    logger.info(
        "Duplicate research query withheld: %d of %d answered with the note this run already holds",
        len(repeats),
        total,
    )


def _withheld_notes(repeats: Sequence[str], results: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    return [results[signature] for signature in repeats if signature in results]


RUN_RESEARCH_BATCH_DESCRIPTION = (
    "Run planned research queries in parallel and return ResearchNotes JSON.\n"
    "\n"
    "Args:\n"
    "    queries: The curated ResearchQuery objects to research in this batch.\n"
    "    conclusion: ONE sentence: what the batches so far established and\n"
    "        what this one still has to close. Empty on the first batch."
)


def build_research_batch_tool(
    *,
    researcher_runnable: Any,
    callbacks: list[Any],
    max_research_concurrency: int,
    researcher_tool_names: set[str],
    backend: Any | None = None,
    source_registry_middleware: Any | None = None,
    submission_counts: dict[str, int] | None = None,
    rounds: RetrievalRounds | None = None,
) -> BaseTool:
    ledger: dict[str, int] = submission_counts if submission_counts is not None else {}
    retrieval: RetrievalRounds = rounds if rounds is not None else RetrievalRounds()

    @tool(description=RUN_RESEARCH_BATCH_DESCRIPTION)
    async def run_research_batch(
        queries: list[ResearchQuery],
        conclusion: str = "",
        runtime: ToolRuntime = _NO_TOOL_RUNTIME,
    ) -> str:
        if not queries:
            return "[]"
        if write_now_requested():
            note_write_now_honoured()
            return WRITE_NOW_NOTICE
        _assert_batch_size(queries, max_research_concurrency)
        _assert_preferred_tools_available(queries, researcher_tool_names)
        calls = [_query_call(query, conclusion) for query in queries]
        fresh, repeated = _split_batch(calls, list(retrieval.results))
        _log_withheld(retrieval, repeated, len(queries))
        runnable_queries, exhausted_queries = _partition_by_submission_budget([queries[i] for i in fresh], ledger)
        with retrieval_round_scope(_announce_round(retrieval, [calls[i] for i in fresh])):
            successful_queries, notes, errors = await _run_research_queries(
                queries=runnable_queries,
                researcher_runnable=researcher_runnable,
                runtime=runtime,
                callbacks=callbacks,
                max_concurrency=min(max_research_concurrency, len(runnable_queries) or 1),
            )
        successful_queries.extend(exhausted_queries)
        notes.extend(_terminal_unresearchable_note(query) for query in exhausted_queries)

        if source_registry_middleware is not None:
            source_registry_middleware.register_research_note_sources(notes)
        await _persist_research_notes(backend=backend, queries=successful_queries, notes=notes)
        _record_batch_results(retrieval, successful_queries, notes, conclusion)

        if errors:
            raise RuntimeError(
                _batch_failure_message(
                    errors,
                    total_queries=len(queries),
                    successful_count=len(successful_queries) if notes else 0,
                    registered=source_registry_middleware is not None,
                    persisted=backend is not None,
                )
            )
        result = json.dumps(
            [note.model_dump(mode="json", exclude_none=True) for note in notes]
            + _withheld_notes(repeated, retrieval.results),
            indent=2,
            ensure_ascii=False,
        )
        added = take_added_documents()
        if added:
            lines = "\n".join(f"- {doc.label} — {doc.name}" if doc.title else f"- {doc.name}" for doc in added)
            return f"{ADDED_DOCUMENTS_NOTICE.format(lines=lines)}\n\n{result}"
        return result

    return run_research_batch
