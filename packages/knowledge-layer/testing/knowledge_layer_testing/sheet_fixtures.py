"""Hand-written vector drawing sheets, for tests that read geometry, figures and stored scale regions.

A CAD plot is linework and text as page objects, on a page whose box, rotation
and viewports say how to read it. No writer in the dependency set can set those
entries (``/Rotate``, a CropBox whose origin is not zero, ``/UserUnit``, ``/VP``
with ``/Measure``, a text matrix at any angle), so this writes them directly, on
:func:`knowledge_layer_testing.pdf_fixtures._xref_pdf`.

Everything a caller draws is in the page's own user space (points, origin
bottom left, before the crop and the rotation), which is what a plot file
holds. :meth:`SheetPage.shown` says where such a point lands on the page as a
viewer shows it; the reader tests check that against PDFium, not against this.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from dataclasses import field

from knowledge_layer_testing.pdf_fixtures import _escape
from knowledge_layer_testing.pdf_fixtures import _xref_pdf

Box = tuple[float, float, float, float]

#: ISO 216 sheets in points, landscape: ``(width, height)``.
A1_LANDSCAPE = (2383.94, 1683.78)
A3_LANDSCAPE = (1190.55, 841.89)
A4_PORTRAIT = (595.28, 841.89)


@dataclass
class SheetPage:
    """One page being drawn: its boxes, rotation, viewports and content stream."""

    media_box: Box = (0.0, 0.0, *A3_LANDSCAPE)
    crop_box: Box | None = None
    rotate: int = 0
    user_unit: float | None = None
    #: Write the boxes on the page tree's node, not the page: a page then inherits them, as many plots do.
    inherit_boxes: bool = False
    _ops: bytearray = field(default_factory=bytearray)
    _viewports: list[str] = field(default_factory=list)
    _forms: list[bytes] = field(default_factory=list)

    @property
    def box(self) -> Box:
        """The box a viewer shows: the CropBox when there is one, else the MediaBox."""
        return self.crop_box or self.media_box

    def shown_size(self) -> tuple[float, float]:
        x0, y0, x1, y1 = self.box
        width, height = x1 - x0, y1 - y0
        return (height, width) if self.rotate in (90, 270) else (width, height)

    def shown(self, x: float, y: float) -> tuple[float, float]:
        """Where a user-space point lands on the page as shown: points, origin top left, y down."""
        x0, y0, x1, y1 = self.box
        u, v, width, height = x - x0, y - y0, x1 - x0, y1 - y0
        if self.rotate == 0:
            return u, height - v
        if self.rotate == 90:
            return v, u
        if self.rotate == 180:
            return width - u, v
        return height - v, width - u

    def shown_share(self, x: float, y: float) -> tuple[float, float]:
        sx, sy = self.shown(x, y)
        width, height = self.shown_size()
        return sx / width, sy / height

    def raw(self, ops: str) -> None:
        self._ops += ops.encode("ascii") + b"\n"

    def style(self, *, width: float = 0.5, dash: tuple[float, float] | None = None, rgb: tuple = (0, 0, 0)) -> None:
        """The stroke that follows: width in points, a dash pattern or solid, a colour of three shares."""
        pattern = f"[{dash[0]} {dash[1]}] 0 d" if dash else "[] 0 d"
        self.raw(f"{width} w {pattern} {rgb[0]} {rgb[1]} {rgb[2]} RG")

    def line(self, x0: float, y0: float, x1: float, y1: float) -> None:
        self.raw(f"{x0:.4f} {y0:.4f} m {x1:.4f} {y1:.4f} l S")

    def polyline(self, points: list[tuple[float, float]], *, close: bool = False) -> None:
        head, *rest = points
        path = f"{head[0]:.4f} {head[1]:.4f} m " + " ".join(f"{x:.4f} {y:.4f} l" for x, y in rest)
        self.raw(f"{path} {'s' if close else 'S'}")

    def rect(self, x: float, y: float, width: float, height: float, *, fill: bool = False) -> None:
        self.raw(f"{x:.4f} {y:.4f} {width:.4f} {height:.4f} re {'f' if fill else 'S'}")

    def curve(self, start: tuple, control_1: tuple, control_2: tuple, end: tuple) -> None:
        """One cubic Bézier, stroked: a door swing, an arc."""
        numbers = " ".join(f"{value:.4f}" for point in (control_1, control_2, end) for value in point)
        self.raw(f"{start[0]:.4f} {start[1]:.4f} m {numbers} c S")

    def text(self, x: float, y: float, text: str, *, size: float = 8.0, angle: float = 0.0, rise: float = 0.0) -> None:
        """``text`` with its baseline starting at ``(x, y)``, advancing at ``angle`` degrees (counter-clockwise)."""
        cos, sin = math.cos(math.radians(angle)), math.sin(math.radians(angle))
        matrix = f"{cos:.6f} {sin:.6f} {-sin:.6f} {cos:.6f} {x:.4f} {y:.4f}"
        self._ops += f"BT /FR {size} Tf {matrix} Tm {rise} Ts (".encode("ascii") + _escape(text) + b") Tj ET\n"

    def text_in_file_order(
        self, glyphs: list[tuple[float, float, str]], *, size: float = 8.0, angle: float = 0.0
    ) -> None:
        """Characters placed one by one, in the order given: how some plots write a figure back to front."""
        for x, y, glyph in glyphs:
            self.text(x, y, glyph, size=size, angle=angle)

    def form(self, ops: str, matrix: tuple[float, float, float, float, float, float]) -> None:
        """A form XObject holding ``ops``, placed through ``matrix``: how a plot nests a block or a whole view."""
        self._forms.append(ops.encode("ascii"))
        placed = " ".join(f"{value:.6f}" for value in matrix)
        self.raw(f"q {placed} cm /X{len(self._forms) - 1} Do Q")

    def viewport(
        self,
        bbox: Box,
        *,
        units_per_point: float | None,
        unit: str = "m",
        subtype: str = "RL",
        ratio: str = "",
        name: str = "",
        y_units_per_point: float | None = None,
        cyx: float | None = None,
    ) -> None:
        """A ``/VP`` entry: a region of the page (user space) and the measure dictionary a plot stores for it."""

        def number_format(factor: float) -> str:
            return f"[<< /Type /NumberFormat /U ({unit}) /C {factor:.10f} /D 100 >>]"

        measure = f"/Type /Measure /Subtype /{subtype} /R ({ratio})"
        if units_per_point is not None:
            measure += f" /X {number_format(units_per_point)} /D {number_format(1.0)} /A {number_format(1.0)}"
        if y_units_per_point is not None:
            measure += f" /Y {number_format(y_units_per_point)}"
        if cyx is not None:
            measure += f" /CYX {cyx:.6f}"
        box = " ".join(f"{value:.4f}" for value in bbox)
        self._viewports.append(f"<< /Type /Viewport /BBox [{box}] /Name ({name}) /Measure << {measure} >> >>")

    def dictionary(self, parent: int, contents: int, forms: list[int]) -> bytes:
        xobjects = " ".join(f"/X{index} {number} 0 R" for index, number in enumerate(forms))
        entries = [f"/Type /Page /Parent {parent} 0 R", *([] if self.inherit_boxes else self.box_entries())]
        entries += [
            f"/Resources << /Font << /FR 3 0 R >> /XObject << {xobjects} >> >>",
            f"/Contents {contents} 0 R",
        ]
        if self.rotate:
            entries.append(f"/Rotate {self.rotate}")
        if self.user_unit is not None:
            entries.append(f"/UserUnit {self.user_unit}")
        if self._viewports:
            entries.append("/VP [" + " ".join(self._viewports) + "]")
        return ("<< " + " ".join(entries) + " >>").encode("ascii")

    def box_entries(self) -> list[str]:
        entries = ["/MediaBox [" + " ".join(f"{value:.4f}" for value in self.media_box) + "]"]
        if self.crop_box is not None:
            entries.append("/CropBox [" + " ".join(f"{value:.4f}" for value in self.crop_box) + "]")
        return entries

    def content(self) -> bytes:
        return bytes(self._ops)


def build_sheet_pdf(pages: list[SheetPage]) -> bytes:
    """The PDF holding ``pages`` in order, Helvetica as ``/FR``."""
    objects: list[bytes] = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    ]
    kids: list[int] = []
    for page in pages:
        forms: list[int] = []
        for ops in page._forms:
            head = f"<< /Type /XObject /Subtype /Form /BBox [-100000 -100000 100000 100000] /Length {len(ops)} >>"
            objects.append(head.encode() + b"\nstream\n" + ops + b"\nendstream")
            forms.append(len(objects))
        content = page.content()
        objects.append(b"<< /Length " + str(len(content)).encode() + b" >>\nstream\n" + content + b"\nendstream")
        objects.append(page.dictionary(parent=2, contents=len(objects), forms=forms))
        kids.append(len(objects))
    inherited = " ".join(entry for page in pages[:1] if page.inherit_boxes for entry in page.box_entries())
    listed = " ".join(f"{kid} 0 R" for kid in kids)
    objects[1] = f"<< /Type /Pages /Kids [{listed}] /Count {len(kids)} {inherited} >>".encode()
    return _xref_pdf(objects)


def dimension(
    page: SheetPage,
    start: tuple[float, float],
    end: tuple[float, float],
    label: str,
    *,
    size: float = 7.0,
    raised: str = "",
) -> None:
    """A dimension between two user-space points: the line, a tick at each end, and the figure above its middle.

    The ticks are short strokes at 45 degrees to the line, the common
    architectural terminator; the figure reads along the line. ``raised`` is
    printed after the label, smaller and above the baseline: the half
    centimetre of „2,38⁵“.
    """
    (x0, y0), (x1, y1) = start, end
    length = math.hypot(x1 - x0, y1 - y0)
    ux, uy = (x1 - x0) / length, (y1 - y0) / length
    nx, ny = -uy, ux
    page.line(x0, y0, x1, y1)
    for x, y in (start, end):
        tx, ty = (ux + nx) * 3.0 * math.sqrt(0.5), (uy + ny) * 3.0 * math.sqrt(0.5)
        page.line(x - tx, y - ty, x + tx, y + ty)
    label_width = 0.5 * size * len(label)
    angle = math.degrees(math.atan2(uy, ux))
    left = ((x0 + x1) / 2 - ux * label_width / 2 + nx * 2.0, (y0 + y1) / 2 - uy * label_width / 2 + ny * 2.0)
    page.text(*left, label, size=size, angle=angle)
    if raised:
        lift, along = 0.4 * size, helvetica_width(label, size)
        page.text(
            left[0] + ux * along + nx * lift, left[1] + uy * along + ny * lift, raised, size=0.6 * size, angle=angle
        )


#: Helvetica's advance widths, in thousandths of the font size, for what a dimension prints.
_HELVETICA = {",": 278, ".": 278, " ": 278, "+": 584, "-": 333, "/": 278, ":": 278}


def helvetica_width(text: str, size: float) -> float:
    """How far ``text`` advances in Helvetica at ``size``: digits are 556 thousandths, the rest as listed."""
    return sum(_HELVETICA.get(char, 556) for char in text) * size / 1000
