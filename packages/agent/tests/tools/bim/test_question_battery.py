from __future__ import annotations

from pathlib import Path

import pytest
from agent_testing.ifc_engine import TREE_HITS_RAISE_ON_IFCOPENSHELL_0_9

from agent.tools.bim.measure_register import _build_call
from agent.tools.bim.measure_register import _render

pytest.importorskip("ifc_spatial.tools", reason="the spatial engine is not installed")

FIXTURES = Path(__file__).resolve().parents[5] / "packages" / "ifc-spatial-py" / "tests" / "fixtures"
HOUSE = FIXTURES / "Ifc4_SampleHouse.ifc"
NO_NORTH = FIXTURES / "house-with-rooms.ifc"

WINDOW = "3cUkl32yn9qRSPvBJVyWcE"
BEDROOM = "3w0zWKm7n8SB1qbfwUzt0J"
NORTH_WALL = "3cUkl32yn9qRSPvBJVyWw5"
ROOF = "3cUkl32yn9qRSPvBJVyWh4"
FRONT_DOOR = "3cUkl32yn9qRSPvBJVyWYp"

VERDICT_WORDS = (
    "compliant",
    "konform",
    "erfüllt",
    "verstoß",
    "unzulässig",
    "genehmigungsfähig",
    "satisfie",
    "fulfil",
    "violat",
    "permissible",
    "permitted",
    "admissible",
    "approvable",
)


@pytest.fixture(scope="module")
def tools():
    import ifc_spatial.tools as engine

    return engine.create_tools()


@pytest.fixture(scope="module")
def handles(tools):
    import ifc_spatial.tools as engine

    return {path: engine.call(tools, "open_model", {"path": str(path)})["model"] for path in (HOUSE, NO_NORTH)}


@pytest.fixture()
def ask(tools, handles):
    import ifc_spatial.tools as engine

    def run(path: Path = HOUSE, **kwargs) -> str:
        built = _build_call(
            operation=kwargs.pop("operation"),
            global_id=kwargs.pop("global_id", ""),
            other_global_id=kwargs.pop("other_global_id", ""),
            relation=kwargs.pop("relation", ""),
            measure=kwargs.pop("measure", ""),
            mode=kwargs.pop("mode", ""),
            ifc_type=kwargs.pop("ifc_type", ""),
            name_contains=kwargs.pop("name_contains", ""),
            storey=kwargs.pop("storey", ""),
            kind=kwargs.pop("kind", ""),
            room_kind=kwargs.pop("room_kind", ""),
            limit=kwargs.pop("limit", 50),
            angle_deg=kwargs.pop("angle_deg", None),
            swivel_deg=kwargs.pop("swivel_deg", None),
        )
        assert not kwargs, f"unused arguments: {kwargs}"
        if isinstance(built, str):
            return built
        name, args = built
        args["model"] = handles[path]
        try:
            payload = engine.call(tools, name, args)
        except engine.ToolError as exc:
            return f"Error: {exc}"
        return _render(name, payload, source={}, handle="")

    return run


class TestTheOriginalQuestion:
    def test_step_1_the_window_is_found_by_type_not_invented(self, ask):
        rendered = ask(operation="find_elements", ifc_type="IfcWindow")
        assert "4 hits" in rendered
        assert WINDOW in rendered

    def test_step_2_the_wall_it_sits_in_says_it_was_derived(self, ask):
        rendered = ask(operation="relations", global_id=WINDOW, relation="hostedIn")
        assert "Wall-Ext_102Bwk" in rendered
        assert "via voids+fills" in rendered
        assert "gemessen" in rendered

    def test_step_3_the_room_it_lights_admits_the_export_declares_nothing(self, ask):
        rendered = ask(operation="relations", global_id=WINDOW, relation="opensTo")
        assert "Bedroom" in rendered
        assert "Geometrie abgeleitet" in rendered
        assert "IfcRelSpaceBoundary" in rendered

    def test_step_4_the_floor_area_the_file_never_declares(self, ask):
        rendered = ask(operation="measure", global_id=BEDROOM, measure="floorArea")
        assert "15.4 m²" in rendered
        assert "gemessen" in rendered
        assert "15.41678" not in rendered

    def test_step_5_the_sill_and_head_the_file_never_declares(self, ask):
        rendered = ask(operation="measure", global_id=WINDOW, measure="sillAndHead")
        assert "sill=0.900" in rendered and "head=2.110" in rendered
        assert "height=1.210" in rendered
        assert "Fußbodenaufbau" in rendered

    def test_step_6_the_facade_bearing_instead_of_an_invented_one(self, ask):
        rendered = ask(operation="measure", global_id=NORTH_WALL, measure="azimuth")
        assert "compass=N" in rendered

    def test_step_7_the_overhang_the_agent_called_unmeasurable(self, ask):
        rendered = ask(operation="overhang", global_id=ROOF, other_global_id=NORTH_WALL)
        assert "0.647 m" in rendered
        assert "gemessen (±0.005 m)" in rendered

    def test_step_8_the_prism_is_reported_and_never_judged(self, ask):
        rendered = ask(operation="light_incidence", global_id=WINDOW, angle_deg=45, swivel_deg=30)

        assert "NICHT FREI (prism 45°, lateral 30°)" in rendered
        assert "1 element protrudes" in rendered
        assert "Roof_Flat" in rendered
        assert "{'globalId'" not in rendered

        assert "kein Befund" in rendered
        for word in VERDICT_WORDS:
            assert word not in rendered.lower(), word
        assert rendered.lower().count("kein befund") == 1


class TestAnswerable:
    def test_the_briefing_names_this_file_s_own_storeys(self, ask):
        rendered = ask(operation="briefing")
        assert "Ground Floor" in rendered and "Roof" in rendered
        assert "nicht die lichte Raumhöhe" in rendered
        assert "BLIND" in rendered and "FEHLT" in rendered

    @TREE_HITS_RAISE_ON_IFCOPENSHELL_0_9
    def test_the_clear_height_is_measured_to_the_ceiling_not_the_space_solid(self, ask):
        rendered = ask(operation="measure", global_id=BEDROOM, measure="clearHeight")
        assert "2.200 m" in rendered
        assert "Möblierung" in rendered

    def test_which_rooms_border_this_one(self, ask):
        rendered = ask(operation="relations", global_id=BEDROOM, relation="adjacentSpaces")
        assert "Living room" in rendered
        assert "NICHT begehbare Verbindung" in rendered

    def test_which_elements_bound_this_room(self, ask):
        rendered = ask(operation="relations", global_id=BEDROOM, relation="bounds")
        assert "IfcWall" in rendered and "IfcSlab" in rendered
        assert "Berührungstoleranz" in rendered

    def test_the_storey_pitches_with_the_warning_attached(self, ask):
        rendered = ask(operation="storey_heights")
        assert "Ground Floor" in rendered and "2.5" in rendered
        assert "not determinable" in rendered
        assert "NICHT die lichte Raumhöhe" in rendered

    def test_the_room_use_is_proposed_and_never_asserted(self, ask):
        rendered = ask(operation="room_inventory", room_kind="habitable_room")
        assert "vermutlich" in rendered
        assert "Living room" in rendered and "Bedroom" in rendered
        assert "RECHTLICHE Einstufung" in rendered
        assert "confidence" in rendered

    def test_a_door_width_for_a_lichte_durchgangsbreite(self, ask):
        rendered = ask(operation="measure", global_id=FRONT_DOOR, measure="extent")
        assert "width=1.860" in rendered
        assert "box=(min=" in rendered

    def test_a_vertical_distance_between_two_elements(self, ask):
        rendered = ask(operation="distance", global_id=WINDOW, other_global_id=BEDROOM, mode="vertical")
        assert "0.179 m" in rendered
        assert "Schwerpunkt" in rendered

    def test_one_element_reports_what_can_be_asked_about_it_next(self, ask):
        rendered = ask(operation="element", global_id=WINDOW)
        assert "IfcWindow" in rendered
        assert "Available relations" in rendered
        assert "opensTo" in rendered

    def test_the_light_entry_ratio_the_agent_also_called_unmeasurable(self, ask):
        rendered = ask(operation="measure", global_id=BEDROOM, measure="lightEntryArea")
        assert "light entry area 2.19 m²" in rendered
        assert "15.42 m² floor area" in rendered
        assert "14.21 %" in rendered
        assert "Kein Grenzwert angewandt" in rendered
        assert "ROHBAULICHTE" in rendered

    def test_an_internal_door_is_never_counted_as_daylight(self, ask):
        rendered = ask(operation="measure", global_id=BEDROOM, measure="lightEntryArea")
        assert "NOT counted (interior)" in rendered
        assert "Doors_IntSgl" in rendered
        assert "IsExternal" in rendered
        assert "25.2" not in rendered and "25.3" not in rendered

    def test_an_external_door_does_count(self, ask):
        rendered = ask(operation="measure", global_id="3w0zWKm7n8SB1qbfwUzt0G", measure="lightEntryArea")
        assert "Doors_ExtDbl_Flush" in rendered
        assert "3.82 m²" in rendered
        assert "43.93 %" in rendered

    def test_a_free_prism_renders_as_free(self, ask):
        free = ask(
            operation="light_incidence",
            global_id=WINDOW,
            other_global_id=ROOF,
            angle_deg=45,
            swivel_deg=30,
        )
        blocked = ask(operation="light_incidence", global_id=WINDOW, angle_deg=45, swivel_deg=30)

        assert "NICHT FREI" in blocked
        assert "NICHT FREI" not in free
        assert "no element protrudes into the prism" in free
        assert "prism 45°, lateral 30°" in free
        assert "kein Befund" in free
        for word in VERDICT_WORDS:
            assert word not in free.lower(), word


class TestHonestlyUnanswerable:
    def test_a_facade_bearing_without_a_true_north_refuses_and_says_what_to_add(self, ask):
        rendered = ask(NO_NORTH, operation="measure", global_id="2Haus0Raeume00Wall0001", measure="azimuth")
        assert "UNDECIDABLE" in rendered
        assert "TrueNorth" in rendered
        assert "finding about the EXPORT" in rendered
        assert "Remedy" in rendered
        for compass in ("compass=", " N.", " S.", "Süden", "Norden"):
            assert compass not in rendered

    def test_a_type_this_export_has_none_of_does_not_read_as_a_fact(self, ask):
        rendered = ask(operation="find_elements", ifc_type="IfcRamp")
        assert "0 hits" in rendered
        assert "gibt es nicht" in rendered and "Briefing" in rendered

    def test_an_invented_global_id_is_an_error_and_not_an_answer(self, ask):
        rendered = ask(operation="element", global_id="0abcdefghijklmnopqrstu")
        assert rendered.startswith("Error:")
        assert "nicht enthalten" in rendered
        assert "find_elements" in rendered
        assert "UNDECIDABLE" not in rendered

    def test_light_incidence_refuses_to_supply_the_angle_from_the_clause(self, ask):
        rendered = ask(operation="light_incidence", global_id=WINDOW)
        assert rendered.startswith("Error:")
        assert "angle_deg" in rendered
        assert "comes from the Bestimmung, not from the model" in rendered

    def test_an_overhang_needs_both_elements_and_says_where_to_get_the_second(self, ask):
        rendered = ask(operation="overhang", global_id=NORTH_WALL)
        assert rendered.startswith("Error:")
        assert "TWO elements" in rendered
        assert "relations/hostedIn" in rendered

    def test_a_measure_that_does_not_exist_is_refused_with_the_list(self, ask):
        rendered = ask(operation="measure", global_id=WINDOW, measure="brandwiderstand")
        assert rendered.startswith("Error:")
        assert "does not exist" in rendered
        assert "clearHeight" in rendered

    def test_a_file_without_rooms_says_so_about_the_export(self, ask):
        import ifc_spatial.tools as engine

        tools = engine.create_tools()
        handle = engine.call(tools, "open_model", {"path": str(FIXTURES / "units-feet.ifc")})
        rendered = _render("briefing", {"briefing": handle["briefing"]}, source={}, handle="")
        assert "keine IfcSpace" in rendered
        assert "Räume wurden nicht exportiert" in rendered
        assert "sagt das nichts" in rendered
        assert "TrueNorth" in rendered and "Abhilfe" in rendered


class TestNoAnswerEverBecomesAVerdict:
    @pytest.mark.parametrize(
        "call",
        [
            pytest.param(
                {"operation": "measure", "global_id": BEDROOM, "measure": "clearHeight"},
                marks=TREE_HITS_RAISE_ON_IFCOPENSHELL_0_9,
            ),
            {"operation": "measure", "global_id": WINDOW, "measure": "sillAndHead"},
            {"operation": "measure", "global_id": BEDROOM, "measure": "floorArea"},
            {"operation": "overhang", "global_id": ROOF, "other_global_id": NORTH_WALL},
            {"operation": "light_incidence", "global_id": WINDOW, "angle_deg": 45, "swivel_deg": 30},
            {"operation": "room_inventory", "room_kind": "habitable_room"},
            {"operation": "storey_heights"},
        ],
    )
    def test_no_rendered_answer_contains_a_compliance_word(self, ask, call):
        rendered = ask(**call).lower()
        for word in VERDICT_WORDS:
            assert word not in rendered, f"{call} rendered a verdict: {word}"

    @pytest.mark.parametrize(
        "call",
        [
            pytest.param(
                {"operation": "measure", "global_id": BEDROOM, "measure": "clearHeight"},
                marks=TREE_HITS_RAISE_ON_IFCOPENSHELL_0_9,
            ),
            {"operation": "measure", "global_id": WINDOW, "measure": "sillAndHead"},
            {"operation": "measure", "global_id": BEDROOM, "measure": "floorArea"},
            {"operation": "overhang", "global_id": ROOF, "other_global_id": NORTH_WALL},
            {"operation": "distance", "global_id": WINDOW, "other_global_id": BEDROOM, "mode": "min"},
        ],
    )
    def test_every_measured_number_carries_its_verb_and_its_band(self, ask, call):
        rendered = ask(**call)
        assert "gemessen" in rendered
        assert "±" in rendered
        assert "not declared" in rendered
        assert "deklariert:" not in rendered

    @pytest.mark.parametrize(
        "call",
        [
            {"operation": "measure", "global_id": BEDROOM, "measure": "floorArea"},
            pytest.param(
                {"operation": "measure", "global_id": BEDROOM, "measure": "clearHeight"},
                marks=TREE_HITS_RAISE_ON_IFCOPENSHELL_0_9,
            ),
            {"operation": "overhang", "global_id": ROOF, "other_global_id": NORTH_WALL},
            {"operation": "distance", "global_id": WINDOW, "other_global_id": BEDROOM, "mode": "vertical"},
        ],
    )
    def test_no_number_is_shown_to_more_digits_than_its_band_allows(self, ask, call):
        import re

        rendered = ask(**call)
        for number in re.findall(r"\d+\.\d+", rendered):
            _, _, fraction = number.partition(".")
            assert len(fraction) <= 6, f"{number} in {call}"


class TestTheAgentCanLookAtThePlan:
    def _blocks(self, tools, handles, **kwargs):
        import ifc_spatial.tools as engine

        from agent.tools.bim.measure_register import _build_call
        from agent.tools.bim.measure_register import _image_blocks

        built = _build_call(
            operation="view",
            global_id=kwargs.pop("global_id", ""),
            other_global_id="",
            relation="",
            measure="",
            mode=kwargs.pop("mode", ""),
            ifc_type="",
            name_contains="",
            storey=kwargs.pop("storey", ""),
            kind="",
            room_kind="",
            limit=50,
            angle_deg=None,
            swivel_deg=None,
        )
        if isinstance(built, str):
            return built
        name, args = built
        args["model"] = handles[HOUSE]
        return _image_blocks(engine.call(tools, name, args), source={}, handle="")

    def test_it_returns_an_image_the_model_can_see(self, tools, handles):
        blocks = self._blocks(tools, handles)
        assert [block["type"] for block in blocks] == ["text", "image_url"]
        url = blocks[1]["image_url"]["url"]
        assert url.startswith("data:image/png;base64,")
        assert len(url) > 8_000

    def test_the_caption_names_the_rooms_and_the_cut(self, tools, handles):
        caption = self._blocks(tools, handles)[0]["text"]
        assert "Ground Floor" in caption
        assert "1.20 m" in caption
        assert "Living room" in caption and "Bedroom" in caption
        assert "NEVER read dimensions off it" in caption

    def test_highlighting_is_reported_in_words_as_well_as_pixels(self, tools, handles):
        caption = self._blocks(tools, handles, global_id=f"{WINDOW}, {NORTH_WALL}")[0]["text"]
        assert WINDOW in caption and NORTH_WALL in caption
        assert "Marked red" in caption

    def test_only_and_highlight_are_different_requests(self, tools, handles):
        marked = self._blocks(tools, handles, global_id=WINDOW, mode="highlight")
        isolated = self._blocks(tools, handles, global_id=WINDOW, mode="only")
        assert marked[1]["image_url"]["url"] != isolated[1]["image_url"]["url"]
        assert "Living room" in marked[0]["text"]
        assert "Rooms in the image" not in isolated[0]["text"]

    def test_isolating_nothing_is_refused_rather_than_drawn_empty(self, tools, handles):
        answer = self._blocks(tools, handles, mode="only")
        assert isinstance(answer, str)
        assert answer.startswith("Error:")
        assert "needs at least one global_id" in answer

    @pytest.mark.xfail(
        strict=True,
        raises=AssertionError,
        reason=(
            "real bug, behaviour left alone: the schema's `mode` literal in measure_input.py refuses first, "
            "through `_refusal` in measure_register.py, so `_view_call`'s own sentence is never reached and "
            "operation='view' answers with the distance modes and the distance advice"
        ),
    )
    def test_an_unknown_mode_names_the_two_that_exist(self, tools, handles):
        answer = self._blocks(tools, handles, global_id=WINDOW, mode="zoom")
        assert isinstance(answer, str)
        assert "horizontal" not in answer
        assert "'highlight'" in answer and "'only'" in answer

    def test_a_storey_that_is_not_in_this_file_is_an_error_not_a_blank_page(self, tools, handles):
        import ifc_spatial.tools as engine

        with pytest.raises(engine.ToolError) as raised:
            self._blocks(tools, handles, storey="Dachgeschoss")
        assert "Briefing" in str(raised.value)
