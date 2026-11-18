from __future__ import annotations

from collections.abc import Sequence  # noqa: F401
from typing import Any  # noqa: F401

import numpy as np  # noqa: F401

from ifc_spatial.operators_adjacency import adjacent_spaces  # noqa: F401
from ifc_spatial.operators_adjacency import container_of  # noqa: F401
from ifc_spatial.operators_adjacency import contains  # noqa: F401
from ifc_spatial.operators_adjacency import enclosed_by  # noqa: F401
from ifc_spatial.operators_adjacency import opens_to  # noqa: F401
from ifc_spatial.operators_bounds import _too_big_to_derive  # noqa: F401
from ifc_spatial.operators_bounds import bounds  # noqa: F401
from ifc_spatial.operators_bounds import filler_of  # noqa: F401
from ifc_spatial.operators_bounds import hosted_in  # noqa: F401
from ifc_spatial.operators_bounds import hosts  # noqa: F401
from ifc_spatial.operators_constants import _DERIVED_BOUNDARY_CAVEAT  # noqa: F401
from ifc_spatial.operators_constants import _RELATIONS  # noqa: F401
from ifc_spatial.operators_constants import AREA_RELATIVE_TOLERANCE  # noqa: F401
from ifc_spatial.operators_constants import COMPASS  # noqa: F401
from ifc_spatial.operators_constants import CONTACT  # noqa: F401
from ifc_spatial.operators_constants import COORDINATE_TOLERANCE  # noqa: F401
from ifc_spatial.operators_constants import DIMENSION_TOLERANCE  # noqa: F401
from ifc_spatial.operators_constants import FENESTRATION  # noqa: F401
from ifc_spatial.operators_constants import FURNISHING  # noqa: F401
from ifc_spatial.operators_constants import MIN_INTRUSION  # noqa: F401
from ifc_spatial.operators_constants import SIDE_TOLERANCE  # noqa: F401
from ifc_spatial.operators_facade import facade_plane_of  # noqa: F401
from ifc_spatial.operators_facade import obstructions  # noqa: F401
from ifc_spatial.operators_facade import overhang  # noqa: F401
from ifc_spatial.operators_facade import prism  # noqa: F401
from ifc_spatial.operators_facade import ray  # noqa: F401
from ifc_spatial.operators_guards import _geometry_or_answer  # noqa: F401
from ifc_spatial.operators_guards import _no_geometry  # noqa: F401
from ifc_spatial.operators_guards import _require  # noqa: F401
from ifc_spatial.operators_guards import _wrong_kind  # noqa: F401
from ifc_spatial.operators_measures import _footprint_area  # noqa: F401
from ifc_spatial.operators_measures import extent  # noqa: F401
from ifc_spatial.operators_measures import floor_area  # noqa: F401
from ifc_spatial.operators_vertical import azimuth  # noqa: F401
from ifc_spatial.operators_vertical import clear_height  # noqa: F401
from ifc_spatial.operators_vertical import distance  # noqa: F401
from ifc_spatial.operators_vertical import elevation  # noqa: F401
from ifc_spatial.operators_vertical import sill_and_head  # noqa: F401

from .envelope import Answer  # noqa: F401
from .envelope import MissingFact  # noqa: F401
from .envelope import computed  # noqa: F401
from .envelope import undecidable  # noqa: F401
from .geometry import dominant_plane  # noqa: F401
from .geometry import dominant_vertical_plane  # noqa: F401
from .geometry import triangle_normals_areas  # noqa: F401
from .model import SpatialModel  # noqa: F401


def _clear_opening_area(model: SpatialModel, opening: Any, z_band: tuple[float, float] | None = None) -> float | None:
    import shapely
    import shapely.ops

    global_id = getattr(opening, "GlobalId", None)
    if not global_id:
        return None
    geo = model.geometry(global_id)
    if geo is None or geo.triangles is None or len(geo.triangles) == 0:
        return None
    normal = dominant_vertical_plane(geo.triangles)
    if normal is None:
        return None

    up = np.array([0.0, 0.0, 1.0])
    up = up - normal * float(up @ normal)
    if np.linalg.norm(up) < 1e-9:
        return None
    up = up / np.linalg.norm(up)
    across = np.cross(normal, up)

    normals, _ = triangle_normals_areas(geo.triangles)
    facing = geo.triangles[np.abs(normals @ normal) > 0.9]
    if len(facing) == 0:
        return None

    polygons = []
    for tri in facing:
        flat = [(float(p @ across), float(p @ up)) for p in tri]
        polygon = shapely.Polygon(flat)
        if polygon.is_valid and polygon.area > 0:
            polygons.append(polygon)
    if not polygons:
        return None
    try:
        merged = shapely.ops.unary_union(polygons)
    except Exception:
        return None

    if z_band is not None:
        low, high = z_band
        minx, _, maxx, _ = merged.bounds
        span = float(up[2]) or 1.0
        band = sorted((low / span, high / span))
        try:
            merged = merged.intersection(shapely.box(minx - 1.0, band[0], maxx + 1.0, band[1]))
        except Exception:
            return None
    area = float(merged.area)
    return area if area > 0 else None


def _rooms_on_one_side(model: SpatialModel, element: Any, rooms: Sequence[Any]) -> bool | None:
    geo = model.geometry(element.GlobalId)
    if geo is None or geo.faces.size == 0:
        return None
    normal = dominant_plane(geo.verts[geo.faces])
    if normal is None:
        return None
    length = float(np.linalg.norm(normal))
    if length <= 0:
        return None
    normal = np.asarray(normal, dtype=float) / length
    origin = np.asarray(geo.centroid, dtype=float)

    sides: set[bool] = set()
    unplaceable = False
    for ref in rooms:
        room = model.geometry(getattr(ref, "global_id", ref))
        if room is None:
            unplaceable = True
            continue
        offset = float(np.dot(np.asarray(room.centroid, dtype=float) - origin, normal))
        if abs(offset) < SIDE_TOLERANCE:
            continue
        sides.add(offset > 0)
    if unplaceable or not sides:
        return None
    return len(sides) == 1


def _faces_outside(model: SpatialModel, element: Any) -> tuple[bool | None, str]:
    own = model.declared_property(element, ("IsExternal",))
    if isinstance(own, bool):
        return own, "Pset_*Common.IsExternal am Bauteil selbst (deklariert)"

    hosts_ = hosted_in(model, element.GlobalId)
    if hosts_.decidable:
        for ref in hosts_.value or []:
            wall = model.file.by_guid(ref.global_id)
            found = model.declared_property(wall, ("IsExternal",))
            if isinstance(found, bool):
                return found, "Pset_*Common.IsExternal der Wand (deklariert)"
        for ref in hosts_.value or []:
            wall = model.file.by_guid(ref.global_id)
            walls_rooms = enclosed_by(model, wall.GlobalId)
            if not walls_rooms.decidable or not walls_rooms.value:
                continue
            one_side = _rooms_on_one_side(model, wall, walls_rooms.value)
            if one_side is True:
                return True, "die tragende Wand hat Räume nur auf einer Seite (aus der Geometrie)"
            if one_side is False:
                return False, "die tragende Wand hat Räume auf beiden Seiten (aus der Geometrie)"

    if element.is_a("IfcDoor"):
        touching = opens_to(model, element.GlobalId)
        if touching.decidable and touching.value is not None:
            count = len(touching.value)
            if count >= 2:
                return False, f"öffnet in {count} Räume (Innentür)"
            if count == 1:
                return True, "berührt nur einen Raum — außen liegt kein IfcSpace"
    return None, "weder IsExternal deklariert noch aus den Raumberührungen ableitbar"


def light_entry_area(model: SpatialModel, space_global_id: str) -> Answer[dict[str, Any]]:
    method = f"lightEntryArea({space_global_id})"
    subject = _require(model, space_global_id, method)
    if model.kind_of(subject) != "space":
        _wrong_kind(
            subject,
            method,
            "lightEntryArea",
            "ein Raum (IfcSpace)",
            "für ein einzelnes Fenster: measure/extent",
        )

    floor = floor_area(model, space_global_id)
    if not floor.decidable or not floor.value:
        return undecidable(
            from_=[space_global_id],
            method=method,
            provenance="computed",
            missing=MissingFact(
                what="die Bodenfläche des Raums",
                remedy=(
                    "Ohne Bodenfläche ist kein Flächenanteil bildbar. Zuerst measure/floorArea aufrufen — "
                    "die Antwort dort nennt, was fehlt."
                ),
            ),
        )

    bounding = bounds(model, space_global_id)
    if not bounding.decidable:
        return bounding  # type: ignore[return-value]

    openings: list[dict[str, Any]] = []
    without_geometry: list[str] = []
    GLAZING = ("IfcWindow", "IfcDoor", "IfcPlate")

    space_geo = model.geometry(space_global_id)
    z_band = None
    if space_geo is not None and space_geo.triangles is not None and len(space_geo.triangles):
        zs = space_geo.triangles.reshape(-1, 3)[:, 2]
        z_band = (float(zs.min()), float(zs.max()))

    seen: set[str] = set()
    for ref in bounding.value or []:
        if ref.ifc_type not in GLAZING or ref.global_id in seen:
            continue
        seen.add(ref.global_id)
        element = model.file.by_guid(ref.global_id)
        voids = [rel.RelatingOpeningElement for rel in (getattr(element, "FillsVoids", []) or [])]
        area = None
        via = "IfcOpeningElement"
        for void in voids:
            area = _clear_opening_area(model, void, z_band)
            if area:
                break
        if not area:
            area = _clear_opening_area(model, element, z_band)
            via = (
                "Verglasungsfeld (Vorhangfassade, Rahmen enthalten)"
                if ref.ifc_type == "IfcPlate"
                else "Bauteilkörper (Rahmen enthalten)"
            )
        if not area:
            without_geometry.append(ref.global_id)
            continue
        external, why = _faces_outside(model, element)
        openings.append(
            {
                "globalId": ref.global_id,
                "name": ref.name,
                "ifcType": ref.ifc_type,
                "area": round(area, 6),
                "via": via,
                "external": external,
                "because": why,
            }
        )

    if not openings:
        return undecidable(
            from_=[space_global_id],
            method=method,
            provenance="computed",
            missing=MissingFact(
                what="keine messbare Fensteröffnung an diesem Raum",
                remedy=(
                    "Entweder grenzt an diesen Raum kein Fenster und keine Tür, oder deren Öffnungen "
                    "tragen keine Geometrie. bounds() zeigt, was den Raum begrenzt."
                ),
            ),
        )

    external = [entry for entry in openings if entry["external"] is True]
    internal = [entry for entry in openings if entry["external"] is False]
    unknown = [entry for entry in openings if entry["external"] is None]

    total = sum(entry["area"] for entry in external)
    ratio = total / float(floor.value)

    caveat = (
        "Gemessen ist die ROHBAULICHTE (die lichte Öffnung im Mauerwerk), nicht die Glasfläche und nicht "
        "die Öffnung abzüglich Rahmen und Flügel — der Unterschied beträgt bei einem üblichen Fenster "
        "15–25 %. Welche dieser Flächen die Bestimmung meint, entscheidet die Bestimmung. Kein Grenzwert "
        "angewandt: der Prozentsatz stammt aus dem Regelwerk, nicht aus dem Modell."
    )
    if internal:
        caveat += (
            f" {len(internal)} innenliegende Öffnung(en) sind NICHT eingerechnet (eine Innentür belichtet "
            "nicht von außen); sie stehen unter „interior“ mit Begründung."
        )
    if unknown:
        caveat += (
            f" Bei {len(unknown)} Öffnung(en) ließ sich außen/innen nicht bestimmen — sie sind WEDER "
            "eingerechnet noch verworfen und stehen unter „unbestimmt“. Abhilfe: IsExternal an der Wand "
            "setzen. Solange das offen ist, ist der Anteil eine Untergrenze."
        )
    if not external:
        caveat += (
            " Keine einzige außenliegende Öffnung an diesem Raum: der Anteil ist 0 %, was ein Befund über "
            "die Zuordnung im Export sein kann und nicht zwingend über den Raum."
        )
    if any(entry["via"] != "IfcOpeningElement" for entry in openings):
        caveat += (
            " Für mindestens eine Öffnung war kein IfcOpeningElement mit Geometrie vorhanden; dort wurde "
            "der Bauteilkörper gemessen, der den Rahmen einschließt und damit zu GROSS ist."
        )
    if without_geometry:
        caveat += (
            f" {len(without_geometry)} Öffnung(en) ohne verwertbare Geometrie sind NICHT enthalten — "
            "die Summe ist insofern eine Untergrenze."
        )
    if bounding.provenance == "computed" and bounding.caveat:
        caveat += f" Raumbegrenzung: {bounding.caveat}"

    return computed(
        {
            "lightEntryArea": round(total, 4),
            "floorArea": round(float(floor.value), 4),
            "ratio": round(ratio, 5),
            "percent": round(ratio * 100.0, 2),
            "openings": external,
            "interior": internal,
            "undetermined": unknown,
        },
        unit="m²",
        tolerance=abs(total) * AREA_RELATIVE_TOLERANCE,
        from_=[space_global_id, *[entry["globalId"] for entry in external]],
        method=method,
        caveat=caveat,
    )


__all__ = [
    "adjacent_spaces",
    "azimuth",
    "bounds",
    "clear_height",
    "container_of",
    "contains",
    "distance",
    "elevation",
    "enclosed_by",
    "extent",
    "facade_plane_of",
    "filler_of",
    "floor_area",
    "hosted_in",
    "hosts",
    "light_entry_area",
    "obstructions",
    "opens_to",
    "overhang",
    "prism",
    "ray",
    "sill_and_head",
]
