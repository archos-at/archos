from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from agent.common.action_outcome import ActionOutcome

from .models import PassageTarget
from .models import ReadPassageInput
from .ranges import _locus_label
from .targets import _document_names

_MAX_DID_YOU_MEAN = 3

_DID_YOU_MEAN_CUTOFF = 0.6

_NOT_READABLE_IS_NOT_ABSENT = (
    "Not readable here is not the same as not in the project: a file whose read failed is listed under "
    "`documents_unreadable:` in the project context — say it could not be read, never that it is missing."
)


def _suggestion_names(wanted: str, documents: list[Any], *, limit: int = _MAX_DID_YOU_MEAN) -> list[str]:
    import difflib

    folded = (wanted or "").strip().casefold()
    if not folded:
        return []
    scored: list[tuple[float, str]] = []
    for document in documents or ():
        best_name = ""
        best_ratio = 0.0
        for name in _document_names(document):
            candidate = name.strip()
            if not candidate:
                continue
            ratio = difflib.SequenceMatcher(None, folded, candidate.casefold()).ratio()
            if ratio > best_ratio:
                best_name, best_ratio = candidate, ratio
        if best_name and best_ratio >= _DID_YOU_MEAN_CUTOFF:
            scored.append((best_ratio, best_name))
    scored.sort(key=lambda item: (-item[0], item[1]))
    return [name for _ratio, name in scored[:limit]]


def _unknown_document_message(document: str, known: int, suggestions: Sequence[str] | None = None) -> str:
    names = [name for name in (suggestions or []) if str(name).strip()]
    shown = names[:_MAX_DID_YOU_MEAN]
    remaining = len(names) - len(shown)
    if known <= 0:
        base = (
            f"No document in scope is named {document!r}. No documents are readable this turn — "
            "the inventory is empty. List the files for what is filed, "
            "or call `knowledge_search` with the topic when you do not yet know "
            "which document holds it. Do not invent a citation. " + _NOT_READABLE_IS_NOT_ABSENT
        )
    else:
        base = (
            f"No document in scope is named {document!r}. This tool never guesses a name: it opens "
            "the document you name or nothing.\n"
            f"{known} document(s) are readable this turn. Take the name from a hit's `Source:` or "
            "`Citation:` line, or from the knowledge-base inventory, and call again — or call "
            "`knowledge_search` with the topic when you do not yet know which document holds it. "
            "Do not invent a citation. " + _NOT_READABLE_IS_NOT_ABSENT
        )
    if not shown:
        return base
    guesses = "\n".join(f"- {name}" for name in shown)
    message = (
        base + "\nDid you mean (guesses — pass one back verbatim as `document=` if it is the file "
        "you want, do not modify it):\n" + guesses
    )
    if remaining > 0:
        message += f"\n(+{remaining} more candidate(s) not shown — refine the name to narrow it down.)"
    return message


def _no_passage_message(
    document: str, clause: str | None, page: int | None, pages: tuple[int, int] | None = None
) -> str:
    asked = _locus_label(document, clause, page, pages)
    hint = (
        "The Punkt must be the number alone as the hit's `Punkt:` line prints it ('3.5.2'), and "
        "a parent heading is not a chunk of its own — read the child Punkt instead. "
        if clause
        else ""
    )
    return (
        f"{document} carries no passage at {asked}. "
        + hint
        + "Search the topic with `knowledge_search` rather than citing a Punkt you could not open."
    )


def _empty_document_message(document: str) -> str:
    return (
        f"{document} is registered but no passage of it could be read — the store holds no "
        "chunk of this document. Search the topic with `knowledge_search` rather than citing a "
        "document you could not open."
    )


def _store_silent_message(query: str) -> str:
    from agent.common.tool_calls import FETCH_FAILED_MARKER

    return (
        f"{FETCH_FAILED_MARKER} Could not read {query}: the knowledge store did not answer. "
        "Retry once; if it fails again, say so and do not invent a citation."
    )


def _nameable(targets: Sequence[PassageTarget]) -> PassageTarget | None:
    from agent.knowledge.restricted_use import may_name

    return next((target for target in targets if may_name(target.collection)), None)


def _note_target(outcome: ActionOutcome, targets: Sequence[PassageTarget]) -> None:
    target = _nameable(targets)
    outcome.target = target.file_name if target is not None else None


def _read_row_fields(arguments: ReadPassageInput) -> dict[str, str | None]:
    clause = str(arguments.clause if arguments.clause is not None else "").strip().strip(".")
    page = str(arguments.page if arguments.page is not None else "").strip()
    pages = str(arguments.pages if arguments.pages is not None else "").strip()
    return {
        "target": (arguments.document or "").strip(),
        "pages": f"Pkt. {clause}" if clause else (pages or page or None),
    }


def _count(outcome: ActionOutcome, hits: int, targets: Sequence[PassageTarget]) -> None:
    outcome.record(hits, collections=[target.collection for target in targets])
