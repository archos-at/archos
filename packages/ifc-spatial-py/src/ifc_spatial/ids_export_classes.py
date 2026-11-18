from __future__ import annotations

from collections.abc import Iterable
from collections.abc import Sequence

from ifcopenshell import ifcopenshell_wrapper

from .model import SpatialModel


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
        if _derives_from_object(entity):
            return True
    return False


def _derives_from_object(entity: object) -> bool:
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
