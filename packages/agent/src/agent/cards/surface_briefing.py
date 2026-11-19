from __future__ import annotations

from agent.cards.surface_ranking import SurfaceMode

_SOURCE_LABEL = {"project": "Projekt", "office": "Büroablage"}
_BRIEF_SNIPPET_MAX = 120
_BRIEF_SUMMARY_MAX = 160


def _clip(text: str | None, limit: int) -> str | None:
    value = (text or "").strip()
    if not value:
        return None
    if len(value) <= limit:
        return value
    return value[:limit].rstrip() + "…"


def _file_label(doc: dict) -> str:
    return _SOURCE_LABEL.get(doc.get("source") or "", "Dokument")


def _folder_of(doc: dict) -> str:
    return str(doc.get("_folder_path") or "").strip()


def _briefing_for_agent(query: str, documents: list[dict], mode: SurfaceMode) -> str:
    if mode == "one" or len(documents) == 1:
        return _brief_one(documents[0])
    return _brief_many(query, documents)


def _brief_one(doc: dict) -> str:
    name = doc["file_name"]
    label = _file_label(doc)
    folder = _folder_of(doc)
    where = f"{label}, Ordner {folder}" if folder else label
    lines = [f'Opened "{name}" ({where}) beside the chat.']
    summary = _clip(doc.get("summary"), _BRIEF_SUMMARY_MAX)
    if summary:
        lines.append(f"Worum es geht: {summary}")
    snippet = _clip(doc.get("snippet"), _BRIEF_SNIPPET_MAX)
    if snippet:
        page = doc.get("page")
        where = f"S. {page}: " if page else ""
        lines.append(f'{where}"{snippet}"')
    lines.append("The UI shows the file. Talk about it; do not re-open it or dump filenames.")
    return "\n".join(lines)


def _brief_many(query: str, documents: list[dict]) -> str:
    lines = [
        f"Offered {len(documents)} close matches for {query!r}. "
        "Short choice — the user picks. Do not enumerate the filenames."
    ]
    for doc in documents:
        label = _file_label(doc)
        folder = _folder_of(doc)
        where = f"{label}, Ordner {folder}" if folder else label
        summary = _clip(doc.get("summary"), _BRIEF_SUMMARY_MAX)
        row = f'- "{doc["file_name"]}" ({where})'
        if summary:
            row = f"{row} — {summary}"
        lines.append(row)
    return "\n".join(lines)
