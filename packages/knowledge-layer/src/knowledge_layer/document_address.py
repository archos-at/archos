from __future__ import annotations

import unicodedata
from collections.abc import Callable
from collections.abc import Iterable
from collections.abc import Sequence

_DOCUMENT_ID_PREFIX = "doc:id:"


def _key(text: str | None) -> str:
    return unicodedata.normalize("NFC", text or "").strip().casefold()


def _folder_key(folder: str | None) -> str:
    return "/".join(part for part in (_key(part) for part in (folder or "").split("/")) if part)


def citation_form(folder: str | None, file_name: str) -> str:
    folder = (folder or "").strip().strip("/")
    return f"{folder}/{file_name}" if folder else f"/{file_name}"


def _spellings(text: str) -> list[str]:
    from agent.citations.citation_keys import parse_citation_key

    raw = unicodedata.normalize("NFC", text or "").strip()
    cited, _page = parse_citation_key(raw)
    return list(dict.fromkeys(spelling for spelling in (raw, cited.strip()) if spelling))


def _document_id_of(text: str) -> str:
    return text[len(_DOCUMENT_ID_PREFIX) :].strip() if text.casefold().startswith(_DOCUMENT_ID_PREFIX) else text


def names_document_id(text: str, document_id: str | None) -> bool:
    return bool(document_id) and _document_id_of(unicodedata.normalize("NFC", text or "").strip()) == document_id


def addressed[Candidate](
    candidates: Sequence[Candidate],
    text: str,
    *,
    names: Callable[[Candidate], Iterable[str]],
    folder: Callable[[Candidate], str | None],
    document_id: Callable[[Candidate], str | None],
) -> list[Candidate]:
    spellings = _spellings(text)
    for spelling in spellings:
        wanted_id = _document_id_of(spelling)
        by_id = [candidate for candidate in candidates if wanted_id and document_id(candidate) == wanted_id]
        if by_id:
            return by_id
    for spelling in spellings:
        where, slash, leaf = spelling.rpartition("/")
        if not slash or not leaf.strip():
            continue
        wanted_folder, wanted_name = _folder_key(where), _key(leaf)
        by_path = [
            candidate
            for candidate in candidates
            if _folder_key(folder(candidate)) == wanted_folder
            and any(_key(name) == wanted_name for name in names(candidate))
        ]
        if by_path:
            return by_path
    for spelling in spellings:
        wanted = _key(spelling)
        by_name = [candidate for candidate in candidates if any(_key(name) == wanted for name in names(candidate))]
        if by_name:
            return by_name
    return []
