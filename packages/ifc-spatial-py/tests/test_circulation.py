from __future__ import annotations

import time
from pathlib import Path

import ifc_spatial.model as model_module
import pytest
from ifc_spatial import circulation as ci
from ifc_spatial import operators as op
from ifc_spatial.model import SpatialModel
from ifc_spatial.model import UnknownElementError
from ifc_spatial.model import WrongKindError

FIXTURES = Path(__file__).resolve().parent / "fixtures"
SAMPLE_HOUSE = FIXTURES / "Ifc4_SampleHouse.ifc"
TWO_ROOMS = FIXTURES / "house-with-rooms.ifc"
NO_DOORS = FIXTURES / "floor-slab-and-window.ifc"
NO_SPACES = FIXTURES / "units-feet.ifc"

LIVING = "3w0zWKm7n8SB1qbfwUzt0U"
BEDROOM = "3w0zWKm7n8SB1qbfwUzt0J"
HALL = "3w0zWKm7n8SB1qbfwUzt0G"
ROOF = "09J5N7xMHBfQZeQGAEMota"

EXTERNAL_DOOR = "3cUkl32yn9qRSPvBJVyWYp"
DOOR_HALL_LIVING = "3cUkl32yn9qRSPvBJVyWaG"
DOOR_LIVING_BEDROOM = "3cUkl32yn9qRSPvBJVyWax"

BEDROOM_WINDOW = "3cUkl32yn9qRSPvBJVyWcE"

NORTH_WALL = "3cUkl32yn9qRSPvBJVyWw5"

HALL_EGRESS = 1.060
LIVING_EGRESS = 8.372
BEDROOM_EGRESS = 15.492
LENGTH_TOLERANCE = 0.02


@pytest.fixture(scope="module")
def house() -> SpatialModel:
    return SpatialModel(str(SAMPLE_HOUSE))


def test_graph_has_every_space_plus_one_outside_node(house: SpatialModel) -> None:
    answer = ci.door_graph(house)
    assert answer.decidable
    nodes = {ref.global_id: ref for ref in answer.value.nodes}
    assert set(nodes) == {LIVING, BEDROOM, HALL, ROOF, ci.OUTSIDE}
    assert nodes[ROOF].kind == "space"
    assert nodes[ci.OUTSIDE].kind == "outside"


def test_the_three_doors_are_the_three_edges(house: SpatialModel) -> None:
    graph = ci.door_graph(house).value
    found = {edge.global_id: {edge.a, edge.b} for edge in graph.edges}
    assert found == {
        EXTERNAL_DOOR: {HALL, ci.OUTSIDE},
        DOOR_HALL_LIVING: {HALL, LIVING},
        DOOR_LIVING_BEDROOM: {LIVING, BEDROOM},
    }
    external = [edge for edge in graph.edges if edge.external]
    assert [edge.global_id for edge in external] == [EXTERNAL_DOOR]
    assert "IsExternal" in external[0].via


def test_every_edge_records_the_doors_id_and_name(house: SpatialModel) -> None:
    for edge in ci.door_graph(house).value.edges:
        assert edge.global_id and edge.name
        assert edge.ifc_type == "IfcDoor"
        assert house.file.by_guid(edge.global_id).Name == edge.name


def test_a_window_is_never_an_edge(house: SpatialModel) -> None:
    assert op.opens_to(house, BEDROOM_WINDOW).value[0].global_id == BEDROOM
    edge_ids = {edge.global_id for edge in ci.door_graph(house).value.edges}
    windows = {w.GlobalId for w in house.file.by_type("IfcWindow")}
    assert windows and not (edge_ids & windows)


def test_the_roof_space_is_reported_as_isolated_in_the_caveat(house: SpatialModel) -> None:
    caveat = ci.door_graph(house).caveat
    assert "keine Türkante" in caveat
    assert "Roof" in caveat
    assert len(house.file.by_type("IfcRelSpaceBoundary")) == 0
    assert "geom.tree.select" in caveat


def test_the_graph_is_built_once_and_memoised(house: SpatialModel) -> None:
    first = ci.door_graph(house)
    started = time.perf_counter()
    second = ci.door_graph(house)
    elapsed = time.perf_counter() - started
    assert first.value is second.value
    assert elapsed < 0.05, f"second door_graph() took {elapsed:.3f} s — the memo is not being hit"


def test_the_graph_does_not_trigger_a_model_wide_geometry_pass(house: SpatialModel) -> None:
    ci.door_graph(house)
    assert house.geometry_seconds == 0.0


def test_the_hall_leaves_through_its_own_external_door(house: SpatialModel) -> None:
    answer = ci.egress_path(house, HALL)
    assert answer.decidable and answer.provenance == "computed"
    assert answer.unit == "m"
    assert answer.value["doorCount"] == 1
    assert answer.value["doors"] == [EXTERNAL_DOOR]
    assert answer.value["length"] == pytest.approx(HALL_EGRESS, abs=LENGTH_TOLERANCE)


def test_the_living_room_leaves_through_the_hall(house: SpatialModel) -> None:
    answer = ci.egress_path(house, LIVING)
    assert answer.value["spaces"] == [LIVING, HALL]
    assert answer.value["doors"] == [DOOR_HALL_LIVING, EXTERNAL_DOOR]
    assert answer.value["length"] == pytest.approx(LIVING_EGRESS, abs=LENGTH_TOLERANCE)


def test_the_bedroom_leaves_through_the_living_room_and_the_hall(house: SpatialModel) -> None:
    answer = ci.egress_path(house, BEDROOM)
    assert answer.value["spaces"] == [BEDROOM, LIVING, HALL]
    assert answer.value["doors"] == [DOOR_LIVING_BEDROOM, DOOR_HALL_LIVING, EXTERNAL_DOOR]
    assert answer.value["legs"][-1]["to"]["globalId"] == ci.OUTSIDE
    assert answer.value["length"] == pytest.approx(BEDROOM_EGRESS, abs=LENGTH_TOLERANCE)


def test_the_bedroom_is_further_out_than_the_hall(house: SpatialModel) -> None:
    hall = ci.egress_path(house, HALL).value["length"]
    living = ci.egress_path(house, LIVING).value["length"]
    bedroom = ci.egress_path(house, BEDROOM).value["length"]
    assert hall < living < bedroom


def test_the_legs_add_up_to_the_length(house: SpatialModel) -> None:
    for space in (HALL, LIVING, BEDROOM):
        value = ci.egress_path(house, space).value
        assert sum(leg["length"] for leg in value["legs"]) == pytest.approx(value["length"], abs=0.002)
        assert len(value["legs"]) == value["doorCount"]


def test_the_legs_chain_room_to_room(house: SpatialModel) -> None:
    value = ci.egress_path(house, BEDROOM).value
    assert value["legs"][0]["from"]["globalId"] == BEDROOM
    for previous, following in zip(value["legs"], value["legs"][1:], strict=False):
        assert previous["to"]["globalId"] == following["from"]["globalId"]


def test_the_tolerance_is_the_geometric_one_and_grows_with_the_route(house: SpatialModel) -> None:
    hall = ci.egress_path(house, HALL)
    bedroom = ci.egress_path(house, BEDROOM)
    assert hall.tolerance == pytest.approx(op.DIMENSION_TOLERANCE)
    assert bedroom.tolerance == pytest.approx(3 * op.DIMENSION_TOLERANCE)


def test_the_caveat_says_plainly_that_the_number_is_too_short(house: SpatialModel) -> None:
    caveat = ci.egress_path(house, BEDROOM).caveat
    assert "UNTERGRENZE" in caveat
    assert "KÜRZER" in caveat
    assert "gefährliche Richtung" in caveat
    assert "darf nicht als Fluchtweglänge im Sinne der OIB-Richtlinie 2 verwendet werden" in caveat
    assert "POLYGONZUG" in caveat
    assert "Raumschwerpunkte" in caveat
    assert "endet an der Außentür" in caveat
    assert "Treppen" in caveat


def test_a_room_with_no_door_is_undecidable_and_not_an_empty_answer(house: SpatialModel) -> None:
    answer = ci.egress_path(house, ROOF)
    assert not answer.decidable
    assert answer.value is None
    assert "Türverbindung" in answer.missing.what
    assert "IfcDoor" in answer.missing.remedy
    assert "CAD" in answer.missing.remedy
    assert "Treppe" in answer.missing.remedy


def test_reachable_from_the_bedroom_counts_hops_and_metres(house: SpatialModel) -> None:
    value = ci.reachable_from(house, BEDROOM).value
    found = {entry["globalId"]: entry for entry in value["reachable"]}
    assert set(found) == {LIVING, HALL}
    assert found[LIVING]["hops"] == 1
    assert found[HALL]["hops"] == 2
    assert found[HALL]["length"] > found[LIVING]["length"]
    assert value["outside"] == {"reachable": True, "doorCount": 3, "length": pytest.approx(BEDROOM_EGRESS, abs=0.02)}


def test_reachable_from_lists_the_rooms_it_cannot_reach(house: SpatialModel) -> None:
    value = ci.reachable_from(house, HALL).value
    assert [entry["globalId"] for entry in value["nichtErreichbar"]] == [ROOF]
    assert ci.OUTSIDE not in {entry["globalId"] for entry in value["nichtErreichbar"]}


def test_reachable_from_a_room_with_no_egress_says_so_without_a_verdict(house: SpatialModel) -> None:
    answer = ci.reachable_from(house, ROOF)
    assert answer.decidable
    assert answer.value["reachable"] == []
    assert answer.value["outside"] == {"reachable": False}
    assert "Aussage über den Türgraph dieses Exports, nicht über das Gebäude" in answer.caveat
    assert {entry["globalId"] for entry in answer.value["nichtErreichbar"]} == {LIVING, BEDROOM, HALL}


def test_a_model_without_spaces_refuses_with_a_remedy() -> None:
    model = SpatialModel(str(NO_SPACES))
    answer = ci.door_graph(model)
    assert not answer.decidable
    assert answer.missing.what == "IfcSpace"
    assert "IfcSpace exportieren" in answer.missing.remedy


def test_a_model_without_doors_refuses_with_a_remedy() -> None:
    model = SpatialModel(str(NO_DOORS))
    assert len(model.file.by_type("IfcSpace")) == 3
    answer = ci.door_graph(model)
    assert not answer.decidable
    assert answer.missing.what == "IfcDoor"
    assert "IfcDoor" in answer.missing.remedy
    egress = ci.egress_path(model, "4Decke00000Space00001")
    assert not egress.decidable
    assert egress.method == "egressPath(4Decke00000Space00001)"
    assert egress.missing.what == "IfcDoor"


def test_a_door_whose_rooms_cannot_be_resolved_is_reported_not_dropped() -> None:
    model = SpatialModel(str(TWO_ROOMS))
    answer = ci.door_graph(model)
    assert answer.decidable
    assert answer.value.edges == ()
    assert [entry["globalId"] for entry in answer.value.unresolved] == ["2Haus0Raeume00Door0001"]
    assert "Körpergeometrie für" in answer.value.unresolved[0]["why"]
    assert not answer.value.unresolved[0]["why"].startswith("kein")
    assert "unbestimmt" in answer.caveat
    egress = ci.egress_path(model, "2Haus0Raeume00Space001")
    assert not egress.decidable


def test_an_oversized_model_is_refused_before_any_offset_starts() -> None:
    model = SpatialModel(str(SAMPLE_HOUSE))
    model.__dict__["derivable_boundaries"] = False
    answer = ci.door_graph(model)
    assert not answer.decidable
    assert answer.missing.what == "IfcRelSpaceBoundary"
    assert str(model_module.DERIVED_BOUNDARY_MAX_PRODUCTS) in answer.missing.remedy
    assert model.contact_seconds == 0.0
    assert model.tree_seconds == 0.0


def test_a_truncated_contact_map_refuses_the_whole_graph(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(model_module, "CONTACT_BUDGET_SECONDS", 0.0)
    model = SpatialModel(str(SAMPLE_HOUSE))
    answer = ci.door_graph(model)
    assert not answer.decidable
    assert "zu teuer" in answer.missing.what
    assert "0 von 4 Räumen" in answer.missing.remedy
    assert "fehlende Kante ist ein fehlender Weg" in answer.missing.remedy
    assert model.contacts_complete is False


def test_a_hallucinated_global_id_raises_rather_than_answering(house: SpatialModel) -> None:
    with pytest.raises(UnknownElementError):
        ci.egress_path(house, "0000000000000000000000")
    with pytest.raises(UnknownElementError):
        ci.reachable_from(house, "0000000000000000000000")


def test_asking_a_wall_for_its_escape_route_names_the_operator_that_would_answer(house: SpatialModel) -> None:
    with pytest.raises(WrongKindError) as raised:
        ci.egress_path(house, NORTH_WALL)
    assert "erwartet einen Raum (IfcSpace)" in str(raised.value)
    assert "opensTo()" in str(raised.value)


def test_no_answer_this_module_produces_states_a_verdict_or_a_threshold(house: SpatialModel) -> None:
    texts: list[str] = []

    def collect(answer: object) -> None:
        texts.append(getattr(answer, "caveat", None) or "")
        missing = getattr(answer, "missing", None)
        if missing is not None:
            texts.extend([missing.what, missing.remedy])
        value = getattr(answer, "value", None)
        if isinstance(value, ci.DoorGraph):
            for entry in (*value.unresolved, *value.excluded):
                texts.extend(str(v) for v in entry.values() if v)

    collect(ci.door_graph(house))
    for space in (HALL, LIVING, BEDROOM, ROOF):
        collect(ci.egress_path(house, space))
        collect(ci.reachable_from(house, space))
    for path in (TWO_ROOMS, NO_DOORS, NO_SPACES):
        collect(ci.door_graph(SpatialModel(str(path))))

    blob = " ".join(texts)
    assert len(blob) > 2000  # the collector actually collected something
    for verdict in ("erfüllt", "eingehalten", "compliant", "unzulässig", "zulässig", "verstößt", "Grenzwert"):
        assert verdict not in blob, f"verdict word {verdict!r} reached a reader"
    assert "OIB-Richtlinie 2" in blob
    for threshold in ("40 m", "40m", "Höchstlänge", "höchstens 40"):
        assert threshold not in blob, f"threshold {threshold!r} reached a reader"


def test_every_answer_carries_its_provenance_method_and_sources(house: SpatialModel) -> None:
    for answer, method in (
        (ci.door_graph(house), "doorGraph()"),
        (ci.egress_path(house, BEDROOM), f"egressPath({BEDROOM})"),
        (ci.reachable_from(house, BEDROOM), f"reachableFrom({BEDROOM})"),
    ):
        assert answer.method == method
        assert answer.provenance == "computed"  # this export has no space boundaries
        assert answer.caveat
        assert BEDROOM in answer.from_
        for global_id in answer.from_:
            assert house.file.by_guid(global_id) is not None
