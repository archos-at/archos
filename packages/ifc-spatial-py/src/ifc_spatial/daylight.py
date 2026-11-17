from __future__ import annotations

import datetime as dt
import math
from typing import Any

import numpy as np

from . import operators as op
from .envelope import Answer
from .envelope import MissingFact
from .envelope import computed
from .envelope import undecidable
from .geometry import triangle_normals_areas
from .model import AIR_TYPES
from .model import SpatialModel

SOLAR_TOLERANCE_DEGREES = 0.01
SOLAR_TOLERANCE_DEGREES_EXTRAPOLATED = 0.1

OVERHEAD_SAMPLES = 5
OVERHEAD_OFFSET = 0.01
CORNER_ROOM_SHARE = 0.5
RECTANGULARITY_TOLERANCE = 0.005

CURTAIN_WALL_TYPES = ("IfcPlate", "IfcMember", "IfcCurtainWall")


def _footprint_points(triangles: np.ndarray) -> np.ndarray | None:
    import shapely
    import shapely.ops

    if triangles is None or len(triangles) == 0:
        return None
    normals, _ = triangle_normals_areas(triangles)
    best_area = 0.0
    best: Any = None
    for sign in (1.0, -1.0):
        facing = triangles[normals[:, 2] * sign > 0.01]
        if len(facing) == 0:
            continue
        polygons = []
        for tri in facing:
            polygon = shapely.Polygon(tri[:, :2])
            if polygon.is_valid and polygon.area > 0:
                polygons.append(polygon)
        if not polygons:
            continue
        try:
            merged = shapely.ops.unary_union(polygons)
        except Exception:
            continue
        if merged.area > best_area:
            best_area = merged.area
            best = merged
    if best is None or best.is_empty:
        return None

    coords: list[tuple[float, float]] = []
    for part in getattr(best, "geoms", [best]):
        exterior = getattr(part, "exterior", None)
        if exterior is None:
            continue
        coords.extend((float(x), float(y)) for x, y in exterior.coords)
        for ring in part.interiors:
            coords.extend((float(x), float(y)) for x, y in ring.coords)
    return np.array(coords) if coords else None


def _extent_along(points: np.ndarray, direction: np.ndarray) -> float:
    projected = points @ direction
    return float(projected.max() - projected.min())


def _aperture_area(model: SpatialModel, element: Any) -> float | None:
    for rel in getattr(element, "FillsVoids", []) or []:
        area = op._clear_opening_area(model, rel.RelatingOpeningElement)
        if area:
            return area
    return op._clear_opening_area(model, element)


def _facade_candidates(model: SpatialModel, space_global_id: str, bounding: list[Any]) -> list[dict[str, Any]]:
    external: dict[str, dict[str, Any]] = {}
    for element in bounding:
        if model.kind_of(element) != "element":
            continue
        if element.is_a() not in ("IfcWall", "IfcWallStandardCase"):
            continue
        declared = model.declared_property(element, ("IsExternal",))
        if declared is False:
            continue
        if declared is not True:
            rooms = op.enclosed_by(model, element.GlobalId)
            if not rooms.decidable or not rooms.value:
                continue
            if op._rooms_on_one_side(model, element, rooms.value) is not True:
                continue
        external[element.GlobalId] = {
            "globalId": element.GlobalId,
            "name": model.label(element),
            "ifcType": element.is_a(),
            "apertureArea": 0.0,
            "apertures": [],
        }

    for element in bounding:
        if element.is_a() not in op.FENESTRATION:
            continue
        faces_outside, _why = op._faces_outside(model, element)
        if faces_outside is not True:
            continue
        hosts_ = op.hosted_in(model, element.GlobalId)
        area = _aperture_area(model, element)
        if not area:
            continue
        for ref in hosts_.value or []:
            candidate = external.get(ref.global_id)
            if candidate is None:
                continue
            candidate["apertureArea"] = float(candidate["apertureArea"]) + float(area)
            candidate["apertures"].append(element.GlobalId)

    ranked = sorted(external.values(), key=lambda c: (-float(c["apertureArea"]), c["globalId"]))
    return ranked


def _facade_geometry(model: SpatialModel, facade_id: str, method: str) -> tuple[np.ndarray, Answer[Any] | None, bool]:
    plane = op.facade_plane_of(model, facade_id)
    if not plane.decidable or plane.value is None:
        return (
            np.zeros(2),
            undecidable(
                from_=[facade_id],
                method=method,
                provenance="computed",
                missing=plane.missing
                or MissingFact(
                    what=f"keine Fassadenebene für {facade_id}",
                    remedy="Ohne Bezugsebene ist keine Raumtiefe messbar.",
                ),
            ),
            False,
        )
    normal = np.array(plane.value["normal"], dtype=float)[:2]
    length = float(np.linalg.norm(normal))
    if length < 1e-9:
        return (
            np.zeros(2),
            undecidable(
                from_=[facade_id],
                method=method,
                provenance="computed",
                missing=MissingFact(
                    what=f"die Fassadenebene von {facade_id} steht waagrecht",
                    remedy=(
                        "Eine Raumtiefe wird senkrecht zur Fassade im Grundriss gemessen. Dieses Bauteil hat "
                        "keine senkrechte Fläche (z. B. eine Decke oder ein Flachdach) und kann die "
                        "Bezugsrichtung nicht liefern. bounds() zeigt die Wände des Raums."
                    ),
                    elements=[facade_id],
                ),
            ),
            False,
        )
    return normal / length, None, bool(plane.value["outward"])


def room_depth(
    model: SpatialModel,
    space_global_id: str,
    facade_element_global_id: str | None = None,
) -> Answer[dict[str, Any]]:
    method = f"roomDepth({space_global_id})"
    subject = op._require(model, space_global_id, method)
    if model.kind_of(subject) != "space":
        op._wrong_kind(
            subject,
            method,
            "roomDepth",
            "einen Raum (IfcSpace)",
            "für die Ausdehnung eines Bauteils: extent() liefert sie",
        )

    geo, missing = op._geometry_or_answer(model, subject, method)
    if geo is None:
        return missing  # type: ignore[return-value]

    bounding = op.bounds(model, space_global_id)
    if not bounding.decidable:
        return bounding  # type: ignore[return-value]
    bounding_elements = [model.file.by_guid(ref.global_id) for ref in (bounding.value or [])]

    candidates = _facade_candidates(model, space_global_id, bounding_elements)
    curtain_wall = [e for e in bounding_elements if e.is_a() in CURTAIN_WALL_TYPES]

    if facade_element_global_id is not None:
        facade = op._require(model, facade_element_global_id, method)
        facade_id = facade.GlobalId
        chosen = next((c for c in candidates if c["globalId"] == facade_id), None)
        why = "vom Aufrufer vorgegeben"
    else:
        chosen = candidates[0] if candidates and float(candidates[0]["apertureArea"]) > 0 else None
        if chosen is None:
            return _no_facade(model, space_global_id, method, candidates, curtain_wall)
        facade_id = str(chosen["globalId"])
        why = (
            f"größte außenliegende Öffnungsfläche der begrenzenden Außenwände "
            f"({float(chosen['apertureArea']):.4f} m² aus {len(chosen['apertures'])} Öffnung(en))"
        )

    method = f"roomDepth({space_global_id}, facade={facade_id})"
    normal, refusal, outward = _facade_geometry(model, facade_id, method)
    if refusal is not None:
        return refusal  # type: ignore[return-value]

    points = _footprint_points(geo.triangles)
    from_footprint = points is not None
    if points is None:
        points = geo.verts[:, :2]

    along = np.array([-normal[1], normal[0]])
    depth = _extent_along(points, normal)
    width = _extent_along(points, along)

    floor = op.floor_area(model, space_global_id)
    floor_value = float(floor.value) if floor.decidable and floor.value else None
    height = op.clear_height(model, space_global_id)
    height_value = float(height.value) if height.decidable and height.value else None

    facade_element = model.file.by_guid(facade_id)
    bearing = op.azimuth(model, facade_id)

    value = {
        "depth": round(depth, 4),
        "width": round(width, 4),
        "clearHeight": None if height_value is None else round(height_value, 4),
        "depthToHeight": None if not height_value else round(depth / height_value, 4),
        "floorArea": None if floor_value is None else round(floor_value, 4),
        "depthTimesWidth": round(depth * width, 4),
        "facade": {
            "globalId": facade_id,
            "name": model.label(facade_element),
            "ifcType": facade_element.is_a(),
            "normal": [round(float(normal[0]), 6), round(float(normal[1]), 6)],
            "azimuth": bearing.value if bearing.decidable else None,
            "why": why,
        },
        "candidates": candidates,
    }

    return computed(
        value,
        unit="m",
        tolerance=op.DIMENSION_TOLERANCE,
        from_=[space_global_id, facade_id, *(chosen["apertures"] if chosen else [])],
        method=method,
        caveat=_depth_caveat(
            model,
            chosen=chosen,
            candidates=candidates,
            facade_id=facade_id,
            outward=outward,
            depth=depth,
            width=width,
            floor_value=floor_value,
            height=height,
            height_value=height_value,
            from_footprint=from_footprint,
            curtain_wall=curtain_wall,
            bounding=bounding,
            caller_supplied=facade_element_global_id is not None,
        ),
    )


def _no_facade(
    model: SpatialModel,
    space_global_id: str,
    method: str,
    candidates: list[dict[str, Any]],
    curtain_wall: list[Any],
) -> Answer[Any]:
    if candidates:
        what = "keine außenliegende Fensteröffnung an den Außenwänden dieses Raums"
        remedy = (
            f"Dieser Raum wird von {len(candidates)} Außenwand/Außenwänden begrenzt, aber keine davon trägt "
            "eine messbare, nach außen gerichtete Öffnung. Entweder hat der Raum kein Fenster — dann gibt es "
            "keine Belichtungsfassade und keine Raumtiefe zu ihr — oder der Export hat die Öffnungen ohne "
            "Geometrie geschrieben. Abhilfe: mit Öffnungen und Füllungen neu exportieren, oder roomDepth() "
            "mit der gewünschten Fassade als zweitem Argument aufrufen."
        )
    else:
        what = "keine als außenliegend deklarierte Wand begrenzt diesen Raum"
        remedy = (
            "Die Belichtungsfassade wird unter den Außenwänden des Raums gesucht, und außen heißt hier: "
            "Pset_WallCommon.IsExternal ist an der Wand gesetzt. In diesem Modell ist das für keine "
            "begrenzende Wand der Fall. Abhilfe: IsExternal an den Außenwänden setzen und neu exportieren, "
            "oder roomDepth() mit der gewünschten Fassade als zweitem Argument aufrufen."
        )
    if curtain_wall:
        remedy += (
            f" Hinweis: {len(curtain_wall)} Bauteil(e) einer Vorhangfassade (IfcPlate/IfcMember) begrenzen "
            "diesen Raum. Vorhangfassaden tragen ihre Verglasung ohne IfcOpeningElement und werden hier "
            "nicht als Öffnung gezählt — sie sind aber eine Belichtungsfassade und können ausdrücklich "
            "übergeben werden."
        )
    return undecidable(
        from_=[space_global_id, *[c["globalId"] for c in candidates]],
        method=method,
        provenance="computed",
        missing=MissingFact(what=what, remedy=remedy, elements=[space_global_id]),
    )


def _depth_caveat(
    model: SpatialModel,
    *,
    chosen: dict[str, Any] | None,
    candidates: list[dict[str, Any]],
    facade_id: str,
    outward: bool,
    depth: float,
    width: float,
    floor_value: float | None,
    height: Answer[float],
    height_value: float | None,
    from_footprint: bool,
    curtain_wall: list[Any],
    bounding: Answer[Any],
    caller_supplied: bool,
) -> str:
    parts: list[str] = [
        "Tiefe und Breite sind aus dem Grundriss des Raumkörpers gemessen, auf die Fassadennormale bzw. auf "
        "die Fassadenrichtung projiziert — NICHT aus der achsparallelen Hüllbox. Für einen zur Modellachse "
        "verdrehten Raum wären die Boxmaße systematisch zu groß."
    ]

    if caller_supplied and chosen is None:
        parts.append(
            "Die Fassade wurde übergeben und gehört nicht zu den außenliegenden Wänden, die dieser Raum "
            "über bounds() als Begrenzung führt — die Tiefe ist trotzdem senkrecht zu ihr gemessen."
        )
    runners = [c for c in candidates if c["globalId"] != facade_id and float(c["apertureArea"]) > 0]
    if chosen is not None and runners:
        best = float(chosen["apertureArea"])
        second = runners[0]
        share = float(second["apertureArea"]) / best if best > 0 else 0.0
        listed = ", ".join(f"{c['name'] or c['globalId']} ({float(c['apertureArea']):.3f} m²)" for c in runners[:3])
        with_openings = [c for c in candidates if float(c["apertureArea"]) > 0]
        more = "" if len(runners) <= 3 else f" (die 3 größten von {len(runners)})"
        parts.append(
            f"Dieser Raum hat {len(with_openings)} Außenwand/Außenwände mit Öffnungen (von "
            f"{len(candidates)} begrenzenden Außenwänden insgesamt); "
            + ("gewählt ist eine davon. " if float(chosen["apertureArea"]) > 0 else "die gewählte trägt keine. ")
            + f"Weitere{more}: {listed}. Zu jeder gehört eine andere Raumtiefe."
        )
        if share >= CORNER_ROOM_SHARE:
            parts.append(
                f"Die zweitgrößte Fassade trägt {share * 100:.0f} % der Öffnungsfläche der gewählten — das ist "
                "ein Eckraum, und die Wahl ist keine deutliche. Für die andere Richtung roomDepth() mit "
                f"facade={second['globalId']} aufrufen."
            )

    if not outward:
        parts.append(
            "Die Außenseite dieser Fassadenebene ist ungesichert (das Bauteil steht zu nahe an der "
            "Grundriss-Mitte). Die Tiefe selbst ist davon unberührt — sie ist eine Ausdehnung, kein "
            "Vorzeichen — die genannte Himmelsrichtung kann aber um 180° gedreht sein."
        )

    if height_value is None:
        parts.append(
            "Ohne lichte Höhe ist kein Verhältnis Tiefe/Höhe gebildet: "
            + (
                (height.missing.what + ". " + height.missing.remedy)
                if height.missing
                else "clearHeight() liefert nichts."
            )
        )
    else:
        parts.append(
            f"Das Verhältnis Tiefe/Höhe ist gegen die LICHTE Höhe {height_value:.3f} m gebildet (clearHeight, "
            "senkrecht nach oben gemessen), nicht gegen die Höhe des Raumkörpers. Abgehängte Decken und "
            "Unterzüge verkürzen die lichte Höhe, ohne den Raumkörper zu verkürzen; das Verhältnis gegen den "
            "Raumkörper fiele günstiger aus und wäre die unsichere Seite."
        )

    if floor_value is not None:
        product = depth * width
        delta = abs(product - floor_value) / floor_value if floor_value else 0.0
        if delta <= RECTANGULARITY_TOLERANCE:
            parts.append(
                f"Gegenprobe: Tiefe × Breite = {product:.4f} m² gegen die gemessene Bodenfläche "
                f"{floor_value:.4f} m² ({delta * 100:.2f} % Abweichung) — der Grundriss füllt das Rechteck "
                "aus Tiefe und Breite aus, die Tiefe gilt damit über die ganze Breite."
            )
        else:
            parts.append(
                f"Gegenprobe: Tiefe × Breite = {product:.4f} m² gegen die gemessene Bodenfläche "
                f"{floor_value:.4f} m² ({delta * 100:.2f} % Abweichung). Dieser Raum ist NICHT rechteckig — "
                "Tiefe und Breite sind die größten Ausdehnungen und gelten nicht an jeder Stelle. Das Produkt "
                "ist keine Fläche des Raums; die Fläche liefert floorArea()."
            )

    if not from_footprint:
        parts.append(
            "Der Raumkörper hat keine waagrechte Fläche, aus der sich ein Grundriss bilden ließe — gemessen "
            "ist die Projektion aller Körperpunkte. Für einen senkrechten Raumkörper ist das dieselbe "
            "Silhouette; für einen geneigten ist sie größer als der Boden."
        )

    if curtain_wall:
        names = ", ".join(sorted({(model.label(e) or e.GlobalId).split(":")[0] for e in curtain_wall}))
        parts.append(
            f"{len(curtain_wall)} Bauteil(e) einer Vorhangfassade ({names}) begrenzen diesen Raum und sind in "
            "der Fassadenwahl NICHT enthalten: Vorhangfassaden tragen ihre Verglasung als IfcPlate/IfcMember "
            "ohne IfcOpeningElement, ihre Öffnungsfläche ist mit demselben Maß nicht messbar. Wenn die "
            "Belichtung über die Glasfassade läuft, roomDepth() mit einem ihrer Bauteile als Fassade aufrufen."
        )

    if bounding.provenance == "computed" and bounding.caveat:
        parts.append(f"Raumbegrenzung: {bounding.caveat}")

    return " ".join(parts)


def _is_excluded(element: Any) -> bool:
    if element.is_a() in AIR_TYPES:
        return True
    for kind in op.FURNISHING:
        try:
            if element.is_a(kind):
                return True
        except Exception:
            continue
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

    found: dict[str, dict[str, Any]] = {}
    tested = 0
    for ix in range(samples):
        for iy in range(samples):
            x = float(low[0] + (high[0] - low[0]) * (ix + 0.5) / samples)
            y = float(low[1] + (high[1] - low[1]) * (iy + 0.5) / samples)

            hits_back = tree.select_ray((x, y, start_z), back, length=thickness + 2 * OVERHEAD_OFFSET)
            if not any(model.file.by_id(h.instance.id()).GlobalId == global_id for h in hits_back):
                continue
            tested += 1

            here = {e.GlobalId for e in tree.select((x, y, start_z))}
            seen: set[str] = set()
            for global_id_here in here:
                element = model.file.by_guid(global_id_here)
                if global_id_here == global_id or _is_excluded(element):
                    continue
                seen.add(global_id_here)
                _record(found, model, element, 0.0)

            for hit in tree.select_ray((x, y, start_z), scan, length=reach):
                element = model.file.by_id(hit.instance.id())
                if element.GlobalId == global_id or element.GlobalId in seen or _is_excluded(element):
                    continue
                if element.GlobalId in here:
                    continue
                seen.add(element.GlobalId)
                _record(found, model, element, float(hit.distance) + OVERHEAD_OFFSET)

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

    return computed(
        result,
        unit="m",
        tolerance=op.DIMENSION_TOLERANCE,
        from_=[global_id, *[entry["globalId"] for entry in result]],
        method=method,
        caveat=caveat,
    )


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


def _by_type(model: SpatialModel, ifc_type: str) -> list[Any]:
    try:
        return list(model.file.by_type(ifc_type))
    except RuntimeError:
        return []


def _compound_angle(value: Any) -> float | None:
    if not value:
        return None
    try:
        parts = [int(component) for component in value]
    except TypeError, ValueError:
        return None
    if len(parts) < 3:
        return None
    sign = -1.0 if any(part < 0 for part in parts) else 1.0
    magnitude = abs(parts[0]) + abs(parts[1]) / 60.0 + abs(parts[2]) / 3600.0
    if len(parts) > 3:
        magnitude += abs(parts[3]) / 3.6e9
    return sign * magnitude


def _site_coordinates(model: SpatialModel) -> tuple[float, float, str] | None:
    for site in _by_type(model, "IfcSite"):
        latitude = _compound_angle(getattr(site, "RefLatitude", None))
        longitude = _compound_angle(getattr(site, "RefLongitude", None))
        if latitude is None or longitude is None:
            continue
        if not (-90.0 <= latitude <= 90.0 and -180.0 <= longitude <= 180.0):
            continue
        return latitude, longitude, site.GlobalId
    return None


def _map_conversion_north(model: SpatialModel) -> float | None:
    for conversion in _by_type(model, "IfcMapConversion"):
        abscissa = getattr(conversion, "XAxisAbscissa", None)
        ordinate = getattr(conversion, "XAxisOrdinate", None)
        if abscissa is None or ordinate is None:
            continue
        if abs(float(abscissa)) < 1e-12 and abs(float(ordinate)) < 1e-12:
            continue
        return float(np.arctan2(float(ordinate), float(abscissa)))
    return None


def _julian_day(when: dt.datetime) -> float:
    year, month = when.year, when.month
    if month <= 2:
        year -= 1
        month += 12
    century = year // 100
    gregorian = 2 - century + century // 4
    day = when.day + (when.hour + when.minute / 60.0 + (when.second + when.microsecond / 1e6) / 3600.0) / 24.0
    return math.floor(365.25 * (year + 4716)) + math.floor(30.6001 * (month + 1)) + day + gregorian - 1524.5


def _solar_azimuth_altitude(when: dt.datetime, latitude: float, longitude: float) -> dict[str, float]:
    n = _julian_day(when) - 2451545.0
    hour = when.hour + when.minute / 60.0 + (when.second + when.microsecond / 1e6) / 3600.0

    mean_longitude = (280.460 + 0.9856474 * n) % 360.0
    mean_anomaly = math.radians((357.528 + 0.9856003 * n) % 360.0)
    ecliptic_longitude = math.radians(
        (mean_longitude + 1.915 * math.sin(mean_anomaly) + 0.020 * math.sin(2 * mean_anomaly)) % 360.0
    )
    obliquity = math.radians(23.439 - 0.0000004 * n)

    right_ascension = math.atan2(math.cos(obliquity) * math.sin(ecliptic_longitude), math.cos(ecliptic_longitude))
    declination = math.asin(math.sin(obliquity) * math.sin(ecliptic_longitude))

    gmst = (6.697375 + 0.0657098242 * n + hour) % 24.0
    local_sidereal = (gmst + longitude / 15.0) % 24.0
    hour_angle = math.radians((local_sidereal * 15.0 - math.degrees(right_ascension) + 180.0) % 360.0 - 180.0)

    phi = math.radians(latitude)
    altitude = math.asin(
        math.sin(phi) * math.sin(declination) + math.cos(phi) * math.cos(declination) * math.cos(hour_angle)
    )
    azimuth = math.atan2(
        -math.cos(declination) * math.sin(hour_angle),
        math.cos(phi) * math.sin(declination) - math.sin(phi) * math.cos(declination) * math.cos(hour_angle),
    )
    return {
        "azimuth": math.degrees(azimuth) % 360.0,
        "altitude": math.degrees(altitude),
        "declination": math.degrees(declination),
        "hourAngle": math.degrees(hour_angle),
    }


def _parse_instant(when_iso: str, method: str) -> tuple[dt.datetime | None, Answer[Any] | None]:
    try:
        parsed = dt.datetime.fromisoformat(str(when_iso).replace("Z", "+00:00"))
    except TypeError, ValueError:
        return None, undecidable(
            from_=[],
            method=method,
            provenance="computed",
            missing=MissingFact(
                what=f"„{when_iso}“ ist kein lesbarer Zeitpunkt",
                remedy=(
                    "Den Zeitpunkt nach ISO 8601 mit Zeitzone angeben, z. B. 2026-06-21T12:00:00+02:00 "
                    "(Sommerzeit in Österreich) oder 2026-06-21T10:00:00Z."
                ),
            ),
        )
    if parsed.tzinfo is None:
        return None, undecidable(
            from_=[],
            method=method,
            provenance="computed",
            missing=MissingFact(
                what=f"Zeitzone fehlt im Zeitpunkt „{when_iso}“",
                remedy=(
                    "Den Zeitpunkt mit Zonenangabe wiederholen, z. B. 2026-06-21T12:00:00+02:00 oder "
                    "2026-06-21T10:00:00Z. Ohne Zone wird hier nichts angenommen: Österreich läuft im Winter "
                    "auf UTC+1 und im Sommer auf UTC+2, und eine als UTC gelesene Ortszeit verschiebt die "
                    "Sonne um bis zu 30° — zwei Stunden Schattenverlauf."
                ),
            ),
        )
    return parsed.astimezone(dt.UTC), None


def sun_position(
    model: SpatialModel,
    when_iso: str,
    latitude: float | None = None,
    longitude: float | None = None,
) -> Answer[dict[str, Any]]:
    method = f"sunPosition({when_iso})"
    when, refusal = _parse_instant(when_iso, method)
    if refusal is not None:
        return refusal  # type: ignore[return-value]
    assert when is not None

    from_: list[str] = []
    if (latitude is None) != (longitude is None):
        return undecidable(
            from_=[],
            method=method,
            provenance="declared",
            missing=MissingFact(
                what="nur eine der beiden Koordinaten übergeben",
                remedy=(
                    "sunPosition() braucht Breite UND Länge zusammen, in Dezimalgrad (Norden und Osten "
                    "positiv). Beide weglassen, um die Georeferenz des Modells zu verwenden."
                ),
            ),
        )

    if latitude is not None and longitude is not None:
        coordinate_source = "vom Aufrufer übergeben"
    else:
        site = _site_coordinates(model)
        if site is None:
            return _not_georeferenced(model, method)
        latitude, longitude, site_id = site
        from_.append(site_id)
        coordinate_source = f"IfcSite.RefLatitude/RefLongitude ({site_id})"

    sun = _solar_azimuth_altitude(when, float(latitude), float(longitude))

    north = model.true_north
    north_source = "IfcGeometricRepresentationContext.TrueNorth"
    if north is None:
        north = _map_conversion_north(model)
        north_source = "IfcMapConversion.XAxisAbscissa/XAxisOrdinate (Gitternord)"
    direction: list[float] | None = None
    if north is not None:
        north_vector = np.array([math.sin(north), math.cos(north), 0.0])
        east_vector = np.array([north_vector[1], -north_vector[0], 0.0])
        bearing = math.radians(sun["azimuth"])
        horizontal = math.cos(bearing) * north_vector + math.sin(bearing) * east_vector
        towards = math.cos(math.radians(sun["altitude"])) * horizontal + np.array(
            [0.0, 0.0, math.sin(math.radians(sun["altitude"]))]
        )
        direction = [round(float(c), 6) for c in towards]

    in_span = 1950 <= when.year <= 2050
    tolerance = SOLAR_TOLERANCE_DEGREES if in_span else SOLAR_TOLERANCE_DEGREES_EXTRAPOLATED

    value = {
        "azimuth": round(sun["azimuth"], 4),
        "altitude": round(sun["altitude"], 4),
        "compass": op.COMPASS[int(round(sun["azimuth"] / 22.5)) % 16],
        "aboveHorizon": bool(sun["altitude"] > 0.0),
        "declination": round(sun["declination"], 4),
        "latitude": round(float(latitude), 6),
        "longitude": round(float(longitude), 6),
        "utc": when.isoformat().replace("+00:00", "Z"),
        "directionInModel": direction,
        "trueNorthDegrees": None if north is None else round(math.degrees(north) % 360.0, 4),
    }

    return computed(
        value,
        unit="°",
        tolerance=tolerance,
        from_=from_,
        method=method,
        caveat=_sun_caveat(
            coordinate_source=coordinate_source,
            north=north,
            north_source=north_source,
            in_span=in_span,
            tolerance=tolerance,
            altitude=sun["altitude"],
            when=when,
        ),
    )


def _sun_caveat(
    *,
    coordinate_source: str,
    north: float | None,
    north_source: str,
    in_span: bool,
    tolerance: float,
    altitude: float,
    when: dt.datetime,
) -> str:
    parts = [
        "Das ist der Sonnenstand, KEINE Besonnungsstudie: die Antwort sagt, wo die Sonne steht, nicht, was "
        "beschattet ist. Ob der Strahl beim Fenster ankommt, entscheiden Nachbargebäude, Gelände, Balkone "
        "und Dachüberstände — davon kennt diese Datei nur, was in ihr modelliert ist. Für die Verschattung "
        "die Richtung `directionInModel` an ray() bzw. obstructions() übergeben; alles außerhalb des Modells "
        "bleibt unberücksichtigt.",
        f"Koordinaten: {coordinate_source}."
        + (
            " Diese Koordinaten stehen NICHT in der Datei — sie stammen aus dem Aufruf. Ob sie zu diesem "
            "Gebäude gehören, kann hier niemand prüfen; der ganze Sonnenstand hängt daran."
            if coordinate_source.startswith("vom Aufrufer")
            else ""
        ),
        (
            "Algorithmus: Michalsky (1988), der Näherungsalgorithmus des Astronomical Almanac, angegebene "
            f"Genauigkeit 0,01° für 1950–2050; hier als Toleranz {tolerance} ° geführt."
        ),
        "Gerechnet ist die GEOMETRISCHE Sonnenposition ohne Refraktion — Schatten wirft die geometrische "
        "Sonne. Die scheinbare Sonne steht in Horizontnähe bis zu 0,57° höher.",
    ]
    if not in_span:
        parts.append(
            f"Der Zeitpunkt liegt im Jahr {when.year} und damit außerhalb des Gültigkeitsbereichs 1950–2050 "
            "des Algorithmus. Der Wert wird ausgegeben, die Toleranz ist dafür auf "
            f"{SOLAR_TOLERANCE_DEGREES_EXTRAPOLATED} ° erhöht."
        )
    if altitude <= 0.0:
        parts.append(
            f"Die Sonne steht zu diesem Zeitpunkt {abs(altitude):.2f}° UNTER dem Horizont — es ist Nacht. "
            "Der Azimut ist trotzdem angegeben und beschreibt die Richtung unter dem Horizont."
        )
    if north is None:
        parts.append(
            "Die Datei nennt keine Nordrichtung (weder IfcGeometricRepresentationContext.TrueNorth noch "
            "IfcMapConversion). Azimut und Höhe sind echte Himmelskoordinaten und davon unberührt, aber die "
            "Richtung im Modell (`directionInModel`) lässt sich nicht bilden: es ist unbekannt, wie das "
            "Gebäude zum Norden steht. Abhilfe: die Nordrichtung im CAD setzen und mitexportieren."
        )
    elif north_source.startswith("IfcMapConversion"):
        parts.append(
            "Die Nordrichtung stammt aus IfcMapConversion und ist damit GITTERNORD des Projektionssystems, "
            "nicht geografisch Nord. Die beiden weichen um die Meridiankonvergenz voneinander ab — in einer "
            "UTM-Zone bis etwa 3°. Abhilfe: TrueNorth im Geometriekontext setzen."
        )
    else:
        parts.append(f"Nordrichtung: {north_source}.")
    return " ".join(parts)


def _not_georeferenced(model: SpatialModel, method: str) -> Answer[Any]:
    map_conversion = _by_type(model, "IfcMapConversion")
    if map_conversion:
        crs = getattr(map_conversion[0], "TargetCRS", None)
        crs_name = getattr(crs, "Name", None) or "unbenannt"
        return undecidable(
            from_=[],
            method=method,
            provenance="declared",
            missing=MissingFact(
                what="IfcSite.RefLatitude / RefLongitude (geografische Koordinaten)",
                remedy=(
                    f"Dieses Modell ist georeferenziert, aber in ein projiziertes Koordinatensystem "
                    f"(IfcMapConversion, TargetCRS „{crs_name}“). Aus Rechts- und Hochwert lassen sich Breite "
                    "und Länge nur mit den Parametern genau dieser Projektion zurückrechnen — dafür fehlt "
                    "dieser Bibliothek die Projektionsbibliothek, und eine Näherung wäre um Kilometer "
                    "daneben. Abhilfe: am IfcSite zusätzlich RefLatitude und RefLongitude setzen (in Revit "
                    "und ArchiCAD der Standort des Projekts), oder sunPosition() mit latitude/longitude "
                    "aufrufen."
                ),
            ),
        )
    return undecidable(
        from_=[],
        method=method,
        provenance="declared",
        missing=MissingFact(
            what="IfcSite.RefLatitude / RefLongitude",
            remedy=(
                "Dieses Modell sagt nicht, wo es steht. Im CAD den Standort des Projekts setzen (Revit: "
                "Verwalten → Standort; ArchiCAD: Optionen → Projektstandort) und mitexportieren — dann "
                "stehen Breite und Länge am IfcSite. Ein angenommener Standort wird hier nicht eingesetzt: "
                "48° statt 47° Breite verschiebt die Sonnenhöhe um ein Grad, und der Fehler ist an der "
                "Antwort nicht zu erkennen. Wer die Koordinaten hat, kann sie sunPosition() direkt "
                "übergeben."
            ),
        ),
    )


__all__ = [
    "above",
    "below",
    "room_depth",
    "sun_position",
]
