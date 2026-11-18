from __future__ import annotations

import asyncio
import logging
import os
import time
from collections.abc import Callable
from collections.abc import Iterable
from dataclasses import dataclass
from dataclasses import field
from typing import Any
from typing import Literal

from agent.knowledge.folder_cards import build
from agent.knowledge.folder_cards import client
from agent.knowledge.folder_cards import gate
from agent.knowledge.folder_cards import incremental
from agent.knowledge.folder_cards import queue
from agent.knowledge.folder_cards.inputs import PROMPT_VERSION
from agent.knowledge.folder_cards.inputs import FolderInputs
from agent.knowledge.folder_cards.inputs import folder_inputs
from agent.knowledge.folder_cards.inputs import input_hash

logger = logging.getLogger(__name__)

MONTHLY_TOKENS_ENV = "FOLDER_CARDS_MONTHLY_TOKENS"
DEFAULT_MONTHLY_TOKENS = 2_000_000
RUN_BUDGET_SECONDS = 20 * 60
RECONCILE_EVERY_SECONDS = 20 * 3600
SCORE_WRITER = "folder-card-worker"

Outcome = Literal["fresh", "unchanged", "stale", "failed", "skipped"]


Trigger = Callable[[str, str], bool]


@dataclass
class RunReport:
    outcomes: dict[str, int] = field(default_factory=dict)
    trace_id: str | None = None
    failures: list[Exception] = field(default_factory=list)

    def count(self, outcome: Outcome) -> None:
        self.outcomes[outcome] = self.outcomes.get(outcome, 0) + 1

    def fresh_share(self) -> float | None:
        fresh = self.outcomes.get("fresh", 0) + self.outcomes.get("unchanged", 0)
        due = fresh + self.outcomes.get("stale", 0) + self.outcomes.get("failed", 0)
        return fresh / due if due else None


@dataclass
class _Collection:
    organization_id: str
    rows: list[Any]
    cards: dict[str, dict[str, Any]]
    descriptions: dict[str, str] = field(default_factory=dict)
    owned: set[str] | None = None


def monthly_token_cap() -> int:
    try:
        return max(0, int(os.environ.get(MONTHLY_TOKENS_ENV, DEFAULT_MONTHLY_TOKENS)))
    except ValueError:
        return DEFAULT_MONTHLY_TOKENS


def summary_llm() -> Any | None:
    from agent.knowledge.factory import get_active_ingestor

    return getattr(get_active_ingestor(), "summary_llm", None)


def collection_rows(collection: str) -> list[Any]:
    from knowledge_layer.browse import file_rows

    from agent.knowledge import get_available_documents

    return file_rows([{**doc.model_dump(), "collection": collection} for doc in get_available_documents(collection)])


def _load(collection: str, organization_id: str) -> _Collection:
    queue.remember_collection(collection, organization_id)
    cards, descriptions, owned = client.read_collection(organization_id, collection)
    return _Collection(organization_id, collection_rows(collection), cards, descriptions, owned)


def _publish_point(collection: str, card: dict[str, Any]) -> None:
    try:
        from knowledge_layer.vector_store import embedding_text
        from knowledge_layer.vector_store import get_store
        from knowledge_layer.vector_store import upsert_folder_card

        from agent.knowledge.factory import get_active_retriever

        retriever = get_active_retriever()
        text = embedding_text(card["folder_path"], card.get("abstract"), card.get("key_facts"))
        vector = retriever.embed_query(text)
        upsert_folder_card(get_store(retriever.embedding_identity()), collection, card, vector)
    except Exception:  # noqa: BLE001 — the card is written; its point is derived
        logger.warning("folder cards: no Qdrant point for %s in %s", card.get("folder_path"), collection, exc_info=True)


def _restamp_point(collection: str, folder_path: str, status: str) -> None:
    try:
        from knowledge_layer.vector_store import get_store
        from knowledge_layer.vector_store import set_folder_card_status

        set_folder_card_status(get_store(), collection, folder_path, status)
    except Exception:  # noqa: BLE001
        logger.warning("folder cards: could not restamp the point of %s in %s", folder_path, collection, exc_info=True)


def _drop_point(collection: str, folder_path: str) -> None:
    try:
        from knowledge_layer.vector_store import delete_folder_card
        from knowledge_layer.vector_store import get_store

        delete_folder_card(get_store(), collection, folder_path)
    except Exception:  # noqa: BLE001
        logger.warning("folder cards: could not delete the point of %s in %s", folder_path, collection, exc_info=True)


def _mark_parent(folder: queue.Due, context: _Collection) -> None:
    parent = queue.parent_of(folder.folder_path)
    if parent:
        queue.mark(folder.collection, [parent], context.organization_id, with_ancestors=False)


def _restamp(folder: queue.Due, context: _Collection, existing: dict[str, Any], status: str) -> None:
    if existing.get("status") == status:
        return
    body = client.put_request(
        organization_id=context.organization_id,
        collection=folder.collection,
        folder_path=folder.folder_path,
        abstract=existing.get("abstract"),
        key_facts=existing.get("key_facts") or [],
        input_hash=existing["input_hash"],
        abstract_hash=existing.get("abstract_hash"),
        model=existing.get("model"),
        prompt_version=existing.get("prompt_version"),
        status=status,
    )
    if client.put_card(body):
        context.cards[folder.folder_path] = {**existing, "status": status}
        _restamp_point(folder.collection, folder.folder_path, status)


def _drop(folder: queue.Due, context: _Collection, existing: dict[str, Any] | None) -> Outcome:
    if existing is not None:
        client.delete_card(context.organization_id, folder.collection, folder.folder_path)
        _drop_point(folder.collection, folder.folder_path)
        queue.delete_manifest(folder.collection, folder.folder_path)
        context.cards.pop(folder.folder_path, None)
        _mark_parent(folder, context)
    return "skipped"


def _store(
    folder: queue.Due,
    context: _Collection,
    existing: dict[str, Any] | None,
    digest: str,
    draft: build.FolderCardDraft,
    model: str,
    manifest: incremental.Manifest,
) -> bool:
    body = client.put_request(
        organization_id=context.organization_id,
        collection=folder.collection,
        folder_path=folder.folder_path,
        abstract=draft.abstract,
        key_facts=[fact.wire() for fact in draft.key_facts],
        input_hash=digest,
        abstract_hash=draft.abstract_hash,
        model=model,
        prompt_version=PROMPT_VERSION,
        status="fresh",
    )
    if not client.put_card(body):
        logger.info("folder cards: %s in %s is no folder the BFF knows", folder.folder_path, folder.collection)
        return False
    queue.put_manifest(folder.collection, folder.folder_path, manifest.to_json())
    context.cards[folder.folder_path] = {**(existing or {}), **body}
    _publish_point(folder.collection, body)
    if (existing or {}).get("abstract_hash") != draft.abstract_hash:
        _mark_parent(folder, context)
    return True


def _ledger(organization_id: str):
    from agent.common.cost_tracking import USAGE_ACTIVITY_INGEST
    from agent.common.cost_tracking import BudgetSnapshot
    from agent.common.cost_tracking import track_llm_costs

    identity = {"organization_id": organization_id, "user_id": None, "project_id": None, "conversation_id": None}
    return track_llm_costs(identity=identity, budget=BudgetSnapshot(), activity=USAGE_ACTIVITY_INGEST)


def _decide(inputs: FolderInputs, existing: dict[str, Any] | None) -> tuple[Outcome | None, str]:
    if inputs.empty or inputs.tiny:
        return "skipped", ""
    digest = input_hash(inputs)
    if existing and existing.get("input_hash") == digest and existing.get("status") == "fresh":
        return "unchanged", digest
    return None, digest


def _stored_manifest(folder: queue.Due) -> incremental.Manifest | None:
    stored = queue.get_manifest(folder.collection, folder.folder_path)
    try:
        return incremental.Manifest.from_json(stored) if stored else None
    except ValueError, TypeError, AttributeError:  # unreadable: a full rebuild writes a new one
        return None


def _prune(
    folder: queue.Due,
    context: _Collection,
    existing: dict[str, Any],
    inputs: FolderInputs,
    digest: str,
    update: incremental.Plan,
) -> bool:
    facts = incremental.surviving_facts(existing.get("key_facts") or [], inputs.child_names)
    abstract = existing["abstract"]
    draft = build.FolderCardDraft(
        abstract,
        tuple(build.KeyFact(f["statement"], tuple(f["documents"]), f.get("pages")) for f in facts),
        existing.get("abstract_hash") or build.abstract_hash(abstract),
    )
    manifest = incremental.manifest_of(inputs, increments=update.increments)
    return _store(folder, context, existing, digest, draft, existing.get("model") or "", manifest)


_MIN_NAMED_STEM = 4


def names_removed(abstract: str, removed: Iterable[str]) -> bool:
    text = abstract.casefold()
    for name in removed:
        stem = name.rsplit(".", 1)[0] if "." in name else name
        if name.casefold() in text or (len(stem) >= _MIN_NAMED_STEM and stem.casefold() in text):
            return True
    return False


async def _write(
    inputs: FolderInputs, existing: dict[str, Any] | None, update: incremental.Plan, llm: Any
) -> build.Generation:
    counts = update.diff.counts()
    if update.mode != "incremental" or existing is None:
        return await build.generate(inputs, llm, mode="full", diff_counts=counts)
    kept = incremental.surviving_facts(existing.get("key_facts") or [], inputs.child_names)
    prompt = build.incremental_prompt(inputs, update.diff, existing["abstract"], kept)
    return await build.generate(inputs, llm, prompt=prompt, mode="incremental", diff_counts=counts)


async def _build(folder: queue.Due, context: _Collection, llm: Any, report: RunReport) -> Outcome:
    if context.owned is not None and folder.folder_path not in context.owned:
        return "skipped"
    inputs = folder_inputs(folder.collection, folder.folder_path, context.rows, context.cards, context.descriptions)
    existing = context.cards.get(inputs.folder_path)
    outcome, digest = _decide(inputs, existing)
    if outcome == "skipped":
        return await asyncio.to_thread(_drop, folder, context, existing)
    if outcome is not None:
        return outcome
    update = incremental.plan(existing, await asyncio.to_thread(_stored_manifest, folder), inputs)
    if update.mode == "prune" and existing is not None and names_removed(existing["abstract"], update.diff.removed):
        update = incremental.Plan("incremental", update.diff, increments=update.increments + 1, reason="named removal")
    if update.mode == "prune" and existing is not None:
        stored = await asyncio.to_thread(_prune, folder, context, existing, inputs, digest, update)
        return "fresh" if stored else "skipped"
    if await asyncio.to_thread(queue.tokens_used, context.organization_id) >= monthly_token_cap():
        logger.info("folder cards: %s is over its monthly budget", context.organization_id)
        if existing is not None:
            await asyncio.to_thread(_restamp, folder, context, existing, "stale")
        return "stale"
    with _ledger(context.organization_id):
        try:
            generation = await _write(inputs, existing, update, llm)
        except build.GenerationRejected as rejected:
            await asyncio.to_thread(queue.add_tokens, context.organization_id, rejected.tokens)
            raise
    report.trace_id = report.trace_id or generation.trace_id
    await asyncio.to_thread(queue.add_tokens, context.organization_id, generation.tokens)
    draft = build.validate(generation.reply, inputs)
    manifest = incremental.manifest_of(inputs, increments=update.increments)
    stored = await asyncio.to_thread(_store, folder, context, existing, digest, draft, generation.model, manifest)
    return "fresh" if stored else "skipped"


def _give_up(folder: queue.Due, context: _Collection) -> None:
    try:
        queue.drop(folder.collection, folder.folder_path)
        existing = context.cards.get(folder.folder_path)
        if existing is not None:
            _restamp(folder, context, existing, "failed")
    except Exception:  # noqa: BLE001
        logger.warning("folder cards: could not give a folder up", exc_info=True)


async def _settle(folder: queue.Due, context: _Collection, llm: Any, report: RunReport, final: bool) -> Outcome:
    started = time.time()
    try:
        outcome = await _build(folder, context, llm, report)
    except Exception as error:  # noqa: BLE001
        logger.warning("folder cards: %s in %s failed", folder.folder_path, folder.collection, exc_info=True)
        report.failures.append(error)
        if final:
            await asyncio.to_thread(_give_up, folder, context)
        return "failed"
    await asyncio.to_thread(queue.finish, folder.collection, folder.folder_path, started)
    return outcome


def _emit_freshness(report: RunReport) -> None:
    share = report.fresh_share()
    if share is None or not report.trace_id:
        return
    from agent.observability.langfuse_scores import RuntimeScore
    from agent.observability.langfuse_scores import emit_scores

    comment = ", ".join(f"{name} {count}" for name, count in sorted(report.outcomes.items()))
    emit_scores(
        [RuntimeScore("folder-card-fresh", share, comment=comment)], writer=SCORE_WRITER, trace_id=report.trace_id
    )


async def _next_folders(collection: str, seen: set[str]) -> list[queue.Due]:
    due = [folder for folder in await asyncio.to_thread(queue.due, collection) if folder.folder_path not in seen]
    seen.update(folder.folder_path for folder in due)
    return due


async def build_collection(
    collection: str,
    organization_id: str,
    *,
    final: bool = False,
    llm: Any | None = None,
    should_stop: Callable[[], bool] = lambda: False,
) -> RunReport:
    report = RunReport()
    llm = llm if llm is not None else summary_llm()
    if llm is None:
        logger.info("folder cards: no summary model is configured; nothing is built")
        return report
    if not await asyncio.to_thread(gate.check, organization_id):
        report.outcomes["skipped"] = await asyncio.to_thread(queue.drop, collection)
        return report
    context = await asyncio.to_thread(_load, collection, organization_id)
    deadline = time.monotonic() + RUN_BUDGET_SECONDS

    def stopped() -> bool:
        return should_stop() or time.monotonic() >= deadline

    seen: set[str] = set()
    while not stopped() and (folders := await _next_folders(collection, seen)):
        await _build_round(folders, context, llm, report, final, stopped)
    return _ended(report, final)


async def _build_round(
    folders: list[queue.Due],
    context: _Collection,
    llm: Any,
    report: RunReport,
    final: bool,
    stopped: Callable[[], bool],
) -> None:
    for folder in folders:
        if stopped():
            return
        report.count(await _settle(folder, context, llm, report, final))


def _ended(report: RunReport, final: bool) -> RunReport:
    if report.outcomes:
        logger.info("folder cards: %s", report.outcomes)
    _emit_freshness(report)
    if report.failures and not final:
        raise report.failures[0]
    return report


def sweep(trigger: Trigger) -> int:
    if summary_llm() is None:
        return 0
    from agent.knowledge.folder_cards import organization_hint

    organizations: dict[str, str | None] = {}
    for folder in queue.due():
        organizations[folder.collection] = organizations.get(folder.collection) or folder.organization_id
    started = 0
    for collection, known in organizations.items():
        organization_id = known or queue.organization_of(collection) or organization_hint(collection)
        if not organization_id:
            logger.warning("folder cards: no organization known for %s; its folders are dropped", collection)
            queue.drop(collection)
            continue
        started += bool(trigger(collection, organization_id))
    return started


def give_up_run(collection: str) -> dict[str, int]:
    deferred, dropped = queue.defer(collection)
    if dropped:
        logger.warning(
            "folder cards: %d folder(s) of %s left the dirty set after %d runs failed for good",
            dropped,
            collection,
            queue.GIVE_UP_ROUNDS,
        )
    return {"deferred": deferred, "dropped": dropped}


def _folders(rows: list[Any]) -> set[str]:
    return {path for row in rows for path in queue.ancestors(row.folder)}


def reconcile_collection(collection: str, organization_id: str) -> int:
    rows = collection_rows(collection)
    cards, descriptions, owned = client.read_collection(organization_id, collection)
    due: list[str] = []
    for path in sorted(_folders(rows) | set(cards)):
        if owned is not None and path not in owned:
            continue
        existing = cards.get(path)
        outcome, _digest = _decide(folder_inputs(collection, path, rows, cards, descriptions), existing)
        if outcome == "skipped":
            if existing is not None:
                due.append(path)
        elif outcome is None:
            due.append(path)
    queue.mark(collection, due, organization_id, with_ancestors=False)
    queue.set_reconciled(collection)
    return len(due)


async def reconcile() -> int:
    marked = 0
    for collection, organization_id in await asyncio.to_thread(
        queue.collections_due_for_reconcile, RECONCILE_EVERY_SECONDS
    ):
        try:
            if not await asyncio.to_thread(gate.check, organization_id):
                continue
            marked += await asyncio.to_thread(reconcile_collection, collection, organization_id)
        except Exception:  # noqa: BLE001 — the next night tries again
            logger.warning("folder cards: could not reconcile %s", collection, exc_info=True)
    return marked
