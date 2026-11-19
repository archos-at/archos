from __future__ import annotations

import hashlib
import os
import tempfile
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from ifctester import ids as ifctester_ids

from .briefing import Briefing
from .briefing import briefing as build_briefing
from .briefing import content_hash
from .envelope import Answer
from .ids_export_classes import _classes_present
from .ids_export_classes import _intersect
from .ids_export_specs import IFC_VERSIONS
from .ids_export_specs import IdsExportError
from .ids_export_specs import _append
from .ids_export_specs import _blind_spot_specification
from .ids_export_specs import _missing_specification
from .ids_export_specs import _property_specification
from .ids_export_specs import _why_no_property_target
from .ids_export_targets import PROPERTY_TARGETS
from .ids_export_targets import WHY_NO_FACET
from .ids_export_targets import PropertyTarget
from .model import SpatialModel
from .tools import ToolError


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
