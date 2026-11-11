"""A region of a page as ``look`` takes it: four shares of the page as shown, and the box they make in points.

Split out of ``view_image`` so the renderer and the text reader (``sheet.crop_text``) cut the same box: a box
smaller than the minimum is widened about its centre, and the printed text returned with a crop is the text of
the box that was shown.
"""

from __future__ import annotations

import math

#: A box smaller than this, in points (about 8.5 mm), is widened about its
#: centre: a box drawn around one dimension line still needs the line's ends to
#: be read, and a 3-point box is a click, not a question.
_MIN_REGION_PT = 24.0
#: The finest rendering a region gets: 1200 dpi. Past that a vector line is
#: only wider and a raster inside the PDF only blurrier, and the scale would grow
#: without bound as the box shrinks.
_MAX_REGION_SCALE = 1200 / 72
#: The smallest crop of a standalone image, in pixels, for the same reason.
_MIN_REGION_PX = 16

Region = tuple[float, float, float, float]

_REGION_FORMAT = (
    "region is [x, y, w, h]: four shares of the page between 0 and 1, origin top left, "
    "w and h above 0, x + w and y + h at most 1"
)
_EDGE_EPSILON = 1e-6


def parse_region(value: object) -> Region:
    """``value`` as ``(x, y, w, h)``; raises ``ValueError`` naming the expected frame. Pure."""
    if not isinstance(value, list | tuple) or len(value) != 4:
        raise ValueError(_REGION_FORMAT)
    try:
        x, y, w, h = (float(part) for part in value)
    except (TypeError, ValueError) as exc:
        raise ValueError(_REGION_FORMAT) from exc
    if not all(map(math.isfinite, (x, y, w, h))):
        raise ValueError(_REGION_FORMAT)
    if not (0 <= x <= 1 and 0 <= y <= 1 and 0 < w <= 1 and 0 < h <= 1):
        raise ValueError(_REGION_FORMAT)
    if x + w > 1 + _EDGE_EPSILON or y + h > 1 + _EDGE_EPSILON:
        raise ValueError(_REGION_FORMAT)
    return x, y, min(w, 1 - x), min(h, 1 - y)


def _grown(start: float, size: float, minimum: float, total: float) -> tuple[float, float]:
    """One axis of a box, widened about its centre to ``minimum`` and kept on the page. In page units."""
    if size >= minimum or total <= minimum:
        return (0.0, total) if total <= minimum else (start, size)
    centre = start + size / 2
    begin = min(max(centre - minimum / 2, 0.0), total - minimum)
    return begin, minimum


def region_box_pt(region: Region, width_pt: float, height_pt: float) -> tuple[float, float, float, float]:
    """The region as ``(left, top, width, height)`` in points of the shown page, widened to the minimum. Pure."""
    x, y, w, h = region
    left, box_w = _grown(x * width_pt, w * width_pt, _MIN_REGION_PT, width_pt)
    top, box_h = _grown(y * height_pt, h * height_pt, _MIN_REGION_PT, height_pt)
    return left, top, box_w, box_h


def region_render_args(
    region: Region, width_pt: float, height_pt: float, max_dim: int
) -> tuple[float, tuple[float, float, float, float]]:
    """``(scale, crop)`` for ``PdfPage.render``: the crop's long edge about ``max_dim`` pixels. Pure.

    ``crop`` is ``(left, bottom, right, top)``, the points cut off each edge of
    the shown page, which is pypdfium2's order.
    """
    left, top, box_w, box_h = region_box_pt(region, width_pt, height_pt)
    scale = min(max_dim / (max(box_w, box_h) or 1.0), _MAX_REGION_SCALE)
    right = max(width_pt - left - box_w, 0.0)
    bottom = max(height_pt - top - box_h, 0.0)
    return scale, (left, bottom, right, top)
