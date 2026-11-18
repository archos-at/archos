from __future__ import annotations

import datetime as dt
import math
from pathlib import Path
from typing import Any

import numpy as np
import pytest
from ifc_spatial import daylight as dl
from ifc_spatial import daylight_sun as dls
from ifc_spatial import operators as op
from ifc_spatial.model import SpatialModel
from ifc_spatial.model import UnknownElementError
from ifc_spatial.model import WrongKindError

FIXTURES = Path(__file__).resolve().parent / "fixtures"
SAMPLE_HOUSE = FIXTURES / "Ifc4_SampleHouse.ifc"
NO_NORTH = FIXTURES / "house-with-rooms.ifc"
FEET = FIXTURES / "units-feet.ifc"

BEDROOM = "3w0zWKm7n8SB1qbfwUzt0J"
LIVING_ROOM = "3w0zWKm7n8SB1qbfwUzt0U"
ENTRANCE_HALL = "3w0zWKm7n8SB1qbfwUzt0G"
LOFT = "09J5N7xMHBfQZeQGAEMota"

NORTH_WALL = "3cUkl32yn9qRSPvBJVyWw5"
EAST_WALL = "3cUkl32yn9qRSPvBJVyWx4"
SOUTH_WALL = "3cUkl32yn9qRSPvBJVyWy4"
PARTITION = "3cUkl32yn9qRSPvBJVyWXt"
CURTAIN_WALL_PANE = "3cUkl32yn9qRSPvBJVyW_O"

BEDROOM_WINDOW = "3cUkl32yn9qRSPvBJVyWcE"
ROOF = "3cUkl32yn9qRSPvBJVyWh4"
GROUND_SLAB = "3cUkl32yn9qRSPvBJVyWgQ"

BEDROOM_FLOOR_AREA = 15.41678125
LIVING_ROOM_FLOOR_AREA = 51.994825
ENTRANCE_HALL_FLOOR_AREA = 8.69350625
CLEAR_HEIGHT = 2.2


@pytest.fixture(scope="module")
def model() -> SpatialModel:
    return SpatialModel(str(SAMPLE_HOUSE))


@pytest.fixture(scope="module")
def no_north() -> SpatialModel:
    return SpatialModel(str(NO_NORTH))


@pytest.fixture(scope="module")
def feet() -> SpatialModel:
    return SpatialModel(str(FEET))


def test_bedroom_depth_times_width_is_its_floor_area(model: SpatialModel) -> None:
    answer = dl.room_depth(model, BEDROOM)
    assert answer.decidable
    depth = answer.value["depth"]
    width = answer.value["width"]

    assert depth * width == pytest.approx(BEDROOM_FLOOR_AREA, abs=1e-6)
    assert answer.value["floorArea"] == pytest.approx(BEDROOM_FLOOR_AREA, abs=1e-4)
    assert depth == pytest.approx(3.4625, abs=op.DIMENSION_TOLERANCE)
    assert width == pytest.approx(4.4525, abs=op.DIMENSION_TOLERANCE)
    assert answer.provenance == "computed"
    assert answer.unit == "m"
    assert answer.tolerance == op.DIMENSION_TOLERANCE


def test_entrance_hall_depth_times_width_is_its_floor_area(model: SpatialModel) -> None:
    answer = dl.room_depth(model, ENTRANCE_HALL)
    assert answer.decidable
    assert answer.value["depth"] * answer.value["width"] == pytest.approx(ENTRANCE_HALL_FLOOR_AREA, abs=1e-6)
    assert answer.value["depth"] == pytest.approx(1.9525, abs=op.DIMENSION_TOLERANCE)
    assert answer.value["facade"]["globalId"] == SOUTH_WALL
    assert answer.value["facade"]["azimuth"]["compass"] == "S"


def test_the_chosen_facade_is_named_with_the_reason_and_the_ranking(model: SpatialModel) -> None:
    answer = dl.room_depth(model, BEDROOM)
    facade = answer.value["facade"]

    assert facade["globalId"] == NORTH_WALL
    assert facade["azimuth"] == {"degrees": 0.0, "compass": "N"}
    assert "2.1901 m²" in facade["why"]
    assert answer.method == f"roomDepth({BEDROOM}, facade={NORTH_WALL})"
    assert answer.from_[:3] == [BEDROOM, NORTH_WALL, BEDROOM_WINDOW]

    ranked = {c["globalId"]: c["apertureArea"] for c in answer.value["candidates"]}
    assert ranked == {NORTH_WALL: pytest.approx(2.1901, abs=1e-3), EAST_WALL: 0.0}


def test_the_corner_room_says_which_facade_it_did_not_choose(model: SpatialModel) -> None:
    answer = dl.room_depth(model, LIVING_ROOM)
    assert answer.value["facade"]["globalId"] == NORTH_WALL
    assert answer.value["depth"] == pytest.approx(5.655, abs=op.DIMENSION_TOLERANCE)

    ranked = {c["globalId"]: c["apertureArea"] for c in answer.value["candidates"]}
    assert ranked[NORTH_WALL] == pytest.approx(2 * 2.1901, abs=1e-3)
    assert ranked[SOUTH_WALL] == pytest.approx(2.1901, abs=1e-3)

    assert "Eckraum" in answer.caveat
    assert f"facade={SOUTH_WALL}" in answer.caveat


def test_an_explicit_facade_turns_the_measurement_ninety_degrees(model: SpatialModel) -> None:
    north = dl.room_depth(model, LIVING_ROOM, NORTH_WALL)
    west = dl.room_depth(model, LIVING_ROOM, CURTAIN_WALL_PANE)

    assert north.value["depth"] == pytest.approx(5.655, abs=op.DIMENSION_TOLERANCE)
    assert west.value["depth"] == pytest.approx(9.3075, abs=op.DIMENSION_TOLERANCE)
    assert west.value["width"] == pytest.approx(north.value["depth"], abs=1e-6)
    assert west.value["facade"]["azimuth"]["compass"] == "W"
    assert west.value["facade"]["why"] == "vom Aufrufer vorgegeben"
    assert "gehört nicht zu den außenliegenden Wänden" in west.caveat


def test_the_ratio_is_taken_against_the_clear_height_not_the_room_solid(model: SpatialModel) -> None:
    answer = dl.room_depth(model, BEDROOM)
    modelled_height = 2.5  # the IfcSpace solid's own Z extent

    assert answer.value["clearHeight"] == pytest.approx(CLEAR_HEIGHT, abs=op.DIMENSION_TOLERANCE)
    assert answer.value["depthToHeight"] == pytest.approx(3.4625 / CLEAR_HEIGHT, abs=1e-3)
    assert answer.value["depthToHeight"] != pytest.approx(3.4625 / modelled_height, abs=1e-3)
    assert "LICHTE Höhe" in answer.caveat


def test_the_living_room_is_not_a_rectangle_and_the_caveat_refuses_to_pretend(model: SpatialModel) -> None:
    answer = dl.room_depth(model, LIVING_ROOM)
    assert answer.value["depthTimesWidth"] == pytest.approx(52.6339, abs=1e-3)
    assert answer.value["floorArea"] == pytest.approx(LIVING_ROOM_FLOOR_AREA, abs=1e-4)
    assert "NICHT rechteckig" in answer.caveat

    assert "füllt das Rechteck" in dl.room_depth(model, BEDROOM).caveat


def test_the_curtain_wall_is_reported_rather_than_silently_dropped(model: SpatialModel) -> None:
    answer = dl.room_depth(model, LIVING_ROOM)
    assert "Vorhangfassade" in answer.caveat
    assert "IfcPlate/IfcMember" in answer.caveat


def test_depth_is_a_projection_and_a_bounding_box_would_be_wrong(model: SpatialModel) -> None:
    geo = model.geometry(BEDROOM)
    points = dl._footprint_points(geo.triangles)
    assert points is not None

    theta = math.radians(30.0)
    rotate = np.array([[math.cos(theta), -math.sin(theta)], [math.sin(theta), math.cos(theta)]])
    turned = points @ rotate.T
    facade_normal = rotate @ np.array([0.0, 1.0])

    projected = dl._extent_along(turned, facade_normal)
    axis_aligned = float(turned[:, 1].max() - turned[:, 1].min())

    assert projected == pytest.approx(3.4625, abs=1e-6)
    assert axis_aligned == pytest.approx(3.4625 * math.cos(theta) + 4.4525 * math.sin(theta), abs=1e-6)
    assert axis_aligned > projected * 1.5


def test_a_room_whose_external_walls_carry_no_aperture_is_undecidable(model: SpatialModel) -> None:
    answer = dl.room_depth(model, LOFT)
    assert not answer.decidable
    assert answer.provenance == "computed"
    assert answer.missing.what == "keine außenliegende Fensteröffnung an den Außenwänden dieses Raums"
    assert "Öffnungen und Füllungen" in answer.missing.remedy
    assert "roomDepth()" in answer.missing.remedy
    assert answer.missing.elements == [LOFT]


def test_room_depth_aimed_at_a_wall_says_which_operator_would_answer(model: SpatialModel) -> None:
    with pytest.raises(WrongKindError) as raised:
        dl.room_depth(model, NORTH_WALL)
    assert "roomDepth() erwartet einen Raum (IfcSpace)" in str(raised.value)
    assert "IfcWall" in str(raised.value)
    assert "extent()" in str(raised.value)


def test_a_hallucinated_id_raises_rather_than_answering(model: SpatialModel) -> None:
    with pytest.raises(UnknownElementError):
        dl.room_depth(model, "0000000000000000000000")
    with pytest.raises(UnknownElementError):
        dl.above(model, "0000000000000000000000")
    with pytest.raises(UnknownElementError):
        dl.below(model, "0000000000000000000000")


def test_a_space_the_kernel_cannot_build_is_reported_as_such(no_north: SpatialModel) -> None:
    space = no_north.file.by_type("IfcSpace")[0]
    answer = dl.room_depth(no_north, space.GlobalId)
    assert not answer.decidable
    assert "auswertbare Körpergeometrie" in answer.missing.what
    assert "Geometriekern" in answer.missing.what


def test_above_the_bedroom_is_the_roof_and_below_it_is_the_ground_slab(model: SpatialModel) -> None:
    over = dl.above(model, BEDROOM)
    under = dl.below(model, BEDROOM)

    assert [entry["globalId"] for entry in over.value] == [ROOF]
    assert over.value[0]["ifcType"] == "IfcRoof"
    assert over.value[0]["samples"] == 25
    assert over.value[0]["gap"] == pytest.approx(0.1743, abs=op.DIMENSION_TOLERANCE)
    assert over.value[0]["gapMax"] > over.value[0]["gap"] + 0.5

    assert [entry["globalId"] for entry in under.value] == [GROUND_SLAB]
    assert under.value[0]["gap"] == 0.0  # the room stands ON it
    assert over.unit == "m" and over.tolerance == op.DIMENSION_TOLERANCE


def test_furniture_is_never_what_is_above_a_floor(model: SpatialModel) -> None:
    answer = dl.above(model, GROUND_SLAB)
    types = {entry["ifcType"] for entry in answer.value}
    assert not types & {"IfcFurnishingElement", "IfcFurniture", "IfcSystemFurnitureElement"}
    assert answer.value[0]["globalId"] == ROOF
    assert answer.value[0]["gap"] == pytest.approx(1.9933, abs=op.DIMENSION_TOLERANCE)

    geo = model.geometry(GROUND_SLAB)
    low, high = geo.box
    nearest: dict[str, float] = {}
    for ix in range(5):
        for iy in range(5):
            x = float(low[0] + (high[0] - low[0]) * (ix + 0.5) / 5)
            y = float(low[1] + (high[1] - low[1]) * (iy + 0.5) / 5)
            for hit in model.tree.select_ray((x, y, float(high[2]) + 0.01), (0.0, 0.0, 1.0), length=20.0):
                element = model.file.by_id(hit.instance.id())
                if element.GlobalId == GROUND_SLAB:
                    continue
                nearest[element.is_a()] = min(nearest.get(element.is_a(), 9e9), float(hit.distance))
    assert nearest["IfcFurniture"] < 0.2
    assert nearest["IfcFurniture"] < nearest["IfcRoof"] / 10


def test_an_element_the_subject_touches_reports_zero_not_its_far_side(model: SpatialModel) -> None:
    under = dl.below(model, BEDROOM_WINDOW)
    by_id = {entry["globalId"]: entry for entry in under.value}

    assert by_id[NORTH_WALL]["gap"] == 0.0
    assert by_id[GROUND_SLAB]["gap"] == pytest.approx(0.9, abs=op.DIMENSION_TOLERANCE)
    assert "Berührung oder Durchdringung" in under.caveat


def test_nothing_above_the_roof_is_a_decidable_empty_answer(model: SpatialModel) -> None:
    answer = dl.above(model, ROOF)
    assert answer.decidable
    assert answer.value == []
    assert answer.provenance == "computed"
    assert answer.missing is None
    assert "Das ist ein Ergebnis, kein fehlender Wert." in answer.caveat

    assert dl.below(model, GROUND_SLAB).value == []


def test_hits_come_back_nearest_first(model: SpatialModel) -> None:
    answer = dl.below(model, ROOF)
    gaps = [entry["gap"] for entry in answer.value]
    assert gaps == sorted(gaps)
    assert len(answer.value) > 3
    assert answer.value[0]["gap"] == 0.0
    assert answer.value[-1]["globalId"] == GROUND_SLAB
    assert answer.value[-1]["samples"] >= 20


def test_the_overhead_caveat_states_the_lattice_and_the_exclusions(model: SpatialModel) -> None:
    caveat = dl.above(model, BEDROOM).caveat
    assert "geom.tree.select_ray" in caveat
    assert "25 von 25 Rasterpunkten" in caveat
    assert "IfcFurnishingElement" in caveat
    assert "keine Vollständigkeitsaussage" in caveat


def test_the_lattice_drops_points_that_are_over_the_box_but_not_the_element(model: SpatialModel) -> None:
    assert "24 von 25 Rasterpunkten" in dl.below(model, ROOF).caveat
    assert "25 von 25 Rasterpunkten" in dl.below(model, BEDROOM).caveat


def test_a_grid_that_tested_nothing_refuses_instead_of_answering_empty(model: SpatialModel) -> None:
    answer = dl.above(model, BEDROOM, samples=0)
    assert not answer.decidable
    assert answer.value is None
    assert answer.missing.what == "kein Rasterpunkt lag über bzw. unter diesem Bauteil"
    assert "samples" in answer.missing.remedy


SPA_REFERENCE = {
    "when": "2003-10-17T19:30:30Z",
    "latitude": 39.742476,
    "longitude": -105.1786,
    "azimuth": 194.34024,
    "altitude": 90.0 - 50.11162,
}

USNO_LONDON = [
    ("2026-06-21T12:00:00Z", 178.867641, 61.934279, 23.437851),
    ("2026-12-21T09:00:00Z", 139.648384, 5.464107, -23.436468),
    ("2026-03-20T15:00:00Z", 230.020747, 27.075004, 0.003984),
]

LONDON_LATITUDE = 51.5
LONDON_LONGITUDE = -0.1262


def test_matches_the_nrel_spa_published_reference_case() -> None:
    sun = dls._solar_azimuth_altitude(
        dt.datetime.fromisoformat(SPA_REFERENCE["when"].replace("Z", "+00:00")),
        SPA_REFERENCE["latitude"],
        SPA_REFERENCE["longitude"],
    )
    assert sun["azimuth"] == pytest.approx(SPA_REFERENCE["azimuth"], abs=dls.SOLAR_TOLERANCE_DEGREES)
    assert sun["altitude"] == pytest.approx(SPA_REFERENCE["altitude"], abs=0.03)
    assert sun["declination"] == pytest.approx(-9.31434, abs=dls.SOLAR_TOLERANCE_DEGREES)


@pytest.mark.parametrize(("when", "azimuth", "altitude", "declination"), USNO_LONDON)
def test_matches_the_usno_almanac_at_the_fixtures_own_site(
    when: str, azimuth: float, altitude: float, declination: float
) -> None:
    sun = dls._solar_azimuth_altitude(
        dt.datetime.fromisoformat(when.replace("Z", "+00:00")), LONDON_LATITUDE, LONDON_LONGITUDE
    )
    assert sun["azimuth"] == pytest.approx(azimuth, abs=dls.SOLAR_TOLERANCE_DEGREES)
    assert sun["altitude"] == pytest.approx(altitude, abs=dls.SOLAR_TOLERANCE_DEGREES)
    assert sun["declination"] == pytest.approx(declination, abs=dls.SOLAR_TOLERANCE_DEGREES)


@pytest.mark.parametrize(
    ("components", "expected"),
    [
        ((51, 30, 0, 549316), 51.500152588),
        ((0, -7, -34, -450321), -0.126236200),
        ((48, 12, 30), 48.208333333),
        ((-33, -52, -0), -33.866666667),
        ((0, 0, 0), 0.0),
    ],
)
def test_reads_an_ifc_compound_angle_with_its_sign(components: tuple[int, ...], expected: float) -> None:
    assert dls._compound_angle(components) == pytest.approx(expected, abs=1e-9)


def test_reads_the_site_coordinates_off_the_fixture(model: SpatialModel) -> None:
    site = dls._site_coordinates(model)
    assert site is not None
    latitude, longitude, site_id = site
    assert latitude == pytest.approx(51.500152588, abs=1e-9)
    assert longitude == pytest.approx(-0.126236200, abs=1e-9)
    assert model.file.by_guid(site_id).is_a() == "IfcSite"


def test_the_operator_agrees_with_the_almanac_end_to_end(model: SpatialModel) -> None:
    answer = dl.sun_position(model, "2026-06-21T12:00:00Z")
    assert answer.decidable
    assert answer.provenance == "computed"
    assert answer.unit == "°"
    assert answer.tolerance == dls.SOLAR_TOLERANCE_DEGREES
    assert answer.value["azimuth"] == pytest.approx(178.867641, abs=dls.SOLAR_TOLERANCE_DEGREES)
    assert answer.value["altitude"] == pytest.approx(61.934279, abs=dls.SOLAR_TOLERANCE_DEGREES)
    assert answer.value["compass"] == "S"
    assert answer.value["aboveHorizon"] is True
    assert answer.from_ == [dls._site_coordinates(model)[2]]


def test_the_model_direction_is_the_bearing_read_back(model: SpatialModel) -> None:
    answer = dl.sun_position(model, "2026-06-21T12:00:00Z")
    direction = np.array(answer.value["directionInModel"])
    assert float(np.linalg.norm(direction)) == pytest.approx(1.0, abs=1e-5)

    theta = model.true_north
    north = np.array([math.sin(theta), math.cos(theta)])
    east = np.array([north[1], -north[0]])
    bearing = math.degrees(math.atan2(float(direction[:2] @ east), float(direction[:2] @ north))) % 360.0
    assert bearing == pytest.approx(answer.value["azimuth"], abs=1e-3)
    assert math.degrees(math.asin(direction[2])) == pytest.approx(answer.value["altitude"], abs=1e-3)
    assert direction[1] < 0 and direction[2] > 0.8


def test_night_is_a_negative_altitude_and_says_so(model: SpatialModel) -> None:
    answer = dl.sun_position(model, "2026-12-21T23:00:00Z")
    assert answer.decidable
    assert answer.value["altitude"] < 0
    assert answer.value["aboveHorizon"] is False
    assert "UNTER dem Horizont" in answer.caveat


def test_a_model_without_a_coordinate_is_undecidable_in_german(no_north: SpatialModel) -> None:
    answer = dl.sun_position(no_north, "2026-06-21T12:00:00+02:00")
    assert not answer.decidable
    assert answer.value is None
    assert answer.missing.what == "IfcSite.RefLatitude / RefLongitude"
    assert "Standort des Projekts" in answer.missing.remedy
    assert "Revit" in answer.missing.remedy and "ArchiCAD" in answer.missing.remedy
    assert no_north.true_north is None


def test_an_ifc2x3_file_does_not_explode_on_the_map_conversion_lookup(feet: SpatialModel) -> None:
    answer = dl.sun_position(feet, "2026-06-21T12:00:00+02:00")
    assert not answer.decidable
    assert answer.missing.what == "IfcSite.RefLatitude / RefLongitude"
    assert dls._by_type(feet, "IfcMapConversion") == []


def test_a_timestamp_without_a_zone_is_refused(model: SpatialModel) -> None:
    answer = dl.sun_position(model, "2026-06-21T12:00:00")
    assert not answer.decidable
    assert "Zeitzone fehlt" in answer.missing.what
    assert "+02:00" in answer.missing.remedy

    unreadable = dl.sun_position(model, "irgendwann im Juni")
    assert not unreadable.decidable
    assert "kein lesbarer Zeitpunkt" in unreadable.missing.what


def test_an_offset_and_its_utc_equivalent_are_the_same_instant(model: SpatialModel) -> None:
    with_offset = dl.sun_position(model, "2026-06-21T14:00:00+02:00")
    as_utc = dl.sun_position(model, "2026-06-21T12:00:00Z")
    assert with_offset.value["azimuth"] == as_utc.value["azimuth"]
    assert with_offset.value["utc"] == as_utc.value["utc"] == "2026-06-21T12:00:00Z"


def test_caller_supplied_coordinates_are_allowed_and_loudly_flagged(no_north: SpatialModel) -> None:
    answer = dl.sun_position(no_north, "2026-06-21T12:00:00+02:00", latitude=48.2082, longitude=16.3738)
    assert answer.decidable
    assert answer.value["latitude"] == pytest.approx(48.2082)
    assert "stehen NICHT in der Datei" in answer.caveat
    assert answer.from_ == []
    assert answer.value["directionInModel"] is None
    assert answer.value["trueNorthDegrees"] is None
    assert "keine Nordrichtung" in answer.caveat

    half = dl.sun_position(no_north, "2026-06-21T12:00:00+02:00", latitude=48.2082)
    assert not half.decidable
    assert half.missing.what == "nur eine der beiden Koordinaten übergeben"


def test_outside_michalskys_span_the_tolerance_widens_and_says_why(model: SpatialModel) -> None:
    answer = dl.sun_position(model, "2101-06-21T12:00:00Z")
    assert answer.decidable
    assert answer.tolerance == dls.SOLAR_TOLERANCE_DEGREES_EXTRAPOLATED
    assert "1950–2050" in answer.caveat


def test_the_caveat_says_a_sun_position_is_not_a_besonnungsstudie(model: SpatialModel) -> None:
    caveat = dl.sun_position(model, "2026-06-21T12:00:00Z").caveat
    assert "KEINE Besonnungsstudie" in caveat
    assert "nicht, was beschattet ist" in caveat
    assert "Michalsky" in caveat
    assert "ohne Refraktion" in caveat


def test_no_operator_here_ever_delivers_a_verdict(model: SpatialModel) -> None:
    answers: list[Any] = [
        dl.room_depth(model, BEDROOM),
        dl.room_depth(model, LIVING_ROOM),
        dl.room_depth(model, LOFT),
        dl.above(model, BEDROOM),
        dl.below(model, BEDROOM_WINDOW),
        dl.sun_position(model, "2026-06-21T12:00:00Z"),
        dl.sun_position(model, "2026-06-21T12:00:00"),
    ]
    surface = " ".join(
        " ".join(
            str(piece)
            for piece in (
                answer.caveat,
                answer.method,
                answer.missing.what if answer.missing else "",
                answer.missing.remedy if answer.missing else "",
            )
            if piece
        )
        for answer in answers
    ).lower()

    for word in ("erfüllt", "nicht erfüllt", "compliant", "verstoß", "zulässig", "unzulässig", "grenzwert", "oib"):
        assert word not in surface, f"Befundvokabular in der Ausgabe: {word}"
    assert "besonnungsstudie" in surface  # …but the refusal to be one is in it
