from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from agent.common.brand import PRODUCT_NAME


@dataclass(frozen=True)
class SourceKind:
    key: str
    label: str
    description: str
    css_token: str


SOURCE_KINDS: dict[str, SourceKind] = {
    "building_law": SourceKind(
        key="building_law",
        label="Baurecht & Richtlinien",
        description="Bauordnung, OIB-Richtlinien, Normen.",
        css_token="building_law",
    ),
    "office": SourceKind(
        key="office",
        label="Büroablage",
        description="Standards, Details und Erfahrung deines Büros.",
        css_token="office",
    ),
    "project": SourceKind(
        key="project",
        label="Projektwissen",
        description="Unterlagen, Bescheide und Dateien dieses Projekts.",
        css_token="project",
    ),
    "web": SourceKind(
        key="web",
        label="Web",
        description="Rechercheergebnisse aus dem Web.",
        css_token="web",
    ),
    "measurement": SourceKind(
        key="measurement",
        label="Modellmessung",
        description="Am BIM-Modell gemessen — mit Herkunft, Toleranz und Methode.",
        css_token="model",
    ),
}

AGENT_AUTHORED_LANE = "office_agent"
AGENT_AUTHORED_LANE_LABEL = f"{PRODUCT_NAME}-Dokument"

MAIL_SOURCE_FORMAT = "mail"

MAIL_LANE = "project_mail"
OFFICE_MAIL_LANE = "office_mail"
MAIL_LANE_LABEL = "E-Mail"

MEASUREMENT_SOURCE_KIND = "measurement"

DEFAULT_SOURCE_KIND = "web"

TOOL_RESULT_SOURCE_TYPE = "tool_result"

_LANE_KIND_PREFIXES: tuple[tuple[str, str], ...] = (
    ("building_law", "building_law"),  # building_law_oib*, _ris, _federal/_state/_ordinance
    ("authority", "building_law"),  # behördliche Information — authoritative building law
    ("external_standard", "building_law"),  # externe Normen belong to the Baurecht kind
    ("office", "office"),
    ("project", "project"),
    ("web", "web"),
    ("measurement", "measurement"),
)


def kind_for_lane(lane_key: str | None) -> str:
    key = (lane_key or "").strip().lower()
    for prefix, kind in _LANE_KIND_PREFIXES:
        if key == prefix or key.startswith(f"{prefix}_"):
            return kind
    return DEFAULT_SOURCE_KIND


def source_kind(key: str | None) -> SourceKind:
    return SOURCE_KINDS.get((key or "").strip().lower(), SOURCE_KINDS[DEFAULT_SOURCE_KIND])


class Shelf(StrEnum):
    OFFICE_SHELF = "office_shelf"
    PROJECT = "project"
    SESSION = "session"
    BASE = "base"


LEGACY_SHELF_VALUES: dict[str, str] = {"archiv": Shelf.OFFICE_SHELF.value}


def canonical_shelf_value(value: str) -> str:
    key = value.strip().lower()
    return LEGACY_SHELF_VALUES.get(key, key)


OFFICE_SHELF_COLLECTION_PREFIX = "archiv_"
OFFICE_SHELF_TARGET_COLLECTION_PREFIX = "office_shelf_"
OFFICE_SHELF_COLLECTION_PREFIXES: tuple[str, ...] = (
    OFFICE_SHELF_TARGET_COLLECTION_PREFIX,
    OFFICE_SHELF_COLLECTION_PREFIX,
)


def is_office_shelf_collection(collection: str | None) -> bool:
    return (collection or "").strip().lower().startswith(OFFICE_SHELF_COLLECTION_PREFIXES)


def office_shelf_organization_id(collection: str | None) -> str | None:
    name = (collection or "").strip()
    for prefix in OFFICE_SHELF_COLLECTION_PREFIXES:
        if name.lower().startswith(prefix):
            return name[len(prefix) :] or None
    return None


def parse_shelf(value: object) -> Shelf | None:
    if isinstance(value, Shelf):
        return value
    if not isinstance(value, str):
        return None
    try:
        return Shelf(canonical_shelf_value(value))
    except ValueError:
        return None


SHELF_QUALIFIERS: dict[Shelf, str] = {
    Shelf.OFFICE_SHELF: "Büroablage",
    Shelf.PROJECT: "Projektwissen",
    Shelf.SESSION: "Private Sitzung",
    Shelf.BASE: "Basiswissen",
}

SCOPE_QUALIFIERS: dict[str, str] = {
    "buero": SHELF_QUALIFIERS[Shelf.OFFICE_SHELF],
    "projekt": SHELF_QUALIFIERS[Shelf.PROJECT],
    "baurecht": SHELF_QUALIFIERS[Shelf.BASE],
    "session": SHELF_QUALIFIERS[Shelf.SESSION],
}

RETIRED_SHELF_QUALIFIERS: dict[str, Shelf] = {
    "Büroarchiv": Shelf.OFFICE_SHELF,
}

READABLE_QUALIFIERS: tuple[str, ...] = (*dict.fromkeys(SCOPE_QUALIFIERS.values()), *RETIRED_SHELF_QUALIFIERS)

_QUALIFIER_SCOPES: dict[str, str] = {label.lower(): scope for scope, label in SCOPE_QUALIFIERS.items()}
_QUALIFIER_SCOPES.update(
    {
        retired.lower(): _QUALIFIER_SCOPES[SHELF_QUALIFIERS[shelf].lower()]
        for retired, shelf in RETIRED_SHELF_QUALIFIERS.items()
    }
)

_QUALIFIER_SHELVES: dict[str, Shelf] = {
    **{label.lower(): shelf for shelf, label in SHELF_QUALIFIERS.items()},
    **{label.lower(): shelf for label, shelf in RETIRED_SHELF_QUALIFIERS.items()},
}


def shelf_qualifier(shelf: Shelf | str | None) -> str | None:
    match parse_shelf(shelf):
        case Shelf.OFFICE_SHELF:
            return SHELF_QUALIFIERS[Shelf.OFFICE_SHELF]
        case Shelf.PROJECT:
            return SHELF_QUALIFIERS[Shelf.PROJECT]
        case Shelf.SESSION:
            return SHELF_QUALIFIERS[Shelf.SESSION]
        case Shelf.BASE:
            return SHELF_QUALIFIERS[Shelf.BASE]
        case None:
            return None
        case other:  # pragma: no cover — unreachable until a member is added
            raise AssertionError(f"unhandled shelf: {other!r}")


def shelf_for_qualifier(qualifier: str | None) -> Shelf | None:
    return _QUALIFIER_SHELVES.get((qualifier or "").strip().lower())


def scope_for_qualifier(qualifier: str | None) -> str | None:
    return _QUALIFIER_SCOPES.get((qualifier or "").strip().lower())


def legacy_shelf_for_collection_name(collection: str | None) -> Shelf | None:
    key = (collection or "").strip().lower()
    if is_office_shelf_collection(key):
        return Shelf.OFFICE_SHELF
    if key.startswith("proj_"):
        return Shelf.PROJECT
    if key.startswith("s_"):
        return Shelf.SESSION
    return None
