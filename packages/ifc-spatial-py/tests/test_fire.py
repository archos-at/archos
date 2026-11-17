from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import ifcopenshell
import pytest
from ifc_spatial import fire
from ifc_spatial.briefing import classify_rooms
from ifc_spatial.model import SpatialModel
from ifc_spatial.model import UnknownElementError
from ifc_spatial.model import WrongKindError

FIXTURES = Path(__file__).resolve().parent / "fixtures"
SAMPLE_HOUSE = FIXTURES / "Ifc4_SampleHouse.ifc"
NO_GEOMETRY = FIXTURES / "house-with-rooms.ifc"
NO_SPACES = FIXTURES / "units-feet.ifc"
NO_STOREYS = FIXTURES / "road-ifc4x3.ifc"
BOUNDARIES_ONLY = FIXTURES / "floor-slab-and-window.ifc"
ATTIC_GALLERY = FIXTURES / "attic-gallery.ifc"
FZK_ATTIC = "273g3wqLzDtfYIl7qqkgcO"
FZK_GROUND_FLOOR = "2eyxpyOx95m90jmsXLOuR0"
GALERIE = "2dQFggKBb1fOc1CqZDIDlx"

GROUND_FLOOR = "1o0c33arXF9AEePDYchjCY"
ROOF_STOREY = "1o0c33arXF9AEePDYchj2Z"
LIVING = "3w0zWKm7n8SB1qbfwUzt0U"
BEDROOM = "3w0zWKm7n8SB1qbfwUzt0J"
HALL = "3w0zWKm7n8SB1qbfwUzt0G"
ROOF_SPACE = "09J5N7xMHBfQZeQGAEMota"
PARTITION = "3cUkl32yn9qRSPvBJVyWXt"
NORTH_WALL = "3cUkl32yn9qRSPvBJVyWw5"
DOOR_LIVING_BEDROOM = "3cUkl32yn9qRSPvBJVyWax"

WOHNZIMMER = "2Haus0Raeume00Space001"
KITCHEN = "2Haus0Raeume00Space002"
PARTITION_WALL = "2Haus0Raeume00Wall0003"
EXTERIOR_WALL_SOUTH = "2Haus0Raeume00Wall0001"
ROOM_DOOR = "2Haus0Raeume00Door0001"
ZONE = "2Haus0Raeume00Zone0001"

SAMPLE_GROUND_FLOOR_AREA = 76.1051


def _bounds_of(model: SpatialModel, space: str) -> list[Any]:
    from ifc_spatial import operators as op

    return op.bounds(model, space).value or []


def _adjacent_of(model: SpatialModel, space: str) -> list[Any]:
    from ifc_spatial import operators as op

    return op.adjacent_spaces(model, space).value or []


def _gid(tag: str) -> str:
    return f"1Brand{tag}".ljust(22, "0")[:22]


class _Writer:

    def __init__(self, name: str) -> None:
        self.file = ifcopenshell.file(schema="IFC4")
        f = self.file
        self.z = f.create_entity("IfcDirection", DirectionRatios=(0.0, 0.0, 1.0))
        self.x = f.create_entity("IfcDirection", DirectionRatios=(1.0, 0.0, 0.0))
        axes = f.create_entity(
            "IfcAxis2Placement3D",
            Location=f.create_entity("IfcCartesianPoint", Coordinates=(0.0, 0.0, 0.0)),
            Axis=self.z,
            RefDirection=self.x,
        )
        self.context = f.create_entity(
            "IfcGeometricRepresentationContext",
            ContextType="Model",
            CoordinateSpaceDimension=3,
            Precision=1e-5,
            WorldCoordinateSystem=axes,
        )
        self.placement = f.create_entity("IfcLocalPlacement", RelativePlacement=axes)
        units = f.create_entity(
            "IfcUnitAssignment",
            Units=[
                f.create_entity("IfcSIUnit", UnitType="LENGTHUNIT", Name="METRE"),
                f.create_entity("IfcSIUnit", UnitType="AREAUNIT", Name="SQUARE_METRE"),
                f.create_entity("IfcSIUnit", UnitType="VOLUMEUNIT", Name="CUBIC_METRE"),
            ],
        )
        self.project = f.create_entity(
            "IfcProject",
            GlobalId=_gid("Project"),
            Name=name,
            RepresentationContexts=[self.context],
            UnitsInContext=units,
        )

    def box(self, name: str, coords: tuple[float, float, float, float, float, float]) -> Any:
        x0, x1, y0, y1, z0, z1 = coords
        f = self.file
        profile = f.create_entity(
            "IfcRectangleProfileDef",
            ProfileType="AREA",
            ProfileName=name,
            Position=f.create_entity(
                "IfcAxis2Placement2D",
                Location=f.create_entity("IfcCartesianPoint", Coordinates=((x0 + x1) / 2, (y0 + y1) / 2)),
            ),
            XDim=x1 - x0,
            YDim=y1 - y0,
        )
        solid = f.create_entity(
            "IfcExtrudedAreaSolid",
            SweptArea=profile,
            Position=f.create_entity(
                "IfcAxis2Placement3D",
                Location=f.create_entity("IfcCartesianPoint", Coordinates=(0.0, 0.0, z0)),
                Axis=self.z,
                RefDirection=self.x,
            ),
            ExtrudedDirection=self.z,
            Depth=z1 - z0,
        )
        return f.create_entity(
            "IfcProductDefinitionShape",
            Representations=[
                f.create_entity(
                    "IfcShapeRepresentation",
                    ContextOfItems=self.context,
                    RepresentationIdentifier="Body",
                    RepresentationType="SweptSolid",
                    Items=[solid],
                )
            ],
        )

    def product(self, cls: str, tag: str, name: str, coords: Any = None, **extra: Any) -> Any:
        return self.file.create_entity(
            cls,
            GlobalId=_gid(tag),
            Name=name,
            ObjectPlacement=self.placement,
            Representation=None if coords is None else self.box(name, coords),
            **extra,
        )

    def curve(self, corners: list[tuple[float, float]], identifier: str) -> Any:
        points = [self.file.create_entity("IfcCartesianPoint", Coordinates=c) for c in corners]
        return self.file.create_entity(
            "IfcProductDefinitionShape",
            Representations=[
                self.file.create_entity(
                    "IfcShapeRepresentation",
                    ContextOfItems=self.context,
                    RepresentationIdentifier=identifier,
                    RepresentationType="Curve2D",
                    Items=[self.file.create_entity("IfcPolyline", Points=points)],
                )
            ],
        )

    def pset(self, tag: str, name: str, properties: list[tuple[str, str, Any]], elements: list[Any]) -> None:
        f = self.file
        values = [
            f.create_entity("IfcPropertySingleValue", Name=key, NominalValue=f.create_entity(kind, value))
            for key, kind, value in properties
        ]
        f.create_entity(
            "IfcRelDefinesByProperties",
            GlobalId=_gid(f"Def{tag}"),
            RelatedObjects=elements,
            RelatingPropertyDefinition=f.create_entity(
                "IfcPropertySet", GlobalId=_gid(f"Pset{tag}"), Name=name, HasProperties=values
            ),
        )

    def rel(self, cls: str, tag: str, **kwargs: Any) -> Any:
        return self.file.create_entity(cls, GlobalId=_gid(tag), **kwargs)

    def write(self, path: Path) -> SpatialModel:
        self.file.write(str(path))
        return SpatialModel(str(path))


OFFICE_01 = _gid("Space01")
OFFICE_02 = _gid("Space02")
OFFICE_03 = _gid("Space03")
PLANT_ROOM = _gid("Space04")
EG = _gid("StoreyEG")
OG = _gid("StoreyOG")
TG = _gid("StoreyTG")
FIRE_WALL = _gid("Wall05")
SOUTH_WALL = _gid("Wall03")
WEST_WALL = _gid("Wall01")
EAST_WALL = _gid("Wall02")
SLAB_GROUND_FLOOR = _gid("Slab01")
FIRE_DOOR = _gid("Door01")
BAUPLATZ = _gid("Site")
FIRE_COMPARTMENT = _gid("Zone01")


def _office(path: Path) -> SpatialModel:
    w = _Writer("Buerogebaeude Brandabschnitte")
    f = w.file

    site = f.create_entity(
        "IfcSite",
        GlobalId=BAUPLATZ,
        Name="Bauplatz 42",
        ObjectPlacement=w.placement,
        Representation=w.curve([(-3.0, -5.0), (25.0, -5.0), (25.0, 20.0), (-3.0, 20.0), (-3.0, -5.0)], "FootPrint"),
        CompositionType="ELEMENT",
    )
    building = w.product("IfcBuilding", "Building", "Haus A", CompositionType="ELEMENT")
    storeys = [
        w.product("IfcBuildingStorey", "StoreyEG", "Erdgeschoss", CompositionType="ELEMENT", Elevation=0.0),
        w.product("IfcBuildingStorey", "StoreyOG", "Obergeschoss", CompositionType="ELEMENT", Elevation=3.5),
        w.product("IfcBuildingStorey", "StoreyTG", "Technikgeschoss", CompositionType="ELEMENT", Elevation=7.0),
    ]
    w.rel("IfcRelAggregates", "Aggr1", RelatingObject=w.project, RelatedObjects=[site])
    w.rel("IfcRelAggregates", "Aggr2", RelatingObject=site, RelatedObjects=[building])
    w.rel("IfcRelAggregates", "Aggr3", RelatingObject=building, RelatedObjects=storeys)

    west = w.product("IfcWall", "Wall01", "Aussenwand West", (0.0, 0.2, 0.0, 10.0, 0.0, 3.5))
    east = w.product("IfcWall", "Wall02", "Aussenwand Ost", (9.8, 10.0, 0.0, 10.0, 0.0, 3.5))
    south = w.product("IfcWall", "Wall03", "Aussenwand Sued", (0.2, 9.8, 0.0, 0.2, 0.0, 3.5))
    north = w.product("IfcWall", "Wall04", "Aussenwand Nord", (0.2, 9.8, 9.8, 10.0, 0.0, 3.5))
    brandwand = w.product("IfcWall", "Wall05", "Brandwand BA-01/BA-02", (6.0, 6.2, 0.2, 9.8, 0.0, 3.5))
    base = w.product("IfcSlab", "Slab00", "Bodenplatte", (0.2, 9.8, 0.2, 9.8, -0.3, 0.0), PredefinedType="BASESLAB")
    decke = w.product(
        "IfcSlab", "Slab01", "Geschossdecke ueber EG", (0.2, 9.8, 0.2, 9.8, 3.2, 3.5), PredefinedType="FLOOR"
    )
    dach = w.product(
        "IfcSlab", "Slab02", "Geschossdecke ueber OG", (0.2, 9.8, 0.2, 9.8, 6.7, 7.0), PredefinedType="FLOOR"
    )

    door = w.product(
        "IfcDoor",
        "Door01",
        "Brandschutztuer BA-01/BA-02",
        (6.0, 6.2, 4.5, 5.5, 0.0, 2.1),
        OverallHeight=2.1,
        OverallWidth=1.0,
        PredefinedType="DOOR",
    )
    opening = w.product(
        "IfcOpeningElement",
        "Openin01",
        "Tueroeffnung Brandwand",
        (6.0, 6.2, 4.5, 5.5, 0.0, 2.1),
        PredefinedType="OPENING",
    )
    w.rel("IfcRelVoidsElement", "Void01", RelatingBuildingElement=brandwand, RelatedOpeningElement=opening)
    w.rel("IfcRelFillsElement", "Fill01", RelatingOpeningElement=opening, RelatedBuildingElement=door)

    def space(tag: str, name: str, long_name: str, coords: Any) -> Any:
        return w.product(
            "IfcSpace", tag, name, coords, LongName=long_name, CompositionType="ELEMENT", PredefinedType="SPACE"
        )

    a = space("Space01", "R.01", "Buero 01", (0.2, 6.0, 0.2, 9.8, 0.0, 3.2))
    b = space("Space02", "R.02", "Buero 02", (6.2, 9.8, 0.2, 9.8, 0.0, 3.2))
    c = space("Space03", "R.03", "Buero 03", (0.2, 9.8, 0.2, 9.8, 3.5, 6.7))
    d = space("Space04", "R.04", "Technikraum Lueftung", (0.2, 4.2, 0.2, 4.2, 7.0, 9.5))

    w.rel("IfcRelAggregates", "Aggr4", RelatingObject=storeys[0], RelatedObjects=[a, b])
    w.rel("IfcRelAggregates", "Aggr5", RelatingObject=storeys[1], RelatedObjects=[c])
    w.rel("IfcRelAggregates", "Aggr6", RelatingObject=storeys[2], RelatedObjects=[d])
    w.rel(
        "IfcRelContainedInSpatialStructure",
        "Cont1",
        RelatingStructure=storeys[0],
        RelatedElements=[west, east, south, north, brandwand, base, decke, door],
    )
    w.rel("IfcRelContainedInSpatialStructure", "Cont2", RelatingStructure=storeys[1], RelatedElements=[dach])

    index = 0
    for room, elements in (
        (a, [west, south, north, brandwand, base, decke, door]),
        (b, [east, south, north, brandwand, base, decke, door]),
        (c, [west, east, south, north, decke, dach]),
    ):
        for element in elements:
            index += 1
            w.rel(
                "IfcRelSpaceBoundary",
                f"Bnd{index:02d}",
                RelatingSpace=room,
                RelatedBuildingElement=element,
                PhysicalOrVirtualBoundary="PHYSICAL",
                InternalOrExternalBoundary="INTERNAL",
            )

    w.pset(
        "01",
        "Pset_WallCommon",
        [
            ("FireRating", "IfcLabel", "REI 90"),
            ("Compartmentation", "IfcBoolean", True),
            ("IsExternal", "IfcBoolean", False),
        ],
        [brandwand],
    )
    w.pset("02", "Pset_WallCommon", [("IsExternal", "IfcBoolean", True)], [west, east, south, north])
    w.pset("03", "Pset_DoorCommon", [("FireRating", "IfcLabel", "EI2 30-C")], [door])
    w.pset("04", "Pset_SlabCommon", [("FireRating", "IfcLabel", "REI 90")], [decke])

    zone = f.create_entity("IfcZone", GlobalId=FIRE_COMPARTMENT, Name="BA-01", LongName="Brandabschnitt Erdgeschoss")
    w.rel("IfcRelAssignsToGroup", "Grp01", RelatedObjects=[a, b], RelatingGroup=zone)
    w.pset("05", "Pset_ZoneCommon", [("Category", "IfcLabel", "Brandabschnitt")], [zone])

    return w.write(path)


@pytest.fixture(scope="module")
def office(tmp_path_factory: pytest.TempPathFactory) -> SpatialModel:
    return _office(tmp_path_factory.mktemp("fire") / "brandabschnitte.ifc")


@pytest.fixture(scope="module")
def house() -> SpatialModel:
    return SpatialModel(str(SAMPLE_HOUSE))


@pytest.fixture(scope="module")
def bodyless() -> SpatialModel:
    return SpatialModel(str(NO_GEOMETRY))




def test_escape_level_is_the_top_occupied_floor_above_the_lowest_ground(office: SpatialModel) -> None:
    answer = fire.escape_level(office)
    assert answer.decidable
    assert answer.unit == "m"
    assert answer.value["escape_level"] == pytest.approx(3.5, abs=1e-9)
    assert answer.value["topOccupiedFloor"]["globalId"] == OG
    assert answer.value["groundReference"]["z"] == pytest.approx(0.0, abs=1e-9)


def test_escape_level_is_inferred_and_never_computed(office: SpatialModel) -> None:
    answer = fire.escape_level(office)
    assert answer.provenance == "inferred"
    assert answer.confidence is not None and 0.0 < answer.confidence <= 1.0
    assert answer.because


def test_every_storey_is_reported_with_its_reason_counted_or_not(office: SpatialModel) -> None:
    answer = fire.escape_level(office)
    storeys = {entry["globalId"]: entry for entry in answer.value["storeys"]}
    assert set(storeys) == {EG, OG, TG}
    assert storeys[EG]["counted"] is True
    assert storeys[OG]["counted"] is True
    assert storeys[TG]["counted"] is False
    assert "technik" in storeys[TG]["why"].lower()
    assert [room["name"] for room in storeys[EG]["rooms"]] == ["Buero 01", "Buero 02"]
    assert storeys[EG]["rooms"][0]["use"] == "habitable_room"


def test_the_sample_houses_roof_storey_is_not_an_occupied_level(house: SpatialModel) -> None:
    answer = fire.escape_level(house)
    assert answer.decidable
    assert answer.value["escape_level"] == pytest.approx(0.0, abs=1e-9)
    assert answer.value["topOccupiedFloor"]["globalId"] == GROUND_FLOOR
    dropped = [entry for entry in answer.value["storeys"] if not entry["counted"]]
    assert [entry["globalId"] for entry in dropped] == [ROOF_STOREY]
    assert "roof" in dropped[0]["why"].lower()


def test_a_storey_with_no_rooms_is_counted_because_silence_is_not_evidence(bodyless: SpatialModel) -> None:
    answer = fire.escape_level(bodyless)
    assert answer.value["escape_level"] == pytest.approx(3.0, abs=1e-9)
    upper = [entry for entry in answer.value["storeys"] if entry["name"] == "Obergeschoss"][0]
    assert upper["counted"] is True
    assert upper["rooms"] == []
    assert "Im Zweifel MITGEZÄHLT" in upper["why"]
    assert "gefährliche Richtung" in upper["why"]
    assert any("ohne positives Nutzungssignal" in reason for reason in answer.because)


def test_the_ground_reference_says_which_route_it_used_and_lists_the_others(house: SpatialModel) -> None:
    ground = fire.escape_level(house).value["groundReference"]
    assert "IfcBuildingStorey.Elevation" in ground["via"]
    assert "kein Gelände" in ground["via"]
    candidates = {round(entry["z"], 3) for entry in ground["candidates"]}
    assert candidates == {0.0, -0.47}
    assert not any("IfcSite-Körpergeometrie" in entry["via"] for entry in ground["candidates"])


def test_ref_elevation_is_reported_and_never_subtracted(house: SpatialModel) -> None:
    ground = fire.escape_level(house).value["groundReference"]
    assert [entry["globalId"] for entry in ground["nichtVerwendet"]] == ["1o0c33arXF9AEePDXPKItd"]
    assert "Meereshöhe" in ground["nichtVerwendet"][0]["via"]
    assert all("RefElevation" not in entry["via"] for entry in ground["candidates"])


def test_a_file_without_storeys_is_refused_with_a_remedy() -> None:
    answer = fire.escape_level(SpatialModel(str(NO_STOREYS)))
    assert answer.decidable is False
    assert answer.missing.what == "IfcBuildingStorey"
    assert "Elevation" in answer.missing.remedy


def test_storeys_without_an_elevation_are_refused_rather_than_estimated(tmp_path: Path) -> None:
    w = _Writer("Ohne Hoehen")
    building = w.product("IfcBuilding", "Building", "Haus", CompositionType="ELEMENT")
    storey = w.product("IfcBuildingStorey", "StoreyEG", "Erdgeschoss", CompositionType="ELEMENT")
    w.rel("IfcRelAggregates", "Aggr1", RelatingObject=w.project, RelatedObjects=[building])
    w.rel("IfcRelAggregates", "Aggr2", RelatingObject=building, RelatedObjects=[storey])
    model = w.write(tmp_path / "ohne-hoehen.ifc")

    answer = fire.escape_level(model)
    assert answer.decidable is False
    assert answer.missing.what == "IfcBuildingStorey.Elevation"
    assert "Schätzung" in answer.missing.remedy


def test_modelled_terrain_beats_the_lowest_floor_and_changes_the_number(tmp_path: Path) -> None:
    w = _Writer("Mit Gelaende")
    site = w.file.create_entity(
        "IfcSite",
        GlobalId=BAUPLATZ,
        Name="Bauplatz mit Gelaendemodell",
        ObjectPlacement=w.placement,
        Representation=w.box("Gelaende", (-10.0, 20.0, -10.0, 20.0, -2.0, 0.0)),
        CompositionType="ELEMENT",
    )
    building = w.product("IfcBuilding", "Building", "Haus", CompositionType="ELEMENT")
    eg = w.product("IfcBuildingStorey", "StoreyEG", "Erdgeschoss", CompositionType="ELEMENT", Elevation=0.0)
    og = w.product("IfcBuildingStorey", "StoreyOG", "Obergeschoss", CompositionType="ELEMENT", Elevation=3.0)
    unten = w.product("IfcSpace", "Space01", "R.01", (0.0, 4.0, 0.0, 5.0, 0.0, 2.8), LongName="Buero 01")
    oben = w.product("IfcSpace", "Space02", "R.02", (0.0, 4.0, 0.0, 5.0, 3.0, 5.8), LongName="Buero 02")
    w.rel("IfcRelAggregates", "Aggr1", RelatingObject=w.project, RelatedObjects=[site])
    w.rel("IfcRelAggregates", "Aggr2", RelatingObject=site, RelatedObjects=[building])
    w.rel("IfcRelAggregates", "Aggr3", RelatingObject=building, RelatedObjects=[eg, og])
    w.rel("IfcRelAggregates", "Aggr4", RelatingObject=eg, RelatedObjects=[unten])
    w.rel("IfcRelAggregates", "Aggr5", RelatingObject=og, RelatedObjects=[oben])
    model = w.write(tmp_path / "mit-gelaende.ifc")

    answer = fire.escape_level(model)
    ground = answer.value["groundReference"]
    assert ground["z"] == pytest.approx(-2.0, abs=1e-6)
    assert ground["via"].startswith("IfcSite-Körpergeometrie")
    assert answer.value["escape_level"] == pytest.approx(5.0, abs=1e-6)
    assert 0.0 in [entry["z"] for entry in ground["candidates"]]
    assert not any("Kein Geländemodell" in reason for reason in answer.because)


def test_escape_level_never_names_a_building_class(office: SpatialModel, house: SpatialModel) -> None:
    for model in (office, house):
        answer = fire.escape_level(model)
        blob = _text(answer)
        assert re.search(r"\bGK\s?[1-5]\b", blob) is None, blob
        assert "Gebäudeklasse" in answer.caveat
        assert "nennt deshalb keine Gebäudeklasse" in answer.caveat


def test_a_room_name_containing_roof_does_not_veto_the_lexicon(tmp_path: Path) -> None:
    w = _Writer("Dachzimmer")
    building = w.product("IfcBuilding", "Building", "Haus", CompositionType="ELEMENT")
    eg = w.product("IfcBuildingStorey", "StoreyEG", "Erdgeschoss", CompositionType="ELEMENT", Elevation=0.0)
    og = w.product("IfcBuildingStorey", "StoreyOG", "1. Obergeschoss", CompositionType="ELEMENT", Elevation=3.5)
    unten = w.product("IfcSpace", "Space01", "R.01", (0.0, 4.0, 0.0, 5.0, 0.0, 2.8), LongName="Wohnzimmer")
    oben = w.product("IfcSpace", "Space02", "R.02", (0.0, 4.0, 0.0, 5.0, 3.5, 6.3), LongName="Dachzimmer")
    w.rel("IfcRelAggregates", "Aggr1", RelatingObject=w.project, RelatedObjects=[building])
    w.rel("IfcRelAggregates", "Aggr2", RelatingObject=building, RelatedObjects=[eg, og])
    w.rel("IfcRelAggregates", "Aggr3", RelatingObject=eg, RelatedObjects=[unten])
    w.rel("IfcRelAggregates", "Aggr4", RelatingObject=og, RelatedObjects=[oben])
    model = w.write(tmp_path / "dachzimmer.ifc")

    assert {room.name: room.kind for room in classify_rooms(model)}["Dachzimmer"] == "habitable_room"

    answer = fire.escape_level(model)
    assert answer.value["escape_level"] == pytest.approx(3.5, abs=1e-9)
    top = {entry["globalId"]: entry for entry in answer.value["storeys"]}[og.GlobalId]
    assert top["counted"] is True
    assert "Aufenthaltsräume" in top["why"]
    assert "Dachzimmer" in top["why"]


def test_the_storeys_own_name_still_removes_it_when_its_rooms_agree(tmp_path: Path) -> None:
    w = _Writer("Dachgeschoss")
    building = w.product("IfcBuilding", "Building", "Haus", CompositionType="ELEMENT")
    eg = w.product("IfcBuildingStorey", "StoreyEG", "Erdgeschoss", CompositionType="ELEMENT", Elevation=0.0)
    og = w.product("IfcBuildingStorey", "StoreyDG", "Dachgeschoss", CompositionType="ELEMENT", Elevation=3.5)
    unten = w.product("IfcSpace", "Space01", "R.01", (0.0, 4.0, 0.0, 5.0, 0.0, 2.8), LongName="Wohnzimmer")
    oben = w.product("IfcSpace", "Space02", "R.02", (0.0, 4.0, 0.0, 5.0, 3.5, 6.3), LongName="Dachraum")
    w.rel("IfcRelAggregates", "Aggr1", RelatingObject=w.project, RelatedObjects=[building])
    w.rel("IfcRelAggregates", "Aggr2", RelatingObject=building, RelatedObjects=[eg, og])
    w.rel("IfcRelAggregates", "Aggr3", RelatingObject=eg, RelatedObjects=[unten])
    w.rel("IfcRelAggregates", "Aggr4", RelatingObject=og, RelatedObjects=[oben])
    model = w.write(tmp_path / "dachgeschoss.ifc")

    assert {room.name: room.kind for room in classify_rooms(model)}.get("Dachraum") is None

    answer = fire.escape_level(model)
    assert answer.value["escape_level"] == pytest.approx(0.0, abs=1e-9)
    dropped = {entry["globalId"]: entry for entry in answer.value["storeys"]}[og.GlobalId]
    assert dropped["counted"] is False
    assert "Geschoßname" in dropped["why"]
    assert "Dachraum" in dropped["why"]


def test_a_habitable_room_outranks_the_storeys_name(tmp_path: Path) -> None:
    w = _Writer("Ausgebautes Dachgeschoss")
    building = w.product("IfcBuilding", "Building", "Haus", CompositionType="ELEMENT")
    eg = w.product("IfcBuildingStorey", "StoreyEG", "Erdgeschoss", CompositionType="ELEMENT", Elevation=0.0)
    og = w.product("IfcBuildingStorey", "StoreyDG", "Dachgeschoss", CompositionType="ELEMENT", Elevation=3.5)
    unten = w.product("IfcSpace", "Space01", "R.01", (0.0, 4.0, 0.0, 5.0, 0.0, 2.8), LongName="Wohnzimmer")
    oben = w.product("IfcSpace", "Space02", "R.02", (0.0, 4.0, 0.0, 5.0, 3.5, 6.3), LongName="Dachzimmer")
    w.rel("IfcRelAggregates", "Aggr1", RelatingObject=w.project, RelatedObjects=[building])
    w.rel("IfcRelAggregates", "Aggr2", RelatingObject=building, RelatedObjects=[eg, og])
    w.rel("IfcRelAggregates", "Aggr3", RelatingObject=eg, RelatedObjects=[unten])
    w.rel("IfcRelAggregates", "Aggr4", RelatingObject=og, RelatedObjects=[oben])
    model = w.write(tmp_path / "ausgebautes-dachgeschoss.ifc")

    assert {room.name: room.kind for room in classify_rooms(model)}["Dachzimmer"] == "habitable_room"

    answer = fire.escape_level(model)
    assert answer.value["escape_level"] == pytest.approx(3.5, abs=1e-9)
    top = {entry["globalId"]: entry for entry in answer.value["storeys"]}[og.GlobalId]
    assert top["counted"] is True
    assert "Aufenthaltsräume" in top["why"]
    assert "Dachzimmer" in top["why"]


class TestTheStoreyNameIsATieBreakerAndNotAVeto:

    @pytest.fixture(scope="class")
    @classmethod
    def model(cls) -> SpatialModel:
        return SpatialModel(str(ATTIC_GALLERY))

    def test_the_veto_would_still_fire_if_it_were_still_there(self, model: SpatialModel) -> None:
        assert "dach" in fire.NOT_OCCUPIED_TERMS
        assert fire._matching_term("Dachgeschoss") == "dach"
        rooms = {room.global_id: room.kind for room in classify_rooms(model)}
        assert rooms.get(GALERIE) is None, "the lexicon now places „Galerie“; this fixture no longer reproduces"

    def test_the_gallery_storey_is_counted_and_the_answer_is_three_seven(self, model: SpatialModel) -> None:
        answer = fire.escape_level(model)
        assert answer.value["escape_level"] == pytest.approx(3.7, abs=1e-9), "1.000 m was the reported defect"
        assert answer.value["topOccupiedFloor"]["globalId"] == FZK_ATTIC
        assert answer.value["groundReference"]["z"] == pytest.approx(-1.0, abs=1e-9)

    def test_the_reason_is_the_open_use_and_not_the_storeys_name(self, model: SpatialModel) -> None:
        judged = {entry["globalId"]: entry for entry in fire.escape_level(model).value["storeys"]}
        dachgeschoss = judged[FZK_ATTIC]
        assert dachgeschoss["counted"] is True
        assert "Im Zweifel MITGEZÄHLT" in dachgeschoss["why"]
        assert "von den Raumnamen nicht bestätigt" in dachgeschoss["why"]
        assert [room["name"] for room in dachgeschoss["rooms"]] == ["Galerie"]
        assert judged[FZK_GROUND_FLOOR]["counted"] is True

    def test_counting_it_in_doubt_is_priced_into_the_confidence(self, model: SpatialModel) -> None:
        answer = fire.escape_level(model)
        assert answer.confidence == pytest.approx(0.7, abs=1e-9)
        assert any("ohne positives Nutzungssignal" in reason for reason in answer.because)

    def test_it_is_still_a_height_and_never_a_class(self, model: SpatialModel) -> None:
        answer = fire.escape_level(model)
        assert answer.unit == "m"
        assert re.search(r"\bGK\s?[1-5]\b", _text(answer)) is None




def test_a_declared_zone_is_measured_as_the_sum_of_its_rooms(office: SpatialModel) -> None:
    answer = fire.compartment_area(office, FIRE_COMPARTMENT)
    assert answer.decidable
    assert answer.unit == "m²"
    assert answer.value["area"] == pytest.approx(90.24, abs=1e-6)
    areas = {entry["globalId"]: entry["area"] for entry in answer.value["spaces"]}
    assert areas == {OFFICE_01: pytest.approx(55.68, abs=1e-6), OFFICE_02: pytest.approx(34.56, abs=1e-6)}
    assert sum(areas.values()) == pytest.approx(answer.value["area"], abs=1e-6)


def test_a_declared_grouping_is_reported_as_the_architects_own_statement(office: SpatialModel) -> None:
    answer = fire.compartment_area(office, FIRE_COMPARTMENT)
    grouping = answer.value["grouping"][0]
    assert grouping["ifcType"] == "IfcZone"
    assert grouping["declared"] is True
    assert "IfcRelAssignsToGroup" in grouping["via"]
    assert "DEKLARIERTEN Gruppe" in answer.caveat


def test_a_storey_is_measured_but_is_never_called_a_fire_compartment(office: SpatialModel) -> None:
    answer = fire.compartment_area(office, EG)
    assert answer.value["area"] == pytest.approx(90.24, abs=1e-6)
    assert "Ein Geschoß ist kein Brandabschnitt" in answer.caveat
    assert "Brandabschnitt Erdgeschoss" in answer.caveat
    assert [z["globalId"] for z in answer.value["deklarierteZonen"]] == [FIRE_COMPARTMENT]


def test_a_room_reached_twice_is_counted_once_and_the_drop_is_reported(office: SpatialModel) -> None:
    answer = fire.compartment_area(office, [EG, OFFICE_01])
    assert answer.value["area"] == pytest.approx(90.24, abs=1e-6)
    assert answer.value["spaceCount"] == 2
    assert [entry["globalId"] for entry in answer.value["duplicates"]] == [OFFICE_01]
    assert "nur EINMAL gezählt" in answer.caveat


def test_rooms_stacked_on_two_storeys_are_summed_and_not_unioned(office: SpatialModel) -> None:
    answer = fire.compartment_area(office, [OFFICE_01, OFFICE_03])
    assert answer.value["area"] == pytest.approx(147.84, abs=1e-6)
    assert answer.value["overlaps"] == []


def test_two_rooms_modelled_on_top_of_each_other_are_reported_not_subtracted(tmp_path: Path) -> None:
    w = _Writer("Doppelt modelliert")
    storey = w.product("IfcBuildingStorey", "StoreyEG", "Erdgeschoss", CompositionType="ELEMENT", Elevation=0.0)
    a = w.product("IfcSpace", "Space01", "R.01", (0.0, 4.0, 0.0, 5.0, 0.0, 2.5), LongName="Buero A")
    b = w.product("IfcSpace", "Space02", "R.02", (2.0, 5.0, 0.0, 5.0, 0.0, 2.5), LongName="Buero B")
    w.rel("IfcRelAggregates", "Aggr1", RelatingObject=storey, RelatedObjects=[a, b])
    model = w.write(tmp_path / "doppelt.ifc")

    answer = fire.compartment_area(model, [_gid("Space01"), _gid("Space02")])
    assert answer.value["area"] == pytest.approx(20.0 + 15.0, abs=1e-6)
    assert len(answer.value["overlaps"]) == 1
    assert answer.value["overlaps"][0]["area"] == pytest.approx(10.0, abs=1e-6)
    assert "NICHT bereinigt" in answer.caveat


def test_the_sample_houses_ground_floor_sums_its_three_rooms(house: SpatialModel) -> None:
    answer = fire.compartment_area(house, GROUND_FLOOR)
    assert answer.value["area"] == pytest.approx(SAMPLE_GROUND_FLOOR_AREA, abs=0.001)
    assert {entry["globalId"] for entry in answer.value["spaces"]} == {LIVING, BEDROOM, HALL}
    assert ROOF_SPACE not in {entry["globalId"] for entry in answer.value["spaces"]}


def test_rooms_without_a_body_refuse_rather_than_report_zero(bodyless: SpatialModel) -> None:
    answer = fire.compartment_area(bodyless, ZONE)
    assert answer.decidable is False
    assert "Grundfläche" in answer.missing.what
    assert "floorArea()" in answer.missing.remedy


def test_a_wall_is_not_a_compartment(office: SpatialModel) -> None:
    with pytest.raises(WrongKindError) as raised:
        fire.compartment_area(office, FIRE_WALL)
    assert "compartmentArea() erwartet" in str(raised.value)
    assert "floorArea()" in str(raised.value)


def test_a_whole_building_is_refused_rather_than_silently_summed(office: SpatialModel) -> None:
    with pytest.raises(WrongKindError) as raised:
        fire.compartment_area(office, _gid("Building"))
    assert "IfcBuilding" in str(raised.value)


def test_an_unknown_id_raises_rather_than_returning_undecidable(office: SpatialModel) -> None:
    with pytest.raises(UnknownElementError):
        fire.compartment_area(office, "3w0zWKm7n8SB1qbfwUztXX")




def test_the_fire_wall_between_two_compartments_is_found_with_its_fire_rating(office: SpatialModel) -> None:
    answer = fire.separating_elements(office, OFFICE_01, OFFICE_02)
    assert answer.decidable
    assert answer.provenance == "declared"  # both spaces carry declared boundaries
    separating = answer.value["separating"]
    assert [entry["globalId"] for entry in separating] == [FIRE_WALL]
    assert separating[0]["fireRating"] == "REI 90"
    assert separating[0]["fireRatingDeklariert"] is True
    assert separating[0]["compartmentation"] is True
    assert "Achsentest" in separating[0]["why"]


def test_the_door_in_the_fire_wall_is_reported_separately_with_its_own_rating(office: SpatialModel) -> None:
    answer = fire.separating_elements(office, OFFICE_01, OFFICE_02)
    openings = answer.value["openings"]
    assert [entry["globalId"] for entry in openings] == [FIRE_DOOR]
    assert openings[0]["fireRating"] == "EI2 30-C"
    assert openings[0]["inBauteil"] == FIRE_WALL
    assert FIRE_DOOR not in [entry["globalId"] for entry in answer.value["separating"]]


def test_a_facade_running_past_both_rooms_bounds_them_without_separating_them(office: SpatialModel) -> None:
    answer = fire.separating_elements(office, OFFICE_01, OFFICE_02)
    alongside = {entry["globalId"]: entry for entry in answer.value["shared"]}
    assert SOUTH_WALL in alongside
    assert "läuft an beiden Räumen entlang" in alongside[SOUTH_WALL]["why"]

    shared = {ref.global_id for ref in _bounds_of(office, OFFICE_01)} & {
        ref.global_id for ref in _bounds_of(office, OFFICE_02)
    }
    listed = {entry["globalId"] for entry in answer.value["separating"]} | set(alongside)
    listed |= {entry["globalId"] for entry in answer.value["openings"]}
    assert listed == shared
    assert not {WEST_WALL, EAST_WALL} & shared


def test_a_floor_slab_separates_the_room_above_from_the_room_below(office: SpatialModel) -> None:
    answer = fire.separating_elements(office, OFFICE_01, OFFICE_03)
    separating = {entry["globalId"]: entry for entry in answer.value["separating"]}
    assert SLAB_GROUND_FLOOR in separating
    assert separating[SLAB_GROUND_FLOOR]["fireRating"] == "REI 90"
    assert "in z getrennt" in separating[SLAB_GROUND_FLOOR]["why"]


def test_the_sample_houses_partition_is_found_and_its_door_stands_proud_of_it(house: SpatialModel) -> None:
    answer = fire.separating_elements(house, LIVING, BEDROOM)
    assert [entry["globalId"] for entry in answer.value["separating"]] == [PARTITION]
    assert DOOR_LIVING_BEDROOM in [entry["globalId"] for entry in answer.value["openings"]]
    assert fire.SEPARATION_SLACK > 0.063


def test_no_fire_rating_anywhere_is_stated_as_a_finding_about_the_export(house: SpatialModel) -> None:
    answer = fire.separating_elements(house, LIVING, BEDROOM)
    assert answer.value["separating"][0]["fireRating"] is None
    assert answer.value["ohneFeuerwiderstand"]
    assert "NIRGENDS ein Feuerwiderstand deklariert" in answer.caveat
    assert "Befund über den EXPORT" in answer.caveat
    assert "Pset_WallCommon.FireRating" in answer.caveat


def test_a_gap_in_a_file_that_declares_elsewhere_reads_differently(bodyless: SpatialModel) -> None:
    assert bodyless.declared_property(bodyless.file.by_guid(EXTERIOR_WALL_SOUTH), ("FireRating",)) == "REI 90"
    answer = fire.separating_elements(bodyless, WOHNZIMMER, KITCHEN)
    assert [entry["globalId"] for entry in answer.value["separating"]] == [PARTITION_WALL]
    assert answer.value["separating"][0]["fireRating"] is None
    assert "obwohl die Datei ihn andernorts deklariert" in answer.caveat
    assert "NIRGENDS" not in answer.caveat


class TestAnEmptyFireRatingIsNotADeclaration:

    @pytest.fixture(scope="class")
    @classmethod
    def model(cls, tmp_path_factory: pytest.TempPathFactory) -> SpatialModel:
        w = _Writer("Leere FireRating-Platzhalter")
        building = w.product("IfcBuilding", "BuildingE", "Haus", CompositionType="ELEMENT")
        storey = w.product("IfcBuildingStorey", "StoreyE", "Erdgeschoss", CompositionType="ELEMENT", Elevation=0.0)
        wall = w.product("IfcWall", "WallE01", "Trennwand", (4.0, 4.2, 0.0, 6.0, 0.0, 3.0))
        door = w.product(
            "IfcDoor", "DoorE01", "Zimmertuer", (4.0, 4.2, 2.0, 3.0, 0.0, 2.1), OverallHeight=2.1, OverallWidth=1.0
        )
        opening = w.product("IfcOpeningElement", "OpenE01", "Tueroeffnung", (4.0, 4.2, 2.0, 3.0, 0.0, 2.1))
        left = w.product("IfcSpace", "SpaceE01", "R.01", (0.0, 4.0, 0.0, 6.0, 0.0, 3.0), LongName="Wohnzimmer")
        right = w.product("IfcSpace", "SpaceE02", "R.02", (4.2, 8.0, 0.0, 6.0, 0.0, 3.0), LongName="Kueche")
        w.rel("IfcRelAggregates", "AggrE1", RelatingObject=w.project, RelatedObjects=[building])
        w.rel("IfcRelAggregates", "AggrE2", RelatingObject=building, RelatedObjects=[storey])
        w.rel("IfcRelAggregates", "AggrE3", RelatingObject=storey, RelatedObjects=[left, right])
        w.rel("IfcRelContainedInSpatialStructure", "ContE1", RelatingStructure=storey, RelatedElements=[wall, door])
        w.rel("IfcRelVoidsElement", "VoidE1", RelatingBuildingElement=wall, RelatedOpeningElement=opening)
        w.rel("IfcRelFillsElement", "FillE1", RelatingOpeningElement=opening, RelatedBuildingElement=door)
        for index, room in enumerate((left, right)):
            w.rel(
                "IfcRelSpaceBoundary",
                f"BndE{index:02d}",
                RelatingSpace=room,
                RelatedBuildingElement=wall,
                PhysicalOrVirtualBoundary="PHYSICAL",
                InternalOrExternalBoundary="INTERNAL",
            )
        w.pset("E1", "Pset_WallCommon", [("FireRating", "IfcLabel", "")], [wall])
        w.pset("E2", "Pset_DoorCommon", [("FireRating", "IfcLabel", "")], [door])
        return w.write(tmp_path_factory.mktemp("leer") / "leere-firerating.ifc")

    def test_the_empty_string_really_is_in_the_file(self, model: SpatialModel) -> None:
        wall = model.file.by_guid(_gid("WallE01"))
        assert model.declared_property(wall, ("FireRating",)) == ""

    def test_a_blank_is_not_a_declaration_anywhere_in_the_file(self, model: SpatialModel) -> None:
        assert fire._declares_fire_rating(model) is False

    def test_the_finding_is_about_the_export_and_carries_the_cad_remedy(self, model: SpatialModel) -> None:
        answer = fire.separating_elements(model, _gid("SpaceE01"), _gid("SpaceE02"))
        assert "NIRGENDS ein Feuerwiderstand deklariert" in answer.caveat
        assert "Befund über den EXPORT" in answer.caveat
        assert "Pset_WallCommon.FireRating" in answer.caveat
        assert "Lücke in genau diesen Bauteilen" not in answer.caveat
        assert "2 Bauteil(e) führen das Merkmal FireRating zwar mit, aber LEER" in answer.caveat

    def test_no_element_claims_a_declared_class_that_is_blank(self, model: SpatialModel) -> None:
        answer = fire.separating_elements(model, _gid("SpaceE01"), _gid("SpaceE02"))
        wall = answer.value["separating"][0]
        assert wall["globalId"] == _gid("WallE01")
        assert wall["fireRating"] is None, "'' was published as the declared class"
        assert wall["fireRatingDeklariert"] is False
        opening = answer.value["openings"][0]
        assert opening["globalId"] == _gid("DoorE01")
        assert opening["fireRating"] is None
        assert opening["fireRatingDeklariert"] is False
        assert set(answer.value["ohneFeuerwiderstand"]) == {_gid("WallE01"), _gid("DoorE01")}

    def test_whitespace_is_blank_too(self, tmp_path: Path) -> None:
        w = _Writer("Leerzeichen")
        wall = w.product("IfcWall", "WallW01", "Trennwand", (0.0, 0.2, 0.0, 6.0, 0.0, 3.0))
        w.pset("W1", "Pset_WallCommon", [("FireRating", "IfcLabel", "   ")], [wall])
        model = w.write(tmp_path / "leerzeichen.ifc")
        assert fire._fire_rating(model, model.file.by_guid(_gid("WallW01"))) is None
        assert fire._declares_fire_rating(model) is False

    def test_a_real_class_is_still_read_and_still_verbatim(self, tmp_path: Path) -> None:
        w = _Writer("Echte Klasse")
        wall = w.product("IfcWall", "WallR01", "Brandwand", (0.0, 0.2, 0.0, 6.0, 0.0, 3.0))
        w.pset("R1", "Pset_WallCommon", [("FireRating", "IfcLabel", "REI 90")], [wall])
        model = w.write(tmp_path / "echte-klasse.ifc")
        assert fire._fire_rating(model, model.file.by_guid(_gid("WallR01"))) == "REI 90"
        assert fire._declares_fire_rating(model) is True


def test_without_bodies_the_betweenness_test_is_skipped_and_says_so(bodyless: SpatialModel) -> None:
    answer = fire.separating_elements(bodyless, WOHNZIMMER, KITCHEN)
    assert answer.value["shared"] == []
    assert "nicht geprüft" in answer.value["separating"][0]["why"]
    assert "NICHT geprüft" in answer.caveat


def test_a_shared_slab_is_never_reported_as_proof_the_rooms_are_neighbours() -> None:
    model = SpatialModel(str(BOUNDARIES_ONLY))
    wohnen, bad = "4Decke00000Space00001", "4Decke00000Space00003"
    answer = fire.separating_elements(model, wohnen, bad)

    slab = answer.value["separating"]
    assert [entry["ifcType"] for entry in slab] == ["IfcSlab"]
    assert "nicht geprüft" in slab[0]["why"]
    assert "ohne sie zu trennen" in answer.caveat
    assert "benachbart" not in _text(answer)
    assert bad not in {ref.global_id for ref in _adjacent_of(model, wohnen)}


def test_the_opening_chain_is_walked_even_without_second_level_boundaries(bodyless: SpatialModel) -> None:
    openings = fire.separating_elements(bodyless, WOHNZIMMER, KITCHEN).value["openings"]
    assert [entry["globalId"] for entry in openings] == [ROOM_DOOR]
    assert openings[0]["inBauteil"] == PARTITION_WALL
    assert "IfcRelVoidsElement" in openings[0]["via"]


def test_two_rooms_that_share_nothing_are_a_decidable_empty_answer(office: SpatialModel) -> None:
    answer = fire.separating_elements(office, OFFICE_02, PLANT_ROOM)
    assert answer.decidable
    assert answer.value["separating"] == []
    assert answer.value["openings"] == []
    assert "KEIN gemeinsames Bauteil" in answer.caveat
    assert "adjacentSpaces()" in answer.caveat


def test_the_same_room_twice_is_refused(house: SpatialModel) -> None:
    answer = fire.separating_elements(house, LIVING, LIVING)
    assert answer.decidable is False
    assert "zweimal derselbe Raum" in answer.missing.what
    assert "bounds()" in answer.missing.remedy


def test_a_wall_is_not_a_room(house: SpatialModel) -> None:
    with pytest.raises(WrongKindError) as raised:
        fire.separating_elements(house, NORTH_WALL, LIVING)
    assert "separatingElements() erwartet" in str(raised.value)
    assert "enclosedBy()" in str(raised.value)




@pytest.mark.parametrize("fixture", [SAMPLE_HOUSE, NO_GEOMETRY, NO_SPACES, NO_STOREYS, BOUNDARIES_ONLY])
def test_no_fixture_in_this_repository_can_answer_the_boundary_question(fixture: Path) -> None:
    model = SpatialModel(str(fixture))
    assert model.file.by_type("IfcSite")
    assert all(site.Representation is None for site in model.file.by_type("IfcSite"))

    answer = fire.distance_to_site_boundary(model)
    assert answer.decidable is False
    assert answer.value is None
    assert "Grundstücksgrenze" in answer.missing.what


def test_the_refusal_names_what_to_export_and_rejects_the_bounding_box(house: SpatialModel) -> None:
    remedy = fire.distance_to_site_boundary(house).missing.remedy
    assert "FootPrint" in remedy
    assert "IfcAnnotation" in remedy
    assert "Hüllbox" in remedy and "Erfindung" in remedy
    assert house.file.by_type("IfcSite")[0].RefLatitude is not None
    assert "RefLatitude" in remedy


def test_the_building_stands_three_metres_from_the_western_boundary(office: SpatialModel) -> None:
    answer = fire.distance_to_site_boundary(office)
    assert answer.decidable
    assert answer.unit == "m"
    assert answer.value["distance"] == pytest.approx(3.0, abs=1e-9)
    assert answer.value["nearest"]["globalId"] == WEST_WALL
    assert answer.value["boundary"]["closed"] is True
    assert "FootPrint" in answer.value["boundary"]["via"]
    assert answer.value["outside"] is False


def test_both_ends_of_the_measurement_travel_with_it(office: SpatialModel) -> None:
    nearest = fire.distance_to_site_boundary(office).value["nearest"]
    assert nearest["pointOnElement"][0] == pytest.approx(0.0, abs=1e-6)
    assert nearest["pointOnBoundary"][0] == pytest.approx(-3.0, abs=1e-6)
    assert nearest["pointOnElement"][1] == pytest.approx(nearest["pointOnBoundary"][1], abs=1e-6)


def test_air_is_not_measured(office: SpatialModel) -> None:
    measured = {entry["globalId"] for entry in fire.distance_to_site_boundary(office).value["elements"]}
    assert not measured & {OFFICE_01, OFFICE_02, OFFICE_03, PLANT_ROOM}
    assert WEST_WALL in measured


def test_one_element_can_be_asked_on_its_own(office: SpatialModel) -> None:
    answer = fire.distance_to_site_boundary(office, EAST_WALL)
    assert answer.value["distance"] == pytest.approx(5.0, abs=1e-9)
    assert answer.value["nearest"]["globalId"] == EAST_WALL
    assert answer.value["distance"] > fire.distance_to_site_boundary(office).value["distance"]


def test_an_annotation_is_the_second_route_to_a_boundary(tmp_path: Path) -> None:
    w = _Writer("Grenze als Annotation")
    site = w.file.create_entity("IfcSite", GlobalId=BAUPLATZ, Name="Bauplatz", CompositionType="ELEMENT")
    wall = w.product("IfcWall", "Wall01", "Aussenwand", (0.0, 4.0, 0.0, 0.3, 0.0, 3.0))
    annotation = w.file.create_entity(
        "IfcAnnotation",
        GlobalId=_gid("Annot01"),
        Name="Grundstücksgrenze Nord",
        ObjectPlacement=w.placement,
        Representation=w.curve([(-10.0, 8.0), (20.0, 8.0), (20.0, -6.0)], "Annotation"),
    )
    w.rel("IfcRelAggregates", "Aggr1", RelatingObject=w.project, RelatedObjects=[site])
    w.rel("IfcRelContainedInSpatialStructure", "Cont1", RelatingStructure=site, RelatedElements=[wall, annotation])
    model = w.write(tmp_path / "annotation-grenze.ifc")

    answer = fire.distance_to_site_boundary(model)
    assert answer.decidable
    assert answer.value["distance"] == pytest.approx(7.7, abs=1e-6)
    assert "IfcAnnotation" in answer.value["boundary"]["via"]
    assert answer.value["boundary"]["closed"] is False
    assert "NICHT geschlossen" in answer.caveat
    assert "zu GROSS" in answer.caveat
    assert answer.value["outside"] is None


def test_a_truncated_element_list_is_never_called_complete(tmp_path: Path) -> None:
    w = _Writer("Zwoelf Bauteile")
    site = w.file.create_entity(
        "IfcSite",
        GlobalId=BAUPLATZ,
        Name="Bauplatz",
        ObjectPlacement=w.placement,
        Representation=w.curve([(-3.0, -5.0), (25.0, -5.0), (25.0, 20.0), (-3.0, 20.0), (-3.0, -5.0)], "FootPrint"),
        CompositionType="ELEMENT",
    )
    building = w.product("IfcBuilding", "Building", "Haus", CompositionType="ELEMENT")
    storey = w.product("IfcBuildingStorey", "StoreyEG", "Erdgeschoss", CompositionType="ELEMENT", Elevation=0.0)
    w.rel("IfcRelAggregates", "Aggr1", RelatingObject=w.project, RelatedObjects=[site])
    w.rel("IfcRelAggregates", "Aggr2", RelatingObject=site, RelatedObjects=[building])
    w.rel("IfcRelAggregates", "Aggr3", RelatingObject=building, RelatedObjects=[storey])
    walls = [
        w.product("IfcWall", f"Wall{i:02d}", f"Stuetzmauer {i:02d}", (float(i), float(i) + 0.2, 0.0, 1.0, 0.0, 3.0))
        for i in range(12)
    ]
    w.rel("IfcRelContainedInSpatialStructure", "Cont1", RelatingStructure=storey, RelatedElements=walls)
    model = w.write(tmp_path / "zwoelf-bauteile.ifc")

    answer = fire.distance_to_site_boundary(model)
    assert len(answer.value["elements"]) == 10
    assert "Geprüft wurden 12 Bauteile" in answer.caveat
    assert "die 10 nächstgelegenen der 12 geprüften Bauteile" in answer.caveat
    assert "die 2 entfernteren sind NICHT enthalten" in answer.caveat
    assert "vollständige" not in answer.caveat


def test_a_list_that_is_complete_says_that_too(office: SpatialModel) -> None:
    answer = fire.distance_to_site_boundary(office)
    listed = answer.value["elements"]
    assert len(listed) < 10
    assert f"die {len(listed)} nächstgelegenen der {len(listed)} geprüften Bauteile" in answer.caveat
    assert "das sind alle." in answer.caveat




def _text(answer: Any) -> str:
    import json

    return json.dumps(answer.to_dict(), ensure_ascii=False, default=str)


def _every_answer(office: SpatialModel, house: SpatialModel, bodyless: SpatialModel) -> list[Any]:
    return [
        fire.escape_level(office),
        fire.escape_level(house),
        fire.escape_level(bodyless),
        fire.compartment_area(office, FIRE_COMPARTMENT),
        fire.compartment_area(office, EG),
        fire.compartment_area(house, GROUND_FLOOR),
        fire.compartment_area(bodyless, ZONE),
        fire.separating_elements(office, OFFICE_01, OFFICE_02),
        fire.separating_elements(office, OFFICE_01, OFFICE_03),
        fire.separating_elements(house, LIVING, BEDROOM),
        fire.separating_elements(bodyless, WOHNZIMMER, KITCHEN),
        fire.distance_to_site_boundary(office),
        fire.distance_to_site_boundary(house),
    ]


def test_no_answer_this_module_produces_states_a_verdict(
    office: SpatialModel, house: SpatialModel, bodyless: SpatialModel
) -> None:
    for answer in _every_answer(office, house, bodyless):
        blob = _text(answer).lower()
        for verdict in ("erfüllt", "eingehalten", "compliant", "unzulässig", "zulässig", "verstoß", "konform"):
            assert verdict not in blob, f"{verdict!r} reached a reader via {answer.method}"


def test_no_answer_this_module_produces_applies_a_threshold(
    office: SpatialModel, house: SpatialModel, bodyless: SpatialModel
) -> None:
    for answer in _every_answer(office, house, bodyless):
        blob = _text(answer).lower()
        assert "grenzwert" not in blob, answer.method
        assert re.search(r"\bgk\s?[1-5]\b", blob) is None, answer.method


def test_every_undecidable_answer_carries_a_german_remedy(
    office: SpatialModel, house: SpatialModel, bodyless: SpatialModel
) -> None:
    refusals = [answer for answer in _every_answer(office, house, bodyless) if not answer.decidable]
    assert refusals, "the fixtures must produce at least one refusal, or this asserts nothing"
    for answer in refusals:
        assert answer.missing is not None
        assert answer.missing.what and answer.missing.remedy
        assert re.search(r"[a-zäöüß]", answer.missing.remedy)
        assert any(word in answer.missing.remedy for word in ("exportieren", "setzen", "aufrufen", "CAD", "anlegen"))


def test_every_decidable_answer_names_the_elements_it_came_from(
    office: SpatialModel, house: SpatialModel, bodyless: SpatialModel
) -> None:
    for answer in _every_answer(office, house, bodyless):
        if not answer.decidable:
            continue
        assert answer.from_, answer.method
        assert answer.method
        assert answer.caveat, f"{answer.method} came back without a qualification"
