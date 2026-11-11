"""What this package refuses to do with input it does not control.

Four of these are not questions about a building. They are questions about the
PROCESS the building is measured in, and each was reproduced against the code
before it was fixed. (A fifth, ``open_model(url=…)`` reading whatever a URL
named, went with the URL itself on 2026-11-04: the engine opens a path its host
fetched through the host's own access check.)

  - ``write_ids(name=…)`` joined ``name`` onto the target directory, so an
    absolute name replaced the directory and a ``..`` walked out of it;
  - ``render.plan`` derived the raster HEIGHT from the model's aspect ratio and
    allocated it. A 400 m × 2 m gallery is 365 megapixels at the default width,
    which is 1.41 GB and an OOM-killed worker rather than a refused request;
  - opening a model followed its length unit's conversion chain with no limit,
    so a chain leading back to itself never returned;
  - a file the parser dies on in C took the process with it, and with the process
    every conversation running there.

The first is a refusal and read as ``ToolError``: the call could not be
made. The last two are refusals about the file, a ``ModelUnreadableError``.
None of them is an ``undecidable`` — that is a finding about an export, and
"we will not connect there" is a finding about us.
"""

from __future__ import annotations

import os
import resource
import signal
import subprocess
import sys
from pathlib import Path
from typing import Any

import ifcopenshell
import pytest
from ifc_spatial import render
from ifc_spatial.model import SpatialModel
from ifc_spatial.project_units import MAX_UNIT_STEPS
from ifc_spatial.tools import ToolError

FIXTURES = Path(__file__).resolve().parent / "fixtures"
HOUSE = FIXTURES / "Ifc4_SampleHouse.ifc"


# ── [30] the size of a raster ───────────────────────────────────────────────


def _gallery(path: Path) -> SpatialModel:
    """A 400 m × 2 m covered walkway — two long walls and nothing else.

    Not a contrived shape. A noise barrier, a gallery, a tunnel section and a
    platform canopy all have this aspect ratio, and each of them is a perfectly
    ordinary IFC that an architect uploads. At the default 1400 px width it
    derives a height of 260 942 px: 365 megapixels, 1.41 GB of RGB, and the
    worker dies before the first line is drawn.
    """
    f = ifcopenshell.file(schema="IFC4")

    def gid(tag: str) -> str:
        """A readable 22-character GlobalId, as the other synthetic fixtures use."""
        return f"2Long{tag}".ljust(22, "0")[:22]

    z = f.create_entity("IfcDirection", DirectionRatios=(0.0, 0.0, 1.0))
    x = f.create_entity("IfcDirection", DirectionRatios=(1.0, 0.0, 0.0))
    axes = f.create_entity(
        "IfcAxis2Placement3D",
        Location=f.create_entity("IfcCartesianPoint", Coordinates=(0.0, 0.0, 0.0)),
        Axis=z,
        RefDirection=x,
    )
    context = f.create_entity(
        "IfcGeometricRepresentationContext",
        ContextType="Model",
        CoordinateSpaceDimension=3,
        Precision=1e-5,
        WorldCoordinateSystem=axes,
    )
    placement = f.create_entity("IfcLocalPlacement", RelativePlacement=axes)
    units = f.create_entity(
        "IfcUnitAssignment",
        Units=[
            f.create_entity("IfcSIUnit", UnitType="LENGTHUNIT", Name="METRE"),
            f.create_entity("IfcSIUnit", UnitType="AREAUNIT", Name="SQUARE_METRE"),
            f.create_entity("IfcSIUnit", UnitType="VOLUMEUNIT", Name="CUBIC_METRE"),
        ],
    )
    project = f.create_entity(
        "IfcProject",
        GlobalId=gid("Project"),
        Name="Laermschutzgalerie",
        RepresentationContexts=[context],
        UnitsInContext=units,
    )

    def wall(tag: str, name: str, box: tuple[float, float, float, float, float, float]) -> Any:
        x0, x1, y0, y1, z0, z1 = box
        profile = f.create_entity(
            "IfcRectangleProfileDef",
            ProfileType="AREA",
            ProfileName=name,
            Position=f.create_entity(
                "IfcAxis2Placement2D",
                Location=f.create_entity("IfcCartesianPoint", Coordinates=((x0 + x1) / 2, (y0 + y1) / 2)),
            ),
            XDim=x1 - x0,
            YDim=y1 - y0,
        )
        solid = f.create_entity(
            "IfcExtrudedAreaSolid",
            SweptArea=profile,
            Position=f.create_entity(
                "IfcAxis2Placement3D",
                Location=f.create_entity("IfcCartesianPoint", Coordinates=(0.0, 0.0, z0)),
                Axis=z,
                RefDirection=x,
            ),
            ExtrudedDirection=z,
            Depth=z1 - z0,
        )
        return f.create_entity(
            "IfcWall",
            GlobalId=gid(tag),
            Name=name,
            ObjectPlacement=placement,
            Representation=f.create_entity(
                "IfcProductDefinitionShape",
                Representations=[
                    f.create_entity(
                        "IfcShapeRepresentation",
                        ContextOfItems=context,
                        RepresentationIdentifier="Body",
                        RepresentationType="SweptSolid",
                        Items=[solid],
                    )
                ],
            ),
        )

    site = f.create_entity("IfcSite", GlobalId=gid("Site"), Name="Trasse", ObjectPlacement=placement)
    building = f.create_entity("IfcBuilding", GlobalId=gid("Build"), Name="Galerie", ObjectPlacement=placement)
    storey = f.create_entity(
        "IfcBuildingStorey", GlobalId=gid("Storey"), Name="Trassenebene", ObjectPlacement=placement, Elevation=0.0
    )
    f.create_entity("IfcRelAggregates", GlobalId=gid("Agg1"), RelatingObject=project, RelatedObjects=[site])
    f.create_entity("IfcRelAggregates", GlobalId=gid("Agg2"), RelatingObject=site, RelatedObjects=[building])
    f.create_entity("IfcRelAggregates", GlobalId=gid("Agg3"), RelatingObject=building, RelatedObjects=[storey])

    # 400 m long, 2 m apart: an aspect ratio of 1:200.
    west = wall("Wall01", "Galeriewand West", (0.0, 0.2, 0.0, 400.0, 0.0, 3.0))
    east = wall("Wall02", "Galeriewand Ost", (1.8, 2.0, 0.0, 400.0, 0.0, 3.0))
    f.create_entity(
        "IfcRelContainedInSpatialStructure",
        GlobalId=gid("Cont1"),
        RelatingStructure=storey,
        RelatedElements=[west, east],
    )
    f.write(str(path))
    return SpatialModel(str(path))


def test_a_long_thin_building_cannot_allocate_the_worker_away(tmp_path: Path) -> None:
    """The finding, end to end and through the public entry point.

    Before the bound this produced a 1400 × 260 942 px canvas. The assertion is
    on the pixel count rather than on either edge, because that is what the
    allocation is proportional to.
    """
    drawn = render.plan(_gallery(tmp_path / "galerie.ifc"))

    assert drawn is not None
    assert drawn.width * drawn.height <= render.MAX_RASTER_PIXELS
    # And it is still a drawing of a long thin thing, not a cropped square: the
    # bound moves the SCALE, so the aspect ratio survives it.
    assert drawn.height > drawn.width


def test_a_caller_cannot_ask_for_an_arbitrary_canvas(tmp_path: Path) -> None:
    """``tools.view`` never passes ``width_px``, so anything past the ceiling is
    a library caller — and 12 000 px on the sample house is 63 megapixels."""
    house = SpatialModel(str(HOUSE))
    drawn = render.plan(house, width_px=12_000)

    assert drawn is not None
    assert drawn.width <= render.MAX_RASTER_WIDTH
    assert drawn.width * drawn.height <= render.MAX_RASTER_PIXELS


@pytest.mark.parametrize(
    ("width", "margin", "span_x", "span_y"),
    [
        (1400, 48, 2.0, 400.0),
        (1400, 48, 0.5, 2_000.0),
        (100_000, 48, 14.16, 6.08),
        (8_000, 48, 1.0, 1_000.0),
        # A margin at or past half the width drove the scale to zero or below,
        # which is a divide-by-nothing rather than a small plan.
        (10, 900, 5.0, 5.0),
    ],
)
def test_no_span_and_no_request_gets_past_the_pixel_ceiling(
    width: int, margin: int, span_x: float, span_y: float
) -> None:
    fitted_width, fitted_height, fitted_margin, scale = render._fit_raster(width, margin, span_x, span_y)

    assert fitted_width * fitted_height <= render.MAX_RASTER_PIXELS
    assert fitted_width <= render.MAX_RASTER_WIDTH
    assert fitted_width > 2 * fitted_margin
    assert scale > 0


def test_an_ordinary_plan_is_untouched_by_the_bound() -> None:
    """The guard must be invisible on every model anyone actually draws.

    The sample house at the default width is 1.0 megapixels — 40× under the
    ceiling — and its numbers must not move, because `scale_px_per_m` is printed
    on the drawing's own scale bar.
    """
    house = SpatialModel(str(HOUSE))
    drawn = render.plan(house)

    assert drawn is not None
    assert drawn.width == 1400
    assert drawn.width * drawn.height < render.MAX_RASTER_PIXELS // 10


# ── [28] where an IDS file is written ───────────────────────────────────────


class _Empty:
    """A document with no specifications.

    Used deliberately: the empty list is the branch that returns EARLY, and a
    guard placed after it would be a guard an attacker can choose their way
    past by picking a model with no findings.
    """

    class ids:  # noqa: N801 — mirrors the attribute name on IdsShoppingList
        specifications: list[Any] = []

    exported: list[str] = []
    not_exportable: list[Any] = []

    def summary(self) -> str:
        return "Keine Befunde."


@pytest.mark.parametrize(
    "name",
    [
        "../../../etc/cron.d/ifc",
        "../nebenan.ids",
        "/etc/cron.d/ifc",
        "unterordner/haus.ids",
        "..\\..\\haus.ids",
        "..",
        ".",
        "",
        "haus\x00.ids",
    ],
)
def test_a_name_that_leaves_the_target_directory_is_refused(name: str, tmp_path: Path) -> None:
    from ifc_spatial.ids_export import write_ids

    before = sorted(p.name for p in tmp_path.iterdir())
    with pytest.raises(ToolError):
        write_ids(_Empty(), directory=str(tmp_path), name=name)
    assert sorted(p.name for p in tmp_path.iterdir()) == before


def test_a_nested_name_is_refused_and_not_silently_renamed(tmp_path: Path) -> None:
    """``os.path.basename`` is the obvious sanitiser and the wrong one.

    It turns ``"befunde/haus.ids"`` into ``"haus.ids"`` and writes a file the
    caller did not ask for. This module's whole promise is that the file an
    architect loads into their checker is exactly the document that was
    described, so a name it cannot honour is refused rather than reinterpreted.
    """
    from ifc_spatial.ids_export import write_ids

    with pytest.raises(ToolError):
        write_ids(_Empty(), directory=str(tmp_path), name="befunde/haus.ids")
    assert not (tmp_path / "haus.ids").exists()
    assert list(tmp_path.iterdir()) == []


def test_a_plain_file_name_is_still_accepted(tmp_path: Path) -> None:
    from ifc_spatial.ids_export import _checked_name

    assert _checked_name("fehlt-a1b2c3d4.ids") == "fehlt-a1b2c3d4.ids"
    assert _checked_name("Haus 42 — Befunde.ids") == "Haus 42 — Befunde.ids"


def test_a_real_document_still_lands_under_the_given_name(tmp_path: Path) -> None:
    from ifc_spatial.ids_export import blind_spots_as_ids
    from ifc_spatial.ids_export import write_ids

    document = blind_spots_as_ids(SpatialModel(str(HOUSE)))
    facts = write_ids(document, directory=str(tmp_path), name="haus.ids")

    assert facts["path"] == str(tmp_path / "haus.ids")
    assert (tmp_path / "haus.ids").is_file()


# ── a length unit with no end ─────────────────────────


UNITS_FEET = FIXTURES / "units-feet.ifc"
FOOT = "#10=IFCCONVERSIONBASEDUNIT(#7,.LENGTHUNIT.,'FOOT',#9);"
FOOT_FACTOR = "#9=IFCMEASUREWITHUNIT(IFCRATIOMEASURE(0.3048),#8);"
UNIT_LIST = "#13=IFCUNITASSIGNMENT((#10,#11,#12));"

_OPEN_AND_PRINT = """
import sys
from ifc_spatial.model import ModelUnreadableError, SpatialModel
try:
    print(repr(SpatialModel(sys.argv[1]).unit_scale))
except ModelUnreadableError as refused:
    print(refused.reason)
"""


def _foot_through(conversions: int) -> str:
    """The foot's factor, reaching the metre through ``conversions`` more units."""
    lines = ["#9=IFCMEASUREWITHUNIT(IFCRATIOMEASURE(0.3048),#100);"]
    for i in range(conversions):
        unit, factor, target = 100 + 2 * i, 101 + 2 * i, 102 + 2 * i if i + 1 < conversions else 8
        lines.append(f"#{unit}=IFCCONVERSIONBASEDUNIT(#7,.LENGTHUNIT.,'U',#{factor});")
        lines.append(f"#{factor}=IFCMEASUREWITHUNIT(IFCRATIOMEASURE(1.),#{target});")
    return "\n".join(lines)


def _open_units_in_a_child(tmp_path: Path, *swaps: tuple[str, str]) -> str:
    """A regression here never returns, so it has to fail this test and not hang the run."""
    text = UNITS_FEET.read_text()
    for old, new in swaps:
        assert old in text
        text = text.replace(old, new)
    path = tmp_path / "units.ifc"
    path.write_text(text)
    done = subprocess.run(
        [sys.executable, "-c", _OPEN_AND_PRINT, str(path)],
        capture_output=True,
        check=False,
        text=True,
        timeout=30,
        env={**os.environ, "PYTHONPATH": str(Path(__file__).resolve().parents[1] / "src")},
    )
    assert done.returncode == 0, done.stderr[-500:]
    return done.stdout.strip()


@pytest.mark.parametrize(
    "swaps",
    [
        pytest.param([(FOOT_FACTOR, FOOT_FACTOR.replace("#8)", "#10)"))], id="points-at-itself"),
        pytest.param(
            [
                (
                    FOOT_FACTOR,
                    "#9=IFCMEASUREWITHUNIT(IFCRATIOMEASURE(3.),#50);\n"
                    "#50=IFCCONVERSIONBASEDUNIT(#7,.LENGTHUNIT.,'YARD',#51);\n"
                    "#51=IFCMEASUREWITHUNIT(IFCRATIOMEASURE(0.3048),#10);",
                )
            ],
            id="two-units-point-at-each-other",
        ),
        pytest.param(
            [
                ("FILE_SCHEMA(('IFC2X3'))", "FILE_SCHEMA(('IFC4'))"),
                (FOOT_FACTOR, FOOT_FACTOR.replace("#8)", "#10)")),
                (
                    FOOT,
                    FOOT.replace("IFCCONVERSIONBASEDUNIT", "IFCCONVERSIONBASEDUNITWITHOFFSET").replace("#9)", "#9,0.)"),
                ),
            ],
            id="with-offset-points-at-itself",
        ),
        pytest.param([(FOOT_FACTOR, _foot_through(MAX_UNIT_STEPS - 1))], id="a-chain-past-the-limit"),
        pytest.param(
            [(UNIT_LIST, f"#13=IFCUNITASSIGNMENT(({'#10,' * (MAX_UNIT_STEPS // 2)}#10,#11,#12));")],
            id="a-list-of-short-chains-past-the-limit",
        ),
        pytest.param(
            [(UNIT_LIST, f"#13=IFCUNITASSIGNMENT(({'#8,' * (MAX_UNIT_STEPS - 1)}#10,#11,#12));")],
            id="a-list-of-plain-length-units-past-the-limit",
        ),
    ],
)
def test_a_length_unit_that_cannot_be_followed_is_refused_with_a_reason(tmp_path: Path, swaps) -> None:
    assert "Längeneinheit" in _open_units_in_a_child(tmp_path, *swaps)


@pytest.mark.parametrize(
    ("swaps", "scale"),
    [
        pytest.param([], 0.3048, id="foot"),
        pytest.param(
            [
                (
                    FOOT_FACTOR,
                    "#9=IFCMEASUREWITHUNIT(IFCRATIOMEASURE(3.),#50);\n"
                    "#50=IFCCONVERSIONBASEDUNIT(#7,.LENGTHUNIT.,'FOOT',#51);\n"
                    "#51=IFCMEASUREWITHUNIT(IFCRATIOMEASURE(0.3048),#8);",
                )
            ],
            0.9144000000000001,
            id="yard-via-foot",
        ),
        pytest.param([(FOOT_FACTOR, _foot_through(MAX_UNIT_STEPS - 2))], 0.3048, id="a-chain-at-the-limit"),
        pytest.param(
            [(UNIT_LIST, f"#13=IFCUNITASSIGNMENT(({'#8,' * (MAX_UNIT_STEPS - 2)}#10,#11,#12));")],
            0.3048,
            id="a-list-of-plain-length-units-at-the-limit",
        ),
        pytest.param(
            [
                (
                    UNIT_LIST,
                    "#60=IFCCONVERSIONBASEDUNIT(#7,.USERDEFINED.,'U',#9);\n"
                    f"#13=IFCUNITASSIGNMENT(({'#60,' * MAX_UNIT_STEPS}#60,#10,#11,#12));",
                )
            ],
            0.3048,
            id="a-long-list-of-units-the-scale-never-reads",
        ),
        pytest.param(
            [
                (
                    UNIT_LIST,
                    "#60=IFCMEASUREWITHUNIT(IFCRATIOMEASURE(1.),#61);\n"
                    "#61=IFCCONVERSIONBASEDUNIT(#7,.AREAUNIT.,'A',#60);\n"
                    "#13=IFCUNITASSIGNMENT((#10,#61,#12));",
                )
            ],
            0.3048,
            id="a-loop-on-a-unit-the-scale-never-reads",
        ),
    ],
)
def test_a_length_unit_that_can_be_followed_reports_the_same_scale(tmp_path: Path, swaps, scale: float) -> None:
    assert _open_units_in_a_child(tmp_path, *swaps) == repr(scale)


# ── a file the parser dies on ───────────────────────────────────────────────

_NAME = "FILE_NAME('h.ifc','2026-08-12T00:00:00',(''),(''),'','','');\n"
_SCHEMA = "FILE_SCHEMA(('IFC4'));\n"

#: In a child, because without the probe this is a SIGSEGV and the test run would die of it.
_OPEN_AND_PRINT_THE_REFUSAL = """
import sys
from ifc_spatial.model import ModelUnreadableError, SpatialModel
try:
    SpatialModel(sys.argv[1])
except ModelUnreadableError as refusal:
    print(refusal.reason)
except Exception:
    pass
"""

#: A host whose worker threads get 2 MiB, which is what glibc gives them when RLIMIT_STACK is unlimited.
_OPEN_ON_A_2_MIB_WORKER = """
import sys, threading
threading.stack_size(2 * 1024 * 1024)
from ifc_spatial.model import ModelUnreadableError, SpatialModel
def open_it():
    try:
        SpatialModel(sys.argv[1])
    except ModelUnreadableError as refusal:
        print(refusal.reason)
opener = threading.Thread(target=open_it)
opener.start()
opener.join()
"""

_MIB = 1024 * 1024


def _open_in_a_child(
    tmp_path: Path, header: str, data: str, script: str = _OPEN_AND_PRINT_THE_REFUSAL
) -> subprocess.CompletedProcess[str]:
    path = tmp_path / "broken.ifc"
    path.write_text(
        "ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION((''),'2;1');\n"
        f"{header}ENDSEC;\nDATA;\n{data}ENDSEC;\nEND-ISO-10303-21;\n"
    )
    return subprocess.run(
        [sys.executable, "-c", script, str(path)],
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )


def test_a_file_the_parser_dies_on_is_refused_and_the_process_lives(tmp_path: Path) -> None:
    child = _open_in_a_child(tmp_path, _NAME + "FILE_SCHEMA(('HEADER_SECTION_SCHEMA'));\n", "")
    assert child.returncode == 0, child.stderr[-500:]
    assert "neu exportieren" in child.stdout


# A SIGSEGV on macOS; whether Linux faults too is not established, so these hold
# only that the process lives.
@pytest.mark.parametrize(
    ("header", "data"),
    [
        pytest.param(_NAME + _SCHEMA, "#1=IFCWALL('x\n", id="string-open-to-the-end-in-data"),
        pytest.param("FILE_NAME('h.ifc\n", "", id="string-open-to-the-end-in-the-header"),
    ],
)
def test_a_string_left_open_does_not_take_the_process(tmp_path: Path, header: str, data: str) -> None:
    child = _open_in_a_child(tmp_path, header, data)
    assert child.returncode == 0, child.stderr[-500:]


def test_nesting_the_hosts_stack_cannot_hold_does_not_fit_the_probe_either(tmp_path: Path) -> None:
    from ifc_spatial.crash_probe import crashes_the_parser

    path = tmp_path / "nested.ifc"
    path.write_text(
        "ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION((''),'2;1');\n"
        f"{_NAME}{_SCHEMA}ENDSEC;\nDATA;\n"
        f"#1=IFCPROJECT({'(' * 40_000}{')' * 40_000});\n"
        "ENDSEC;\nEND-ISO-10303-21;\n"
    )
    assert crashes_the_parser(str(path)) is True


def test_nesting_a_host_on_small_worker_stacks_cannot_hold_is_refused(tmp_path: Path) -> None:
    child = _open_in_a_child(
        tmp_path, _NAME + _SCHEMA, f"#1=IFCPROJECT({'(' * 12_000}{')' * 12_000});\n", _OPEN_ON_A_2_MIB_WORKER
    )
    assert child.returncode == 0, child.stderr[-500:]
    assert "neu exportieren" in child.stdout


@pytest.mark.parametrize(
    ("limit", "threads", "probe"),
    [
        pytest.param(8 * _MIB, 0, 4 * _MIB, id="the-usual-8-mib"),
        pytest.param(resource.RLIM_INFINITY, 0, _MIB, id="unlimited-gives-glibc-threads-2-mib"),
        pytest.param(8 * _MIB, _MIB, _MIB // 2, id="host-threads-set-smaller"),
        pytest.param(8191 * 1024, 0, 4 * _MIB - 64 * 1024, id="a-limit-of-no-whole-pages"),
        pytest.param(100 * 1024, 0, 64 * 1024, id="a-limit-too-small-to-halve-keeps-a-floor"),
    ],
)
def test_the_probe_gets_half_the_smallest_stack_the_host_opens_on(
    monkeypatch: pytest.MonkeyPatch, limit: int, threads: int, probe: int
) -> None:
    from ifc_spatial import crash_probe

    seen: list[str] = []

    def run(command: list[str], **_kwargs: Any) -> subprocess.CompletedProcess[bytes]:
        seen.extend(command)
        return subprocess.CompletedProcess(args=[], returncode=0)

    monkeypatch.setattr(crash_probe.resource, "getrlimit", lambda _which: (limit, resource.RLIM_INFINITY))
    monkeypatch.setattr(crash_probe.threading, "stack_size", lambda: threads)
    monkeypatch.setattr(crash_probe.subprocess, "run", run)
    crash_probe.crashes_the_parser(str(HOUSE))
    assert int(seen[-1]) == probe


def test_the_child_that_reads_the_upload_gets_no_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    from ifc_spatial import crash_probe

    seen: dict[str, Any] = {}

    def run(*_args: Any, **kwargs: Any) -> subprocess.CompletedProcess[bytes]:
        seen.update(kwargs)
        return subprocess.CompletedProcess(args=[], returncode=0)

    monkeypatch.setattr(crash_probe.subprocess, "run", run)
    crash_probe.crashes_the_parser(str(HOUSE))
    assert seen["env"] == {}


@pytest.mark.parametrize(
    ("fixture", "schema"),
    [("Ifc4_SampleHouse.ifc", "IFC4"), ("units-feet.ifc", "IFC2X3")],
)
def test_a_valid_model_passes_the_probe_and_opens(fixture: str, schema: str) -> None:
    from ifc_spatial.crash_probe import crashes_the_parser

    assert crashes_the_parser(str(FIXTURES / fixture)) is False
    assert SpatialModel(str(FIXTURES / fixture)).file.schema == schema


@pytest.mark.parametrize(
    ("returncode", "crashed"),
    [
        (0, False),
        (1, False),
        (-signal.SIGKILL, False),
        (-signal.SIGTERM, False),
        (-signal.SIGSEGV, True),
        (-signal.SIGBUS, True),
        (-signal.SIGABRT, True),
    ],
)
def test_only_a_death_the_parser_caused_counts_as_a_crash(
    monkeypatch: pytest.MonkeyPatch, returncode: int, crashed: bool
) -> None:
    from ifc_spatial import crash_probe

    finished = subprocess.CompletedProcess(args=[], returncode=returncode)
    monkeypatch.setattr(crash_probe.subprocess, "run", lambda *_args, **_kwargs: finished)
    assert crash_probe.crashes_the_parser(str(HOUSE)) is crashed


def test_a_probe_that_cannot_start_leaves_the_file_to_the_real_open(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    from ifc_spatial.crash_probe import crashes_the_parser

    monkeypatch.setattr(sys, "executable", str(tmp_path / "no-such-python"))
    assert crashes_the_parser(str(HOUSE)) is False
