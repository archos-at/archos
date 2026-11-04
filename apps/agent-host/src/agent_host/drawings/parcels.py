"""The parcels a Katastralmappe holds, rebuilt from its boundary network (ADR-0152).

A DKM never stores a parcel as a polygon. Its boundaries run from node to node
across the whole sheet (BEV spec v2.6, §3.2: "Netzkanten von Knoten zu
Knoten"), and a parcel number names the mesh its reference point falls into
(§3.3: the text's centre, or a number with an arrow's tip). So the network of
every boundary rank (GG up to RG) is unioned and polygonized, and each number is
placed in the mesh that contains it. Arcs (a vertex's bulge) are flattened to
5 cm.

What comes out is what the map says, not the land register: the area is
computed from the boundary as drawn, which in the Grundsteuerkataster is graphic
(§2, p. 12). The page that lists it says so. A mesh cut open at the edge of an
extract has no area and is listed as such, rather than closed by a guess.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from ezdxf import path as dxf_path
from ezdxf.document import Drawing
from shapely.geometry import LineString
from shapely.geometry import Point
from shapely.geometry import Polygon
from shapely.ops import polygonize
from shapely.ops import unary_union
from shapely.strtree import STRtree

#: Every boundary rank: together they form the closed network (§3.2).
BOUNDARY_LAYERS = frozenset({"GG", "KG", "PG", "BG", "VG", "LG", "RG"})

#: The parcel-number blocks that name an area: single-line and arrowed, in either cadastre (§3.3).
_NUMBER_BLOCKS = {"GN1": False, "GNP": False, "GN1G": True, "GNPG": True}

#: How far a shared edge must run for two parcels to count as neighbours, in metres: a corner is not a boundary.
_NEIGHBOUR_EDGE_M = 0.5


@dataclass(frozen=True)
class Parcel:
    """One parcel as the map draws it."""

    number: str
    community: str
    #: In the Grenzkataster (legally binding boundary) rather than the Grundsteuerkataster.
    boundary_cadastre: bool
    #: Square metres from the drawn boundary, or None when its mesh is not closed in this file.
    area_m2: float | None
    neighbours: tuple[str, ...]


def read_parcels(doc: Drawing) -> list[Parcel]:
    """Every numbered parcel in the model space, in parcel-number order."""
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
        )
        for number, community, boundary, mesh in placed
    ]
    return sorted(parcels, key=lambda parcel: parcel_sort_key(parcel.number))


def _neighbours(
    tree: STRtree | None, meshes: list[Polygon], mesh: int, numbers_by_mesh: dict[int, list[str]]
) -> tuple[str, ...]:
    """The numbers of the meshes sharing more than a corner with this one, found through the index."""
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
    """The index of the mesh a parcel number's reference point lies in."""
    if tree is None:
        return None
    for index in tree.query(point, predicate="within"):
        return int(index)
    return None


def parcel_sort_key(number: str) -> tuple[int, int, int, str]:
    """Parcel numbers as a surveyor sorts them: Bauflächen (".57") first, then by stem and sub-number."""
    building_plot = 0 if number.startswith(".") else 1
    stem, _, sub = number.lstrip(".").partition("/")
    return building_plot, _int(stem), _int(sub), number


def _int(text: str) -> int:
    match = re.match(r"\d+", text)
    return int(match.group()) if match else 0
