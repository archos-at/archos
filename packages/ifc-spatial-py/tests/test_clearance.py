from __future__ import annotations

import math
from pathlib import Path

import numpy as np
import pytest
import shapely
from ifc_spatial import clearance as cl
from ifc_spatial import clearance_shapes
from ifc_spatial import clearance_triangles
from ifc_spatial import operators as op
from ifc_spatial.model import SpatialModel
from ifc_spatial.model import UnknownElementError
from ifc_spatial.model import WrongKindError

FIXTURES = Path(__file__).resolve().parent / "fixtures"
SAMPLE_HOUSE = FIXTURES / "Ifc4_SampleHouse.ifc"
NO_GEOMETRY = FIXTURES / "house-with-rooms.ifc"

WINDOW = "3cUkl32yn9qRSPvBJVyWcE"
EXTERNAL_DOOR = "3cUkl32yn9qRSPvBJVyWYp"
INTERNAL_DOOR = "3cUkl32yn9qRSPvBJVyWax"
INTERNAL_DOOR_OPENING = "3cUkl32yn9qRSPvAVVyWax"
BEDROOM = "3w0zWKm7n8SB1qbfwUzt0J"
LIVING_ROOM = "3w0zWKm7n8SB1qbfwUzt0U"
NORTH_WALL = "3cUkl32yn9qRSPvBJVyWw5"
PARTITION = "3cUkl32yn9qRSPvBJVyWY1"
ROOF = "3cUkl32yn9qRSPvBJVyWh4"
CHAIR = "3cUkl32yn9qRSPvBJVyY1R"
OTHER_CHAIR = "3cUkl32yn9qRSPvBJVyY48"

BODYLESS_WALL = "2Haus0Raeume00Wall0001"

_HAND_BUILT = """ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');
FILE_NAME('laibungen.ifc','2026-08-12T00:00:00',(''),(''),'','','');
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
#10=IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);
#11=IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.);
#12=IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.);
#13=IFCUNITASSIGNMENT((#10,#11,#12));
#14=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,#9,$);
#15=IFCPROJECT('0aaaaaaaaaaaaaaaaaaaa0',#5,'P',$,$,$,$,(#14),#13);
#20=IFCCARTESIANPOINT((0.15,0.));
#21=IFCAXIS2PLACEMENT2D(#20,$);
#22=IFCRECTANGLEPROFILEDEF(.AREA.,'links',#21,0.3,3.);
#23=IFCEXTRUDEDAREASOLID(#22,#9,#7,2.5);
#24=IFCSHAPEREPRESENTATION(#14,'Body','SweptSolid',(#23));
#25=IFCPRODUCTDEFINITIONSHAPE($,$,(#24));
#26=IFCLOCALPLACEMENT($,#9);
#27=IFCWALL('0aaaaaaaaaaaaaaaaaaaa1',#5,'Laibung links',$,$,#26,#25,$,$);
#30=IFCCARTESIANPOINT((1.45,0.));
#31=IFCAXIS2PLACEMENT2D(#30,$);
#32=IFCRECTANGLEPROFILEDEF(.AREA.,'rechts',#31,0.3,3.);
#33=IFCEXTRUDEDAREASOLID(#32,#9,#7,2.5);
#34=IFCSHAPEREPRESENTATION(#14,'Body','SweptSolid',(#33));
#35=IFCPRODUCTDEFINITIONSHAPE($,$,(#34));
#36=IFCWALL('0aaaaaaaaaaaaaaaaaaaa2',#5,'Laibung rechts',$,$,#26,#35,$,$);
#40=IFCCARTESIANPOINT((0.,0.));
#41=IFCAXIS2PLACEMENT2D(#40,$);
#42=IFCRECTANGLEPROFILEDEF(.AREA.,'schraeg',#41,4.,0.3);
#43=IFCDIRECTION((0.86602540378443865,0.5,0.));
#44=IFCCARTESIANPOINT((10.,10.,0.));
#45=IFCAXIS2PLACEMENT3D(#44,#7,#43);
#46=IFCEXTRUDEDAREASOLID(#42,#45,#7,2.5);
#47=IFCSHAPEREPRESENTATION(#14,'Body','SweptSolid',(#46));
#48=IFCPRODUCTDEFINITIONSHAPE($,$,(#47));
#49=IFCWALL('0aaaaaaaaaaaaaaaaaaaa3',#5,'Schraege Wand',$,$,#26,#48,$,$);
#50=IFCCARTESIANPOINT((0.,0.));
#51=IFCAXIS2PLACEMENT2D(#50,$);
#52=IFCRECTANGLEPROFILEDEF(.AREA.,'tuerblatt',#51,0.9,0.05);
#53=IFCCARTESIANPOINT((20.,20.,0.));
#54=IFCAXIS2PLACEMENT3D(#53,#7,#6);
#55=IFCEXTRUDEDAREASOLID(#52,#54,#7,2.);
#56=IFCSHAPEREPRESENTATION(#14,'Body','SweptSolid',(#55));
#57=IFCPRODUCTDEFINITIONSHAPE($,$,(#56));
#58=IFCDOOR('0aaaaaaaaaaaaaaaaaaaa4',#5,'Tuer ohne Oeffnung',$,$,#26,#57,$,$,$,$,$);
ENDSEC;
END-ISO-10303-21;
"""

LEFT_JAMB = "0aaaaaaaaaaaaaaaaaaaa1"
RIGHT_JAMB = "0aaaaaaaaaaaaaaaaaaaa2"
SKEWED_WALL = "0aaaaaaaaaaaaaaaaaaaa3"
UNCHAINED_DOOR = "0aaaaaaaaaaaaaaaaaaaa4"


@pytest.fixture(scope="module")
def house() -> SpatialModel:
    return SpatialModel(str(SAMPLE_HOUSE))


@pytest.fixture(scope="module")
def hand_built(tmp_path_factory: pytest.TempPathFactory) -> SpatialModel:
    path = tmp_path_factory.mktemp("clearance") / "laibungen.ifc"
    path.write_text(_HAND_BUILT)
    return SpatialModel(str(path))


def test_the_opening_between_two_walls_is_the_clear_width_not_the_axis_distance(
    hand_built: SpatialModel,
) -> None:
    answer = cl.clear_width(hand_built, LEFT_JAMB, RIGHT_JAMB)
    assert answer.decidable
    assert answer.value["distance"] == pytest.approx(1.0, abs=1e-9)

    axis_distance = op.distance(hand_built, LEFT_JAMB, RIGHT_JAMB, "horizontal")
    assert axis_distance.value == pytest.approx(1.3, abs=1e-9)
    assert axis_distance.value > answer.value["distance"]


def test_the_answer_carries_the_two_points_it_was_measured_between(hand_built: SpatialModel) -> None:
    value = cl.clear_width(hand_built, LEFT_JAMB, RIGHT_JAMB).value
    first = np.array(value["pointOnA"])
    second = np.array(value["pointOnB"])
    assert float(np.linalg.norm(first - second)) == pytest.approx(value["distance"], abs=1e-9)
    assert first[0] == pytest.approx(0.3, abs=1e-9)
    assert second[0] == pytest.approx(1.3, abs=1e-9)


def test_a_box_gap_of_zero_does_not_mean_the_solids_touch(house: SpatialModel) -> None:
    box = op.distance(house, ROOF, PARTITION, "min")
    assert box.value == pytest.approx(0.0, abs=1e-9)

    answer = cl.clear_width(house, ROOF, PARTITION)
    assert answer.value["distance"] == pytest.approx(0.9947, abs=0.001)
    assert answer.value["boxGap"] == pytest.approx(0.0, abs=1e-9)
    assert "unterschätzt" in answer.caveat


def test_solids_that_really_do_touch_measure_zero_and_say_which_kind_of_zero(house: SpatialModel) -> None:
    answer = cl.clear_width(house, WINDOW, NORTH_WALL)
    assert answer.value["distance"] == 0.0
    assert "berühren oder durchdringen" in answer.caveat
    assert "Hüllbox-Aussage" in answer.caveat


def test_the_partition_between_two_rooms_is_its_thickness(house: SpatialModel) -> None:
    answer = cl.clear_width(house, BEDROOM, LIVING_ROOM)
    assert answer.value["distance"] == pytest.approx(0.095, abs=0.001)
    assert op.distance(house, BEDROOM, LIVING_ROOM, "horizontal").value == pytest.approx(7.08, abs=0.01)
    assert "Luft" in answer.caveat and "IfcSpace" in answer.caveat


def test_the_measurement_is_never_smaller_than_the_box_gap(house: SpatialModel) -> None:
    pairs = [(ROOF, PARTITION), (CHAIR, OTHER_CHAIR), (CHAIR, NORTH_WALL), (BEDROOM, LIVING_ROOM)]
    for first, second in pairs:
        value = cl.clear_width(house, first, second).value
        assert value["distance"] >= value["boxGap"] - 1e-9, (first, second)


def test_asking_for_the_clearance_of_one_element_to_itself_is_refused(house: SpatialModel) -> None:
    answer = cl.clear_width(house, NORTH_WALL, NORTH_WALL)
    assert answer.decidable is False
    assert "zweimal dasselbe Bauteil" in answer.missing.what
    assert "clearOpeningWidth()" in answer.missing.remedy


def test_an_element_without_a_body_is_a_finding_and_not_an_exception() -> None:
    model = SpatialModel(str(NO_GEOMETRY))
    answer = cl.clear_width(model, BODYLESS_WALL, "2Haus0Raeume00Wall0002")
    assert answer.decidable is False
    assert answer.provenance == "computed"
    assert "Körpergeometrie für" in answer.missing.what
    assert not answer.missing.what.startswith("kein")


def test_an_unknown_global_id_raises_rather_than_answering(house: SpatialModel) -> None:
    with pytest.raises(UnknownElementError):
        cl.clear_width(house, NORTH_WALL, "3nOtAnIdInThisModel00")
    with pytest.raises(UnknownElementError):
        cl.clear_opening_width(house, "3nOtAnIdInThisModel00")
    with pytest.raises(UnknownElementError):
        cl.oriented_extent(house, "3nOtAnIdInThisModel00")


def test_a_mesh_too_fine_to_measure_is_refused_before_it_is_attempted(
    house: SpatialModel, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(cl, "CLEARANCE_MAX_TRIANGLE_PAIRS", 10)
    answer = cl.clear_width(house, CHAIR, OTHER_CHAIR)
    assert answer.decidable is False
    assert "3618 × 3618 Dreiecke" in answer.missing.what
    assert "gröberer Tessellierung" in answer.missing.remedy


def test_running_out_of_budget_refuses_instead_of_reporting_an_upper_bound(
    house: SpatialModel, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(cl, "CLEARANCE_BUDGET_SECONDS", 0.0)
    answer = cl.clear_width(house, CHAIR, OTHER_CHAIR)
    assert answer.decidable is False
    assert answer.value is None
    assert "abgebrochen" in answer.missing.what
    assert "OBERGRENZE" in answer.missing.remedy


def _sampled_pair_distance(first: np.ndarray, second: np.ndarray, steps: int = 40) -> float:
    weights = np.array(
        [(i / steps, j / steps, 1 - i / steps - j / steps) for i in range(steps + 1) for j in range(steps + 1 - i)]
    )
    left = weights @ first
    right = weights @ second
    return float(np.sqrt(((left[:, None, :] - right[None, :, :]) ** 2).sum(-1)).min())


def test_the_exact_pair_distance_agrees_with_dense_sampling() -> None:
    generator = np.random.default_rng(20260812)
    for _ in range(60):
        first = generator.normal(size=(3, 3))
        second = generator.normal(size=(3, 3)) + generator.normal(scale=1.5, size=3)
        measured = float(clearance_triangles._triangle_distances(first, second[None])[0][0])
        sampled = _sampled_pair_distance(first, second)
        assert measured <= sampled + 1e-9
        assert measured > sampled - 0.08


def test_crossing_triangles_are_zero_even_though_no_vertex_and_no_edge_meet() -> None:
    first = np.array([[-1.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 0.0, 1.0]])
    second = np.array([[0.0, -1.0, 0.2], [0.0, 1.0, 0.2], [0.0, 0.0, -1.0]])
    assert float(clearance_triangles._triangle_distances(first, second[None])[0][0]) == 0.0


def test_parallel_and_nested_and_skew_triangles_are_all_exact() -> None:
    flat = np.array([[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]])
    above = flat + np.array([0.0, 0.0, 0.25])
    assert float(clearance_triangles._triangle_distances(flat, above[None])[0][0]) == pytest.approx(0.25, abs=1e-12)

    large = np.array([[-5.0, -5.0, 0.0], [5.0, -5.0, 0.0], [0.0, 5.0, 0.0]])
    small = np.array([[-1.0, -1.0, 0.0], [1.0, -1.0, 0.0], [0.0, 1.0, 0.0]])
    assert float(clearance_triangles._triangle_distances(large, small[None])[0][0]) == 0.0

    lying = np.array([[0.0, 0.0, 0.0], [10.0, 0.0, 0.0], [5.0, 0.001, 0.0]])
    standing = np.array([[5.0, -5.0, 1.0], [5.0, 5.0, 1.0], [5.0, 0.0, 1.5]])
    assert float(clearance_triangles._triangle_distances(lying, standing[None])[0][0]) == pytest.approx(1.0, abs=1e-12)


def test_the_pruned_search_finds_what_the_unpruned_one_would(house: SpatialModel) -> None:
    left = clearance_triangles._usable_triangles(house.geometry(ROOF))
    right = clearance_triangles._usable_triangles(house.geometry(PARTITION))
    pruned = clearance_triangles._soup_distance(left, right, 60.0)[0]
    brute = min(float(clearance_triangles._triangle_distances(triangle, right)[0].min()) for triangle in left)
    assert pruned == pytest.approx(brute, abs=1e-12)


@pytest.mark.parametrize(
    ("global_id", "type_name", "width", "height"),
    [
        (INTERNAL_DOOR, "810x2110mm", 0.810, 2.110),
        (EXTERNAL_DOOR, "1810x2110mm", 1.810, 2.110),
        (WINDOW, "1810x1210mm", 1.810, 1.210),
    ],
)
def test_the_clear_opening_matches_the_type_name_to_the_millimetre(
    house: SpatialModel, global_id: str, type_name: str, width: float, height: float
) -> None:
    element = house.file.by_guid(global_id)
    assert element.ObjectType == type_name  # the oracle is in the file, not here

    answer = cl.clear_opening_width(house, global_id)
    assert answer.decidable and answer.unit == "m"
    assert answer.value["width"] == pytest.approx(width, abs=1e-6)
    assert answer.value["height"] == pytest.approx(height, abs=1e-6)
    assert answer.value["rectangularity"] == pytest.approx(1.0, abs=1e-6)
    assert answer.value["via"] == "IfcOpeningElement"


def test_the_window_is_followed_through_fills_voids_to_its_own_opening(house: SpatialModel) -> None:
    answer = cl.clear_opening_width(house, WINDOW)
    opening = house.file.by_guid(WINDOW).FillsVoids[0].RelatingOpeningElement
    assert answer.value["measuredOn"] == opening.GlobalId
    assert answer.from_ == [WINDOW, opening.GlobalId]


def test_the_opening_can_be_asked_directly_and_answers_the_same(house: SpatialModel) -> None:
    through_door = cl.clear_opening_width(house, INTERNAL_DOOR).value
    direct = cl.clear_opening_width(house, INTERNAL_DOOR_OPENING).value
    assert direct["width"] == pytest.approx(through_door["width"], abs=1e-12)
    assert direct["height"] == pytest.approx(through_door["height"], abs=1e-12)
    assert direct["measuredOn"] == INTERNAL_DOOR_OPENING


def test_the_projection_is_the_one_the_area_operator_already_uses(house: SpatialModel) -> None:
    for global_id in (WINDOW, EXTERNAL_DOOR, INTERNAL_DOOR):
        opening = house.file.by_guid(global_id).FillsVoids[0].RelatingOpeningElement
        polygon, _ = clearance_shapes._aperture_polygon(house, opening)
        assert polygon.area == pytest.approx(op._clear_opening_area(house, opening), abs=1e-12)


def test_the_element_body_is_wider_than_the_opening_it_sits_in(house: SpatialModel) -> None:
    measured = {}
    for global_id in (INTERNAL_DOOR, WINDOW, EXTERNAL_DOOR):
        element = house.file.by_guid(global_id)
        opening = element.FillsVoids[0].RelatingOpeningElement
        body, _ = clearance_shapes._aperture_polygon(house, element)
        hole, _ = clearance_shapes._aperture_polygon(house, opening)
        measured[global_id] = (body.bounds[2] - body.bounds[0], hole.bounds[2] - hole.bounds[0])

    assert measured[INTERNAL_DOOR][0] == pytest.approx(0.880, abs=1e-6)
    assert measured[INTERNAL_DOOR][1] == pytest.approx(0.810, abs=1e-6)
    for body_width, hole_width in measured.values():
        assert body_width > hole_width


def test_a_door_with_no_opening_chain_falls_back_and_calls_it_an_upper_bound(
    hand_built: SpatialModel,
) -> None:
    answer = cl.clear_opening_width(hand_built, UNCHAINED_DOOR)
    assert answer.decidable
    assert answer.value["width"] == pytest.approx(0.9, abs=1e-9)
    assert answer.value["height"] == pytest.approx(2.0, abs=1e-9)
    assert answer.value["via"].startswith("Bauteilkörper")
    assert answer.value["measuredOn"] == UNCHAINED_DOOR
    assert "OBERGRENZE" in answer.caveat
    assert "zu groß" in answer.caveat


def test_the_caveat_says_shell_construction_and_never_says_met(house: SpatialModel) -> None:
    answers = [
        cl.clear_opening_width(house, INTERNAL_DOOR),
        cl.clear_width(house, BEDROOM, LIVING_ROOM),
        cl.oriented_extent(house, NORTH_WALL),
    ]
    for answer in answers:
        assert answer.provenance == "computed"
        assert answer.caveat
        for verdict in ("erfüllt", "compliant", "zulässig", "Grenzwert von"):
            assert verdict not in answer.caveat
    opening = answers[0]
    assert "ROHBAULICHTE" in opening.caveat
    assert "DURCHGANGSBREITE" in opening.caveat


def test_clear_opening_width_aimed_at_a_wall_says_which_operator_wanted(house: SpatialModel) -> None:
    with pytest.raises(WrongKindError) as raised:
        cl.clear_opening_width(house, NORTH_WALL)
    assert "IfcWall" in str(raised.value)
    assert "hosts()" in str(raised.value)


def test_a_wall_skewed_thirty_degrees_is_measured_as_itself(hand_built: SpatialModel) -> None:
    answer = cl.oriented_extent(hand_built, SKEWED_WALL)
    assert answer.decidable
    value = answer.value
    assert value["length"] == pytest.approx(4.0, abs=1e-6)
    assert value["width"] == pytest.approx(0.3, abs=1e-6)
    assert value["height"] == pytest.approx(2.5, abs=1e-6)
    assert value["deviation"] == pytest.approx(30.0, abs=1e-6)
    assert value["axisAligned"] is False

    box = op.extent(hand_built, SKEWED_WALL).value
    assert box["width"] == pytest.approx(4 * math.cos(math.radians(30)) + 0.3 * math.sin(math.radians(30)), abs=1e-6)
    assert box["depth"] == pytest.approx(4 * math.sin(math.radians(30)) + 0.3 * math.cos(math.radians(30)), abs=1e-6)
    assert value["footprintArea"] == pytest.approx(1.2, abs=1e-6)
    assert value["axisAlignedFootprintArea"] == pytest.approx(8.1672, abs=1e-3)


def test_without_a_declared_north_the_shape_is_still_answered(hand_built: SpatialModel) -> None:
    assert hand_built.true_north is None
    answer = cl.oriented_extent(hand_built, SKEWED_WALL)
    assert answer.decidable
    assert answer.value["northKnown"] is False
    assert "TrueNorth" in answer.caveat
    assert "KEINE Himmelsrichtung" in answer.caveat


def test_an_axis_aligned_wall_says_that_extent_would_have_done(house: SpatialModel) -> None:
    answer = cl.oriented_extent(house, NORTH_WALL)
    assert answer.value["axisAligned"] is True
    assert answer.value["deviation"] < 1e-9
    box = op.extent(house, NORTH_WALL).value
    assert answer.value["length"] == pytest.approx(box["width"], abs=1e-9)
    assert answer.value["width"] == pytest.approx(box["depth"], abs=1e-9)
    assert "extent() liefert dieselben Zahlen" in answer.caveat


def test_every_wall_window_and_door_of_this_house_is_axis_aligned(house: SpatialModel) -> None:
    worst = 0.0
    for element in house.file.by_type("IfcProduct"):
        if not any(element.is_a(kind) for kind in ("IfcWall", "IfcWindow", "IfcDoor", "IfcSpace")):
            continue
        answer = cl.oriented_extent(house, element.GlobalId)
        if answer.decidable:
            worst = max(worst, answer.value["deviation"])
            assert answer.value["axisAligned"] is True
    assert worst < 1.2e-13


def test_the_skewed_chair_is_1116_by_973_and_not_1428_by_1400(house: SpatialModel) -> None:
    answer = cl.oriented_extent(house, CHAIR)
    value = answer.value
    assert value["length"] == pytest.approx(1.1163, abs=1e-3)
    assert value["width"] == pytest.approx(0.9731, abs=1e-3)
    assert value["deviation"] == pytest.approx(37.0, abs=0.05)
    assert value["axisAligned"] is False

    box = op.extent(house, CHAIR).value
    assert box["width"] == pytest.approx(1.4281, abs=1e-3)
    assert box["depth"] == pytest.approx(1.4004, abs=1e-3)
    inflation = value["axisAlignedFootprintArea"] / value["footprintArea"]
    assert inflation == pytest.approx(1.84, abs=0.01)

    other = cl.oriented_extent(house, OTHER_CHAIR).value
    assert other["length"] == pytest.approx(value["length"], abs=1e-6)
    assert other["width"] == pytest.approx(value["width"], abs=1e-6)
    assert other["deviation"] == pytest.approx(35.0, abs=0.05)


def test_the_minimum_area_rectangle_is_exact_on_a_hand_rotated_rectangle() -> None:
    angle = math.radians(30)
    rotation = np.array([[math.cos(angle), -math.sin(angle)], [math.sin(angle), math.cos(angle)]])
    corners = np.array([[0.0, 0.0], [2.0, 0.0], [2.0, 1.0], [0.0, 1.0]]) @ rotation.T

    length, width, axis = clearance_shapes._minimum_area_rectangle(corners)
    assert length == pytest.approx(2.0, abs=1e-12)
    assert width == pytest.approx(1.0, abs=1e-12)
    assert length * width == pytest.approx(2.0, abs=1e-12)
    bearing = math.degrees(math.atan2(axis[1], axis[0])) % 180.0
    assert bearing == pytest.approx(30.0, abs=1e-9)


def test_the_hand_rolled_calipers_agree_with_shapely(house: SpatialModel) -> None:
    assert hasattr(shapely, "minimum_rotated_rectangle")
    for global_id in (CHAIR, OTHER_CHAIR, NORTH_WALL, ROOF):
        points = house.geometry(global_id).verts[:, :2]
        length, width, _ = clearance_shapes._minimum_area_rectangle(points)
        reference = shapely.minimum_rotated_rectangle(shapely.MultiPoint([tuple(p) for p in points]))
        assert length * width == pytest.approx(reference.area, rel=1e-12)


def test_sampling_angles_instead_of_hull_edges_would_have_missed_it(house: SpatialModel) -> None:
    points = house.geometry(CHAIR).verts[:, :2]
    length, width, _ = clearance_shapes._minimum_area_rectangle(points)
    exact = length * width

    best = min(
        float(np.ptp(points @ np.array([math.cos(a), math.sin(a)])))
        * float(np.ptp(points @ np.array([-math.sin(a), math.cos(a)])))
        for a in np.radians(np.arange(0.0, 90.0, 5.0))
    )
    assert exact == pytest.approx(1.0862, abs=1e-3)
    assert best == pytest.approx(1.1481, abs=1e-3)
    assert best > exact


def test_a_footprint_with_no_area_has_no_oriented_box() -> None:
    line = np.array([[0.0, 0.0], [1.0, 1.0], [2.0, 2.0], [3.0, 3.0]])
    assert clearance_shapes._minimum_area_rectangle(line) is None


def test_the_answers_carry_the_envelope_the_rest_of_the_library_does(house: SpatialModel) -> None:
    for answer, method, sources in (
        (cl.clear_width(house, ROOF, PARTITION), f"clearWidth({ROOF}, {PARTITION})", [ROOF, PARTITION]),
        (cl.oriented_extent(house, CHAIR), f"orientedExtent({CHAIR})", [CHAIR]),
    ):
        assert answer.method == method  # the method reads back like the call
        assert answer.from_ == sources
        assert answer.unit == "m"
        assert answer.tolerance == op.DIMENSION_TOLERANCE
        assert answer.to_dict()["from"] == sources
