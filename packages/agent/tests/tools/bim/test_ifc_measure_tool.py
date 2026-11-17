from __future__ import annotations

import io
import json
import pathlib
import urllib.error

import pytest

from agent.knowledge.bim_query import BimQueryRejectedError
from agent.knowledge.bim_query import BimQueryUnavailableError
from agent.knowledge.ifc_spatial_client import ModelTooLargeError
from agent.knowledge.ifc_spatial_client import ModelUnreadableError
from agent.knowledge.ifc_spatial_client import SpatialEngineUnavailableError
from agent.knowledge.ifc_spatial_client import SpatialToolError
from agent.tools.bim.failures import MAX_REASON_CHARS
from agent.tools.bim.measure_register import ENGINE_UNAVAILABLE_TEXT
from agent.tools.bim.measure_register import NON_MEASURING_OPERATIONS
from agent.tools.bim.measure_register import OPERATIONS
from agent.tools.bim.measure_register import UNAVAILABLE_TEXT
from agent.tools.bim.measure_register import _build_call
from agent.tools.bim.measure_register import _measured_count
from agent.tools.bim.measure_register import _provenance_line
from agent.tools.bim.measure_register import _rejected_text
from agent.tools.bim.measure_register import _render
from agent.tools.bim.measure_register import _render_answer
from agent.tools.bim.measure_register import _render_unresolved
from agent.tools.bim.measure_register import _unrunnable_text
from agent.tools.bim.measurement_evidence import MEASUREMENT_EVIDENCE_PREFIX
from agent.tools.bim.measurement_evidence import result_carries_measurement


def build(**overrides):
    defaults = dict(operation="briefing")
    defaults.update(overrides)
    return _build_call(**defaults)


class TestBuildCall:
    def test_the_default_operation_is_the_briefing(self):
        assert build(operation="briefing") == ("briefing", {"format": "text"})

    def test_unknown_operation_is_refused_by_name(self):
        result = build(operation="measure_room")
        assert isinstance(result, str)
        assert "unknown operation" in result
        assert "storey_heights" in result

    @pytest.mark.parametrize("operation", ["element", "relations", "measure", "distance"])
    def test_an_operation_about_one_element_needs_its_global_id(self, operation):
        answer = build(operation=operation)
        assert isinstance(answer, str)
        assert "needs a global_id" in answer
        assert "find_elements" in answer

    def test_an_unknown_relation_is_refused_with_the_list(self):
        answer = build(operation="relations", global_id="1kTv", relation="borders")
        assert isinstance(answer, str)
        assert "relation 'borders' does not exist" in answer
        assert "adjacentSpaces" in answer

    def test_a_real_relation_passes_through_verbatim(self):
        assert build(operation="relations", global_id="1kTv", relation="opensTo") == (
            "relations",
            {"globalId": "1kTv", "relation": "opensTo"},
        )

    def test_an_unknown_measure_is_refused_with_the_list(self):
        answer = build(operation="measure", global_id="1kTv", measure="area")
        assert isinstance(answer, str)
        assert "measure 'area' does not exist" in answer
        assert "floorArea" in answer

    def test_every_measure_the_engine_has_is_accepted(self):
        from agent.tools.bim.measure_register import MEASURES

        assert len(MEASURES) >= 7
        for name in MEASURES:
            assert build(operation="measure", global_id="g1", measure=name) == (
                "measure",
                {"globalId": "g1", "measure": name},
            ), name

    def test_no_distance_mode_is_advertised_as_a_clear_dimension(self):
        from agent.tools.bim.measure_register import DISTANCE_MODES

        for name, text in DISTANCE_MODES.items():
            assert "what a lichte Breite check needs" not in text, name
        assert "NOT a lichte Breite" in DISTANCE_MODES["horizontal"]
        assert "NOT a lichte Höhe" in DISTANCE_MODES["vertical"]
        assert "clearWidth" in DISTANCE_MODES["horizontal"]
        assert "clearHeight" in DISTANCE_MODES["vertical"]
        assert "BOUNDING BOXES" in DISTANCE_MODES["min"]

    def test_the_mode_error_does_not_repeat_the_wrong_advice(self):
        answer = build(operation="distance", global_id="a", other_global_id="b", mode="diagonal")
        assert isinstance(answer, str)
        assert "A lichte Breite needs 'horizontal'" not in answer
        assert "none is a clear dimension" in answer

    def test_light_incidence_can_exclude_more_than_one_element(self):
        name, args = build(
            operation="light_incidence",
            global_id="w1",
            other_global_id="wall1, roof1",
            angle_deg=45,
            swivel_deg=30,
        )
        assert name == "light_incidence"
        assert args["exclude"] == ["wall1", "roof1"]

    def test_one_exclusion_still_works_and_blank_entries_are_dropped(self):
        _, single = build(operation="light_incidence", global_id="w1", other_global_id="wall1", angle_deg=45)
        assert single["exclude"] == ["wall1"]

        _, messy = build(operation="light_incidence", global_id="w1", other_global_id=" wall1 , , roof1,", angle_deg=45)
        assert messy["exclude"] == ["wall1", "roof1"]

        _, none_given = build(operation="light_incidence", global_id="w1", angle_deg=45)
        assert "exclude" not in none_given

    def test_distance_needs_two_elements(self):
        answer = build(operation="distance", global_id="a")
        assert isinstance(answer, str)
        assert "other_global_id" in answer

    def test_distance_defaults_to_the_shortest_gap(self):
        assert build(operation="distance", global_id="a", other_global_id="b") == (
            "distance",
            {"a": "a", "b": "b", "mode": "min"},
        )

    def test_an_unknown_distance_mode_is_refused_and_says_which_to_use(self):
        answer = build(operation="distance", global_id="a", other_global_id="b", mode="diagonal")
        assert isinstance(answer, str)
        assert "mode 'diagonal' does not exist" in answer
        assert "horizontal" in answer and "vertical" in answer

    def test_an_unknown_kind_is_refused_and_distinguished_from_an_ifc_type(self):
        answer = build(operation="find_elements", kind="IfcSpace")
        assert isinstance(answer, str)
        assert "kind 'IfcSpace' does not exist" in answer
        assert "'ifc_type'" in answer

    def test_find_elements_passes_the_filters_the_engine_knows(self):
        assert build(
            operation="find_elements",
            ifc_type="IfcWindow",
            name_contains="Nord",
            storey="Ground Floor",
            kind="element",
            limit=10,
        ) == (
            "find_elements",
            {
                "limit": 10,
                "ifcType": "IfcWindow",
                "nameContains": "Nord",
                "storey": "Ground Floor",
                "kind": "element",
            },
        )

    @pytest.mark.parametrize("limit,expected", [(0, 50), (-3, 1), (1, 1), (5, 5), (10_000, 500)])
    def test_the_element_limit_is_clamped(self, limit, expected):
        name, args = build(operation="find_elements", limit=limit)
        assert name == "find_elements"
        assert args["limit"] == expected

    def test_an_unknown_room_kind_is_refused(self):
        answer = build(operation="room_inventory", room_kind="wohnraum")
        assert isinstance(answer, str)
        assert "room_kind 'wohnraum' does not exist" in answer
        assert "habitable_room" in answer

    def test_the_german_room_kinds_and_fire_aspect_are_still_accepted_for_one_release(self):
        from agent.tools.bim.measure_register import IfcMeasureInput

        assert IfcMeasureInput(operation="room_inventory", room_kind="Aufenthaltsraum").room_kind == "habitable_room"
        assert IfcMeasureInput(operation="room_inventory", room_kind="erschliessung").room_kind == "circulation"
        assert IfcMeasureInput(operation="fire", kind="fluchtniveau").kind == "escape_level"

    def test_the_room_kinds_the_lexicon_knows_pass_through_lowercased(self):
        for value in ("habitable_room", "ancillary_room", "circulation"):
            assert build(operation="room_inventory", room_kind=value.upper()) == (
                "room_inventory",
                {"kind": value},
            ), value

    def test_storey_heights_takes_nothing(self):
        assert build(operation="storey_heights") == ("storey_heights", {})

    def test_clearance_needs_two_elements_and_names_the_one_element_operator(self):
        answer = build(operation="clearance", global_id="a")
        assert isinstance(answer, str)
        assert "TWO elements" in answer
        assert "clearWidth" in answer

    def test_clearance_passes_both_elements_through(self):
        assert build(operation="clearance", global_id="a", other_global_id="b") == (
            "clearance",
            {"a": "a", "b": "b"},
        )

    def test_sun_position_refuses_without_an_instant_and_says_it_needs_a_zone(self):
        answer = build(operation="sun_position")
        assert isinstance(answer, str)
        assert "ISO 8601" in answer and "time zone" in answer
        assert "+02:00" in answer

    def test_sun_position_forwards_the_instant_and_nothing_else(self):
        assert build(operation="sun_position", when=" 2026-06-21T12:00:00+02:00 ", global_id="w1") == (
            "sun_position",
            {"when": "2026-06-21T12:00:00+02:00"},
        )

    def test_draw_narrows_by_storey_and_type(self):
        assert build(operation="draw", storey="Ground Floor", ifc_type="IfcWall") == (
            "draw",
            {"storey": "Ground Floor", "include": ["IfcWall"]},
        )


class TestTheEnumsMatchTheEngine:
    @staticmethod
    def _engine():
        import json
        from types import SimpleNamespace

        fixture = (
            pathlib.Path(__file__).resolve().parents[5]
            / "packages"
            / "ifc-spatial-py"
            / "tests"
            / "fixtures"
            / "vocabulary.json"
        )
        vocabulary = json.loads(fixture.read_text(encoding="utf-8"))
        tools = [SimpleNamespace(name=name) for name in vocabulary.pop("TOOLS")]
        return SimpleNamespace(**vocabulary, create_tools=lambda: tools)

    def test_the_relations_are_the_engine_s_relations(self):
        from agent.tools.bim.measure_register import RELATIONS

        assert set(RELATIONS) == set(self._engine().RELATIONS)

    def test_the_geometric_relations_are_the_engine_s(self):
        from agent.tools.bim.measure_register import GEOMETRIC_RELATIONS

        assert set(GEOMETRIC_RELATIONS) == set(self._engine().GEOMETRIC_RELATIONS)

    def test_the_measures_are_the_engine_s_measures(self):
        from agent.tools.bim.measure_register import MEASURES

        assert set(MEASURES) == set(self._engine().MEASURES)

    def test_the_kinds_are_the_engine_s_kinds(self):
        from agent.tools.bim.measure_register import KINDS

        assert set(KINDS) == set(self._engine().KINDS)

    def test_the_fire_aspects_are_the_engine_s(self):
        from agent.tools.bim.measure_register import FIRE_ASPECTS

        assert set(FIRE_ASPECTS) == set(self._engine().FIRE_ASPECTS)

    def test_the_envelope_aspects_are_the_engine_s(self):
        from agent.tools.bim.measure_register import ENVELOPE_ASPECTS

        assert set(ENVELOPE_ASPECTS) == set(self._engine().ENVELOPE_ASPECTS)

    def test_the_batch_ceiling_is_the_engine_s(self):
        from agent.tools.bim.measure_register import MAX_BATCH

        assert MAX_BATCH == self._engine().MAX_BATCH

    def test_every_operation_this_tool_offers_exists_on_the_engine(self):
        from agent.tools.bim.measure_register import VALID_OPERATIONS

        engine_tools = {tool.name for tool in self._engine().create_tools()}
        assert VALID_OPERATIONS <= engine_tools, VALID_OPERATIONS - engine_tools

    def test_no_engine_tool_is_unreachable_from_the_agent(self):
        from agent.tools.bim.measure_register import VALID_OPERATIONS

        engine_tools = {tool.name for tool in self._engine().create_tools()}
        unreachable = engine_tools - VALID_OPERATIONS - {"open_model"}
        assert not unreachable, (
            f"{sorted(unreachable)} exist on the engine and no operation reaches them. Either add "
            "them to VALID_OPERATIONS and describe them in _TOOL_DESCRIPTION, or take them off "
            "create_tools() — shipping them halfway is the failure this test exists for."
        )

    def test_every_operation_is_actually_described_to_the_model(self):
        from agent.tools.bim.measure_register import _TOOL_DESCRIPTION
        from agent.tools.bim.measure_register import VALID_OPERATIONS

        undocumented = {name for name in VALID_OPERATIONS if name not in _TOOL_DESCRIPTION}
        assert not undocumented, (
            f"{sorted(undocumented)} can be called and are never mentioned to the model. "
            "The model cannot pick an operation it has not been told about."
        )


class TestProvenanceIsThreeDifferentSentences:
    def test_a_declared_value_is_reported_as_the_file_s_own_statement(self):
        line = _provenance_line({"value": 15.41678125, "unit": "m²", "provenance": "declared", "decidable": True})
        assert line.startswith("deklariert:")
        assert "this is what the file states" in line

    def test_a_computed_value_carries_its_tolerance_and_says_it_was_measured(self):
        line = _provenance_line(
            {
                "value": 2.2,
                "unit": "m",
                "tolerance": 0.005,
                "provenance": "computed",
                "decidable": True,
            }
        )
        assert line.startswith("gemessen")
        assert "±0.005" in line
        assert "not declared" in line
        assert "deklariert:" not in line

    def test_an_inferred_value_is_a_proposal_with_its_confidence(self):
        line = _provenance_line(
            {
                "value": None,
                "unit": None,
                "provenance": "inferred",
                "confidence": 0.72,
                "decidable": True,
            }
        )
        assert line.startswith("vermutlich:")
        assert "0.72" in line
        assert "not a finding" in line

    def test_a_number_with_no_tolerance_is_passed_through_untouched(self):
        line = _provenance_line(
            {"value": 15.41678125, "unit": "m²", "tolerance": None, "provenance": "computed", "decidable": True}
        )
        assert "15.41678125" in line

    def test_a_number_is_shown_to_its_tolerance_and_no_further(self):
        line = _provenance_line(
            {
                "value": 15.41678125000004,
                "unit": "m²",
                "tolerance": 0.15416781250000042,
                "provenance": "computed",
                "decidable": True,
            }
        )
        assert "gemessen (±0.15 m²): 15.4 m²" in line
        assert "15.41678125" not in line
        assert "0.15416781" not in line
        assert "15.42" not in line

    @pytest.mark.parametrize(
        ("value", "tolerance", "shown"),
        [
            (0.17913908774709064, 0.01, "0.179"),
            (0.6466378093377606, 0.005, "0.647"),
            (2.1099999999999999, 0.01, "2.110"),
            (0.0, 3, "0"),
        ],
    )
    def test_the_precision_follows_the_band(self, value, tolerance, shown):
        line = _provenance_line(
            {"value": value, "unit": "m", "tolerance": tolerance, "provenance": "computed", "decidable": True}
        )
        assert f": {shown} m" in line

    def test_a_declared_figure_is_never_re_rounded(self):
        line = _provenance_line(
            {
                "value": 0.235926059936681,
                "unit": "W/m²K",
                "tolerance": 0.01,
                "provenance": "declared",
                "decidable": True,
            }
        )
        assert "0.235926059936681" in line


class TestUndecidableIsAFindingAboutTheExport:
    UNDECIDABLE = {
        "value": None,
        "unit": None,
        "tolerance": None,
        "provenance": "declared",
        "from": ["1kTvXnbbzCWw8lcMd1dR4o"],
        "method": "sillAndHead(1kTv…)",
        "decidable": False,
        "missing": {
            "what": "Pset_WindowCommon.SillHeight",
            "remedy": "Brüstungshöhe im CAD am Fenstertyp hinterlegen und neu exportieren.",
        },
    }

    def test_it_renders_as_a_finding_and_not_as_an_error(self):
        rendered = _render("measure", dict(self.UNDECIDABLE))

        assert "UNDECIDABLE" in rendered
        assert not rendered.startswith("Error")
        assert "Error:" not in rendered

    def test_it_names_what_is_missing_and_what_fixes_it(self):
        rendered = _render("measure", dict(self.UNDECIDABLE))

        assert "Pset_WindowCommon.SillHeight" in rendered
        assert "Brüstungshöhe im CAD am Fenstertyp hinterlegen" in rendered

    def test_it_says_the_finding_is_about_the_export_not_the_building(self):
        assert "finding about the EXPORT, not about the building" in _render("measure", dict(self.UNDECIDABLE))

    def test_the_method_is_still_reported_so_the_refusal_can_be_checked(self):
        assert "sillAndHead" in _render("measure", dict(self.UNDECIDABLE))


class TestRendering:
    def test_a_measurement_files_the_model_it_read_under_the_turns_round(self):
        from agent.common import turn_status

        token = turn_status.begin_lane_capture()
        try:
            _render(
                "measure",
                {"value": 2.5, "unit": "m", "provenance": "computed", "tolerance": 0.005, "decidable": True},
                source={"model": {"filename": "Haus-A_V3.ifc", "schemaVersion": "IFC4", "elements": 74}},
                detail="clearHeight",
            )
            hits = turn_status.get_lane_captures()
        finally:
            turn_status.end_lane_capture(token)

        assert [(hit["name"], hit.get("detail")) for hit in hits] == [("Haus-A_V3.ifc", "measure · clearHeight")]

    def test_a_result_naming_no_model_files_nothing(self):
        from agent.common import turn_status

        token = turn_status.begin_lane_capture()
        try:
            _render("measure", {"value": 1.0, "unit": "m", "provenance": "computed", "decidable": True})
            hits = turn_status.get_lane_captures()
        finally:
            turn_status.end_lane_capture(token)

        assert hits == []

    def test_the_model_line_names_the_file_and_the_parsed_handle(self):
        rendered = _render(
            "measure",
            {"value": 2.5, "unit": "m", "provenance": "computed", "tolerance": 0.005, "decidable": True},
            source={"model": {"filename": "Haus-A_V3.ifc", "schemaVersion": "IFC4", "elements": 74}},
            handle="3f2a1b0c9d8e7f6a",  # pragma: allowlist secret
        )
        assert "Model: Haus-A_V3.ifc (IFC4, 74 elements)" in rendered
        assert "handle 3f2a1b0c9d8e" in rendered

    def test_a_relation_lists_the_elements_it_found_with_their_ids(self):
        rendered = _render(
            "relations",
            {
                "value": [
                    {
                        "globalId": "3cUkl32yn9qRSPvBJVyWcE",
                        "ifcType": "IfcSpace",
                        "name": "Living room",
                        "kind": "space",
                        "via": "Kontaktkarte",
                    }
                ],
                "unit": None,
                "provenance": "computed",
                "from": ["1kTv"],
                "method": "opensTo(1kTv)",
                "decidable": True,
            },
        )
        assert "IfcSpace „Living room“ · GlobalId 3cUkl32yn9qRSPvBJVyWcE (via Kontaktkarte)" in rendered

    def test_a_caveat_is_never_dropped(self):
        rendered = _render(
            "storey_heights",
            {
                "value": [{"storey": "Ground Floor", "elevation": 0.0, "height": 2.85}],
                "unit": "m",
                "provenance": "computed",
                "decidable": True,
                "caveat": "Rohbau-Geschoßhöhe … NICHT die lichte Raumhöhe.",
            },
        )
        assert "Note: Rohbau-Geschoßhöhe" in rendered
        assert "Ground Floor" in rendered and "2.85" in rendered

    def test_a_contradiction_between_two_routes_is_surfaced_as_one(self):
        rendered = _render(
            "measure",
            {
                "value": 15.41,
                "unit": "m²",
                "provenance": "computed",
                "decidable": True,
                "agreement": "disagree",
                "caveat": "Zwei Wege zu dieser Zahl widersprechen sich: 15.41 gegen 12.00 …",
            },
        )
        assert "CONTRADICTION" in rendered
        assert "widersprechen sich" in rendered

    def test_the_briefing_is_handed_over_whole_with_its_instruction(self):
        rendered = _render("briefing", {"briefing": "GEBÄUDE  Haus-A.ifc · IFC4\nBLIND  keine …"})
        assert "GEBÄUDE  Haus-A.ifc" in rendered
        assert "verbatim" in rendered
        assert "BLIND" in rendered

    def test_find_elements_reports_the_total_separately_from_the_page(self):
        rendered = _render(
            "find_elements",
            {
                "elements": [{"globalId": "g1", "ifcType": "IfcWindow", "name": "W-01"}],
                "total": 14,
                "truncated": True,
            },
        )
        assert "14 hits, 1 listed." in rendered
        assert "More hits exist" in rendered

    def test_a_drawing_forbids_reading_numbers_off_it(self):
        rendered = _render("draw", {"path": "/tmp/plan.svg", "bytes": 120_000, "seconds": 5.1})
        assert "/tmp/plan.svg" in rendered
        assert "Do NOT read dimensions off the image" in rendered

    def test_a_unit_goes_after_a_number_and_beside_a_set_of_them(self):
        named = _provenance_line(
            {
                "value": {"sill": 0.9, "head": 2.11},
                "unit": "m",
                "tolerance": 0.01,
                "provenance": "computed",
                "decidable": True,
            }
        )
        assert "sill=0.900, head=2.110 (m)" in named
        assert "±0.01 m" in named

    def test_a_list_of_one_is_reported_in_the_singular(self):
        line = _provenance_line(
            {
                "value": [{"globalId": "g1", "ifcType": "IfcWall", "name": "W"}],
                "unit": None,
                "provenance": "computed",
                "decidable": True,
            }
        )
        assert "1 entry" in line and "1 Einträge" not in line

    BLOCKED = {
        "value": [
            {
                "globalId": "3cUkl32yn9qRSPvBJVyWh4",
                "name": "Basic Roof:Roof_Flat",
                "intrusionDepth": 1.056308,
            }
        ],
        "unit": "m",
        "tolerance": 0.005,
        "provenance": "computed",
        "decidable": True,
        "free": False,
        "prism": {"angleDeg": 45.0, "swivelDeg": 30.0, "openingId": "3cUkl32yn9qRSPvBJVyWcE"},
        "caveat": "Das ist Geometrie, kein Befund.",
    }

    def test_an_obstruction_is_a_sentence_and_not_a_python_dict(self):
        rendered = "\n".join(_render_answer(dict(self.BLOCKED)))
        assert "{" not in rendered and "'globalId'" not in rendered
        assert "Basic Roof:Roof_Flat · GlobalId 3cUkl32yn9qRSPvBJVyWh4 · protrudes 1.056 m into the prism" in rendered

    def test_the_verdict_line_says_which_way_it_went(self):
        blocked = "\n".join(_render_answer(dict(self.BLOCKED)))
        assert "NICHT FREI (prism 45°, lateral 30°)" in blocked
        assert "1 element protrudes into the prism, deepest intrusion 1.056 m" in blocked

    def test_an_empty_list_is_the_answer_and_must_not_render_as_nothing(self):
        free = {**self.BLOCKED, "value": [], "free": True}
        rendered = "\n".join(_render_answer(free))
        assert "FREI (prism 45°, lateral 30°): no element protrudes into the prism." in rendered
        assert "NICHT FREI" not in rendered

    def test_the_german_agrees_in_number(self):
        one = "\n".join(_render_answer(dict(self.BLOCKED)))
        assert "1 element protrudes" in one

        two = {
            **self.BLOCKED,
            "value": [
                self.BLOCKED["value"][0],
                {"globalId": "g2", "name": "Vordach", "intrusionDepth": 0.4},
            ],
        }
        assert "2 elements protrude" in "\n".join(_render_answer(two))

    def test_the_angles_are_echoed_as_written_not_as_floats(self):
        rendered = "\n".join(_render_answer(dict(self.BLOCKED)))
        assert "45°" in rendered and "45.0°" not in rendered

    def test_the_verdict_never_becomes_a_compliance_finding(self):
        rendered = "\n".join(_render_answer(dict(self.BLOCKED))).lower()
        for word in ("compliant", "erfüllt", "verstoß", "unzulässig"):
            assert word not in rendered

    def test_a_swivel_of_zero_degrees_is_stated_and_not_dropped(self):
        straight = {**self.BLOCKED, "prism": {**self.BLOCKED["prism"], "swivelDeg": 0.0}}
        assert "lateral 0°" in "\n".join(_render_answer(straight))

    def test_a_prism_without_a_swivel_says_nothing_about_one(self):
        unspecified = {**self.BLOCKED, "prism": {"angleDeg": 45.0, "openingId": "3cUkl32yn9qRSPvBJVyWcE"}}
        rendered = "\n".join(_render_answer(unspecified))
        assert "seitlich" not in rendered
        assert "prism 45°" in rendered

    def test_an_unresolved_model_reports_the_reason_and_the_choices(self):
        rendered = _render_unresolved(
            {
                "resolved": False,
                "reason": "ambiguous",
                "message": "Mehrere Modelle.",
                "models": [{"filename": "haus-a.ifc", "status": "ready", "elements": 120}],
            }
        )
        assert "Mehrere Modelle." in rendered
        assert "haus-a.ifc (ready, 120 elements)" in rendered

    def test_a_model_that_is_still_extracting_is_not_offered_as_available(self):
        rendered = _render_unresolved(
            {
                "resolved": False,
                "reason": "not_ready",
                "message": "Wird verarbeitet.",
                "models": [{"filename": "haus-a.ifc", "status": "extracting", "elements": 0}],
            }
        )
        assert "not yet queryable" in rendered
        assert "Available models" not in rendered

    def test_a_model_that_is_still_extracting_closes_the_turn(self):
        from agent.tools.bim.failures import NO_MODEL_TEXT

        rendered = _render_unresolved(
            {
                "resolved": False,
                "reason": "not_ready",
                "message": "Dieses IFC-Modell wird derzeit verarbeitet. Es steht noch nicht zur Abfrage bereit.",
                "models": [{"filename": "haus-a.ifc", "status": "extracting", "elements": 0}],
            }
        )
        assert "This one call is the answer for this turn" in rendered
        assert "not ready to be queried yet" in rendered
        assert NO_MODEL_TEXT not in rendered

    def test_a_project_with_no_model_is_told_that_this_call_is_the_answer(self):
        rendered = _render_unresolved(
            {
                "resolved": False,
                "reason": "no_models",
                "message": "Für dieses Projekt ist kein IFC-Modell hinterlegt.",
                "models": [],
            }
        )
        assert "Für dieses Projekt ist kein IFC-Modell hinterlegt." in rendered
        assert "This one call is the answer" in rendered

    def test_an_unreadable_model_is_told_the_same(self):
        rendered = _render_unresolved(
            {
                "resolved": False,
                "reason": "extraction_failed",
                "message": "Dieses IFC-Modell konnte nicht gelesen werden.",
                "models": [{"filename": "haus-a.ifc", "status": "failed", "elements": 0}],
            }
        )
        assert "haus-a.ifc (failed, 0 elements)" in rendered
        assert "This one call is the answer" in rendered

    def test_a_retryable_reason_keeps_its_invitation(self):
        for reason in ("ambiguous", "no_match"):
            rendered = _render_unresolved(
                {
                    "resolved": False,
                    "reason": reason,
                    "message": "Bitte eines auswählen.",
                    "models": [{"filename": "haus-a.ifc", "status": "ready", "elements": 120}],
                }
            )
            assert "Available models" in rendered, reason
            assert "This one call is the answer" not in rendered, reason


class TestOnlyAQuantityCountsAsAMeasurement:
    RELATIONS = {
        "value": [
            {"globalId": "3cUkl32yn9qRSPvBJVyWcE", "ifcType": "IfcWall", "name": "Wand 01", "kind": "element"},
            {"globalId": "3cUkl32yn9qRSPvBJVyWh4", "ifcType": "IfcWall", "name": "Wand 02", "kind": "element"},
        ],
        "unit": None,
        "tolerance": None,
        "provenance": "declared",
        "decidable": True,
    }

    def test_a_topology_lookup_measures_nothing(self):
        assert _measured_count(dict(self.RELATIONS)) == 0

    def test_a_topology_lookup_does_not_grant_grounding_through_the_trailer(self):
        rendered = _render("relations", dict(self.RELATIONS))
        assert result_carries_measurement(rendered) is False
        assert f"{MEASUREMENT_EVIDENCE_PREFIX} 0" in rendered

    @pytest.mark.parametrize(
        ("label", "answer"),
        [
            ("scalar with both", {"value": 2.48, "unit": "m", "tolerance": 0.005}),
            ("area without tolerance", {"value": 184.2, "unit": "m²"}),
            ("list of storeys", {"value": [{"storey": "EG", "height": 2.85}], "unit": "m"}),
            ("ratio with tolerance", {"value": 0.118, "unit": None, "tolerance": 0.001}),
        ],
    )
    def test_a_real_measurement_still_counts(self, label, answer):
        assert _measured_count({**answer, "provenance": "computed", "decidable": True}) == 1

    @pytest.mark.parametrize(
        "answer",
        [
            {"value": 2.48, "unit": "m", "tolerance": 0.005, "provenance": "inferred", "decidable": True},
            {"value": 2.48, "unit": "m", "tolerance": 0.005, "provenance": "computed", "decidable": False},
            {"value": [], "unit": None, "provenance": "declared", "decidable": True},
        ],
    )
    def test_the_older_exclusions_are_untouched(self, answer):
        assert _measured_count(answer) == 0

    def test_the_gate_reaches_into_a_profile_and_a_survey(self):
        profile = {
            "element": {"globalId": "1kTv"},
            "measures": {
                "balustrade": {
                    "value": 0.9,
                    "unit": "m",
                    "tolerance": 0.01,
                    "provenance": "computed",
                    "decidable": True,
                },
                "bounds": {"value": ["a", "b"], "unit": None, "provenance": "declared", "decidable": True},
            },
        }
        assert _measured_count(profile) == 1
        survey = {
            "summary": {"kind": "spaces"},
            "results": [
                {"answer": {"value": ["a"], "unit": None, "provenance": "declared", "decidable": True}},
                {
                    "answer": {
                        "value": 2.6,
                        "unit": "m",
                        "tolerance": 0.005,
                        "provenance": "computed",
                        "decidable": True,
                    }
                },
            ],
        }
        assert _measured_count(survey) == 1


class TestTheTrailerOnlyAppearsWhereAMeasurementCould:
    PAYLOADS = {
        "briefing": {"briefing": "Zwei Geschoße, 14 Räume."},
        "find_elements": {"elements": [], "total": 0},
        "element": {"element": {"ifcType": "IfcSpace", "name": "Küche", "globalId": "1kTv"}},
        "draw": {"path": "/tmp/plan.svg", "bytes": 4096, "seconds": 0.4},
        "shopping_list": {"summary": "3 Spezifikationen.", "path": "/tmp/x.ids", "specifications": 3, "bytes": 900},
    }

    @pytest.mark.parametrize("operation", sorted(PAYLOADS))
    def test_a_non_measuring_operation_carries_no_trailer(self, operation):
        rendered = _render(operation, self.PAYLOADS[operation])
        assert MEASUREMENT_EVIDENCE_PREFIX not in rendered

    @pytest.mark.parametrize("operation", sorted(PAYLOADS))
    def test_suppressing_the_trailer_still_grants_no_grounding(self, operation):
        assert result_carries_measurement(_render(operation, self.PAYLOADS[operation])) is False

    def test_a_measuring_operation_still_states_its_count(self):
        rendered = _render(
            "measure",
            {"value": 2.48, "unit": "m", "tolerance": 0.005, "provenance": "computed", "decidable": True},
        )
        assert result_carries_measurement(rendered) is True

    def test_relations_keeps_its_trailer_on_purpose(self):
        assert "relations" not in NON_MEASURING_OPERATIONS
        assert MEASUREMENT_EVIDENCE_PREFIX in _render(
            "relations", {"value": [], "provenance": "declared", "decidable": True}
        )

    def test_every_suppressed_operation_is_a_real_operation(self):
        assert NON_MEASURING_OPERATIONS <= set(OPERATIONS)


class TestAConversationWithoutAProjectIsRefusedBeforeTheNetwork:
    def test_both_halves_of_the_bim_surface_say_the_same_thing(self):
        from agent.tools.bim.measure_register import NO_PROJECT_TEXT as measure_text
        from agent.tools.bim.register import NO_PROJECT_TEXT as query_text

        assert measure_text is query_text

    def test_it_forbids_the_retry_that_used_to_burn_the_turn(self):
        from agent.tools.bim.register import NO_PROJECT_TEXT

        assert "Do not retry" in NO_PROJECT_TEXT
        assert "no argument to this tool can fix it" in NO_PROJECT_TEXT

    def test_it_tells_the_user_what_to_actually_do(self):
        from agent.tools.bim.register import NO_PROJECT_TEXT

        assert "not attached to a project" in NO_PROJECT_TEXT
        assert "inside the project" in NO_PROJECT_TEXT
        assert "Do not state anything about the building" in NO_PROJECT_TEXT

    def test_it_is_not_the_same_message_as_a_real_rejection(self):
        from agent.tools.bim.register import NO_PROJECT_TEXT

        assert NO_PROJECT_TEXT != _rejected_text("Unrecognized key(s): 'storeys'")
        assert NO_PROJECT_TEXT != UNAVAILABLE_TEXT


class TestAModelTooBigToMeasureIsNotAnOutage:
    def test_the_ceiling_comes_from_the_memory_this_container_actually_has(self, monkeypatch):
        from agent.knowledge import ifc_spatial_client as client

        monkeypatch.delenv("BIM_SPATIAL_MAX_MODEL_BYTES", raising=False)
        monkeypatch.setattr(client, "_container_memory_bytes", lambda: 4 * 1024**3)
        assert client._derive_max_model_bytes() == (2 * 1024**3) // 20

        monkeypatch.setattr(client, "_container_memory_bytes", lambda: 512 * 1024**2)
        assert client._derive_max_model_bytes() == client._MIN_MODEL_BYTES

        monkeypatch.setattr(client, "_container_memory_bytes", lambda: 1024 * 1024**3)
        assert client._derive_max_model_bytes() == client._MAX_MODEL_BYTES_CAP

    def test_the_ratio_is_the_low_end_of_what_was_measured(self):
        from agent.knowledge.ifc_spatial_client import PARSE_FOOTPRINT_RATIO

        assert PARSE_FOOTPRINT_RATIO == 20

    def test_an_operator_who_sized_the_worker_can_override_the_arithmetic(self, monkeypatch):
        from agent.knowledge import ifc_spatial_client as client

        monkeypatch.setenv("BIM_SPATIAL_MAX_MODEL_BYTES", str(900 * 1024**2))
        assert client._derive_max_model_bytes() == 900 * 1024**2

    @pytest.mark.parametrize("value", ["", "   ", "viel", "-1", "0"])
    def test_an_unusable_override_falls_back_instead_of_crashing_the_tool(self, monkeypatch, value):
        from agent.knowledge import ifc_spatial_client as client

        monkeypatch.setenv("BIM_SPATIAL_MAX_MODEL_BYTES", value)
        monkeypatch.setattr(client, "_container_memory_bytes", lambda: 4 * 1024**3)
        assert client._derive_max_model_bytes() == (2 * 1024**3) // 20

    def test_a_cgroup_limit_wins_over_the_host(self, monkeypatch, tmp_path):
        from agent.knowledge import ifc_spatial_client as client

        limit = tmp_path / "memory.max"
        limit.write_text("2147483648\n", encoding="ascii")
        real_open = open

        def fake_open(path, *args, **kwargs):
            if path == "/sys/fs/cgroup/memory.max":
                return real_open(limit, *args, **kwargs)
            raise OSError("no such cgroup file")

        monkeypatch.setattr("builtins.open", fake_open)
        assert client._container_memory_bytes() == 2 * 1024**3

    @pytest.mark.parametrize("raw", ["max", "9223372036854771712", "nonsense"])
    def test_an_unlimited_or_unparsable_cgroup_falls_through(self, monkeypatch, tmp_path, raw):
        from agent.knowledge import ifc_spatial_client as client

        limit = tmp_path / "memory.max"
        limit.write_text(raw, encoding="ascii")
        real_open = open
        monkeypatch.setattr(
            "builtins.open",
            lambda path, *a, **k: real_open(limit, *a, **k) if "cgroup" in str(path) else real_open(path, *a, **k),
        )
        value = client._container_memory_bytes()
        assert value is None or value < (1 << 62)

    def test_the_message_is_about_the_file_and_names_both_numbers(self):
        from agent.tools.bim.measure_register import _too_large_text

        text = _too_large_text(310 * 1024 * 1024, 100 * 1024 * 1024)
        assert "310 MB" in text and "100 MB" in text
        assert "not an outage" in text and "waiting does not help" in text
        assert text != UNAVAILABLE_TEXT
        assert "ask for the limit to be raised" in text
        assert "ifc_query" in text
        assert "Do not estimate dimensions" in text

    def test_it_is_still_an_unavailable_error_so_old_handlers_hold(self):
        from agent.knowledge.bim_query import BimQueryUnavailableError
        from agent.knowledge.ifc_spatial_client import ModelTooLargeError

        error = ModelTooLargeError(310 * 1024 * 1024, 100 * 1024 * 1024)
        assert isinstance(error, BimQueryUnavailableError)
        assert error.model_bytes == 310 * 1024 * 1024
        assert "310 MB" in str(error)

    def test_an_oversized_model_is_refused_before_a_byte_is_transferred(self, monkeypatch):
        from agent.knowledge import ifc_spatial_client as client
        from agent.knowledge.ifc_spatial_client import ModelTooLargeError

        monkeypatch.setattr(
            client.urllib.request,
            "urlopen",
            lambda *a, **k: pytest.fail("the oversized model was downloaded"),
        )
        with pytest.raises(ModelTooLargeError):
            client._download("https://example.test/big.ifc", client.MAX_MODEL_BYTES + 1)


class TestAnEngineRefusalKeepsItsReason:
    SPILLED = "/tmp/ifc-spilled.ifc"  # noqa: S108

    class _Unreadable(RuntimeError):
        def __init__(self, path, reason):
            self.reason = reason
            super().__init__(f"{path}: {reason}")

    class _TooLarge(_Unreadable):
        def __init__(self, path, size, limit):
            self.size = size
            self.limit = limit
            super().__init__(path, "Diese Datei ist zu groß.")

    @pytest.fixture(autouse=True)
    def _context(self, monkeypatch):
        from agent.knowledge import ifc_spatial_client as client
        from agent.tools.bim import measure_register

        monkeypatch.setattr(measure_register, "get_organization_id_from_context", lambda: "org-1")
        monkeypatch.setattr(measure_register, "get_project_id_from_context", lambda: "proj-1")
        monkeypatch.setattr(client, "_engine", lambda: (None, []))
        monkeypatch.setattr(client, "_download", lambda *_: b"")
        monkeypatch.setattr(client, "_spill", lambda *_: self.SPILLED)
        client.reset_cache_for_tests()
        yield
        client.reset_cache_for_tests()

    def _refused_with(self, monkeypatch, cause) -> tuple[str, str]:
        import sys
        import types

        from agent.knowledge import ifc_spatial_client as client

        class ToolError(ValueError):
            pass

        def call(_tools, _name, _args):
            raise ToolError(f"Modell konnte nicht geöffnet werden: {cause}") from cause

        monkeypatch.setitem(
            sys.modules,
            "ifc_spatial.tools",
            types.SimpleNamespace(ToolError=ToolError, call=call, create_tools=lambda _cache: []),
        )
        monkeypatch.setitem(
            sys.modules,
            "ifc_spatial.model",
            types.SimpleNamespace(ModelTooLargeError=self._TooLarge, ModelUnreadableError=self._Unreadable),
        )
        source = {"resolved": True, "model": {"modelId": "m1"}, "source": {"url": "https://example.test/m.ifc"}}
        return TestTheToolBody._measure(monkeypatch, lambda *_: client.open_model(source), operation="briefing")

    def test_a_file_over_the_engines_limit_reads_as_too_large(self, monkeypatch):
        answer, outcome = self._refused_with(monkeypatch, self._TooLarge(self.SPILLED, 70 * 1024**2, 64 * 1024**2))

        assert outcome == "model_too_large"
        assert "70 MB" in answer and "64 MB" in answer
        assert "not an outage" in answer
        assert UNAVAILABLE_TEXT not in answer

    @pytest.mark.parametrize(
        "reason",
        [
            "Diese Datei ist leer (0 Bytes) — der Upload ist fehlgeschlagen.",
            "Das ist keine IFC-SPF-Datei — sie beginnt nicht mit ISO-10303-21.",
            "Diese Datei ist unvollständig: der Abschluss END-ISO-10303-21; fehlt. Sie wurde "
            "abgeschnitten — der Upload oder der Export ist abgebrochen. Eine abgeschnittene IFC-Datei "
            "bringt den Parser zum Absturz und wird deshalb gar nicht erst geöffnet; die Datei bitte "
            "vollständig neu hochladen.",
        ],
        ids=["empty", "not_ifc", "truncated"],
    )
    def test_a_file_the_engine_cannot_read_keeps_the_engines_reason(self, monkeypatch, reason):
        answer, outcome = self._refused_with(monkeypatch, self._Unreadable(self.SPILLED, reason))

        assert outcome == "model_unreadable"
        assert reason in answer
        assert "not an outage" in answer
        assert not result_carries_measurement(answer)
        assert self.SPILLED not in answer

    def test_a_reason_that_runs_on_does_not_reach_the_agent_whole(self, monkeypatch):
        answer, outcome = self._refused_with(monkeypatch, self._Unreadable(self.SPILLED, "ö" * 2_000_000))

        assert outcome == "model_unreadable"
        assert "not an outage" in answer
        assert "ö" * MAX_REASON_CHARS in answer
        assert "ö" * (MAX_REASON_CHARS + 1) not in answer
        assert len(answer) < 1_500

    @pytest.mark.parametrize(
        "cause",
        [OSError(5, "Input/output error"), MemoryError(), None],
        ids=["read_failed", "memory", "no_cause"],
    )
    def test_a_failure_that_is_not_about_the_file_still_reads_as_an_outage(self, monkeypatch, cause):
        answer, outcome = self._refused_with(monkeypatch, cause)

        assert outcome == "service_unavailable"
        assert answer == UNAVAILABLE_TEXT


class TestADownloadCutShortIsNotABrokenFile:
    @pytest.fixture()
    def serve(self):
        import http.server
        import threading

        servers = []

        def start(body: bytes, length: int | str, encoding: str = "", chunked: bool = False) -> str:
            class Handler(http.server.BaseHTTPRequestHandler):
                def do_GET(self):
                    self.send_response(200)
                    self.send_header("Content-Length", str(length))
                    if encoding:
                        self.send_header("Content-Encoding", encoding)
                    if chunked:
                        self.send_header("Transfer-Encoding", "chunked")
                    self.end_headers()
                    self.wfile.write(body)

                def log_message(self, *_args):
                    pass

            server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
            threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True).start()
            servers.append(server)
            return f"http://127.0.0.1:{server.server_address[1]}/model.ifc"

        yield start
        for server in servers:
            server.shutdown()
            server.server_close()

    @pytest.mark.parametrize("arrived", [b"", b"ISO-10303-21;\n"], ids=["nothing", "the_start"])
    def test_it_reads_as_the_outage_it_is(self, serve, arrived):
        from agent.knowledge import ifc_spatial_client as client

        with pytest.raises(BimQueryUnavailableError) as raised:
            client._download(serve(arrived, 5845))

        assert not isinstance(raised.value, ModelUnreadableError)
        assert not isinstance(raised.value, ModelTooLargeError)

    def test_a_complete_download_passes(self, serve):
        from agent.knowledge import ifc_spatial_client as client

        whole = b"ISO-10303-21;\nEND-ISO-10303-21;\n"

        assert client._download(serve(whole, len(whole))) == whole

    def test_a_compressed_download_is_measured_by_what_was_sent(self, serve):
        import gzip

        from agent.knowledge import ifc_spatial_client as client

        whole = b"ISO-10303-21;\n" * 500 + b"END-ISO-10303-21;\n"
        packed = gzip.compress(whole)

        assert client._download(serve(packed, len(packed), "gzip")) == whole
        with pytest.raises(BimQueryUnavailableError):
            client._download(serve(packed[:20], len(packed), "gzip"))

    def test_a_length_that_is_no_number_says_nothing_about_the_download(self, serve):
        from agent.knowledge import ifc_spatial_client as client

        whole = b"ISO-10303-21;\nEND-ISO-10303-21;\n"

        assert client._download(serve(whole, "²")) == whole

    def test_a_chunked_download_is_measured_by_its_chunks(self, serve):
        from agent.knowledge import ifc_spatial_client as client

        assert client._download(serve(b"5\r\nhello\r\n0\r\n\r\n", 5845, chunked=True)) == b"hello"


class TestUnavailableIsNotRejected:
    def test_the_two_messages_are_different_and_say_different_things(self):
        rejected = _rejected_text("Unrecognized key(s): 'storeys'")

        assert rejected != UNAVAILABLE_TEXT
        assert "problem with the arguments" in rejected
        assert "call the tool again" in rejected
        assert "unreachable" in UNAVAILABLE_TEXT
        assert "could not be read" in UNAVAILABLE_TEXT

    def test_neither_invites_a_statement_about_the_building(self):
        for text in (_rejected_text("nope"), UNAVAILABLE_TEXT, ENGINE_UNAVAILABLE_TEXT):
            assert "Do NOT" in text

    def test_a_missing_engine_is_not_reported_as_a_broken_model(self):
        assert "not installed" in ENGINE_UNAVAILABLE_TEXT
        assert "ifc_query" in ENGINE_UNAVAILABLE_TEXT

    def test_an_id_that_is_not_in_the_model_is_a_correctable_mistake(self):
        text = _unrunnable_text("Bauteil 0xyz ist in diesem Modell nicht enthalten")
        assert "not with the building" in text
        assert "find_elements" in text


class TestTheSourceClientDrawsTheSameDistinction:
    @pytest.fixture(autouse=True)
    def _token(self, monkeypatch):
        monkeypatch.setenv("INTERNAL_API_TOKEN", "test-token")

    @staticmethod
    def _http_error(status: int, body) -> urllib.error.HTTPError:
        payload = json.dumps(body).encode("utf-8")
        return urllib.error.HTTPError(
            "http://frontend:3000/api/internal/bim/source",
            status,
            "Bad Request",
            {},  # type: ignore[arg-type]
            io.BytesIO(payload),
        )

    def _raise(self, monkeypatch, error: Exception) -> None:
        def opener(_request, timeout=None):  # noqa: ANN001, ARG001
            raise error

        monkeypatch.setattr(
            "agent.common.bff_http._opener",
            type("O", (), {"open": staticmethod(opener)})(),
        )

    def test_a_correctable_400_is_a_rejection(self, monkeypatch):
        from agent.knowledge.bim_query import BimQueryRejectedError
        from agent.knowledge.ifc_spatial_client import resolve_model_source

        self._raise(monkeypatch, self._http_error(400, {"error": "modelName must not be empty"}))
        with pytest.raises(BimQueryRejectedError) as caught:
            resolve_model_source(organization_id="org", project_id="p", model_name=" ")
        assert "modelName" in str(caught.value)

    @pytest.mark.parametrize("status", [401, 403, 429, 500, 503])
    def test_everything_else_is_unavailable(self, monkeypatch, status):
        from agent.knowledge.bim_query import BimQueryUnavailableError
        from agent.knowledge.ifc_spatial_client import resolve_model_source

        self._raise(monkeypatch, self._http_error(status, {"error": "nope"}))
        with pytest.raises(BimQueryUnavailableError):
            resolve_model_source(organization_id="org", project_id="p")

    def test_a_missing_service_token_never_reaches_the_network(self, monkeypatch):
        from agent.knowledge.bim_query import BimQueryUnavailableError
        from agent.knowledge.ifc_spatial_client import resolve_model_source

        monkeypatch.delenv("INTERNAL_API_TOKEN", raising=False)
        with pytest.raises(BimQueryUnavailableError):
            resolve_model_source(organization_id="org", project_id="p")

    def test_a_model_is_addressed_by_project_and_file_name_never_by_uuid(self, monkeypatch):
        from agent.knowledge.ifc_spatial_client import resolve_model_source

        sent: dict = {}

        class _Response:
            def read(self):
                return b'{"resolved": false, "reason": "no_models", "message": "kein Modell"}'

            def __enter__(self):
                return self

            def __exit__(self, *_):
                return False

        def opener(request, timeout=None):  # noqa: ANN001, ARG001
            sent["url"] = request.full_url
            sent["body"] = json.loads(request.data)
            sent["headers"] = request.headers
            return _Response()

        monkeypatch.setattr(
            "agent.common.bff_http._opener",
            type("O", (), {"open": staticmethod(opener)})(),
        )

        result = resolve_model_source(organization_id="org-1", project_id="p-1", model_name="V3")

        assert sent["url"].endswith("/api/internal/bim/source")
        assert sent["body"] == {"organizationId": "org-1", "projectId": "p-1", "modelName": "V3"}
        assert "modelId" not in sent["body"]
        assert sent["headers"]["X-internal-token"] == "test-token"
        assert result["reason"] == "no_models"


class TestTheSourceIdentityDecidesWhatIsReused:
    def test_the_object_s_etag_is_preferred(self):
        from agent.knowledge.ifc_spatial_client import source_identity

        identity = source_identity(
            {"model": {"modelId": "m1", "updatedAt": "2026-05-04T09:30:15.400Z"}, "source": {"etag": "abc123"}}
        )
        assert identity == "etag:abc123"

    def test_it_falls_back_to_the_model_id_and_its_revision(self):
        from agent.knowledge.ifc_spatial_client import source_identity

        identity = source_identity(
            {"model": {"modelId": "m1", "updatedAt": "2026-05-04T09:30:15.400Z"}, "source": {"etag": None}}
        )
        assert identity == "model:m1:2026-05-04T09:30:15.400Z"

    def test_a_re_export_is_never_served_out_of_the_cache(self):
        from agent.knowledge.ifc_spatial_client import source_identity

        name = "Haus-A.ifc"
        before = {"model": {"modelId": "m1", "filename": name, "updatedAt": "2026-05-04T09:30:15.400Z"}, "source": {}}
        after = {"model": {"modelId": "m1", "filename": name, "updatedAt": "2026-08-12T07:00:00.000Z"}, "source": {}}

        assert source_identity(before) != source_identity(after)


class TestTheSameModelIsParsedOncePerProcess:
    FIXTURE = (
        pathlib.Path(__file__).resolve().parents[5] / "packages/ifc-spatial-py/tests/fixtures/Ifc4_SampleHouse.ifc"
    )

    @pytest.fixture()
    def engine(self):
        pytest.importorskip("ifc_spatial.tools", reason="the spatial engine is not installed")
        from agent.knowledge import ifc_spatial_client

        ifc_spatial_client.reset_cache_for_tests()
        yield ifc_spatial_client
        ifc_spatial_client.reset_cache_for_tests()

    @pytest.fixture()
    def served(self):
        import functools
        import http.server
        import threading

        fixture = self.FIXTURE
        if not fixture.is_file():
            pytest.skip("the sample house fixture is not in this checkout")

        handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(fixture.parent))
        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
        threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True).start()
        try:
            yield fixture, f"http://127.0.0.1:{server.server_address[1]}/{fixture.name}"
        finally:
            server.shutdown()

    def _source(self, served, etag: str = "abc123") -> dict:
        fixture, url = served
        return {
            "resolved": True,
            "model": {"modelId": "m1", "filename": fixture.name, "updatedAt": "2026-08-12T07:00:00Z"},
            "source": {"url": url, "bytes": fixture.stat().st_size, "etag": etag},
        }

    def test_a_file_url_is_never_read(self, engine, served):
        from agent.knowledge.bim_query import BimQueryUnavailableError

        fixture, _ = served
        source = self._source(served)
        source["source"]["url"] = fixture.as_uri()
        with pytest.raises(BimQueryUnavailableError):
            engine.open_model(source)

    def test_the_second_question_about_a_building_downloads_nothing(self, engine, served, monkeypatch):
        source = self._source(served)
        first = engine.open_model(source)

        monkeypatch.setattr(engine, "_download", lambda *a, **k: pytest.fail("the model was downloaded twice"))
        assert engine.open_model(source) == first

    def test_a_re_export_under_the_same_name_is_a_different_model(self, engine, served):
        source = self._source(served, etag="abc123")
        engine.open_model(source)

        moved = {**source, "source": {**source["source"], "etag": "def456"}}
        assert engine.source_identity(moved) != engine.source_identity(source)

    def test_an_operator_answers_through_the_handle(self, engine, served):
        handle = engine.open_model(self._source(served))
        found = engine.call_spatial_tool(handle, "find_elements", {"ifcType": "IfcSpace", "limit": 10})

        assert found["total"] == 4
        area = engine.call_spatial_tool(
            handle,
            "measure",
            {"globalId": found["elements"][0]["globalId"], "measure": "floorArea"},
        )
        assert area["decidable"] is True
        assert area["provenance"] == "computed"

    def test_an_id_that_is_not_in_the_model_could_not_be_looked_up(self, engine, served):
        handle = engine.open_model(self._source(served))
        with pytest.raises(engine.SpatialToolError):
            engine.call_spatial_tool(handle, "element", {"globalId": "0nichtvorhanden00000"})


class TestWhatTheTraceRecords:
    @pytest.fixture(autouse=True)
    def _clean(self):
        from agent.observability.langfuse_trace_attributes import reset_contributions

        reset_contributions()
        yield
        reset_contributions()

    @staticmethod
    def _recorded() -> dict:
        from agent.observability.langfuse_trace_attributes import _CONTRIBUTED

        return _CONTRIBUTED.get() or {"metadata": {}, "tags": []}

    def test_a_call_records_its_operation_and_its_operator(self):
        from agent.tools.bim.measure_register import _trace

        _trace("measure", "clearHeight", outcome="resolved")

        assert self._recorded()["metadata"] == {
            "ifc_op": "measure:measure",
            "ifc_outcome": "resolved",
            "ifc_measure_detail": "clearHeight",
        }
        assert self._recorded()["tags"] == ["feature:ifc"]

    def test_free_text_from_the_model_is_not_echoed_onto_the_trace(self):
        from agent.tools.bim.measure_register import _trace

        _trace("measure the Wohnzimmer of Familie Mayr", "Brandabschnitt Nord", outcome="rejected")

        recorded = self._recorded()["metadata"]
        assert recorded["ifc_op"] == "measure:unknown"
        assert "ifc_measure_detail" not in recorded
        assert "Mayr" not in str(recorded)

    def test_an_undecidable_answer_is_distinguishable_from_a_failure(self):
        from agent.tools.bim.measure_register import _trace

        _trace("measure", "sillAndHead", outcome="undecidable")
        assert self._recorded()["metadata"]["ifc_outcome"] == "undecidable"

    def test_a_transport_failure_is_not_recorded_as_an_empty_building(self):
        from agent.tools.bim.measure_register import _trace

        _trace("relations", "opensTo", outcome="service_unavailable")
        assert self._recorded()["metadata"]["ifc_outcome"] == "service_unavailable"


class TestTheDescriptionDescribesTheRealTool:
    @staticmethod
    def _description_and_parameters() -> tuple[str, list[str]]:
        from agent.tools.bim.measure_register import _TOOL_DESCRIPTION
        from agent.tools.bim.measure_register import IfcMeasureInput

        return _TOOL_DESCRIPTION, list(IfcMeasureInput.model_fields)

    def test_every_argument_the_description_shows_being_set_exists(self):
        import re

        description, parameters = self._description_and_parameters()
        shown = set(re.findall(r"\b([a-z][a-z0-9_]{2,})\s*=", description))

        assert shown, "the invariant is vacuous if the description shows no arguments at all"
        assert sorted(shown - set(parameters)) == []

    def test_every_argument_a_field_description_shows_being_set_exists(self):
        import re

        from agent.tools.bim.measure_register import IfcMeasureInput

        fields = set(IfcMeasureInput.model_fields)
        shown = {
            name
            for field in IfcMeasureInput.model_fields.values()
            for name in re.findall(r"\b([a-z][a-z0-9_]{2,})\s*=", field.description or "")
        }

        assert shown, "the invariant is vacuous if no field description shows an argument at all"
        assert sorted(shown - fields) == []

    def test_every_schema_field_is_read_by_the_dispatch(self):
        import inspect
        import re

        from agent.tools.bim import measure_register
        from agent.tools.bim.measure_register import IfcMeasureInput

        source = inspect.getsource(measure_register)
        builders = source[source.index("def _selection_args") : source.index("def _refusal")]
        read = set(re.findall(r"\b(?:a|arguments)\.([a-z_]+)", builders))
        assert set(IfcMeasureInput.model_fields) - read == {"model_name"}

    def test_every_operation_it_names_is_one_the_tool_accepts(self):
        import re

        from agent.tools.bim.measure_register import VALID_OPERATIONS

        description, _ = self._description_and_parameters()
        named = set(re.findall(r"'([a-z_]+)'\s+—", description))

        assert named, "the invariant is vacuous if the description names no operations"
        assert named <= VALID_OPERATIONS

    def test_it_tells_the_agent_to_call_the_briefing_first(self):
        description, _ = self._description_and_parameters()

        assert "CALL 'briefing' FIRST" in description
        assert "copied verbatim" in description
        assert "BLIND" in description

    def test_it_teaches_the_three_provenances_as_three_german_sentences(self):
        description, _ = self._description_and_parameters()

        assert "declared" in description
        assert "gemessen" in description
        assert "vermutlich" in description
        assert "NEVER write a computed number as something the model states" in description

    def test_it_explains_that_undecidable_is_about_the_export(self):
        description, _ = self._description_and_parameters()

        assert "'decidable: false' is NOT an error" in description
        assert "missing.remedy" in description
        assert "what the architect changes in their CAD" in description

    def test_it_forbids_arithmetic_and_reading_numbers_off_a_drawing(self):
        description, _ = self._description_and_parameters()

        assert "NEVER recompute, round, convert or extrapolate" in description
        assert "NEVER read a measurement off a" in description

    def test_it_states_what_the_expensive_calls_cost_before_they_are_made(self):
        description, _ = self._description_and_parameters()

        assert "COST" in description
        assert "opensTo" in description
        assert "speculatively" in description

    def test_it_says_which_tool_the_metadata_questions_belong_to(self):
        description, _ = self._description_and_parameters()

        assert "NOT a replacement for ifc_query" in description
        assert "Reach for it first" in description


class TestTheRefusalPutsTheEnginesPhraseAfterAColon:
    @staticmethod
    def _line(what: str) -> str:
        return _provenance_line({"decidable": False, "missing": {"what": what, "remedy": "R"}})

    @pytest.mark.parametrize(
        "what",
        [
            "keine IfcSpace-Elemente",
            "keine Nordrichtung",
            "kein auswertbares Prisma: halfSpaces fehlt",
            "keiner der Rasterpunkte liegt im Raumkörper",
            "Keine Georeferenzierung",
            "IfcGeometricRepresentationContext.TrueNorth",
            "Pset_WindowCommon.SillHeight",
            "Körpergeometrie für IfcWall „Aussenwand“",
            "die Bodenfläche des Raums",
        ],
    )
    def test_the_phrase_is_quoted_after_a_colon_whatever_its_grammar(self, what: str) -> None:
        line = self._line(what)
        assert f"missing: {what}." in line
        assert line.startswith("UNDECIDABLE:")

    def test_the_finding_is_still_about_the_export_either_way(self) -> None:
        for what in ("keine Nordrichtung", "Pset_WindowCommon.SillHeight"):
            line = self._line(what)
            assert "finding about the EXPORT" in line
            assert "Remedy: R" in line


class TestAWrongOperatorIsNotAWrongId:
    WRONG_KIND = (
        "clearOpeningWidth() erwartet eine Öffnung, ein Fenster oder eine Tür — IfcPlate "
        "(GlobalId 3cUkl32) ist das nicht. Das ist ein Fehler im Aufruf, kein Befund über den "
        "Export: an dieser Datei ist nichts zu ändern. für eine Wand: hosts()"
    )

    def test_a_wrong_kind_does_not_send_the_agent_back_to_find_elements(self) -> None:
        text = _unrunnable_text(self.WRONG_KIND)
        assert "The GlobalId is fine" in text
        assert "Do not look the id up again" in text
        assert "find_elements" not in text

    def test_an_unknown_id_still_does(self) -> None:
        text = _unrunnable_text("Unbekannte GlobalId 0abcdefg in diesem Modell")
        assert "check the GlobalId with operation='find_elements'" in text

    def test_both_say_it_is_the_arguments_and_not_the_building(self) -> None:
        for reason in (self.WRONG_KIND, "Unbekannte GlobalId 0abcdefg"):
            text = _unrunnable_text(reason)
            assert text.startswith("Error:")
            assert "finding about the EXPORT" not in text


class TestOIB6ReachesTheModel:
    def test_the_operation_dispatches_to_the_engine_tool(self):
        assert _build_call(operation="envelope", kind="compactness") == ("envelope", {"what": "compactness"})

    def test_the_aspect_is_matched_case_insensitively(self):
        assert _build_call(operation="envelope", kind="AREABYORIENTATION") == (
            "envelope",
            {"what": "areaByOrientation"},
        )

    def test_it_defaults_to_the_envelope_itself(self):
        assert _build_call(operation="envelope") == ("envelope", {"what": "thermalEnvelope"})

    def test_an_unknown_aspect_names_the_ones_that_exist(self):
        answer = _build_call(operation="envelope", kind="uWert")
        assert isinstance(answer, str) and "thermalEnvelope" in answer

    def test_a_global_id_is_not_forwarded(self):
        _, args = _build_call(operation="envelope", kind="compactness", global_id="3cUkl32yn9qRSPvBJVyWw5")
        assert args == {"what": "compactness"}


class TestARatioDoesNotInheritAnAreaTolerance:
    @staticmethod
    def _answer():
        return {
            "decidable": True,
            "provenance": "computed",
            "tolerance": 2.3,
            "unit": "m²",
            "value": {
                "opaque": 185.850015,
                "transparent": 39.85055,
                "windowWallRatio": 0.176564,
                "byOrientation": {"N": {"total": 33.982401, "windowWallRatio": 0.193455}},
            },
        }

    def test_the_ratio_survives_at_every_nesting_depth(self):
        text = "\n".join(_render_answer(self._answer()))
        assert "windowWallRatio=0.18" in text
        assert "windowWallRatio=0.19" in text
        assert "windowWallRatio=0," not in text and "windowWallRatio=0\n" not in text

    def test_the_areas_still_follow_their_own_band(self):
        text = "\n".join(_render_answer(self._answer()))
        assert "opaque=186" in text and "transparent=40" in text

    def test_a_ratio_that_carries_a_unit_keeps_its_own_precision(self):
        text = "\n".join(
            _render_answer(
                {
                    "decidable": True,
                    "provenance": "computed",
                    "tolerance": 0.021,
                    "unit": "1/m",
                    "value": {"ratio": 0.846182, "characteristicLength": 1.181779},
                }
            )
        )
        assert "ratio=0.85" in text


class TestTheDoorGraphRendersAsDoorsAndNotAsCounts:
    GRAPH = {
        "value": {
            "nodes": [
                {"globalId": "r1", "ifcType": "IfcSpace", "name": "Wohnen"},
                {"globalId": "r2", "ifcType": "IfcSpace", "name": "Dachraum"},
                {"globalId": "AUSSEN", "ifcType": "outside", "name": "Freie (außerhalb des Gebäudes)"},
            ],
            "edges": [
                {
                    "globalId": "d1",
                    "name": "Haustür",
                    "ifcType": "IfcDoor",
                    "connects": ["r1", "AUSSEN"],
                    "length": 3.2,
                    "external": True,
                    "via": "geom.tree.select",
                }
            ],
            "undetermined": [
                {
                    "globalId": "d2",
                    "name": "Zimmertür",
                    "ifcType": "IfcDoor",
                    "why": "Körpergeometrie fehlt",
                    "remedy": "mit Körpergeometrie exportieren",
                }
            ],
            "excluded": [
                {
                    "globalId": "d3",
                    "name": "Bodenluke",
                    "ifcType": "IfcDoor",
                    "why": "PredefinedType = TRAPDOOR: nicht begehbar",
                }
            ],
            "buildSeconds": 1.005,
        },
        "unit": None,
        "tolerance": None,
        "provenance": "computed",
        "from": ["r1", "r2", "d1"],
        "method": "doorGraph()",
        "decidable": True,
        "caveat": "Der Graph kennt ausschließlich Türen.",
    }

    def _text(self) -> str:
        return "\n".join(_render_answer(json.loads(json.dumps(self.GRAPH))))

    def test_the_headline_counts_rooms_doors_and_exits(self):
        assert "2 rooms, 1 door connection, of which 1 to the outside" in self._text()

    def test_a_room_with_no_door_edge_is_named(self):
        text = self._text()
        assert "NO door edge" in text and "Dachraum" in text
        assert "no exit" in text

    def test_an_unresolved_door_is_named_with_its_reason(self):
        text = self._text()
        assert "UNDETERMINED" in text and "Zimmertür" in text and "Körpergeometrie fehlt" in text

    def test_a_deliberately_excluded_door_is_named_too(self):
        text = self._text()
        assert "NOT counted as an edge" in text and "Bodenluke" in text and "TRAPDOOR" in text

    def test_the_counts_alone_never_stand_in_for_the_lists(self):
        assert "unbestimmt=1 Eintrag" not in self._text()

    def test_the_caveat_and_the_method_still_travel(self):
        text = self._text()
        assert "Note: Der Graph kennt ausschließlich Türen." in text
        assert "Method: doorGraph()" in text


class TestRenderingASurvey:
    SURVEY = {
        "measure": "clearHeight",
        "results": [
            {
                "globalId": "3UEb2iq7D2tOgbX6Mufs$X",
                "name": "Seminarraum",
                "storey": "Keller",
                "answer": {"value": 2.7, "unit": "m", "tolerance": 0.005, "decidable": True},
            },
            {
                "globalId": "3Gz7u_d1P7IA35Wmtg48Rc",
                "name": "Flur Keller Treppe",
                "storey": "Keller",
                "answer": {"value": 0.2497, "unit": "m", "tolerance": 0.005, "decidable": True},
            },
            {
                "globalId": "0V74RtuUH1zQt_CcawQbBc",
                "name": "Technikraum I",
                "storey": "Keller",
                "answer": {
                    "decidable": False,
                    "missing": {"what": "auswertbare Körpergeometrie", "remedy": "als Solid exportieren"},
                },
            },
        ],
        "summary": {
            "measured": 2,
            "of": 3,
            "undecidable": [{"globalId": "0V74RtuUH1zQt_CcawQbBc", "name": "Technikraum I"}],
            "min": 0.2497,
            "max": 2.7,
            "spread": 2.4503,
            "provenance": {"computed": 2},
        },
    }

    def _text(self, **overrides):
        payload = {**self.SURVEY, **overrides}
        return _render("survey", payload)

    def test_the_spread_is_stated_before_any_single_room(self):
        text = self._text()
        head = text.splitlines()[0]
        assert "2.450" in head and "0.250" in head and "2.700" in head
        assert head.index("spread") < text.index("Seminarraum")

    def test_the_outlier_is_named_not_just_identified(self):
        text = self._text()
        assert "Flur Keller Treppe (Keller): 0.250 m" in text
        assert "3Gz7u_d1P7IA35Wmtg48Rc" not in text

    def test_a_room_that_could_not_be_measured_is_never_folded_into_the_others(self):
        text = self._text()
        assert "Technikraum I (Keller): UNDECIDABLE" in text
        assert "1 element could not be measured" in text
        assert "wie die anderen" in text

    def test_the_agreement_line_counts_correctly_in_german(self):
        assert "1 element could" in self._text()
        many = self._text(
            summary={**self.SURVEY["summary"], "undecidable": [{"name": "A"}, {"name": "B"}]},
        )
        assert "2 elements could" in many

    def test_a_truncated_survey_says_the_spread_covers_only_a_slice(self):
        text = self._text(
            truncated=True,
            hint="200 Bauteile passen zur Auswahl, gemessen wurden die ersten 50.",
            summary={**self.SURVEY["summary"], "selected": 200},
        )
        assert "ONLY this selection" in text
        assert "200 Bauteile passen" in text

    def test_a_declared_computed_conflict_is_reported_as_an_export_defect(self):
        text = self._text(
            summary={**self.SURVEY["summary"], "disagree": [{"name": "Seminarraum", "globalId": "x"}]},
        )
        assert "CONTRADICTION" in text and "Seminarraum" in text
        assert "about the export, not about the building" in text

    def test_a_survey_that_measured_nothing_does_not_lecture_about_a_spread(self):
        text = self._text(
            results=[],
            summary={"measured": 0, "of": 0, "undecidable": []},
            hint="Kein Bauteil passt zu dieser Auswahl.",
        )
        assert "Die Spanne ist die Aussage" not in text
        assert "Kein Bauteil passt" in text

    def test_the_raw_dict_shape_never_reaches_the_reader(self):
        text = self._text()
        assert "results=" not in text and "summary=" not in text and "Einträge" not in text


class TestOperationsThatNeedNoSubject:
    SUBJECTLESS = [
        ("find_elements", {"ifc_type": "IfcSpace"}),
        ("survey", {"measure": "clearHeight", "ifc_type": "IfcSpace", "storey": "Keller"}),
        ("draw", {"storey": "Keller"}),
        ("briefing", {}),
        ("storey_heights", {}),
    ]

    @pytest.mark.parametrize("operation,extra", SUBJECTLESS)
    def test_it_dispatches_without_a_global_id(self, operation, extra):
        built = _build_call(operation=operation, **extra)
        assert isinstance(built, tuple), (
            f"'{operation}' takes a selection, not a subject, and came back as the string {built!r}. "
            "Its branch is below the `if not subject` guard in `_build_call`."
        )
        assert built[0] == operation

    def test_survey_carries_the_whole_selection_through(self):
        name, args = _build_call(operation="survey", measure="clearHeight", ifc_type="IfcSpace", storey="Keller")
        assert name == "survey"
        assert args["measure"] == "clearHeight"
        assert args["ifcType"] == "IfcSpace"
        assert args["storey"] == "Keller"

    def test_an_unknown_measure_is_still_refused_by_name(self):
        answer = _build_call(operation="survey", measure="raumhoehe", ifc_type="IfcSpace")
        assert isinstance(answer, str) and "raumhoehe" in answer and "clearHeight" in answer


class TestTheSchemaIsWhatTheModelActuallySees:
    @staticmethod
    def _wire_schema() -> dict:
        import asyncio
        from unittest.mock import MagicMock

        from langchain_core.tools.structured import StructuredTool
        from langchain_core.utils.function_calling import convert_to_openai_tool

        from agent.tools.bim.measure_register import IfcMeasureConfig
        from agent.tools.bim.measure_register import ifc_measure

        async def build() -> dict:
            async with ifc_measure(IfcMeasureConfig(), MagicMock()) as info:
                assert info.input_schema is not None, "NAT kept no input schema at all"
                tool = StructuredTool.from_function(
                    coroutine=info.single_fn,
                    func=lambda **_: None,
                    name="ifc_measure",
                    description=info.description,
                    args_schema=info.input_schema,
                )
                return convert_to_openai_tool(tool)["function"]["parameters"]

        return asyncio.run(build())

    @staticmethod
    def _enum(field: dict) -> list[str] | None:
        if "enum" in field:
            return list(field["enum"])
        for branch in field.get("anyOf", []):
            if "enum" in branch:
                return list(branch["enum"])
        return None

    def test_the_enums_reach_the_wire_and_are_the_engine_s_own(self):
        from agent.tools.bim.measure_register import ENVELOPE_ASPECTS
        from agent.tools.bim.measure_register import FIRE_ASPECTS
        from agent.tools.bim.measure_register import KINDS
        from agent.tools.bim.measure_register import MEASURES
        from agent.tools.bim.measure_register import OPERATIONS
        from agent.tools.bim.measure_register import PROFILE_KINDS
        from agent.tools.bim.measure_register import RELATIONS
        from agent.tools.bim.measure_register import ROOM_KINDS

        properties = self._wire_schema()["properties"]

        assert self._enum(properties["operation"]) == list(OPERATIONS)
        assert self._enum(properties["measure"]) == list(MEASURES)
        assert self._enum(properties["relation"]) == list(RELATIONS)
        assert self._enum(properties["room_kind"]) == list(ROOM_KINDS)
        assert self._enum(properties["kind"]) == [
            *KINDS,
            *FIRE_ASPECTS,
            *ENVELOPE_ASPECTS,
            *PROFILE_KINDS,
        ]

    def test_the_enum_order_does_not_depend_on_string_hashing(self):
        from agent.tools.bim import measure_register

        for name in (
            "OPERATIONS",
            "MEASURES",
            "RELATIONS",
            "ROOM_KINDS",
            "KINDS",
            "FIRE_ASPECTS",
            "ENVELOPE_ASPECTS",
            "PROFILE_KINDS",
        ):
            vocabulary = getattr(measure_register, name)
            assert isinstance(vocabulary, (tuple, list, dict)), (name, type(vocabulary))

    def test_every_parameter_carries_its_own_description(self):
        properties = self._wire_schema()["properties"]
        undescribed = sorted(name for name, field in properties.items() if not field.get("description"))
        assert undescribed == []

    def test_the_operation_is_required_and_nothing_else_is(self):
        assert self._wire_schema()["required"] == ["operation"]

    def test_the_measure_vocabulary_travels_with_its_meanings(self):
        description = self._wire_schema()["properties"]["measure"]["description"]

        assert "lichte Raumhöhe" in description
        assert "NOT the height of the space solid" in description
        for name in ("clearHeight", "turningCircle", "egressPath"):
            assert f"{name} —" in description

    def test_the_overloaded_fields_say_which_operations_they_belong_to(self):
        properties = self._wire_schema()["properties"]

        for operation in ("distance", "view"):
            assert f"'{operation}'" in properties["mode"]["description"]
        for operation in ("find_elements", "fire", "envelope", "element_profile"):
            assert f"'{operation}'" in properties["kind"]["description"]
        for operation in ("distance", "clearance", "overhang", "light_incidence"):
            assert f"'{operation}'" in properties["other_global_id"]["description"]

    def test_a_list_of_global_ids_is_expressible_as_a_real_array(self):
        branches = self._wire_schema()["properties"]["global_id"]["anyOf"]

        assert {"type": "string"} in branches
        assert {"type": "array", "items": {"type": "string"}} in branches

    def test_no_enum_value_or_description_offers_the_model_a_verdict(self):
        import json

        properties = self._wire_schema()["properties"]
        schema = json.dumps(properties, ensure_ascii=False)

        for name, field in properties.items():
            for value in self._enum(field) or []:
                assert not any(
                    word in value.lower() for word in ("erfuellt", "erfüllt", "compliant", "zulaessig", "conform")
                ), f"{name} offers the model a verdict: {value!r}"

        for word in ("erfüllt", "compliant", "zulässig", "Grenzwert", "mindestens", "höchstens zulässig"):
            assert word not in schema, f"the input schema applies a clause: {word!r}"

        assert "Gebäudeklasse" in schema, "the sentence that refuses the class went missing"
        assert "Returns a HEIGHT and never a class" in schema
        assert schema.count("Applies no threshold") == 2


class TestAMalformedCallIsRefusedBeforeTheToolRuns:
    @staticmethod
    def _model():
        from agent.tools.bim.measure_register import IfcMeasureInput

        return IfcMeasureInput

    def test_an_operation_that_does_not_exist_never_reaches_the_tool(self):
        import pydantic

        with pytest.raises(pydantic.ValidationError) as refused:
            self._model()(operation="measure_room", global_id="1kTv")

        assert "storey_heights" in str(refused.value)

    def test_a_measure_that_does_not_exist_never_reaches_the_tool(self):
        import pydantic

        with pytest.raises(pydantic.ValidationError):
            self._model()(operation="measure", global_id="1kTv", measure="wandstaerke")

    @pytest.mark.parametrize(
        "field,value",
        [
            ("relation", "borders"),
            ("kind", "raum"),
            ("room_kind", "wohnraum"),
            ("mode", "clear"),
        ],
    )
    def test_every_other_vocabulary_is_closed_too(self, field, value):
        import pydantic

        with pytest.raises(pydantic.ValidationError):
            self._model()(operation="find_elements", **{field: value})

    def test_a_call_that_decided_nothing_is_refused(self):
        import pydantic

        with pytest.raises(pydantic.ValidationError) as refused:
            self._model()()

        assert "operation" in str(refused.value)

    def test_a_batch_too_big_for_the_engine_is_refused_before_the_download(self):
        import pydantic

        from agent.tools.bim.measure_register import MAX_BATCH

        ids = ",".join(f"id{n}" for n in range(MAX_BATCH + 1))
        with pytest.raises(pydantic.ValidationError) as refused:
            self._model()(operation="measure", measure="floorArea", global_id=ids)

        assert str(MAX_BATCH) in str(refused.value)
        assert "survey" in str(refused.value)

    def test_the_batch_ceiling_is_not_invented_for_the_other_list_operations(self):
        ids = [f"id{n}" for n in range(80)]
        assert self._model()(operation="view", global_id=ids).global_id.count(",") == 79

    def test_an_angle_outside_the_prism_is_refused_at_the_boundary(self):
        import pydantic

        with pytest.raises(pydantic.ValidationError):
            self._model()(operation="light_incidence", global_id="1kTv", angle_deg=120.0)

    @pytest.mark.parametrize("angle", [0.0, 90.0])
    def test_the_schema_bounds_are_the_bounds_the_tool_actually_accepts(self, angle):
        import pydantic

        with pytest.raises(pydantic.ValidationError):
            self._model()(operation="light_incidence", global_id="1kTv", angle_deg=angle)

    def test_an_absent_angle_is_absent_and_not_zero(self):
        model = self._model()(operation="light_incidence", global_id="1kTv", angle_deg=45.0, swivel_deg=0.0)
        assert model.angle_deg == 45.0
        assert model.swivel_deg == 0.0
        assert self._model()(operation="briefing").angle_deg is None

    def test_a_name_this_surface_does_not_have_still_reaches_the_backlog(self, monkeypatch):
        import pydantic

        recorded = self._gaps_recorded_by(
            monkeypatch, pydantic, operation="measure", global_id="1kTv", measure="wandstaerke"
        )

        assert [entry["asked_for"] for entry in recorded] == ["wandstaerke"]
        assert recorded[0]["field"] == "measure"

    def test_a_bad_kind_is_recorded_against_the_vocabulary_its_operation_uses(self, monkeypatch):
        import pydantic

        recorded = self._gaps_recorded_by(monkeypatch, pydantic, operation="fire", kind="brandabschnitt")

        assert recorded[0]["field"] == "fire.kind"

    @staticmethod
    def _gaps_recorded_by(monkeypatch, pydantic, **arguments) -> list[dict]:
        from agent.tools.bim import measure_register

        recorded: list[dict] = []
        monkeypatch.setattr(measure_register, "record_gap", lambda **kwargs: recorded.append(kwargs))
        with pytest.raises(pydantic.ValidationError):
            measure_register.IfcMeasureInput(**arguments)
        return recorded


class TestEveryWellFormedCallStillDispatchesIdentically:
    CALLS = [
        (
            {"operation": "briefing"},
            ("briefing", {"format": "text"}),
        ),
        (
            {"operation": "find_elements", "ifc_type": "IfcSpace", "storey": "Keller", "kind": "space"},
            ("find_elements", {"limit": 50, "ifcType": "IfcSpace", "storey": "Keller", "kind": "space"}),
        ),
        (
            {"operation": "element", "global_id": "1kTv"},
            ("element", {"globalId": "1kTv"}),
        ),
        (
            {"operation": "relations", "global_id": "1kTv", "relation": "opensTo"},
            ("relations", {"globalId": "1kTv", "relation": "opensTo"}),
        ),
        (
            {"operation": "measure", "global_id": "1kTv", "measure": "clearHeight"},
            ("measure", {"globalId": "1kTv", "measure": "clearHeight"}),
        ),
        (
            {"operation": "survey", "measure": "clearHeight", "ifc_type": "IfcSpace", "storey": "Keller"},
            ("survey", {"measure": "clearHeight", "limit": 50, "ifcType": "IfcSpace", "storey": "Keller"}),
        ),
        (
            {"operation": "element_profile", "global_id": "1kTv", "kind": "expensive"},
            ("element_profile", {"globalId": "1kTv", "include": "expensive"}),
        ),
        (
            {"operation": "distance", "global_id": "a", "other_global_id": "b", "mode": "horizontal"},
            ("distance", {"a": "a", "b": "b", "mode": "horizontal"}),
        ),
        (
            {"operation": "clearance", "global_id": "a", "other_global_id": "b"},
            ("clearance", {"a": "a", "b": "b"}),
        ),
        (
            {"operation": "sun_position", "when": "2026-06-21T12:00:00+02:00"},
            ("sun_position", {"when": "2026-06-21T12:00:00+02:00"}),
        ),
        (
            {"operation": "storey_heights"},
            ("storey_heights", {}),
        ),
        (
            {"operation": "room_inventory", "room_kind": "habitable_room"},
            ("room_inventory", {"kind": "habitable_room"}),
        ),
        (
            {"operation": "draw", "storey": "Keller", "ifc_type": "IfcWall"},
            ("draw", {"storey": "Keller", "include": ["IfcWall"]}),
        ),
        (
            {"operation": "shopping_list"},
            ("shopping_list", {}),
        ),
        (
            {"operation": "fire", "kind": "compartmentArea", "global_id": "a,b"},
            ("fire", {"what": "compartmentArea", "globalId": "a,b"}),
        ),
        (
            {"operation": "envelope", "kind": "compactness"},
            ("envelope", {"what": "compactness"}),
        ),
        (
            {"operation": "overhang", "global_id": "roof", "other_global_id": "wall"},
            ("overhang", {"projecting": "roof", "facade": "wall"}),
        ),
        (
            {
                "operation": "light_incidence",
                "global_id": "win",
                "other_global_id": "wall,roof",
                "angle_deg": 45.0,
                "swivel_deg": 30.0,
            },
            ("light_incidence", {"globalId": "win", "angle": 45.0, "swivel": 30.0, "exclude": ["wall", "roof"]}),
        ),
        (
            {"operation": "view", "global_id": "1kTv", "mode": "only"},
            ("view", {"only": ["1kTv"]}),
        ),
    ]

    @staticmethod
    def _dispatch(**arguments):
        from agent.tools.bim.measure_register import IfcMeasureInput

        parsed = IfcMeasureInput(**arguments)
        return _build_call(
            operation=parsed.operation,
            global_id=str(parsed.global_id),
            other_global_id=str(parsed.other_global_id),
            relation=parsed.relation or "",
            measure=parsed.measure or "",
            mode=parsed.mode or "",
            ifc_type=parsed.ifc_type,
            name_contains=parsed.name_contains,
            storey=parsed.storey,
            kind=parsed.kind or "",
            room_kind=parsed.room_kind or "",
            limit=parsed.limit if parsed.limit and parsed.limit > 0 else 50,
            angle_deg=parsed.angle_deg,
            swivel_deg=parsed.swivel_deg,
            when=parsed.when,
        )

    @pytest.mark.parametrize("arguments,expected", CALLS, ids=[row[0]["operation"] for row in CALLS])
    def test_the_engine_call_is_unchanged(self, arguments, expected):
        assert self._dispatch(**arguments) == expected

    def test_a_zero_angle_survives_the_dispatch_and_is_not_read_as_absent(self):
        base = {"operation": "light_incidence", "global_id": "1" * 22, "angle_deg": 45.0}
        _, args = self._dispatch(**base, swivel_deg=0.0)

        assert args["swivel"] == 0.0, "0° is a measurement, not a question never asked"
        assert args["angle"] == 45.0
        _, without = self._dispatch(**base)
        assert "swivel" not in without

    def test_every_operation_is_covered_by_a_row(self):
        from agent.tools.bim.measure_register import VALID_OPERATIONS

        assert {row[0]["operation"] for row in self.CALLS} == set(VALID_OPERATIONS)

    def test_an_array_of_ids_and_the_comma_string_are_the_same_call(self):
        assert self._dispatch(operation="view", global_id=["a", "b"]) == self._dispatch(
            operation="view", global_id="a, b"
        )

    def test_a_view_without_a_mode_finally_reaches_the_engine(self):
        assert self._dispatch(operation="view", global_id="1kTv") == ("view", {"highlight": ["1kTv"]})

    def test_a_kind_the_operation_ignores_is_not_filed_as_a_missing_capability(self, monkeypatch):
        from agent.tools.bim import measure_register

        recorded: list[dict] = []
        monkeypatch.setattr(measure_register, "record_gap", lambda **kwargs: recorded.append(kwargs))

        parsed = measure_register.IfcMeasureInput(operation="element_profile", global_id="1kTv", kind="space")

        assert parsed.kind == "space"
        assert recorded == []

    @pytest.mark.parametrize(
        "field,written,canonical",
        [
            ("operation", "Briefing", "briefing"),
            ("kind", "Compactness", "compactness"),
            ("kind", "ESCAPE_LEVEL", "escape_level"),
            ("room_kind", "Habitable_Room", "habitable_room"),
            ("mode", "Horizontal", "horizontal"),
        ],
    )
    def test_the_case_the_tool_always_tolerated_is_still_tolerated(self, field, written, canonical):
        from agent.tools.bim.measure_register import IfcMeasureInput

        arguments = {"operation": "envelope"} | {field: written}
        assert getattr(IfcMeasureInput(**arguments), field) == canonical


class TestTheLooseSeamMeansWhatTheWireMeans:
    def test_an_empty_string_is_not_given(self):
        assert _build_call(operation="briefing", relation="", measure="", mode="", kind="", room_kind="") == (
            "briefing",
            {"format": "text"},
        )

    def test_a_missing_enum_names_the_operation_that_needs_it(self):
        answer = _build_call(operation="measure", global_id="1kTv")
        assert answer.startswith("Error: operation 'measure' needs 'measure'")
        assert "clearHeight" in answer

    def test_a_negative_limit_is_clamped_to_one_row_not_to_the_default(self):
        _, args = _build_call(operation="find_elements", limit=-3)
        assert args["limit"] == 1


class TestAPayloadNobodyRendersIsABug:
    def test_an_unknown_payload_shape_raises_rather_than_dumping_the_dict(self):
        with pytest.raises(TypeError, match="no renderer"):
            _render("relations", {"unexpected": "shape"})


class TestTheToolBody:
    @pytest.fixture(autouse=True)
    def _context(self, monkeypatch):
        from agent.tools.bim import measure_register

        monkeypatch.setattr(measure_register, "get_organization_id_from_context", lambda: "org-1")
        monkeypatch.setattr(measure_register, "get_project_id_from_context", lambda: "proj-1")

    @staticmethod
    def _measure(monkeypatch, run, **arguments) -> tuple[str, str]:
        import asyncio

        from agent.observability.langfuse_trace_attributes import _CONTRIBUTED
        from agent.observability.langfuse_trace_attributes import reset_contributions
        from agent.tools.bim import measure_register

        monkeypatch.setattr(measure_register, "_run", run)

        async def body() -> tuple[str, str]:
            reset_contributions()
            answer = await measure_register._measure(measure_register.IfcMeasureInput(**arguments), 50)
            return answer, (_CONTRIBUTED.get() or {"metadata": {}})["metadata"].get("ifc_outcome", "")

        return asyncio.run(body())

    def test_no_project_is_refused_and_traced_before_the_model_is_touched(self, monkeypatch):
        from agent.tools.bim import measure_register
        from agent.tools.bim.register import NO_PROJECT_TEXT

        monkeypatch.setattr(measure_register, "get_project_id_from_context", lambda: None)
        assert self._measure(monkeypatch, lambda *_: pytest.fail("ran"), operation="briefing") == (
            NO_PROJECT_TEXT,
            "no_project",
        )

    def test_a_call_the_builder_refuses_is_traced_as_rejected(self, monkeypatch):
        answer, outcome = self._measure(monkeypatch, lambda *_: pytest.fail("ran"), operation="measure")
        assert answer.startswith("Error:")
        assert outcome == "rejected"

    @pytest.mark.parametrize(
        "raised,outcome,expected",
        [
            (BimQueryRejectedError("nope"), "rejected", "problem with the arguments"),
            (ModelTooLargeError(900 * 1024**2, 512 * 1024**2), "model_too_large", "too large"),
            (ModelUnreadableError("Diese Datei ist leer."), "model_unreadable", "Diese Datei ist leer."),
            (BimQueryUnavailableError("down"), "service_unavailable", UNAVAILABLE_TEXT),
            (SpatialEngineUnavailableError(), "engine_unavailable", ENGINE_UNAVAILABLE_TEXT),
            (SpatialToolError("Bauteil 0xyz nicht enthalten"), "rejected", "find_elements"),
        ],
        ids=["rejected", "too_large", "unreadable", "unavailable", "no_engine", "unrunnable"],
    )
    def test_every_engine_failure_maps_to_its_own_sentence_and_outcome(self, monkeypatch, raised, outcome, expected):

        def run(*_):
            raise raised

        answer, traced = self._measure(monkeypatch, run, operation="briefing")
        assert expected in answer
        assert traced == outcome

    def test_an_unresolved_model_is_rendered_and_traced_with_its_reason(self, monkeypatch):
        source = {"resolved": False, "reason": "ambiguous", "message": "Mehrere Modelle.", "models": []}
        assert self._measure(monkeypatch, lambda *_: (source, None, ""), operation="briefing") == (
            "Mehrere Modelle.",
            "unresolved:ambiguous",
        )

    def test_a_resolved_answer_is_rendered_with_the_trailer(self, monkeypatch):
        source = {"resolved": True, "model": {"filename": "haus.ifc"}}
        payload = {"decidable": True, "provenance": "computed", "value": 2.7, "unit": "m", "tolerance": 0.005}
        answer, outcome = self._measure(
            monkeypatch,
            lambda *_: (source, payload, "abc"),
            operation="measure",
            global_id="1kTv",
            measure="clearHeight",
        )
        assert answer.startswith("Model: haus.ifc · handle abc\ngemessen (±0.005 m): 2.700 m")
        assert result_carries_measurement(answer)
        assert outcome == "resolved"
