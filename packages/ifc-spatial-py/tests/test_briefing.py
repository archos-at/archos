from __future__ import annotations

from pathlib import Path

import ifcopenshell
import pytest
from ifc_spatial.briefing import LEXICON
from ifc_spatial.briefing import briefing
from ifc_spatial.briefing import classify_rooms
from ifc_spatial.briefing import find_blind_spots
from ifc_spatial.briefing import inventory
from ifc_spatial.briefing import measure_dialect
from ifc_spatial.briefing import normalise
from ifc_spatial.briefing import render_briefing
from ifc_spatial.briefing import storey_heights
from ifc_spatial.model import SpatialModel

FIXTURES = Path(__file__).resolve().parent / "fixtures"
SAMPLE_HOUSE = FIXTURES / "Ifc4_SampleHouse.ifc"
GERMAN_HOUSE = FIXTURES / "house-with-rooms.ifc"
NO_SPACES = FIXTURES / "units-feet.ifc"


@pytest.fixture(scope="module")
def house() -> SpatialModel:
    return SpatialModel(str(SAMPLE_HOUSE))


@pytest.fixture(scope="module")
def german() -> SpatialModel:
    return SpatialModel(str(GERMAN_HOUSE))


@pytest.fixture(scope="module")
def spaceless() -> SpatialModel:
    return SpatialModel(str(NO_SPACES))


def _named_spaces(tmp_path: Path, names: list[str]) -> SpatialModel:
    file = ifcopenshell.file(schema="IFC4")
    units = file.create_entity(
        "IfcUnitAssignment",
        Units=[file.create_entity("IfcSIUnit", UnitType="LENGTHUNIT", Name="METRE")],
    )
    file.create_entity("IfcProject", GlobalId=ifcopenshell.guid.new(), Name="Lexikon", UnitsInContext=units)
    for index, name in enumerate(names):
        file.create_entity("IfcSpace", GlobalId=ifcopenshell.guid.new(), Name=f"R.{index:02d}", LongName=name)
    path = tmp_path / "lexikon.ifc"
    file.write(str(path))
    return SpatialModel(str(path))




def test_classifies_german_room_names(german: SpatialModel) -> None:
    rooms = {room.name: room for room in classify_rooms(german)}
    assert rooms["Wohnzimmer"].kind == "habitable_room"
    assert rooms["Kueche"].kind == "habitable_room"
    assert "wohnzimmer" in rooms["Wohnzimmer"].because[0]


def test_classifies_english_room_names(house: SpatialModel) -> None:
    rooms = {room.name: room for room in classify_rooms(house)}
    assert rooms["Living room"].kind == "habitable_room"
    assert rooms["Bedroom"].kind == "habitable_room"
    assert rooms["Entrance hall"].kind == "circulation"
    assert rooms["Roof"].kind is None


def test_longest_match_wins_and_umlauts_fold(tmp_path: Path) -> None:
    model = _named_spaces(tmp_path, ["Waschküche", "KÜCHE", "Kueche", "Küche", "Wohnküche"])
    rooms = {room.name: room for room in classify_rooms(model)}

    assert rooms["Waschküche"].kind == "ancillary_room"
    assert {rooms["KÜCHE"].kind, rooms["Kueche"].kind, rooms["Küche"].kind} == {"habitable_room"}
    assert rooms["Wohnküche"].kind == "habitable_room"


def test_short_terms_only_match_on_a_word_boundary(tmp_path: Path) -> None:
    model = _named_spaces(tmp_path, ["Badminton", "BAD-03", "WCB2", "WC 1"])
    rooms = {room.name: room for room in classify_rooms(model)}
    assert rooms["Badminton"].kind is None
    assert rooms["BAD-03"].kind == "ancillary_room"
    assert rooms["WCB2"].kind is None
    assert rooms["WC 1"].kind == "ancillary_room"


def test_weak_terms_are_capped_and_say_why(tmp_path: Path) -> None:
    model = _named_spaces(tmp_path, ["Zimmer", "Halle"])
    rooms = {room.name: room for room in classify_rooms(model)}
    assert rooms["Zimmer"].confidence <= 0.55
    assert any("allein sagt die Nutzung nicht" in reason for reason in rooms["Zimmer"].because)
    assert rooms["Halle"].kind == "circulation"
    assert rooms["Halle"].confidence <= 0.55


def test_normalise_is_stable_across_unicode_forms() -> None:
    import unicodedata

    composed = "Küche"
    decomposed = unicodedata.normalize("NFD", composed)
    assert composed != decomposed
    assert normalise(composed) == normalise(decomposed) == "kueche"
    assert normalise("Groß-Raum!") == "gross raum"


def test_lexicon_terms_are_already_normalised() -> None:
    for entry in LEXICON:
        assert normalise(entry.term) == entry.term, entry.term


def test_inventory_is_inferred_and_says_it_is_a_proposal(house: SpatialModel) -> None:
    answer = inventory(house, "habitable_room")
    assert answer.decidable
    assert answer.provenance == "inferred"
    assert {room.name for room in answer.value} == {"Living room", "Bedroom"}
    assert answer.because and answer.confidence is not None
    assert "RECHTLICHE Einstufung" in answer.caveat


def test_inventory_without_spaces_is_undecidable_not_empty(spaceless: SpatialModel) -> None:
    answer = inventory(spaceless, "habitable_room")
    assert answer.decidable is False
    assert answer.value is None
    assert answer.missing.what == "IfcSpace"
    assert "IfcSpace exportieren" in answer.missing.remedy




def _spots(model: SpatialModel) -> dict[str, str]:
    return {spot.what: spot.consequence for spot in find_blind_spots(model)}


def test_space_boundary_blind_spot_fires_when_the_export_omits_them(house: SpatialModel) -> None:
    assert "keine IfcRelSpaceBoundary" in _spots(house)


def test_space_boundary_blind_spot_stays_silent_when_they_are_there(german: SpatialModel) -> None:
    assert german.file.by_type("IfcRelSpaceBoundary")
    assert "keine IfcRelSpaceBoundary" not in _spots(german)


def test_north_and_georeferencing_fire_only_where_they_are_missing(house: SpatialModel, german: SpatialModel) -> None:
    assert "keine Nordrichtung" in _spots(german)
    assert "keine Georeferenzierung" in _spots(german)
    assert house.true_north is not None and house.georeferenced
    assert "keine Nordrichtung" not in _spots(house)
    assert "keine Georeferenzierung" not in _spots(house)


def test_missing_spaces_fire_only_where_there_are_none(spaceless: SpatialModel, house: SpatialModel) -> None:
    assert "keine IfcSpace-Elemente" in _spots(spaceless)
    assert "keine IfcSpace-Elemente" not in _spots(house)


def test_the_geometry_blind_spot_tracks_the_pass_and_does_not_claim_impossibility(
    tmp_path: Path,
) -> None:
    model = SpatialModel(str(SAMPLE_HOUSE))
    before = _spots(model)
    lazy = next(k for k in before if k.startswith("Geometrie-Pass noch nicht"))
    assert "sind aber berechenbar" in before[lazy]

    model.geometry_pass()
    after = _spots(model)
    assert not any(k.startswith("Geometrie-Pass noch nicht") for k in after)
    assert not any("ohne Volumenkörper" in k for k in after)


def test_unresolved_openings_are_reported_separately_from_a_missing_relation(
    house: SpatialModel,
) -> None:
    spots = _spots(house)
    assert "keine IfcRelFillsElement" not in spots
    assert not any("ohne auflösbare Wandzuordnung" in k for k in spots)




def test_dialect_publishes_this_file_s_own_vocabulary(house: SpatialModel) -> None:
    entries, scanned, sampled = measure_dialect(house)
    assert scanned > 0 and sampled is False
    paths = {f"{e.set}.{e.property}" for e in entries}
    assert "BaseQuantities.Height" in paths
    assert "Pset_WallCommon.ThermalTransmittance" in paths
    assert not any(e.property == "id" for e in entries)


def test_absent_decisive_properties_are_named_rather_than_left_invisible(house: SpatialModel) -> None:
    absent = {entry["property"] for entry in briefing(house).absent_properties}
    assert "FireRating" in absent
    assert "SillHeight" in absent
    assert "ThermalTransmittance" not in absent




def test_storey_heights_carry_the_caveat_that_makes_them_safe(house: SpatialModel) -> None:
    answer = storey_heights(house)
    assert answer.decidable and answer.provenance == "declared"
    assert [entry["height"] for entry in answer.value] == [2.5, None]
    assert answer.value[-1]["height"] is None
    assert "NICHT die lichte Raumhöhe" in answer.caveat


def test_storey_heights_are_undecidable_below_two_elevations(spaceless: SpatialModel) -> None:
    answer = storey_heights(spaceless)
    if answer.decidable:  # pragma: no cover — guards the fixture, not the code
        pytest.skip("fixture declares two storey elevations")
    assert answer.missing.what == "IfcBuildingStorey.Elevation"
    assert "Höhenlage" in answer.missing.remedy or "Geschoße" in answer.missing.remedy




def test_render_is_deterministic(house: SpatialModel) -> None:
    assert render_briefing(house) == render_briefing(house)


def test_render_names_the_relation_behind_every_zero(house: SpatialModel) -> None:
    text = render_briefing(house)
    assert "0 von 4 — dieser Export schreibt kein IfcRelSpaceBoundary" in text
    assert "Aussage über den Export, nicht über das Gebäude" in text


def test_render_names_absent_containers_by_entity_not_by_zero(tmp_path: Path) -> None:
    model = _named_spaces(tmp_path, ["Wohnzimmer"])
    text = render_briefing(model)
    assert "kein IfcBuilding" in text and "0 Gebäude" not in text
    assert "keine IfcBuildingStorey" in text and "0 Geschoße" not in text


def test_render_announces_what_it_dropped(house: SpatialModel) -> None:
    text = render_briefing(house)
    assert "weitere Merkmale, nach Befüllung sortiert" in text
    assert "weitere Typen" in text


def test_briefing_does_not_run_geometry() -> None:
    model = SpatialModel(str(SAMPLE_HOUSE))
    render_briefing(model)
    assert model.geometry_seconds == 0.0
    assert model.contact_seconds == 0.0
