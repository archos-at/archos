"""A Katastralmappe as BEV writes it, in a few parcels: the fixture both DXF suites read (ADR-0152, ADR-0153).

The rendition tests (``apps/agent-host/tests/test_drawing_renditions.py``) draw
it; the site tests (``packages/agent/tests/drawings``) measure it. One builder,
so the page a person sees and the numbers the agent quotes are tested on the
same drawing.
"""

from __future__ import annotations

#: A point in Mödling, Lower Austria, in MGI / Austria GK East (EPSG 31256) with
#: the 5,000,000 of the northing dropped, as BEV writes it.
X0, Y0 = -3139.84, 327390.65


class R12Writer:
    """Group codes for a partial R12 file, the way BEV writes one: a minimal header, then entities only."""

    def __init__(self) -> None:
        self.codes = ["0", "SECTION", "2", "HEADER", "9", "$ACADVER", "1", "AC1009", "0", "ENDSEC"]
        self.codes += ["0", "SECTION", "2", "ENTITIES"]

    def polyline(self, layer: str, points: list[tuple[float, float]]) -> None:
        self.codes += ["0", "POLYLINE", "8", layer, "66", "1", "10", "0", "20", "0", "30", "0"]
        for dx, dy in points:
            self.codes += ["0", "VERTEX", "8", layer, "10", f"{X0 + dx:.2f}", "20", f"{Y0 + dy:.2f}", "30", "0"]
        self.codes += ["0", "SEQEND", "8", layer]

    def insert(self, layer: str, block: str, at: tuple[float, float], value: str, tag: str, **text: float) -> None:
        """An INSERT with one attribute, centred on its point as BEV's parcel numbers are (spec §8.3)."""
        x, y = X0 + at[0], Y0 + at[1]
        rotation = text.get("rotation", 0.0)
        self.codes += ["0", "INSERT", "8", layer, "66", "1", "2", block, "10", f"{x:.3f}", "20", f"{y:.3f}", "30", "0"]
        self.codes += [
            "50",
            f"{rotation:.3f}",
            "0",
            "ATTRIB",
            "8",
            layer,
            "10",
            f"{x:.3f}",
            "20",
            f"{y:.3f}",
            "30",
            "0",
        ]
        self.codes += ["40", f"{text.get('height', 2.0):.2f}", "1", value, "50", f"{rotation:.3f}", "7", "NORM"]
        self.codes += ["72", "1", "11", f"{x:.3f}", "21", f"{y:.3f}", "31", "0", "2", tag]
        self.codes += ["70", str(int(text.get("flags", 0))), "74", "2", "0", "SEQEND", "8", layer]

    def text(self, layer: str, at: tuple[float, float], value: str, height: float, rotation: float = 0.0) -> None:
        x, y = X0 + at[0], Y0 + at[1]
        self.codes += ["0", "TEXT", "8", layer, "10", f"{x:.3f}", "20", f"{y:.3f}", "30", "0", "40", f"{height:.2f}"]
        self.codes += ["1", value, "50", f"{rotation:.3f}", "72", "1", "11", f"{x:.3f}", "21", f"{y:.3f}", "31", "0"]
        self.codes += ["73", "2"]

    def bytes(self) -> bytes:
        return ("\n".join([*self.codes, "0", "ENDSEC", "0", "EOF"]) + "\n").encode("cp1252")


#: Parcel numbers of the fixture block, with where each sits and whether it is in the Grenzkataster.
PARCELS = [
    ("123/4", (10, 30), False),
    ("123/5", (27.5, 30), True),
    ("124", (45, 30), False),
    ("125/1", (65, 30), False),
    ("130", (12.5, -20), False),
    ("131/2", (37.5, -27), False),
    ("131/3", (62.5, -27), False),
    ("1288", (60, -5), False),
]


def bev_partial_dxf() -> bytes:
    """A block of a Katastralmappe shaped like BEV's "BEV-DXF+CSV" file, at 1:1000.

    Seven parcels on either side of a street parcel, a cadastral-community
    boundary on the east, houses, a land-use line and boundary points. The
    boundaries run node to node and are never closed (spec §3.2); the parcel
    numbers and point symbols are INSERTs of blocks the file does not define (§1);
    parcel numbers are centred on their point (§8.3) at the 1:1000 sheet's text
    height; the sheet marker names meridian strip 34 (§3.1).
    """
    dxf = R12Writer()
    north = [0, 20, 35, 55, 75]
    south = [0, 25, 50, 75]
    for x in north:
        dxf.polyline("KG" if x == 75 else "GG", [(x, 0), (x, 40)])
    for x in south:
        dxf.polyline("KG" if x == 75 else "GG", [(x, -10), (x, -45)])
    for a, b in zip(north, north[1:], strict=False):
        dxf.polyline("GG", [(a, 0), (b, 0)])
        dxf.polyline("GG", [(a, 40), (b, 40)])
    for a, b in zip(south, south[1:], strict=False):
        dxf.polyline("GG", [(a, -10), (b, -10)])
        dxf.polyline("GG", [(a, -45), (b, -45)])
    dxf.polyline("GG", [(0, 0), (0, -10)])
    dxf.polyline("KG", [(75, 0), (75, -10)])
    for x0, y0, w, h in [(4, 8, 11, 13), (23, 6, 9, 15), (40, 12, 10, 10), (58, 5, 12, 11), (5, -38, 14, 10)]:
        dxf.polyline("HG", [(x0, y0), (x0 + w, y0), (x0 + w, y0 + h), (x0, y0 + h), (x0, y0)])
    dxf.polyline("NG", [(35, 26), (55, 26)])
    for x in north:
        dxf.insert("GP", "FIG024", (x, 40), "", "16117*G**", height=2.5)
        dxf.insert("GP", "FIG020", (x, 0), "", "16117*E**", height=0.01)
    for number, at, boundary_cadastre in PARCELS:
        dxf.insert("GN", "GN1G" if boundary_cadastre else "GN1", at, number, "16117")
    dxf.insert("RL", "MBNR", (-60, -60), "7856F103", "1*34*12*345*1123", height=1.0, flags=1)
    dxf.text("SB", (30, -5), "Wiener Straße", 2.0)
    return dxf.bytes()
