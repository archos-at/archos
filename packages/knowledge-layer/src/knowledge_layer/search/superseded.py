import asyncio
import logging
from collections.abc import Sequence
from dataclasses import dataclass
from dataclasses import field
from typing import Any

logger = logging.getLogger(__name__)


_HIDDEN_REVISIONS_NAMED = 5


@dataclass(frozen=True)
class Replaced:
    by_name: dict[str, str] = field(default_factory=dict)
    by_id: dict[str, str] = field(default_factory=dict)
    names: dict[str, str] = field(default_factory=dict)

    def __bool__(self) -> bool:
        return bool(self.by_name or self.by_id)

    def hides(self, chunk: Any) -> bool:
        document_id = (getattr(chunk, "metadata", None) or {}).get("document_id")
        if document_id:
            return str(document_id) in self.by_id
        return getattr(chunk, "file_name", None) in self.by_name

    def older_names(self) -> set[str]:
        return set(self.by_name) | {self.names[older] for older in self.by_id if older in self.names}

    def current_of(self, file_name: str) -> list[str]:
        currents = []
        if file_name in self.by_name:
            currents.append(_end_of_chain(file_name, self.by_name))
        for older in self.by_id:
            if self.names.get(older) == file_name:
                newest = _end_of_chain(older, self.by_id)
                currents.append(self.names.get(newest, newest))
        return currents


def _end_of_chain(start: str, links: dict[str, str]) -> str:
    seen, current = {start}, links[start]
    while current in links and current not in seen:
        seen.add(current)
        current = links[current]
    return current


def _replaced_in(collection: str) -> Replaced:
    from agent.knowledge import get_superseded_files

    by_name = dict(sorted(get_superseded_files(collection).items()))
    try:
        from agent.knowledge import get_documents
        from agent.knowledge import get_superseded_ids

        by_id = dict(sorted(get_superseded_ids(collection).items()))
        ids = sorted({*by_id, *by_id.values()})
        names = {str(doc.document_id): doc.file_name for doc in get_documents(collection, [], document_ids=ids)}
    except Exception:  # noqa: BLE001 — the payload flag still excludes them; only this backstop is lost
        logger.warning("Could not read the replaced documents of %s by id", collection, exc_info=True)
        by_id, names = {}, {}
    return Replaced(by_name, by_id, names)


async def superseded_files(collections: Sequence[str]) -> dict[str, Replaced]:
    answers = await asyncio.gather(
        *(asyncio.to_thread(_replaced_in, collection) for collection in collections),
        return_exceptions=True,
    )
    return {
        collection: answer
        for collection, answer in zip(collections, answers, strict=True)
        if isinstance(answer, Replaced) and answer
    }


def without_replaced(chunks: Sequence[Any], replaced: Replaced) -> list[Any]:
    return [chunk for chunk in chunks if not replaced.hides(chunk)]


def named_older_revision_notice(file_name: str | None, superseded: dict[str, Replaced]) -> str:
    if not file_name:
        return ""
    from agent.knowledge.restricted_use import may_name
    from knowledge_layer.read_passage import older_revision_line

    lines = []
    for collection, replaced in superseded.items():
        if not may_name(collection):
            continue
        lines.extend(older_revision_line(file_name, current) for current in replaced.current_of(file_name))
    return "".join(sorted(set(lines)))


def hidden_revisions_notice(superseded: dict[str, Replaced]) -> str:
    names = sorted({name for replaced in superseded.values() for name in replaced.older_names()})
    if not names:
        return ""
    shown = ", ".join(names[:_HIDDEN_REVISIONS_NAMED])
    rest = len(names) - _HIDDEN_REVISIONS_NAMED
    tail = f" and {rest} more" if rest > 0 else ""
    return f"Older Fassungen left out: {shown}{tail}; each is readable when it is named.\n\n"
