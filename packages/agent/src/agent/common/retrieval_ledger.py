from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from agent.common.tool_calls import LOCATOR_TOOL_BASENAMES
from agent.common.tool_calls import tool_fetches_evidence


def _lane_doc_key(name: str) -> str:
    return (name or "").strip().casefold()


def _hits_by_round(lane_hits: Sequence[dict[str, Any]]) -> dict[int, list[dict[str, Any]]]:
    buckets: dict[int, list[dict[str, Any]]] = {}
    current: int | None = None
    for hit in lane_hits:
        if not isinstance(hit, dict):
            continue
        round_index = hit.get("round")
        if isinstance(round_index, int):
            current = round_index
        elif current is None:
            continue
        else:
            round_index = current
        buckets.setdefault(round_index, []).append(hit)
    return buckets


def _docs_for_round(hits: Sequence[dict[str, Any]]) -> list[dict[str, Any]]:
    docs: list[dict[str, Any]] = []
    signatures: set[tuple[str, str]] = set()
    for hit in hits:
        name = str(hit.get("name") or "").strip()
        if not name:
            continue
        detail = str(hit.get("detail") or "").strip()
        signature = (_lane_doc_key(name), detail.casefold())
        if signature in signatures:
            continue
        signatures.add(signature)
        doc: dict[str, Any] = {"name": name}
        for field in ("title", "detail", "shelf"):
            value = hit.get(field)
            if isinstance(value, str) and value.strip():
                doc[field] = value.strip()
        docs.append(doc)
    return docs


def _locus_key(doc: dict[str, Any]) -> tuple[str, str]:
    return (_lane_doc_key(doc["name"]), str(doc.get("detail") or "").strip().casefold())


def _opened_documents(announced: dict[str, Any], hits: Sequence[dict[str, Any]]) -> set[str]:
    stamped = [hit for hit in hits if isinstance(hit.get("tool"), str) and hit["tool"].strip()]
    if stamped:
        opened = {_lane_doc_key(str(hit.get("name") or "")) for hit in stamped if hit["tool"] in LOCATOR_TOOL_BASENAMES}
        return opened - {""}
    fetchers = [str(tool) for tool in (announced.get("tools") or []) if tool_fetches_evidence(str(tool))]
    if not fetchers or any(tool not in LOCATOR_TOOL_BASENAMES for tool in fetchers):
        return set()
    return {_lane_doc_key(str(hit.get("name") or "")) for hit in hits} - {""}


def _with_repeat_marks(
    docs: Sequence[dict[str, Any]],
    seen_loci: set[tuple[str, str]],
    opened_docs: set[str],
) -> list[dict[str, Any]]:
    return [
        {
            **doc,
            "repeat": _lane_doc_key(doc["name"]) in opened_docs or _locus_key(doc) in seen_loci,
        }
        for doc in docs
    ]


def _new_documents(docs: Sequence[dict[str, Any]]) -> list[str]:
    fresh: dict[str, str] = {}
    for doc in docs:
        if doc["repeat"]:
            continue
        fresh.setdefault(_lane_doc_key(doc["name"]), doc["name"])
    return list(fresh.values())


def _round_entry(
    announced: dict[str, Any],
    docs: list[dict[str, Any]],
    seen_loci: set[tuple[str, str]],
    opened_docs: set[str],
) -> dict[str, Any]:
    marked = _with_repeat_marks(docs, seen_loci, opened_docs)
    new_docs = _new_documents(marked)
    entry: dict[str, Any] = {
        "index": announced.get("index"),
        "key": announced.get("key"),
        "tools": list(announced.get("tools") or []),
        "corpora": list(announced.get("corpora") or []),
        "docs": marked,
        "new_docs": new_docs,
        "hits": len(marked),
        "documents": len({_lane_doc_key(doc["name"]) for doc in marked}),
    }
    if announced.get("query"):
        entry["query"] = announced["query"]
    if announced.get("reason"):
        entry["reason"] = announced["reason"]
    return entry


def build_retrieval_ledger(
    announcements: Sequence[dict[str, Any]] | None,
    lane_hits: Sequence[dict[str, Any]] | None,
) -> list[dict[str, Any]] | None:
    rounds = [a for a in (announcements or []) if isinstance(a, dict)]
    if not rounds:
        return None
    hits_by_round = _hits_by_round(lane_hits or [])
    seen_loci: set[tuple[str, str]] = set()
    opened_docs: set[str] = set()
    entries: list[dict[str, Any]] = []
    for announced in rounds:
        hits = hits_by_round.get(announced.get("index"), [])
        docs = _docs_for_round(hits)
        entries.append(_round_entry(announced, docs, seen_loci, opened_docs))
        opened_docs.update(_opened_documents(announced, hits))
        seen_loci.update(_locus_key(doc) for doc in docs)
    return entries
