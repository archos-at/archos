from __future__ import annotations

import pytest

from agent.tools.bim.query_build import _build_query
from agent.tools.bim.query_render import _element_link
from agent.tools.bim.query_render import _render


def build(**overrides):
    defaults = dict(
        operation="overview",
        filters="",
        metric="count",
        quantity="",
        group_by="",
        global_id="",
        ifc_type="",
        limit=25,
    )
    defaults.update(overrides)
    return _build_query(**defaults)


class TestBuildQuery:
    def test_overview_and_types_need_nothing_else(self):
        assert build(operation="overview") == {"op": "overview"}
        assert build(operation="types") == {"op": "types"}

    def test_unknown_operation_is_refused_by_name(self):
        result = build(operation="count_walls")
        assert isinstance(result, str)
        assert "unknown operation" in result
        assert "aggregate" in result

    def test_filters_are_parsed_from_json(self):
        result = build(operation="elements", filters='{"ifcTypes": ["IfcWall"]}')
        assert result == {"op": "elements", "filter": {"ifcTypes": ["IfcWall"]}, "limit": 25, "offset": 0}

    def test_malformed_filters_fail_loudly_rather_than_matching_everything(self):
        result = build(operation="elements", filters="ifcTypes=IfcWall")
        assert isinstance(result, str)
        assert "must be a JSON object" in result

    def test_a_json_list_is_not_a_filter_object(self):
        result = build(operation="elements", filters='["IfcWall"]')
        assert isinstance(result, str)
        assert "not a list" in result

    def test_element_requires_a_global_id(self):
        assert "needs a global_id" in build(operation="element")
        assert build(operation="element", global_id=" 0abc ") == {"op": "element", "globalId": "0abc"}

    def test_properties_may_be_narrowed_to_one_type(self):
        assert build(operation="properties") == {"op": "properties"}
        assert build(operation="properties", ifc_type="IfcWindow") == {
            "op": "properties",
            "ifcType": "IfcWindow",
        }

    def test_aggregate_defaults_to_a_count(self):
        assert build(operation="aggregate") == {"op": "aggregate", "filter": {}, "metric": "count", "limit": 25}

    def test_sum_without_a_quantity_is_refused(self):
        result = build(operation="aggregate", metric="sum")
        assert isinstance(result, str)
        assert "needs a 'quantity'" in result

    def test_sum_with_a_quantity_and_grouping(self):
        assert build(
            operation="aggregate",
            metric="sum",
            quantity="NetFloorArea",
            group_by="storey",
            filters='{"ifcTypes": ["IfcSpace"]}',
        ) == {
            "op": "aggregate",
            "filter": {"ifcTypes": ["IfcSpace"]},
            "metric": "sum",
            "quantity": "NetFloorArea",
            "groupBy": "storey",
            "limit": 25,
        }

    def test_compare_sends_no_model_id(self):
        assert build(operation="compare") == {"op": "compare", "limit": 20000}

    def test_unknown_metric_is_refused(self):
        assert "metric must be one of" in build(operation="aggregate", metric="median")

    def test_takeoff_refuses_a_grouping_it_cannot_do(self):
        answer = build(operation="takeoff", quantity="NetSideArea", group_by="storey")
        assert isinstance(answer, str)
        assert "can only group by 'material'" in answer

    def test_takeoff_still_splits_by_material(self):
        assert build(operation="takeoff", quantity="NetSideArea", group_by="Material") == {
            "op": "takeoff",
            "quantity": "NetSideArea",
            "byMaterial": True,
            "filter": {},
        }

    def test_grouping_by_property_is_refused_here_rather_than_by_a_400(self):
        answer = build(operation="aggregate", metric="count", group_by="property")
        assert isinstance(answer, str)
        assert "operation='properties'" in answer

    @pytest.mark.parametrize("limit,expected", [(0, 1), (5, 5), (10_000, 200)])
    def test_limit_is_clamped(self, limit, expected):
        result = build(operation="elements", limit=limit)
        assert result["limit"] == expected


class TestRender:
    def test_a_resolved_query_files_the_model_it_read_under_the_turns_round(self):
        from agent.common import turn_status

        token = turn_status.begin_lane_capture()
        try:
            _render(
                {
                    "resolved": True,
                    "op": "overview",
                    "model": {"filename": "haus-a.ifc"},
                    "summary": "120 Bauteile auf 3 Geschoßen.",
                    "overview": {"storeys": [{"name": "EG", "elementCount": 40}], "typeCounts": {"IfcWall": 12}},
                }
            )
            _render({"resolved": False, "message": "Kein Modell hinterlegt."})
            hits = turn_status.get_lane_captures()
        finally:
            turn_status.end_lane_capture(token)

        assert [(hit["name"], hit.get("detail")) for hit in hits] == [("haus-a.ifc", "overview")]

    def test_an_unresolved_result_reports_the_reason_and_the_choices(self):
        rendered = _render(
            {
                "resolved": False,
                "reason": "ambiguous",
                "message": "Mehrere Modelle.",
                "models": [
                    {"filename": "haus-a.ifc", "status": "ready", "elements": 120},
                    {"filename": "haus-b.ifc", "status": "ready", "elements": 90},
                ],
            }
        )
        assert "Mehrere Modelle." in rendered
        assert "haus-a.ifc (ready, 120 elements)" in rendered

    def test_a_project_without_its_own_model_is_told_so_before_the_shelf_is_listed(self):
        rendered = _render(
            {
                "resolved": False,
                "reason": "no_own_model",
                "message": "Dieses Projekt hat kein eigenes IFC-Modell.",
                "models": [{"filename": "Castle.ifc", "status": "ready", "elements": 120, "shelf": "office"}],
            }
        )
        assert "NO IFC model of its own" in rendered
        assert "Castle.ifc (ready, 120 elements, office shelf, not the project's)" in rendered
        assert "never present it as this project's building" in rendered

    def test_an_answer_from_a_shelf_model_opens_with_a_notice(self):
        rendered = _render(
            {
                "resolved": True,
                "op": "overview",
                "model": {"filename": "Castle.ifc"},
                "summary": "6 storeys",
                "selection": {"shelf": "office", "projectId": None, "projectHasOwnModel": False},
            }
        )
        first = rendered.splitlines()[0]
        assert first.startswith("NOTICE: this is an office-shelf model")
        assert "no IFC model of its own" in first

    def test_an_answer_from_the_projects_own_model_has_no_notice(self):
        rendered = _render(
            {
                "resolved": True,
                "op": "overview",
                "model": {"filename": "Haus.ifc"},
                "summary": "3 storeys",
                "selection": {"shelf": "project", "projectId": "p", "projectHasOwnModel": True},
            }
        )
        assert "NOTICE" not in rendered

    def test_an_unresolved_result_with_no_models_is_just_the_message(self):
        assert _render({"resolved": False, "message": "Kein Modell hinterlegt."}) == "Kein Modell hinterlegt."


class TestTheFiveWaysAModelIsNotResolved:
    NO_MODELS = {
        "resolved": False,
        "reason": "no_models",
        "message": "Für dieses Projekt ist kein IFC-Modell hinterlegt.",
        "models": [],
    }
    EXTRACTION_FAILED = {
        "resolved": False,
        "reason": "extraction_failed",
        "message": "Dieses IFC-Modell konnte nicht gelesen werden.",
        "models": [{"filename": "haus-a.ifc", "status": "failed", "elements": 0}],
    }
    NOT_READY = {
        "resolved": False,
        "reason": "not_ready",
        "message": "Dieses IFC-Modell wird derzeit verarbeitet. Es steht noch nicht zur Abfrage bereit.",
        "models": [{"filename": "haus-a.ifc", "status": "extracting", "elements": 0}],
    }
    AMBIGUOUS = {
        "resolved": False,
        "reason": "ambiguous",
        "message": "Mehrere Modelle.",
        "models": [{"filename": "haus-a.ifc", "status": "ready", "elements": 120}],
    }
    NO_MATCH = {
        "resolved": False,
        "reason": "no_match",
        "message": "Kein Modell mit dem Namen „haus-c“ gefunden.",
        "models": [{"filename": "haus-a.ifc", "status": "ready", "elements": 120}],
    }

    def test_no_models_says_the_call_is_the_answer(self):
        rendered = _render(self.NO_MODELS)

        assert "Für dieses Projekt ist kein IFC-Modell hinterlegt." in rendered
        assert "This one call is the answer" in rendered
        assert "without any claim about the building" in rendered
        assert "returns this same result" in rendered

    def test_extraction_failed_says_the_same_and_still_names_the_model(self):
        rendered = _render(self.EXTRACTION_FAILED)

        assert "haus-a.ifc (failed, 0 elements)" in rendered
        assert "This one call is the answer" in rendered

    def test_not_ready_closes_the_turn_and_still_names_the_model(self):
        rendered = _render(self.NOT_READY)

        assert "haus-a.ifc (extracting, 0 elements)" in rendered
        assert "not yet queryable" in rendered
        assert "This one call is the answer for this turn" in rendered
        assert "not ready to be queried yet" in rendered
        assert "without any claim about the building" in rendered

    def test_not_ready_also_covers_the_model_whose_extraction_failed(self):
        failed = {
            **self.NOT_READY,
            "message": "Dieses IFC-Modell konnte nicht gelesen werden.",
            "models": [{"filename": "haus-a.ifc", "status": "failed", "elements": 0}],
        }
        rendered = _render(failed)

        assert "Dieses IFC-Modell konnte nicht gelesen werden." in rendered
        assert "not ready to be queried yet" in rendered

    def test_not_ready_is_not_told_that_no_model_is_stored(self):
        from agent.tools.bim.failures import NO_MODEL_TEXT

        assert NO_MODEL_TEXT not in _render(self.NOT_READY)

    def test_ambiguous_keeps_the_alternatives_and_invites_the_retry(self):
        rendered = _render(self.AMBIGUOUS)

        assert "Available models: haus-a.ifc (ready, 120 elements)." in rendered
        assert "This one call is the answer" not in rendered

    def test_no_match_keeps_the_alternatives_and_invites_the_retry(self):
        rendered = _render(self.NO_MATCH)

        assert "Available models: haus-a.ifc (ready, 120 elements)." in rendered
        assert "This one call is the answer" not in rendered

    def test_the_do_not_retry_wording_has_one_source(self):
        from agent.tools.bim.failures import NO_MODEL_TEXT

        assert NO_MODEL_TEXT in _render(self.NO_MODELS)

    def test_the_summary_line_is_the_answer(self):
        rendered = _render(
            {
                "resolved": True,
                "op": "aggregate",
                "model": {"filename": "haus-a.ifc"},
                "summary": "Erdgeschoss: 44.5 (2), Obergeschoss: 24.5 (2).",
                "groups": [],
            }
        )
        assert "Model: haus-a.ifc" in rendered
        assert "Erdgeschoss: 44.5 (2)" in rendered

    def test_overview_adds_storeys_and_types_the_summary_cannot_carry(self):
        rendered = _render(
            {
                "resolved": True,
                "op": "overview",
                "model": {"filename": "haus-a.ifc"},
                "summary": "Modell „Haus A“ (IFC4), 19 Bauteile.",
                "overview": {
                    "storeys": [{"name": "Erdgeschoss", "elementCount": 12}],
                    "typeCounts": {"IfcWall": 5, "IfcSpace": 4},
                },
            }
        )
        assert "Storeys: Erdgeschoss (12 elements)" in rendered
        assert "Element types: IfcWall (5), IfcSpace (4)" in rendered

    def test_element_lists_carry_the_global_id_the_viewer_highlights_by(self):
        rendered = _render(
            {
                "resolved": True,
                "op": "elements",
                "model": {"filename": "haus-a.ifc"},
                "summary": "1 Bauteil erfüllt die Abfrage.",
                "elements": [
                    {
                        "ifcType": "IfcWall",
                        "name": "Aussenwand Nord",
                        "storeyName": "Erdgeschoss",
                        "globalId": "0TestFixtureWall0001",
                    }
                ],
            }
        )
        assert "IfcWall „Aussenwand Nord“ · Erdgeschoss · GlobalId 0TestFixtureWall0001" in rendered

    def test_a_partial_whole_model_answer_is_not_advice_to_narrow_the_query(self):
        from agent.tools.bim.query_render import _truncation_note

        assert "only part of the model" in _truncation_note("schedule")
        assert "only part of the model" in _truncation_note("compliance")
        assert "only part of the model" in _truncation_note("takeoff")
        assert "narrow the query" in _truncation_note("elements")
        assert "narrow the query" in _truncation_note("aggregate")

    def test_a_truncated_result_says_so(self):
        rendered = _render(
            {
                "resolved": True,
                "op": "elements",
                "model": {"filename": "haus-a.ifc"},
                "summary": "500 Bauteile erfüllen die Abfrage, davon 25 aufgelistet.",
                "elements": [],
                "truncated": True,
            }
        )
        assert "narrow the query or aggregate" in rendered

    def test_a_comparison_lists_added_removed_and_changed_with_deltas(self):
        rendered = _render(
            {
                "resolved": True,
                "op": "compare",
                "model": {"filename": "haus-a-v3.ifc"},
                "summary": "Vergleich: 1 neu, 1 entfallen, 1 geändert, 40 unverändert.",
                "comparison": {
                    "added": [{"ifcType": "IfcDoor", "name": "Fluchttuer", "storeyName": "Erdgeschoss"}],
                    "removed": [{"ifcType": "IfcWall", "name": "Innenwand alt", "storeyName": "Erdgeschoss"}],
                    "changed": [
                        {
                            "ifcType": "IfcWall",
                            "name": "Aussenwand Nord",
                            "changes": [{"field": "Pset_WallCommon.FireRating", "before": "REI 90", "after": "REI 30"}],
                        }
                    ],
                },
            }
        )
        assert "+ IfcDoor „Fluchttuer“ · Erdgeschoss" in rendered
        assert "- IfcWall „Innenwand alt“ · Erdgeschoss" in rendered
        assert "Pset_WallCommon.FireRating: REI 90 → REI 30" in rendered

    def test_the_property_catalog_shows_real_values_with_counts(self):
        rendered = _render(
            {
                "resolved": True,
                "op": "properties",
                "model": {"filename": "haus-a.ifc"},
                "summary": "2 Merkmale im Modell.",
                "properties": [
                    {
                        "set": "Pset_WallCommon",
                        "name": "FireRating",
                        "source": "property",
                        "values": [{"value": "REI 90", "elements": 3}],
                    },
                    {
                        "set": "Qto_SpaceBaseQuantities",
                        "name": "NetFloorArea",
                        "source": "quantity",
                        "values": [{"value": "32", "elements": 1}],
                    },
                ],
            }
        )
        assert "[property] Pset_WallCommon.FireRating: REI 90 (3×)" in rendered
        assert "[quantity] Qto_SpaceBaseQuantities.NetFloorArea" in rendered


class TestElementLinks:
    def test_the_path_matches_what_the_frontend_parses(self):
        assert _element_link("p1", "haus-a.ifc", "1kTvXnbbzCWw8lcMd1dR4o") == (
            "/app/projects/p1/model?model=haus-a.ifc&element=1kTvXnbbzCWw8lcMd1dR4o&hl=info%3A1kTvXnbbzCWw8lcMd1dR4o"
        )

    def test_a_space_in_the_file_name_is_encoded(self):
        assert "model=haus%20a.ifc" in _element_link("p1", "haus a.ifc", "g1")

    def test_no_project_or_no_element_yields_no_link(self):
        assert _element_link(None, "haus-a.ifc", "g1") == ""
        assert _element_link("p1", "haus-a.ifc", None) == ""

    def test_a_model_without_a_file_name_still_links_the_element(self):
        assert _element_link("p1", None, "g1") == "/app/projects/p1/model?element=g1&hl=info%3Ag1"

    def test_a_failing_element_opens_red_rather_than_neutral(self):
        assert _element_link("p1", None, "g1", "fail") == "/app/projects/p1/model?element=g1&hl=fail%3Ag1"
        assert _element_link("p1", None, "g1", "warning").endswith("hl=warning%3Ag1")

    def test_an_unknown_status_falls_back_instead_of_reaching_the_url(self):
        assert _element_link("p1", None, "g1", "rot").endswith("hl=info%3Ag1")

    def test_an_element_list_carries_a_link_per_row(self):
        rendered = _render(
            {
                "resolved": True,
                "op": "elements",
                "model": {"filename": "haus-a.ifc"},
                "summary": "1 Bauteil erfüllt die Abfrage.",
                "elements": [
                    {
                        "ifcType": "IfcWall",
                        "name": "Aussenwand Nord",
                        "storeyName": "Erdgeschoss",
                        "globalId": "0TestFixtureWall0001",
                    }
                ],
            },
            "p1",
        )
        assert "Link: /app/projects/p1/model?model=haus-a.ifc&element=0TestFixtureWall0001" in rendered

    def test_one_element_carries_its_own_link(self):
        rendered = _render(
            {
                "resolved": True,
                "op": "element",
                "model": {"filename": "haus-a.ifc"},
                "summary": "IfcWall „Aussenwand Nord“.",
                "element": {
                    "globalId": "0TestFixtureWall0001",
                    "storeyName": "Erdgeschoss",
                    "materials": [],
                    "properties": {},
                    "quantities": {},
                },
            },
            "p1",
        )
        assert "Link: /app/projects/p1/model?model=haus-a.ifc&element=0TestFixtureWall0001" in rendered

    def test_no_project_context_renders_no_link_line(self):
        rendered = _render(
            {
                "resolved": True,
                "op": "elements",
                "model": {"filename": "haus-a.ifc"},
                "summary": "1 Bauteil.",
                "elements": [{"ifcType": "IfcWall", "name": "W", "globalId": "g1"}],
            }
        )
        assert "Link:" not in rendered


class TestComplianceOperation:
    def test_compliance_takes_project_facts_not_element_filters(self):
        assert build(operation="compliance", building_class=4, main_use="Wohnen") == {
            "op": "compliance",
            "buildingClass": 4,
            "mainUse": "residential",
        }

    def test_a_fact_that_was_not_supplied_is_omitted_rather_than_defaulted(self):
        assert build(operation="compliance") == {"op": "compliance"}

    def test_an_out_of_range_building_class_is_dropped_not_clamped(self):
        assert build(operation="compliance", building_class=9) == {"op": "compliance"}

    def test_compliance_refuses_filters_rather_than_dropping_them(self):
        answer = build(operation="compliance", filters='{"ifcTypes": ["IfcWall"]}', building_class=2)
        assert isinstance(answer, str)
        assert "takes no filters" in answer

    def test_every_whole_model_operation_refuses_a_filter(self):
        for operation in ("overview", "types", "health", "schedule", "profile", "compare", "properties"):
            answer = build(operation=operation, filters='{"storeys": ["Erdgeschoss"]}')
            assert isinstance(answer, str), operation
            assert "takes no filters" in answer, operation

    def test_an_unknown_main_use_is_omitted_rather_than_rejected(self):
        assert build(operation="compliance", main_use="Wohngebäude") == {"op": "compliance"}

    def test_the_german_main_use_a_profile_or_model_still_says_is_passed_as_the_english_one(self):
        assert build(operation="compliance", main_use="Wohnen") == {
            "op": "compliance",
            "mainUse": "residential",
        }
        assert build(operation="compliance", main_use="lager") == {"op": "compliance", "mainUse": "storage"}

    def test_every_main_use_the_catalogue_knows_is_passed_through(self):
        for value in (
            "residential",
            "office",
            "lodging",
            "assembly",
            "healthcare",
            "agriculture",
            "manufacturing",
            "storage",
            "other",
        ):
            assert build(operation="compliance", main_use=value.upper()) == {
                "op": "compliance",
                "mainUse": value,
            }, value

    def test_the_diff_operation_is_addressable(self):
        assert build(operation="compliance-diff")["op"] == "compliance-diff"

    def test_the_shopping_list_reaches_the_model_as_actions(self):
        rendered = _render(
            {
                "resolved": True,
                "op": "compliance",
                "model": {"filename": "haus-a.ifc"},
                "summary": "OIB 2 3 — Tragende Bauteile: 0 erfüllt, 0 nicht erfüllt, 34 nicht entscheidbar",
                "complianceShoppingList": [
                    {
                        "path": "Pset_WallCommon.FireRating",
                        "elements": 34,
                        "rules": ["oib2-fire-resistance-load-bearing"],
                    }
                ],
            },
            "p1",
        )
        assert "missing: Pset_WallCommon.FireRating on 34 elements" in rendered

    def test_a_failing_element_carries_its_reading_and_its_link(self):
        rendered = _render(
            {
                "resolved": True,
                "op": "compliance",
                "model": {"filename": "haus-a.ifc"},
                "summary": "…",
                "compliance": [
                    {
                        "richtlinie": "OIB 4",
                        "failures": [
                            {
                                "globalId": "0TestFixtureDoor00001",
                                "name": "T-14",
                                "reading": "Breite 0.7 m — Schwellwert ≥ 0,80 m",
                            }
                        ],
                    }
                ],
            },
            "p1",
        )
        assert "Breite 0.7 m — Schwellwert ≥ 0,80 m" in rendered
        assert "element=0TestFixtureDoor00001" in rendered
        assert "hl=fail%3A0TestFixtureDoor00001" in rendered

    def test_a_rule_that_left_work_behind_prints_the_id_the_card_asks_for(self):
        rendered = _render(
            {
                "resolved": True,
                "op": "compliance",
                "model": {"filename": "haus-a.ifc"},
                "summary": "…",
                "compliance": [
                    {
                        "ruleId": "oib4-door-clear-width",
                        "titleDe": "Türen — lichte Durchgangsbreite",
                        "richtlinie": "OIB 4",
                        "failed": 3,
                        "undecidable": 0,
                        "failures": [],
                    }
                ],
            },
            "p1",
        )

        assert "Rule oib4-door-clear-width" in rendered
        assert "3 not met" in rendered

    def test_a_hinted_rule_carries_its_reason_on_its_line(self):
        reason = "Hinweis: Schwellwerte aus Ausgabe Mai 2023; am Standort gilt Ausgabe April 2019 über StBTV"
        rendered = _render(
            {
                "resolved": True,
                "op": "compliance",
                "model": {"filename": "haus-a.ifc"},
                "summary": f"OIB-Richtlinie 4, Ausgabe Mai 2023 3 — Türen: {reason}",
                "compliance": [
                    {
                        "ruleId": "oib4-door-clear-width",
                        "titleDe": "Türen — lichte Durchgangsbreite",
                        "richtlinie": "OIB-Richtlinie 4, Ausgabe Mai 2023",
                        "failed": 0,
                        "undecidable": 12,
                        "hint": reason,
                        "failures": [],
                    }
                ],
            },
            "p1",
        )

        assert (
            f"- Rule oib4-door-clear-width: Türen — lichte Durchgangsbreite — 0 not met, 12 undecidable — {reason}"
            in rendered
        )

    def test_a_clean_rule_is_not_offered_as_a_card_row(self):
        rendered = _render(
            {
                "resolved": True,
                "op": "compliance",
                "model": {"filename": "haus-a.ifc"},
                "summary": "…",
                "compliance": [
                    {
                        "ruleId": "oib3-room-height",
                        "titleDe": "Aufenthaltsräume — lichte Raumhöhe",
                        "richtlinie": "OIB 3",
                        "failed": 0,
                        "undecidable": 0,
                        "failures": [],
                    }
                ],
            },
            "p1",
        )

        assert "oib3-room-height" not in rendered

    def test_an_undecidable_rule_is_work_too(self):
        rendered = _render(
            {
                "resolved": True,
                "op": "compliance",
                "model": {"filename": "haus-a.ifc"},
                "summary": "…",
                "compliance": [
                    {
                        "ruleId": "oib2-feuerwiderstand",
                        "titleDe": "Tragende Bauteile — Feuerwiderstand",
                        "richtlinie": "OIB 2",
                        "failed": 0,
                        "undecidable": 34,
                        "failures": [],
                    }
                ],
            },
            "p1",
        )

        assert "Rule oib2-feuerwiderstand" in rendered
        assert "34 undecidable" in rendered

    def test_the_open_items_come_back_as_a_bcf_download(self):
        rendered = _render(
            {
                "resolved": True,
                "op": "compliance",
                "model": {"filename": "Haus-A_V3.ifc"},
                "summary": "…",
                "compliance": [],
            },
            "p1",
            4,
            "residential",
        )
        assert (
            "BCF export of the open issues: /api/projects/p1/bim/checks/export"
            "?model=Haus-A_V3.ifc&buildingClass=4&mainUse=residential" in rendered
        )

    def test_the_bcf_link_carries_no_fact_the_run_did_not_have(self):
        rendered = _render(
            {"resolved": True, "op": "compliance", "model": {"filename": "haus.ifc"}, "summary": "…"},
            "p1",
        )
        assert "/api/projects/p1/bim/checks/export?model=haus.ifc" in rendered
        assert "buildingClass" not in rendered
        assert "mainUse" not in rendered

    def test_no_bcf_link_without_a_project_to_hang_it_on(self):
        rendered = _render(
            {"resolved": True, "op": "compliance", "model": {"filename": "haus.ifc"}, "summary": "…"},
            None,
        )
        assert "checks/export" not in rendered

    def test_only_the_compliance_operations_offer_the_export(self):
        rendered = _render(
            {
                "resolved": True,
                "op": "elements",
                "model": {"filename": "haus.ifc"},
                "summary": "…",
                "elements": [],
            },
            "p1",
            4,
        )
        assert "checks/export" not in rendered

    def test_the_tool_description_tells_the_model_to_offer_the_file(self):
        from agent.tools.bim.register import _TOOL_DESCRIPTION

        assert "BCF export of the open issues:" in _TOOL_DESCRIPTION
        assert "ArchiCAD, Revit, Solibri or BIMcollab" in _TOOL_DESCRIPTION

    def test_the_tool_description_forbids_declaring_the_building_compliant(self):
        from agent.tools.bim.register import _TOOL_DESCRIPTION

        assert "Never turn a compliance result into a statement that the building complies" in (_TOOL_DESCRIPTION)
        assert "escape-route lengths" in _TOOL_DESCRIPTION


class TestTheDescriptionDescribesTheRealTool:
    @staticmethod
    def _description_and_parameters() -> tuple[str, list[str]]:
        from agent.tools.bim.register import _TOOL_DESCRIPTION
        from agent.tools.bim.register import IfcQueryInput

        return _TOOL_DESCRIPTION, list(IfcQueryInput.model_fields)

    def test_every_argument_the_description_shows_being_set_exists(self):
        import re

        description, parameters = self._description_and_parameters()
        shown = set(re.findall(r"\b([a-z][a-z0-9_]{2,})\s*=", description))

        assert shown, "the invariant is vacuous if the description shows no arguments at all"
        assert sorted(shown - set(parameters)) == []

    def test_every_snake_case_name_is_a_parameter_or_a_named_neighbour(self):
        import re

        description, parameters = self._description_and_parameters()
        neighbours = {
            "knowledge_search",
            "project_profile_patch",
        }
        named = set(re.findall(r"[a-z][a-z0-9]*_[a-z0-9_]+", description))

        assert sorted(named - set(parameters) - neighbours) == []

    def test_card_presentation_is_deferred_to_the_skill(self):
        description, _ = self._description_and_parameters()
        assert "ifc-spatial-reasoning" in description
        assert "emit_card" not in description

    def test_it_prefers_a_filter_over_a_transcribed_id_list(self):
        description, _ = self._description_and_parameters()
        assert "rather than a list of ids" in description
        assert "exactly one of the two per group" in description

    def test_the_takeoff_material_split_is_documented_as_a_name_match(self):
        description, _ = self._description_and_parameters()

        assert 'group_by="material"' in description
        assert "substring match" in description

    def test_the_description_separates_an_absent_value_from_a_zero(self):
        description, _ = self._description_and_parameters()

        assert "IFC2X3" in description
        assert "not that the rooms have no area" in description

    def test_the_description_teaches_the_spatial_tree(self):
        description, _ = self._description_and_parameters()

        assert "project → site → building → storey → elements" in description
        assert "IfcSpace" in description

    def test_the_description_says_the_bcf_does_not_come_back(self):
        description, _ = self._description_and_parameters()

        assert "ONE-WAY" in description


class TestBuildingClassValidation:
    @pytest.mark.parametrize("value", [0, 6, 9, -1, None])
    def test_an_impossible_building_class_reaches_neither_the_query_nor_the_link(self, value):
        from agent.tools.bim.query_render import _bcf_link

        query = build(operation="compliance", building_class=value or 0)
        assert "buildingClass" not in query

        assert "buildingClass" not in _bcf_link("p1", "haus.ifc", value or 0, "")

    @pytest.mark.parametrize("value", [1, 2, 3, 4, 5])
    def test_a_real_building_class_reaches_both(self, value):
        from agent.tools.bim.query_render import _bcf_link

        assert build(operation="compliance", building_class=value)["buildingClass"] == value
        assert f"buildingClass={value}" in _bcf_link("p1", "haus.ifc", value, "")

    def test_the_rendered_export_link_drops_a_klasse_the_catalogue_refused(self):
        rendered = _render(
            {"resolved": True, "op": "compliance", "model": {"filename": "haus.ifc"}, "summary": "…"},
            "p1",
            9,
            "residential",
        )

        assert "checks/export?model=haus.ifc&mainUse=residential" in rendered
        assert "buildingClass" not in rendered


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

    def test_a_resolved_answer_records_the_shape_of_the_query(self):
        from agent.tools.bim.register import _trace

        _trace(
            {"op": "compliance"},
            {
                "resolved": True,
                "model": {"filename": "haus.ifc", "elementCount": 40000},
                "summary": "…",
            },
        )

        assert self._recorded()["metadata"] == {
            "ifc_op": "compliance",
            "ifc_outcome": "resolved",
            "ifc_model": "e37fd06cb38e",  # pragma: allowlist secret
            "ifc_elements": 40000,
        }
        assert "haus.ifc" not in str(self._recorded())
        assert self._recorded()["tags"] == ["feature:ifc"]

    def test_a_list_clipped_by_one_reads_as_one(self):
        from agent.tools.bim.query_render import _clipped

        assert _clipped(list(range(21)), 20, "storeys") == "… 1 more storey not shown."
        assert _clipped(list(range(22)), 20, "storeys") == "… 2 more storeys not shown."
        assert _clipped(list(range(20)), 20, "storeys") is None

    def test_the_model_handle_is_stable_and_not_the_name(self):
        from agent.tools.bim.trace import model_handle as _model_handle

        assert _model_handle("Haus-Mayr_Landstrasser-Hauptstr-12_V3.ifc") == _model_handle(
            "Haus-Mayr_Landstrasser-Hauptstr-12_V3.ifc"
        )
        assert _model_handle("Haus-A.ifc") != _model_handle("Haus-B.ifc")
        handle = _model_handle("Haus-Mayr_Landstrasser-Hauptstr-12_V3.ifc")
        assert handle is not None and "Mayr" not in handle and "Hauptstr" not in handle
        assert _model_handle(None) is None
        assert _model_handle("") is None

    def test_a_partial_answer_says_so_on_the_trace(self):
        from agent.tools.bim.register import _trace

        _trace(
            {"op": "elements"},
            {
                "resolved": True,
                "model": {"filename": "haus.ifc", "elementCount": 400000},
                "truncated": True,
                "totalIsLowerBound": True,
                "summary": "…",
            },
        )

        recorded = self._recorded()["metadata"]
        assert recorded["ifc_truncated"] is True
        assert recorded["ifc_total_is_lower_bound"] is True

    def test_a_sampled_property_catalogue_is_distinguishable_from_a_complete_one(self):
        from agent.tools.bim.register import _trace

        for scan, expected in (
            ({"scanned": 600, "total": 10100, "complete": False}, True),
            ({"scanned": 19, "total": 19, "complete": True}, False),
        ):
            from agent.observability.langfuse_trace_attributes import reset_contributions

            reset_contributions()
            _trace(
                {"op": "properties"},
                {"resolved": True, "model": {"filename": "haus.ifc"}, "propertyScan": scan},
            )
            assert self._recorded()["metadata"]["ifc_catalog_sampled"] is expected

    def test_an_unresolved_model_is_recorded_with_its_reason(self):
        from agent.tools.bim.register import _trace

        _trace({"op": "overview"}, {"resolved": False, "reason": "ambiguous"})

        assert self._recorded()["metadata"] == {
            "ifc_op": "overview",
            "ifc_outcome": "unresolved:ambiguous",
        }

    def test_a_transport_failure_is_not_recorded_as_an_empty_building(self):
        from agent.tools.bim.register import _trace

        _trace({"op": "schedule"}, None, unavailable=True)

        assert self._recorded()["metadata"] == {
            "ifc_op": "schedule",
            "ifc_outcome": "service_unavailable",
        }

    def test_no_element_names_or_property_values_reach_the_trace(self):
        from agent.tools.bim.register import _trace

        _trace(
            {"op": "elements", "filter": {"nameContains": "Fluchttuer"}},
            {
                "resolved": True,
                "model": {"filename": "haus.ifc"},
                "elements": [{"globalId": "0TestFixture00Wall0001", "name": "Aussenwand Nord"}],
                "summary": "…",
            },
        )

        rendered = repr(self._recorded())
        assert "Aussenwand" not in rendered
        assert "Fluchttuer" not in rendered
        assert "0TestFixture00Wall0001" not in rendered


class TestTheToolBody:
    @pytest.fixture(autouse=True)
    def _context(self, monkeypatch):
        from agent.tools.bim import register

        monkeypatch.setattr(register, "get_organization_id_from_context", lambda: "org-1")
        monkeypatch.setattr(register, "get_project_id_from_context", lambda: "proj-1")

    @staticmethod
    def _query(monkeypatch, run, **arguments) -> tuple[str, str]:
        import asyncio

        from agent.observability.langfuse_trace_attributes import _CONTRIBUTED
        from agent.observability.langfuse_trace_attributes import reset_contributions
        from agent.tools.bim import register

        monkeypatch.setattr(register, "run_bim_query", run)

        async def body() -> tuple[str, str]:
            reset_contributions()
            answer = await register._query(register.IfcQueryInput(**arguments), 25)
            return answer, (_CONTRIBUTED.get() or {"metadata": {}})["metadata"].get("ifc_outcome", "")

        return asyncio.run(body())

    def test_no_organization_is_refused_before_anything_is_built(self, monkeypatch):
        from agent.tools.bim import register
        from agent.tools.bim.failures import NO_ORG_TEXT

        monkeypatch.setattr(register, "get_organization_id_from_context", lambda: None)
        assert self._query(monkeypatch, lambda **_: pytest.fail("posted"))[0] == NO_ORG_TEXT

    def test_no_project_is_the_shared_do_not_retry_sentence(self, monkeypatch):
        from agent.tools.bim import register
        from agent.tools.bim.register import NO_PROJECT_TEXT

        monkeypatch.setattr(register, "get_project_id_from_context", lambda: None)
        assert self._query(monkeypatch, lambda **_: pytest.fail("posted"))[0] == NO_PROJECT_TEXT

    def test_a_query_the_builder_refuses_never_reaches_the_endpoint(self, monkeypatch):
        answer, _ = self._query(monkeypatch, lambda **_: pytest.fail("posted"), operation="count_walls")
        assert answer.startswith("Error: unknown operation")

    def test_a_rejection_is_a_correctable_argument_error_on_the_trace_too(self, monkeypatch):
        from agent.knowledge.bim_query import BimQueryRejectedError

        def rejected(**_):
            raise BimQueryRejectedError("Unrecognized key(s): 'storeys'")

        answer, outcome = self._query(monkeypatch, rejected, operation="elements")
        assert "Unrecognized key(s): 'storeys'" in answer
        assert "problem with the arguments" in answer
        assert outcome == "rejected"

    def test_an_outage_is_not_a_fact_about_the_building(self, monkeypatch):
        from agent.knowledge.bim_query import BimQueryUnavailableError
        from agent.tools.bim.failures import QUERY_UNAVAILABLE_TEXT

        def down(**_):
            raise BimQueryUnavailableError("connection refused")

        assert self._query(monkeypatch, down, operation="overview") == (QUERY_UNAVAILABLE_TEXT, "service_unavailable")

    def test_a_resolved_answer_is_rendered_with_the_defaults_applied_once(self, monkeypatch):
        seen: dict = {}

        def run(**kwargs):
            seen.update(kwargs)
            return {"resolved": True, "op": "elements", "model": {"filename": "haus.ifc"}, "summary": "3 Bauteile"}

        answer, outcome = self._query(monkeypatch, run, operation="Elements", model_name=" haus ")
        assert seen["query"] == {"op": "elements", "filter": {}, "limit": 25, "offset": 0}
        assert seen["model_name"] == "haus"
        assert seen["compare_with_name"] is None
        assert answer == "Model: haus.ifc\n3 Bauteile"
        assert outcome == "resolved"


def test_the_german_fact_names_are_still_accepted_for_one_release():
    from agent.tools.bim.register import IfcQueryInput

    """Remove with the aliases on ``IfcQueryInput``."""
    legacy = IfcQueryInput.model_validate({"operation": "compliance", "gebaeudeklasse": 4, "hauptnutzung": "office"})
    assert (legacy.building_class, legacy.main_use) == (4, "office")
    assert IfcQueryInput.model_validate({"building_class": 3}).building_class == 3
