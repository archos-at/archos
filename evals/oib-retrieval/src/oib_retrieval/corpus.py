from __future__ import annotations

import functools
import hashlib
import json
import logging
import os
from dataclasses import asdict
from dataclasses import dataclass
from dataclasses import field
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

CHUNK_SIZE = 1024
CHUNK_OVERLAP = 128

ARM_PAGE = "page"
ARM_CLAUSE = "punkt"
ARMS = (ARM_PAGE, ARM_CLAUSE)

PAGE_SHAPE_VERSION = 2


@dataclass(frozen=True)
class Chunk:
    chunk_id: str
    text: str
    file_name: str
    page: int
    arm: str
    metadata: dict[str, Any] = field(default_factory=dict, compare=False)

    @property
    def unit(self) -> tuple[str, int]:
        return (self.file_name, self.page)


def repo_root() -> Path:
    return Path(__file__).resolve().parents[4]


def package_root() -> Path:
    return Path(__file__).resolve().parents[2]


class CorpusMissingError(RuntimeError): ...


def default_corpus_dir() -> Path:
    return repo_root() / "data" / "oib"


def default_cache_dir() -> Path:
    return package_root() / ".cache" / "pages"


def _cache_key(pdf_path: Path) -> str:
    try:
        stat = pdf_path.stat()
        identity = f"{pdf_path.name}:{stat.st_size}:{int(stat.st_mtime)}"
    except OSError:
        identity = f"{pdf_path.name}:absent"
    identity = f"v{PAGE_SHAPE_VERSION}:{identity}"
    digest = hashlib.sha256(identity.encode()).hexdigest()[:16]
    return f"{pdf_path.stem}.{digest}.json"


def extract_pages(pdf_path: Path, cache_dir: Path | None = None) -> list[dict[str, Any]]:
    cache_dir = default_cache_dir() if cache_dir is None else cache_dir
    cache_path = cache_dir / _cache_key(pdf_path)
    if cache_path.exists():
        with open(cache_path, encoding="utf-8") as handle:
            return _pages_from_json(json.load(handle))

    from knowledge_layer.ingest import _extract_text_from_pdf

    pages = _extract_text_from_pdf(str(pdf_path))
    cache_dir.mkdir(parents=True, exist_ok=True)
    partial = cache_path.with_name(f"{cache_path.name}.{os.getpid()}.tmp")
    try:
        with open(partial, "w", encoding="utf-8") as handle:
            json.dump(_pages_to_json(pages), handle, ensure_ascii=False)
        os.replace(partial, cache_path)
    finally:
        partial.unlink(missing_ok=True)
    return pages


def _pages_to_json(pages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [{**page, "tables": [asdict(table) for table in page.get("tables") or []]} for page in pages]


def _pages_from_json(pages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    from knowledge_layer.ingest import PageTable

    return [
        {
            **page,
            "tables": [PageTable(**table) for table in page.get("tables") or []],
            "table_boxes": [tuple(box) for box in page.get("table_boxes") or []],
        }
        for page in pages
    ]


def _splitter():
    from llama_index.core.node_parser import SentenceSplitter

    return SentenceSplitter(chunk_size=CHUNK_SIZE, chunk_overlap=CHUNK_OVERLAP)


def page_documents(pages: list[dict[str, Any]], file_name: str, file_size: int) -> list[Any]:
    from knowledge_layer.ingest import page_text_with_tables
    from llama_index.core import Document

    return [
        Document(
            text=page_text_with_tables(page["text"], page.get("tables") or []),
            metadata={
                "file_name": file_name,
                "file_size": file_size,
                "page_label": str(page["page_number"]),
                "content_type": "text",
            },
        )
        for page in pages
    ]


def clause_or_page_documents(pages: list[dict[str, Any]], file_name: str, file_size: int) -> list[Any]:
    from knowledge_layer.ingest import clause_documents

    documents = clause_documents(pages, file_name, file_size)
    if documents is None:
        return page_documents(pages, file_name, file_size)
    return documents


def _chunks_from_documents(documents: list[Any], file_name: str, arm: str) -> list[Chunk]:
    nodes = _splitter().get_nodes_from_documents(documents)
    chunks: list[Chunk] = []
    for position, node in enumerate(nodes):
        metadata = dict(node.metadata or {})
        page_label = metadata.get("page_label")
        try:
            page = int(str(page_label))
        except TypeError, ValueError:
            logger.debug("Skipping chunk with unusable page_label %r in %s", page_label, file_name)
            continue
        chunks.append(
            Chunk(
                chunk_id=f"{arm}:{file_name}:{position}",
                text=node.get_content(),
                file_name=file_name,
                page=page,
                arm=arm,
                metadata=metadata,
            )
        )
    return chunks


def build_arm(arm: str, corpus_dir: Path | None = None, cache_dir: Path | None = None) -> list[Chunk]:
    if arm not in ARMS:
        raise ValueError(f"unknown arm {arm!r}; expected one of {ARMS}")
    corpus_dir = default_corpus_dir() if corpus_dir is None else corpus_dir
    builder = page_documents if arm == ARM_PAGE else clause_or_page_documents

    chunks: list[Chunk] = []
    for pdf_path in sorted(corpus_dir.glob("*.pdf")):
        pages = extract_pages(pdf_path, cache_dir=cache_dir)
        if not pages:
            logger.warning("No extractable text in %s", pdf_path.name)
            continue
        documents = builder(pages, pdf_path.name, pdf_path.stat().st_size)
        chunks.extend(_chunks_from_documents(documents, pdf_path.name, arm))
    return chunks


@dataclass(frozen=True)
class ProductionRetrievalSettings:
    top_k: int
    max_chunks_per_document: int
    exclude_file_names: frozenset[str]


def _knowledge_retrieval_node(payload: Any) -> dict[str, Any] | None:
    if isinstance(payload, dict):
        if payload.get("_type") == "knowledge_retrieval":
            return payload
        for value in payload.values():
            found = _knowledge_retrieval_node(value)
            if found is not None:
                return found
    elif isinstance(payload, list):
        for value in payload:
            found = _knowledge_retrieval_node(value)
            if found is not None:
                return found
    return None


def _load_config(config_path: Path) -> Any:
    return _parse_config(str(config_path), config_path.stat().st_mtime_ns)


@functools.lru_cache(maxsize=8)
def _parse_config(path: str, _mtime_ns: int) -> Any:
    import yaml

    with open(path, encoding="utf-8") as handle:
        return yaml.safe_load(handle)


def production_retrieval_settings(config_path: Path | None = None) -> ProductionRetrievalSettings:
    config_path = repo_root() / "configs" / "config_oib_openrouter.yml" if config_path is None else config_path
    if not config_path.exists():
        logger.warning("Production OIB config not found at %s; using field defaults", config_path)
        return ProductionRetrievalSettings(top_k=5, max_chunks_per_document=2, exclude_file_names=frozenset())
    payload = _load_config(config_path)
    node = _knowledge_retrieval_node(payload) or {}
    return ProductionRetrievalSettings(
        top_k=int(node.get("top_k", 5)),
        max_chunks_per_document=int(node.get("max_chunks_per_document", 2)),
        exclude_file_names=frozenset(node.get("exclude_file_names") or ()),
    )


def production_excluded_file_names(config_path: Path | None = None) -> frozenset[str]:
    config_path = repo_root() / "configs" / "config_oib_openrouter.yml" if config_path is None else config_path
    if not config_path.exists():
        logger.warning("Production OIB config not found at %s; measuring the unfiltered index", config_path)
        return frozenset()
    payload = _load_config(config_path)

    def walk(node: Any):
        if isinstance(node, dict):
            if "exclude_file_names" in node:
                yield from node["exclude_file_names"] or ()
            for value in node.values():
                yield from walk(value)
        elif isinstance(node, list):
            for value in node:
                yield from walk(value)

    return frozenset(walk(payload))


def dedupe_to_units(chunks: list[Chunk], limit: int | None = None) -> list[tuple[str, int]]:
    units: list[tuple[str, int]] = []
    seen: set[tuple[str, int]] = set()
    for chunk in chunks:
        unit = chunk.unit
        if unit in seen:
            continue
        seen.add(unit)
        units.append(unit)
        if limit is not None and len(units) >= limit:
            break
    return units
