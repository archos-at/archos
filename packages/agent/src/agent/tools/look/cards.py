from __future__ import annotations

import logging
import re
import unicodedata
from collections.abc import Iterable
from collections.abc import Sequence
from types import SimpleNamespace
from typing import Any
from uuid import uuid4

from agent.cards.look_card import MAX_LOOK_ITEMS
from agent.cards.models import answer_card_adapter
from agent.cards.registry import extend_or_add
from agent.cards.registry import get_card_registry
from agent.common.page_region_words import where_on_the_page
from agent.common.retrieval_status import emit_look_step

logger = logging.getLogger(__name__)

CARD_TYPE = "look"
HELD = "look"


def _key(name: str | None) -> str:
    return unicodedata.normalize("NFC", name or "").strip().casefold()


def _document_key(document: dict[str, Any]) -> str:
    if document.get("id"):
        return f"id:{document['id']}"
    return f"{document.get('shelf', 'stored')}:{_key(document.get('name'))}"


def clamp_region(region: Any) -> list[float] | None:
    if region is None:
        return None
    try:
        x, y, w, h = (min(1.0, max(0.0, float(share))) for share in region)
    except TypeError, ValueError:
        return None
    w, h = min(w, 1 - x), min(h, 1 - y)
    if w <= 0 or h <= 0:
        return None
    return [round(x, 4), round(y, 4), round(w, 4), round(h, 4)]


def _where(region: list[float] | None) -> str | None:
    if region is None:
        return None
    x, y, w, h = region
    return where_on_the_page(SimpleNamespace(x=x, y=y, w=w, h=h))


def _hold(document: dict[str, Any], item: dict[str, Any], read: str = "") -> int | None:
    registry = get_card_registry()
    if registry is None:
        return None
    entry: dict[str, Any] = {"document": document, "item": item}
    if read:
        entry["read"] = read
    return registry.hold(HELD, entry)


def looked_document(resolved: Any) -> dict[str, Any]:
    target = getattr(resolved, "target", None)
    document_id = getattr(target, "document_id", None) if target is not None else None
    base = target is None and not getattr(resolved, "collection", "")
    document: dict[str, Any] = {"name": resolved.file_name, "shelf": "base" if base else "stored"}
    if document_id:
        document["id"] = document_id
    return document


def note_look(
    resolved: Any,
    page: int,
    region: Any = None,
    image_index: int | None = None,
    question: str = "",
    reading: str = "",
    revision_id: str | None = None,
    read: str = "",
) -> None:
    try:
        document = looked_document(resolved)
        box = clamp_region(region)
        frame = "image" if image_index is not None else "page"
        item: dict[str, Any] = {
            "origin": "look",
            "page": max(1, int(page or 1)),
            "frame": frame,
            "scope": "region" if box is not None else "overview",
        }
        optional = {
            "region": box,
            "image_index": image_index,
            "revision_id": revision_id,
            "question": (question or "").strip()[:200] or None,
            "reading": (reading or "").strip()[:300] or None,
            "where": _where(box) if frame == "page" else None,
        }
        item.update({key: value for key, value in optional.items() if value is not None})
        number = _hold(document, item, read=(read or "").strip())
        if not _may_show(resolved):
            return
        emit_look_step(
            number if number is not None else uuid4().hex[:8],
            document_name=document["name"],
            document_id=document.get("id"),
            revision_id=revision_id,
            shelf=document["shelf"],
            page=item["page"],
            region=box,
            image_index=image_index,
            where=item.get("where"),
            question=item.get("question"),
            reading=item.get("reading"),
        )
    except Exception:  # noqa: BLE001 - showing a look is never worth the look
        logger.warning("A look could not be recorded for the card and the Herleitung", exc_info=True)


def _may_show(resolved: Any) -> bool:
    from agent.knowledge.restricted_use import may_name

    return may_name(getattr(resolved, "collection", "") or None)


def note_reference(
    document: dict[str, str],
    page: int,
    *,
    region: Sequence[float] | None = None,
    point: Sequence[float] | None = None,
    label: str = "",
) -> None:
    try:
        box = clamp_region(region)
        item: dict[str, Any] = {"origin": "reference", "page": max(1, int(page or 1)), "frame": "page"}
        if box is not None:
            item.update(scope="region", region=box, where=_where(box))
        elif point is not None:
            item.update(scope="point", point=[round(min(1.0, max(0.0, float(v))), 4) for v in point][:2])
        else:
            return
        if text := (label or "").strip()[:80]:
            item["label"] = text
        looked: dict[str, Any] = {"name": document.get("name") or "", "shelf": "stored"}
        if document.get("id"):
            looked["id"] = document["id"]
        _hold(looked, item)
    except Exception:  # noqa: BLE001 - showing a gesture is never worth the gesture
        logger.warning("A canvas reference could not be recorded for the look card", exc_info=True)


def take_looks() -> list[dict[str, Any]]:
    registry = get_card_registry()
    return registry.take_held(HELD) if registry is not None else []


def _cited_names(cited: Iterable[Any]) -> set[str]:
    from agent.citations.wire import source_entry_to_wire

    names: set[str] = set()
    for source in cited:
        entry = getattr(source, "entry", source)
        try:
            file_name = source_entry_to_wire(entry).get("file_name")
        except Exception:  # noqa: BLE001 - an unreadable source names no document
            continue
        if file_name:
            names.add(_key(str(file_name).rsplit("/", 1)[-1]))
    return names


_NOTHING_FOUND_RE = re.compile(
    r"\b(?:nothing|none|not\s+(?:visible|legible|readable|shown|present|found|recognisable|recognizable)"
    r"|no\s+\w+(?:\s+\w+)?\s+(?:visible|found|shown|present|legible))\b"
    r"|\bnichts\b|\bnicht\s+(?:erkennbar|sichtbar|lesbar|vorhanden|zu\s+sehen|zu\s+erkennen|gefunden)\b"
    r"|\bkein\w*\s+(?:\w+\s+){0,2}(?:erkennbar|sichtbar|lesbar|vorhanden|gefunden)\b",
    re.IGNORECASE,
)


def reports_nothing(reading: str | None) -> bool:
    return not (reading or "").strip() or _NOTHING_FOUND_RE.search(reading or "") is not None


def _evidence(entry: dict[str, Any]) -> bool:
    return entry["item"]["origin"] == "look" and not reports_nothing(entry["item"].get("reading"))


def relied_on(held: Sequence[dict[str, Any]], cited_names: set[str]) -> list[dict[str, Any]]:
    looked = {
        _document_key(e["document"]): e["document"] for e in held if e["item"]["origin"] == "look" and _evidence(e)
    }
    relied = {key for key, document in looked.items() if _key(document.get("name")) in cited_names}
    crops = {_document_key(e["document"]) for e in held if _evidence(e) and e["item"].get("scope") == "region"}
    return [
        entry
        for entry in held
        if entry["item"]["origin"] == "reference"
        or (
            _evidence(entry)
            and _document_key(entry["document"]) in relied
            and (entry["item"].get("scope") == "region" or _document_key(entry["document"]) not in crops)
        )
    ]


def relied_readings(held: Sequence[dict[str, Any]], cited: Iterable[Any] = ()) -> list[str]:
    try:
        looks = [e for e in held if e["item"]["origin"] == "look"]
        names = _cited_names(cited)
        mine = [e for e in looks if _key(e["document"].get("name")) in names] or looks
    except Exception:  # noqa: BLE001 - provenance is never worth the answer
        logger.warning("Could not decide which readings the answer relies on", exc_info=True)
        return []
    return [str(e.get("read") or e["item"]["reading"]) for e in mine if e.get("read") or e["item"].get("reading")]


def place_look_cards(held: Sequence[dict[str, Any]], cited: Iterable[Any] = ()) -> int:
    registry = get_card_registry()
    if registry is None or not held:
        return 0
    try:
        kept = relied_on(held, _cited_names(cited))
    except Exception:  # noqa: BLE001 - cards are an enhancement, never the answer
        logger.warning("Could not decide which looks the answer relies on", exc_info=True)
        return 0
    landed = 0
    for entry in kept:
        document, key = entry["document"], _document_key(entry["document"])

        def owns(card: dict[str, Any], key: str = key) -> bool:
            return card.get("type") == CARD_TYPE and _document_key(card.get("document") or {}) == key

        def build(items: list[dict[str, Any]], document: dict[str, Any] = document) -> dict[str, Any]:
            card = {"type": CARD_TYPE, "document": document, "items": items}
            return answer_card_adapter.validate_python(card).model_dump(exclude_none=True)

        if extend_or_add(registry, entry["item"], owns=owns, build=build, max_items=MAX_LOOK_ITEMS) is not None:
            landed += 1
    return landed


def drawing_value_status(
    held: Sequence[dict[str, Any]], content: str, cited: Iterable[Any], readings: Sequence[str] = ()
) -> tuple[bool, bool]:
    try:
        from agent.citations.wire import source_entry_to_wire

        drawn = [
            source.entry
            for source in cited
            if getattr(source, "number", None) is not None and (source.entry.read or source.entry.regions)
        ]
        files = [source_entry_to_wire(entry).get("file_name") for entry in drawn]
        names = {_key(str(name).rsplit("/", 1)[-1]) for name in files if name}
        text = content.casefold()
        stated = bool(drawn) or any(reading and reading.casefold() in text for reading in readings)
        if not stated:
            return False, False
        crops = [e for e in held if e["item"]["origin"] == "look" and e["item"].get("scope") == "region"]
        return True, any(not names or _key(e["document"].get("name")) in names for e in crops)
    except Exception:  # noqa: BLE001 - a score is never worth the answer
        logger.warning("Could not decide whether a drawing value was looked at", exc_info=True)
        return False, False
