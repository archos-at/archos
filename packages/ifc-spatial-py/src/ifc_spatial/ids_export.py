from __future__ import annotations

import hashlib
import os
import re
import tempfile
from collections.abc import Iterable
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from ifcopenshell import ifcopenshell_wrapper
from ifctester import ids as ifctester_ids
from ifctester.facet import Attribute
from ifctester.facet import Entity
from ifctester.facet import Facet
from ifctester.facet import PartOf
from ifctester.facet import Property
from ifctester.facet import Restriction

from .briefing import DECISIVE_PROPERTIES
from .briefing import Briefing
from .briefing import briefing as build_briefing
from .briefing import content_hash
from .envelope import Answer
from .model import SpatialModel

from .tools import ToolError


IFC_VERSIONS: tuple[str, ...] = ("IFC2X3", "IFC4", "IFC4X3_ADD2")

NO_THRESHOLD_NOTE = (
    "Diese Prüfung verlangt nur, DASS das Merkmal vorhanden und auswertbar ist. Welcher Wert zulässig ist, "
    "steht in der OIB-Richtlinie und wird hier nicht geprüft."
)

WHY_NO_SPACE_BOUNDARY = (
    "IDS 1.0 kennt dafür kein Facet: die relation-Aufzählung des partOf-Facets umfasst nur IfcRelAggregates, "
    "IfcRelAssignsToGroup, IfcRelContainedInSpatialStructure, IfcRelNests und "
    "IfcRelVoidsElement+IfcRelFillsElement — Raumbegrenzungen sind nicht darunter. Über das entity-Facet ließe "
    "sich IfcRelSpaceBoundary zwar anwendbar machen, aber ein Prüfprogramm darf Beziehungsobjekte übergehen "
    "und meldet die Spezifikation dann als bestanden. Ein stiller Haken auf einen Befund, der offen ist, wäre "
    "schlimmer als dieser Hinweis."
)

WHY_NO_GEOMETRY = (
    "IDS beschreibt, welche Merkmale und Beziehungen ein Modell führen muss, nicht seine Geometrie. Für "
    "Körper, Abstände, lichte Maße und fehlende Volumenkörper gibt es kein Facet."
)

WHY_NOT_ABOUT_THE_MODEL = (
    "Kein Befund über das Modell, sondern über diesen Auswertungslauf. So etwas gehört nicht in eine Datei, "
    "die der Architekt gegen sein Modell laufen lässt — sie würde ihn zu einer Änderung auffordern, die an "
    "seinem Export nichts zu ändern hat."
)

WHY_NO_TRUE_NORTH = (
    "Die Nordrichtung hängt am IfcGeometricRepresentationContext. Das ist kein IfcObjectDefinition, also für "
    "die Anwendbarkeit einer IDS-Spezifikation nicht erreichbar, und TrueNorth ist weder Merkmal noch "
    "Beziehung im Sinne der IDS-Facets."
)

WHY_NO_FACET = (
    "Für diesen Befund ist kein IDS-Facet bekannt: er benennt weder ein Merkmal in einem Property-Set noch "
    "ein Attribut eines Bauteils noch eine der fünf Beziehungen, die IDS 1.0 ausdrücken kann."
)

WHY_NO_ELEMENTS = (
    "Dieses Modell enthält keine Bauteile der Klassen, an denen dieses Merkmal geführt wird — eine "
    "IDS-Spezifikation darauf hätte nichts, worauf sie anwendbar wäre."
)




@dataclass(frozen=True)
class PropertyTarget:

    concept: str
    property: str
    pset: str
    classes: tuple[str, ...]
    standard: bool = True


_WALLS = ("IfcWall", "IfcWallStandardCase")
_DOORS = ("IfcDoor", "IfcDoorStandardCase")
_WINDOWS = ("IfcWindow", "IfcWindowStandardCase")
_SLABS = ("IfcSlab", "IfcSlabStandardCase", "IfcSlabElementedCase")

PROPERTY_TARGETS: tuple[PropertyTarget, ...] = (
    PropertyTarget("Feuerwiderstand", "FireRating", "Pset_WallCommon", _WALLS),
    PropertyTarget("Feuerwiderstand", "FireRating", "Pset_DoorCommon", _DOORS),
    PropertyTarget("Feuerwiderstand", "FireRating", "Pset_SlabCommon", _SLABS),
    PropertyTarget("Brennbarkeit", "Combustible", "Pset_WallCommon", _WALLS),
    PropertyTarget("Brennbarkeit", "Combustible", "Pset_SlabCommon", _SLABS),
    PropertyTarget("Brennbarkeit", "Combustible", "Pset_CoveringCommon", ("IfcCovering",)),
    PropertyTarget("U-Wert", "ThermalTransmittance", "Pset_WallCommon", _WALLS),
    PropertyTarget("U-Wert", "ThermalTransmittance", "Pset_WindowCommon", _WINDOWS),
    PropertyTarget("U-Wert", "ThermalTransmittance", "Pset_DoorCommon", _DOORS),
    PropertyTarget("U-Wert", "ThermalTransmittance", "Pset_SlabCommon", _SLABS),
    PropertyTarget("Schallschutz", "AcousticRating", "Pset_WallCommon", _WALLS),
    PropertyTarget("Schallschutz", "AcousticRating", "Pset_DoorCommon", _DOORS),
    PropertyTarget("Schallschutz", "AcousticRating", "Pset_SlabCommon", _SLABS),
    PropertyTarget("tragend", "LoadBearing", "Pset_WallCommon", _WALLS),
    PropertyTarget("tragend", "LoadBearing", "Pset_SlabCommon", _SLABS),
    PropertyTarget("tragend", "LoadBearing", "Pset_ColumnCommon", ("IfcColumn",)),
    PropertyTarget("tragend", "LoadBearing", "Pset_BeamCommon", ("IfcBeam",)),
    PropertyTarget("außenliegend", "IsExternal", "Pset_WallCommon", _WALLS),
    PropertyTarget("außenliegend", "IsExternal", "Pset_WindowCommon", _WINDOWS),
    PropertyTarget("außenliegend", "IsExternal", "Pset_DoorCommon", _DOORS),
    PropertyTarget("Raumfläche", "NetFloorArea", "Qto_SpaceBaseQuantities", ("IfcSpace",)),
    PropertyTarget("Höhe", "Height", "Qto_SpaceBaseQuantities", ("IfcSpace",)),
    PropertyTarget("Brüstungshöhe", "SillHeight", "Pset_WindowCommon", _WINDOWS, standard=False),
)

_CONVENTION_NOTE = {
    "SillHeight": (
        "Achtung: SillHeight ist in IFC4 kein Merkmal der Vorlage Pset_WindowCommon — dort stehen nur "
        "HasSillExternal und HasSillInternal. Wo ein Exporteur die Brüstungshöhe ablegt, ist nicht genormt; "
        "diese Spezifikation verlangt den Pfad, den dieses Werkzeug liest."
    )
}




@dataclass(frozen=True)
class NotExportable:

    what: str
    why: str

    def to_dict(self) -> dict[str, str]:
        return {"what": self.what, "why": self.why}


@dataclass(frozen=True)
class IdsShoppingList:

    ids: Any
    exported: list[str]
    not_exportable: list[NotExportable]
    source: str

    @property
    def specifications(self) -> int:
        return len(self.ids.specifications)

    def summary(self) -> str:
        total = len(self.exported) + len(self.not_exportable)
        if total == 0:
            return "Keine Befunde — es gibt nichts zu exportieren."
        head = (
            f"{len(self.exported)} von {total} Befunden sind als IDS ausdrückbar "
            f"({self.specifications} Spezifikation{'' if self.specifications == 1 else 'en'})."
        )
        if not self.not_exportable:
            return head
        return head + " Nicht ausdrückbar: " + "; ".join(entry.what for entry in self.not_exportable) + "."

    def to_dict(self) -> dict[str, Any]:
        return {
            "source": self.source,
            "specifications": self.specifications,
            "exported": list(self.exported),
            "notExportable": [entry.to_dict() for entry in self.not_exportable],
            "summary": self.summary(),
        }


class IdsExportError(Exception):
    ...




def blind_spots_as_ids(
    model: SpatialModel,
    *,
    title: str | None = None,
    author: str | None = None,
    date: str | None = None,
    brief: Briefing | None = None,
) -> IdsShoppingList:
    b = brief if brief is not None else build_briefing(model)
    present = _classes_present(model)

    specifications: list[Any] = []
    exported: list[str] = []
    not_exportable: list[NotExportable] = []

    for spot in b.blind_spots:
        built, reason = _blind_spot_specification(spot.what, spot.remedy, present)
        if built is None:
            not_exportable.append(NotExportable(what=spot.what, why=reason or WHY_NO_FACET))
        else:
            _append(specifications, built)
            exported.append(spot.what)

    for entry in b.absent_properties:
        finding = f"{entry['concept']} ({entry['property']}) nirgends befüllt"
        built = [
            _property_specification(target, present)
            for target in PROPERTY_TARGETS
            if target.property == entry["property"] and _intersect(target.classes, present)
        ]
        if not built:
            not_exportable.append(NotExportable(what=finding, why=_why_no_property_target(entry["property"], present)))
            continue
        _append(specifications, built)
        exported.append(finding)

    identity = f"{b.source_name or 'IFC-Datei ohne Namen im Header'} (sha {b.content_hash[:8]})"
    document = _document(
        title=title or "Was diesem Modell fehlt",
        description=(
            f"Abgeleitet aus {identity} durch ifc-spatial. Jede Spezifikation verlangt, dass eine Angabe "
            "VORHANDEN ist — keine verlangt einen bestimmten Wert."
        ),
        author=author,
        date=date,
        specifications=specifications,
    )
    return IdsShoppingList(
        ids=document,
        exported=exported,
        not_exportable=not_exportable,
        source=content_hash(model),
    )




def answers_as_ids(
    answers: Sequence[Answer[Any]],
    *,
    title: str | None = None,
    author: str | None = None,
    date: str | None = None,
    model: SpatialModel | None = None,
) -> IdsShoppingList:
    present = _classes_present(model) if model is not None else None

    specifications: list[Any] = []
    exported: list[str] = []
    not_exportable: list[NotExportable] = []
    seen: set[str] = set()
    undecided = 0

    for answer in answers:
        if answer.decidable or answer.missing is None:
            continue
        undecided += 1
        what = answer.missing.what
        if what in seen:
            continue
        seen.add(what)
        built, reason = _missing_specification(answer, model, present)
        if built is None:
            not_exportable.append(NotExportable(what=what, why=reason or WHY_NO_FACET))
        else:
            _append(specifications, built)
            exported.append(what)

    document = _document(
        title=title or "Was für diese Fragen im Modell fehlt",
        description=(
            f"Aus {undecided} unentscheidbaren von {len(answers)} Antworten abgeleitet. Jede Spezifikation "
            "verlangt, dass eine Angabe VORHANDEN ist — keine verlangt einen bestimmten Wert."
        ),
        author=author,
        date=date,
        specifications=specifications,
    )
    return IdsShoppingList(
        ids=document,
        exported=exported,
        not_exportable=not_exportable,
        source=f"{undecided} von {len(answers)} Antworten unentscheidbar",
    )




def to_xml(document: IdsShoppingList | Any) -> str:
    ids_document = document.ids if isinstance(document, IdsShoppingList) else document
    if not ids_document.specifications:
        raise IdsExportError(
            "Ein IDS ohne Spezifikation ist nach der XSD ungültig (specifications verlangt mindestens eine). "
            "Es gibt für dieses Modell nichts in IDS auszudrücken."
        )
    xml = ids_document.to_string()
    if not ifctester_ids.get_schema().is_valid(xml):
        raise IdsExportError("Das erzeugte IDS ist nach ids.xsd 1.0 ungültig — es wird nicht geschrieben.")
    return xml


def _checked_name(name: str) -> str:
    if not name or name in (".", ".."):
        raise ToolError('name muss ein Dateiname sein — "", "." und ".." sind keine gültigen Dateinamen.')
    if "\x00" in name:
        raise ToolError("name enthält ein Nullbyte und ist kein gültiger Dateiname.")
    if os.path.isabs(name) or os.path.splitdrive(name)[0]:
        raise ToolError(f'name muss ein Dateiname ohne Pfad sein, nicht "{name}" — Ordner über directory angeben.')
    if "/" in name or "\\" in name:
        raise ToolError(f'name darf keine Pfadtrennzeichen enthalten, "{name}" tut es — Ordner über directory angeben.')
    return name


def write_ids(
    document: IdsShoppingList,
    *,
    directory: str | None = None,
    name: str | None = None,
) -> dict[str, Any]:
    checked = _checked_name(name) if name is not None else None

    if not document.ids.specifications:
        return {
            "path": None,
            "specifications": 0,
            "exported": list(document.exported),
            "notExportable": [entry.to_dict() for entry in document.not_exportable],
            "note": (
                "Kein IDS geschrieben: aus den Befunden dieses Modells lässt sich keine IDS-Spezifikation "
                "bilden. " + document.summary()
            ),
        }

    xml = to_xml(document)
    payload = '<?xml version="1.0" encoding="UTF-8"?>\n' + xml
    target_directory = directory or tempfile.mkdtemp(prefix="ifc-spatial-")
    os.makedirs(target_directory, exist_ok=True)
    digest = hashlib.sha256(payload.encode("utf-8")).hexdigest()[:8]
    path = os.path.join(target_directory, checked or f"fehlt-{digest}.ids")
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(payload)

    return {
        "path": path,
        "bytes": len(payload.encode("utf-8")),
        "specifications": document.specifications,
        "exported": list(document.exported),
        "notExportable": [entry.to_dict() for entry in document.not_exportable],
        "note": (
            "Die Datei ist eine buildingSMART IDS 1.0 und läuft in Solibri, BIMcollab, usBIM oder ifctester "
            "gegen das eigene Modell. Sie verlangt ausschließlich das VORHANDENSEIN von Angaben, keine "
            "Grenzwerte — Grenzwerte stehen in der OIB-Richtlinie. " + document.summary()
        ),
    }




def _document(
    *,
    title: str,
    description: str,
    author: str | None,
    date: str | None,
    specifications: Sequence[Any],
) -> Any:
    document = ifctester_ids.Ids(
        title=title,
        description=description,
        author=author,
        date=date,
        purpose="Nachweis, dass die für eine OIB-Prüfung nötigen Angaben im Modell vorhanden sind",
    )
    document.specifications = list(specifications)
    return document


def _specification(
    *,
    name: str,
    description: str,
    instructions: str,
    applicability: Sequence[Facet],
    requirements: Sequence[Facet] = (),
    required: bool = False,
) -> Any:
    spec = ifctester_ids.Specification(
        name=name,
        minOccurs=1 if required else 0,
        maxOccurs="unbounded",
        ifcVersion=list(IFC_VERSIONS),
        description=description,
        instructions=instructions,
    )
    spec.applicability = list(applicability)
    spec.requirements = list(requirements)
    return spec


def _property_specification(target: PropertyTarget, present: Sequence[str] | None) -> Any:
    classes = _intersect(target.classes, present) if present is not None else list(target.classes)
    footing = _CONVENTION_NOTE.get(target.property) if not target.standard else None
    description = (
        f"{target.concept} ist in diesem Export nirgends befüllt. Eine Abfrage darauf liefert leer — das "
        "liest sich wie „nein“, ist aber „unbekannt“."
    )
    if footing:
        description = f"{description} {footing}"
    return _specification(
        name=f"{target.concept} vorhanden ({target.pset}.{target.property})",
        description=description,
        instructions=(
            f"{target.concept} im CAD pflegen und im Property-Set {target.pset} mitexportieren. {NO_THRESHOLD_NOTE}"
        ),
        applicability=[_entity_facet(classes)],
        requirements=[Property(propertySet=target.pset, baseName=target.property, cardinality="required")],
    )


def _blind_spot_specification(what: str, remedy: str, present: Sequence[str]) -> tuple[list[Any] | None, str | None]:
    if "keine IfcSpace-Elemente" in what:
        return [
            _specification(
                name="Räume als IfcSpace exportiert",
                description=(
                    "Dieser Export enthält keine IfcSpace. Ohne Räume ist keine Raumfläche, keine Raumtiefe "
                    "und nichts je Aufenthaltsraum ableitbar."
                ),
                instructions=f"{remedy}. {NO_THRESHOLD_NOTE}",
                applicability=[Entity(name="IFCSPACE")],
                required=True,
            )
        ], None

    if "IfcRelSpaceBoundary" in what:
        return None, WHY_NO_SPACE_BOUNDARY

    if "IfcRelFillsElement" in what or "ohne auflösbare Wandzuordnung" in what:
        return [_openings_hosted_specification(remedy, present)], None

    if "keine Nordrichtung" in what:
        return None, WHY_NO_TRUE_NORTH

    if "keine Georeferenzierung" in what:
        return [_georeference_specification(remedy)], None

    if "Geometrie-Pass" in what or "Stichprobe" in what:
        return None, WHY_NOT_ABOUT_THE_MODEL

    if "ohne Volumenkörper" in what:
        return None, WHY_NO_GEOMETRY

    return None, WHY_NO_FACET


def _openings_hosted_specification(remedy: str, present: Sequence[str] | None) -> Any:
    classes = (_intersect((*_WINDOWS, *_DOORS), present) if present else []) or [*_WINDOWS, *_DOORS]
    return _specification(
        name="Fenster und Türen einer Öffnung zugeordnet",
        description=(
            "Ohne IfcRelVoidsElement + IfcRelFillsElement lässt sich zu keinem Fenster und keiner Tür sagen, "
            "in welchem Bauteil sie sitzt. Jede Frage nach der Wand hinter einem Fenster bleibt dann offen."
        ),
        instructions=f"{remedy}. {NO_THRESHOLD_NOTE}",
        applicability=[_entity_facet(classes)],
        requirements=[
            PartOf(
                name=Restriction(options={"pattern": ["IFC.*"]}),
                relation="IFCRELVOIDSELEMENT IFCRELFILLSELEMENT",
                cardinality="required",
            )
        ],
    )


def _georeference_specification(remedy: str) -> Any:
    return _specification(
        name="Georeferenzierung am IfcSite",
        description=(
            "Ohne Georeferenzierung sind Sonnenstand und Besonnung nicht berechenbar. IDS erreicht davon nur "
            "den Weg über IfcSite.RefLatitude/RefLongitude — ein IfcMapConversion kann IDS 1.0 nicht "
            "verlangen, dieser Nachweis ist also der kleinere von beiden."
        ),
        instructions=f"{remedy}. {NO_THRESHOLD_NOTE}",
        applicability=[Entity(name="IFCSITE")],
        requirements=[
            Attribute(name="RefLatitude", cardinality="required"),
            Attribute(name="RefLongitude", cardinality="required"),
        ],
        required=True,
    )


def _missing_specification(
    answer: Answer[Any], model: SpatialModel | None, present: Sequence[str] | None
) -> tuple[list[Any] | None, str | None]:
    missing = answer.missing
    assert missing is not None  # guarded by the caller
    what = missing.what
    remedy = missing.remedy
    head = re.split(r"\s+[(„]|\s+für\s+", what)[0].strip()

    if head in ("IfcRelVoidsElement + IfcRelFillsElement", "IfcRelFillsElement", "IfcRelVoidsElement"):
        return [_openings_hosted_specification(remedy, present)], None

    if head == "IfcRelContainedInSpatialStructure":
        classes = _classes_of(model, missing.elements)
        if not classes:
            return None, (
                "IfcRelContainedInSpatialStructure ist als partOf-Facet ausdrückbar, aber eine "
                "IDS-Spezifikation braucht dafür konkrete Bauteilklassen. Diese Antwort nennt nur GlobalIds; "
                "ohne das Modell ist nicht bestimmbar, für welche Klassen die Zuordnung verlangt werden soll."
            )
        return [
            _specification(
                name="Bauteile einem Geschoß zugeordnet",
                description=(
                    "Ohne IfcRelContainedInSpatialStructure ist zu diesen Bauteilen kein Geschoß bestimmbar — "
                    "jede Auswertung je Geschoß lässt sie aus, ohne dass es auffällt."
                ),
                instructions=f"{remedy}. {NO_THRESHOLD_NOTE}",
                applicability=[_entity_facet(classes)],
                requirements=[
                    PartOf(
                        name=Restriction(options={"pattern": ["IFCBUILDINGSTOREY|IFCBUILDING|IFCSITE"]}),
                        relation="IFCRELCONTAINEDINSPATIALSTRUCTURE",
                        cardinality="required",
                    )
                ],
            )
        ], None

    if head.startswith("IfcRel"):
        return None, (
            WHY_NO_SPACE_BOUNDARY
            if head.startswith("IfcRelSpaceBoundary")
            else (
                f"{head} gehört nicht zu den fünf Beziehungen, die das partOf-Facet von IDS 1.0 kennt "
                "(IfcRelAggregates, IfcRelAssignsToGroup, IfcRelContainedInSpatialStructure, IfcRelNests, "
                "IfcRelVoidsElement+IfcRelFillsElement)."
            )
        )

    dotted = re.fullmatch(r"([A-Za-z][\w]*)\.([A-Za-z][\w]*)", head)
    if dotted:
        owner, member = dotted.group(1), dotted.group(2)
        if owner.startswith(("Pset_", "Qto_", "CPset_")):
            return _property_path_specification(owner, member, remedy, present)
        if _object_class(owner):
            return [
                _specification(
                    name=f"{owner}.{member} vorhanden",
                    description=(
                        f"Dieser Export lässt {member} an {owner} offen. Die Frage ist damit nicht "
                        "unbeantwortbar, sondern unbeantwortet — die Angabe fehlt in der Datei."
                    ),
                    instructions=f"{remedy} {NO_THRESHOLD_NOTE}",
                    applicability=[Entity(name=owner.upper())],
                    requirements=[Attribute(name=member, cardinality="required")],
                    required=False,
                )
            ], None
        return None, (
            f"{owner} ist kein IfcObjectDefinition — eine IDS-Spezifikation kann darauf nicht anwendbar sein, "
            f"und {member} ist damit weder als Attribut- noch als Merkmals-Facet erreichbar."
        )

    if re.fullmatch(r"Ifc[A-Za-z0-9]+", head):
        if not _object_class(head):
            return None, (
                f"{head} ist im IFC-Schema kein IfcObjectDefinition — als Anwendbarkeit einer "
                "IDS-Spezifikation ist die Klasse nicht erreichbar."
            )
        return [
            _specification(
                name=f"{head} im Modell vorhanden",
                description=f"Dieser Export enthält keine {head}. Alles, was darauf aufbaut, bleibt offen.",
                instructions=f"{remedy} {NO_THRESHOLD_NOTE}",
                applicability=[Entity(name=head.upper())],
                required=True,
            )
        ], None

    return None, WHY_NO_FACET


def _property_path_specification(
    pset: str, name: str, remedy: str, present: Sequence[str] | None
) -> tuple[list[Any] | None, str | None]:
    known = [t for t in PROPERTY_TARGETS if t.pset == pset and t.property == name]
    if known:
        target = known[0]
        classes = _intersect(target.classes, present) if present is not None else list(target.classes)
        if not classes:
            return None, WHY_NO_ELEMENTS
        return [_property_specification(target, classes)], None

    classes = _pset_classes(pset)
    if not classes:
        return None, (
            f"Zu {pset} ist keine Bauteilklasse bestimmbar — weder aus der IFC-Vorlage noch aus der Tabelle "
            "dieses Moduls. Eine IDS-Spezifikation ohne Anwendbarkeit gibt es nicht."
        )
    narrowed = _intersect(classes, present) if present is not None else classes
    if not narrowed:
        return None, WHY_NO_ELEMENTS
    target = PropertyTarget(concept=name, property=name, pset=pset, classes=tuple(narrowed), standard=True)
    return [
        _specification(
            name=f"{pset}.{name} vorhanden",
            description=f"Dieser Export befüllt {pset}.{name} nicht. Eine Abfrage darauf liefert leer.",
            instructions=f"{remedy} {NO_THRESHOLD_NOTE}",
            applicability=[_entity_facet(narrowed)],
            requirements=[Property(propertySet=pset, baseName=name, cardinality="required")],
        )
    ], None




def _entity_facet(classes: Sequence[str]) -> Entity:
    names = sorted(dict.fromkeys(c.upper() for c in classes))
    if not names:
        raise IdsExportError("Eine IDS-Anwendbarkeit ohne IFC-Klasse gibt es nicht.")
    if len(names) == 1:
        return Entity(name=names[0])
    return Entity(name=Restriction(options={"enumeration": names}))


def _classes_present(model: SpatialModel) -> list[str]:
    try:
        return sorted({element.is_a() for element in model.file.by_type("IfcProduct")})
    except RuntimeError:
        return []


def _classes_of(model: SpatialModel | None, global_ids: Sequence[str] | None) -> list[str]:
    if model is None or not global_ids:
        return []
    found: list[str] = []
    for global_id in global_ids:
        try:
            found.append(model.file.by_guid(global_id).is_a())
        except RuntimeError, KeyError:
            continue
    return sorted(dict.fromkeys(found))


def _pset_classes(pset: str) -> list[str]:
    import ifcopenshell.util.pset as pset_util

    for schema in ("IFC4", "IFC2X3"):
        try:
            template = pset_util.get_template(schema).get_by_name(pset)
        except Exception:
            continue
        if template is None or not template.ApplicableEntity:
            continue
        return sorted({part.split("/")[0].strip() for part in template.ApplicableEntity.split(",") if part.strip()})
    return []


_OBJECT_ROOT = "IfcObjectDefinition"


def _object_class(name: str) -> bool:
    for schema_name in ("IFC4", "IFC4X3_ADD2", "IFC2X3"):
        try:
            schema = ifcopenshell_wrapper.schema_by_name(schema_name)
            entity = schema.declaration_by_name(name).as_entity()
        except Exception:
            continue
        while entity is not None:
            if entity.name() == _OBJECT_ROOT:
                return True
            entity = entity.supertype()
    return False


def _intersect(classes: Iterable[str], present: Sequence[str] | None) -> list[str]:
    if present is None:
        return list(classes)
    available = {name.lower() for name in present}
    return [name for name in classes if name.lower() in available]


def _append(specifications: list[Any], built: Sequence[Any]) -> None:
    names = {spec.name for spec in specifications}
    for spec in built:
        if spec.name in names:
            continue
        names.add(spec.name)
        specifications.append(spec)


def _why_no_property_target(property_name: str, present: Sequence[str]) -> str:
    targets = [t for t in PROPERTY_TARGETS if t.property == property_name]
    if not targets:
        concept = next((c for c, p in DECISIVE_PROPERTIES if p == property_name), property_name)
        return (
            f"Für {concept} ({property_name}) ist in diesem Modul kein Property-Set und keine Bauteilklasse "
            "hinterlegt — ohne beides gibt es keine IDS-Spezifikation."
        )
    wanted = sorted({name for target in targets for name in target.classes})
    return f"{WHY_NO_ELEMENTS} Verlangt würde es an: {', '.join(wanted)}."


__all__ = [
    "IFC_VERSIONS",
    "PROPERTY_TARGETS",
    "IdsExportError",
    "IdsShoppingList",
    "NotExportable",
    "PropertyTarget",
    "answers_as_ids",
    "blind_spots_as_ids",
    "to_xml",
    "write_ids",
]
