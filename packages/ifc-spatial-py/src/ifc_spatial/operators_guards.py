from __future__ import annotations

from collections.abc import Sequence
from typing import Any
from typing import NoReturn

from ifc_spatial.operators_constants import _RELATIONS

from .envelope import Answer
from .envelope import MissingFact
from .envelope import undecidable
from .model import ElementGeometry
from .model import SpatialModel
from .model import WrongKindError


def _require(model: SpatialModel, global_id: str, method: str) -> Any:
    return model.by_id(global_id, method)


def _wrong_kind(
    subject: Any,
    method: str,
    operator: str,
    expected: str,
    suggestion: str,
) -> NoReturn:
    raise WrongKindError(
        subject.GlobalId,
        subject.is_a(),
        method,
        operator,
        expected,
        suggestion,
    )


def _no_geometry(model: SpatialModel, subject: Any, method: str, from_: list[str] | None = None) -> Answer[Any]:
    name = model.label(subject) or subject.GlobalId
    reason = model.geometry_failure(subject.GlobalId) or ""

    if reason.startswith("shape-failed") or reason == "empty-mesh":
        detail = reason.split(": ", 1)[1] if ": " in reason else reason
        what = f"auswertbare Körpergeometrie für {subject.is_a()} „{name}“ (der Geometriekern lehnt die Form ab)"
        remedy = (
            "Dieses Bauteil trägt eine Body-Repräsentation, aber der Geometriekern kann daraus keinen "
            f"Körper bauen ({detail[:160]}). Ein erneuter Export „mit Geometrie“ ändert daran nichts — die "
            "Form selbst wird abgelehnt. Typische Ursachen: eine sich selbst schneidende Umrandung, ein "
            "Profil mit Nullfläche, eine nicht geschlossene Schale. Im CAD das Bauteil bzw. den Raum neu "
            "aufziehen und den Export prüfen."
        )
    else:
        what = f"Körpergeometrie für {subject.is_a()} „{name}“"
        remedy = (
            "Dieses Bauteil trägt in dieser Datei keinen Körper (kein auswertbares IfcProductDefinitionShape). "
            "Manche Einträge haben von Haus aus keinen — IfcDoorLiningProperties, IfcWindowLiningProperties, "
            "die Hülle einer Vorhangfassade, deren Paneele die Geometrie tragen. Sonst: das Modell mit "
            "Körpergeometrie neu exportieren (Body-Repräsentation, kein reiner Bounding-Box-Export)."
        )

    return undecidable(
        from_=from_ or [subject.GlobalId],
        method=method,
        provenance="computed",
        missing=MissingFact(what=what, remedy=remedy, elements=[subject.GlobalId]),
    )


def _relation_missing(model: SpatialModel, kinds: Sequence[str]) -> MissingFact:
    ifc = " + ".join(dict.fromkeys(_RELATIONS[k][0] for k in kinds))
    remedy = "; ".join(dict.fromkeys(_RELATIONS[k][1] for k in kinds))
    return MissingFact(what=ifc, remedy=remedy)


def _has(model: SpatialModel, ifc_type: str) -> bool:
    try:
        return len(model.file.by_type(ifc_type)) > 0
    except RuntimeError:
        return False


def _geometry_or_answer(
    model: SpatialModel, subject: Any, method: str, from_: list[str] | None = None
) -> tuple[ElementGeometry | None, Answer[Any] | None]:
    geo = model.geometry(subject.GlobalId)
    if geo is None:
        return None, _no_geometry(model, subject, method, from_)
    return geo, None
