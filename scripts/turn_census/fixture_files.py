from __future__ import annotations

import hashlib
import json
import os
import sys
import uuid
from dataclasses import dataclass
from dataclasses import field
from pathlib import Path
from typing import Any

import yaml
from fixture_bff import ROOT

if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.intake_eval.fixture import FixtureFile  # noqa: E402  (the intake fixture's own record)
from scripts.intake_eval.fixture import load_fixture  # noqa: E402

PROJECT = ROOT / "tests" / "fixtures" / "files_eval" / "project.yaml"
ORGANIZATION_ID = "org-files-eval"
USER_ID = "user-files-eval"
PROJECT_ID = "project-files-eval"


@dataclass(frozen=True)
class FilesProject:
    collection: str
    description: str
    files: tuple[FixtureFile, ...]
    tags: dict[str, list[str]]
    markdown: frozenset[str] = frozenset()
    mail_threads: dict[str, dict[str, Any]] = field(default_factory=dict)
    mail_origins: dict[str, dict[str, Any]] = field(default_factory=dict)
    chunking: str = "page"

    @property
    def names(self) -> list[str]:
        return [file.name for file in self.files]


def load_project(path: Path = PROJECT) -> FilesProject:
    raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    base = load_fixture((path.parent / raw["extends"]).resolve())
    refile: dict[str, str] = raw.get("refile") or {}
    unknown = sorted(set(refile) - set(base.names))
    if unknown:
        raise ValueError(f"refile names files the base does not hold: {', '.join(unknown)}")
    files = [
        FixtureFile(f.name, refile.get(f.name, f.folder), f.added_at, f.revision_facts, f.pages) for f in base.files
    ]
    tags: dict[str, list[str]] = {}
    markdown: set[str] = set()
    threads: dict[str, dict[str, Any]] = {}
    origins: dict[str, dict[str, Any]] = {}
    for item in raw.get("files") or []:
        name = item["name"]
        if item.get("markdown"):
            pages: tuple[str, ...] = ((path.parent / item["markdown"]).read_text(encoding="utf-8"),)
            markdown.add(name)
        else:
            pages = tuple(page.strip() for page in item["pages"])
        files.append(
            FixtureFile(
                name=name,
                folder=item.get("folder") or "",
                added_at=item.get("added_at"),
                revision_facts=item.get("revision_facts"),
                pages=pages,
            )
        )
        tags[name] = list(item.get("tags") or [])
        if item.get("mail_facts"):
            facts = json.loads((path.parent / item["mail_facts"]).read_text(encoding="utf-8"))
            if item.get("markdown"):
                threads[name] = facts["mail_thread"]
            elif name in facts.get("mail_origins", {}):
                origins[name] = facts["mail_origins"][name]
            else:
                raise ValueError(f"{item['mail_facts']} names no mail origin for {name}")
    project = raw["project"]
    return FilesProject(
        project["collection"],
        project["description"],
        tuple(files),
        tags,
        frozenset(markdown),
        threads,
        origins,
        chunking="ingest",
    )


def document_id(project: FilesProject, name: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"files-eval/{project.collection}/{name}"))


def content_hash(file: FixtureFile) -> str:
    return hashlib.sha256("\n\f\n".join(file.pages).encode("utf-8")).hexdigest()[:16]


def chunk_specs(project: FilesProject, file: FixtureFile) -> list[dict[str, Any]]:
    if file.name in project.markdown:
        return markdown_chunk_specs(project, file)
    digest = content_hash(file)
    if project.chunking == "ingest":
        return _ingested_specs(project, file, digest)
    return [
        {
            "chunk_id": str(uuid.uuid5(uuid.NAMESPACE_URL, f"{project.collection}/{file.name}/{number}/{digest}")),
            "text": text,
            "embed_text": text,
            "ordinal": number - 1,
            "metadata": {
                "file_name": file.name,
                "page_label": str(number),
                "content_type": "text",
                "file_size": len(text.encode("utf-8")),
                "fixture_hash": digest,
            },
        }
        for number, text in enumerate(file.pages, start=1)
    ]


def markdown_chunk_specs(project: FilesProject, file: FixtureFile) -> list[dict[str, Any]]:
    from knowledge_layer.ingest import markdown_documents

    from agent.common.source_kinds import MAIL_SOURCE_FORMAT

    digest = content_hash(file)
    text = file.pages[0]
    base = {"file_name": file.name, "file_size": len(text.encode("utf-8")), "source_encoding": "utf-8"}
    specs = []
    for ordinal, document in enumerate(markdown_documents(text, base)):
        metadata = {**document.metadata, "fixture_hash": digest}
        if file.name in project.mail_threads:
            metadata["source_format"] = MAIL_SOURCE_FORMAT
        specs.append(
            {
                "chunk_id": str(uuid.uuid5(uuid.NAMESPACE_URL, f"{project.collection}/{file.name}/{ordinal}/{digest}")),
                "text": document.text,
                "embed_text": document.text,
                "ordinal": ordinal,
                "metadata": metadata,
            }
        )
    return specs


def _ingested_specs(project: FilesProject, file: FixtureFile, digest: str) -> list[dict[str, Any]]:
    from knowledge_layer.ingest import text_chunks_for_pages
    from llama_index.core.schema import MetadataMode

    pages = [{"page_number": number, "text": text} for number, text in enumerate(file.pages, start=1)]
    size = len("\n".join(file.pages).encode("utf-8"))
    nodes = text_chunks_for_pages(pages, file.name, size)
    return [
        {
            "chunk_id": str(uuid.uuid5(uuid.NAMESPACE_URL, f"{project.collection}/{file.name}/c{ordinal}/{digest}")),
            "text": node.get_content(metadata_mode=MetadataMode.NONE),
            "embed_text": node.get_content(metadata_mode=MetadataMode.EMBED),
            "ordinal": ordinal,
            "metadata": {**node.metadata, "fixture_hash": digest},
        }
        for ordinal, node in enumerate(nodes)
    ]


def seed_problem() -> str | None:
    if not os.environ.get("QDRANT_URL"):
        return "QDRANT_URL is not set: the files set seeds its project into a Qdrant and its runs read it."
    summary_db = os.environ.get("SUMMARY_DB", "")
    if "://" not in summary_db:
        return "SUMMARY_DB must be a database URL (sqlite+aiosqlite:////absolute/path/summaries.db)."
    return None


def seed(project: FilesProject | None = None, *, embed: Any = None) -> dict[str, int]:
    from fixture_bff import production_embedder
    from knowledge_layer.embedding import embed_fingerprint_metadata
    from knowledge_layer.search import LlamaIndexRetriever
    from knowledge_layer.vector_store import ChunkRecord
    from knowledge_layer.vector_store import get_store
    from knowledge_layer.vector_store import write_chunks

    from agent.knowledge.document_metadata_store import DocumentMetadataStore

    project = project or load_project()
    embed = embed or production_embedder()
    if embed is None:
        raise RuntimeError("No embedding key: the files set needs the deployment's embedder to seed its project.")
    identity = embed_fingerprint_metadata(
        LlamaIndexRetriever.DEFAULT_EMBED_MODEL, LlamaIndexRetriever.DEFAULT_EMBED_BASE_URL
    )
    store = get_store(identity)
    metadata = DocumentMetadataStore(os.environ["SUMMARY_DB"])
    written: dict[str, int] = {}
    for file in project.files:
        register_metadata(metadata, project, file)
        specs = chunk_specs(project, file)
        have = (
            list(store.scroll(project.collection, {"file_name": file.name}, fields=["chunk_id"]))
            if store.exists(project.collection)
            else []
        )
        stored = {str((r.payload or {}).get("chunk_id") or "") for r in have}
        wanted = {spec["chunk_id"] for spec in specs}
        if stored == wanted:
            written[file.name] = 0
        else:
            store.delete_chunks(project.collection, sorted(stored - wanted))
            vectors = embed([spec["embed_text"] for spec in specs])
            if vectors is None:
                raise RuntimeError(f"The embedder did not answer for {file.name}.")
            records = [
                ChunkRecord(s["chunk_id"], s["text"], list(v), s["metadata"], ordinal=s["ordinal"])
                for s, v in zip(specs, vectors, strict=True)
            ]
            config = {
                "organization_id": ORGANIZATION_ID,
                "project_id": PROJECT_ID,
                "document_id": document_id(project, file.name),
                "folder_path": file.folder or None,
            }
            written[file.name] = write_chunks(project.collection, file.name, records, identity=identity, config=config)
    return written


def register_metadata(store: Any, project: FilesProject, file: FixtureFile) -> None:
    summary = file.pages[0].splitlines()[0].lstrip("# ")[:200]
    store.register(project.collection, file.name, summary, project.tags.get(file.name) or None)
    if file.folder:
        store.set_folder_path(project.collection, file.name, file.folder)
    if file.revision_facts:
        store.set_revision_facts(project.collection, file.name, file.revision_facts)
    if file.name in project.mail_threads:
        store.set_mail_thread(project.collection, file.name, project.mail_threads[file.name])
    if file.name in project.mail_origins:
        store.set_mail_origin(project.collection, file.name, project.mail_origins[file.name])


class FilesWorkspace:

    office = {"organizationId": ORGANIZATION_ID, "userId": USER_ID}
    project_id = PROJECT_ID

    def __init__(self, project: FilesProject | None = None) -> None:
        self.project = project or load_project()

    @property
    def envelope_fields(self) -> dict[str, Any]:
        return {"collectionScope": [{"collection": self.project.collection, "shelf": "project"}]}

    def turn_context(self, conversation: str | None) -> dict[str, Any]:
        return {
            "data": {
                "projectContext": f"Projekt: {self.project.description}",
                "projectMemory": None,
                "orgInstructions": None,
                "drewOnOtherProjects": False,
                "referenceProjects": None,
            }
        }

    def handle(self, body: dict[str, Any], conversation: str | None) -> dict[str, Any]:
        return {"jsonrpc": "2.0", "id": body.get("id"), "error": {"code": -32601, "message": "No MCP door in this set"}}
