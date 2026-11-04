"""How one file reads in the knowledge-base inventory. Pure.

A row of the inventory arrives as a dict (from the BFF's wire) or as an object
(from the summaries store). The readers here take either, and ``file_row``
renders the one line the model sees for a file. Which files are shown, and on
which shelf, is ``inventory``'s business; this module never decides it.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from agent.common.source_kinds import Shelf
from agent.common.source_kinds import parse_shelf

#: Replaced file names one inventory row names before it counts the rest.
_MAX_REPLACED_NAMED = 3


def _field(doc: Any, name: str) -> Any:
    return doc.get(name) if isinstance(doc, dict) else getattr(doc, name, None)


def shelf_of(doc: Any) -> Shelf | None:
    return parse_shelf(_field(doc, "shelf"))


def file_name_of(doc: Any) -> str:
    return str(_field(doc, "file_name") or "")


def collection_of(doc: Any) -> str:
    return str(_field(doc, "collection") or "")


def summary_of(doc: Any) -> str:
    return str(_field(doc, "summary") or "").strip()


def folder_of(doc: Any) -> str:
    """Materialised folder path a file is filed under, or ``""`` for the root.

    ADR-0049: the backend carries the PATH (``Brandschutz/Fluchtwege``), not a
    folder id, precisely so it can be printed here without a join and so a
    prefix match is the subtree.
    """
    return str(_field(doc, "folder_path") or "").strip()


def _list_of(doc: Any, name: str) -> list[str]:
    raw = _field(doc, name)
    if not raw:
        return []
    return [str(term) for term in raw if term]


def _reading_bit(doc: Any) -> str:
    """`` · Typ: fire safety concept · 2 von 40 Seiten nicht vollständig gelesen``, from the ingest's reading.

    The type is the dossier's (finer than the tags), the unread pages its coverage: a model
    that is told a document was not fully read can say so instead of answering from a gap.
    """
    dossier = _field(doc, "dossier")
    coverage = _field(doc, "coverage")
    bits = []
    document_type = dossier.get("document_type") if isinstance(dossier, dict) else None
    if isinstance(document_type, str) and document_type not in ("", "other"):
        bits.append(f"Typ: {document_type.replace('_', ' ')}")
    if isinstance(coverage, dict) and isinstance(coverage.get("not_read"), int) and coverage["not_read"] > 0:
        bits.append(f"{coverage['not_read']} von {coverage.get('pages', '?')} Seiten nicht vollständig gelesen")
    return "".join(f" · {bit}" for bit in bits)


def _captured_on_of(doc: Any) -> str | None:
    """The ``YYYY-MM-DD`` a camera gave the photo, or ``None``.

    Reads ``captured_at`` and nothing else of ``capture``. The coordinates are
    never read here: this line is rendered into the prompt, and a site's
    position is not something a model is given (see ``PhotoFacts``).
    """
    capture = _field(doc, "capture")
    if not isinstance(capture, dict) or not isinstance(capture.get("captured_at"), str):
        return None
    try:
        return datetime.fromisoformat(capture["captured_at"]).date().isoformat()
    except ValueError:
        return None


def _confirmed_revision_bit(doc: Any) -> str:
    """What a person confirmed about this file's Fassungen, as a short row suffix.

    Only the confirmed link: a suggestion is not shown to the model, and a name
    series is `list_files`'s to mark. The older file says which one replaced it,
    the newer says which it replaced, so the model leans on the current one.
    """
    newer = _field(doc, "superseded_by")
    older = _list_of(doc, "supersedes")
    parts: list[str] = []
    if newer:
        parts.append(f"ersetzt durch {newer} (bestätigt)")
    if older:
        named = ", ".join(older[:_MAX_REPLACED_NAMED])
        rest = len(older) - _MAX_REPLACED_NAMED
        parts.append(f"ersetzt {named}{f' und {rest} weitere' if rest > 0 else ''} (bestätigt)")
    return f" · {'; '.join(parts)}" if parts else ""


def file_row(doc: Any) -> str:
    """The inventory's line for one file: name, folder, tags, topics, capture date, Fassungen, reading, summary."""
    folder = folder_of(doc)
    tags = _list_of(doc, "tags")
    topics = _list_of(doc, "topics")
    captured = _captured_on_of(doc)
    parts = [
        f"- **{file_name_of(doc)}**",
        f" (Ordner: {folder})" if folder else "",
        f" [{', '.join(tags)}]" if tags else "",
        f" Themen: {', '.join(topics)}" if topics else "",
        f" · aufgenommen {captured}" if captured else "",
        _confirmed_revision_bit(doc),
        _reading_bit(doc),
        f": {summary_of(doc) or 'No summary available'}",
    ]
    return "".join(parts)
