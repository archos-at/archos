"""Reading any DXF by its own vocabulary: its texts and its layers (ADR-0153).

The cadastre operations (``site_ops``) need a Katastralmappe. These two work on
any drawing: ``texts`` finds labels (a room name, a parcel number, a street) and
says where they stand and on which parcel; ``layers`` says what each layer holds
and sums what can be summed there (length of lines, area of closed outlines), so
a question like "how much area is on the layer GRÜNFLÄCHE" has an answer with
its provenance.
"""

from __future__ import annotations

from collections import Counter
from collections import defaultdict
from collections.abc import Iterator

from ezdxf import path as dxf_path
from ezdxf.entities import DXFGraphic
from ezdxf.math import Vec3
from shapely.geometry import Point

from .site import Site
from .site import closed_outlines
from .site_ops import SiteAnswer
from .site_ops import accuracy_note

#: The most of one label an answer quotes: an MTEXT can be a page of prose.
_LABEL_CHARS = 200

_LENGTH_TYPES = frozenset({"LINE", "LWPOLYLINE", "POLYLINE", "ARC", "CIRCLE", "SPLINE", "ELLIPSE"})


def _labels(site: Site) -> Iterator[tuple[str, str, Vec3]]:
    for entity in site.source.doc.modelspace():
        kind = entity.dxftype()
        if kind == "TEXT":
            yield entity.dxf.text, entity.dxf.layer, entity.dxf.insert
        elif kind == "MTEXT":
            yield entity.plain_text(), entity.dxf.layer, entity.dxf.insert
        elif kind == "INSERT":
            for attrib in entity.attribs:
                if not attrib.is_invisible:
                    yield attrib.dxf.text, attrib.dxf.layer, attrib.dxf.insert


def texts(site: Site, query: str, limit: int = 30) -> SiteAnswer:
    """Labels containing ``query`` (case-insensitive), where they stand, and on which parcel."""
    wanted = " ".join((query or "").split()).lower()
    answer = SiteAnswer()
    found = 0
    for text, layer, insert in _labels(site):
        clean = " ".join(str(text).split())
        if not clean or (wanted and wanted not in clean.lower()):
            continue
        found += 1
        if found > limit:
            continue
        on = _parcel_at(site, float(insert[0]), float(insert[1]))
        where = f", on parcel {on}" if on else ""
        shown = clean if len(clean) <= _LABEL_CHARS else f"{clean[:_LABEL_CHARS]}…"
        answer.lines.append(f"'{shown}' · layer {layer} · at {insert[0]:.2f}, {insert[1]:.2f}{where}")
    if found == 0:
        return SiteAnswer([f"No text containing '{query}' in this drawing."])
    if found > limit:
        answer.lines.append(f"… {found - limit} more (narrow 'query' or raise 'limit').")
    return answer


def _parcel_at(site: Site, x: float, y: float) -> str:
    point = Point(x, y)
    return next(
        (parcel.number for parcel in site.parcels if parcel.polygon is not None and parcel.polygon.contains(point)), ""
    )


def _length(entity: DXFGraphic) -> float:
    """The entity's length along its flattened path (arcs and bulges to 1 cm), 0 for what has none."""
    try:
        points = list(dxf_path.make_path(entity).flattening(0.01))
    except TypeError, ValueError, AttributeError:
        return 0.0
    return sum(a.distance(b) for a, b in zip(points, points[1:], strict=False))


def _number(value: float) -> str:
    return f"{value:,.1f}".replace(",", " ")


def layers(site: Site, limit: int = 40) -> SiteAnswer:
    """What each layer holds: entity kinds, total line length, and closed outlines with their area."""
    kinds: dict[str, Counter[str]] = defaultdict(Counter)
    lengths: dict[str, float] = defaultdict(float)
    for entity in site.source.doc.modelspace():
        layer = entity.dxf.layer
        kinds[layer][entity.dxftype()] += 1
        if entity.dxftype() in _LENGTH_TYPES:
            lengths[layer] += _length(entity)
    areas: dict[str, tuple[int, float]] = {}
    for layer, polygon in closed_outlines(site.source.doc, tuple(name.upper() for name in kinds)):
        count, area = areas.get(layer, (0, 0.0))
        areas[layer] = (count + 1, area + polygon.area)
    answer = SiteAnswer([accuracy_note(site)])
    if site.metres_per_unit is None:
        answer.lines.append("The drawing names no unit: lengths and areas are in its own units, not metres.")
    length_unit, area_unit = ("m", "m²") if site.metres_per_unit is not None else ("drawing units", "square units")
    ordered = sorted(kinds.items(), key=lambda item: -sum(item[1].values()))
    for layer, counts in ordered[:limit]:
        parts = [", ".join(f"{kind} {count}" for kind, count in counts.most_common(4))]
        if lengths[layer]:
            parts.append(f"lines {_number(site.metres(lengths[layer]))} {length_unit}")
        closed = areas.get(layer.upper())
        if closed:
            parts.append(f"{closed[0]} closed outlines, {_number(site.square_metres(closed[1]))} {area_unit}")
        answer.lines.append(f"{layer}: {' · '.join(parts)}")
    if len(ordered) > limit:
        answer.lines.append(f"… {len(ordered) - limit} more layers.")
    return answer
