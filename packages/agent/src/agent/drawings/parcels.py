from __future__ import annotations

import re
from dataclasses import dataclass
from dataclasses import field

from ezdxf import path as dxf_path
from ezdxf.document import Drawing
from shapely.geometry import LineString
from shapely.geometry import Point
from shapely.geometry import Polygon
from shapely.ops import polygonize
from shapely.ops import unary_union
from shapely.strtree import STRtree

BOUNDARY_LAYERS = frozenset({"GG", "KG", "PG", "BG", "VG", "LG", "RG"})

_NUMBER_BLOCKS = {"GN1": False, "GNP": False, "GN1G": True, "GNPG": True}

_NEIGHBOUR_EDGE_M = 0.5


@dataclass(frozen=True)
class Parcel:
    number: str
    community: str
    boundary_cadastre: bool
    area_m2: float | None
    neighbours: tuple[str, ...]
    polygon: Polygon | None = field(default=None, compare=False, repr=False)


def read_parcels(doc: Drawing) -> list[Parcel]:
    meshes = _meshes(doc)
    tree = STRtree(meshes) if meshes else None
    placed: list[tuple[str, str, bool, int | None]] = []
    for insert in doc.modelspace().query("INSERT"):
        boundary = _NUMBER_BLOCKS.get(insert.dxf.name.upper())
        if boundary is None or not insert.attribs:
            continue
        first = insert.attribs[0]
        community = first.dxf.tag.strip().split("*", 1)[0]
        point = Point(float(insert.dxf.insert[0]), float(insert.dxf.insert[1]))
        mesh = _containing(tree, point)
        placed.append((first.dxf.text.strip(), community if community.isdigit() else "", boundary, mesh))
    numbers_by_mesh: dict[int, list[str]] = {}
    for number, _community, _boundary, mesh in placed:
        if mesh is not None:
            numbers_by_mesh.setdefault(mesh, []).append(number)
    parcels = [
        Parcel(
            number=number,
            community=community,
            boundary_cadastre=boundary,
            area_m2=None if mesh is None else float(meshes[mesh].area),
            neighbours=() if mesh is None else _neighbours(tree, meshes, mesh, numbers_by_mesh),
            polygon=None if mesh is None else meshes[mesh],
        )
        for number, community, boundary, mesh in placed
    ]
    return sorted(parcels, key=lambda parcel: parcel_sort_key(parcel.number))


def _neighbours(
    tree: STRtree | None, meshes: list[Polygon], mesh: int, numbers_by_mesh: dict[int, list[str]]
) -> tuple[str, ...]:
    if tree is None:
        return ()
    own = meshes[mesh].boundary
    found: set[str] = set()
    for candidate in tree.query(meshes[mesh], predicate="intersects"):
        other = int(candidate)
        if other == mesh or other not in numbers_by_mesh:
            continue
        if own.intersection(meshes[other].boundary).length >= _NEIGHBOUR_EDGE_M:
            found.update(numbers_by_mesh[other])
    return tuple(sorted(found, key=parcel_sort_key))


def _meshes(doc: Drawing) -> list[Polygon]:
    lines = []
    for entity in doc.modelspace().query("POLYLINE LWPOLYLINE LINE ARC"):
        if entity.dxf.layer.upper() not in BOUNDARY_LAYERS:
            continue
        points = [(vertex.x, vertex.y) for vertex in dxf_path.make_path(entity).flattening(0.05)]
        if len(points) >= 2:
            lines.append(LineString(points))
    if not lines:
        return []
    return [mesh for mesh in polygonize(unary_union(lines)) if mesh.area > 0]


def _containing(tree: STRtree | None, point: Point) -> int | None:
    if tree is None:
        return None
    for index in tree.query(point, predicate="within"):
        return int(index)
    return None


def parcel_sort_key(number: str) -> tuple[int, int, int, str]:
    building_plot = 0 if number.startswith(".") else 1
    stem, _, sub = number.lstrip(".").partition("/")
    return building_plot, _int(stem), _int(sub), number


def _int(text: str) -> int:
    match = re.match(r"\d+", text)
    return int(match.group()) if match else 0
