"""A DXF as a site: parcels, building footprints and how they relate (ADR-0153).

What the agent asks a Katasterauszug is about the site, not about entities:
how large a parcel is, who borders it, what stands on it and how far from the
boundary, what is left to build on after the setbacks. This module builds that
site once from a read drawing (``dxf_source``): the parcels rebuilt from the
boundary network (``parcels``), the building outlines, and which building stands
on which parcel. ``site_ops`` answers questions over it.

Units: a Katastralmappe is metres by its spec. Any other drawing is converted by
its ``$INSUNITS``; one that names no unit has no site in metres, and every
measuring operation says so instead of guessing (``Site.metres_per_unit`` None).

Buildings: in a Katastralmappe the closed outlines on ``HG`` (surveyed) and
``HL`` (from aerial imagery, §3.6). In any other drawing, closed polylines on
the layers the caller names; nothing is guessed from a layer's name.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from dataclasses import replace

from ezdxf.document import Drawing
from shapely.geometry import Polygon
from shapely.geometry.base import BaseGeometry
from shapely.ops import unary_union
from shapely.strtree import STRtree

from .dxf_source import DxfSource
from .parcels import Parcel
from .parcels import read_parcels

#: The cadastre's building layers: surveyed outlines and those from aerial imagery (§3.6).
CADASTRE_BUILDING_LAYERS = ("HG", "HL")

#: The smallest share of a footprint that makes it stand "on" a parcel:
#: an outline drawn a hair over the line is not on two.
_ON_PARCEL_SHARE = 0.05


@dataclass(frozen=True)
class Footprint:
    """One building outline: where it is drawn and what it stands on."""

    #: 1-based, in drawing order: how the agent names it ("building 3").
    number: int
    layer: str
    polygon: Polygon
    #: The parcels it stands on, by :func:`identity` (a number is unique only within its KG).
    parcels: tuple[str, ...]


@dataclass(frozen=True)
class Site:
    """Parcels and footprints of one drawing, and what its numbers are worth."""

    source: DxfSource
    metres_per_unit: float | None
    parcels: tuple[Parcel, ...]
    footprints: tuple[Footprint, ...]
    #: The layers the footprints were read from.
    building_layers: tuple[str, ...]

    @property
    def is_cadastre(self) -> bool:
        return self.source.cadastre is not None

    def matching(self, name: str) -> list[Parcel]:
        """Every parcel a name can mean: „Gst. 123/4“, „123/4“, „.57“, narrowed by „KG 16117“ when given.

        A number is unique only within its cadastral community (KG), so an extract
        across a KG boundary can hold two parcels named alike.
        """
        community = _COMMUNITY.search(name or "")
        number = parcel_key(_COMMUNITY.sub(" ", name or ""))
        return [
            parcel
            for parcel in self.parcels
            if parcel_key(parcel.number) == number and (community is None or parcel.community == community.group(1))
        ]

    def parcel(self, name: str) -> Parcel | None:
        """The one parcel a name means; None when it means none or more than one."""
        found = self.matching(name)
        return found[0] if len(found) == 1 else None

    def label(self, parcel: Parcel) -> str:
        """How answers name a parcel: its number, with its KG when the number alone is ambiguous."""
        twins = sum(1 for other in self.parcels if other.number == parcel.number)
        return f"{parcel.number} (KG {parcel.community})" if twins > 1 and parcel.community else parcel.number

    def footprint(self, number: int) -> Footprint | None:
        return next((footprint for footprint in self.footprints if footprint.number == number), None)

    def on_parcel(self, parcel: Parcel) -> list[Footprint]:
        return [footprint for footprint in self.footprints if identity(parcel) in footprint.parcels]

    def metres(self, length: float) -> float:
        return length * (self.metres_per_unit or 1.0)

    def square_metres(self, area: float) -> float:
        return area * (self.metres_per_unit or 1.0) ** 2


_COMMUNITY = re.compile(r"\bKG\s*(\d+)", re.IGNORECASE)


def identity(parcel: Parcel) -> str:
    """A parcel's identity in one drawing: its KG and its number."""
    return f"{parcel.community}/{parcel.number}"


def parcel_key(name: str) -> str:
    """A parcel number stripped of the words around it, for matching: „Gst. Nr. 123/4“ → „123/4“."""
    text = unicodedata.normalize("NFC", name).strip().lower()
    text = re.sub(r"^(gst\.?|grundstück|grundstueck|parzelle)?\s*(-?\s*nr\.?)?\s*", "", text)
    return text.replace(" ", "")


def build_site(source: DxfSource, building_layers: tuple[str, ...] = ()) -> Site:
    """The site of a read drawing.

    ``building_layers`` names the footprint layers of a drawing that is no Katastralmappe.
    """
    parcels = tuple(_whole(read_parcels(source.doc))) if source.cadastre is not None else ()
    layers = CADASTRE_BUILDING_LAYERS if source.cadastre is not None and not building_layers else building_layers
    outlines = closed_outlines(source.doc, tuple(layer.upper() for layer in layers))
    return Site(
        source=source,
        metres_per_unit=source.metres_per_unit,
        parcels=parcels,
        footprints=tuple(_footprints(outlines, parcels)),
        building_layers=tuple(layer.upper() for layer in layers),
    )


def _whole(parts: list[Parcel]) -> list[Parcel]:
    """One parcel per KG and number: a parcel drawn as several meshes (cut by a road) is one parcel.

    Its area is the sum of its parts; a part not closed in this file leaves the
    whole parcel unclosed, so no operation measures a part as if it were all.
    """
    grouped: dict[str, list[Parcel]] = {}
    for part in parts:
        grouped.setdefault(identity(part), []).append(part)
    whole = []
    for group in grouped.values():
        if len(group) == 1:
            whole.append(group[0])
            continue
        closed = all(part.polygon is not None for part in group)
        shape: BaseGeometry | None = unary_union([part.polygon for part in group]) if closed else None
        neighbours = tuple(dict.fromkeys(n for part in group for n in part.neighbours if n != group[0].number))
        whole.append(
            replace(
                group[0],
                area_m2=sum(part.area_m2 or 0.0 for part in group) if closed else None,
                neighbours=neighbours,
                polygon=shape,
                boundary_cadastre=any(part.boundary_cadastre for part in group),
            )
        )
    return whole


def _footprints(outlines: list[tuple[str, Polygon]], parcels: tuple[Parcel, ...]) -> list[Footprint]:
    shaped = [parcel for parcel in parcels if parcel.polygon is not None]
    tree = STRtree([parcel.polygon for parcel in shaped]) if shaped else None
    footprints = []
    for index, (layer, polygon) in enumerate(outlines, start=1):
        on: list[str] = []
        if tree is not None:
            for candidate in tree.query(polygon, predicate="intersects"):
                parcel = shaped[int(candidate)]
                if parcel.polygon.intersection(polygon).area >= _ON_PARCEL_SHARE * polygon.area:
                    on.append(identity(parcel))
        footprints.append(Footprint(number=index, layer=layer, polygon=polygon, parcels=tuple(on)))
    return footprints


def closed_outlines(doc: Drawing, layers: tuple[str, ...]) -> list[tuple[str, Polygon]]:
    """Every closed polyline on these layers, as a valid polygon with its layer.

    Closed by the flag or by repeating the first vertex (BEV closes building
    outlines by repetition and forbids the flag, §3.6).
    """
    outlines: list[tuple[str, Polygon]] = []
    if not layers:
        return outlines
    for polyline in doc.modelspace().query("POLYLINE LWPOLYLINE"):
        layer = polyline.dxf.layer.upper()
        if layer not in layers:
            continue
        if polyline.dxftype() == "POLYLINE":
            points = [(float(vertex[0]), float(vertex[1])) for vertex in polyline.points()]
        else:
            points = [(float(x), float(y)) for x, y in polyline.get_points("xy")]
        closed = polyline.is_closed or (len(points) > 3 and points[0] == points[-1])
        if not closed or len(points) < 3:
            continue
        polygon = Polygon(points)
        if not polygon.is_valid:
            polygon = polygon.buffer(0)
        if isinstance(polygon, Polygon) and polygon.area > 0:
            outlines.append((layer, polygon))
    return outlines
