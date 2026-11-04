"""Questions over a DXF site, each answered with how it was obtained (ADR-0153).

The operations ``dxf_measure`` offers. Every number is computed from the drawing,
never read from a register, and its line says so; in the Grundsteuerkataster
the boundary itself is graphic (BEV spec v2.6, p. 12), so a figure there carries
that caveat. A question the file cannot answer (no unit, no parcels, no
buildings, an unknown parcel) comes back undecidable with what is missing and
what to do about it, never as a guess.

Answers are English lines for the model, with the domain's own words
(Grundsteuerkataster, KG) as data. Pure: no I/O, so the tests drive it with a
built site.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from dataclasses import field

from shapely.geometry import Polygon
from shapely.geometry.base import BaseGeometry
from shapely.ops import unary_union

from .parcels import Parcel
from .site import Footprint
from .site import Site

OPERATIONS = ("overview", "parcels", "parcel", "setbacks", "buildable", "distance", "texts", "layers")

#: Shared edges shorter than this are a corner, not a boundary between two parcels (metres).
_EDGE_M = 0.5


@dataclass
class SiteAnswer:
    """The lines the model reads, and whether the file could answer at all."""

    lines: list[str] = field(default_factory=list)
    decidable: bool = True

    def text(self) -> str:
        return "\n".join(self.lines)


def undecidable(what: str, remedy: str) -> SiteAnswer:
    return SiteAnswer([f"Undecidable: {what}", f"Remedy: {remedy}"], decidable=False)


def _m(value: float) -> str:
    return f"{value:,.2f} m".replace(",", " ")


def _m2(value: float) -> str:
    return f"{value:,.1f} m²".replace(",", " ")


def accuracy_note(site: Site, parcels: list[Parcel] | None = None) -> str:
    """How far a figure from this drawing can be trusted, said once per answer."""
    if not site.is_cadastre:
        return "Computed from the drawing as drawn; accurate to the drawing, not to the site."
    graphic = any(not parcel.boundary_cadastre for parcel in (parcels if parcels is not None else site.parcels))
    if graphic:
        return (
            "Computed from the Katastralmappe as drawn. Grundsteuerkataster boundaries are graphic (decimetres to "
            "metres off) and not legally binding; the land register's area and a survey decide."
        )
    return "Computed from the Katastralmappe as drawn; Grenzkataster boundaries are surveyed to centimetres."


def _needs_metres(site: Site) -> SiteAnswer | None:
    if site.metres_per_unit is None:
        return undecidable(
            "the drawing names no unit, so nothing in it can be measured in metres.",
            "export the DXF again with its unit set ($INSUNITS, e.g. metres or millimetres).",
        )
    return None


def _needs_parcels(site: Site) -> SiteAnswer | None:
    if not site.is_cadastre:
        return undecidable(
            "this drawing is no Katastralmappe, so it holds no parcels "
            "(no GG boundary network with GN parcel numbers).",
            "upload the Katasterauszug as DXF from BEV or the surveyor; for this drawing use 'layers' and 'texts'.",
        )
    if not site.parcels:
        return undecidable("the Katastralmappe holds no parcel numbers.", "upload an extract that includes them.")
    return None


def _parcel_or_refusal(site: Site, name: str) -> Parcel | SiteAnswer:
    refusal = _needs_parcels(site)
    if refusal:
        return refusal
    candidates = site.matching(name or "")
    if len(candidates) > 1:
        kgs = ", ".join(f"'{candidate.number} KG {candidate.community}'" for candidate in candidates)
        return undecidable(
            f"'{name}' names {len(candidates)} parcels, one in each cadastral community (KG).",
            f"name the KG with the number: {kgs}.",
        )
    parcel = candidates[0] if candidates else None
    if parcel is None:
        known = ", ".join(p.number for p in site.parcels[:20])
        return undecidable(
            f"no parcel '{name}' in this file.",
            f"name one of the file's parcels: {known}{' …' if len(site.parcels) > 20 else ''}",
        )
    if parcel.polygon is None:
        return undecidable(
            f"parcel {parcel.number}'s boundary is not closed in this file (cut at the edge of the extract).",
            "upload an extract that contains the whole parcel.",
        )
    return parcel


_UNIT_NAMES = {
    0.001: "millimetres",
    0.01: "centimetres",
    0.1: "decimetres",
    1.0: "metres",
    1000.0: "kilometres",
    0.0254: "inches",
    0.3048: "feet",
    0.9144: "yards",
    1609.344: "miles",
}


def _unit_text(metres_per_unit: float | None) -> str:
    """The drawing's unit as a reader names it; every one with a factor to metres can be measured."""
    if metres_per_unit is None:
        return "unit not stated: nothing can be measured in metres"
    name = next((name for factor, name in _UNIT_NAMES.items() if abs(factor - metres_per_unit) < 1e-9), None)
    return f"unit {name}" if name else f"unit {metres_per_unit:g} m"


def overview(site: Site) -> SiteAnswer:
    """What the drawing is, what it holds, and what it can answer."""
    source = site.source
    msp = source.doc.modelspace()
    answer = SiteAnswer()
    if site.is_cadastre:
        cadastre = source.cadastre
        crs = (
            f"MGI / Austria GK M{cadastre.meridian} (EPSG {cadastre.epsg})"
            if cadastre.epsg
            else "coordinate system not stated"
        )
        answer.lines.append(
            f"Katastralmappe (BEV), KG {', '.join(cadastre.cadastral_communities) or '–'}, {crs}, metres."
        )
        boundary = sum(1 for parcel in site.parcels if parcel.boundary_cadastre)
        open_ = sum(1 for parcel in site.parcels if parcel.polygon is None)
        answer.lines.append(
            f"Parcels: {len(site.parcels)} ({boundary} Grenzkataster, "
            f"{len(site.parcels) - boundary} Grundsteuerkataster"
            f"{f', {open_} not closed in this file' if open_ else ''})."
        )
    else:
        answer.lines.append(f"DXF drawing, {_unit_text(site.metres_per_unit)}.")
    layers = Counter(entity.dxf.layer for entity in msp)
    answer.lines.append(
        f"Buildings: {len(site.footprints)} closed outlines on "
        f"{', '.join(site.building_layers) or 'no layer (name one)'}."
    )
    answer.lines.append("Layers: " + ", ".join(f"{name} {count}" for name, count in layers.most_common(15)) + ".")
    answer.lines.append(
        "Next: 'parcel' with a parcel number, 'parcels' for the list, "
        "'setbacks', 'buildable', 'distance', 'texts', 'layers'."
    )
    return answer


def parcels(site: Site, numbers: list[str] | None = None, limit: int = 50) -> SiteAnswer:
    """The parcels as rows, all or the ones named."""
    refusal = _needs_parcels(site)
    if refusal:
        return refusal
    chosen = [parcel for name in numbers for parcel in site.matching(name)] if numbers else list(site.parcels)
    unknown = [name for name in numbers or [] if not site.matching(name)]
    rows = chosen[:limit]
    answer = SiteAnswer([accuracy_note(site, rows)])
    for parcel in rows:
        answer.lines.append(_parcel_row(site, parcel))
    if len(chosen) > len(rows):
        answer.lines.append(f"… {len(chosen) - len(rows)} more not listed (raise 'limit' or name the parcels).")
    if unknown:
        answer.lines.append(f"Not in this file: {', '.join(unknown)}.")
    return answer


def _parcel_row(site: Site, parcel: Parcel) -> str:
    cadastre = "Grenzkataster" if parcel.boundary_cadastre else "Grundsteuerkataster"
    area = "not closed" if parcel.area_m2 is None else _m2(parcel.area_m2)
    built = (
        sum(footprint.polygon.intersection(parcel.polygon).area for footprint in site.on_parcel(parcel))
        if parcel.polygon
        else 0.0
    )
    coverage = f", built {_m2(built)} ({built / parcel.area_m2:.1%})" if parcel.area_m2 and built else ""
    neighbours = ", ".join(parcel.neighbours) or "–"
    return f"{parcel.number} · KG {parcel.community or '–'} · {cadastre} · {area}{coverage} · neighbours {neighbours}"


def shared_edges(site: Site, parcel: Parcel) -> list[tuple[str, BaseGeometry]]:
    """Each neighbour and the boundary it shares with this parcel; ``""`` for the part with no neighbour in the file."""
    own = parcel.polygon.boundary
    edges: list[tuple[str, BaseGeometry]] = []
    # By geometry, not by name alone: a neighbour's number may also name a parcel in another KG.
    for other in (other for other in site.parcels if other.number in parcel.neighbours and other is not parcel):
        if other.polygon is None:
            continue
        shared = own.intersection(other.polygon.boundary)
        if shared.length >= _EDGE_M:
            edges.append((site.label(other), shared))
    rest = own.difference(unary_union([edge for _name, edge in edges])) if edges else own
    if rest.length >= _EDGE_M:
        edges.append(("", rest))
    return edges


def parcel(site: Site, name: str) -> SiteAnswer:
    """One parcel: size, shape, boundary by neighbour, what stands on it."""
    found = _parcel_or_refusal(site, name)
    if isinstance(found, SiteAnswer):
        return found
    polygon = found.polygon
    width, depth = _rectangle(polygon)
    cadastre = "Grenzkataster" if found.boundary_cadastre else "Grundsteuerkataster"
    answer = SiteAnswer([accuracy_note(site, [found])])
    answer.lines.append(
        f"Parcel {found.number}, KG {found.community or '–'}, {cadastre}: "
        f"area {_m2(polygon.area)}, perimeter {_m(polygon.length)}, "
        f"smallest enclosing rectangle {_m(width)} × {_m(depth)}."
    )
    for neighbour, edge in shared_edges(site, found):
        where = f"with {neighbour}" if neighbour else "with no parcel in this file (edge of the extract)"
        answer.lines.append(f"Boundary {where}: {_m(edge.length)}.")
    standing = site.on_parcel(found)
    built = sum(footprint.polygon.intersection(polygon).area for footprint in standing)
    for footprint in standing:
        w, d = _rectangle(footprint.polygon)
        answer.lines.append(
            f"Building {footprint.number} ({footprint.layer}): {_m2(footprint.polygon.area)}, {_m(w)} × {_m(d)}."
        )
    answer.lines.append(
        f"Built-up area {_m2(built)}, coverage {built / polygon.area:.1%} of the parcel."
        if standing
        else "No building outline on this parcel in the file."
    )
    return answer


def setbacks(site: Site, name: str) -> SiteAnswer:
    """For each building on the parcel, its shortest distance to each part of the parcel's boundary."""
    found = _parcel_or_refusal(site, name)
    if isinstance(found, SiteAnswer):
        return found
    standing = site.on_parcel(found)
    if not standing:
        return undecidable(
            f"no building outline stands on parcel {found.number} in this file.",
            "check 'overview' for the building layers, or name the layer that holds the outlines.",
        )
    answer = SiteAnswer([accuracy_note(site, [found])])
    edges = shared_edges(site, found)
    for footprint in standing:
        parts = [
            f"to {neighbour or 'the extract edge'} {_m(footprint.polygon.distance(edge))}" for neighbour, edge in edges
        ]
        nearest = min(footprint.polygon.distance(edge) for _neighbour, edge in edges)
        answer.lines.append(f"Building {footprint.number}: {'; '.join(parts)}. Nearest boundary {_m(nearest)}.")
    return answer


def _rectangle(polygon: Polygon) -> tuple[float, float]:
    """The sides of the smallest rotated rectangle around a shape, longer first."""
    box = polygon.minimum_rotated_rectangle
    xs, ys = box.exterior.coords.xy
    sides = [((xs[i + 1] - xs[i]) ** 2 + (ys[i + 1] - ys[i]) ** 2) ** 0.5 for i in range(2)]
    return max(sides), min(sides)


def _fraction(limit: float | None) -> float | None:
    """A limit given as 0.4 or as 40 (percent) as a fraction."""
    if limit is None:
        return None
    return limit / 100 if limit > 1 else limit


def buildable(
    site: Site,
    name: str,
    setback_m: float | None = None,
    setbacks_by_neighbour: dict[str, float] | None = None,
    coverage_limit: float | None = None,
    density_limit: float | None = None,
) -> SiteAnswer:
    """What remains of the parcel after the setbacks the caller gives, and what the limits allow."""
    found = _parcel_or_refusal(site, name)
    if isinstance(found, SiteAnswer):
        return found
    if setback_m is None and not setbacks_by_neighbour and coverage_limit is None and density_limit is None:
        return undecidable(
            "no setback or limit was given.",
            "pass 'setback_m' (and per neighbour 'setbacks'), 'coverage_limit' or 'density_limit' from the "
            "Bebauungsplan or the building code; they are not read from the drawing.",
        )
    polygon = found.polygon
    answer = SiteAnswer(
        [accuracy_note(site, [found]), "The setbacks and limits are the ones given, not read from law or plan."]
    )
    remaining = _inset(site, found, setback_m or 0.0, {**(setbacks_by_neighbour or {})})
    if setback_m is not None or setbacks_by_neighbour:
        answer.lines.append(_remaining_line(remaining, polygon))
    built = sum(fp.polygon.intersection(polygon).area for fp in site.on_parcel(found))
    coverage = _fraction(coverage_limit)
    if coverage is not None:
        allowed = coverage * polygon.area
        answer.lines.append(
            f"Coverage limit {coverage:.0%}: at most {_m2(allowed)} built-up area; existing {_m2(built)}, "
            f"{_m2(max(allowed - built, 0.0))} left."
        )
    if density_limit is not None:
        answer.lines.append(
            f"Density limit {density_limit:g}: at most {_m2(density_limit * polygon.area)} gross floor area."
        )
    return answer


def _remaining_line(remaining: BaseGeometry, polygon: BaseGeometry) -> str:
    """What remains inside the setbacks, said so it is not read as a building that fits."""
    if remaining.is_empty:
        return "Nothing remains inside these setbacks."
    pieces = list(getattr(remaining, "geoms", [remaining]))
    largest = max(pieces, key=lambda piece: piece.area)
    width, depth = _rectangle(largest)
    split = f" in {len(pieces)} separate pieces, the largest {_m2(largest.area)}" if len(pieces) > 1 else ""
    return (
        f"Buildable area inside the setbacks: {_m2(remaining.area)} ({remaining.area / polygon.area:.1%} of "
        f"{_m2(polygon.area)}){split}; its enclosing rectangle is {_m(width)} × {_m(depth)} "
        "(the area's outer bounds, not a building footprint that fits)."
    )


def _inset(site: Site, parcel: Parcel, default_m: float, by_neighbour: dict[str, float]) -> BaseGeometry:
    """The parcel minus a band along each boundary part, as wide as that part's setback (in drawing units)."""
    keyed = {site.label(found): value for name, value in by_neighbour.items() if (found := site.parcel(name))}
    unit = site.metres_per_unit or 1.0
    # Round ends, not flat: the band is every point closer to that boundary part than its setback,
    # which at a re-entrant corner is a quarter circle a flat band leaves out (buildable too large).
    bands = [
        edge.buffer(keyed.get(neighbour, default_m) / unit)
        for neighbour, edge in shared_edges(site, parcel)
        if keyed.get(neighbour, default_m) > 0
    ]
    return parcel.polygon.difference(unary_union(bands)) if bands else parcel.polygon


def distance(site: Site, first: str, second: str) -> SiteAnswer:
    """The shortest distance between two parcels or buildings („123/4“, „building 2“)."""
    refusal = _needs_metres(site)
    if refusal:
        return refusal
    shapes = [_shape(site, ref) for ref in (first, second)]
    for ref, shape in zip((first, second), shapes, strict=True):
        if shape is None:
            return undecidable(
                f"'{ref}' is neither a parcel nor a building of this file.", "use 'parcels' or 'overview' for names."
            )
    gap = site.metres(shapes[0].distance(shapes[1]))
    note = " They touch or overlap." if gap == 0 else ""
    return SiteAnswer([accuracy_note(site), f"Shortest distance {first} – {second}: {_m(gap)}.{note}"])


def _shape(site: Site, ref: str) -> BaseGeometry | None:
    words = ref.strip().lower().split()
    if len(words) == 2 and words[0] in {"building", "gebäude", "gebaeude"} and words[1].isdigit():
        footprint: Footprint | None = site.footprint(int(words[1]))
        return footprint.polygon if footprint else None
    found = site.parcel(ref)
    return found.polygon if found else None
