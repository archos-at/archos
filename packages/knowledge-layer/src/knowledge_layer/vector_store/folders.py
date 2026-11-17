from __future__ import annotations

import logging
import uuid
from collections.abc import Mapping
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from qdrant_client import models

from .prefilter import FOLDER_FIELD
from .prefilter import folder_ancestors
from .prefilter import folder_key
from .reading_office import office_for
from .schema import DENSE
from .schema import FOLDER_KIND
from .schema import KIND_FIELD
from .schema import SCOPE_FIELD
from .schema import Physical
from .schema import physical_for_scope
from .scope import ScopeRead
from .scope import scope_filter
from .store import QdrantStore
from .store import with_retry

logger = logging.getLogger(__name__)

_FOLDER_NAMESPACE = uuid.UUID("0f6a3c52-7d1e-4b8a-9c2f-5e4d3b2a1f09")

FOLDER_HITS = 3
_FACTS_EMBEDDED = 8
_HIT_FIELDS = ["folder_path", "abstract", "status"]


def folder_point_id(scope: str, folder_path: str) -> str:
    key = folder_key(folder_path)
    if key is None:
        raise ValueError("The root has no folder card")
    return str(uuid.uuid5(_FOLDER_NAMESPACE, f"{scope}\x00{key}"))


def _facts(key_facts: Any) -> list[str]:
    statements = []
    for fact in list(key_facts or [])[:_FACTS_EMBEDDED]:
        statement = fact.get("statement") if isinstance(fact, Mapping) else fact
        statement = " ".join(str(statement or "").split())
        if statement:
            statements.append(statement)
    return statements


def embedding_text(folder_path: str, abstract: str | None, key_facts: Any = ()) -> str:
    lines = [f"Ordner: {folder_path.strip('/')}"]
    abstract = " ".join(str(abstract or "").split())
    if abstract:
        lines.append(abstract)
    lines.extend(f"- {statement}" for statement in _facts(key_facts))
    return "\n".join(lines)


def folder_payload(scope: str, card: Mapping[str, Any]) -> dict[str, Any]:
    folder_path = str(card["folder_path"]).strip("/")
    return {
        SCOPE_FIELD: scope,
        KIND_FIELD: FOLDER_KIND,
        "folder_path": folder_path,
        FOLDER_FIELD: folder_ancestors(folder_path),
        "abstract": " ".join(str(card.get("abstract") or "").split()),
        "key_facts": [dict(fact) for fact in card.get("key_facts") or [] if isinstance(fact, Mapping)],
        "status": str(card.get("status") or "fresh"),
        "abstract_hash": card.get("abstract_hash"),
    }


def upsert_folder_card(store: QdrantStore, scope: str, card: Mapping[str, Any], vector: Sequence[float]) -> str:
    if physical_for_scope(scope) is not Physical.OFFICE:
        raise ValueError(f"A folder card belongs to an office scope, not {scope!r}")
    payload = folder_payload(scope, card)
    point = models.PointStruct(
        id=folder_point_id(scope, payload["folder_path"]),
        vector={DENSE: [float(value) for value in vector]},
        payload=payload,
    )
    alias = store.ensure(scope, len(point.vector[DENSE]))
    with_retry(f"upsert folder card in {scope}", lambda: store.client.upsert(alias, [point], wait=True))
    return str(point.id)


def _the_point(scope: str, folder_path: str) -> models.Filter:
    return scope_filter(
        [scope], None, models.HasIdCondition(has_id=[folder_point_id(scope, folder_path)]), kind="folder"
    )


def delete_folder_card(store: QdrantStore, scope: str, folder_path: str) -> None:
    if not store.exists(scope):
        return
    selector = models.FilterSelector(filter=_the_point(scope, folder_path))
    with_retry(
        f"delete folder card in {scope}",
        lambda: store.client.delete(store.alias(scope), points_selector=selector, wait=True),
    )


def set_folder_card_status(store: QdrantStore, scope: str, folder_path: str, status: str) -> None:
    if not store.exists(scope):
        return
    with_retry(
        f"set folder card status in {scope}",
        lambda: store.client.set_payload(
            store.alias(scope), payload={"status": status}, points=_the_point(scope, folder_path), wait=True
        ),
    )


def folder_cards(store: QdrantStore, scopes: Sequence[str]) -> list[dict[str, Any]]:
    found: list[dict[str, Any]] = []
    for scope in dict.fromkeys(scopes):
        if not store.exists(scope):
            continue
        offset: Any = None
        while True:
            page, offset = store.client.scroll(
                store.alias(scope),
                scroll_filter=scope_filter([scope], None, kind="folder"),
                limit=256,
                offset=offset,
                with_payload=True,
                with_vectors=False,
            )
            found.extend(dict(record.payload or {}) for record in page)
            if offset is None:
                break
    return found


@dataclass(frozen=True)
class FolderHit:
    scope: str
    folder_path: str
    abstract: str
    status: str
    score: float


def search_folders(
    store: QdrantStore,
    scopes: Sequence[str],
    vector: Sequence[float],
    *,
    folder: str | None = None,
    limit: int = FOLDER_HITS,
) -> list[FolderHit]:
    office = [scope for scope in dict.fromkeys(scopes) if physical_for_scope(scope) is Physical.OFFICE]
    if limit <= 0 or not office or not store.exists(office[0]):
        return []
    extra: list[Any] = []
    key = folder_key(folder)
    if key:
        extra.append(models.FieldCondition(key=FOLDER_FIELD, match=models.MatchValue(value=key)))
    result = store.client.query_points(
        store.alias(office[0]),
        query=list(vector),
        using=DENSE,
        query_filter=ScopeRead(tuple(office), office_for(office)).filter(None, *extra, kind="folder"),
        limit=limit + (1 if key else 0),
        with_payload=[SCOPE_FIELD, *_HIT_FIELDS],
    )
    hits = []
    for point in result.points:
        payload = point.payload or {}
        path = str(payload.get("folder_path") or "")
        if not path or (key and folder_key(path) == key):
            continue
        hits.append(
            FolderHit(
                scope=str(payload.get(SCOPE_FIELD) or ""),
                folder_path=path,
                abstract=str(payload.get("abstract") or ""),
                status=str(payload.get("status") or "fresh"),
                score=float(point.score),
            )
        )
    return hits[:limit]


_ABSTRACT_CHARS = 280


def render_folder_hits(hits: Sequence[FolderHit], query_hint: str = "…") -> str:
    if not hits:
        return ""
    lines = ["## Folders that match"]
    for hit in hits:
        abstract = hit.abstract if len(hit.abstract) <= _ABSTRACT_CHARS else hit.abstract[: _ABSTRACT_CHARS - 1] + "…"
        stale = " (card may be out of date)" if hit.status != "fresh" else ""
        lines.append(f"Folder: {hit.folder_path} — {abstract or 'no abstract'}{stale}")
    lines.append(
        f"A folder is a pointer, not a source: list {hits[0].folder_path} or search inside it "
        f'("{query_hint}"), and cite the documents you read there.'
    )
    return "\n".join(lines)
