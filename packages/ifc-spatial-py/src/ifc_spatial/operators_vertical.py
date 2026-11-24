from __future__ import annotations

import math
from typing import Any

import numpy as np
from shapely.geometry import Point as ShapelyPoint

from ifc_spatial.operators_constants import AZIMUTH_TOLERANCE_DEGREES
from ifc_spatial.operators_constants import COMPASS
from ifc_spatial.operators_constants import COORDINATE_TOLERANCE
from ifc_spatial.operators_constants import DIMENSION_TOLERANCE
from ifc_spatial.operators_constants import FENESTRATION
from ifc_spatial.operators_constants import FURNISHING
from ifc_spatial.operators_constants import MIN_INTRUSION
from ifc_spatial.operators_guards import _geometry_or_answer
from ifc_spatial.operators_guards import _require
from ifc_spatial.operators_guards import _wrong_kind

from .envelope import Answer
from .envelope import MissingFact
from .envelope import computed
from .envelope import undecidable
from .geometry import VERTICAL_TOLERANCE
from .geometry import box_gap
from .geometry import boxes_overlap
from .geometry import dominant_plane
from .geometry import dominant_vertical_plane
from .geometry import plan_footprint
from .model import AIR_TYPES
from .model import SpatialModel


def elevation(model: SpatialModel, global_id: str) -> Answer[dict[str, Any]]:
    method = f"elevation({global_id})"
    subject = _require(model, global_id, method)
    geo, missing = _geometry_or_answer(model, subject, method)
    if geo is None:
        return missing  # type: ignore[return-value]

    bottom = float(geo.box[0][2])
    top = float(geo.box[1][2])
    drift = _storey_datum_drift(model)
    datum = None if drift > 0 else model.storey_datum(subject)

    caveat = None
    if datum is None:
        mismatch = _datum_mismatch(model, drift) if drift > 0 else None
        caveat = (
            f"{mismatch.what}. {mismatch.remedy}"
            if mismatch
            else (
                "Dieses Bauteil ist keinem Geschoss mit Höhenangabe zugeordnet — die Höhe über dem Geschoss "
                "ist deshalb offen. Die absoluten Höhen beziehen sich auf den Projektnullpunkt."
            )
        )

    return computed(
        {
            "bottom": bottom,
            "top": top,
            "heightAboveStorey": None if datum is None else bottom - datum.elevation,
        },
        unit="m",
        tolerance=COORDINATE_TOLERANCE,
        from_=[global_id] if datum is None else [global_id, datum.global_id],
        method=method,
        caveat=caveat,
    )


def sill_and_head(model: SpatialModel, global_id: str) -> Answer[dict[str, float]]:
    method = f"sillAndHead({global_id})"
    subject = _require(model, global_id, method)
    if subject.is_a() not in FENESTRATION:
        _wrong_kind(
            subject,
            method,
            "sillAndHead",
            "ein Fenster, eine Tür oder eine Öffnung",
            "für die absolute Höhe eines beliebigen Bauteils: elevation(); für seine Abmessungen: extent()",
        )
    geo, missing = _geometry_or_answer(model, subject, method)
    if geo is None:
        return missing  # type: ignore[return-value]

    datum = model.storey_datum(subject)
    if datum is None:
        name = model.label(subject) or global_id
        return undecidable(
            from_=[global_id],
            method=method,
            provenance="computed",
            missing=MissingFact(
                what=f"IfcBuildingStorey.Elevation für {subject.is_a()} „{name}“",
                remedy=(
                    "Das Bauteil einem Geschoss zuordnen (IfcRelContainedInSpatialStructure) und die "
                    "Geschosshöhe setzen. Ohne Geschossnull ist eine Brüstungshöhe nicht bestimmbar — die "
                    "absolute Höhe über dem Projektnullpunkt liefert elevation()."
                ),
                elements=[global_id],
            ),
        )

    drift = _storey_datum_drift(model)
    if drift > 0:
        return undecidable(
            from_=[global_id, datum.global_id],
            method=method,
            provenance="computed",
            missing=_datum_mismatch(model, drift),
        )

    sill = float(geo.box[0][2]) - datum.elevation
    head = float(geo.box[1][2]) - datum.elevation
    return computed(
        {"sill": sill, "head": head, "height": head - sill},
        unit="m",
        tolerance=DIMENSION_TOLERANCE,
        from_=[global_id, datum.global_id],
        method=method,
        caveat=(
            f"Höhen über der Geschossebene „{datum.name or datum.global_id}“ ({datum.elevation} m). "
            "Gemessen an der Rohbauöffnung bzw. am Bauteilkörper — ein Fußbodenaufbau über der Geschossebene "
            "verringert die tatsächliche Brüstungshöhe um seine Dicke."
        ),
    )


def azimuth(model: SpatialModel, global_id: str) -> Answer[dict[str, Any]]:
    method = f"azimuth({global_id})"
    subject = _require(model, global_id, method)

    if model.true_north is None:
        return undecidable(
            from_=[global_id],
            method=method,
            provenance="computed",
            missing=MissingFact(
                what="IfcGeometricRepresentationContext.TrueNorth",
                remedy=(
                    "Die Nordrichtung im Modell setzen und mitexportieren. Ohne sie ist jede Himmelsrichtung "
                    'geraten: ein um 40° gedrehtes Gebäude würde als "Südfassade" berichtet, und der Fehler ist '
                    "an der Antwort nicht zu erkennen."
                ),
            ),
        )

    geo, missing = _geometry_or_answer(model, subject, method)
    if geo is None:
        return missing  # type: ignore[return-value]

    face = dominant_plane(geo.triangles)
    normal = dominant_vertical_plane(geo.triangles) if face is not None else None
    if normal is None or abs(float(face[2])) >= VERTICAL_TOLERANCE:  # type: ignore[index]
        name = model.label(subject) or global_id
        tilt = None if face is None else math.degrees(math.asin(min(1.0, abs(float(face[2])))))
        return undecidable(
            from_=[global_id],
            method=method,
            provenance="computed",
            missing=MissingFact(
                what=f"eine senkrechte Hauptfläche an {subject.is_a()} „{name}“",
                remedy=(
                    "Die Himmelsrichtung wird aus der Hauptfläche eines Bauteils bestimmt, und die ist hier "
                    + (
                        "nicht senkrecht"
                        if tilt is None
                        else f"um {tilt:.0f}° gegen die Senkrechte geneigt (waagrecht wären 90°)"
                    )
                    + " — eine Decke, ein Bodenaufbau, ein Flachdach. Ein waagrechtes Bauteil hat keine "
                    "Fassadenrichtung; die Schmalseiten seines Randes sind keine. Für die Ausrichtung eines "
                    "Raumes die begrenzende Außenwand abfragen: bounds() liefert sie."
                ),
                elements=[global_id],
            ),
        )

    centre = model.plan_centre
    if centre is None:
        return undecidable(
            from_=[global_id],
            method=method,
            provenance="computed",
            missing=MissingFact(
                what="keine Modellausdehnung (kein Bauteil mit Geometrie)",
                remedy=(
                    "Ohne die Grundriss-Mitte des Modells lässt sich nicht entscheiden, welche der beiden "
                    "Flächennormalen nach außen zeigt. Das Modell mit Geometrie exportieren."
                ),
            ),
        )

    away = geo.centroid[:2] - centre[:2]
    n = normal[:2].copy()
    if float(n @ away) < 0:
        n = -n

    theta = model.true_north
    north = np.array([np.sin(theta), np.cos(theta)])
    east = np.array([north[1], -north[0]])
    raw_degrees = float(np.degrees(np.arctan2(float(n @ east), float(n @ north))))
    degrees = math.fmod(math.fmod(raw_degrees, 360.0) + 360.0, 360.0)

    return computed(
        {"degrees": degrees, "compass": COMPASS[int(round(degrees / 22.5)) % 16]},
        unit="°",
        tolerance=AZIMUTH_TOLERANCE_DEGREES,
        from_=[global_id],
        method=method,
        caveat=(
            "Außen ist die Normale, die von der Grundriss-Mitte des Modells wegzeigt. Für eine Wand am "
            "Innenhof oder in einem einspringenden Baukörper kann das die falsche Seite sein — dann ist die "
            "Angabe um 180° gedreht."
        ),
    )


def distance(model: SpatialModel, a: str, b: str, mode: str = "min") -> Answer[float]:
    method = f"distance({a}, {b}, '{mode}')"
    first = _require(model, a, method)
    second = _require(model, b, method)
    geo_a, missing = _geometry_or_answer(model, first, method, [a, b])
    if geo_a is None:
        return missing  # type: ignore[return-value]
    geo_b, missing = _geometry_or_answer(model, second, method, [a, b])
    if geo_b is None:
        return missing  # type: ignore[return-value]

    if mode == "min":
        gap = box_gap(geo_a.box, geo_b.box)
        overlapping = boxes_overlap(geo_a.box, geo_b.box)
        value = 0.0 if overlapping else float(np.linalg.norm(np.maximum(gap, 0.0)))
        return computed(
            value,
            unit="m",
            tolerance=DIMENSION_TOLERANCE,
            from_=[a, b],
            method=method,
            caveat=(
                "Die Hüllboxen der beiden Bauteile überschneiden sich, der Abstand ist deshalb 0 m. Das heißt "
                "NICHT, dass sich die Körper berühren — eine achsparallele Hüllbox ist großzügiger als das "
                "Bauteil darin. Für eine echte Kollision sind die Flächen zu prüfen."
                if overlapping
                else "Abstand zwischen den achsparallelen Hüllboxen, nicht zwischen den Körpern. Für ein schräg "
                "stehendes oder nicht quaderförmiges Bauteil ist der wahre Abstand größer, nie kleiner."
            ),
        )

    ca, cb = geo_a.centroid, geo_b.centroid
    if mode == "centroid":
        value = float(np.linalg.norm(ca - cb))
    elif mode == "horizontal":
        value = float(np.linalg.norm(ca[:2] - cb[:2]))
    elif mode == "vertical":
        value = float(abs(ca[2] - cb[2]))
    else:
        return undecidable(
            from_=[a, b],
            method=method,
            provenance="computed",
            missing=MissingFact(
                what=f"unbekannter Abstandsbegriff „{mode}“",
                remedy="distance() kennt 'min', 'centroid', 'horizontal' und 'vertical'.",
            ),
        )

    return computed(
        value,
        unit="m",
        tolerance=DIMENSION_TOLERANCE,
        from_=[a, b],
        method=method,
        caveat=(
            "Gemessen zwischen den Schwerpunkten. Diese sind flächengewichtet über die Dreiecke des Netzes, "
            "nicht der Volumenschwerpunkt — bei stark ungleich vernetzten Bauteilen kann der Punkt um einige "
            "Zentimeter wandern."
        ),
    )


def clear_height(model: SpatialModel, space_global_id: str, samples: int = 5) -> Answer[float]:
    method = f"clearHeight({space_global_id}, samples={samples})"
    subject = _require(model, space_global_id, method)
    if model.kind_of(subject) != "space":
        _wrong_kind(
            subject,
            method,
            "clearHeight",
            "einen Raum (IfcSpace)",
            "für die Höhe eines Bauteils: extent() liefert sie als height",
        )
    geo, missing = _geometry_or_answer(model, subject, method)
    if geo is None:
        return missing  # type: ignore[return-value]

    low, high = geo.box
    modelled = float(high[2] - low[2])
    floor_z = float(low[2]) + 0.01

    tree = model.tree
    footprint = plan_footprint(geo.verts[geo.faces])
    tested = 0
    shortest = modelled
    hit_by: dict[str, float] = {}
    for ix in range(samples):
        for iy in range(samples):
            x = float(low[0] + (high[0] - low[0]) * (ix + 0.5) / samples)
            y = float(low[1] + (high[1] - low[1]) * (iy + 0.5) / samples)
            if footprint is not None:
                if not footprint.covers(ShapelyPoint(x, y)):
                    continue
            elif space_global_id not in [e.GlobalId for e in tree.select((x, y, floor_z + 0.05))]:
                continue
            tested += 1
            for hit in tree.select_ray((x, y, floor_z), (0.0, 0.0, 1.0), length=modelled + 5.0):
                element = model.file.by_id(hit.instance.id())
                if element.is_a() in AIR_TYPES or any(element.is_a(name) for name in FURNISHING):
                    continue
                if element.GlobalId == space_global_id:
                    continue
                run = float(hit.distance) + (floor_z - float(low[2]))
                if run <= 0.01:
                    continue
                shortest = min(shortest, run)
                hit_by.setdefault(element.GlobalId, run)
                break

    if tested == 0:
        return undecidable(
            from_=[space_global_id],
            method=method,
            provenance="computed",
            missing=MissingFact(
                what="kein Rasterpunkt lag im Raumkörper",
                remedy=(
                    "Der Raumkörper ist für dieses Raster zu schmal oder zu zerklüftet. extent() liefert "
                    "die Höhe des modellierten Raumkörpers — als solche benennen, nicht als lichte Höhe: "
                    "Unterzüge und abgehängte Decken sind darin nicht berücksichtigt."
                ),
                elements=[space_global_id],
            ),
        )

    lowering = sorted(((gid, run) for gid, run in hit_by.items() if run < modelled - MIN_INTRUSION), key=lambda p: p[1])
    named = ", ".join(f"{model.label(model.file.by_guid(gid)) or gid} ({run:.3f} m)" for gid, run in lowering[:3])
    caveat = (
        f"Lichte Höhe aus {tested} von {samples * samples} Rasterpunkten, senkrecht nach oben gemessen "
        f"(geom.tree.select_ray). Der modellierte Raumkörper ist {modelled:.3f} m hoch. "
        + (
            f"Darunter hängt: {named}. "
            if lowering
            else "Kein Bauteil ragt in den Raum — lichte Höhe und Raumkörper stimmen überein. "
        )
        + "Möblierung (IfcFurnishingElement) ist ausgenommen. Ein Raster kann eine schmale Unterzugslage "
        "zwischen zwei Punkten verfehlen — für einen Nachweis das Raster verfeinern."
    )

    return computed(
        shortest,
        unit="m",
        tolerance=DIMENSION_TOLERANCE,
        from_=[space_global_id, *[gid for gid, _ in lowering]],
        method=method,
        caveat=caveat,
    )


def _storey_datum_drift(model: SpatialModel) -> float:
    bounds = model.bounds
    if bounds is None:
        return 0.0
    elevations = [s.elevation for s in model.storeys if s.elevation is not None]
    if not elevations:
        return 0.0
    below = float(bounds[0][2]) - 5.0 - min(elevations)
    above = max(elevations) - (float(bounds[1][2]) + 5.0)
    return max(0.0, below, above)


def _datum_mismatch(model: SpatialModel, drift: float) -> MissingFact:
    bounds = model.bounds
    elevations = [s.elevation for s in model.storeys if s.elevation is not None]
    return MissingFact(
        what="IfcBuildingStorey.Elevation und die Modellgeometrie liegen auf verschiedenen Höhenbezügen",
        remedy=(
            f"Die Geschosshöhen der Datei laufen von {min(elevations):.2f} m bis {max(elevations):.2f} m, "
            f"die gemessene Geometrie von {float(bounds[0][2]):.2f} m bis {float(bounds[1][2]):.2f} m — sie "
            f"verfehlen einander um {drift:.2f} m. Eine Höhe über Geschossebene wäre um diesen Betrag falsch "
            "und wird deshalb nicht ausgegeben. Ursache ist fast immer ein Export, dessen Geschosshöhen auf "
            "Meereshöhe bzw. den Vermessungspunkt bezogen sind, während die Bauteilkoordinaten auf dem "
            "Projektnullpunkt stehen. Abhilfe: im CAD Projekt- und Vermessungspunkt angleichen oder die "
            "Geschosshöhen auf den Projektnullpunkt beziehen. Die absoluten Höhen im Modellbezug liefert "
            "elevation() unverändert."
        ),
    )
