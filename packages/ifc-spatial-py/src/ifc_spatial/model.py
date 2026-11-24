from __future__ import annotations

import os
import time
from collections.abc import Iterable
from dataclasses import dataclass
from functools import cached_property
from typing import Any

import ifcopenshell
import ifcopenshell.geom
import ifcopenshell.util.element as ue
import ifcopenshell.util.shape as us
import ifcopenshell.util.unit as uu
import numpy as np

from .crash_probe import PARSER_CRASH_REASON
from .crash_probe import crashes_the_parser
from .envelope import ElementRef
from .parser_refusal import parser_refusal
from .project_units import project_unit_scale

_SPATIAL_KINDS = {
    "IfcProject": "project",
    "IfcSite": "site",
    "IfcBuilding": "building",
    "IfcBuildingStorey": "storey",
    "IfcSpace": "space",
    "IfcSpatialZone": "space",
}

AIR_TYPES = {
    "IfcSpace",
    "IfcSpatialZone",
    "IfcOpeningElement",
    "IfcVirtualElement",
    "IfcAnnotation",
    "IfcGrid",
}


MAX_FILE_BYTES = 64 * 1024 * 1024

CONTACT_BUDGET_SECONDS = 30.0

DERIVED_BOUNDARY_MAX_PRODUCTS = 2000


class ModelUnreadableError(RuntimeError):
    def __init__(self, path: str, reason: str) -> None:
        self.path = path
        self.reason = reason
        super().__init__(f"{path}: {reason}")


class ModelTooLargeError(ModelUnreadableError):
    def __init__(self, path: str, size: int, limit: int) -> None:
        self.size = size
        self.limit = limit
        super().__init__(
            path,
            f"Diese Datei ist {size / 1e6:.1f} MB groß; hier werden höchstens "
            f"{limit / 1e6:.0f} MB gelesen. Der Geometriedurchlauf braucht ein Vielfaches der "
            "Dateigröße an Arbeitsspeicher — eine 22-MB-Datei belegt rund 1,5 GB. Ein Modell "
            "dieser Größe gehört in einen Worker-Prozess mit eigenem Speicherbudget, nicht in "
            "eine Anfrage. Das ist eine Absage, kein Fehler: die Datei ist in Ordnung.",
        )


def _preflight(path: str, max_bytes: int) -> None:
    if not isinstance(path, (str, os.PathLike)):
        raise ModelUnreadableError(str(path), "Kein Dateipfad übergeben.")
    path = os.fspath(path)
    if not os.path.exists(path):
        raise ModelUnreadableError(path, "Diese Datei existiert nicht.")
    if os.path.isdir(path):
        raise ModelUnreadableError(path, "Das ist ein Verzeichnis, keine IFC-Datei.")
    size = os.path.getsize(path)
    if size == 0:
        raise ModelUnreadableError(path, "Diese Datei ist leer (0 Bytes) — der Upload ist fehlgeschlagen.")
    if size > max_bytes:
        raise ModelTooLargeError(path, size, max_bytes)

    with open(path, "rb") as handle:
        head = handle.read(64)
        handle.seek(max(0, size - 4096))
        tail = handle.read(4096)

    if not head.lstrip()[:12].upper().startswith(b"ISO-10303-21"):
        raise ModelUnreadableError(
            path,
            "Das ist keine IFC-SPF-Datei — sie beginnt nicht mit ISO-10303-21. Eine .ifcXML- oder "
            ".ifcZIP-Datei muss vorher konvertiert bzw. entpackt werden.",
        )
    if b"END-ISO-10303-21" not in tail:
        raise ModelUnreadableError(
            path,
            "Diese Datei ist unvollständig: der Abschluss END-ISO-10303-21; fehlt. Sie wurde "
            "abgeschnitten — der Upload oder der Export ist abgebrochen. Eine abgeschnittene IFC-Datei "
            "bringt den Parser zum Absturz und wird deshalb gar nicht erst geöffnet; die Datei bitte "
            "vollständig neu hochladen.",
        )
    if crashes_the_parser(path):
        raise ModelUnreadableError(path, PARSER_CRASH_REASON)


class UnknownElementError(KeyError):
    def __init__(self, global_id: str, method: str) -> None:
        self.global_id = global_id
        self.method = method
        super().__init__(f'Unbekannte GlobalId "{global_id}" — dieses Modell enthält dieses Bauteil nicht ({method}).')

    def __str__(self) -> str:  # KeyError repr()s its argument otherwise
        return self.args[0]


class WrongKindError(TypeError):
    def __init__(
        self,
        global_id: str,
        ifc_type: str,
        method: str,
        operator: str,
        expected: str,
        suggestion: str,
    ) -> None:
        self.global_id = global_id
        self.ifc_type = ifc_type
        self.method = method
        self.operator = operator
        self.expected = expected
        self.suggestion = suggestion
        super().__init__(
            f"{operator}() erwartet {expected} — {ifc_type} (GlobalId {global_id}) ist das nicht. "
            f"Das ist ein Fehler im Aufruf, kein Befund über den Export: an dieser Datei ist nichts zu "
            f"ändern. {suggestion}"
        )

    def __str__(self) -> str:
        return self.args[0]


@dataclass
class ElementGeometry:
    global_id: str
    verts: np.ndarray
    faces: np.ndarray
    box: tuple[np.ndarray, np.ndarray]
    centroid: np.ndarray

    @property
    def triangles(self) -> np.ndarray:
        return self.verts[self.faces]


@dataclass
class Storey:
    global_id: str
    name: str | None
    elevation: float | None


@dataclass(frozen=True)
class DeclaredQuantity:
    path: str
    value: float
    raw: float
    scale: float
    unit_label: str | None


def _unit_scale_to_si(unit: Any) -> float:
    scale = 1.0
    guard = 0
    while unit is not None and unit.is_a("IfcConversionBasedUnit") and guard < 8:
        guard += 1
        factor = unit.ConversionFactor
        try:
            scale *= float(factor.ValueComponent.wrappedValue)
        except Exception:
            return scale
        unit = factor.UnitComponent
    if unit is not None and unit.is_a("IfcSIUnit"):
        dimension = _UNIT_DIMENSION.get(getattr(unit, "UnitType", None), 1)
        scale *= uu.get_prefix_multiplier(unit.Prefix) ** dimension
    return scale


_UNIT_DIMENSION = {"AREAUNIT": 2, "VOLUMEUNIT": 3}


def _unit_label(unit: Any) -> str | None:
    try:
        if unit.is_a("IfcConversionBasedUnit"):
            return str(unit.Name)
        if unit.is_a("IfcSIUnit"):
            return f"{unit.Prefix or ''}{unit.Name}".strip()
    except Exception:
        return None
    return None


class SpatialModel:
    def __init__(self, path: str, *, max_bytes: int = MAX_FILE_BYTES) -> None:
        _preflight(path, max_bytes)
        self.path = path
        t0 = time.perf_counter()
        try:
            self.file = ifcopenshell.open(path)
            self.open_seconds = time.perf_counter() - t0
            self.unit_scale = project_unit_scale(self.file, path)
        except ModelUnreadableError, MemoryError, OSError:  # no memory or a failed read: no refusal of the file
            raise
        except BaseException as error:  # noqa: BLE001 — every parser failure, one refusal
            raise ModelUnreadableError(str(path), parser_refusal(error)) from None

        self._settings = ifcopenshell.geom.settings()
        self._settings.set("use-world-coords", True)

        self._geometry: dict[str, ElementGeometry | None] = {}
        self._geometry_failure: dict[str, str] = {}
        self.contacts_complete = True
        self.contacts_covered = 0
        self._shapes: dict[str, Any] = {}
        self._space_contacts: dict[float, dict[str, set[str]]] = {}
        self._pass_done = False
        self.geometry_seconds = 0.0
        self.contact_seconds = 0.0
        self.tree_seconds = 0.0

    def by_id(self, global_id: str, method: str) -> Any:
        if not isinstance(global_id, str) or not global_id.strip():
            raise UnknownElementError(str(global_id), method)
        try:
            element = self.file.by_guid(global_id)
        except RuntimeError, KeyError:
            raise UnknownElementError(global_id, method) from None
        if element is None or getattr(element, "GlobalId", None) != global_id:
            raise UnknownElementError(global_id, method)
        return element

    def kind_of(self, element: Any) -> str:
        ifc_type = element.is_a()
        for base, kind in _SPATIAL_KINDS.items():
            if element.is_a(base):
                return kind
        if ifc_type == "IfcOpeningElement":
            return "opening"
        if element.is_a("IfcGroup"):
            return "group"
        return "element"

    def label(self, element: Any) -> str | None:
        long_name = getattr(element, "LongName", None)
        return long_name or getattr(element, "Name", None)

    def ref(self, element: Any, via: str | None = None) -> ElementRef:
        return ElementRef(
            global_id=element.GlobalId,
            ifc_type=element.is_a(),
            name=self.label(element),
            kind=self.kind_of(element),
            via=via,
        )

    def refs(self, elements: Iterable[Any], via: str | None = None) -> list[ElementRef]:
        return [self.ref(e, via) for e in elements if getattr(e, "GlobalId", None)]

    def storey_of(self, element: Any) -> Any | None:
        if element.is_a("IfcBuildingStorey"):
            return element
        seen = set()
        current = element
        while current is not None and current.id() not in seen:
            seen.add(current.id())
            container = ue.get_container(current)
            if container is not None:
                if container.is_a("IfcBuildingStorey"):
                    return container
                current = container
                continue
            aggregate = ue.get_aggregate(current)
            if aggregate is None:
                return None
            if aggregate.is_a("IfcBuildingStorey"):
                return aggregate
            current = aggregate
        return None

    @cached_property
    def storeys(self) -> list[Storey]:
        out: list[Storey] = []
        for s in self.file.by_type("IfcBuildingStorey"):
            elevation = s.Elevation
            out.append(
                Storey(
                    global_id=s.GlobalId,
                    name=s.Name,
                    elevation=None if elevation is None else float(elevation) * self.unit_scale,
                )
            )
        return out

    def storey_datum(self, element: Any) -> Storey | None:
        storey = self.storey_of(element)
        if storey is None:
            return None
        for s in self.storeys:
            if s.global_id == storey.GlobalId and s.elevation is not None:
                return s
        return None

    @cached_property
    def true_north(self) -> float | None:
        for ctx in self.file.by_type("IfcGeometricRepresentationContext"):
            if ctx.is_a("IfcGeometricRepresentationSubContext"):
                continue
            direction = ctx.TrueNorth
            if direction is None:
                continue
            ratios = list(direction.DirectionRatios)
            if len(ratios) >= 2:
                return float(np.arctan2(ratios[0], ratios[1]))
        return None

    @cached_property
    def georeferenced(self) -> bool:
        site = self.file.by_type("IfcSite")
        if any(s.RefLatitude and s.RefLongitude for s in site):
            return True
        try:
            return bool(self.file.by_type("IfcMapConversion"))
        except RuntimeError:
            return False

    def geometry(self, global_id: str) -> ElementGeometry | None:
        if global_id in self._geometry:
            return self._geometry[global_id]
        element = self.file.by_guid(global_id)
        geo = self._shape_of(element)
        self._geometry[global_id] = geo
        return geo

    def geometry_failure(self, global_id: str) -> str | None:
        return self._geometry_failure.get(global_id)

    def _shape_of(self, element: Any) -> ElementGeometry | None:
        global_id = element.GlobalId
        if not getattr(element, "Representation", None) and not element.is_a("IfcSpace"):
            self._geometry_failure[global_id] = "no-representation"
            return None
        shape = self._shapes.get(global_id)
        if shape is None:
            try:
                shape = ifcopenshell.geom.create_shape(self._settings, element)
            except Exception as error:
                self._geometry_failure[global_id] = f"shape-failed: {error}"
                return None
            self._shapes[global_id] = shape
        geometry = self._from_shape(global_id, shape.geometry)
        if geometry is None:
            self._geometry_failure[global_id] = "empty-mesh"
        return geometry

    @staticmethod
    def _from_shape(global_id: str, geometry: Any) -> ElementGeometry | None:
        verts = np.array(us.get_vertices(geometry), dtype=float)
        faces = np.array(us.get_faces(geometry), dtype=np.int64)
        if len(verts) == 0 or len(faces) == 0:
            return None
        tris = verts[faces]
        cross = np.cross(tris[:, 1] - tris[:, 0], tris[:, 2] - tris[:, 0])
        areas = np.linalg.norm(cross, axis=1) / 2.0
        total = float(areas.sum())
        if total > 0:
            centroid = (tris.mean(axis=1) * areas[:, None]).sum(axis=0) / total
        else:
            centroid = verts.mean(axis=0)
        return ElementGeometry(
            global_id=global_id,
            verts=verts,
            faces=faces,
            box=(verts.min(axis=0), verts.max(axis=0)),
            centroid=centroid,
        )

    def triangulation(self, global_id: str) -> Any | None:
        shape = self._shapes.get(global_id)
        if shape is None:
            element = self.file.by_guid(global_id)
            try:
                shape = ifcopenshell.geom.create_shape(self._settings, element)
            except Exception:
                return None
            self._shapes[global_id] = shape
        return shape.geometry

    def geometry_pass(self) -> dict[str, ElementGeometry]:
        if self._pass_done:
            return {k: v for k, v in self._geometry.items() if v is not None}
        t0 = time.perf_counter()
        iterator = ifcopenshell.geom.iterator(self._settings, self.file, 8)
        if iterator.initialize():
            while True:
                shape = iterator.get()
                geo = self._from_shape(shape.guid, shape.geometry)
                self._geometry.setdefault(shape.guid, geo)
                if not iterator.next():
                    break
        self.geometry_seconds = time.perf_counter() - t0
        self._pass_done = True
        return {k: v for k, v in self._geometry.items() if v is not None}

    @cached_property
    def bounds(self) -> tuple[np.ndarray, np.ndarray] | None:
        index = self.geometry_pass()
        if not index:
            return None
        lows = np.array([g.box[0] for g in index.values()])
        highs = np.array([g.box[1] for g in index.values()])
        return lows.min(axis=0), highs.max(axis=0)

    @cached_property
    def plan_centre(self) -> np.ndarray | None:
        if self.bounds is None:
            return None
        low, high = self.bounds
        return np.array([(low[0] + high[0]) / 2.0, (low[1] + high[1]) / 2.0, (low[2] + high[2]) / 2.0])

    @cached_property
    def diagonal(self) -> float:
        if self.bounds is None:
            return 100.0
        low, high = self.bounds
        return float(np.linalg.norm(high - low))

    def space_contacts(self, contact: float = 0.05) -> dict[str, set[str]]:
        key = round(contact, 6)
        contacts = self._space_contacts.setdefault(key, {})
        if not self.derivable_boundaries:
            self.contacts_complete = False
            return contacts
        spaces = self.file.by_type("IfcSpace")
        outstanding = [s for s in spaces if s.GlobalId not in contacts]
        self.contacts_covered = len(contacts)
        if not outstanding:
            self.contacts_complete = True
            return contacts
        if not self.contacts_complete:
            return contacts

        t0 = time.perf_counter()
        for space in outstanding:
            if time.perf_counter() - t0 > CONTACT_BUDGET_SECONDS:
                self.contacts_complete = False
                break
            contacts[space.GlobalId] = self._contacts_for(space, contact)
        self.contacts_covered = len(contacts)
        self.contact_seconds = time.perf_counter() - t0
        return contacts

    @cached_property
    def product_count(self) -> int:
        try:
            return len(self.file.by_type("IfcProduct"))
        except RuntimeError:
            return 0

    @cached_property
    def derivable_boundaries(self) -> bool:
        return self.product_count <= DERIVED_BOUNDARY_MAX_PRODUCTS

    def contacts_of(self, space: Any, contact: float = 0.05) -> set[str]:
        key = round(contact, 6)
        cached = self._space_contacts.setdefault(key, {})
        if not self.derivable_boundaries:
            return set()
        found = cached.get(space.GlobalId)
        if found is None:
            t0 = time.perf_counter()
            found = self._contacts_for(space, contact)
            cached[space.GlobalId] = found
            self.contact_seconds += time.perf_counter() - t0
        return found

    def _contacts_for(self, space: Any, contact: float) -> set[str]:
        try:
            touching = self.tree.select(space, extend=contact)
        except Exception:
            touching = []
        return {e.GlobalId for e in touching if getattr(e, "GlobalId", None) and e.GlobalId != space.GlobalId}

    @cached_property
    def tree(self) -> Any:
        import ifcopenshell.ifcopenshell_wrapper as wrapper

        t0 = time.perf_counter()
        settings = ifcopenshell.geom.settings()
        settings.set("use-world-coords", True)
        settings.set("iterator-output", wrapper.NATIVE)
        tree = ifcopenshell.geom.tree()
        iterator = ifcopenshell.geom.iterator(settings, self.file, 8)
        if iterator.initialize():
            tree.add_iterator(iterator)
        self.tree_seconds = time.perf_counter() - t0
        return tree

    def declared_property(self, element: Any, names: Iterable[str]) -> Any:
        psets = ue.get_psets(element, qtos_only=False) or {}
        for key in names:
            for values in psets.values():
                if not isinstance(values, dict):
                    continue
                value = values.get(key)
                if value is not None:
                    return value
        return None

    def declared_quantity(self, element: Any, names: Iterable[str]) -> DeclaredQuantity | None:
        wanted = list(names)
        verbose = ue.get_psets(element, qtos_only=False, verbose=True) or {}
        quantity_sets = set(ue.get_psets(element, qtos_only=True) or {})

        for qtos_first in (True, False):
            for key in wanted:
                for pset_name, values in verbose.items():
                    if (pset_name in quantity_sets) != qtos_first:
                        continue
                    entry = values.get(key)
                    if not isinstance(entry, dict):
                        continue
                    raw = entry.get("value")
                    if not isinstance(raw, (int, float)) or isinstance(raw, bool):
                        continue
                    scale, unit_label = self._quantity_scale(entry.get("id"))
                    return DeclaredQuantity(
                        path=f"{pset_name}.{key}",
                        value=float(raw) * scale,
                        raw=float(raw),
                        scale=scale,
                        unit_label=unit_label,
                    )
        return None

    def _quantity_scale(self, entity_id: int | None) -> tuple[float, str | None]:
        if entity_id is None:
            return 1.0, None
        try:
            quantity = self.file.by_id(entity_id)
            unit = uu.get_property_unit(quantity, self.file)
        except Exception:
            return 1.0, None
        if unit is None:
            return 1.0, None
        return _unit_scale_to_si(unit), _unit_label(unit)


__all__ = [
    "AIR_TYPES",
    "CONTACT_BUDGET_SECONDS",
    "DERIVED_BOUNDARY_MAX_PRODUCTS",
    "MAX_FILE_BYTES",
    "DeclaredQuantity",
    "ElementGeometry",
    "ModelTooLargeError",
    "ModelUnreadableError",
    "SpatialModel",
    "Storey",
    "UnknownElementError",
]
