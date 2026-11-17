from __future__ import annotations

import json
from pathlib import Path

import pytest
from ifc_spatial.model import MAX_FILE_BYTES
from ifc_spatial.model import ModelTooLargeError
from ifc_spatial.model import ModelUnreadableError
from ifc_spatial.tools import MEASURES
from ifc_spatial.tools import ToolError
from ifc_spatial.tools import call
from ifc_spatial.tools import create_tools

FIXTURES = Path(__file__).resolve().parent / "fixtures"
SAMPLE_HOUSE = FIXTURES / "Ifc4_SampleHouse.ifc"
NO_NORTH = FIXTURES / "house-with-rooms.ifc"

WINDOW = "3cUkl32yn9qRSPvBJVyWcE"
BEDROOM = "3w0zWKm7n8SB1qbfwUzt0J"
NORTH_WALL = "3cUkl32yn9qRSPvBJVyWw5"
GROUND_FLOOR = "1o0c33arXF9AEePDYchjCY"
PARTITION = "3cUkl32yn9qRSPvBJVyWY1"
ROOF = "3cUkl32yn9qRSPvBJVyWh4"


@pytest.fixture(scope="module")
def tools() -> list:
    return create_tools()


@pytest.fixture(scope="module")
def house(tools: list) -> str:
    return call(tools, "open_model", {"path": str(SAMPLE_HOUSE)})["model"]


def test_opens_the_fixture_and_resolves_the_window_to_its_room(tools: list, house: str) -> None:
    found = call(tools, "find_elements", {"model": house, "ifcType": "IfcWindow"})
    assert found["total"] == 4 and found["truncated"] is False
    ids = [element["globalId"] for element in found["elements"]]
    assert WINDOW in ids

    wall = call(tools, "relations", {"model": house, "globalId": WINDOW, "relation": "hostedIn"})
    assert wall["decidable"] is True
    assert wall["provenance"] == "computed"
    assert "Wall-Ext_102Bwk" in wall["value"][0]["name"]

    room = call(tools, "relations", {"model": house, "globalId": WINDOW, "relation": "opensTo"})
    assert [ref["name"] for ref in room["value"]] == ["Bedroom"]
    assert room["provenance"] == "computed"
    assert "Geometrie abgeleitet" in room["caveat"]

    area = call(tools, "measure", {"model": house, "globalId": BEDROOM, "measure": "floorArea"})
    assert area["decidable"] is True and area["unit"] == "m²"
    assert abs(area["value"] - 15.41678125) < 0.001
    assert area["agreement"] == "agree"


def test_every_result_survives_json(tools: list, house: str) -> None:
    for name, args in [
        ("briefing", {"model": house}),
        ("element", {"model": house, "globalId": WINDOW}),
        ("relations", {"model": house, "globalId": NORTH_WALL, "relation": "hosts"}),
        ("measure", {"model": house, "globalId": WINDOW, "measure": "extent"}),
        ("distance", {"model": house, "a": WINDOW, "b": BEDROOM, "mode": "horizontal"}),
        ("storey_heights", {"model": house}),
        ("room_inventory", {"model": house, "kind": "habitable_room"}),
    ]:
        text = json.dumps(call(tools, name, args), ensure_ascii=False)
        assert text and "ndarray" not in text and "object at 0x" not in text


def test_an_unknown_global_id_is_an_error_not_an_undecidable(tools: list, house: str) -> None:
    with pytest.raises(ToolError) as raised:
        call(tools, "relations", {"model": house, "globalId": "1234567890abcdefghijkl", "relation": "hostedIn"})
    assert "Unbekannte GlobalId" in str(raised.value)
    assert "find_elements" in str(raised.value)


def test_the_file_cannot_say_is_a_successful_answer(tools: list) -> None:
    handle = call(tools, "open_model", {"path": str(NO_NORTH)})["model"]
    walls = call(tools, "find_elements", {"model": handle, "ifcType": "IfcWall", "limit": 1})
    wall_id = walls["elements"][0]["globalId"]

    answer = call(tools, "measure", {"model": handle, "globalId": wall_id, "measure": "azimuth"})
    assert answer["decidable"] is False
    assert answer["value"] is None
    assert answer["missing"]["what"] == "IfcGeometricRepresentationContext.TrueNorth"
    assert "Nordrichtung" in answer["missing"]["remedy"]


def test_no_hits_points_at_the_briefing_instead_of_reading_as_a_fact(tools: list, house: str) -> None:
    empty = call(tools, "find_elements", {"model": house, "ifcType": "IfcRamp"})
    assert empty["total"] == 0 and empty["elements"] == []
    assert "gibt es nicht" in empty["hint"] and "Briefing" in empty["hint"]


def test_a_page_is_never_presented_as_a_total(tools: list, house: str) -> None:
    page = call(tools, "find_elements", {"model": house, "ifcType": "IfcWindow", "limit": 2})
    assert len(page["elements"]) == 2
    assert page["total"] == 4
    assert page["truncated"] is True


def test_an_unopened_model_says_which_ones_are_open(tools: list, house: str) -> None:
    with pytest.raises(ToolError) as raised:
        call(tools, "briefing", {"model": "deadbeefdead"})
    assert "open_model" in str(raised.value)


def test_open_and_briefing_do_not_run_geometry() -> None:
    fresh = create_tools()
    opened = call(fresh, "open_model", {"path": str(SAMPLE_HOUSE)})
    assert opened["geometry"]["pass"] == "noch nicht gelaufen"
    call(fresh, "briefing", {"model": opened["model"]})
    call(fresh, "find_elements", {"model": opened["model"], "ifcType": "IfcSpace"})
    call(fresh, "element", {"model": opened["model"], "globalId": WINDOW})
    assert "Geometrie-Pass noch nicht gelaufen" in call(fresh, "briefing", {"model": opened["model"]})["briefing"]


def test_the_tool_list_is_the_ported_surface_plus_what_the_port_added(tools: list) -> None:
    assert [tool.name for tool in tools] == [
        "open_model",
        "briefing",
        "find_elements",
        "element",
        "relations",
        "measure",
        "survey",
        "element_profile",
        "distance",
        "clearance",
        "fire",
        "envelope",
        "shopping_list",
        "view",
        "draw",
        "overhang",
        "light_incidence",
        "sun_position",
        "storey_heights",
        "room_inventory",
    ]


def test_clear_height_measures_under_the_suspended_ceiling(tools: list, house: str) -> None:
    answer = call(tools, "measure", {"model": house, "globalId": BEDROOM, "measure": "clearHeight"})
    assert answer["decidable"] is True
    assert abs(answer["value"] - 2.20) < 0.01
    assert "Möblierung" in answer["caveat"]


def test_draw_writes_a_file_and_does_not_return_the_svg(tools: list, house: str) -> None:
    result = call(tools, "draw", {"model": house})
    path = Path(result["path"])
    assert path.exists() and path.suffix == ".svg"
    assert result["bytes"] == path.stat().st_size > 1000
    assert path.read_text(encoding="utf-8", errors="replace").lstrip().startswith("<?xml")
    assert "svg" not in result
    assert "Maße nicht aus dem Bild ablesen" in result["note"]


def test_overhang_measures_the_number_the_agent_called_unmeasurable(tools: list, house: str) -> None:
    roof = call(tools, "find_elements", {"model": house, "ifcType": "IfcRoof"})["elements"][0]["globalId"]
    wall = call(tools, "relations", {"model": house, "globalId": WINDOW, "relation": "hostedIn"})["value"][0]

    answer = call(tools, "overhang", {"model": house, "projecting": roof, "facade": wall["globalId"]})
    assert answer["decidable"] is True
    assert abs(answer["value"] - 0.647) < 0.01
    assert answer["unit"] == "m"
    assert answer["tolerance"] <= 0.01
    assert answer["provenance"] == "computed"


def test_light_incidence_reports_geometry_and_refuses_to_render_a_verdict(tools: list, house: str) -> None:
    wall = call(tools, "relations", {"model": house, "globalId": WINDOW, "relation": "hostedIn"})["value"][0]
    answer = call(
        tools,
        "light_incidence",
        {"model": house, "globalId": WINDOW, "angle": 45, "swivel": 30, "exclude": [wall["globalId"]]},
    )

    assert answer["decidable"] is True
    assert answer["free"] is False
    assert "Roof_Flat" in " ".join(ref["name"] or "" for ref in answer["value"])
    assert all(ref["intrusionDepth"] > 0 for ref in answer["value"])
    assert answer["prism"] == {"angleDeg": 45.0, "swivelDeg": 30.0, "openingId": WINDOW}
    assert "kein Befund" in answer["caveat"]
    serialised = json.dumps(answer, ensure_ascii=False).lower()
    assert not any(word in serialised for word in ("compliant", "erfüllt", "verstoß"))


def test_light_incidence_refuses_without_the_angle_from_the_clause(tools: list, house: str) -> None:
    with pytest.raises(ToolError) as raised:
        call(tools, "light_incidence", {"model": house, "globalId": WINDOW})
    assert "angle" in str(raised.value)

    for bad in (0, 90, 120, "45"):
        with pytest.raises(ToolError):
            call(tools, "light_incidence", {"model": house, "globalId": WINDOW, "angle": bad})


def test_both_new_tools_demand_a_global_id_rather_than_guessing(tools: list, house: str) -> None:
    for name, args in [
        ("overhang", {"model": house, "facade": WINDOW}),
        ("overhang", {"model": house, "projecting": WINDOW}),
        ("light_incidence", {"model": house, "angle": 45}),
    ]:
        with pytest.raises(ToolError) as raised:
            call(tools, name, args)
        assert "GlobalId" in str(raised.value)


def test_the_same_file_opens_twice_to_one_handle(tools: list, house: str) -> None:
    again = call(tools, "open_model", {"path": str(SAMPLE_HOUSE)})
    assert again["model"] == house
    assert again["contentHash"].startswith(house)


def test_a_missing_path_is_named(tools: list) -> None:
    with pytest.raises(ToolError) as raised:
        call(tools, "open_model", {})
    assert "path" in str(raised.value)


def test_an_unknown_tool_names_the_ones_that_exist(tools: list) -> None:
    with pytest.raises(ToolError) as raised:
        call(tools, "measure_everything", {})
    assert "open_model" in str(raised.value)


def test_an_unreadable_file_is_refused_with_the_reason_a_person_can_act_on(tools: list, tmp_path: Path) -> None:
    broken = tmp_path / "abgeschnitten.ifc"
    broken.write_text("ISO-10303-21;\nHEADER;\n", encoding="utf-8")
    with pytest.raises(ToolError) as raised:
        call(tools, "open_model", {"path": str(broken)})
    assert "Modell konnte nicht geöffnet werden" in str(raised.value)


def test_a_refused_file_stays_the_cause_so_a_client_can_tell_which_refusal_it_was(tools: list, tmp_path: Path) -> None:
    empty = tmp_path / "leer.ifc"
    empty.write_bytes(b"")
    with pytest.raises(ToolError) as raised:
        call(tools, "open_model", {"path": str(empty)})
    cause = raised.value.__cause__
    assert isinstance(cause, ModelUnreadableError)
    assert not isinstance(cause, ModelTooLargeError)
    assert cause.reason.startswith("Diese Datei ist leer")


def test_a_file_over_the_limit_stays_the_cause_with_both_numbers(tools: list, tmp_path: Path) -> None:
    big = tmp_path / "gross.ifc"
    with big.open("wb") as file:
        file.truncate(MAX_FILE_BYTES + 1)
    with pytest.raises(ToolError) as raised:
        call(tools, "open_model", {"path": str(big)})
    cause = raised.value.__cause__
    assert isinstance(cause, ModelTooLargeError)
    assert (cause.size, cause.limit) == (MAX_FILE_BYTES + 1, MAX_FILE_BYTES)


@pytest.mark.parametrize(
    "failure",
    [MemoryError(), OSError(5, "Input/output error"), FileNotFoundError(2, "Path does not exist")],
    ids=["memory", "read_failed", "gone_meanwhile"],
)
def test_a_failure_in_the_parser_that_is_not_about_the_file_is_not_a_refusal(
    tools: list, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, failure: Exception
) -> None:

    def parser_fails(_path: str) -> None:
        raise failure

    monkeypatch.setattr("ifc_spatial.model.ifcopenshell.open", parser_fails)
    complete = tmp_path / "vollstaendig.ifc"
    complete.write_text("ISO-10303-21;\nEND-ISO-10303-21;\n", encoding="ascii")
    with pytest.raises(ToolError) as raised:
        call(tools, "open_model", {"path": str(complete)})
    assert raised.value.__cause__ is failure


def test_a_failed_read_in_the_preflight_is_not_a_refusal(
    tools: list, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:

    def read_fails(path: str, _mode: str) -> None:
        raise OSError(24, "Too many open files", path)

    monkeypatch.setattr("ifc_spatial.model.open", read_fails, raising=False)
    complete = tmp_path / "vollstaendig.ifc"
    complete.write_text("ISO-10303-21;\nEND-ISO-10303-21;\n", encoding="ascii")
    with pytest.raises(ToolError) as raised:
        call(tools, "open_model", {"path": str(complete)})
    assert isinstance(raised.value.__cause__, OSError)


class TestTheEnvelopeReachesTheSurface:
    def test_all_three_aspects_answer_through_the_tool(self, tools: list, house: str) -> None:
        for what in ("thermalEnvelope", "areaByOrientation", "compactness"):
            answer = call(tools, "envelope", {"model": house, "what": what})
            assert answer["decidable"] is True, what
            assert answer["provenance"] == "computed", what

    def test_the_envelope_area_is_the_same_number_by_all_three_routes(self, tools: list, house: str) -> None:
        thermal = call(tools, "envelope", {"model": house, "what": "thermalEnvelope"})["value"]
        oriented = call(tools, "envelope", {"model": house, "what": "areaByOrientation"})["value"]
        compact = call(tools, "envelope", {"model": house, "what": "compactness"})["value"]
        assert thermal["totalArea"] == pytest.approx(225.700565, abs=1e-6)
        assert oriented["total"] == pytest.approx(thermal["totalArea"], abs=1e-6)
        assert compact["envelopeArea"] == pytest.approx(thermal["totalArea"], abs=1e-6)

    def test_the_window_wall_ratio_survives_per_facade(self, tools: list, house: str) -> None:
        value = call(tools, "envelope", {"model": house, "what": "areaByOrientation"})["value"]
        assert value["orientationKnown"] is True
        ratios = {k: v["windowWallRatio"] for k, v in value["byOrientation"].items()}
        assert ratios["N"] == pytest.approx(0.193455, abs=1e-5)
        assert ratios["O"] == pytest.approx(0.0, abs=1e-9)
        assert ratios["S"] == pytest.approx(0.405, abs=5e-3)
        assert ratios["W"] == pytest.approx(1.0, abs=1e-9)

    def test_the_aspect_is_matched_case_insensitively(self, tools: list, house: str) -> None:
        assert call(tools, "envelope", {"model": house, "what": "AREABYORIENTATION"})["decidable"] is True

    def test_an_unknown_aspect_names_the_ones_that_exist(self, tools: list, house: str) -> None:
        with pytest.raises(ToolError) as raised:
            call(tools, "envelope", {"model": house, "what": "uWert"})
        assert "thermalEnvelope" in str(raised.value)

    def test_no_aspect_returns_a_verdict_or_a_limit(self, tools: list, house: str) -> None:
        for what in ("thermalEnvelope", "areaByOrientation", "compactness"):
            text = json.dumps(call(tools, "envelope", {"model": house, "what": what}), ensure_ascii=False)
            for forbidden in ("erfüllt", "zulässig", "Grenzwert überschritten", "Gebäudeklasse"):
                assert forbidden not in text, f"{what} carries „{forbidden}“"

    def test_a_declared_u_value_is_never_invented(self, tools: list, house: str) -> None:
        value = call(tools, "envelope", {"model": house, "what": "thermalEnvelope"})["value"]
        entries = [entry for group in value["byKind"].values() for entry in group]
        assert entries, "the sample house has an envelope"
        for entry in entries:
            assert entry.get("uValue") is None or entry.get("uValueSource") == "declared"


class TestTheClearanceReachesTheSurface:
    def test_the_box_gap_and_the_clear_dimension_disagree_by_a_metre(self, tools: list, house: str) -> None:
        box = call(tools, "distance", {"model": house, "a": ROOF, "b": PARTITION, "mode": "min"})
        assert box["value"] == pytest.approx(0.0, abs=1e-9)

        answer = call(tools, "clearance", {"model": house, "a": ROOF, "b": PARTITION})
        assert answer["decidable"] is True
        assert answer["provenance"] == "computed"
        assert answer["value"]["distance"] == pytest.approx(0.9947, abs=0.001)
        assert answer["value"]["boxGap"] == pytest.approx(0.0, abs=1e-9)
        assert "unterschätzt" in answer["caveat"]

    def test_the_two_measured_points_come_back_for_a_dimension_line(self, tools: list, house: str) -> None:
        value = call(tools, "clearance", {"model": house, "a": ROOF, "b": PARTITION})["value"]
        assert len(value["pointOnA"]) == 3 and len(value["pointOnB"]) == 3

    def test_both_elements_are_demanded_rather_than_guessed(self, tools: list, house: str) -> None:
        with pytest.raises(ToolError) as raised:
            call(tools, "clearance", {"model": house, "a": ROOF})
        assert "b fehlt" in str(raised.value) and "find_elements" in str(raised.value)

    def test_one_element_twice_is_refused_with_the_operator_that_does_answer(self, tools: list, house: str) -> None:
        answer = call(tools, "clearance", {"model": house, "a": ROOF, "b": ROOF})
        assert answer["decidable"] is False
        assert "clearOpeningWidth()" in answer["missing"]["remedy"]


class TestTheDoorGraphReachesTheSurface:
    def test_the_graph_answers_through_fire_and_names_the_room_with_no_exit(self, tools: list, house: str) -> None:
        answer = call(tools, "fire", {"model": house, "what": "doorGraph"})
        assert answer["decidable"] is True
        assert answer["provenance"] == "computed"
        graph = answer["value"]
        assert len(graph["nodes"]) == 5
        assert len(graph["edges"]) == 3
        with_edges = {node for edge in graph["edges"] for node in edge["connects"]}
        stranded = [ref["name"] for ref in graph["nodes"] if ref["globalId"] not in with_edges]
        assert stranded == ["Roof"]
        assert "keine Türkante" in answer["caveat"]

    def test_the_doors_that_became_no_edge_are_reported_and_not_dropped(self, tools: list, house: str) -> None:
        graph = call(tools, "fire", {"model": house, "what": "doorGraph"})["value"]
        assert graph["undetermined"] == []
        assert graph["excluded"] == []

    def test_the_aspect_is_matched_case_insensitively(self, tools: list, house: str) -> None:
        assert call(tools, "fire", {"model": house, "what": "DOORGRAPH"})["decidable"] is True

    def test_it_needs_no_global_id(self, tools: list, house: str) -> None:
        assert call(tools, "fire", {"model": house, "what": "doorGraph"})["decidable"] is True


class TestTheSunPositionReachesTheSurface:
    def test_the_almanac_position_arrives_through_the_tool(self, tools: list, house: str) -> None:
        answer = call(tools, "sun_position", {"model": house, "when": "2026-06-21T12:00:00Z"})
        assert answer["decidable"] is True
        assert answer["provenance"] == "computed" and answer["unit"] == "°"
        assert answer["value"]["azimuth"] == pytest.approx(178.867641, abs=0.01)
        assert answer["value"]["altitude"] == pytest.approx(61.934279, abs=0.01)
        assert answer["value"]["compass"] == "S"
        assert len(answer["value"]["directionInModel"]) == 3

    def test_the_answer_says_it_is_not_a_besonnungsstudie(self, tools: list, house: str) -> None:
        answer = call(tools, "sun_position", {"model": house, "when": "2026-06-21T12:00:00Z"})
        assert "Besonnungsstudie" in answer["caveat"]

    def test_a_timestamp_without_a_zone_is_refused_rather_than_read_as_utc(self, tools: list, house: str) -> None:
        answer = call(tools, "sun_position", {"model": house, "when": "2026-06-21T12:00:00"})
        assert answer["decidable"] is False
        assert "Zeitzone" in answer["missing"]["what"]

    def test_a_missing_when_is_a_caller_error_phrased_for_a_timestamp(self, tools: list, house: str) -> None:
        with pytest.raises(ToolError) as raised:
            call(tools, "sun_position", {"model": house})
        assert "ISO 8601" in str(raised.value) and "GlobalId" not in str(raised.value)

    def test_an_ungeoreferenced_file_is_undecidable_and_stays_undecidable(self, tools: list) -> None:
        handle = call(tools, "open_model", {"path": str(NO_NORTH)})["model"]
        answer = call(tools, "sun_position", {"model": handle, "when": "2026-06-21T12:00:00+02:00"})
        assert answer["decidable"] is False
        assert answer["missing"]["what"] == "IfcSite.RefLatitude / RefLongitude"

        smuggled = call(
            tools,
            "sun_position",
            {"model": handle, "when": "2026-06-21T12:00:00+02:00", "latitude": 48.2082, "longitude": 16.3738},
        )
        assert smuggled["decidable"] is False, "the tool forwarded coordinates it must not accept"


OPERATOR_MODULES = (
    "operators",
    "circulation",
    "clearance",
    "daylight",
    "stairs",
    "fire",
    "accessibility",
    "envelope_geometry",
    "render",
    "ids_export",
    "relations",
)

NOT_ON_THE_SURFACE = {
    "operators.facade_plane_of": (
        "A construction, not an answer: it returns a normal and a point, and the only thing an agent "
        "can do with three floats is quote them. The two things a caller actually wants from it are "
        "already surfaced — the compass direction as measure/azimuth, and the „Außenseite ungesichert“ "
        "caveat, which `overhang` copies verbatim into its own answer."
    ),
    "operators.ray": (
        "Takes raw model coordinates, and the surface offers no honest way to obtain one: every "
        "GlobalId-shaped answer here reports metres, not a point in the file's coordinate system. An "
        "agent would have to invent an origin, and a hit reported from an invented origin is a fact "
        "about a ray nobody cast. Its three real uses are wired as relations/above, relations/below "
        "and light_incidence, which build the geometry themselves."
    ),
    "ids_export.answers_as_ids": (
        "Needs the ANSWERS of a whole conversation, and this surface keeps none: every handler is one "
        "call in and one result out, by design (see the module docstring on why nothing is retained "
        "beyond the model handle). Wiring it would mean an answer ledger inside the tool layer, which "
        "is a host's job. `shopping_list` covers the model-wide half from the briefing's blind spots."
    ),
    "ids_export.to_xml": (
        "Reached, but through `write_ids`, which `shopping_list` calls — the XML is validated against "
        "the bundled XSD on the way to the file. Exposing the string separately would offer an IDS "
        "that skipped the file the checker actually opens."
    ),
}


def _tool_surface_references() -> set[str]:
    import ast
    import pathlib

    import ifc_spatial.tools as tools_module

    referenced = set()
    for path in sorted(pathlib.Path(tools_module.__file__).parent.glob("tools*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        alias_of: dict[str, str] = {}
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom) and node.level == 1 and node.module is None:
                for alias in node.names:
                    alias_of[alias.asname or alias.name] = alias.name
        for node in ast.walk(tree):
            if isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name):
                module = alias_of.get(node.value.id)
                if module is not None:
                    referenced.add(f"{module}.{node.attr}")
    return referenced


def test_no_operator_is_implemented_tested_and_reachable_from_nothing() -> None:
    import ast
    import pathlib

    import ifc_spatial

    referenced = _tool_surface_references()
    package = pathlib.Path(ifc_spatial.__file__).parent
    unreachable = []
    for module in OPERATOR_MODULES:
        tree = ast.parse((package / f"{module}.py").read_text(encoding="utf-8"))
        for node in tree.body:
            if not isinstance(node, ast.FunctionDef) or node.name.startswith("_"):
                continue
            qualified = f"{module}.{node.name}"
            if qualified not in referenced and qualified not in NOT_ON_THE_SURFACE:
                unreachable.append(qualified)
    assert not unreachable, (
        f"{unreachable} exist, are tested, and no tool reaches them. Either wire them into "
        "create_tools() — a per-element measurement into MEASURE_FN, a whole-model question into a "
        "grouped tool — or record the decision in NOT_ON_THE_SURFACE with the reason."
    )


def test_the_deliberate_omissions_are_still_real_functions() -> None:
    import importlib

    for qualified in NOT_ON_THE_SURFACE:
        module, _, name = qualified.rpartition(".")
        assert hasattr(importlib.import_module(f"ifc_spatial.{module}"), name), qualified


def test_survey_measures_every_room_and_reports_the_spread(tools: list, house: str) -> None:
    result = call(tools, "survey", {"model": house, "measure": "clearHeight", "ifcType": "IfcSpace"})
    summary = result["summary"]

    assert summary["measured"] == summary["of"] == 4
    assert summary["undecidable"] == []
    assert summary["spread"] == pytest.approx(summary["max"] - summary["min"])
    assert summary["spread"] > 1.0, "the roof space differs from the rooms by more than a tolerance"
    assert summary["provenance"] == {"computed": 4}


def test_survey_names_the_elements_so_the_outlier_can_be_reported(tools: list, house: str) -> None:
    result = call(tools, "survey", {"model": house, "measure": "clearHeight", "ifcType": "IfcSpace"})
    lowest = min(result["results"], key=lambda row: row["answer"]["value"])

    assert lowest["name"], "every surveyed element carries its own name"
    assert lowest["storey"], "and the storey it belongs to"
    assert all(row["globalId"] and row["name"] is not None for row in result["results"])


def test_survey_returns_exactly_what_measure_returns_element_by_element(tools: list, house: str) -> None:
    surveyed = call(tools, "survey", {"model": house, "measure": "floorArea", "ifcType": "IfcSpace"})

    for row in surveyed["results"]:
        alone = call(tools, "measure", {"model": house, "globalId": row["globalId"], "measure": "floorArea"})
        assert row["answer"] == alone, f"{row['name']} measured differently in a survey than alone"


def test_survey_names_the_rooms_it_could_not_measure(tools: list) -> None:
    galerie = call(tools, "open_model", {"path": str(FIXTURES / "attic-gallery.ifc")})["model"]
    surveyed = call(tools, "survey", {"model": galerie, "measure": "clearHeight", "ifcType": "IfcSpace"})
    summary = surveyed["summary"]

    assert summary["measured"] == 0 and summary["of"] == 7
    assert len(summary["undecidable"]) == 7
    assert all(entry["name"] for entry in summary["undecidable"])
    assert "spread" not in summary and "min" not in summary


def test_survey_of_nothing_says_so_instead_of_measuring_nothing(tools: list, house: str) -> None:
    result = call(tools, "survey", {"model": house, "measure": "clearHeight", "storey": "Kellergeschoß"})

    assert result["results"] == [] and result["summary"]["of"] == 0
    assert "Briefing" in result["hint"], "and it points at where the real storey names are"


def test_survey_selects_exactly_what_find_elements_lists(tools: list, house: str) -> None:
    selector = {"ifcType": "IfcSpace", "storey": "Ground Floor"}
    listed = call(tools, "find_elements", {"model": house, **selector, "limit": 500})
    surveyed = call(tools, "survey", {"model": house, "measure": "floorArea", **selector})

    assert [element["globalId"] for element in listed["elements"]] == [row["globalId"] for row in surveyed["results"]]


def test_survey_says_out_loud_when_it_measured_only_a_slice(tools: list, house: str) -> None:
    result = call(tools, "survey", {"model": house, "measure": "floorArea", "ifcType": "IfcSpace", "limit": 2})

    assert result["truncated"] is True
    assert result["summary"]["of"] == 2 and result["summary"]["selected"] == 4
    assert "4" in result["hint"] and "2" in result["hint"]


def test_profile_measures_only_what_the_type_is_about(tools: list, house: str) -> None:
    room = call(tools, "element_profile", {"model": house, "globalId": BEDROOM})
    door_id = call(tools, "find_elements", {"model": house, "ifcType": "IfcDoor"})["elements"][0]["globalId"]
    door = call(tools, "element_profile", {"model": house, "globalId": door_id})

    assert "clearHeight" in room["measures"] and "clearHeight" not in door["measures"]
    assert "thresholdHeight" in door["measures"] and "thresholdHeight" not in room["measures"]
    assert room["element"]["name"] and room["storey"]
    assert "clearHeight" in door["notMeasured"]["kinds"] and door["notMeasured"]["why"]


def test_profile_leaves_the_expensive_walks_out_unless_asked(tools: list, house: str) -> None:
    quick = call(tools, "element_profile", {"model": house, "globalId": BEDROOM})
    full = call(tools, "element_profile", {"model": house, "globalId": BEDROOM, "include": "expensive"})

    assert "egressPath" not in quick["measures"]
    assert "egressPath" in full["measures"]
    assert set(quick["measures"]) < set(full["measures"])


def test_profile_of_an_unknown_id_is_an_error_not_an_empty_profile(tools: list, house: str) -> None:
    with pytest.raises(ToolError) as raised:
        call(tools, "element_profile", {"model": house, "globalId": "0" * 22})
    assert "find_elements" in str(raised.value)


def test_every_measure_subject_names_a_real_measure_and_a_real_type(tools: list) -> None:
    from ifc_spatial.tools import MEASURE_EXPENSIVE
    from ifc_spatial.tools import MEASURE_SUBJECT

    assert set(MEASURE_SUBJECT) == set(MEASURES), "every measure declares what it is about"
    assert MEASURE_EXPENSIVE <= set(MEASURES)
    for name, subjects in MEASURE_SUBJECT.items():
        for subject in subjects:
            assert subject.startswith("Ifc"), f"{name} names {subject}, which is not an IFC type"


def test_a_wrong_type_in_the_selection_does_not_kill_the_survey(tools: list, house: str) -> None:
    surveyed = call(tools, "survey", {"model": house, "measure": "clearHeight", "storey": "Ground Floor"})

    assert surveyed["summary"]["measured"] >= 1
    assert surveyed["scopedTo"] == ["IfcSpace"], "the measure narrowed the selection to its own subject"


def test_the_measure_scopes_the_selection_when_the_caller_did_not(tools: list, house: str) -> None:
    scoped = call(tools, "survey", {"model": house, "measure": "clearHeight", "storey": "Ground Floor"})
    pinned = call(
        tools,
        "survey",
        {"model": house, "measure": "clearHeight", "storey": "Ground Floor", "ifcType": "IfcSpace"},
    )

    assert [row["globalId"] for row in scoped["results"]] == [row["globalId"] for row in pinned["results"]]
    assert "scopedTo" not in pinned


def test_a_spread_is_never_derived_from_a_single_measurement(tools: list, house: str) -> None:
    one = call(tools, "survey", {"model": house, "measure": "floorArea", "ifcType": "IfcSpace", "limit": 1})

    assert one["summary"]["measured"] == 1
    assert "spread" not in one["summary"] and "min" not in one["summary"]
    assert "keine Spanne" in one["summary"]["note"]


def test_an_unreadable_limit_is_refused_rather_than_floored_to_one(tools: list, house: str) -> None:
    for bad in (0, -5, "abc"):
        with pytest.raises(ToolError) as raised:
            call(tools, "survey", {"model": house, "measure": "floorArea", "ifcType": "IfcSpace", "limit": bad})
        assert str(bad) in str(raised.value)


def test_measures_that_answer_with_a_dict_still_produce_a_spread(tools: list, house: str) -> None:
    doors = call(tools, "survey", {"model": house, "measure": "clearWidth", "ifcType": "IfcDoor"})
    summary = doors["summary"]

    assert summary["measured"] >= 2
    assert summary["spreadOf"] == "width"
    assert summary["spread"] == pytest.approx(summary["max"] - summary["min"])
    assert summary["spreadOver"] == summary["measured"]


def test_every_headline_key_exists_on_the_measure_it_names(tools: list, house: str) -> None:
    from ifc_spatial.tools import MEASURE_HEADLINE

    assert set(MEASURE_HEADLINE) <= set(MEASURES)
    room = call(tools, "element_profile", {"model": house, "globalId": BEDROOM, "include": "expensive"})
    for name, answer in room["measures"].items():
        key = MEASURE_HEADLINE.get(name)
        if key and answer.get("decidable") and isinstance(answer.get("value"), dict):
            assert key in answer["value"], f"{name} declares headline {key!r} and does not return it"
