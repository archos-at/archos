from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable
from collections.abc import Sequence
from contextvars import ContextVar
from datetime import datetime
from typing import Any

from agent.common.source_kinds import SHELF_QUALIFIERS
from agent.common.source_kinds import Shelf
from agent.common.source_kinds import parse_shelf
from agent.knowledge.inventory_notes import INVENTORY_ORDER as _INVENTORY_ORDER
from agent.knowledge.inventory_notes import focus_paragraph
from agent.knowledge.inventory_notes import in_flight_paragraph

_listing_shelf: ContextVar[Shelf | None] = ContextVar("listing_shelf", default=None)

_inventory_drops: ContextVar[dict[Shelf | None, int]] = ContextVar("inventory_drops", default={})

_turn_documents: ContextVar[tuple[Any, ...]] = ContextVar("turn_documents", default=())

_norm_families: ContextVar[tuple[Any, ...]] = ContextVar("norm_families", default=())

_USER_SHELF_ORDER: tuple[Shelf, ...] = (Shelf.OFFICE_SHELF, Shelf.PROJECT, Shelf.SESSION)


_SHELF_BLURBS: dict[Shelf, str] = {
    Shelf.BASE: (
        "always on this request — platform OIB / law corpus. Every turn has this, project or not. Never the Büroablage."
    ),
    Shelf.OFFICE_SHELF: (
        "on every project in this organization — the office's own files. NOT base/OIB, NOT this project's files."
    ),
    Shelf.PROJECT: ("on every session of this project — this project's files only. NOT the Büroablage, NOT base/OIB."),
    Shelf.SESSION: ("only this chat — attachments uploaded here. Not visible in other sessions."),
}

_LISTING_CUES = (
    "welche datei",
    "welche unterlagen",
    "welche dokumente",
    "welche oib",
    "was hast du",
    "was liegt",
    "was ist im",
    "was ist in der",
    "hast du was",
    "zeig mir die datei",
    "zeig die datei",
    "zeig mir die unterlagen",
    "liste das",
    "liste die",
    "liste ",
    "und im",
    "und in der",
    "what files",
    "which files",
    "what's in",
    "whats in",
    "what do you have",
    "what have you",
)

_SHELF_ONLY_FOLLOWUPS = frozenset(
    {
        "bueroablage",
        "buroablage",
        "die bueroablage",
        "in der bueroablage",
        "und in der bueroablage",
        "und die bueroablage",
        "im archiv",
        "ins archiv",
        "das archiv",
        "bueroarchiv",
        "buroarchiv",
        "bro archiv",
        "und im archiv",
        "und das archiv",
        "im bueroarchiv",
        "im buroarchiv",
        "im bro archiv",
    }
)

_SHELF_HINTS: tuple[tuple[Shelf, tuple[str, ...]], ...] = (
    (
        Shelf.OFFICE_SHELF,
        (
            "büroablage",
            "bueroablage",
            "büro-ablage",
            "office filing",
            "büroarchiv",
            "bueroarchiv",
            "büro archiv",
            "buero archiv",
            "bro archiv",
            "büro-archiv",
            "office archive",
            "im archiv",
            "ins archiv",
            "im archive",
        ),
    ),
    (
        Shelf.PROJECT,
        (
            "projektarchiv",
            "projektunterlagen",
            "im projekt",
            "dieses projekt",
            "this project",
            "projektwissen",
        ),
    ),
    (
        Shelf.BASE,
        (
            "basiswissen",
            "oib-richtlinien",
            "oib richtlinien",
            "welche oib",
            "base corpus",
        ),
    ),
    (
        Shelf.SESSION,
        (
            "dieser sitzung",
            "dieser unterhaltung",
            "this chat",
            "this session",
            "private sitzung",
        ),
    ),
)


def _shelf_of(doc: Any) -> Shelf | None:
    return parse_shelf(getattr(doc, "shelf", None) if not isinstance(doc, dict) else doc.get("shelf"))


def _file_name_of(doc: Any) -> str:
    if isinstance(doc, dict):
        return str(doc.get("file_name") or "")
    return str(getattr(doc, "file_name", "") or "")


def _collection_of(doc: Any) -> str:
    if isinstance(doc, dict):
        return str(doc.get("collection") or "")
    return str(getattr(doc, "collection", "") or "")


def _summary_of(doc: Any) -> str:
    if isinstance(doc, dict):
        return str(doc.get("summary") or "").strip()
    return str(getattr(doc, "summary", "") or "").strip()


def _folder_of(doc: Any) -> str:
    raw = doc.get("folder_path") if isinstance(doc, dict) else getattr(doc, "folder_path", None)
    return str(raw or "").strip()


def _list_of(doc: Any, name: str) -> list[str]:
    raw = doc.get(name) if isinstance(doc, dict) else getattr(doc, name, None)
    if not raw:
        return []
    return [str(term) for term in raw if term]


def _tags_of(doc: Any) -> list[str]:
    return _list_of(doc, "tags")


def _topics_of(doc: Any) -> list[str]:
    return _list_of(doc, "topics")


def _reading_bit(doc: Any) -> str:
    dossier = doc.get("dossier") if isinstance(doc, dict) else getattr(doc, "dossier", None)
    coverage = doc.get("coverage") if isinstance(doc, dict) else getattr(doc, "coverage", None)
    bits = []
    document_type = dossier.get("document_type") if isinstance(dossier, dict) else None
    if isinstance(document_type, str) and document_type not in ("", "other"):
        bits.append(f"Typ: {document_type.replace('_', ' ')}")
    if isinstance(coverage, dict) and isinstance(coverage.get("not_read"), int) and coverage["not_read"] > 0:
        bits.append(f"{coverage['not_read']} von {coverage.get('pages', '?')} Seiten nicht vollständig gelesen")
    return "".join(f" · {bit}" for bit in bits)


def _captured_on_of(doc: Any) -> str | None:
    capture = doc.get("capture") if isinstance(doc, dict) else getattr(doc, "capture", None)
    if not isinstance(capture, dict) or not isinstance(capture.get("captured_at"), str):
        return None
    try:
        return datetime.fromisoformat(capture["captured_at"]).date().isoformat()
    except ValueError:
        return None


_MAX_REPLACED_NAMED = 3


def _confirmed_revision_bit(doc: Any) -> str:
    newer = doc.get("superseded_by") if isinstance(doc, dict) else getattr(doc, "superseded_by", None)
    older = _list_of(doc, "supersedes")
    parts: list[str] = []
    if newer:
        parts.append(f"ersetzt durch {newer} (bestätigt)")
    if older:
        named = ", ".join(older[:_MAX_REPLACED_NAMED])
        rest = len(older) - _MAX_REPLACED_NAMED
        parts.append(f"ersetzt {named}{f' und {rest} weitere' if rest > 0 else ''} (bestätigt)")
    return f" · {'; '.join(parts)}" if parts else ""


def document_identity(doc: Any) -> tuple[str, str]:
    return (_collection_of(doc), _file_name_of(doc))


def stamp_document(doc: Any, *, collection: str, shelf: Shelf | None) -> Any:
    shelf_value = shelf.value if isinstance(shelf, Shelf) else None
    if hasattr(doc, "model_copy"):
        return doc.model_copy(update={"collection": collection, "shelf": shelf_value})
    try:
        doc.collection = collection
        doc.shelf = shelf_value
    except Exception:
        pass
    return doc


def _dedupe(docs: Iterable[Any]) -> list[Any]:
    seen: set[tuple[str, str]] = set()
    out: list[Any] = []
    for doc in docs:
        key = document_identity(doc)
        if key in seen:
            continue
        seen.add(key)
        out.append(doc)
    return out


def _sort_key(doc: Any) -> str:
    return _file_name_of(doc).lower()


def _is_user_priority(shelf: Shelf | None) -> bool:
    return shelf is None or shelf in _USER_SHELF_ORDER


def allocate_inventory(docs: Sequence[Any], max_documents: int | None) -> list[Any]:
    return allocate_inventory_detailed(docs, max_documents)[0]


def allocate_inventory_detailed(
    docs: Sequence[Any], max_documents: int | None
) -> tuple[list[Any], dict[Shelf | None, int]]:
    unique = _dedupe(docs)
    groups: dict[Shelf | None, list[Any]] = defaultdict(list)
    for doc in unique:
        groups[_shelf_of(doc)].append(doc)
    for group in groups.values():
        group.sort(key=_sort_key)

    user_shelves: list[Shelf | None] = [None, *_USER_SHELF_ORDER]
    user_docs = [doc for shelf in user_shelves for doc in groups.get(shelf, [])]
    base_docs = list(groups.get(Shelf.BASE, []))

    def drops(kept: Sequence[Any]) -> dict[Shelf | None, int]:
        kept_per_shelf: dict[Shelf | None, int] = defaultdict(int)
        for doc in kept:
            kept_per_shelf[_shelf_of(doc)] += 1
        return {shelf: len(group) - kept_per_shelf[shelf] for shelf, group in groups.items()}

    if not max_documents or max_documents < 0:
        return user_docs + base_docs, {}

    if len(user_docs) <= max_documents:
        leftover = max_documents - len(user_docs)
        kept = user_docs + base_docs[:leftover]
        return kept, drops(kept)

    nonempty = [shelf for shelf in user_shelves if groups.get(shelf)]
    if not nonempty:
        kept = base_docs[:max_documents]
        return kept, drops(kept)

    share = max(1, max_documents // len(nonempty))
    kept = []
    remainder_pool: list[Any] = []
    for shelf in nonempty:
        group = groups[shelf]
        kept.extend(group[:share])
        remainder_pool.extend(group[share:])
    leftover = max_documents - len(kept)
    if leftover > 0:
        kept.extend(remainder_pool[:leftover])
    kept = kept[:max_documents]
    return kept, drops(kept)


def _query_variants(query: str) -> tuple[str, str]:
    raw = (query or "").strip().lower()
    folded = raw.replace("ä", "ae").replace("ö", "oe").replace("ü", "ue").replace("ß", "ss")
    return raw, folded


def shelf_hint_from_query(query: str) -> Shelf | None:
    raw, folded = _query_variants(query)
    haystacks = (raw, folded)
    cleaned = "".join(ch if ch.isalnum() or ch.isspace() else " " for ch in folded)
    cleaned = " ".join(cleaned.split())
    is_listing = any(cue in text for text in haystacks for cue in _LISTING_CUES) or (cleaned in _SHELF_ONLY_FOLLOWUPS)
    if not is_listing:
        return None
    for shelf, tokens in _SHELF_HINTS:
        for token in tokens:
            token_l = token.lower()
            token_folded = token_l.replace("ä", "ae").replace("ö", "oe").replace("ü", "ue")
            if any(token_l in text or token_folded in text for text in haystacks):
                return shelf
    return None


def set_inventory_drops(drops: dict[Shelf | None, int] | None) -> None:
    _inventory_drops.set({shelf: n for shelf, n in (drops or {}).items() if n > 0})


def get_inventory_drops() -> dict[Shelf | None, int]:
    return _inventory_drops.get()


def set_turn_documents(docs: Sequence[Any] | None) -> None:
    _turn_documents.set(tuple(docs or ()))


def get_turn_documents() -> tuple[Any, ...]:
    return _turn_documents.get()


def set_norm_families(families: Sequence[Any] | None) -> None:
    _norm_families.set(tuple(families or ()))


def get_norm_families() -> tuple[Any, ...]:
    return _norm_families.get()


def _family_lines(families: Sequence[Any]) -> list[str]:
    if not families:
        return []
    lines = [
        "The Richtlinien families of this corpus, with all parts that are actually "
        "indexed (not the series „1–6“, but the members):"
    ]
    lines += [f"- {family.label}: {', '.join(family.members)}" for family in families]
    lines.append(
        "A question about a whole Richtlinie is answered only once every member named "
        "here has been read. A member that was not read may be named, "
        "but not described."
    )
    return lines


def set_listing_shelf(shelf: Shelf | str | None) -> None:
    _listing_shelf.set(parse_shelf(shelf))


def get_listing_shelf() -> Shelf | None:
    return _listing_shelf.get()


def _parse_scope_shelves(values: Sequence[Any] | None) -> list[Shelf]:
    if not values:
        return []
    seen: set[Shelf] = set()
    out: list[Shelf] = []
    for value in values:
        shelf = parse_shelf(value)
        if shelf is None or shelf in seen:
            continue
        seen.add(shelf)
        out.append(shelf)
    return out


def _heading(shelf: Shelf) -> str:
    return SHELF_QUALIFIERS[shelf]


def _implied_shelves(groups: dict[Shelf, list[Any]]) -> list[Shelf]:
    present = {shelf for shelf, rows in groups.items() if rows}
    if not present:
        return []
    implied: set[Shelf] = set(present)
    implied.add(Shelf.BASE)
    if present & {Shelf.OFFICE_SHELF, Shelf.PROJECT, Shelf.SESSION}:
        implied.add(Shelf.OFFICE_SHELF)
        implied.add(Shelf.BASE)
    if present & {Shelf.PROJECT, Shelf.SESSION}:
        implied.add(Shelf.PROJECT)
    return [shelf for shelf in _INVENTORY_ORDER if shelf in implied]


def _folded_base_lines(count: int) -> list[str]:
    n = f"{count} file" if count == 1 else f"{count} files"
    return [
        f"{n} — the platform corpus (OIB guidelines with explanatory notes, guides "
        "and definitions). Constant on every request and deliberately not "
        "listed here.",
        "Search it with `knowledge_search` without `file_name`; every hit names "
        "the file it comes from, and that file is then citable.",
        f"If the user asks what is on this shelf: say that it is {n} of the "
        "OIB corpus and that you reach them through search. Do not invent "
        "file names.",
        *_family_lines(get_norm_families()),
    ]


def render_inventory_block(
    docs: Sequence[Any],
    *,
    in_scope_shelves: Sequence[Any] | None = None,
    focus_shelf: Shelf | str | None = None,
    in_flight: Sequence[str] | None = None,
) -> str:
    groups: dict[Shelf, list[Any]] = {shelf: [] for shelf in _INVENTORY_ORDER}
    unknown: list[Any] = []
    for doc in docs:
        if not _file_name_of(doc):
            continue
        shelf = _shelf_of(doc)
        if shelf is None:
            unknown.append(doc)
        else:
            groups.setdefault(shelf, []).append(doc)

    scoped = _parse_scope_shelves(in_scope_shelves)
    if not scoped:
        scoped = _implied_shelves(groups)
    focused = parse_shelf(focus_shelf)

    show: list[Shelf] = []
    for shelf in _INVENTORY_ORDER:
        if focused is not None:
            if shelf == focused:
                show.append(shelf)
            continue
        if shelf in scoped or groups[shelf]:
            show.append(shelf)
    if not show and not unknown and not (in_flight or []):
        return ""
    if focused is not None:
        unknown = []

    lines = [
        "## Knowledge-base inventory (index — NOT sources)",
        "These files exist and are searchable. This is an index of what is available, "
        "not evidence you may cite: the one-line summaries are not quotable, and a "
        "filename here is not a citable source until a retrieval result has returned "
        "a passage from it.",
        "",
        "Files sit on four nested shelves. A wider shelf is NOT the narrower one:",
        "- **Basiswissen** (base) — always on this request. Platform OIB / law. Every turn has this.",
        "- **Büroablage** (office_shelf) — on every project in this organization. "
        "The office's own files. NOT base/OIB, NOT this project.",
        "- **Projektwissen** (project) — on every session of this project. This project's files. NOT the Büroablage.",
        "- **Private Sitzung** (session) — only this chat. Attachments uploaded here.",
        "",
        'When the user asks which files you have on a shelf (e.g. "welche Dateien '
        'hast du in der Büroablage", "was liegt im Projekt", "welche OIB-Richtlinien '
        "hast du\"), answer ONLY from that shelf's files. If the group is empty, say "
        "so. Never fill a gap with another shelf. Büroablage is never the OIB corpus. "
        "When the group says it is incomplete, or the question narrows by folder, name, "
        "kind or date, `list_files` returns the complete, filtered list.",
        "",
    ]
    if any(_folder_of(doc) for doc in docs):
        lines.append(
            "Files the user filed into a folder show it as `(Ordner: Pfad/Unterpfad)`. "
            "A folder is a path, so `Brandschutz` also means everything under "
            "`Brandschutz/…`. You may name folders when you talk about the files, and "
            "you may pass `folder=` to `knowledge_search` to read only what is filed "
            "there. Files with no `(Ordner: …)` sit at the top level."
        )
        lines.append("")

    for paragraph in (in_flight_paragraph(in_flight), focus_paragraph(focused)):
        if paragraph:
            lines.extend((paragraph, ""))

    dropped = get_inventory_drops()
    for shelf in show:
        rows = groups.get(shelf, [])
        lines.append(f"### {_heading(shelf)}")
        lines.append(_SHELF_BLURBS[shelf])
        base_total = len(rows) + dropped.get(Shelf.BASE, 0)
        if shelf is Shelf.BASE and focused is not Shelf.BASE and base_total:
            lines.extend(_folded_base_lines(base_total))
            lines.append("")
            continue
        if not rows:
            lines.append("(empty — no files on this shelf)")
        else:
            for doc in rows:
                tags = _tags_of(doc)
                tag_bit = f" [{', '.join(tags)}]" if tags else ""
                topics = _topics_of(doc)
                topic_bit = f" Themen: {', '.join(topics)}" if topics else ""
                captured = _captured_on_of(doc)
                captured_bit = f" · aufgenommen {captured}" if captured else ""
                folder = _folder_of(doc)
                folder_bit = f" (Ordner: {folder})" if folder else ""
                summary = _summary_of(doc) or "No summary available"
                revision_bit = _confirmed_revision_bit(doc)
                reading_bit = _reading_bit(doc)
                lines.append(
                    f"- **{_file_name_of(doc)}**{folder_bit}{tag_bit}{topic_bit}{captured_bit}{revision_bit}"
                    f"{reading_bit}: {summary}"
                )
        missing = dropped.get(shelf, 0)
        if missing > 0:
            lines.append(
                f"- (and {missing} more file(s) on this shelf, not listed here — "
                f'this list is incomplete. `list_files(shelf="{shelf.value}")` shows all, '
                f"also filtered by folder, name or date; without that call do not treat the list "
                f"as complete)"
            )
        lines.append("")

    if unknown:
        lines.append("### Unattributed")
        lines.append("Shelf was not stated for these files — do not assign them to Büroablage or Basiswissen.")
        for doc in unknown:
            summary = _summary_of(doc) or "No summary available"
            lines.append(f"- **{_file_name_of(doc)}**: {summary}")
        missing_unknown = dropped.get(None, 0)
        if missing_unknown > 0:
            lines.append(
                f"- (and {missing_unknown} more file(s) with no shelf stated, not "
                f"listed here — this list is incomplete; say so instead of treating it as "
                f"complete)"
            )
        lines.append("")

    return "\n".join(lines).rstrip() + "\n"


def in_scope_shelves_from_context() -> list[Shelf]:
    try:
        from agent.knowledge.scoping import get_scoped_collections_from_context

        entries = get_scoped_collections_from_context()
    except Exception:
        return []
    if not entries:
        return []
    return [entry.shelf for entry in entries if entry.shelf]
