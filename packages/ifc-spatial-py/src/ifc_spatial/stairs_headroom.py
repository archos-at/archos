from __future__ import annotations

import math
from typing import Any

import numpy as np

from ifc_spatial.stairs_constants import HEADROOM_REACH
from ifc_spatial.stairs_constants import HEADROOM_TRANSPARENT
from ifc_spatial.stairs_constants import RAMP_TYPES
from ifc_spatial.stairs_constants import STAIR_TYPES
from ifc_spatial.stairs_ramp import _rake_samples
from ifc_spatial.stairs_ramp import _rakes_of
from ifc_spatial.stairs_reading import _flight_parts
from ifc_spatial.stairs_reading import _sources
from ifc_spatial.stairs_records import _Rake

from .clearance import CLEARANCE_BUDGET_SECONDS
from .clearance_triangles import _soup_distance
from .clearance_triangles import _usable_triangles
from .envelope import Answer
from .envelope import MissingFact
from .envelope import computed
from .envelope import undecidable
from .model import AIR_TYPES
from .model import SpatialModel
from .operators import DIMENSION_TOLERANCE
from .operators import MIN_INTRUSION
from .operators import _geometry_or_answer
from .operators import _require
from .operators import _wrong_kind


def _overhead_hits(
    model: SpatialModel, points: np.ndarray, direction: np.ndarray, exclude: set[str]
) -> tuple[float | None, dict[str, float]]:
    shortest: float | None = None
    hit_by: dict[str, float] = {}
    ray = (float(direction[0]), float(direction[1]), float(direction[2]))
    for point in points:
        origin = point + direction * MIN_INTRUSION
        nearest: tuple[float, str] | None = None
        for hit in model.tree.select_ray(
            (float(origin[0]), float(origin[1]), float(origin[2])), ray, length=HEADROOM_REACH
        ):
            element = model.file.by_id(hit.instance.id())
            if element.is_a() in AIR_TYPES or any(element.is_a(name) for name in HEADROOM_TRANSPARENT):
                continue
            if element.GlobalId in exclude:
                continue
            run = float(hit.distance) + MIN_INTRUSION
            if run <= MIN_INTRUSION:
                continue
            if nearest is None or run < nearest[0]:
                nearest = (run, element.GlobalId)
        if nearest is None:
            continue
        run, global_id = nearest
        shortest = run if shortest is None else min(shortest, run)
        hit_by[global_id] = min(hit_by.get(global_id, run), run)
    return shortest, hit_by


def _exact_clearance(model: SpatialModel, rake: _Rake, candidates: dict[str, float]) -> tuple[float | None, str | None]:
    plane_point = rake.corners.mean(axis=0)
    rectangle = np.array([rake.corners[[0, 1, 2]], rake.corners[[0, 2, 3]]])
    best: float | None = None
    culprit: str | None = None
    for global_id in candidates:
        geo = model.geometry(global_id)
        if geo is None:
            continue
        tris = _usable_triangles(geo)
        if len(tris) == 0:
            continue
        above = (((tris - plane_point) @ rake.normal) > MIN_INTRUSION).all(axis=1)
        if not above.any():
            continue
        distance, _, _, _, aborted = _soup_distance(rectangle, tris[above], CLEARANCE_BUDGET_SECONDS)
        if aborted or not math.isfinite(distance):
            continue
        if best is None or distance < best:
            best, culprit = float(distance), global_id
    return best, culprit


def headroom(model: SpatialModel, global_id: str) -> Answer[dict[str, Any]]:
    method = f"headroom({global_id})"
    subject = _require(model, global_id, method)
    if not any(subject.is_a(name) for name in (*STAIR_TYPES, *RAMP_TYPES)):
        _wrong_kind(
            subject,
            method,
            "headroom",
            "einen Treppen- oder Rampenlauf (IfcStair, IfcStairFlight, IfcRamp, IfcRampFlight)",
            "für die lichte Höhe eines Raums: clearHeight(); für einen Durchgang: clearOpeningWidth()",
        )

    flights, _, _ = _flight_parts(subject)
    bodies = flights if flights else [subject]
    readings = [(element, *_rakes_of(model, element)) for element in bodies]
    usable = [(element, rake) for element, rakes, _ in readings for rake in rakes]
    refusals = [reason for _, _, reasons in readings for reason in reasons]
    if not usable:
        geo, missing = _geometry_or_answer(model, subject, method)
        if geo is None:
            return missing  # type: ignore[return-value]
        return undecidable(
            from_=[global_id],
            method=method,
            provenance="computed",
            missing=MissingFact(
                what=f"keine gerade Lauflinie an {subject.is_a()} „{model.label(subject) or global_id}“",
                remedy=" ".join(
                    [
                        *refusals,
                        "Eine Durchgangshöhe wird senkrecht über der Lauflinie gemessen, und die ergibt sich "
                        "aus den Trittflächen bzw. der Lauffläche. Dieser Körper zeigt keine auswertbare — "
                        "die Treppe bzw. Rampe mit voller Körpergeometrie und je einem IfcStairFlight pro "
                        "Lauf neu exportieren.",
                    ]
                ),
                elements=[global_id],
            ),
        )

    excluded_self = {global_id}

    per_body = {element.GlobalId: len(rakes) for element, rakes, _ in readings}
    seen: dict[str, int] = {}
    per_flight: list[dict[str, Any]] = []
    for element, rake in usable:
        samples = _rake_samples(rake)
        exclude = {*excluded_self, element.GlobalId}
        sampled, candidates = _overhead_hits(model, samples, rake.normal, exclude)
        vertical, _ = _overhead_hits(model, samples, np.array([0.0, 0.0, 1.0]), exclude)
        exact, culprit = _exact_clearance(model, rake, candidates)
        index = seen[element.GlobalId] = seen.get(element.GlobalId, 0) + 1
        label = model.label(element)
        per_flight.append(
            {
                "globalId": element.GlobalId,
                "name": (
                    label
                    if per_body[element.GlobalId] <= 1
                    else f"{label or element.GlobalId} — Lauf {index} von {per_body[element.GlobalId]}"
                ),
                "headroom": exact if exact is not None else sampled,
                "sampledPerpendicular": sampled,
                "vertical": vertical,
                "obstructedBy": culprit or (min(candidates, key=candidates.get) if candidates else None),
                "samples": int(len(samples)),
            }
        )

    obstructed = [f for f in per_flight if f["headroom"] is not None]
    if not obstructed:
        return computed(
            {
                "headroom": None,
                "vertical": None,
                "obstructed": False,
                "searchedTo": HEADROOM_REACH,
                "flights": per_flight,
            },
            unit="m",
            tolerance=DIMENSION_TOLERANCE,
            from_=[global_id],
            method=method,
            caveat=(
                f"Über diesem Lauf liegt innerhalb von {HEADROOM_REACH:.1f} m kein Bauteil — in dieser Datei "
                "begrenzt nichts die Durchgangshöhe. Das ist eine Aussage über den Export und nicht über das "
                "Gebäude: meist fehlt das Geschoss darüber, seltener steht die Treppe tatsächlich im Freien. "
                "Möblierung (IfcFurnishingElement) und Luftkörper (IfcSpace, IfcOpeningElement) halten hier "
                "grundsätzlich nichts auf."
            ),
        )

    tightest = min(obstructed, key=lambda f: f["headroom"])
    culprit = tightest["obstructedBy"]
    culprit_name = None
    if culprit:
        try:
            culprit_name = model.label(model.file.by_guid(culprit)) or culprit
        except RuntimeError, KeyError:
            culprit_name = culprit

    value = {
        "headroom": tightest["headroom"],
        "vertical": tightest["vertical"],
        "obstructed": True,
        "obstructedBy": culprit,
        "searchedTo": HEADROOM_REACH,
        "flights": per_flight,
    }

    caveats = [
        "Lichte Durchgangshöhe, senkrecht zur Lauflinie gemessen — nicht lotrecht. Die enge Stelle einer "
        "Treppe ist die Kante der Decke darüber, und ein senkrecht nach oben gemessener Wert geht daran "
        "vorbei."
    ]
    if tightest["vertical"] is not None and tightest["headroom"] is not None:
        difference = tightest["vertical"] - tightest["headroom"]
        if difference > DIMENSION_TOLERANCE:
            caveats.append(
                f"Lotrecht gemessen wären es {tightest['vertical']:.3f} m, also {difference:.3f} m mehr als "
                f"die tatsächlich durchgehende Höhe von {tightest['headroom']:.3f} m."
            )
    if culprit_name:
        caveats.append(f"Die engste Stelle liegt unter: {culprit_name}.")
    if len(per_flight) > 1:
        split_body = any(count > 1 for count in per_body.values())
        caveats.append(
            f"Gemessen über {len(per_flight)} Läufen; ausgewiesen ist der engste."
            + (
                " Läuft ein Lauf über einen anderen desselben Körpers hinweg, kann er ihn hier nicht "
                "begrenzen — die Datei müsste dafür je Lauf ein eigenes IfcStairFlight führen."
                if split_body
                else ""
            )
        )
    if refusals:
        caveats.append("Ein Teil dieses Körpers ist nicht mitgemessen: " + " ".join(refusals))
    caveats.append(
        "Gemessen von der Ebene durch die Stufenvorderkanten (bei einer Rampe: von der Lauffläche) bis zur "
        "Oberfläche des nächstliegenden Bauteils darüber, über der mittleren Hälfte der Laufbreite. "
        "Möblierung ist ausgenommen; Unterzüge, abgehängte Decken, Leitungen und auch ein Geländer, das "
        "tatsächlich über der Lauflinie steht, zählen mit, soweit sie als Körper im Modell stehen."
    )

    return computed(
        value,
        unit="m",
        tolerance=DIMENSION_TOLERANCE,
        from_=_sources(global_id, *[f["globalId"] for f in per_flight], *([culprit] if culprit else [])),
        method=method,
        caveat=" ".join(caveats),
    )
