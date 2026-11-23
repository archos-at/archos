from __future__ import annotations

from typing import Any

import ifcopenshell.util.element as ue
import numpy as np

from .geometry import triangle_normals_areas
from .model import SpatialModel
from .operators import _clear_opening_area
from .operators import _faces_outside
from .operators import _footprint_area
from .operators import _rooms_on_one_side
from .operators import enclosed_by

_KIND_OF_TYPE: dict[str, str] = {
    "IfcWall": "Wand",
    "IfcWallStandardCase": "Wand",
    "IfcCurtainWall": "Wand",
    "IfcSlab": "Boden/Decke",
    "IfcRoof": "Dach",
    "IfcWindow": "Fenster",
    "IfcWindowStandardCase": "Fenster",
    "IfcDoor": "Tür",
    "IfcDoorStandardCase": "Tür",
    "IfcPlate": "Verglasungsfeld",
}

KIND_ORDER = ["Wand", "Fenster", "Tür", "Verglasungsfeld", "Boden/Decke", "Dach"]

TRANSPARENT_TYPES = {"IfcWindow", "IfcWindowStandardCase", "IfcPlate"}

_OPENING_TYPES = {"IfcWindow", "IfcWindowStandardCase", "IfcDoor", "IfcDoorStandardCase", "IfcPlate"}

_HORIZONTAL_NORMAL_TOLERANCE = 0.01

SLOPE_REPORT_FRACTION = 0.01


def _declared_u_value(element: Any) -> tuple[float | None, str | None]:
    psets = ue.get_psets(element, qtos_only=False) or {}
    for pset_name, values in psets.items():
        if not isinstance(values, dict):
            continue
        found = values.get("ThermalTransmittance")
        if isinstance(found, (int, float)) and not isinstance(found, bool):
            return float(found), f"{pset_name}.ThermalTransmittance"
    return None, None


def _developed_horizontal_area(triangles: np.ndarray) -> float:
    normals, areas = triangle_normals_areas(triangles)
    upward = normals[:, 2]
    return max(
        float(areas[upward > _HORIZONTAL_NORMAL_TOLERANCE].sum()),
        float(areas[upward < -_HORIZONTAL_NORMAL_TOLERANCE].sum()),
    )


def _element_area(model: SpatialModel, element: Any) -> dict[str, Any]:
    geometry = model.geometry(element.GlobalId)
    if geometry is None:
        reason = model.geometry_failure(element.GlobalId) or ""
        if reason.startswith(("shape-failed", "empty-mesh")):
            why = "Körpergeometrie vorhanden, aber vom Geometriekern nicht auswertbar"
        elif element.is_a() == "IfcCurtainWall":
            why = "kein eigener Körper — eine Vorhangfassade trägt ihre Geometrie über Paneele und Pfosten"
        else:
            why = "keine Körpergeometrie in dieser Datei"
        return {"area": None, "projectedArea": None, "via": why, "horizontal": None}

    vertical = _clear_opening_area(model, element)
    projected = _footprint_area(geometry.triangles)

    if vertical is not None and vertical >= projected:
        return {
            "area": round(vertical, 6),
            "projectedArea": round(vertical, 6),
            "via": "Ansichtsfläche in der Bauteilebene (Öffnungen abgezogen)",
            "horizontal": False,
        }
    if projected <= 0.0:
        return {
            "area": None,
            "projectedArea": None,
            "via": "Körper ohne auswertbare Fläche (weder senkrechte Ebene noch Grundrissfläche)",
            "horizontal": None,
        }

    developed = _developed_horizontal_area(geometry.triangles)
    area = max(developed, projected)
    return {
        "area": round(area, 6),
        "projectedArea": round(projected, 6),
        "via": (
            "abgewickelte Oberfläche (geneigt oder gekrümmt)"
            if area > projected * (1.0 + SLOPE_REPORT_FRACTION)
            else "Grundrissprojektion"
        ),
        "horizontal": True,
    }


ROUTE_DECLARED = "IsExternal (deklariert)"
ROUTE_BOUNDED_SPACES = "Raumbegrenzung"
ROUTE_UNDECIDED = "undetermined"


def _external_route(model: SpatialModel, element: Any) -> tuple[bool | None, str, str]:
    if element.is_a() in _OPENING_TYPES:
        outside, why = _faces_outside(model, element)
        if outside is None:
            return None, ROUTE_UNDECIDED, why
        route = ROUTE_DECLARED if why.startswith("Pset_") else ROUTE_BOUNDED_SPACES
        return outside, route, why

    own = model.declared_property(element, ("IsExternal",))
    if isinstance(own, bool):
        return own, ROUTE_DECLARED, "Pset_*Common.IsExternal am Bauteil selbst (deklariert)"

    spaces = enclosed_by(model, element.GlobalId)
    if spaces.decidable and spaces.value is not None:
        return _bounded_route(model, element, spaces.value, spaces.provenance)
    return None, ROUTE_UNDECIDED, "weder IsExternal deklariert noch aus den Raumberührungen ableitbar"


def _bounded_route(
    model: SpatialModel, element: Any, rooms: list[Any], provenance: str
) -> tuple[bool | None, str, str]:
    source = "deklarierte Raumgrenzen" if provenance == "declared" else "aus der Geometrie abgeleitet"
    count = len(rooms)
    if count >= 2:
        side = _rooms_on_one_side(model, element, rooms)
        if side is False:
            return (
                False,
                ROUTE_BOUNDED_SPACES,
                f"begrenzt {count} Räume auf beiden Seiten (Trennbauteil, {source})",
            )
        if side is True:
            return (
                True,
                ROUTE_BOUNDED_SPACES,
                f"begrenzt {count} Räume, aber alle auf derselben Seite — "
                f"auf der anderen liegt kein IfcSpace ({source})",
            )
        return (
            False,
            ROUTE_BOUNDED_SPACES,
            f"begrenzt {count} Räume (Trennbauteil, {source}) — auf welcher Seite sie liegen, "
            "war ohne Körper nicht prüfbar",
        )
    if count == 1:
        return (
            True,
            ROUTE_BOUNDED_SPACES,
            f"begrenzt genau einen Raum — auf der anderen Seite liegt kein IfcSpace ({source})",
        )
    return None, ROUTE_UNDECIDED, f"berührt keinen Raum ({source}) — daraus folgt weder außen noch innen"


def _survey(model: SpatialModel) -> list[dict[str, Any]]:
    found: list[dict[str, Any]] = []
    for element in model.file.by_type("IfcProduct"):
        kind = _KIND_OF_TYPE.get(element.is_a())
        if kind is None:
            continue
        external, route, because = _external_route(model, element)
        entry: dict[str, Any] = {
            "globalId": element.GlobalId,
            "ifcType": element.is_a(),
            "name": model.label(element),
            "kind": kind,
            "external": external,
            "route": route,
            "because": because,
            "transparent": element.is_a() in TRANSPARENT_TYPES,
        }
        entry.update(_element_area(model, element))
        u_value, u_path = _declared_u_value(element)
        entry["thermalTransmittance"] = u_value
        entry["thermalTransmittanceVia"] = u_path
        found.append(entry)
    found.sort(key=lambda e: (KIND_ORDER.index(e["kind"]), e["globalId"]))
    return found
