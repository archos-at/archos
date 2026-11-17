from __future__ import annotations

from pathlib import Path

import ifcopenshell
import ifcopenshell.guid
import pytest
from ifc_spatial import operators as op
from ifc_spatial import operators_vertical
from ifc_spatial.model import SpatialModel

ROOM = (4.0, 4.0, 2.5)


class _Model:
    def __init__(self) -> None:
        f = ifcopenshell.file(schema="IFC4")
        self.f = f
        person = f.create_entity("IfcPerson", FamilyName="x")
        org = f.create_entity("IfcOrganization", Name="x")
        self.hist = f.create_entity(
            "IfcOwnerHistory",
            OwningUser=f.create_entity("IfcPersonAndOrganization", person, org),
            OwningApplication=f.create_entity("IfcApplication", org, "1", "x", "x"),
            ChangeAction="ADDED",
            CreationDate=0,
        )
        self.z = f.create_entity("IfcDirection", DirectionRatios=(0.0, 0.0, 1.0))
        self.x = f.create_entity("IfcDirection", DirectionRatios=(1.0, 0.0, 0.0))
        self.axes = f.create_entity(
            "IfcAxis2Placement3D",
            Location=f.create_entity("IfcCartesianPoint", Coordinates=(0.0, 0.0, 0.0)),
            Axis=self.z,
            RefDirection=self.x,
        )
        units = f.create_entity(
            "IfcUnitAssignment", Units=[f.create_entity("IfcSIUnit", UnitType="LENGTHUNIT", Name="METRE")]
        )
        self.ctx = f.create_entity(
            "IfcGeometricRepresentationContext",
            ContextType="Model",
            CoordinateSpaceDimension=3,
            Precision=1e-5,
            WorldCoordinateSystem=self.axes,
        )
        self.project = f.create_entity(
            "IfcProject",
            GlobalId=_gid(),
            OwnerHistory=self.hist,
            Name="Lichte Hoehe",
            RepresentationContexts=[self.ctx],
            UnitsInContext=units,
        )
        self.placement = f.create_entity("IfcLocalPlacement", RelativePlacement=self.axes)
        self.storey = f.create_entity(
            "IfcBuildingStorey", GlobalId=_gid(), OwnerHistory=self.hist, Name="EG", Elevation=0.0
        )
        self.contained: list = []

    def box(self, cls: str, name: str, box: tuple[float, float, float, float, float, float]):
        x0, y0, z0, x1, y1, z1 = box
        f = self.f
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
        shape = f.create_entity(
            "IfcShapeRepresentation",
            ContextOfItems=self.ctx,
            RepresentationIdentifier="Body",
            RepresentationType="SweptSolid",
            Items=[solid],
        )
        element = f.create_entity(
            cls,
            GlobalId=_gid(),
            OwnerHistory=self.hist,
            Name=name,
            ObjectPlacement=self.placement,
            Representation=f.create_entity("IfcProductDefinitionShape", Representations=[shape]),
        )
        self.contained.append(element)
        return element

    def save(self, path: Path) -> SpatialModel:
        f = self.f
        f.create_entity(
            "IfcRelAggregates",
            GlobalId=_gid(),
            OwnerHistory=self.hist,
            RelatingObject=self.project,
            RelatedObjects=[self.storey],
        )
        f.create_entity(
            "IfcRelContainedInSpatialStructure",
            GlobalId=_gid(),
            OwnerHistory=self.hist,
            RelatedElements=self.contained,
            RelatingStructure=self.storey,
        )
        f.write(str(path))
        return SpatialModel(str(path))


def _gid() -> str:
    return ifcopenshell.guid.new()


def _room(tmp_path: Path, *extra) -> tuple[SpatialModel, str]:
    m = _Model()
    space = m.box("IfcSpace", "Raum", (0.0, 0.0, 0.0, *ROOM[:2], ROOM[2]))
    m.box("IfcSlab", "Decke", (0.0, 0.0, ROOM[2], ROOM[0], ROOM[1], ROOM[2] + 0.2))
    for build in extra:
        build(m)
    return m.save(tmp_path / "raum.ifc"), space.GlobalId


def _clear_height(tmp_path: Path, *extra) -> float:
    model, space = _room(tmp_path, *extra)
    answer = op.clear_height(model, space)
    assert answer.decidable
    return answer.value


def _hovering(cls: str, z0: float):
    def build(m: _Model) -> None:
        m.box(cls, cls, (0.5, 0.5, z0, 3.5, 3.5, z0 + 0.02))

    return build


def _standing(cls: str, height: float):
    def build(m: _Model) -> None:
        m.box(cls, cls, (1.0, 1.0, 0.0, 3.0, 3.0, height))

    return build


def test_a_slab_is_the_clear_height(tmp_path: Path) -> None:
    assert _clear_height(tmp_path) == pytest.approx(2.5, abs=0.01)


def test_a_duct_hanging_into_the_room_lowers_it(tmp_path: Path) -> None:
    assert _clear_height(tmp_path, _hovering("IfcDuctSegment", 1.8)) == pytest.approx(1.8, abs=0.01)


def test_the_nearer_of_two_obstructions_is_the_one_reported(tmp_path: Path) -> None:
    assert _clear_height(tmp_path, _hovering("IfcDuctSegment", 2.2), _hovering("IfcBeam", 1.8)) == pytest.approx(
        1.8, abs=0.01
    )


@pytest.mark.parametrize("cls", ["IfcRamp", "IfcRampFlight", "IfcStair", "IfcStairFlight", "IfcRailing"])
def test_a_ramp_stair_or_railing_overhead_is_not_a_ceiling(tmp_path: Path, cls: str) -> None:
    assert _clear_height(tmp_path, _hovering(cls, 0.5)) == pytest.approx(2.5, abs=0.01)


@pytest.mark.parametrize("cls", ["IfcRamp", "IfcStair"])
def test_a_solid_ramp_or_stair_on_the_floor_is_not_a_ceiling(tmp_path: Path, cls: str) -> None:
    assert _clear_height(tmp_path, _standing(cls, 0.5)) == pytest.approx(2.5, abs=0.01)


def test_a_floor_build_up_the_ray_starts_inside_is_underfoot(tmp_path: Path) -> None:
    def screed(m: _Model) -> None:
        m.box("IfcSlab", "Estrich", (0.0, 0.0, -0.05, ROOM[0], ROOM[1], 0.1))

    assert _clear_height(tmp_path, screed) == pytest.approx(2.5, abs=0.01)


def test_a_plinth_the_ray_starts_inside_is_underfoot_and_a_beam_above_it_still_counts(tmp_path: Path) -> None:
    def plinth_and_beam(m: _Model) -> None:
        m.box("IfcWall", "Sockel", (1.0, 1.0, 0.0, 3.0, 3.0, 0.3))
        m.box("IfcBeam", "Unterzug", (0.5, 0.5, 2.1, 3.5, 3.5, 2.2))

    assert _clear_height(tmp_path, plinth_and_beam) == pytest.approx(2.1, abs=0.01)


def test_the_aggregate_walk_ends_on_a_cycle_and_reports_no_pass_through() -> None:
    f = ifcopenshell.file(schema="IFC4")
    person = f.create_entity("IfcPerson", FamilyName="x")
    org = f.create_entity("IfcOrganization", Name="x")
    hist = f.create_entity(
        "IfcOwnerHistory",
        OwningUser=f.create_entity("IfcPersonAndOrganization", person, org),
        OwningApplication=f.create_entity("IfcApplication", org, "1", "x", "x"),
        ChangeAction="ADDED",
        CreationDate=0,
    )
    wall = f.create_entity("IfcWall", GlobalId=_gid(), OwnerHistory=hist)
    f.create_entity("IfcRelAggregates", GlobalId=_gid(), OwnerHistory=hist, RelatingObject=wall, RelatedObjects=[wall])
    assert operators_vertical._lets_a_clear_height_ray_through(wall) is False
