from __future__ import annotations

from typing import Literal

MAX_SURFACED_FILES = 3

MIN_SURFACE_SCORE = 0.455

MANY_RELATIVE_DROP = 0.128

CLEAR_WINNER_GAP = 0.15

_IMAGE_EXT = (".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".tif", ".tiff")
_MODEL_EXT = (".ifc", ".ifczip")
_QUERY_KIND_HINTS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("image", ("screenshot", "bildschirm", "png", "jpg", "jpeg", "foto", "photo", "zitation", "citation", "zitier")),
    ("model", ("ifc", "bim", "modell")),
)

SurfaceMode = Literal["one", "many"]


def _file_kind(file_name: str) -> str:
    lower = (file_name or "").lower()
    if lower.endswith(_MODEL_EXT):
        return "model"
    if lower.endswith(_IMAGE_EXT):
        return "image"
    if any(token in lower for token in ("grundriss", "schnitt", "ansicht", "lageplan")):
        return "drawing"
    return "document"


def _query_kind(query: str) -> str | None:
    text = (query or "").strip().lower()
    if not text:
        return None
    for kind, tokens in _QUERY_KIND_HINTS:
        if any(token in text for token in tokens):
            return kind
    return None


def _aggregate_hits(hits: list[tuple[object, str]]) -> list[dict]:
    best: dict[str, dict] = {}
    for chunk, source in hits:
        file_name = getattr(chunk, "file_name", None)
        if not file_name:
            continue
        score = float(getattr(chunk, "score", 0.0) or 0.0)
        if score < MIN_SURFACE_SCORE:
            continue
        existing = best.get(file_name)
        if existing is not None and existing["score"] >= score:
            continue
        snippet = (getattr(chunk, "content", "") or "").strip()
        if len(snippet) > 300:
            snippet = snippet[:300].rstrip() + "…"
        best[file_name] = {
            "file_name": file_name,
            "snippet": snippet or None,
            "page": getattr(chunk, "page_number", None),
            "score": round(score, 4),
            "source": source,
        }
    return sorted(best.values(), key=lambda row: row["score"], reverse=True)


def _pick_one(ordered: list[dict]) -> list[dict]:
    return ordered[:1]


def _pick_many(ordered: list[dict], max_files: int) -> list[dict]:
    if not ordered:
        return []
    winner = ordered[0]
    if len(ordered) == 1:
        return [winner]
    best = float(winner["score"] or 0.0)
    second = float(ordered[1]["score"] or 0.0)
    if best - second >= CLEAR_WINNER_GAP:
        return [winner]
    winner_kind = _file_kind(str(winner["file_name"]))
    cap = max(1, min(max_files, MAX_SURFACED_FILES))
    floor = max(MIN_SURFACE_SCORE, best - MANY_RELATIVE_DROP)
    kept = [winner]
    for row in ordered[1:]:
        if len(kept) >= cap:
            break
        if _file_kind(str(row["file_name"])) != winner_kind:
            continue
        if float(row["score"] or 0.0) < floor:
            continue
        kept.append(row)
    return kept


def _aggregate_surfaced(
    hits: list[tuple[object, str]],
    max_files: int,
    mode: SurfaceMode = "one",
    query: str = "",
) -> list[dict]:
    ordered = _aggregate_hits(hits)
    hint = _query_kind(query)
    if hint:
        hinted = [row for row in ordered if _file_kind(str(row["file_name"])) == hint]
        if hinted:
            ordered = hinted
    if mode == "many":
        return _pick_many(ordered, max_files)
    return _pick_one(ordered)


def _pick_browse(rows: list[dict], query: str, max_files: int) -> list[dict]:
    hint = _query_kind(query)
    if hint:
        hinted = [row for row in rows if _file_kind(row["file_name"]) == hint]
        rows = hinted or rows
    if not rows:
        return []
    kind = _file_kind(rows[0]["file_name"])
    cap = max(1, min(max_files, MAX_SURFACED_FILES))
    return [row for row in rows if _file_kind(row["file_name"]) == kind][:cap]
