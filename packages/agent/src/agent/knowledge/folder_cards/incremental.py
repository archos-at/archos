from __future__ import annotations

import hashlib
import json
from collections.abc import Iterable
from collections.abc import Mapping
from dataclasses import asdict
from dataclasses import dataclass
from dataclasses import field
from typing import Any
from typing import Literal

from agent.knowledge.folder_cards.inputs import PROMPT_VERSION
from agent.knowledge.folder_cards.inputs import ChildDocument
from agent.knowledge.folder_cards.inputs import ChildFolder
from agent.knowledge.folder_cards.inputs import FolderInputs

MAX_INCREMENTS = 10
MAX_CHANGED_SHARE = 0.5

Mode = Literal["prune", "incremental", "full"]


def _digest(value: Any) -> str:
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()[:32]


def document_fingerprint(document: ChildDocument) -> str:
    return _digest(asdict(document))


def folder_fingerprint(folder: ChildFolder) -> str:
    return folder.abstract_hash or _digest(list(folder.documents))


@dataclass(frozen=True)
class Manifest:
    documents: Mapping[str, str]
    folders: Mapping[str, str]
    description: str | None
    prompt_version: str = PROMPT_VERSION
    increments: int = 0

    def to_json(self) -> str:
        return json.dumps(
            {
                "documents": dict(self.documents),
                "folders": dict(self.folders),
                "description": self.description,
                "prompt_version": self.prompt_version,
                "increments": self.increments,
            },
            ensure_ascii=False,
            sort_keys=True,
        )

    @classmethod
    def from_json(cls, text: str) -> Manifest:
        data = json.loads(text)
        return cls(
            documents=dict(data.get("documents") or {}),
            folders=dict(data.get("folders") or {}),
            description=data.get("description"),
            prompt_version=str(data.get("prompt_version") or ""),
            increments=int(data.get("increments") or 0),
        )


def manifest_of(inputs: FolderInputs, *, increments: int = 0) -> Manifest:
    return Manifest(
        documents={document.file_name: document_fingerprint(document) for document in inputs.documents},
        folders={folder.name: folder_fingerprint(folder) for folder in inputs.folders},
        description=_digest(inputs.description) if inputs.description else None,
        increments=increments,
    )


def _split(before: Mapping[str, str], after: Mapping[str, str]) -> tuple[list[str], list[str], list[str]]:
    added = sorted(set(after) - set(before))
    removed = sorted(set(before) - set(after))
    changed = sorted(name for name in set(before) & set(after) if before[name] != after[name])
    return added, removed, changed


@dataclass(frozen=True)
class Diff:
    added: tuple[str, ...] = ()
    removed: tuple[str, ...] = ()
    changed: tuple[str, ...] = ()
    folders_added: tuple[str, ...] = ()
    folders_removed: tuple[str, ...] = ()
    folders_changed: tuple[str, ...] = ()

    @property
    def size(self) -> int:
        return sum(len(part) for part in asdict(self).values())

    @property
    def only_removals(self) -> bool:
        return self.size == len(self.removed)

    def counts(self) -> dict[str, int]:
        return {
            "diff_added": len(self.added) + len(self.folders_added),
            "diff_removed": len(self.removed) + len(self.folders_removed),
            "diff_changed": len(self.changed) + len(self.folders_changed),
        }


def diff(before: Manifest, after: Manifest) -> Diff:
    documents = _split(before.documents, after.documents)
    folders = _split(before.folders, after.folders)
    return Diff(*(tuple(part) for part in (*documents, *folders)))


@dataclass(frozen=True)
class Plan:
    mode: Mode
    diff: Diff = field(default_factory=Diff)
    increments: int = 0
    reason: str = ""


def plan(existing: Mapping[str, Any] | None, manifest: Manifest | None, inputs: FolderInputs) -> Plan:
    if not existing or not existing.get("abstract") or manifest is None:
        return Plan("full", reason="no prior card")
    current = manifest_of(inputs)
    if manifest.prompt_version != PROMPT_VERSION:
        return Plan("full", reason="prompt version")
    if manifest.description != current.description:
        return Plan("full", reason="description")
    if manifest.increments >= MAX_INCREMENTS:
        return Plan("full", reason="increments")
    change = diff(manifest, current)
    children = len(current.documents) + len(current.folders)
    if change.size > MAX_CHANGED_SHARE * children:
        return Plan("full", change, reason="share")
    if change.only_removals:
        return Plan("prune", change, increments=manifest.increments)
    return Plan("incremental", change, increments=manifest.increments + 1)


def surviving_facts(key_facts: Iterable[Mapping[str, Any]], children: Iterable[str]) -> list[dict[str, Any]]:
    current = set(children)
    kept = []
    for fact in key_facts:
        documents = [str(name) for name in fact.get("documents") or []]
        if documents and set(documents) <= current:
            kept.append(dict(fact))
    return kept
