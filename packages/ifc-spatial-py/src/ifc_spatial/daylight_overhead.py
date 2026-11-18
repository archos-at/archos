from __future__ import annotations

import itertools
from typing import Any

from . import operators as op
from .envelope import Answer
from .envelope import MissingFact
from .envelope import computed
from .envelope import undecidable
from .model import AIR_TYPES
from .model import SpatialModel

OVERHEAD_SAMPLES = 5
OVERHEAD_OFFSET = 0.01


def _is_excluded(element: Any) -> bool:
    if element.is_a() in AIR_TYPES:
        return True
    return any(_is_kind(element, kind) for kind in op.FURNISHING)


def _is_kind(element: Any, kind: str) -> bool:
    try:
        return bool(element.is_a(kind))
    except Exception:
        return False


def _overhead(model: SpatialModel, global_id: str, upward: bool, samples: int) -> Answer[list[dict[str, Any]]]:
    direction = "above" if upward else "below"
    method = f"{direction}({global_id}, samples={samples})"
    subject = op._require(model, global_id, method)
    geo, missing = op._geometry_or_answer(model, subject, method)
    if geo is None:
        return missing  # type: ignore[return-value]

    low, high = geo.box
    thickness = float(high[2] - low[2])
    start_z = float(high[2]) + OVERHEAD_OFFSET if upward else float(low[2]) - OVERHEAD_OFFSET
    scan = (0.0, 0.0, 1.0) if upward else (0.0, 0.0, -1.0)
    back = (0.0, 0.0, -1.0) if upward else (0.0, 0.0, 1.0)
    reach = model.diagonal
    tree = model.tree
    found, tested = _scan(model, global_id, (low, high), start_z, thickness, (scan, back), samples, reach, tree)

    if tested == 0:
        return undecidable(
            from_=[global_id],
            method=method,
            provenance="computed",
            missing=MissingFact(
                what="kein Rasterpunkt lag über bzw. unter diesem Bauteil",
                remedy=(
                    f"Das Raster von {samples}×{samples} Punkten über der Hüllbox hat das Bauteil selbst nicht "
                    f"getroffen — es ist dafür zu schmal oder zu zerklüftet. {direction}() mit einem höheren "
                    "samples-Wert aufrufen."
                ),
                elements=[global_id],
            ),
        )

    result = sorted(found.values(), key=lambda f: (f["gap"], f["globalId"]))
    for entry in result:
        entry["gap"] = round(float(entry["gap"]), 4)
        entry["gapMax"] = round(float(entry["gapMax"]), 4)

    word = "über" if upward else "unter"
    caveat = _overhead_caveat(word, tested, samples, result, reach)

    return computed(
        result,
        unit="m",
        tolerance=op.DIMENSION_TOLERANCE,
        from_=[global_id, *[entry["globalId"] for entry in result]],
        method=method,
        caveat=caveat,
    )


def _scan(
    model: SpatialModel,
    global_id: str,
    box: tuple[Any, Any],
    start_z: float,
    thickness: float,
    rays: tuple[tuple[float, float, float], tuple[float, float, float]],
    samples: int,
    reach: float,
    tree: Any,
) -> tuple[dict[str, dict[str, Any]], int]:
    low, high = box
    found: dict[str, dict[str, Any]] = {}
    tested = 0
    for ix, iy in itertools.product(range(samples), repeat=2):
        x = float(low[0] + (high[0] - low[0]) * (ix + 0.5) / samples)
        y = float(low[1] + (high[1] - low[1]) * (iy + 0.5) / samples)
        if _scan_point(model, global_id, found, (x, y, start_z), thickness, rays, reach, tree):
            tested += 1
    return found, tested


def _scan_point(
    model: SpatialModel,
    global_id: str,
    found: dict[str, dict[str, Any]],
    origin: tuple[float, float, float],
    thickness: float,
    rays: tuple[tuple[float, float, float], tuple[float, float, float]],
    reach: float,
    tree: Any,
) -> bool:
    scan, back = rays
    hits_back = tree.select_ray(origin, back, length=thickness + 2 * OVERHEAD_OFFSET)
    if not any(model.file.by_id(h.instance.id()).GlobalId == global_id for h in hits_back):
        return False

    here = {e.GlobalId for e in tree.select(origin)}
    seen: set[str] = set()
    for global_id_here in here:
        element = model.file.by_guid(global_id_here)
        if global_id_here == global_id or _is_excluded(element):
            continue
        seen.add(global_id_here)
        _record(found, model, element, 0.0)

    for hit in tree.select_ray(origin, scan, length=reach):
        element = model.file.by_id(hit.instance.id())
        if element.GlobalId == global_id or element.GlobalId in seen or _is_excluded(element):
            continue
        if element.GlobalId in here:
            continue
        seen.add(element.GlobalId)
        _record(found, model, element, float(hit.distance) + OVERHEAD_OFFSET)
    return True


def _overhead_caveat(word: str, tested: int, samples: int, result: list[dict[str, Any]], reach: float) -> str:
    caveat = (
        f"Senkrecht {word} der Hüllbox dieses Bauteils gemessen (geom.tree.select_ray), aus {tested} von "
        f"{samples * samples} Rasterpunkten, die wirklich über dem Körper liegen. `gap` ist der kleinste, "
        "`gapMax` der größte Abstand, den ein Rasterpunkt zu diesem Bauteil gefunden hat — bei einem geneigten "
        "Dach liegen die beiden weit auseinander; `samples` sagt, über wie vielen Punkten es steht. "
        "Ein Abstand von 0 heißt Berührung oder Durchdringung: der Strahl startete bereits in diesem Körper. "
        "Möblierung (IfcFurnishingElement, IfcFurniture) und Luftkörper (IfcSpace, IfcOpeningElement) sind "
        "ausgenommen — ein unbefiltertes Raster über der Bodenplatte dieses Modells meldet sonst eine Couch "
        "in 0,135 m als das, was über dem Boden liegt. Ein Raster kann ein schmales Bauteil zwischen zwei "
        "Punkten verfehlen; die Liste ist damit keine Vollständigkeitsaussage."
    )
    if not result:
        caveat += (
            f" Kein Bauteil {word} diesem: über allen geprüften Rasterpunkten ist bis zum Modellrand "
            f"({reach:.1f} m) nichts. Das ist ein Ergebnis, kein fehlender Wert."
        )
    return caveat


def _record(found: dict[str, dict[str, Any]], model: SpatialModel, element: Any, gap: float) -> None:
    entry = found.get(element.GlobalId)
    if entry is None:
        found[element.GlobalId] = {
            "globalId": element.GlobalId,
            "name": model.label(element),
            "ifcType": element.is_a(),
            "gap": gap,
            "gapMax": gap,
            "samples": 1,
        }
        return
    entry["gap"] = min(float(entry["gap"]), gap)
    entry["gapMax"] = max(float(entry["gapMax"]), gap)
    entry["samples"] = int(entry["samples"]) + 1


def above(model: SpatialModel, global_id: str, samples: int = OVERHEAD_SAMPLES) -> Answer[list[dict[str, Any]]]:
    return _overhead(model, global_id, upward=True, samples=samples)


def below(model: SpatialModel, global_id: str, samples: int = OVERHEAD_SAMPLES) -> Answer[list[dict[str, Any]]]:
    return _overhead(model, global_id, upward=False, samples=samples)
