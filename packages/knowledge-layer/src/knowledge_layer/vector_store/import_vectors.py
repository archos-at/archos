from __future__ import annotations

import base64
import datetime as dt
import gzip
import hashlib
import json
import logging
import random
import re
import sys
import time
from array import array
from collections.abc import Iterable
from collections.abc import Iterator
from collections.abc import Mapping
from dataclasses import dataclass
from dataclasses import field
from pathlib import Path
from typing import Any

from qdrant_client import models

from agent.common.source_kinds import office_shelf_organization_id

from .payload import ChunkRecord
from .payload import document_facts
from .schema import ALIASES
from .schema import CHUNK_ID_FIELD
from .schema import EMBED_IDENTITY_KEYS
from .schema import INDEXED_AT_FIELD
from .schema import Physical
from .schema import current_metadata
from .schema import physical_for_scope
from .schema import with_legacy_keys
from .store import QdrantStore

logger = logging.getLogger(__name__)

FORMAT = "piloti-vectors/1"
MANIFEST = "manifest.json"
COLLECTION_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{1,510}[A-Za-z0-9]$")
_DIGEST_PREFIX = "sha256-sum:"

VERIFY_FULL_LIMIT = 200_000
VERIFY_SAMPLE = 4096
PRUNE_BATCH = 512
IMPORT_MARKER_KEY = "vector_import"


class InvalidExport(ValueError): ...


def add_to_digest(digest: int, chunk_id: str) -> int:
    return (digest + int.from_bytes(hashlib.sha256(chunk_id.encode("utf-8")).digest(), "big")) % (1 << 256)


def format_digest(digest: int) -> str:
    return f"{_DIGEST_PREFIX}{digest:064x}"


def id_digest(chunk_ids: Iterable[str]) -> str:
    digest = 0
    for chunk_id in chunk_ids:
        digest = add_to_digest(digest, chunk_id)
    return format_digest(digest)


def decode_embedding(encoded: str, dimension: int | None) -> list[float]:
    raw = base64.b64decode(encoded, validate=True)
    if len(raw) % 4 or (dimension is not None and len(raw) != dimension * 4):
        raise InvalidExport(f"an embedding of {len(raw)} bytes is not {dimension} float32 values")
    values = array("f")
    values.frombytes(raw)
    if sys.byteorder == "big":
        values.byteswap()
    return values.tolist()


@dataclass(frozen=True)
class CollectionEntry:
    name: str
    count: int
    dimension: int | None
    batches: int
    id_digest: str
    metadata: dict[str, Any] = field(default_factory=dict)

    def identity(self, fallback: Mapping[str, str] | None) -> dict[str, str]:
        fingerprint_key, model_key = EMBED_IDENTITY_KEYS
        metadata = current_metadata(self.metadata)
        fingerprint = metadata.get(fingerprint_key)
        if fingerprint:
            return {fingerprint_key: str(fingerprint), model_key: str(metadata.get(model_key) or "unknown")}
        return dict(fallback or {})

    @property
    def has_identity(self) -> bool:
        return bool(current_metadata(self.metadata).get(EMBED_IDENTITY_KEYS[0]))


def _entry(name: str, raw: Any) -> CollectionEntry:
    if not COLLECTION_NAME.match(name):
        raise InvalidExport(f"{name!r} is not a collection name")
    if not isinstance(raw, Mapping):
        raise InvalidExport(f"collection {name}: the manifest entry is not an object")
    try:
        count, batches, digest = int(raw["count"]), int(raw["batches"]), str(raw["id_digest"])
    except (KeyError, TypeError, ValueError) as exc:
        raise InvalidExport(f"collection {name}: the manifest entry lacks count, batches or id_digest") from exc
    if not digest.startswith(_DIGEST_PREFIX):
        raise InvalidExport(f"collection {name}: id_digest {digest!r} is not {_DIGEST_PREFIX}<hex>")
    dimension = raw.get("dimension")
    metadata = raw.get("metadata") or {}
    if not isinstance(metadata, Mapping):
        raise InvalidExport(f"collection {name}: metadata is not an object")
    return CollectionEntry(
        name, count, int(dimension) if dimension is not None else None, batches, digest, dict(metadata)
    )


@dataclass(frozen=True)
class Export:
    root: Path
    chroma_version: str
    created_at: str
    collections: dict[str, CollectionEntry]

    @classmethod
    def open(cls, root: str | Path) -> Export:
        root = Path(root)
        try:
            manifest = json.loads((root / MANIFEST).read_text(encoding="utf-8"))
        except FileNotFoundError as exc:
            raise InvalidExport(f"{root} has no {MANIFEST}: the export is missing or did not finish") from exc
        except (OSError, ValueError) as exc:
            raise InvalidExport(f"{root / MANIFEST} is not readable JSON: {exc}") from exc
        if not isinstance(manifest, Mapping) or manifest.get("format") != FORMAT:
            found = manifest.get("format") if isinstance(manifest, Mapping) else None
            raise InvalidExport(f"{root / MANIFEST} is format {found!r}, this importer reads {FORMAT!r}")
        raw_collections = manifest.get("collections")
        if not isinstance(raw_collections, Mapping):
            raise InvalidExport(f"{root / MANIFEST} lists no collections")
        export = cls(
            root,
            str(manifest.get("chroma_version") or ""),
            str(manifest.get("created_at") or ""),
            {name: _entry(name, raw) for name, raw in raw_collections.items()},
        )
        for name in export.collections:
            export.batch_paths(name)
        return export

    def batch_paths(self, name: str) -> list[Path]:
        entry = self.collections[name]
        directory = self.root / "collections" / name
        paths = [directory / f"{seq:06d}.jsonl.gz" for seq in range(entry.batches)]
        missing = [path.name for path in paths if not path.is_file()]
        if missing:
            raise InvalidExport(f"collection {name}: batch file(s) missing: {', '.join(missing[:5])}")
        return paths

    def batches(self, name: str) -> Iterator[list[ChunkRecord]]:
        entry = self.collections[name]
        digest, read = 0, 0
        for path in self.batch_paths(name):
            records = [_record(entry, path, line) for line in _lines(path)]
            for record in records:
                digest = add_to_digest(digest, record.chunk_id)
            read += len(records)
            yield records
        if read != entry.count or format_digest(digest) != entry.id_digest:
            raise InvalidExport(
                f"collection {name}: read {read} records of {entry.count}, or ids that do not match the "
                "manifest's id_digest: the export was altered or cut short"
            )

    def id_set(self, name: str) -> set[str]:
        return {record.chunk_id for batch in self.batches(name) for record in batch}

    def ids_by_file(self, name: str) -> dict[str, set[str]]:
        by_file: dict[str, set[str]] = {}
        for path in self.batch_paths(name):
            for line in _lines(path):
                raw = json.loads(line)
                file_name = str((raw.get("metadata") or {}).get("file_name") or "")
                by_file.setdefault(file_name, set()).add(str(raw["id"]))
        return by_file

    @property
    def created_epoch(self) -> int | None:
        try:
            created = dt.datetime.fromisoformat(self.created_at)
        except ValueError:
            return None
        return int(created.replace(tzinfo=created.tzinfo or dt.UTC).timestamp())


def _lines(path: Path) -> Iterator[str]:
    try:
        with gzip.open(path, "rt", encoding="utf-8") as handle:
            for line in handle:
                if line.strip():
                    yield line
    except (OSError, EOFError) as exc:
        raise InvalidExport(f"{path}: not a readable gzip file: {exc}") from exc


def _record(entry: CollectionEntry, path: Path, line: str) -> ChunkRecord:
    try:
        raw = json.loads(line)
        chunk_id = str(raw["id"])
        embedding = decode_embedding(raw["embedding"], entry.dimension)
    except (ValueError, KeyError, TypeError) as exc:
        raise InvalidExport(f"{path}: a record is not {{id, embedding, document, metadata}}: {exc}") from exc
    metadata = raw.get("metadata") or {}
    if not isinstance(metadata, Mapping):
        raise InvalidExport(f"{path}: chunk {chunk_id} has metadata that is not an object")
    return ChunkRecord(chunk_id, str(raw.get("document") or ""), embedding, dict(metadata))


def facts_by_file(scope: str) -> dict[str, dict[str, Any]]:
    from agent.knowledge import get_available_documents

    return {document.file_name: document_facts(document) for document in get_available_documents(scope)}


def scope_enrichment(scope: str) -> dict[str, Any]:
    base: dict[str, Any] = {INDEXED_AT_FIELD: int(time.time())}
    office_id = office_shelf_organization_id(scope)
    if office_id:
        base["office_id"] = office_id
    return base


def apply_facts(scope: str, store: QdrantStore, facts: Mapping[str, Mapping[str, Any]]) -> None:
    store.set_file_payloads(scope, facts)
    store.restore_chunk_doc_classes(scope, [name for name, values in facts.items() if "doc_class" not in values])


@dataclass
class ScopeReport:
    scope: str
    read: int = 0
    written: int = 0
    pruned: int = 0
    export_count: int | None = None
    qdrant_count: int | None = None
    missing: int = 0
    extra: int = 0
    sampled: bool = False

    @property
    def in_step(self) -> bool:
        return (
            self.export_count is not None
            and self.export_count == self.qdrant_count
            and self.missing == 0
            and self.extra == 0
        )


def identity_refusals(
    store: QdrantStore, export: Export, names: Iterable[str], fallback: Mapping[str, str] | None
) -> dict[str, str]:
    refusals: dict[str, str] = {}
    claimed: dict[Physical, tuple[str, str]] = {}
    for name in names:
        identity = export.collections[name].identity(fallback)
        fingerprint = identity.get(EMBED_IDENTITY_KEYS[0])
        if not fingerprint:
            refusals[name] = "the export names no embedder for it and none is configured"
            continue
        physical = physical_for_scope(name)
        first = claimed.setdefault(physical, (name, fingerprint))
        if first[1] != fingerprint:
            refusals[name] = f"its embedder differs from {first[0]}'s, and both land in {ALIASES[physical]}"
            continue
        try:
            QdrantStore(store.client, identity).check_identity(name)
        except RuntimeError as exc:
            refusals[name] = str(exc)
    return refusals


def ingested_since_export(export: Export, name: str, store: QdrantStore) -> dict[str, set[str]]:
    since = export.created_epoch
    if since is None:
        return {}
    recent: dict[str, set[str]] = {}
    newer_than_export = models.FieldCondition(key=INDEXED_AT_FIELD, range=models.Range(gt=since))
    for point in store.scroll(name, None, newer_than_export, fields=[CHUNK_ID_FIELD, "file_name"]):
        payload = point.payload or {}
        recent.setdefault(str(payload.get("file_name") or ""), set()).add(str(payload.get(CHUNK_ID_FIELD) or point.id))
    if not recent:
        return {}
    exported = export.ids_by_file(name)
    newer = {file_name: ids - exported[file_name] for file_name, ids in recent.items() if file_name in exported}
    return {file_name: ids for file_name, ids in newer.items() if ids}


def expected_ids(export: Export, name: str, ids: set[str], newer: Mapping[str, set[str]]) -> set[str]:
    if not newer:
        return ids
    by_file = export.ids_by_file(name)
    left_out = set().union(*(by_file.get(file_name, set()) for file_name in newer))
    return (ids - left_out) | set().union(*newer.values())


def import_scope(
    export: Export, name: str, store: QdrantStore, *, dry_run: bool = False
) -> tuple[ScopeReport, set[str]]:
    report = ScopeReport(name)
    newer = ingested_since_export(export, name, store)
    for file_name in sorted(newer):
        logger.warning("%s: %s was ingested again after the export; its exported chunks are left out", name, file_name)
    facts = {} if dry_run else facts_by_file(name)
    base = scope_enrichment(name)
    ids: set[str] = set()
    ordinals: dict[str, int] = {}
    for records in export.batches(name):
        report.read += len(records)
        ids.update(record.chunk_id for record in records)
        by_file: dict[str, list[ChunkRecord]] = {}
        for record in records:
            file_name = str(record.metadata.get("file_name") or "")
            record.ordinal = ordinals.get(file_name, 0)
            ordinals[file_name] = record.ordinal + 1
            by_file.setdefault(file_name, []).append(record)
        for file_name, file_records in by_file.items():
            if file_name in newer:
                continue
            if dry_run:
                report.written += len(file_records)
                continue
            report.written += store.upsert(name, file_records, {**base, **facts.get(file_name, {})}, insert_only=True)
    if not dry_run:
        apply_facts(name, store, facts_by_file(name))
    return report, expected_ids(export, name, ids, newer)


def prune_scope(export_ids: set[str], name: str, store: QdrantStore, *, dry_run: bool = False) -> int:
    stale = [chunk_id for chunk_id in store.chunk_ids(name) if chunk_id not in export_ids]
    if stale and not dry_run:
        for start in range(0, len(stale), PRUNE_BATCH):
            store.delete_chunks(name, stale[start : start + PRUNE_BATCH])
    return len(stale)


@dataclass
class Verification:
    export_count: int
    qdrant_count: int
    missing: int
    extra: int
    sampled: bool = False


def verify_scope(
    export_ids: set[str],
    name: str,
    store: QdrantStore,
    *,
    full_limit: int = VERIFY_FULL_LIMIT,
    sample: int = VERIFY_SAMPLE,
) -> Verification:
    export_count, qdrant_count = len(export_ids), store.count(name)
    if max(export_count, qdrant_count) <= full_limit:
        qdrant_ids = set(store.chunk_ids(name))
        return Verification(export_count, qdrant_count, len(export_ids - qdrant_ids), len(qdrant_ids - export_ids))
    export_sample = random.sample(sorted(export_ids), min(sample, export_count))
    missing = len(store.missing_chunk_ids(name, export_sample))
    qdrant_sample = store.sample_chunk_ids(name, sample)
    extra = sum(1 for chunk_id in qdrant_sample if chunk_id not in export_ids)
    return Verification(export_count, qdrant_count, missing, extra, sampled=True)


def orphan_scopes(export_names: Iterable[str], qdrant_held: Iterable[str]) -> list[str]:
    known = set(export_names)
    return sorted(scope for scope in set(qdrant_held) if scope not in known)


def qdrant_scopes(store: QdrantStore) -> list[str]:
    return [scope for physical in Physical for scope in store.scopes(physical)]


def _physical_collections(store: QdrantStore) -> list[str]:
    present = {alias.alias_name for alias in store.client.get_aliases().aliases}
    return [ALIASES[physical] for physical in Physical if ALIASES[physical] in present]


def recorded_import(store: QdrantStore) -> str | None:
    for alias in _physical_collections(store):
        marker = current_metadata(store.client.get_collection(alias).config.metadata).get(IMPORT_MARKER_KEY)
        if marker:
            return str(marker)
    return None


def record_import(store: QdrantStore, export: Export) -> None:
    verified = dt.datetime.now(dt.UTC).isoformat(timespec="seconds")
    marker = f"export of {export.created_at or 'unknown'} verified {verified}"
    for alias in _physical_collections(store):
        store.client.update_collection(alias, metadata=with_legacy_keys({IMPORT_MARKER_KEY: marker}))
