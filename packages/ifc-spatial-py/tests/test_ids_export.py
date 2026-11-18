from __future__ import annotations

from pathlib import Path
from typing import Any
from xml.etree import ElementTree

import ifcopenshell
import ifcopenshell.guid
import ifcopenshell.util.pset
import pytest
from ifc_spatial.briefing import briefing
from ifc_spatial.envelope import MissingFact
from ifc_spatial.envelope import declared
from ifc_spatial.envelope import undecidable
from ifc_spatial.ids_export import PROPERTY_TARGETS
from ifc_spatial.ids_export import IdsExportError
from ifc_spatial.ids_export import answers_as_ids
from ifc_spatial.ids_export import blind_spots_as_ids
from ifc_spatial.ids_export import to_xml
from ifc_spatial.ids_export import write_ids
from ifc_spatial.ids_export_targets import WHY_NO_SPACE_BOUNDARY
from ifc_spatial.model import SpatialModel
from ifctester import ids as ifctester_ids

FIXTURES = Path(__file__).resolve().parent / "fixtures"
SAMPLE_HOUSE = FIXTURES / "Ifc4_SampleHouse.ifc"
NO_SPACES = FIXTURES / "units-feet.ifc"

IDS_NS = "{http://standards.buildingsmart.org/IDS}"


@pytest.fixture(scope="module")
def house() -> SpatialModel:
    return SpatialModel(str(SAMPLE_HOUSE))


@pytest.fixture(scope="module")
def spaceless() -> SpatialModel:
    return SpatialModel(str(NO_SPACES))


def _written(document: Any, tmp_path: Path) -> Any:
    facts = write_ids(document, directory=str(tmp_path))
    assert facts["path"] is not None
    return ifctester_ids.open(facts["path"], validate=True)


def _run(document: Any, ifc_path: Path) -> list[Any]:
    document.validate(ifcopenshell.open(str(ifc_path)))
    return list(document.specifications)


def _verdicts(document: Any, ifc_path: Path) -> dict[str, bool]:
    return {spec.name: bool(spec.status) for spec in _run(document, ifc_path)}


def test_the_sample_house_fails_the_specifications_derived_from_it(house: SpatialModel, tmp_path: Path) -> None:
    document = _written(blind_spots_as_ids(house), tmp_path)
    verdicts = _verdicts(document, SAMPLE_HOUSE)

    assert verdicts, "the sample house must yield at least one specification"
    assert not any(verdicts.values()), f"passed although derived from this very file: {verdicts}"
    assert "Brüstungshöhe vorhanden (Pset_WindowCommon.SillHeight)" in verdicts
    assert "Feuerwiderstand vorhanden (Pset_WallCommon.FireRating)" in verdicts
    assert "Brennbarkeit vorhanden (Pset_WallCommon.Combustible)" in verdicts
    assert "Schallschutz vorhanden (Pset_WallCommon.AcousticRating)" in verdicts


def test_the_same_specifications_pass_on_a_model_that_carries_the_properties(
    house: SpatialModel, tmp_path: Path
) -> None:
    document = _written(blind_spots_as_ids(house), tmp_path)
    specifications = _run(document, _model_with_the_properties(tmp_path))

    assert specifications
    for spec in specifications:
        assert spec.applicable_entities, f"{spec.name} matched nothing — the pass would be vacuous"
        assert spec.passed_entities
        assert not spec.failed_entities
        assert bool(spec.status) is True, f"still failing after the properties were authored: {spec.name}"


def test_existence_and_georeference_specifications_pass_where_the_fact_is_present(
    spaceless: SpatialModel, tmp_path: Path
) -> None:
    document = _written(blind_spots_as_ids(spaceless), tmp_path)

    own = _verdicts(document, NO_SPACES)
    assert own["Räume als IfcSpace exportiert"] is False
    assert own["Georeferenzierung am IfcSite"] is False

    richer = _verdicts(document, SAMPLE_HOUSE)
    assert richer["Räume als IfcSpace exportiert"] is True
    assert richer["Georeferenzierung am IfcSite"] is True
    assert richer["U-Wert vorhanden (Pset_WallCommon.ThermalTransmittance)"] is True
    assert richer["Feuerwiderstand vorhanden (Pset_WallCommon.FireRating)"] is False


def test_openings_must_resolve_to_a_host_and_the_sample_house_already_does(tmp_path: Path) -> None:
    answer = undecidable(
        from_=[],
        method="hostedIn(x)",
        missing=MissingFact(
            what="IfcRelVoidsElement + IfcRelFillsElement",
            remedy="Öffnungen und Füllungen mitexportieren",
        ),
    )
    document = _written(answers_as_ids([answer]), tmp_path)
    name = "Fenster und Türen einer Öffnung zugeordnet"

    assert _verdicts(document, SAMPLE_HOUSE)[name] is True
    assert _verdicts(document, NO_SPACES)[name] is True


def test_no_specification_states_a_value(house: SpatialModel, spaceless: SpatialModel) -> None:
    for model in (house, spaceless):
        root = ElementTree.fromstring(to_xml(blind_spots_as_ids(model)))
        assert root.findall(f".//{IDS_NS}value") == []
        for facet in root.iter():
            assert "dataType" not in facet.attrib


def test_every_finding_lands_on_exactly_one_list(house: SpatialModel, spaceless: SpatialModel) -> None:
    for model in (house, spaceless):
        b = briefing(model)
        shopping = blind_spots_as_ids(model, brief=b)
        findings = len(b.blind_spots) + len(b.absent_properties)
        assert len(shopping.exported) + len(shopping.not_exportable) == findings
        assert str(findings) in shopping.summary()


def test_space_boundaries_are_reported_as_not_exportable_with_a_reason(house: SpatialModel) -> None:
    shopping = blind_spots_as_ids(house)
    refusals = {entry.what: entry.why for entry in shopping.not_exportable}
    assert "keine IfcRelSpaceBoundary" in refusals
    assert refusals["keine IfcRelSpaceBoundary"] == WHY_NO_SPACE_BOUNDARY
    assert "IfcRelSpaceBoundary" not in to_xml(shopping)
    assert any("Geometrie-Pass" in what for what in refusals)


def test_the_property_table_is_the_ifc_templates_and_says_so_when_it_is_not() -> None:
    templates = {name: ifcopenshell.util.pset.get_template(name) for name in ("IFC4", "IFC2X3")}

    for target in PROPERTY_TARGETS:
        found = False
        for schema, template in templates.items():
            pset = template.get_by_name(target.pset)
            if pset is None:
                continue
            if target.property not in {p.Name for p in (pset.HasPropertyTemplates or [])}:
                continue
            applicable = {part.split("/")[0].strip() for part in (pset.ApplicableEntity or "").split(",")}
            for ifc_class in target.classes:
                if not _exists(schema, ifc_class):
                    continue
                assert applicable & _ancestry(schema, ifc_class), (
                    f"{target.pset} does not apply to {ifc_class} in {schema}"
                )
            found = True
        assert found is target.standard, (
            f"{target.pset}.{target.property}: standard={target.standard} contradicts the IFC templates"
        )


def test_answers_map_by_the_shape_of_missing_what(tmp_path: Path) -> None:
    answers = [
        declared(3, from_=[], method="ignored"),
        _gap("Pset_WindowCommon.SillHeight", "Brüstungshöhe im CAD pflegen."),
        _gap("IfcSpace", "Räume im CAD als IfcSpace exportieren."),
        _gap("IfcBuildingStorey.Elevation", "Höhenlagen im CAD setzen."),
        _gap("IfcRelVoidsElement + IfcRelFillsElement", "Öffnungen mitexportieren."),
        _gap("IfcGeometricRepresentationContext.TrueNorth", "Nordrichtung setzen."),
        _gap("keine senkrechte Fläche an IfcWall „Nord“", "Wand mit Körpergeometrie exportieren."),
    ]
    shopping = answers_as_ids(answers)

    assert len(shopping.exported) + len(shopping.not_exportable) == len(answers) - 1
    assert shopping.specifications == 4
    refused = {entry.what for entry in shopping.not_exportable}
    assert refused == {
        "IfcGeometricRepresentationContext.TrueNorth",
        "keine senkrechte Fläche an IfcWall „Nord“",
    }
    reason = next(e.why for e in shopping.not_exportable if e.what.endswith("TrueNorth"))
    assert "IfcObjectDefinition" in reason

    document = _written(shopping, tmp_path)
    assert len(document.specifications) == 4


def test_the_same_gap_asked_twice_is_one_specification(tmp_path: Path) -> None:
    shopping = answers_as_ids(
        [
            _gap("IfcBuildingStorey.Elevation", "Höhenlagen setzen."),
            _gap("IfcBuildingStorey.Elevation für IfcWall „Nord“", "Höhenlagen setzen."),
        ]
    )
    assert len(shopping.exported) == 2
    assert shopping.specifications == 1
    _written(shopping, tmp_path)


def test_write_returns_facts_about_the_file_and_never_the_file(house: SpatialModel, tmp_path: Path) -> None:
    facts = write_ids(blind_spots_as_ids(house), directory=str(tmp_path))

    assert Path(facts["path"]).exists()
    assert facts["path"].endswith(".ids")
    assert facts["specifications"] == 10
    assert facts["bytes"] > 0
    assert [entry["what"] for entry in facts["notExportable"]]
    assert "<ids" not in repr(facts), "the document itself must not travel in the reply"
    assert "OIB-Richtlinie" in facts["note"]


def test_two_runs_over_one_model_produce_one_file(house: SpatialModel, tmp_path: Path) -> None:
    first = write_ids(blind_spots_as_ids(house), directory=str(tmp_path))
    second = write_ids(blind_spots_as_ids(house), directory=str(tmp_path))
    assert first["path"] == second["path"]
    assert Path(first["path"]).read_text(encoding="utf-8") == Path(second["path"]).read_text(encoding="utf-8")


def test_an_empty_shopping_list_is_a_result_and_not_a_file(tmp_path: Path) -> None:
    empty = answers_as_ids([declared(1, from_=[], method="ignored")])
    facts = write_ids(empty, directory=str(tmp_path))

    assert facts["path"] is None
    assert facts["specifications"] == 0
    assert list(tmp_path.iterdir()) == []
    with pytest.raises(IdsExportError):
        to_xml(empty)


def _gap(what: str, remedy: str) -> Any:
    return undecidable(from_=[], method="test", missing=MissingFact(what=what, remedy=remedy))


def _exists(schema: str, ifc_class: str) -> bool:
    return bool(_ancestry(schema, ifc_class))


def _ancestry(schema: str, ifc_class: str) -> set[str]:
    from ifcopenshell import ifcopenshell_wrapper

    try:
        entity = ifcopenshell_wrapper.schema_by_name(schema).declaration_by_name(ifc_class).as_entity()
    except Exception:
        return set()
    names: set[str] = set()
    while entity is not None:
        names.add(entity.name())
        entity = entity.supertype()
    return names


def _model_with_the_properties(tmp_path: Path) -> Path:
    file = ifcopenshell.file(schema="IFC4")
    units = file.create_entity(
        "IfcUnitAssignment",
        Units=[file.create_entity("IfcSIUnit", UnitType="LENGTHUNIT", Name="METRE")],
    )
    file.create_entity("IfcProject", GlobalId=ifcopenshell.guid.new(), Name="Nachgebessert", UnitsInContext=units)

    def element(ifc_class: str, pset: str, values: dict[str, Any]) -> None:
        instance = file.create_entity(ifc_class, GlobalId=ifcopenshell.guid.new(), Name=ifc_class)
        properties = [
            file.create_entity(
                "IfcPropertySingleValue",
                Name=name,
                NominalValue=file.create_entity(
                    "IfcBoolean" if isinstance(value, bool) else "IfcLabel",
                    value,
                ),
            )
            for name, value in values.items()
        ]
        file.create_entity(
            "IfcRelDefinesByProperties",
            GlobalId=ifcopenshell.guid.new(),
            RelatedObjects=[instance],
            RelatingPropertyDefinition=file.create_entity(
                "IfcPropertySet",
                GlobalId=ifcopenshell.guid.new(),
                Name=pset,
                HasProperties=properties,
            ),
        )

    element("IfcWall", "Pset_WallCommon", {"FireRating": "EI 90", "Combustible": False, "AcousticRating": "53 dB"})
    element("IfcDoor", "Pset_DoorCommon", {"FireRating": "EI2 30-C", "AcousticRating": "32 dB"})
    element("IfcSlab", "Pset_SlabCommon", {"FireRating": "REI 90", "Combustible": False, "AcousticRating": "55 dB"})
    element("IfcCovering", "Pset_CoveringCommon", {"Combustible": False})
    element("IfcWindow", "Pset_WindowCommon", {"SillHeight": "0.9"})

    path = tmp_path / "nachgebessert.ifc"
    file.write(str(path))
    return path
