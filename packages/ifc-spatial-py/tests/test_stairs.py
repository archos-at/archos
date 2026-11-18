from __future__ import annotations

import json
import math
import os
import subprocess
import sys
from pathlib import Path
from typing import Any

import ifcopenshell
import numpy as np
import pytest
from ifc_spatial import stairs as st
from ifc_spatial.model import SpatialModel
from ifc_spatial.model import UnknownElementError
from ifc_spatial.model import WrongKindError

FIXTURES = Path(__file__).resolve().parent / "fixtures"
SAMPLE_HOUSE = FIXTURES / "Ifc4_SampleHouse.ifc"


def _gid(tag: str) -> str:
    return f"1Treppe{tag:0>15}"


STAIR_NORTH = _gid("SA")
FLIGHT_ONE = _gid("F1")
LANDING = _gid("P1")
FLIGHT_TWO = _gid("F2")
STAIR_TOWER = _gid("TU")
FLIGHT_LOWER = _gid("T1")
FLIGHT_UPPER = _gid("T3")
STAIR_SOUTH = _gid("SB")
STAIR_SURVEYED = _gid("SC")
STAIR_MUTE = _gid("SD")
STAIR_WEDGE = _gid("SE")
CEILING = _gid("D1")
CEILING_RAMP = _gid("D2")
RAMP_ENTRY = _gid("RA")
RAMP_ENTRY_FLIGHT = _gid("R1")
RAMP_GARAGE = _gid("RB")
RAMP_GARAGE_FLAT = _gid("R2")
RAMP_GARAGE_STEEP = _gid("R3")
WALL = _gid("W1")

RISER = 0.180
GOING = 0.270
PITCH = math.atan2(RISER, GOING)


def _build(path: Path) -> None:
    f = ifcopenshell.file(schema="IFC4")
    person = f.create_entity("IfcPerson", FamilyName="x")
    organisation = f.create_entity("IfcOrganization", Name="x")
    history = f.create_entity(
        "IfcOwnerHistory",
        f.create_entity("IfcPersonAndOrganization", person, organisation),
        f.create_entity("IfcApplication", organisation, "1", "x", "x"),
        ChangeAction="ADDED",
        CreationDate=0,
    )
    x_axis = f.create_entity("IfcDirection", (1.0, 0.0, 0.0))
    z_axis = f.create_entity("IfcDirection", (0.0, 0.0, 1.0))
    axes = f.create_entity("IfcAxis2Placement3D", f.create_entity("IfcCartesianPoint", (0.0, 0.0, 0.0)), z_axis, x_axis)
    radian = f.create_entity("IfcSIUnit", UnitType="PLANEANGLEUNIT", Name="RADIAN")
    degree = f.create_entity(
        "IfcConversionBasedUnit",
        Dimensions=f.create_entity("IfcDimensionalExponents", 0, 0, 0, 0, 0, 0, 0),
        UnitType="PLANEANGLEUNIT",
        Name="DEGREE",
        ConversionFactor=f.create_entity(
            "IfcMeasureWithUnit", f.create_entity("IfcPlaneAngleMeasure", math.pi / 180.0), radian
        ),
    )
    units = f.create_entity(
        "IfcUnitAssignment",
        (
            f.create_entity("IfcSIUnit", UnitType="LENGTHUNIT", Name="METRE"),
            f.create_entity("IfcSIUnit", UnitType="AREAUNIT", Name="SQUARE_METRE"),
            f.create_entity("IfcSIUnit", UnitType="VOLUMEUNIT", Name="CUBIC_METRE"),
            degree,
        ),
    )
    ctx = f.create_entity("IfcGeometricRepresentationContext", None, "Model", 3, 1e-5, axes, None)
    f.create_entity(
        "IfcProject",
        _gid("PR"),
        history,
        "Treppenhaus",
        RepresentationContexts=(ctx,),
        UnitsInContext=units,
    )
    placement = f.create_entity("IfcLocalPlacement", None, axes)

    def profile_body(name: str, points: list[tuple[float, float]], origin: tuple[float, float, float], width: float):
        polyline = f.create_entity(
            "IfcPolyline",
            [f.create_entity("IfcCartesianPoint", (float(a), float(b))) for a, b in [*points, points[0]]],
        )
        position = f.create_entity(
            "IfcAxis2Placement3D",
            f.create_entity("IfcCartesianPoint", (origin[0], origin[1] + width, origin[2])),
            f.create_entity("IfcDirection", (0.0, -1.0, 0.0)),
            x_axis,
        )
        solid = f.create_entity(
            "IfcExtrudedAreaSolid",
            f.create_entity("IfcArbitraryClosedProfileDef", "AREA", name, polyline),
            position,
            z_axis,
            float(width),
        )
        return f.create_entity(
            "IfcProductDefinitionShape",
            Representations=(f.create_entity("IfcShapeRepresentation", ctx, "Body", "SweptSolid", (solid,)),),
        )

    def sawtooth(risers: list[float], going: float) -> list[tuple[float, float]]:
        points = [(0.0, 0.0)]
        x = z = 0.0
        for riser in risers:
            z += riser
            points.append((x, z))
            x += going
            points.append((x, z))
        points.append((x, 0.0))
        return points

    def box(name: str, x0: float, x1: float, y0: float, y1: float, z0: float, z1: float):
        profile = f.create_entity(
            "IfcRectangleProfileDef",
            "AREA",
            name,
            f.create_entity(
                "IfcAxis2Placement2D", f.create_entity("IfcCartesianPoint", ((x0 + x1) / 2, (y0 + y1) / 2))
            ),
            x1 - x0,
            y1 - y0,
        )
        solid = f.create_entity(
            "IfcExtrudedAreaSolid",
            profile,
            f.create_entity(
                "IfcAxis2Placement3D", f.create_entity("IfcCartesianPoint", (0.0, 0.0, z0)), z_axis, x_axis
            ),
            z_axis,
            z1 - z0,
        )
        return f.create_entity(
            "IfcProductDefinitionShape",
            Representations=(f.create_entity("IfcShapeRepresentation", ctx, "Body", "SweptSolid", (solid,)),),
        )

    pset_index = 0

    def pset(element: Any, name: str, values: dict[str, tuple[str, float]]) -> None:
        nonlocal pset_index
        pset_index += 1
        properties = [
            f.create_entity("IfcPropertySingleValue", key, None, f.create_entity(measure, value), None)
            for key, (measure, value) in values.items()
        ]
        f.create_entity(
            "IfcRelDefinesByProperties",
            _gid(f"X{pset_index:03d}"),
            history,
            RelatedObjects=(element,),
            RelatingPropertyDefinition=f.create_entity(
                "IfcPropertySet", _gid(f"S{pset_index:03d}"), history, name, None, properties
            ),
        )

    def flight(gid: str, name: str, risers: list[float], going: float, width: float, origin, kind="IfcStairFlight"):
        return f.create_entity(
            kind,
            gid,
            history,
            name,
            ObjectPlacement=placement,
            Representation=profile_body(name, sawtooth(risers, going), origin, width),
            PredefinedType="STRAIGHT" if kind == "IfcStairFlight" else "STRAIGHT_RUN_STAIR",
        )

    one = flight(FLIGHT_ONE, "Lauf 1", [RISER] * 9, GOING, 1.2, (0.0, 0.0, 0.0))
    pset(
        one,
        "Pset_StairFlightCommon",
        {
            "NumberOfRiser": ("IfcInteger", 9),
            "RiserHeight": ("IfcPositiveLengthMeasure", 0.17),
            "TreadLength": ("IfcPositiveLengthMeasure", 0.27),
        },
    )
    landing = f.create_entity(
        "IfcSlab",
        LANDING,
        history,
        "Zwischenpodest",
        ObjectPlacement=placement,
        Representation=box("Podest", 2.43, 3.63, 0.0, 1.2, 1.44, 1.62),
        PredefinedType="LANDING",
    )
    two = flight(FLIGHT_TWO, "Lauf 2", [RISER] * 9, GOING, 1.2, (3.63, 0.0, 1.62))
    north = f.create_entity(
        "IfcStair", STAIR_NORTH, history, "Treppe Nord", ObjectPlacement=placement, PredefinedType="STRAIGHT_RUN_STAIR"
    )
    f.create_entity("IfcRelAggregates", _gid("AG1"), history, RelatingObject=north, RelatedObjects=(one, landing, two))
    pset(
        north,
        "Pset_StairCommon",
        {"NumberOfRiser": ("IfcInteger", 18), "TreadLength": ("IfcPositiveLengthMeasure", 0.27)},
    )

    f.create_entity(
        "IfcSlab",
        CEILING,
        history,
        "Geschossdecke über Lauf 1",
        ObjectPlacement=placement,
        Representation=box("Decke", -2.0, 1.2, -0.5, 1.7, 2.6, 2.9),
        PredefinedType="FLOOR",
    )

    south = flight(
        STAIR_SOUTH,
        "Treppe Süd",
        [0.16, 0.19, 0.17, 0.20, 0.18],
        0.29,
        1.1,
        (20.0, 0.0, 0.0),
        kind="IfcStair",
    )
    pset(
        south,
        "Pset_StairCommon",
        {
            "NumberOfRiser": ("IfcInteger", 5),
            "RiserHeight": ("IfcPositiveLengthMeasure", 0.18),
            "TreadLength": ("IfcPositiveLengthMeasure", 0.29),
        },
    )

    surveyed = f.create_entity("IfcStair", STAIR_SURVEYED, history, "Treppe Bestand", ObjectPlacement=placement)
    pset(
        surveyed,
        "Pset_StairCommon",
        {
            "NumberOfRiser": ("IfcInteger", 16),
            "RiserHeight": ("IfcPositiveLengthMeasure", 0.1875),
            "TreadLength": ("IfcPositiveLengthMeasure", 0.26),
        },
    )
    f.create_entity("IfcStair", STAIR_MUTE, history, "Treppe ohne Angaben", ObjectPlacement=placement)
    f.create_entity(
        "IfcStair",
        STAIR_WEDGE,
        history,
        "Treppe als Keil exportiert",
        ObjectPlacement=placement,
        Representation=profile_body(
            "Keil", [(0.0, 0.0), (2.43, 1.62), (2.43, 1.42), (0.0, -0.2)], (60.0, 0.0, 0.0), 1.2
        ),
    )

    def ramp_flight(gid: str, name: str, rise: float, run: float, width: float, origin):
        points = [(0.0, 0.0), (run, rise), (run, rise - 0.2), (0.0, -0.2)]
        return f.create_entity(
            "IfcRampFlight",
            gid,
            history,
            name,
            ObjectPlacement=placement,
            Representation=profile_body(name, points, origin, width),
            PredefinedType="STRAIGHT",
        )

    entry_flight = ramp_flight(RAMP_ENTRY_FLIGHT, "Rampenlauf Eingang", 0.3, 5.0, 1.5, (30.0, 0.0, 0.0))
    pset(
        entry_flight,
        "Pset_RampFlightCommon",
        {"Slope": ("IfcPlaneAngleMeasure", math.degrees(math.atan(0.06)))},
    )
    entry = f.create_entity(
        "IfcRamp", RAMP_ENTRY, history, "Rampe Eingang", ObjectPlacement=placement, PredefinedType="STRAIGHT_RUN_RAMP"
    )
    f.create_entity("IfcRelAggregates", _gid("AG2"), history, RelatingObject=entry, RelatedObjects=(entry_flight,))

    flat = ramp_flight(RAMP_GARAGE_FLAT, "Rampenlauf flach", 0.3, 5.0, 2.5, (40.0, 0.0, 0.0))
    steep = ramp_flight(RAMP_GARAGE_STEEP, "Rampenlauf steil", 0.3, 3.0, 2.5, (46.0, 0.0, 0.0))
    garage = f.create_entity("IfcRamp", RAMP_GARAGE, history, "Rampe Tiefgarage", ObjectPlacement=placement)
    f.create_entity("IfcRelAggregates", _gid("AG3"), history, RelatingObject=garage, RelatedObjects=(flat, steep))
    f.create_entity(
        "IfcSlab",
        CEILING_RAMP,
        history,
        "Decke über der Rampe",
        ObjectPlacement=placement,
        Representation=box("Rampendecke", 45.5, 48.0, -0.5, 3.0, 2.5, 2.8),
        PredefinedType="FLOOR",
    )

    lower = flight(FLIGHT_LOWER, "Lauf UG", [RISER] * 9, GOING, 1.2, (70.0, 0.0, 0.0))
    upper = flight(FLIGHT_UPPER, "Lauf OG", [RISER] * 9, GOING, 1.2, (70.0, 0.0, 2.9))
    tower = f.create_entity(
        "IfcStair", STAIR_TOWER, history, "Treppe Turm", ObjectPlacement=placement, PredefinedType="STRAIGHT_RUN_STAIR"
    )
    f.create_entity("IfcRelAggregates", _gid("AG4"), history, RelatingObject=tower, RelatedObjects=(lower, upper))

    f.create_entity(
        "IfcWall",
        WALL,
        history,
        "Wand",
        ObjectPlacement=placement,
        Representation=box("Wand", 50.0, 54.0, 0.0, 0.3, 0.0, 2.5),
    )
    f.write(str(path))


def test_the_fixtures_global_ids_are_the_same_on_every_run(tmp_path: Path) -> None:
    script = (
        "import json, sys\n"
        "from pathlib import Path\n"
        "sys.path.insert(0, sys.argv[1])\n"
        "import ifcopenshell\n"
        "from test_stairs import _build\n"
        "_build(Path(sys.argv[2]))\n"
        "f = ifcopenshell.open(sys.argv[2])\n"
        "print(json.dumps(sorted(e.GlobalId for e in f.by_type('IfcRoot'))))\n"
    )
    env = dict(os.environ, PYTHONPATH=str(Path(__file__).resolve().parents[1] / "src"))
    runs = []
    for seed in ("0", "12345"):
        out = tmp_path / f"seed-{seed}.ifc"
        result = subprocess.run(
            [sys.executable, "-c", script, str(Path(__file__).parent), str(out)],
            check=True,
            capture_output=True,
            text=True,
            env={**env, "PYTHONHASHSEED": seed},
        )
        runs.append(json.loads(result.stdout))

    assert runs[0] == runs[1]
    assert all(len(gid) == 22 for gid in runs[0])
    assert len(set(runs[0])) == len(runs[0]), "two entities share a GlobalId"


@pytest.fixture(scope="module")
def stairs(tmp_path_factory: pytest.TempPathFactory) -> SpatialModel:
    path = tmp_path_factory.mktemp("stairs") / "treppenhaus.ifc"
    _build(path)
    return SpatialModel(str(path))


@pytest.fixture(scope="module")
def house() -> SpatialModel:
    return SpatialModel(str(SAMPLE_HOUSE))


def test_the_sample_house_has_no_stair_at_all(house: SpatialModel) -> None:
    for kind in ("IfcStair", "IfcStairFlight", "IfcRamp", "IfcRampFlight"):
        assert house.file.by_type(kind) == [], kind


def test_a_regular_flight_is_measured_off_its_own_solid(stairs: SpatialModel) -> None:
    answer = st.stair_geometry(stairs, FLIGHT_ONE)
    assert answer.decidable
    assert answer.provenance == "computed"
    value = answer.value

    assert value["riserHeight"]["measured"] == pytest.approx(RISER, abs=1e-9)
    assert value["riserHeight"]["min"] == pytest.approx(RISER, abs=1e-9)
    assert value["riserHeight"]["max"] == pytest.approx(RISER, abs=1e-9)
    assert value["riserHeight"]["spread"] == pytest.approx(0.0, abs=1e-9)
    assert value["treadDepth"]["measured"] == pytest.approx(GOING, abs=1e-9)
    assert value["risers"]["measured"] == 9
    assert value["totalRise"] == pytest.approx(9 * RISER, abs=1e-9)
    assert value["totalGoing"] == pytest.approx(9 * GOING, abs=1e-9)


def test_the_usable_width_is_the_tread_surface_and_not_the_bounding_box(stairs: SpatialModel) -> None:
    value = st.stair_geometry(stairs, FLIGHT_ONE).value
    assert value["clearWidth"] == pytest.approx(1.2, abs=1e-9)
    caveat = st.stair_geometry(stairs, FLIGHT_ONE).caveat
    assert "Nutzbreite" in caveat and "Rohbaulichte" in caveat


def test_a_declared_riser_height_that_contradicts_the_body_is_a_finding(stairs: SpatialModel) -> None:
    answer = st.stair_geometry(stairs, FLIGHT_ONE)
    block = answer.value["riserHeight"]

    assert block["declared"] == pytest.approx(0.17, abs=1e-9)
    assert block["measured"] == pytest.approx(0.18, abs=1e-9)
    assert block["agreement"] == "disagree"
    assert block["value"] == pytest.approx(0.18, abs=1e-9)
    assert "widersprechen sich" in answer.caveat
    assert "Befund über den Export" in answer.caveat

    assert answer.value["treadDepth"]["agreement"] == "agree"


def test_unequal_risers_are_reported_even_when_their_mean_is_exactly_right(stairs: SpatialModel) -> None:
    answer = st.stair_geometry(stairs, STAIR_SOUTH)
    block = answer.value["riserHeight"]

    assert block["measured"] == pytest.approx(0.18, abs=1e-9)
    assert block["declared"] == pytest.approx(0.18, abs=1e-9)
    assert block["agreement"] == "agree"
    assert block["min"] == pytest.approx(0.16, abs=1e-9)
    assert block["max"] == pytest.approx(0.20, abs=1e-9)
    assert block["spread"] == pytest.approx(0.04, abs=1e-9)
    assert "nicht gleich hoch" in answer.caveat
    assert "0.160 m bis 0.200 m" in answer.caveat


def test_no_threshold_and_no_verdict_appears_anywhere_in_the_answer(stairs: SpatialModel) -> None:
    forbidden = ("erfüllt", "zulässig", "unzulässig", "Anforderung erfüllt", "compliant", "verstößt")
    for global_id in (FLIGHT_ONE, STAIR_SOUTH, STAIR_NORTH):
        answer = st.stair_geometry(stairs, global_id)
        text = (answer.caveat or "") + str(answer.value)
        for word in forbidden:
            assert word not in text, (global_id, word)


def test_an_assembly_pools_its_flights_and_still_lists_them_separately(stairs: SpatialModel) -> None:
    answer = st.stair_geometry(stairs, STAIR_NORTH)
    value = answer.value

    assert value["risers"]["measured"] == 18
    assert value["risers"]["declared"] == 18
    assert value["risers"]["agreement"] == "agree"
    assert value["riserHeight"]["mean"] == pytest.approx(RISER, abs=1e-9)
    assert value["totalRise"] == pytest.approx(18 * RISER, abs=1e-9)
    assert value["landings"] == 1

    assert [flight["globalId"] for flight in value["flights"]] == [FLIGHT_ONE, FLIGHT_TWO]
    assert all(flight["risers"] == 9 for flight in value["flights"])


def test_a_stair_with_a_schedule_and_no_body_answers_declared_and_says_so(stairs: SpatialModel) -> None:
    answer = st.stair_geometry(stairs, STAIR_SURVEYED)
    assert answer.decidable
    assert answer.provenance == "declared"
    assert answer.value["riserCount"] == 16
    assert answer.value["riserHeight"]["value"] == pytest.approx(0.1875, abs=1e-9)
    assert answer.value["totalRise"] == pytest.approx(3.0, abs=1e-9)
    assert "keinen auswertbaren Körper" in answer.caveat


def test_a_stair_with_neither_body_nor_schedule_is_undecidable_with_a_remedy(stairs: SpatialModel) -> None:
    answer = st.stair_geometry(stairs, STAIR_MUTE)
    assert answer.decidable is False
    assert answer.value is None
    assert "IfcStair" in answer.missing.what
    assert "exportieren" in answer.missing.remedy


def test_the_operator_refuses_a_wall_and_names_the_one_that_would_answer(stairs: SpatialModel) -> None:
    with pytest.raises(WrongKindError) as raised:
        st.stair_geometry(stairs, WALL)
    assert "stairGeometry() erwartet" in str(raised.value)
    assert "IfcWall" in str(raised.value)
    assert "rampSlope()" in str(raised.value)


def test_an_unknown_global_id_raises_and_is_never_an_undecidable(stairs: SpatialModel) -> None:
    for operator in (st.stair_geometry, st.ramp_slope, st.headroom, st.steps_of):
        with pytest.raises(UnknownElementError):
            operator(stairs, "0erfundene0000000000id")


def test_a_six_percent_ramp_is_six_percent_and_one_to_sixteen_seven(stairs: SpatialModel) -> None:
    answer = st.ramp_slope(stairs, RAMP_ENTRY)
    assert answer.decidable
    value = answer.value

    assert value["slopePercent"] == pytest.approx(6.0, abs=1e-6)
    assert value["slopeRatio"] == pytest.approx(1 / 0.06, abs=1e-4)
    assert value["slopeRatioText"] == "1:16.7"
    assert value["slopeDegrees"] == pytest.approx(3.4336, abs=1e-3)
    assert value["rise"] == pytest.approx(0.3, abs=1e-6)
    assert value["run"] == pytest.approx(5.0, abs=1e-6)
    assert value["clearWidth"] == pytest.approx(1.5, abs=1e-6)
    assert value["definition"] == "slopePercent = Höhenunterschied / Grundrisslänge × 100"
    assert value["rise"] / value["run"] * 100 == pytest.approx(value["slopePercent"], abs=1e-9)


def test_a_declared_slope_in_degrees_is_read_through_the_files_angle_unit(stairs: SpatialModel) -> None:
    answer = st.ramp_slope(stairs, RAMP_ENTRY)
    assert answer.value["declaredSlopePercent"] == pytest.approx(6.0, abs=1e-4)
    assert answer.value["agreement"] == "agree"


def test_a_ramp_with_two_flights_reports_the_steepest_and_lists_both(stairs: SpatialModel) -> None:
    answer = st.ramp_slope(stairs, RAMP_GARAGE)
    assert answer.value["slopePercent"] == pytest.approx(10.0, abs=1e-6)
    assert len(answer.value["flights"]) == 2
    assert sorted(round(f["slopePercent"], 6) for f in answer.value["flights"]) == [6.0, 10.0]
    assert "steilste" in answer.caveat


def test_one_ramp_flight_can_be_asked_about_on_its_own(stairs: SpatialModel) -> None:
    answer = st.ramp_slope(stairs, RAMP_GARAGE_FLAT)
    assert answer.value["slopePercent"] == pytest.approx(6.0, abs=1e-6)
    assert answer.value["clearWidth"] == pytest.approx(2.5, abs=1e-6)


def test_ramp_slope_refuses_a_stair(stairs: SpatialModel) -> None:
    with pytest.raises(WrongKindError) as raised:
        st.ramp_slope(stairs, FLIGHT_ONE)
    assert "stairGeometry()" in str(raised.value)


def test_the_headroom_is_perpendicular_to_the_pitch_and_not_vertical(stairs: SpatialModel) -> None:
    expected = abs(1.2 * math.sin(PITCH) - (2.6 - RISER) * math.cos(PITCH))
    assert expected == pytest.approx(1.3479, abs=1e-3)

    answer = st.headroom(stairs, FLIGHT_ONE)
    assert answer.decidable
    assert answer.value["obstructed"] is True
    assert answer.value["headroom"] == pytest.approx(expected, abs=0.005)
    assert answer.value["vertical"] == pytest.approx(1.645, abs=0.02)
    assert answer.value["vertical"] - answer.value["headroom"] > 0.25
    assert answer.value["obstructedBy"] == CEILING
    assert "senkrecht zur Lauflinie" in answer.caveat
    assert "Geschossdecke" in answer.caveat


def test_the_exact_measurement_beats_its_own_ray_sampling(stairs: SpatialModel) -> None:
    value = st.headroom(stairs, FLIGHT_ONE).value
    flight = value["flights"][0]
    assert flight["sampledPerpendicular"] > flight["headroom"]
    assert flight["headroom"] == pytest.approx(value["headroom"], abs=1e-9)


def test_a_flight_with_nothing_above_it_says_so_instead_of_measuring_zero(stairs: SpatialModel) -> None:
    answer = st.headroom(stairs, FLIGHT_TWO)
    assert answer.decidable
    assert answer.value["obstructed"] is False
    assert answer.value["headroom"] is None
    assert answer.value["searchedTo"] == st.HEADROOM_REACH
    assert "kein Bauteil" in answer.caveat


def test_headroom_over_a_ramp_is_measured_from_its_running_surface(stairs: SpatialModel) -> None:
    answer = st.headroom(stairs, RAMP_ENTRY_FLIGHT)
    assert answer.decidable
    assert answer.value["obstructed"] is False

    pitch = math.atan(0.1)
    expected = abs(2.0 * math.sin(pitch) - 2.5 * math.cos(pitch))
    assert expected == pytest.approx(2.2886, abs=1e-3)

    steep = st.headroom(stairs, RAMP_GARAGE_STEEP)
    assert steep.value["headroom"] == pytest.approx(expected, abs=0.005)
    assert steep.value["vertical"] == pytest.approx(2.3, abs=0.02)
    assert steep.value["obstructedBy"] == CEILING_RAMP


def test_an_assembly_reports_the_tightest_of_its_flights(stairs: SpatialModel) -> None:
    answer = st.headroom(stairs, STAIR_NORTH)
    assert answer.value["headroom"] == pytest.approx(st.headroom(stairs, FLIGHT_ONE).value["headroom"], abs=1e-9)
    assert len(answer.value["flights"]) == 2


def test_the_flight_above_belongs_to_the_same_stair_and_still_counts(stairs: SpatialModel) -> None:
    alone = st.headroom(stairs, FLIGHT_LOWER)
    assembly = st.headroom(stairs, STAIR_TOWER)

    assert alone.value["headroom"] == pytest.approx(2.9 - 9 * RISER, abs=1e-6)
    assert alone.value["headroom"] == pytest.approx(1.28, abs=1e-6)
    assert alone.value["obstructedBy"] == FLIGHT_UPPER

    assert assembly.value["obstructed"] is True
    assert assembly.value["headroom"] == pytest.approx(alone.value["headroom"], abs=1e-9)
    assert assembly.value["obstructedBy"] == FLIGHT_UPPER
    assert "kein Bauteil" not in (assembly.caveat or "")

    lower = next(f for f in assembly.value["flights"] if f["globalId"] == FLIGHT_LOWER)
    assert lower["sampledPerpendicular"] == pytest.approx(1.5384, abs=1e-3)
    assert lower["sampledPerpendicular"] > lower["headroom"]

    upper = next(f for f in assembly.value["flights"] if f["globalId"] == FLIGHT_UPPER)
    assert upper["headroom"] is None


def test_headroom_refuses_a_wall(stairs: SpatialModel) -> None:
    with pytest.raises(WrongKindError) as raised:
        st.headroom(stairs, WALL)
    assert "clearHeight()" in str(raised.value)


def test_a_stair_reports_its_flights_and_the_landing_between_them(stairs: SpatialModel) -> None:
    answer = st.steps_of(stairs, STAIR_NORTH)
    assert answer.decidable
    assert answer.provenance == "declared"

    assert [ref.global_id for ref in answer.value["flights"]] == [FLIGHT_ONE, FLIGHT_TWO]
    assert [ref.global_id for ref in answer.value["landings"]] == [LANDING]
    assert answer.value["landings"][0].name == "Zwischenpodest"
    assert answer.value["risersPerFlight"][FLIGHT_ONE] == 9
    assert answer.value["risersPerFlight"][FLIGHT_TWO] is None
    assert "stairGeometry() zählt sie am Körper nach" in answer.caveat


def test_a_landing_is_recognised_by_its_predefined_type_and_not_by_its_name(stairs: SpatialModel) -> None:
    slab = stairs.file.by_guid(LANDING)
    original = slab.Name
    slab.Name = "Slab:Generic 200mm:314159"
    try:
        answer = st.steps_of(stairs, STAIR_NORTH)
        assert [ref.global_id for ref in answer.value["landings"]] == [LANDING]
    finally:
        slab.Name = original


def test_a_stair_without_parts_reports_the_export_and_not_the_building(stairs: SpatialModel) -> None:
    answer = st.steps_of(stairs, STAIR_SOUTH)
    assert answer.decidable is False
    assert answer.value is None
    assert "nicht in Läufe gegliedert" in answer.missing.what
    assert "heißt NICHT" in answer.missing.remedy
    assert "exportieren" in answer.missing.remedy
    assert "stairGeometry()" in answer.missing.remedy


def test_steps_of_on_a_flight_points_at_the_assembly_it_belongs_to(stairs: SpatialModel) -> None:
    with pytest.raises(WrongKindError) as raised:
        st.steps_of(stairs, FLIGHT_ONE)
    assert STAIR_NORTH in str(raised.value)


def test_a_ramp_decomposes_the_same_way_a_stair_does(stairs: SpatialModel) -> None:
    answer = st.steps_of(stairs, RAMP_GARAGE)
    assert [ref.global_id for ref in answer.value["flights"]] == [RAMP_GARAGE_FLAT, RAMP_GARAGE_STEEP]


def test_every_answer_carries_its_method_its_sources_and_serialises(stairs: SpatialModel) -> None:
    cases = [
        (st.stair_geometry, FLIGHT_ONE, "stairGeometry"),
        (st.ramp_slope, RAMP_ENTRY, "rampSlope"),
        (st.headroom, FLIGHT_ONE, "headroom"),
        (st.steps_of, STAIR_NORTH, "stepsOf"),
    ]
    for operator, global_id, name in cases:
        answer = operator(stairs, global_id)
        assert answer.method.startswith(f"{name}(")
        assert global_id in answer.from_
        wire = answer.to_dict()
        assert wire["decidable"] is True
        assert wire["provenance"] in ("declared", "computed", "inferred")
        assert "from" in wire and "value" not in wire.get("missing", {})


def test_measured_answers_carry_a_tolerance_and_declared_ones_do_not(stairs: SpatialModel) -> None:
    assert st.stair_geometry(stairs, FLIGHT_ONE).tolerance is not None
    assert st.stair_geometry(stairs, STAIR_SURVEYED).tolerance is None
    assert st.steps_of(stairs, STAIR_NORTH).tolerance is None


def test_a_body_with_no_horizontal_faces_is_a_finding_and_not_an_exception(stairs: SpatialModel) -> None:
    body = st._read_body(stairs, stairs.file.by_guid(RAMP_ENTRY_FLIGHT))
    assert body.flights == []
    assert body.levels == 0
    assert body.refusals == []

    answer = st.stair_geometry(stairs, STAIR_WEDGE)
    assert answer.decidable is False
    assert "keine waagrechten Trittflächen" in answer.missing.what
    assert "IfcStairFlight" in answer.missing.remedy


def test_the_nosing_line_is_the_front_edge_of_each_tread(stairs: SpatialModel) -> None:
    body = st._read_body(stairs, stairs.file.by_guid(FLIGHT_ONE))
    assert len(body.flights) == 1, "one flight's body holds one flight"
    nosings = np.asarray(body.flights[0].nosings)
    assert nosings.shape == (9, 3)
    assert nosings[0][0] == pytest.approx(0.0, abs=1e-9)
    assert nosings[0][2] == pytest.approx(RISER, abs=1e-9)
    assert nosings[-1][0] == pytest.approx(8 * GOING, abs=1e-9)
    assert nosings[-1][2] == pytest.approx(9 * RISER, abs=1e-9)


_MILLIMETRE_STAIR = """ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');
FILE_NAME('millimeter.ifc','2026-08-12T00:00:00',(''),(''),'','','');
FILE_SCHEMA(('IFC4'));
ENDSEC;
DATA;
#1=IFCPERSON($,'x',$,$,$,$,$,$);
#2=IFCORGANIZATION($,'x',$,$,$);
#3=IFCPERSONANDORGANIZATION(#1,#2,$);
#4=IFCAPPLICATION(#2,'1','x','x');
#5=IFCOWNERHISTORY(#3,#4,$,.ADDED.,$,$,$,0);
#6=IFCDIRECTION((1.,0.,0.));
#7=IFCDIRECTION((0.,0.,1.));
#8=IFCCARTESIANPOINT((0.,0.,0.));
#9=IFCAXIS2PLACEMENT3D(#8,#7,#6);
#10=IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.);
#11=IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.);
#12=IFCUNITASSIGNMENT((#10,#11));
#13=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,#9,$);
#14=IFCPROJECT('1Millimeter0000000000P',#5,'P',$,$,$,$,(#13),#12);
#20=IFCSTAIR('1Millimeter0000000000T',#5,'Treppe in Millimetern',$,$,$,$,$,$);
#21=IFCPROPERTYSINGLEVALUE('NumberOfRiser',$,IFCINTEGER(18),$);
#22=IFCPROPERTYSINGLEVALUE('RiserHeight',$,IFCPOSITIVELENGTHMEASURE(175.),$);
#23=IFCPROPERTYSINGLEVALUE('TreadLength',$,IFCPOSITIVELENGTHMEASURE(280.),$);
#24=IFCPROPERTYSET('1Millimeter0000000000S',#5,'Pset_StairCommon',$,(#21,#22,#23));
#25=IFCRELDEFINESBYPROPERTIES('1Millimeter0000000000R',#5,$,$,(#20),#24);
ENDSEC;
END-ISO-10303-21;
"""


def test_a_schedule_in_millimetres_is_read_in_metres_and_the_count_is_not(tmp_path: Path) -> None:
    path = tmp_path / "millimeter.ifc"
    path.write_text(_MILLIMETRE_STAIR)
    model = SpatialModel(str(path))

    answer = st.stair_geometry(model, "1Millimeter0000000000T")
    assert answer.provenance == "declared"
    assert answer.value["riserCount"] == 18
    assert answer.value["riserHeight"]["value"] == pytest.approx(0.175, abs=1e-9)
    assert answer.value["treadDepth"]["value"] == pytest.approx(0.28, abs=1e-9)
    assert answer.value["totalRise"] == pytest.approx(3.15, abs=1e-9)


def test_both_routes_produce_the_same_key_shape(stairs: SpatialModel) -> None:
    measured = st.stair_geometry(stairs, FLIGHT_ONE).value
    schedule = st.stair_geometry(stairs, STAIR_SURVEYED).value
    assert set(schedule) == set(measured)
    for key in ("risers", "riserHeight", "treadDepth"):
        assert set(schedule[key]) <= set(measured[key]), key
        assert {"value", "measured", "declared", "declaredAs", "agreement"} <= set(schedule[key]), key


class TestADoglegWrittenAsOneBodyIsThreeFlightsAndNotOne:
    FIXTURE = FIXTURES / "stair-three-flight.ifc"
    STAIR = "1Kl5_Wzb98HOSGZ8eaBX2f"
    RAILING = "01e2zHdgn5GRyyfNksJ$8a"
    SLAB = "2Og5$70yb1DxR1TY1w8bzN"

    RISER = 3.0 / 22.0
    GOING = 0.34834
    WIDTH = 1.5

    @pytest.fixture(scope="class")
    @classmethod
    def model(cls) -> SpatialModel:
        return SpatialModel(str(cls.FIXTURE))

    def test_the_file_says_nothing_about_the_flights(self, model: SpatialModel) -> None:
        stair = model.file.by_guid(self.STAIR)
        assert model.file.by_type("IfcStairFlight") == []
        assert list(stair.IsDecomposedBy or []) == []
        assert getattr(stair, "PredefinedType", None) in (None, "NOTDEFINED")
        assert model.declared_property(stair, ("NumberOfRiser",)) is None
        assert model.declared_quantity(stair, ("RiserHeight",)) is None

    def test_every_step_is_counted_once_and_not_twice(self, model: SpatialModel) -> None:
        geo = model.geometry(self.STAIR)
        assert len(st._tread_surfaces(geo)) == 46
        assert len(st._walking_surfaces(st._tread_surfaces(geo))) == 22

        value = st.stair_geometry(model, self.STAIR).value
        assert value["riserCount"] == 21
        assert value["riserHeight"]["measured"] == pytest.approx(self.RISER, abs=1e-4)
        assert value["riserHeight"]["spread"] == pytest.approx(0.0, abs=1e-6)

    def test_the_usable_width_is_the_flight_and_not_the_going(self, model: SpatialModel) -> None:
        value = st.stair_geometry(model, self.STAIR).value
        assert value["clearWidth"] == pytest.approx(self.WIDTH, abs=1e-3)
        assert value["clearWidth"] != pytest.approx(value["treadDepth"]["measured"], abs=0.05)
        assert all(flight["clearWidth"] == pytest.approx(self.WIDTH, abs=1e-3) for flight in value["flights"])

    def test_each_of_the_three_flights_is_measured_on_its_own_axis(self, model: SpatialModel) -> None:
        value = st.stair_geometry(model, self.STAIR).value
        assert len(value["flights"]) == 3
        assert [flight["risers"] for flight in value["flights"]] == [7, 7, 7]
        for flight in value["flights"]:
            assert flight["riserHeight"]["mean"] == pytest.approx(self.RISER, abs=1e-4)
            assert flight["treadDepth"]["mean"] == pytest.approx(self.GOING, abs=0.005)
            assert flight["fromBody"] is True
        assert value["totalRise"] == pytest.approx(3.0 - self.RISER, abs=1e-3)
        assert value["treadDepth"]["measured"] == pytest.approx(self.GOING, abs=0.005)

    def test_both_landings_are_found_although_the_file_declares_none(self, model: SpatialModel) -> None:
        value = st.stair_geometry(model, self.STAIR).value
        assert value["landings"] == 2
        assert value["measuredLandings"] == 2
        assert value["declaredLandings"] == 0
        assert [f["landingBelow"] for f in value["flights"]] == [False, True, True]
        assert [f["landingAbove"] for f in value["flights"]] == [True, True, False]

    def test_the_headroom_is_the_slab_the_stair_comes_up_through(self, model: SpatialModel) -> None:
        answer = st.headroom(model, self.STAIR)
        assert answer.decidable
        assert answer.value["headroom"] == pytest.approx(1.7455, abs=0.01)
        assert answer.value["obstructedBy"] == self.SLAB
        assert model.file.by_guid(answer.value["obstructedBy"]).is_a() == "IfcSlab"
        assert model.file.by_guid(self.RAILING).is_a() == "IfcRailing"
        assert self.RAILING not in [flight["obstructedBy"] for flight in answer.value["flights"]]

    def test_a_railing_is_not_excluded_by_type(self, model: SpatialModel) -> None:
        assert "IfcRailing" not in st.HEADROOM_TRANSPARENT

    def test_steps_of_refuses_rather_than_reporting_no_landings(self, model: SpatialModel) -> None:
        answer = st.steps_of(model, self.STAIR)
        assert answer.decidable is False
        assert answer.value is None
        assert "nicht in Läufe gegliedert" in answer.missing.what
        assert "stairGeometry()" in answer.missing.remedy


class TestAWinderIsRefusedRatherThanAveraged:
    FIXTURE = FIXTURES / "spiral-stair.ifc"
    STAIR = "38a9vdh9bF5Qg28GWyHhlr"

    @pytest.fixture(scope="class")
    @classmethod
    def model(cls) -> SpatialModel:
        return SpatialModel(str(cls.FIXTURE))

    def test_the_treads_are_there_to_be_read(self, model: SpatialModel) -> None:
        clusters = st._tread_surfaces(model.geometry(self.STAIR))
        assert len(clusters) == 16
        steps = [round(clusters[i + 1][0] - clusters[i][0], 4) for i in range(13)]
        assert steps == [pytest.approx(0.1767, abs=1e-3)] * 13

    def test_stair_geometry_refuses_and_says_by_how_much(self, model: SpatialModel) -> None:
        answer = st.stair_geometry(model, self.STAIR)
        assert answer.decidable is False
        assert answer.value is None
        assert "kein gerader Lauf" in answer.missing.what
        assert "nicht auf einer Geraden" in answer.missing.remedy
        assert "0.774 m" in answer.missing.remedy
        assert "gewendelter Lauf" in answer.missing.remedy
        assert "exportieren" in answer.missing.remedy

    def test_headroom_refuses_for_the_same_reason(self, model: SpatialModel) -> None:
        answer = st.headroom(model, self.STAIR)
        assert answer.decidable is False
        assert "keine gerade Lauflinie" in answer.missing.what
        assert "nicht auf einer Geraden" in answer.missing.remedy


def test_a_riser_no_leg_could_climb_is_refused_and_not_reported() -> None:

    def level(z: float, y: float) -> tuple:
        tris = np.array(
            [
                [[0.0, y, z], [1.2, y, z], [1.2, y + 0.3, z]],
                [[0.0, y, z], [1.2, y + 0.3, z], [0.0, y + 0.3, z]],
            ]
        )
        return (z, 0.36, np.array([0.6, y + 0.15, z]), tris.reshape(-1, 3))

    element = type("E", (), {"GlobalId": "1Treppe000000000000000"})()
    impossible = [level(0.065 * i, 0.3 * i) for i in range(1, 6)]
    flight, refusal = st._measure_run(element, impossible, base_z=0.0, landing_below=None, landing_above=None)
    assert flight is None
    assert refusal is not None and "0.065 m" in refusal
    assert "gibt es nicht" in refusal

    ordinary = [level(0.170 * i, 0.3 * i) for i in range(1, 6)]
    flight, refusal = st._measure_run(element, ordinary, base_z=0.0, landing_below=None, landing_above=None)
    assert refusal is None
    assert flight is not None
    assert flight.risers == pytest.approx([0.170] * 5, abs=1e-9)
    assert flight.clear_width == pytest.approx(1.2, abs=1e-9)


def test_one_tread_alone_is_a_blockstufe_and_one_between_two_turns_is_not() -> None:
    tris = np.array(
        [
            [[0.0, 0.0, 0.15], [1.2, 0.0, 0.15], [1.2, 0.3, 0.15]],
            [[0.0, 0.0, 0.15], [1.2, 0.3, 0.15], [0.0, 0.3, 0.15]],
        ]
    )
    step = (0.15, 0.36, np.array([0.6, 0.15, 0.15]), tris.reshape(-1, 3))
    element = type("E", (), {"GlobalId": "1Treppe000000000000000"})()

    flight, refusal = st._measure_run(element, [step], base_z=0.0, landing_below=None, landing_above=None, alone=True)
    assert refusal is None
    assert flight is not None
    assert flight.clear_width == pytest.approx(1.2, abs=1e-9)
    assert flight.risers == pytest.approx([0.15], abs=1e-9)

    flight, refusal = st._measure_run(element, [step], base_z=0.0, landing_below=None, landing_above=None, alone=False)
    assert flight is None
    assert refusal is not None and "gewendelten Stufe" in refusal
