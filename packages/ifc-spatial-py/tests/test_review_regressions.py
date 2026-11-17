from __future__ import annotations

from pathlib import Path

import ifcopenshell
import ifcopenshell.util.shape as us
import numpy as np
import pytest
from ifc_spatial import accessibility as ac
from ifc_spatial import briefing as br
from ifc_spatial import daylight as dl
from ifc_spatial import envelope_geometry as eg
from ifc_spatial import fire
from ifc_spatial import operators as op
from ifc_spatial import relations as rel
from ifc_spatial.envelope import computed
from ifc_spatial.envelope import declared
from ifc_spatial.envelope import triangulate
from ifc_spatial.geometry import dominant_plane
from ifc_spatial.geometry import dominant_vertical_plane
from ifc_spatial.geometry import outermost_parallel_face
from ifc_spatial.model import SpatialModel
from ifc_spatial.model import WrongKindError
from ifc_spatial.model import _unit_scale_to_si
from ifc_spatial.tools import ToolError
from ifc_spatial.tools import call
from ifc_spatial.tools import create_tools

FIXTURES = Path(__file__).resolve().parent / "fixtures"
HOUSE = FIXTURES / "Ifc4_SampleHouse.ifc"
STACKED = FIXTURES / "floor-slab-and-window.ifc"
NO_BODIES = FIXTURES / "house-with-rooms.ifc"
FEET = FIXTURES / "units-feet.ifc"

LIVING = "3w0zWKm7n8SB1qbfwUzt0U"
BEDROOM = "3w0zWKm7n8SB1qbfwUzt0J"
HALL = "3w0zWKm7n8SB1qbfwUzt0G"
LOFT = "09J5N7xMHBfQZeQGAEMota"

NORTH_WALL = "3cUkl32yn9qRSPvBJVyWw5"
PARTITION = "3cUkl32yn9qRSPvBJVyWXt"
SOUTH_WALL = "3cUkl32yn9qRSPvBJVyWy4"
GROUND_SLAB = "3cUkl32yn9qRSPvBJVyWgQ"
SIMPLE_FLOOR = "3ntFzSulnDNeQ4nJrMgcOt"
CURTAIN_PANE = "3cUkl32yn9qRSPvBJVyW_5"
BEDROOM_WINDOW = "3cUkl32yn9qRSPvBJVyWcE"
INTERNAL_DOOR = "3cUkl32yn9qRSPvBJVyWaG"
BODYLESS_WALL = "3Fuss000000Wall000001"


@pytest.fixture(scope="module")
def house() -> SpatialModel:
    return SpatialModel(str(HOUSE))


@pytest.fixture(scope="module")
def tools() -> list:
    return create_tools()


@pytest.fixture(scope="module")
def handle(tools: list) -> str:
    return call(tools, "open_model", {"path": str(HOUSE)})["model"]


class TestAdjacencyIsNotStacking:
    def test_a_shared_floor_does_not_make_two_rooms_adjacent(self) -> None:
        model = SpatialModel(str(STACKED))
        answer = op.adjacent_spaces(model, "4Decke00000Space00001")
        names = {ref.name for ref in (answer.value or [])}
        assert "Kueche" in names, "a genuinely adjacent room was lost"
        assert "Bad" not in names, "rooms stacked across a slab came back as neighbours"

    def test_the_conclusion_is_never_declared_however_declared_its_inputs(self) -> None:
        model = SpatialModel(str(STACKED))
        answer = op.adjacent_spaces(model, "4Decke00000Space00001")
        assert answer.provenance == "computed"
        assert answer.caveat
        assert "NICHT begehbare Verbindung" in answer.caveat
        assert "deklariert" in answer.caveat

    def test_the_sample_house_still_finds_its_real_neighbours(self, house: SpatialModel) -> None:
        answer = op.adjacent_spaces(house, BEDROOM)
        assert {"Living room", "Entrance hall"} <= {r.name for r in (answer.value or [])}


class TestLightEntryAreaCountsEachOpeningOnce:
    def test_a_doubled_space_boundary_does_not_double_the_ratio(self, house: SpatialModel) -> None:
        answer = op.light_entry_area(house, BEDROOM)
        value = answer.value
        ids = [entry["globalId"] for entry in value["openings"]]
        assert len(ids) == len(set(ids)), "the same opening was counted twice"
        assert abs(value["percent"] - 14.21) < 0.05

    def test_an_opening_is_split_between_the_rooms_it_passes(self, house: SpatialModel) -> None:
        living = op.light_entry_area(house, LIVING).value
        loft = op.light_entry_area(house, LOFT).value

        assert living["percent"] < 72.0, "the living room still claims glass above its ceiling"
        assert loft["percent"] < 15.0, "the loft still claims the full-height facade"
        assert living["lightEntryArea"] > 25.0
        assert loft["lightEntryArea"] > 1.0


class TestTheDoorHeuristicOnlyJudgesDoors:
    class _Stub(SpatialModel):
        def __init__(self, file) -> None:
            self.file = file

        def declared_property(self, element, names):
            return None

    @staticmethod
    def _two_spaces(monkeypatch) -> None:
        monkeypatch.setattr(
            op,
            "opens_to",
            lambda model, gid: computed([object(), object()], from_=[gid], method="stub"),
        )

    def test_a_pane_touching_two_rooms_is_undetermined_not_interior(self, monkeypatch) -> None:
        model = ifcopenshell.file(schema="IFC4")
        plate = model.create_entity("IfcPlate", GlobalId=ifcopenshell.guid.new())
        self._two_spaces(monkeypatch)

        external, why = op._faces_outside(self._Stub(model), plate)
        assert external is None, "a glass pane was judged by a door rule"
        assert "Innentür" not in why
        assert "weder IsExternal" in why

    def test_a_door_touching_two_rooms_still_is_interior(self, monkeypatch) -> None:
        model = ifcopenshell.file(schema="IFC4")
        door = model.create_entity("IfcDoor", GlobalId=ifcopenshell.guid.new())
        self._two_spaces(monkeypatch)

        external, why = op._faces_outside(self._Stub(model), door)
        assert external is False
        assert "Innentür" in why

    def test_a_declared_is_external_still_outranks_everything(self, monkeypatch) -> None:
        model = ifcopenshell.file(schema="IFC4")
        plate = model.create_entity("IfcPlate", GlobalId=ifcopenshell.guid.new())
        self._two_spaces(monkeypatch)

        class _Declares(self._Stub):
            def declared_property(self, element, names):
                return True

        external, why = op._faces_outside(_Declares(model), plate)
        assert external is True
        assert "deklariert" in why


class TestAnSiPrefixOnAnAreaIsSquared:
    @pytest.mark.parametrize(
        ("prefix", "unit_type", "name", "expected"),
        [
            ("CENTI", "AREAUNIT", "SQUARE_METRE", 1e-4),
            ("MILLI", "AREAUNIT", "SQUARE_METRE", 1e-6),
            ("MILLI", "VOLUMEUNIT", "CUBIC_METRE", 1e-9),
            ("CENTI", "LENGTHUNIT", "METRE", 1e-2),
            ("MILLI", "LENGTHUNIT", "METRE", 1e-3),
            (None, "AREAUNIT", "SQUARE_METRE", 1.0),
        ],
    )
    def test_the_prefix_is_raised_to_the_units_dimension(self, prefix, unit_type, name, expected) -> None:
        model = ifcopenshell.file(schema="IFC4")
        unit = model.create_entity("IfcSIUnit", UnitType=unit_type, Prefix=prefix, Name=name)
        assert _unit_scale_to_si(unit) == pytest.approx(expected, rel=1e-12)


class TestACallerMistakeIsNotAFindingAboutTheExport:
    def test_asking_a_window_for_a_room_height_raises_instead_of_answering(self, house: SpatialModel) -> None:
        with pytest.raises(WrongKindError) as raised:
            op.clear_height(house, BEDROOM_WINDOW)
        message = str(raised.value)
        assert "Fehler im Aufruf" in message
        assert "an dieser Datei ist nichts zu ändern" in message
        assert "extent()" in message

    def test_no_operator_publishes_a_wrong_kind_as_an_undecidable(self, house: SpatialModel) -> None:
        from ifc_spatial.tools import MEASURE_FN
        from ifc_spatial.tools import RELATION_FN

        subjects = [BEDROOM, NORTH_WALL, CURTAIN_PANE]
        seen_refusals = 0
        for fn in (*MEASURE_FN.values(), *RELATION_FN.values()):
            for subject in subjects:
                try:
                    answer = fn(house, subject)
                except WrongKindError:
                    seen_refusals += 1
                    continue
                if answer.decidable:
                    continue
                assert "erwartet" not in (answer.missing.what if answer.missing else ""), (
                    f"{answer.method} published a wrong-kind refusal as a finding about the export"
                )
        assert seen_refusals > 0, "the sweep never hit a wrong kind — it is not testing anything"

    def test_the_tool_layer_turns_it_into_a_readable_refusal(self, tools: list, handle: str) -> None:
        with pytest.raises(ToolError) as raised:
            call(tools, "measure", {"model": handle, "globalId": CURTAIN_PANE, "measure": "clearWidth"})
        assert "IfcPlate" in str(raised.value)
        assert "Fehler im Aufruf" in str(raised.value)

    def test_the_element_menu_still_probes_without_blowing_up(self, tools: list, handle: str) -> None:
        out = call(tools, "element", {"model": handle, "globalId": BEDROOM})
        assert out["available"] == ["contains"]
        assert out["element"]["ifcType"] == "IfcSpace"


class TestTheNoGeometryRefusalIsNotDoublyNegated:
    def test_a_missing_body_reads_as_one_negation(self) -> None:
        model = SpatialModel(str(FEET))
        answer = op.extent(model, BODYLESS_WALL)
        assert not answer.decidable
        what = answer.missing.what
        assert not what.startswith("kein")
        assert what == "Körpergeometrie für IfcWall „Aussenwand“"
        assert f"dieser Export liefert {what} nicht." == (
            "dieser Export liefert Körpergeometrie für IfcWall „Aussenwand“ nicht."
        )

    def test_a_body_the_kernel_rejects_reads_the_same_way(self) -> None:
        model = SpatialModel(str(NO_BODIES))
        space = model.file.by_type("IfcSpace")[0]
        answer = op.extent(model, space.GlobalId)
        assert not answer.decidable
        assert not answer.missing.what.startswith("kein")
        assert "Geometriekern" in answer.missing.what


class TestTheBriefingDoesNotPromiseGeometryAFileHasNot:
    @pytest.mark.parametrize("fixture", [NO_BODIES, FEET, STACKED])
    def test_a_file_with_no_bodies_is_told_so(self, fixture: Path) -> None:
        model = SpatialModel(str(fixture))
        assert not [p for p in model.file.by_type("IfcProduct") if getattr(p, "Representation", None)]
        spots = br._geometry_blind_spots(model)
        assert len(spots) == 1
        assert "trägt Geometrie" not in spots[0].consequence
        assert "NICHT berechenbar" in spots[0].consequence
        assert "neu exportieren" in spots[0].remedy

    def test_a_file_that_does_carry_bodies_keeps_the_old_promise(self) -> None:
        model = SpatialModel(str(HOUSE))
        assert model.geometry_seconds == 0.0
        spots = br._geometry_blind_spots(model)
        assert len(spots) == 1
        assert "berechenbar" in spots[0].consequence
        assert "measure/distance aufrufen" in spots[0].remedy
        assert "Bauteil(e) in diesem Export tragen Geometrie" in spots[0].consequence

    def test_the_rendered_briefing_says_it_too(self) -> None:
        model = SpatialModel(str(NO_BODIES))
        text = br.render_briefing(model)
        assert "dieser Export trägt Geometrie" not in text


class TestStoreyHeightsAreDeclaredNotMeasured:
    def test_the_provenance_is_declared(self, house: SpatialModel) -> None:
        answer = br.storey_heights(house)
        assert answer.provenance == "declared"
        assert [entry["height"] for entry in answer.value] == [2.5, None]
        assert "deklarierten Höhenlagen" in answer.caveat

    def test_no_geometry_is_touched_on_the_way_there(self) -> None:
        model = SpatialModel(str(HOUSE))
        assert model.geometry_seconds == 0.0
        answer = br.storey_heights(model)
        assert answer.decidable
        assert model.geometry_seconds == 0.0

    def test_a_declared_value_carries_no_measurement_tolerance(self, house: SpatialModel) -> None:
        assert br.storey_heights(house).tolerance is None


class TestAgreementIsSaidOutLoud:
    def test_a_declared_area_that_agrees_is_not_reported_as_undeclared(self, house: SpatialModel) -> None:
        answer = op.floor_area(house, BEDROOM)
        assert answer.agreement == "agree"
        assert answer.value == pytest.approx(15.41678125, abs=1e-6)
        assert "DEKLARIERT" in answer.caveat
        assert "bestätigen diese Zahl" in answer.caveat
        assert "(declared)" in answer.caveat

    def test_two_computed_routes_do_not_claim_a_declaration(self) -> None:
        answer = triangulate(
            computed(10.0, unit="m²", tolerance=0.1, from_=["a"], method="a"),
            computed(10.05, unit="m²", tolerance=0.1, from_=["b"], method="b"),
        )
        assert answer.agreement == "agree"
        assert "DEKLARIERT" not in answer.caveat
        assert "Beide Wege führen zum selben Ergebnis" in answer.caveat

    def test_the_winning_answers_own_caveat_survives(self) -> None:
        measured = computed(
            10.0, unit="m²", tolerance=0.1, from_=["a"], method="a", caveat="Gemessen an einer Ersatzfläche."
        )
        answer = triangulate(measured, declared(10.0, unit="m²", from_=["b"], method="b"))
        assert "Ersatzfläche" in answer.caveat
        assert "bestätigen diese Zahl" in answer.caveat

    def test_a_contradiction_still_reads_as_a_finding_about_the_export(self) -> None:
        answer = triangulate(
            computed(51.9948, unit="m²", tolerance=0.5, from_=["a"], method="a"),
            declared(45.0, unit="m²", from_=["b"], method="b"),
        )
        assert answer.agreement == "disagree"
        assert "widersprechen sich" in answer.caveat
        assert "DEKLARIERT" not in answer.caveat


class TestAFlatElementHasNoCompassBearing:
    @pytest.mark.parametrize("slab", [GROUND_SLAB, SIMPLE_FLOOR])
    def test_a_slab_refuses_rather_than_answering_off_its_edge(self, house: SpatialModel, slab: str) -> None:
        answer = op.azimuth(house, slab)
        assert not answer.decidable
        assert answer.value is None
        assert "senkrechte Hauptfläche" in answer.missing.what
        assert "waagrechtes Bauteil hat keine" in answer.missing.remedy
        assert answer.provenance == "computed"

    def test_the_slab_really_does_have_vertical_faces_to_be_fooled_by(self, house: SpatialModel) -> None:
        geo = house.geometry(GROUND_SLAB)
        assert dominant_vertical_plane(geo.triangles) is not None
        assert abs(float(dominant_plane(geo.triangles)[2])) == pytest.approx(1.0, abs=1e-6)

    def test_walls_and_windows_still_answer(self, house: SpatialModel) -> None:
        assert op.azimuth(house, NORTH_WALL).value == {"degrees": 0.0, "compass": "N"}
        assert op.azimuth(house, BEDROOM_WINDOW).decidable
        geo = house.geometry(NORTH_WALL)
        assert abs(float(dominant_plane(geo.triangles)[2])) < 1e-6


class TestASeatingWeightIsNotAFaceArea:
    def test_the_plane_carries_no_field_a_caller_can_read_as_an_area(self, house: SpatialModel) -> None:
        geo = house.geometry(SOUTH_WALL)
        normal = dominant_vertical_plane(geo.triangles)
        plane = outermost_parallel_face(geo.triangles, normal)
        assert not hasattr(plane, "area")
        assert plane.support == pytest.approx(23.5269, abs=1e-3)

    def test_the_summed_weight_really_does_exceed_the_face(self, house: SpatialModel) -> None:
        import shapely.geometry as sg
        import shapely.ops as so

        geo = house.geometry(SOUTH_WALL)
        normal = dominant_vertical_plane(geo.triangles)
        normals, areas = op.triangle_normals_areas(geo.triangles)
        parallel = np.abs(normals @ normal) >= 0.985
        tris = geo.triangles[parallel]
        offsets = tris[:, 0] @ normal
        outer = np.abs(offsets - offsets.max()) <= 0.02
        summed = float(areas[parallel][outer].sum())
        union = so.unary_union([sg.Polygon([(p[0], p[2]) for p in t]) for t in tris[outer]]).area
        assert summed == pytest.approx(23.5269, abs=1e-3)
        assert union == pytest.approx(17.7761, abs=1e-3)
        assert summed > union * 1.3

    def test_the_facade_plane_answer_publishes_position_and_direction_only(self, house: SpatialModel) -> None:
        answer = op.facade_plane_of(house, SOUTH_WALL)
        assert set(answer.value) == {"normal", "point", "outward"}
        assert answer.value["outward"] is True
        assert answer.value["normal"] == pytest.approx([0.0, -1.0, 0.0], abs=1e-6)
        assert answer.value["point"][1] == pytest.approx(-1.3914, abs=0.005)


class TestAHandedOutTriangulationOutlivesTheNextGeometryCall:
    def test_the_volume_readable_before_is_readable_after(self) -> None:
        model = SpatialModel(str(HOUSE))
        triangulation = model.triangulation(BEDROOM)
        before = us.get_volume(triangulation)
        assert before == pytest.approx(38.54195, abs=1e-4)

        assert model.geometry(BEDROOM) is not None
        assert us.get_volume(triangulation) == pytest.approx(before, abs=1e-9)

    def test_the_other_order_survives_too(self) -> None:
        model = SpatialModel(str(HOUSE))
        assert model.geometry(BEDROOM) is not None
        triangulation = model.triangulation(BEDROOM)
        assert us.get_volume(triangulation) == pytest.approx(38.54195, abs=1e-4)

    def test_the_shape_is_built_once_and_only_once(self) -> None:
        model = SpatialModel(str(HOUSE))
        model.triangulation(BEDROOM)
        first = model._shapes[BEDROOM]
        model.geometry(BEDROOM)
        assert model._shapes[BEDROOM] is first


class TestAnInvalidRoomKindIsARefusalAndNotATraceback:
    def test_a_missing_kind_names_the_three_that_exist(self, tools: list, handle: str) -> None:
        with pytest.raises(ToolError) as raised:
            call(tools, "room_inventory", {"model": handle})
        assert "habitable_room" in str(raised.value)
        assert "ancillary_room" in str(raised.value)
        assert "circulation" in str(raised.value)

    def test_an_unknown_kind_is_named_back_to_the_caller(self, tools: list, handle: str) -> None:
        with pytest.raises(ToolError) as raised:
            call(tools, "room_inventory", {"model": handle, "kind": "wohnraum"})
        assert '"wohnraum"' in str(raised.value)

    def test_a_valid_kind_still_answers(self, tools: list, handle: str) -> None:
        out = call(tools, "room_inventory", {"model": handle, "kind": "habitable_room"})
        assert out["provenance"] == "inferred"
        assert out["value"]


class TestACaptionMayNotDescribeADrawingThatIsNotThere:
    def test_an_empty_plan_says_that_nothing_was_drawn(self, tools: list, handle: str) -> None:
        out = call(tools, "view", {"model": handle, "storey": "Roof"})
        assert out["elementsDrawn"] == 0
        assert out["rooms"] == ["Roof"]
        note = out["note"]
        assert "KEIN Bauteil gezeichnet" in note
        assert "elementsDrawn = 0" in note
        assert "keine Aussage über das Gebäude" in note
        assert "Lücken in der Wand" not in note

    def test_a_plan_that_did_draw_something_keeps_its_caption(self, tools: list, handle: str) -> None:
        out = call(tools, "view", {"model": handle, "storey": "Ground Floor"})
        assert out["elementsDrawn"] == 26
        assert "Lücken in der Wand" in out["note"]
        assert "KEIN Bauteil" not in out["note"]


def _second_level_export(path: Path) -> SpatialModel:
    file = ifcopenshell.open(str(HOUSE))
    space = file.by_guid(BEDROOM)
    derived = op.bounds(SpatialModel(str(HOUSE)), BEDROOM)
    for ref in derived.value or []:
        element = file.by_guid(ref.global_id)
        rows = 2 if element.is_a() in ("IfcWindow", "IfcWall", "IfcWallStandardCase") else 1
        for part in range(rows):
            file.create_entity(
                "IfcRelSpaceBoundary",
                GlobalId=ifcopenshell.guid.new(),
                Name=f"{ref.global_id}-Flaeche{part}",
                RelatingSpace=space,
                RelatedBuildingElement=element,
                PhysicalOrVirtualBoundary="PHYSICAL",
                InternalOrExternalBoundary="EXTERNAL",
            )
    file.write(str(path))
    return SpatialModel(str(path))


class TestBoundsReturnsEachElementOnce:
    def test_a_boundary_written_per_face_yields_one_reference(self, tmp_path: Path) -> None:
        model = _second_level_export(tmp_path / "zweite-ebene.ifc")
        answer = op.bounds(model, BEDROOM)
        assert answer.provenance == "declared", "the declared route is the one that carries the duplicates"
        ids = [ref.global_id for ref in (answer.value or [])]
        assert len(ids) == len(set(ids)), "one element came back once per boundary surface"
        assert BEDROOM_WINDOW in ids
        assert len(answer.from_) == len(set(answer.from_))

    def test_the_facade_ranking_does_not_double_its_aperture(self, tmp_path: Path) -> None:
        model = _second_level_export(tmp_path / "zweite-ebene.ifc")
        bounding = [model.file.by_guid(ref.global_id) for ref in op.bounds(model, BEDROOM).value]
        candidates = {c["globalId"]: c for c in dl._facade_candidates(model, BEDROOM, bounding)}
        north = candidates[NORTH_WALL]
        assert north["apertureArea"] == pytest.approx(2.1901, abs=5e-4)
        assert north["apertures"] == [BEDROOM_WINDOW]
        assert dl.room_depth(model, BEDROOM).value["facade"]["why"].count("1 Öffnung(en)") == 1

    def test_a_separating_wall_is_listed_once_and_both_ways_round(self, tmp_path: Path) -> None:
        model = _second_level_export(tmp_path / "zweite-ebene.ifc")
        forward = fire.separating_elements(model, HALL, BEDROOM).value
        backward = fire.separating_elements(model, BEDROOM, HALL).value
        for value in (forward, backward):
            for key in ("separating", "shared"):
                ids = [entry["globalId"] for entry in value[key]]
                assert len(ids) == len(set(ids)), f"{key} listed one element twice"
            assert len(value["ohneFeuerwiderstand"]) == len(set(value["ohneFeuerwiderstand"]))
        assert [e["globalId"] for e in forward["separating"]] == [e["globalId"] for e in backward["separating"]]
        assert [e["globalId"] for e in forward["shared"]] == [e["globalId"] for e in backward["shared"]]


class TestOnlyFacadesWithAnOpeningAreCountedAsSuch:
    @staticmethod
    def _blank_external_wall(path: Path) -> SpatialModel:
        file = ifcopenshell.open(str(HOUSE))
        wall = file.by_guid(PARTITION)
        for relation in wall.IsDefinedBy or []:
            pset = getattr(relation, "RelatingPropertyDefinition", None)
            if pset is None or not pset.is_a("IfcPropertySet") or pset.Name != "Pset_WallCommon":
                continue
            pset.HasProperties = [p for p in pset.HasProperties if p.Name != "IsExternal"] + [
                file.create_entity(
                    "IfcPropertySingleValue",
                    Name="IsExternal",
                    NominalValue=file.create_entity("IfcBoolean", True),
                )
            ]
        file.write(str(path))
        return SpatialModel(str(path))

    def test_a_blank_external_wall_is_not_a_facade_with_an_opening(self, tmp_path: Path) -> None:
        model = self._blank_external_wall(tmp_path / "fensterlose-giebelwand.ifc")
        bounding = [model.file.by_guid(ref.global_id) for ref in op.bounds(model, LIVING).value]
        candidates = dl._facade_candidates(model, LIVING, bounding)
        assert len(candidates) == 3
        assert sum(1 for c in candidates if c["apertureArea"] > 0) == 2

        caveat = dl.room_depth(model, LIVING).caveat
        assert "2 Außenwand/Außenwände mit Öffnungen" in caveat
        assert "von 3 begrenzenden Außenwänden insgesamt" in caveat
        assert "3 Außenwände mit Öffnungen" not in caveat

    def test_the_sample_house_still_counts_its_two_glazed_facades(self, house: SpatialModel) -> None:
        caveat = dl.room_depth(house, LIVING).caveat
        assert "2 Außenwand/Außenwände mit Öffnungen" in caveat
        assert "von 2 begrenzenden Außenwänden insgesamt" in caveat


class TestTheDeclaredVolumeSumCoversTheMeasuredSpaces:
    @staticmethod
    def _hall_without_a_body(path: Path) -> SpatialModel:
        file = ifcopenshell.open(str(HOUSE))
        file.by_guid(HALL).Representation = None
        file.write(str(path))
        return SpatialModel(str(path))

    def test_a_bodyless_space_does_not_fabricate_a_contradiction(self, tmp_path: Path) -> None:
        model = self._hall_without_a_body(tmp_path / "raum-ohne-koerper.ifc")
        answer = eg.compactness(model)
        assert answer.decidable
        assert [v["globalId"] for v in answer.value["spaces"]] == [LIVING, BEDROOM, LOFT]
        assert answer.value["volume"] == pytest.approx(244.994532, abs=1e-4)
        assert answer.value["volumeAgreement"] == "agree"
        assert "widerspricht sich" not in answer.caveat

    def test_the_space_that_left_the_sum_is_named(self, tmp_path: Path) -> None:
        model = self._hall_without_a_body(tmp_path / "raum-ohne-koerper.ifc")
        caveat = eg.compactness(model).caveat
        assert "1 von 4 IfcSpace tragen keinen auswertbaren Körper" in caveat
        assert "Entrance hall" in caveat
        assert "V ist insofern eine Untergrenze" in caveat

    def test_the_intact_file_still_reconciles_both_routes(self, house: SpatialModel) -> None:
        answer = eg.compactness(house)
        assert answer.value["volumeAgreement"] == "agree"
        assert answer.value["volume"] == pytest.approx(266.728298, abs=1e-4)
        assert "keinen auswertbaren Körper" not in answer.caveat


class TestAWindowsDeclaredAreaIsNotAnOpeningArea:
    def test_a_window_answers_with_one_route_and_no_contradiction(self, house: SpatialModel) -> None:
        answer = op.floor_area(house, BEDROOM_WINDOW)
        assert answer.decidable
        assert answer.provenance == "computed"
        assert answer.agreement is None
        assert answer.value == pytest.approx(0.639275, abs=1e-5)
        assert answer.caveat is None

    def test_the_declared_area_really_is_there_to_be_picked_up(self, house: SpatialModel) -> None:
        for global_id, published in ((BEDROOM_WINDOW, 3.5348570571731), (INTERNAL_DOOR, 2.27347800000496)):
            element = house.file.by_guid(global_id)
            found = house.declared_quantity(element, ("Area",))
            assert found is not None
            assert found.path == "BaseQuantities.Area"
            assert found.value == pytest.approx(published, abs=1e-9)
            assert house.declared_quantity(element, ("NetFloorArea", "GrossFloorArea")) is None

    def test_the_nominal_rectangle_is_this_files_rohbaulichte_not_a_third_opinion(self, house: SpatialModel) -> None:
        for global_id, nominal in ((BEDROOM_WINDOW, 2.19010), (INTERNAL_DOOR, 1.70910)):
            element = house.file.by_guid(global_id)
            rectangle = element.OverallWidth * element.OverallHeight * house.unit_scale**2
            assert rectangle == pytest.approx(nominal, abs=1e-5)

            void = [rel.RelatingOpeningElement for rel in element.FillsVoids][0]
            clear = op._clear_opening_area(house, void)
            assert clear == pytest.approx(rectangle, abs=1e-9)

            declared_area = house.declared_quantity(element, ("Area",)).value
            assert declared_area > clear * 1.3


class TestATriangleWithNoDirectionDoesNotVoteOnThePlane:
    BAND = np.array([[[0.0, 0.0, 0.0], [1e-6, 0.0, 0.0], [0.0, 1e-6, 0.0]]])

    def test_the_band_really_does_pass_an_area_filter_with_a_zero_normal(self) -> None:
        normals, areas = op.triangle_normals_areas(self.BAND)
        assert (areas > 0).all(), "the old gate would have dropped these anyway"
        assert areas[0] == pytest.approx(5e-13, rel=1e-9)
        assert not normals.any(), "a triangle that still has a direction is not the case at issue"

    def test_a_mesh_of_them_has_no_dominant_plane(self) -> None:
        assert dominant_plane(self.BAND) is None

    def test_azimuth_refuses_instead_of_reporting_north(self, house: SpatialModel, monkeypatch) -> None:
        from ifc_spatial.model import ElementGeometry

        degenerate = ElementGeometry(
            global_id=NORTH_WALL,
            verts=np.array([[0.0, 0.0, 0.0], [1e-6, 0.0, 0.0], [0.0, 1e-6, 0.0]]),
            faces=np.array([[0, 1, 2]]),
            box=(np.zeros(3), np.full(3, 1e-6)),
            centroid=np.zeros(3),
        )
        monkeypatch.setattr(house, "geometry", lambda gid: degenerate)

        answer = op.azimuth(house, NORTH_WALL)
        assert not answer.decidable
        assert answer.value is None
        assert "senkrechte Hauptfläche" in answer.missing.what

    def test_the_house_is_nowhere_near_the_band(self, house: SpatialModel) -> None:
        smallest = None
        total = 0
        for element in house.file.by_type("IfcProduct"):
            geo = house.geometry(element.GlobalId)
            if geo is None or len(geo.triangles) == 0:
                continue
            _, areas = op.triangle_normals_areas(geo.triangles)
            total += len(areas)
            doubled = float((areas * 2).min())
            smallest = doubled if smallest is None else min(smallest, doubled)
        assert total == 25_312
        assert smallest == pytest.approx(2.6267e-07, rel=1e-3)
        assert smallest > 1e-12 * 100_000


class TestAnUnwrappedHandlerStillCannotLeakATraceback:
    def test_overhang_answers_a_typo_with_a_correction(self, tools: list, handle: str) -> None:
        with pytest.raises(ToolError) as raised:
            call(tools, "overhang", {"model": handle, "projecting": "0" * 22, "facade": NORTH_WALL})
        assert "Unbekannte GlobalId" in str(raised.value)
        assert "find_elements" in str(raised.value)

    def test_light_incidence_answers_a_typo_with_a_correction(self, tools: list, handle: str) -> None:
        with pytest.raises(ToolError) as raised:
            call(tools, "light_incidence", {"model": handle, "globalId": "0" * 22, "angle": 45})
        assert "Unbekannte GlobalId" in str(raised.value)
        assert "find_elements" in str(raised.value)


class TestARoomWhoseBodyIsAShellIsStillMeasurable:
    FIXTURE = FIXTURES / "basement-brep-room.ifc"

    @pytest.fixture(scope="class")
    @classmethod
    def model(cls) -> SpatialModel:
        return SpatialModel(str(cls.FIXTURE))

    def test_the_solid_classifier_really_does_miss_this_room(self, model: SpatialModel) -> None:
        space = model.file.by_type("IfcSpace")[0]
        geo = model.geometry(space.GlobalId)
        assert geo is not None, "the room triangulates — it is only the classifier that fails"
        low, high = geo.box
        x = float((low[0] + high[0]) / 2)
        y = float((low[1] + high[1]) / 2)
        z = float(low[2]) + 0.06
        hits = [e.GlobalId for e in model.tree.select((x, y, z))]
        assert space.GlobalId not in hits, "the classifier now works; this fixture no longer reproduces"

    def test_the_room_is_measured_rather_than_refused(self, model: SpatialModel) -> None:
        space = model.file.by_type("IfcSpace")[0]
        answer = op.clear_height(model, space.GlobalId)
        assert answer.decidable is True, "every room in this export used to come back undecidable"
        assert answer.value == pytest.approx(2.7, abs=0.01)
        assert answer.unit == "m"

    def test_every_grid_point_is_used_because_the_room_is_large(self, model: SpatialModel) -> None:
        space = model.file.by_type("IfcSpace")[0]
        answer = op.clear_height(model, space.GlobalId)
        assert "aus 25 von 25 Rasterpunkten" in (answer.caveat or "")

    def test_the_footprint_is_the_room_not_its_bounding_box(self) -> None:
        from ifc_spatial.geometry import plan_footprint
        from shapely.geometry import Point

        def box(x0, y0, x1, y1):
            return [
                [[x0, y0, 0.0], [x1, y0, 0.0], [x1, y1, 0.0]],
                [[x0, y0, 0.0], [x1, y1, 0.0], [x0, y1, 0.0]],
            ]

        tris = np.array([list(reversed(t)) for t in box(0, 0, 10, 5) + box(0, 5, 5, 10)], dtype=float)
        footprint = plan_footprint(tris)
        assert footprint is not None
        assert footprint.area == pytest.approx(75.0, abs=1e-6)
        assert footprint.covers(Point(2.0, 2.0))
        assert footprint.covers(Point(8.0, 2.0))
        assert not footprint.covers(Point(8.0, 8.0))

    def test_the_remedy_no_longer_names_an_argument_no_tool_exposes(self) -> None:
        import inspect

        from ifc_spatial import tools

        source = inspect.getsource(op.clear_height)
        remedy = source[source.index("kein Rasterpunkt lag im Raumkörper") :]
        remedy = remedy[: remedy.index("elements=")]
        assert "samples" not in remedy
        assert "extent()" in remedy
        assert "samples" not in inspect.getsource(tools.create_tools)


class TestAnExternalWallBoundsMoreThanOneRoom:
    FIXTURE = FIXTURES / "exterior-wall-without-isexternal.ifc"

    @pytest.fixture(scope="class")
    @classmethod
    def model(cls) -> SpatialModel:
        return SpatialModel(str(cls.FIXTURE))

    @staticmethod
    def _wall(model: SpatialModel):
        walls = list(model.file.by_type("IfcWall")) + list(model.file.by_type("IfcWallStandardCase"))
        return walls[0]

    def test_the_file_really_declares_nothing(self, model: SpatialModel) -> None:
        assert model.declared_property(self._wall(model), ("IsExternal",)) is None

    def test_it_really_does_bound_more_than_one_room(self, model: SpatialModel) -> None:
        rooms = op.enclosed_by(model, self._wall(model).GlobalId)
        assert rooms.decidable and len(rooms.value or []) >= 2

    def test_the_wall_is_external_because_its_rooms_are_all_on_one_side(self, model: SpatialModel) -> None:
        wall = self._wall(model)
        rooms = op.enclosed_by(model, wall.GlobalId)
        assert op._rooms_on_one_side(model, wall, rooms.value) is True

        external, _route, why = eg._external_route(model, wall)
        assert external is True
        assert "alle auf derselben Seite" in why

    def test_a_window_in_an_undeclared_wall_faces_outside(self, model: SpatialModel) -> None:
        windows = list(model.file.by_type("IfcWindow")) + list(model.file.by_type("IfcWindowStandardCase"))
        assert windows, "the fixture carries the windows the defect was about"
        for window in windows:
            faces_outside, why = op._faces_outside(model, window)
            assert faces_outside is True, model.label(window)
            assert "tragende Wand" in why and "Geometrie" in why

    def test_a_partition_is_still_a_partition(self, house: SpatialModel) -> None:
        external, _route, _why = eg._external_route(house, house.file.by_guid("3cUkl32yn9qRSPvBJVyWY1"))
        assert external is False


class TestAGalleryVoidIsMeasuredDownwardAndNotSideways:
    FIXTURE = FIXTURES / "gallery-slab-opening.ifc"
    GALERIE = "2dQFggKBb1fOc1CqZDIDlx"
    LIVING_SPACE = "0Lt8gR_E9ESeGH5uY_g9e9"
    FAR_ROOM = "2RSCzLOBz4FAK$_wE8VckM"
    VOID = "16PF6khT5_p$Z03P73inyv"
    RAILINGS = {"0o5vgCKyTBzO5$QJcI2YDP", "09axaKU7X1_O8n6dmmiZ1E"}

    @pytest.fixture(scope="class")
    @classmethod
    def model(cls) -> SpatialModel:
        return SpatialModel(str(cls.FIXTURE))

    def test_the_fixture_carries_the_geometry_the_defect_was_about(self, model: SpatialModel) -> None:
        void = model.geometry(self.VOID)
        assert [round(float(v), 3) for v in void.box[0]] == [7.44, 0.30, 2.50]
        assert [round(float(v), 3) for v in void.box[1]] == [11.70, 4.01, 2.70]
        assert dominant_vertical_plane(void.triangles) is not None
        host = op.hosted_in(model, self.VOID)
        assert host.decidable and host.value[0].ifc_type == "IfcSlab"
        assert round(float(model.geometry(self.GALERIE).box[0][2]), 3) == 2.700
        assert round(float(model.geometry(self.LIVING_SPACE).box[0][2]), 3) == 0.000

    def test_it_is_a_hole_in_a_floor_and_gets_no_wall_frame(self, model: SpatialModel) -> None:
        void = model.file.by_guid(self.VOID)
        assert ac._is_floor_void(model, void, model.geometry(self.VOID)) is True
        assert ac._frame_of(model, void) is None
        assert ac.clear_approach(model, self.VOID).decidable is False

    def test_the_fall_is_the_storey_height_and_the_parapet_is_not_a_number(self, model: SpatialModel) -> None:
        answer = ac.balustrade_check(model, self.GALERIE, 1.0)
        assert answer.decidable
        entry = next(o for o in answer.value["openings"] if o["globalId"] == self.VOID)
        assert entry["position"] == "horizontal"
        assert entry["fall"] == pytest.approx(2.700, abs=0.002)
        assert entry["parapet"] is None
        assert entry["inside"]["level"] == pytest.approx(2.700, abs=0.002)
        assert entry["inside"]["space"] == self.GALERIE
        assert entry["outside"]["level"] == pytest.approx(0.000, abs=0.002)
        assert [e["globalId"] for e in answer.value["edges"]] == [self.VOID]

    def test_both_railings_at_the_void_are_credited_over_the_gallery_floor(self, model: SpatialModel) -> None:
        answer = ac.balustrade_check(model, self.GALERIE, 1.0)
        railings = next(o for o in answer.value["openings"] if o["globalId"] == self.VOID)["railings"]
        assert {r["globalId"] for r in railings} == self.RAILINGS
        assert [r["height"] for r in railings] == [pytest.approx(1.000, abs=0.002)] * 2
        assert [r["top"] for r in railings] == [pytest.approx(3.700, abs=0.002)] * 2
        assert answer.value["railingsInModel"] == 2

    def test_the_room_underneath_is_not_given_an_absturzkante_in_its_ceiling(self, model: SpatialModel) -> None:
        answer = ac.balustrade_check(model, self.LIVING_SPACE, 1.0)
        assert answer.decidable
        entry = next(o for o in answer.value["openings"] if o["globalId"] == self.VOID)
        assert entry["fall"] is None
        assert entry["position"] == "horizontal"
        assert answer.value["edges"] == []
        assert "DECKE" in entry["outside"]["via"]
        assert "darüberliegenden Raum" in entry["outside"]["via"]
        assert "fall = null" in answer.caveat

    def test_a_room_the_void_is_nowhere_near_is_not_given_it_either(self, model: SpatialModel) -> None:
        answer = ac.balustrade_check(model, self.FAR_ROOM, 1.0)
        assert answer.decidable
        entry = next(o for o in answer.value["openings"] if o["globalId"] == self.VOID)
        assert entry["fall"] is None
        assert answer.value["edges"] == []
        assert "4.144 m" in entry["outside"]["via"]

    def test_a_hole_in_a_wall_is_still_measured_sideways(self, house: SpatialModel) -> None:
        answer = ac.balustrade_check(house, BEDROOM)
        window = next(o for o in answer.value["openings"] if o["globalId"] == BEDROOM_WINDOW)
        assert window["position"] == "vertical"
        assert window["parapet"] == pytest.approx(0.900, abs=0.01)
        assert window["fall"] == pytest.approx(0.0, abs=0.01)

    def test_no_verdict_reaches_the_reader(self, model: SpatialModel) -> None:
        answer = ac.balustrade_check(model, self.GALERIE, 1.0)
        text = f"{answer.caveat} {answer.method}"
        for word in ("erfüllt", "zulässig", "Gebäudeklasse", "OIB", "1,00 m", "1.00 m"):
            assert word not in text


class TestConnectsRefusesForATypeTheExportNeverConnects:
    FIXTURE = FIXTURES / "connections-wall-to-wall-only.ifc"
    WALLS = ("3PfS__Y_DBAfq5naM6zD2Z", "2XPyKWY018sA1ygZKgQPtU")
    DOOR = "1Oms875aH3Wg$9l65H2ZGw"
    WINDOW = "1srAI$R4T8ihLXSNHmUSET"
    SLAB = "1pPHnf7cXCpPsNEnQf8_6B"

    @pytest.fixture(scope="class")
    @classmethod
    def model(cls) -> SpatialModel:
        return SpatialModel(str(cls.FIXTURE))

    def test_the_file_really_connects_and_really_only_walls(self, model: SpatialModel) -> None:
        assert model.file.by_type("IfcRelConnectsElements")
        assert rel._connected_types(model) == frozenset({"IfcWallStandardCase"})

    def test_the_two_walls_still_answer_with_each_other(self, model: SpatialModel) -> None:
        for subject, partner in (self.WALLS, self.WALLS[::-1]):
            answer = rel.connects(model, subject)
            assert answer.decidable
            assert [r.global_id for r in answer.value] == [partner]

    @pytest.mark.parametrize("attribute", ["DOOR", "WINDOW", "SLAB"])
    def test_an_unconnected_type_is_a_refusal_that_names_itself(self, model: SpatialModel, attribute: str) -> None:
        global_id = getattr(self, attribute)
        subject = model.file.by_guid(global_id)
        answer = rel.connects(model, global_id)
        assert not answer.decidable
        assert answer.value is None
        assert subject.is_a() in answer.missing.what
        assert "IfcWallStandardCase" in answer.missing.what
        assert "NICHT" in answer.missing.remedy and "Export" in answer.missing.remedy
        assert answer.missing.elements == [global_id]

    def test_the_sample_house_says_the_same_thing(self, house: SpatialModel) -> None:
        assert rel._connected_types(house) == frozenset({"IfcWall", "IfcWallStandardCase", "IfcCurtainWall"})
        for wall in house.file.by_type("IfcWall") + house.file.by_type("IfcCurtainWall"):
            assert rel.connects(house, wall.GlobalId).decidable, wall.GlobalId
        for opening in house.file.by_type("IfcDoor") + house.file.by_type("IfcWindow"):
            assert not rel.connects(house, opening.GlobalId).decidable, opening.GlobalId

    def test_a_subtype_is_covered_by_the_supertype_the_file_connects(self, tmp_path: Path) -> None:
        model = _walls_connected_by_type(tmp_path / "wandarten.ifc")
        assert rel._connected_types(model) == frozenset({"IfcWall"})
        lonely = rel.connects(model, "0aaaaaaaaaaaaaaaaWand3")
        assert lonely.decidable and lonely.value == []
        assert not rel.connects(model, "0aaaaaaaaaaaaaaaaaTuer").decidable

    def test_the_type_set_is_built_once(self, model: SpatialModel) -> None:
        first = rel._connected_types(model)
        assert rel._connected_types(model) is first
        assert model._connected_types is first


def _walls_connected_by_type(path: Path) -> SpatialModel:
    f = ifcopenshell.file(schema="IFC4")
    units = f.create_entity(
        "IfcUnitAssignment", Units=[f.create_entity("IfcSIUnit", UnitType="LENGTHUNIT", Name="METRE")]
    )
    context = f.create_entity(
        "IfcGeometricRepresentationContext",
        ContextType="Model",
        CoordinateSpaceDimension=3,
        Precision=1e-5,
        WorldCoordinateSystem=f.create_entity(
            "IfcAxis2Placement3D", Location=f.create_entity("IfcCartesianPoint", Coordinates=(0.0, 0.0, 0.0))
        ),
    )
    project = f.create_entity(
        "IfcProject",
        GlobalId="0aaaaaaaaaaaaaaaaaProj",
        Name="Verbindungsarten",
        RepresentationContexts=[context],
        UnitsInContext=units,
    )
    site = f.create_entity("IfcSite", GlobalId="0aaaaaaaaaaaaaaaaaSite", Name="Gelaende")
    building = f.create_entity("IfcBuilding", GlobalId="0aaaaaaaaaaaaaaaaaBldg", Name="Haus")
    storey = f.create_entity("IfcBuildingStorey", GlobalId="0aaaaaaaaaaaaaaaaaStry", Name="Erdgeschoss", Elevation=0.0)
    first = f.create_entity("IfcWall", GlobalId="0aaaaaaaaaaaaaaaaWand1", Name="Wand 1")
    second = f.create_entity("IfcWall", GlobalId="0aaaaaaaaaaaaaaaaWand2", Name="Wand 2")
    third = f.create_entity("IfcWallStandardCase", GlobalId="0aaaaaaaaaaaaaaaaWand3", Name="Wand 3 ohne Anschluss")
    door = f.create_entity("IfcDoor", GlobalId="0aaaaaaaaaaaaaaaaaTuer", Name="Tuer ohne Anschluss")
    f.create_entity(
        "IfcRelAggregates", GlobalId="0aaaaaaaaaaaaaaaaaAg01", RelatingObject=project, RelatedObjects=[site]
    )
    f.create_entity(
        "IfcRelAggregates", GlobalId="0aaaaaaaaaaaaaaaaaAg02", RelatingObject=site, RelatedObjects=[building]
    )
    f.create_entity(
        "IfcRelAggregates", GlobalId="0aaaaaaaaaaaaaaaaaAg03", RelatingObject=building, RelatedObjects=[storey]
    )
    f.create_entity(
        "IfcRelContainedInSpatialStructure",
        GlobalId="0aaaaaaaaaaaaaaaaaCt01",
        RelatingStructure=storey,
        RelatedElements=[first, second, third, door],
    )
    f.create_entity(
        "IfcRelConnectsElements", GlobalId="0aaaaaaaaaaaaaaaaaCn01", RelatingElement=first, RelatedElement=second
    )
    f.write(str(path))
    return SpatialModel(str(path))


class TestASideIsNotDecidedByTheRoomsWeCouldPlace:
    @staticmethod
    def _wall_between(model: SpatialModel):
        for wall in list(model.file.by_type("IfcWall")) + list(model.file.by_type("IfcWallStandardCase")):
            rooms = op.enclosed_by(model, wall.GlobalId)
            if rooms.decidable and len(rooms.value or []) >= 2:
                return wall, rooms.value
        return None, None

    def test_one_bodiless_room_makes_the_side_undecided(self, monkeypatch) -> None:
        model = SpatialModel(str(FIXTURES / "exterior-wall-without-isexternal.ifc"))
        wall, rooms = self._wall_between(model)
        assert wall is not None, "the fixture has a wall bounding several rooms"
        assert op._rooms_on_one_side(model, wall, rooms) is True

        blind = {getattr(rooms[0], "global_id", rooms[0])}
        real = model.geometry

        def _one_room_has_no_body(global_id: str):
            return None if global_id in blind else real(global_id)

        monkeypatch.setattr(model, "geometry", _one_room_has_no_body)
        assert op._rooms_on_one_side(model, wall, rooms) is None, (
            "a side decided from the rooms that happened to have bodies"
        )

    def test_a_room_sitting_on_the_plane_does_not_poison_the_rest(self) -> None:
        model = SpatialModel(str(FIXTURES / "exterior-wall-without-isexternal.ifc"))
        wall, rooms = self._wall_between(model)
        real = model.geometry
        centre = np.asarray(real(wall.GlobalId).centroid, dtype=float)

        class _OnThePlane:
            centroid = centre

        first = getattr(rooms[0], "global_id", rooms[0])

        def _one_room_on_the_plane(global_id: str):
            return _OnThePlane if global_id == first else real(global_id)

        model.geometry = _one_room_on_the_plane  # type: ignore[method-assign]
        assert op._rooms_on_one_side(model, wall, rooms) is True
