from __future__ import annotations

from pathlib import Path

import pytest
from ifc_spatial import envelope_geometry as eg
from ifc_spatial.envelope import Answer
from ifc_spatial.model import SpatialModel

FIXTURES = Path(__file__).resolve().parent / "fixtures"
SAMPLE_HOUSE = FIXTURES / "Ifc4_SampleHouse.ifc"
DECLARED_NO_GEOMETRY = FIXTURES / "house-with-rooms.ifc"
BOUNDARIES_NO_PSETS = FIXTURES / "floor-slab-and-window.ifc"
FEET = FIXTURES / "units-feet.ifc"
ROAD = FIXTURES / "road-ifc4x3.ifc"

NORTH_WALL = "3cUkl32yn9qRSPvBJVyWw5"
EAST_WALL = "3cUkl32yn9qRSPvBJVyWx4"
SOUTH_WALL = "3cUkl32yn9qRSPvBJVyWy4"
PARTITION = "3cUkl32yn9qRSPvBJVyWY1"
ROOF = "3cUkl32yn9qRSPvBJVyWh4"
GROUND_SLAB = "3cUkl32yn9qRSPvBJVyWgQ"
UPPER_SLAB = "3ntFzSulnDNeQ4nJrMgcOt"
GLAZED_PANE = "3cUkl32yn9qRSPvBJVyW_O"
NORTH_WINDOW = "3cUkl32yn9qRSPvBJVyWcE"
SOUTH_DOOR = "3cUkl32yn9qRSPvBJVyWYp"
INTERNAL_DOOR = "3cUkl32yn9qRSPvBJVyWax"
LIVING_ROOM = "3w0zWKm7n8SB1qbfwUzt0U"
BEDROOM = "3w0zWKm7n8SB1qbfwUzt0J"
ENTRANCE_HALL = "3w0zWKm7n8SB1qbfwUzt0G"

_TWO_ROOMS = """ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');
FILE_NAME('huelle-ohne-norden.ifc','2026-08-12T00:00:00',(''),(''),'','','');
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
#15=IFCPROJECT('1bbbbbbbbbbbbbbbbbbbb0',#5,'Huelle',$,$,$,$,(#14),#13);
#16=IFCLOCALPLACEMENT($,#9);
#20=IFCCARTESIANPOINT((2.,1.5));
#21=IFCAXIS2PLACEMENT2D(#20,$);
#22=IFCRECTANGLEPROFILEDEF(.AREA.,'raumA',#21,4.,3.);
#23=IFCEXTRUDEDAREASOLID(#22,#9,#7,2.5);
#24=IFCSHAPEREPRESENTATION(#14,'Body','SweptSolid',(#23));
#25=IFCPRODUCTDEFINITIONSHAPE($,$,(#24));
#26=IFCSPACE('1bbbbbbbbbbbbbbbbbbbb1',#5,'A',$,$,#16,#25,'Wohnen',.ELEMENT.,.INTERNAL.,$);
#30=IFCCARTESIANPOINT((6.05,1.5));
#31=IFCAXIS2PLACEMENT2D(#30,$);
#32=IFCRECTANGLEPROFILEDEF(.AREA.,'raumB',#31,3.9,3.);
#33=IFCEXTRUDEDAREASOLID(#32,#9,#7,2.5);
#34=IFCSHAPEREPRESENTATION(#14,'Body','SweptSolid',(#33));
#35=IFCPRODUCTDEFINITIONSHAPE($,$,(#34));
#36=IFCSPACE('1bbbbbbbbbbbbbbbbbbbb2',#5,'B',$,$,#16,#35,'Kueche',.ELEMENT.,.INTERNAL.,$);
#40=IFCCARTESIANPOINT((4.05,1.5));
#41=IFCAXIS2PLACEMENT2D(#40,$);
#42=IFCRECTANGLEPROFILEDEF(.AREA.,'trennwand',#41,0.1,3.);
#43=IFCEXTRUDEDAREASOLID(#42,#9,#7,2.5);
#44=IFCSHAPEREPRESENTATION(#14,'Body','SweptSolid',(#43));
#45=IFCPRODUCTDEFINITIONSHAPE($,$,(#44));
#46=IFCWALL('1bbbbbbbbbbbbbbbbbbbb3',#5,'Trennwand',$,$,#16,#45,$,$);
#50=IFCCARTESIANPOINT((-0.15,1.5));
#51=IFCAXIS2PLACEMENT2D(#50,$);
#52=IFCRECTANGLEPROFILEDEF(.AREA.,'west',#51,0.3,3.);
#53=IFCEXTRUDEDAREASOLID(#52,#9,#7,2.5);
#54=IFCSHAPEREPRESENTATION(#14,'Body','SweptSolid',(#53));
#55=IFCPRODUCTDEFINITIONSHAPE($,$,(#54));
#56=IFCWALL('1bbbbbbbbbbbbbbbbbbbb4',#5,'Aussenwand West',$,$,#16,#55,$,$);
#60=IFCCARTESIANPOINT((2.,3.15));
#61=IFCAXIS2PLACEMENT2D(#60,$);
#62=IFCRECTANGLEPROFILEDEF(.AREA.,'nord',#61,4.,0.3);
#63=IFCEXTRUDEDAREASOLID(#62,#9,#7,2.5);
#64=IFCSHAPEREPRESENTATION(#14,'Body','SweptSolid',(#63));
#65=IFCPRODUCTDEFINITIONSHAPE($,$,(#64));
#66=IFCWALL('1bbbbbbbbbbbbbbbbbbbb5',#5,'Aussenwand Nord',$,$,#16,#65,$,$);
ENDSEC;
END-ISO-10303-21;
"""

TWO_ROOMS_PARTITION = "1bbbbbbbbbbbbbbbbbbbb3"
TWO_ROOMS_WEST = "1bbbbbbbbbbbbbbbbbbbb4"
TWO_ROOMS_NORTH = "1bbbbbbbbbbbbbbbbbbbb5"


@pytest.fixture(scope="module")
def house() -> SpatialModel:
    return SpatialModel(str(SAMPLE_HOUSE))


@pytest.fixture(scope="module")
def envelope(house: SpatialModel) -> Answer:
    return eg.thermal_envelope(house)


@pytest.fixture(scope="module")
def orientation(house: SpatialModel) -> Answer:
    return eg.envelope_area_by_orientation(house)


@pytest.fixture(scope="module")
def compact(house: SpatialModel) -> Answer:
    return eg.compactness(house)


@pytest.fixture(scope="module")
def two_rooms(tmp_path_factory: pytest.TempPathFactory) -> SpatialModel:
    path = tmp_path_factory.mktemp("huelle") / "huelle-ohne-norden.ifc"
    path.write_text(_TWO_ROOMS, encoding="ascii")
    return SpatialModel(str(path))


def _by_id(entries: list[dict]) -> dict[str, dict]:
    return {e["globalId"]: e for e in entries}


def _all_entries(value: dict) -> dict[str, dict]:
    found: dict[str, dict] = {}
    for group in value["byKind"].values():
        found.update(_by_id(group))
    found.update(_by_id(value["interior"]))
    found.update(_by_id(value["undetermined"]))
    return found


def test_every_candidate_in_the_sample_house_is_decided_by_declaration(envelope: Answer) -> None:
    assert envelope.decidable
    value = envelope.value
    assert value["routes"] == {eg.ROUTE_DECLARED: 17}
    assert len(_all_entries(value)) == 23
    assert value["undetermined"] == []
    for entry in _all_entries(value).values():
        assert entry["route"] == eg.ROUTE_DECLARED
        assert entry["because"].startswith("Pset_")


def test_the_envelope_is_the_declared_outside_and_nothing_else(envelope: Answer) -> None:
    value = envelope.value
    assert {kind: len(group) for kind, group in value["byKind"].items()} == {
        "Wand": 5,  # 3 IfcWall + 2 IfcCurtainWall shells
        "Fenster": 4,
        "Tür": 1,
        "Verglasungsfeld": 6,
        "Dach": 1,
    }
    assert value["elementCount"] == 17
    inside = _by_id(value["interior"])
    assert set(inside) == {
        PARTITION,
        "3cUkl32yn9qRSPvBJVyWXt",
        INTERNAL_DOOR,
        "3cUkl32yn9qRSPvBJVyWaG",
        GROUND_SLAB,
        UPPER_SLAB,
    }


def test_total_area_is_the_sum_of_the_measured_elements(envelope: Answer) -> None:
    value = envelope.value
    measured = [e for group in value["byKind"].values() for e in group if e["area"] is not None]
    assert len(measured) == 15
    assert value["totalArea"] == pytest.approx(sum(e["area"] for e in measured), abs=1e-6)
    assert value["totalArea"] == pytest.approx(225.700565, abs=1e-3)
    assert value["totalArea"] == pytest.approx(sum(value["areaByKind"].values()), abs=1e-6)


def test_the_curtain_wall_shells_are_in_the_envelope_without_an_area(envelope: Answer) -> None:
    walls = _by_id(envelope.value["byKind"]["Wand"])
    shells = [e for e in walls.values() if e["ifcType"] == "IfcCurtainWall"]
    assert len(shells) == 2
    for shell in shells:
        assert shell["area"] is None
        assert "Vorhangfassade" in shell["via"]
    assert "keine Fläche messbar" in envelope.caveat


def test_the_ground_slab_declared_internal_is_named_not_absorbed(envelope: Answer) -> None:
    slab = _by_id(envelope.value["interior"])[GROUND_SLAB]
    assert slab["external"] is False
    assert slab["route"] == eg.ROUTE_DECLARED
    assert slab["area"] == pytest.approx(146.19905625, rel=1e-4)
    assert "Bodenplatte gegen Erdreich" in envelope.caveat
    assert "146.199" in envelope.caveat


def test_declared_u_values_are_passed_through_with_their_pset(envelope: Answer) -> None:
    entries = _all_entries(envelope.value)
    wall = entries[NORTH_WALL]
    assert wall["thermalTransmittance"] == 0.235926059936681
    assert wall["thermalTransmittanceVia"] == "Pset_WallCommon.ThermalTransmittance"
    pane = entries[GLAZED_PANE]
    assert pane["thermalTransmittance"] == 6.7069
    assert pane["thermalTransmittanceVia"] == "Pset_PlateCommon.ThermalTransmittance"
    assert entries[PARTITION]["thermalTransmittance"] == 0.350997935306263
    assert entries[SOUTH_DOOR]["thermalTransmittance"] is None
    assert entries[SOUTH_DOOR]["thermalTransmittanceVia"] is None


def test_the_curtain_wall_mullions_are_excluded_and_the_caveat_says_how_many(envelope: Answer) -> None:
    entries = _all_entries(envelope.value)
    assert not any(e["ifcType"] == "IfcMember" for e in entries.values())
    assert "20 IfcMember" in envelope.caveat


def test_a_wall_and_its_openings_add_up_to_its_gross_elevation(house: SpatialModel, envelope: Answer) -> None:
    entries = _all_entries(envelope.value)
    low, high = house.geometry(SOUTH_WALL).box
    gross = float((high[0] - low[0]) * (high[2] - low[2]))
    assert gross == pytest.approx(25.2629, abs=1e-3)

    parts = entries[SOUTH_WALL]["area"] + entries[SOUTH_DOOR]["area"] + entries["3cUkl32yn9qRSPvBJVyZTO"]["area"]
    assert entries[SOUTH_WALL]["area"] == pytest.approx(19.2537, abs=1e-3)
    assert parts == pytest.approx(gross, abs=0.05)
    assert parts < gross  # never above: a hole cannot be counted twice


def test_the_roof_matches_the_files_own_total_and_projected_area(house: SpatialModel, envelope: Answer) -> None:
    roof = house.file.by_guid(ROOF)
    declared_total = house.declared_property(roof, ("TotalArea",))
    declared_projected = house.declared_property(roof, ("ProjectedArea",))
    assert declared_total == pytest.approx(117.430474580487)
    assert declared_projected == pytest.approx(108.117682237461)

    entry = _all_entries(envelope.value)[ROOF]
    assert entry["horizontal"] is True
    assert entry["area"] == pytest.approx(declared_total, rel=1e-3)
    assert entry["projectedArea"] == pytest.approx(declared_projected, rel=1e-3)
    assert entry["area"] > entry["projectedArea"] * (1 + eg.SLOPE_REPORT_FRACTION)
    assert entry["via"] == "abgewickelte Oberfläche (geneigt oder gekrümmt)"


def test_a_flat_slab_reports_one_area_matching_its_declared_quantity(house: SpatialModel, envelope: Answer) -> None:
    slab = _by_id(envelope.value["interior"])[GROUND_SLAB]
    assert slab["area"] == pytest.approx(slab["projectedArea"], abs=1e-6)
    assert slab["via"] == "Grundrissprojektion"
    found = house.declared_quantity(house.file.by_guid(GROUND_SLAB), ("GrossArea",))
    assert found is not None
    assert found.value == pytest.approx(146.19905625)
    assert slab["area"] == pytest.approx(found.value, rel=1e-5)


def test_the_branch_is_chosen_by_measurement_not_by_ifc_type(envelope: Answer) -> None:
    entries = _all_entries(envelope.value)
    assert entries[NORTH_WALL]["horizontal"] is False
    assert entries[GLAZED_PANE]["horizontal"] is False
    assert entries[NORTH_WINDOW]["horizontal"] is False
    assert entries[ROOF]["horizontal"] is True
    assert entries[GROUND_SLAB]["horizontal"] is True


def test_the_orientation_table_of_the_sample_house(orientation: Answer) -> None:
    assert orientation.decidable
    value = orientation.value
    assert value["orientationKnown"] is True
    table = value["byOrientation"]
    assert list(table) == ["N", "O", "S", "W"]

    assert table["N"]["opaque"] == pytest.approx(27.4084, abs=1e-3)
    assert table["N"]["transparent"] == pytest.approx(6.5741, abs=1e-3)
    assert table["N"]["windowWallRatio"] == pytest.approx(0.19346, abs=1e-4)
    assert table["O"]["transparent"] == 0.0
    assert table["O"]["windowWallRatio"] == 0.0
    assert table["S"]["opaque"] == pytest.approx(23.0625, abs=1e-3)
    assert table["S"]["transparent"] == pytest.approx(15.6728, abs=1e-3)
    assert table["S"]["windowWallRatio"] == pytest.approx(0.40461, abs=1e-4)

    north = {e["globalId"]: e for e in table["N"]["elements"]}
    assert north[NORTH_WALL]["degrees"] == pytest.approx(0.0, abs=1e-6)
    assert north[NORTH_WALL]["transparent"] is False
    assert north[NORTH_WINDOW]["transparent"] is True


def test_a_fully_glazed_facade_reports_1_0_and_says_why(orientation: Answer) -> None:
    west = orientation.value["byOrientation"]["W"]
    assert west["opaque"] == 0.0
    assert west["transparent"] == pytest.approx(17.6037, abs=1e-3)
    assert west["windowWallRatio"] == 1.0
    assert "genau 1,0" in orientation.caveat
    assert "IfcMember" in orientation.caveat


def test_horizontal_elements_get_no_bearing_but_stay_in_the_totals(orientation: Answer) -> None:
    value = orientation.value
    horizontal = {e["globalId"] for e in value["ohneAusrichtung"]}
    assert horizontal == {ROOF}
    assert all(ROOF not in {e["globalId"] for e in b["elements"]} for b in value["byOrientation"].values())
    assert value["opaque"] + value["transparent"] == pytest.approx(value["total"], abs=1e-6)
    oriented = sum(b["total"] for b in value["byOrientation"].values())
    assert oriented + 117.398357 == pytest.approx(value["total"], abs=1e-3)


def test_orientation_totals_agree_with_the_envelope_total(orientation: Answer, envelope: Answer) -> None:
    assert orientation.value["total"] == pytest.approx(envelope.value["totalArea"], abs=1e-6)
    assert orientation.value["windowWallRatio"] == pytest.approx(0.176564, abs=1e-5)


def test_compactness_reports_both_inputs_and_lands_in_the_plausible_band(compact: Answer) -> None:
    assert compact.decidable
    assert compact.unit == "1/m"
    value = compact.value
    assert value["envelopeArea"] == pytest.approx(225.7006, abs=1e-3)
    assert value["volume"] == pytest.approx(266.7283, abs=1e-3)
    assert value["ratio"] == pytest.approx(value["envelopeArea"] / value["volume"], abs=1e-6)
    assert value["ratio"] == pytest.approx(0.846182, abs=1e-4)
    assert 0.3 <= value["ratio"] <= 1.5
    assert value["characteristicLength"] == pytest.approx(1.0 / value["ratio"], abs=1e-6)


def test_the_volume_is_named_as_net_and_the_gross_one_is_refused(compact: Answer) -> None:
    assert compact.value["volumeIs"].startswith("netto")
    assert "NETTOVOLUMEN" in compact.caveat
    assert "Bruttovolumen" in compact.caveat
    assert "AUSSENFLÄCHEN" in compact.caveat


def test_the_measured_volume_agrees_with_the_declared_space_volumes(compact: Answer) -> None:
    assert compact.value["volumeAgreement"] == "agree"
    spaces = {s["globalId"]: s for s in compact.value["spaces"]}
    assert len(spaces) == 4
    assert spaces[LIVING_ROOM]["volume"] == pytest.approx(129.98706, abs=1e-4)
    assert spaces[BEDROOM]["volume"] == pytest.approx(38.54195, abs=1e-4)
    assert spaces[ENTRANCE_HALL]["volume"] == pytest.approx(21.73377, abs=1e-4)
    for space in spaces.values():
        assert space["declaredAt"] == "BaseQuantities.GrossVolume"
        assert space["declaredVolume"] == pytest.approx(space["volume"], rel=1e-6)


def test_compactness_says_which_rooms_it_treated_as_heated(compact: Answer) -> None:
    assert "beheizt/unbeheizt" in compact.caveat
    assert "IfcZone" in compact.caveat
    assert sum(s["volume"] for s in compact.value["spaces"]) == pytest.approx(compact.value["volume"], abs=1e-4)


def test_compactness_area_agrees_with_the_envelope_operator(compact: Answer, envelope: Answer) -> None:
    assert compact.value["envelopeArea"] == pytest.approx(envelope.value["totalArea"], abs=1e-6)
    assert compact.value["areaByKind"] == envelope.value["areaByKind"]


def test_the_geometry_route_decides_when_nothing_is_declared(two_rooms: SpatialModel) -> None:
    answer = eg.thermal_envelope(two_rooms)
    assert answer.decidable
    value = answer.value
    assert value["routes"] == {eg.ROUTE_BOUNDED_SPACES: 2}

    walls = _by_id(value["byKind"]["Wand"])
    assert set(walls) == {TWO_ROOMS_WEST, TWO_ROOMS_NORTH}
    assert walls[TWO_ROOMS_WEST]["area"] == pytest.approx(7.5, abs=1e-6)
    assert walls[TWO_ROOMS_NORTH]["area"] == pytest.approx(10.0, abs=1e-6)
    for wall in walls.values():
        assert wall["because"].startswith("begrenzt genau einen Raum")

    partition = _by_id(value["interior"])[TWO_ROOMS_PARTITION]
    assert partition["external"] is False
    assert partition["because"].startswith("begrenzt 2 Räume")
    assert value["totalArea"] == pytest.approx(17.5, abs=1e-6)


def test_without_true_north_the_areas_come_back_without_a_compass(two_rooms: SpatialModel) -> None:
    assert two_rooms.true_north is None
    answer = eg.envelope_area_by_orientation(two_rooms)
    assert answer.decidable
    value = answer.value
    assert value["orientationKnown"] is False
    assert "byOrientation" not in value
    assert value["opaque"] == pytest.approx(17.5, abs=1e-6)
    assert value["transparent"] == 0.0
    assert value["windowWallRatio"] == 0.0
    assert "TrueNorth" in answer.caveat
    assert "geraten" in answer.caveat


def test_compactness_on_the_hand_built_rooms(two_rooms: SpatialModel) -> None:
    answer = eg.compactness(two_rooms)
    assert answer.decidable
    value = answer.value
    assert value["envelopeArea"] == pytest.approx(17.5, abs=1e-6)
    assert value["volume"] == pytest.approx(59.25, abs=1e-6)
    assert value["ratio"] == pytest.approx(17.5 / 59.25, abs=1e-6)
    assert value["volumeAgreement"] is None
    assert all(s["declaredVolume"] is None for s in value["spaces"])


def test_declared_space_boundaries_are_not_reported_as_geometry(
    tmp_path: Path,  # noqa: ARG001 — kept for symmetry with the other file-based tests
) -> None:
    model = SpatialModel(str(BOUNDARIES_NO_PSETS))
    answer = eg.thermal_envelope(model)
    assert answer.decidable
    entries = _all_entries(answer.value)
    wall = entries["4Decke00000Wall000003"]
    assert wall["external"] is True
    assert wall["route"] == eg.ROUTE_BOUNDED_SPACES
    assert "deklarierte Raumgrenzen" in wall["because"]
    partition = entries["4Decke00000Wall000002"]
    assert partition["external"] is False
    assert "deklarierte Raumgrenzen" in partition["because"]


def test_declared_without_geometry_never_reports_a_confident_zero() -> None:
    model = SpatialModel(str(DECLARED_NO_GEOMETRY))
    answer = eg.thermal_envelope(model)
    assert answer.decidable
    assert answer.value["totalArea"] is None
    assert answer.value["areaByKind"] == {}
    assert answer.value["routes"] == {eg.ROUTE_DECLARED: 4}
    assert answer.tolerance is None

    for refusal in (eg.envelope_area_by_orientation(model), eg.compactness(model)):
        assert not refusal.decidable
        assert refusal.value is None
        assert "Körper" in refusal.missing.remedy


def test_a_file_in_feet_with_no_psets_refuses_by_name() -> None:
    model = SpatialModel(str(FEET))
    assert model.unit_scale == pytest.approx(0.3048)
    for operator in (eg.thermal_envelope, eg.envelope_area_by_orientation, eg.compactness):
        answer = operator(model)
        assert not answer.decidable
        assert answer.value is None
        assert answer.missing.what.startswith("Pset_*Common.IsExternal")
        assert "IsExternal" in answer.missing.remedy
        assert "IfcSpace" in answer.missing.remedy
        assert answer.missing.elements == ["3Fuss000000Wall000001"]


def test_a_model_with_no_building_elements_says_so_rather_than_naming_psets() -> None:
    model = SpatialModel(str(ROAD))
    for operator in (eg.thermal_envelope, eg.envelope_area_by_orientation, eg.compactness):
        answer = operator(model)
        assert not answer.decidable
        assert answer.missing.what.startswith("keine Bauteile der thermischen Hülle")
        assert "Infrastruktur" in answer.missing.remedy


def test_no_operator_returns_a_verdict(envelope: Answer, orientation: Answer, compact: Answer) -> None:
    forbidden = ("erfüllt", "erfuellt", "compliant", "zulässig", "unzulässig", "bestanden", "Anforderung erfüllt")
    for answer in (envelope, orientation, compact):
        text = (answer.caveat or "") + repr(answer.value)
        for word in forbidden:
            assert word not in text
        for key in ("compliant", "passes", "verdict", "limit", "erfuellt"):
            assert key not in answer.value
    assert "Kein Grenzwert" in envelope.caveat
    assert "Kein Grenzwert" in orientation.caveat
    assert "kein Grenzwert angewandt" in compact.caveat


def test_declared_u_values_are_never_derived_from_material_layers(house: SpatialModel, envelope: Answer) -> None:
    for entry in _all_entries(envelope.value).values():
        element = house.file.by_guid(entry["globalId"])
        assert entry["thermalTransmittance"] == house.declared_property(element, ("ThermalTransmittance",))


def test_every_answer_is_an_answer_and_carries_its_method(house: SpatialModel) -> None:
    for operator, method in (
        (eg.thermal_envelope, "thermalEnvelope()"),
        (eg.envelope_area_by_orientation, "envelopeAreaByOrientation()"),
        (eg.compactness, "compactness()"),
    ):
        answer = operator(house)
        assert isinstance(answer, Answer)
        assert answer.method == method
        assert answer.provenance == "computed"
        assert answer.tolerance is not None
        assert answer.from_
        assert answer.caveat
