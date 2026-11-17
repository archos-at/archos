"""Canonical source-kind taxonomy — the single classification every source is
rendered through (the "Belegt durch" chips, the Herleitung fan-out, the report
sources section).

The product surfaces five *coarse* source kinds, four of them mirroring the
click-dummy ``TYPES`` registry:

- ``building_law`` — authoritative building law: the OIB Richtlinien corpus **and**
  RIS (Bauordnung, Verordnungen, Bundes-/Landesrecht) **and** external Normen.
  OIB corpus hits and RIS hits are the *same* kind — they differ only in the
  fine sub-lane, never in the pathway or the chip.
- ``office`` — Büroablage (the organization's standards, details, experience).
- ``project`` — Projektwissen (this project's plans, Bescheide, uploads).
- ``web`` — web-search results.
- ``measurement`` — a value measured off the project's BIM model.

``measurement`` is the odd one out and deliberately so. The first four are
RETRIEVED PASSAGES: a chunk of a document that a citation resolves to, captured
into :class:`~citations.registry.SourceRegistry` and
verifiable by reading the passage back. A measurement has no passage. It
carries something else — the GlobalIds it was derived from, the operator
expression, an absolute tolerance and a provenance
(:class:`ifc_spatial.envelope.Answer`) — and it is REPRODUCIBLE, which no
quotation is.

That difference is why a measurement is a KIND here and is **not** a
``SourceEntry``. ``citation_grounded`` is derived from the registry's contents,
and it is the one signal that lets an answer surface "high"; the normative
brake in ``piloti.grounding`` is gated on its ABSENCE. A
measurement that entered the registry would therefore hand an answer's uncited
legal verdict the evidence of its own basement measurement — the laundering
path the grounding module exists to close. So measurements travel their own
channel (:mod:`agent.tools.bim.measurement_sources`) and meet the
retrieved sources only on the wire, where this taxonomy is all that is left of
either. See ``packages/agent/tests/core/test_agent.py::
TestMeasurementSourcesDoNotGroundCitations``.

``auto`` exists in the click-dummy as a *selection mode* (the agent picks the
fitting source itself) — it is never a rendered citation and so is not part of
this taxonomy.

The finer lane classification (``norm_registry.lane_for_hit`` — OIB-Richtlinie
vs. Bundesrecht vs. Verordnung …) is preserved as a *sub-label* within a kind;
this module maps those lanes up to the coarse kind that drives the chip colour
and the detail badge. This keeps the rich, deterministic hierarchy in the
registry/filenames while giving every surface one coarse taxonomy to render.

Presentation colours live on the frontend (CSS custom properties keyed by
``css_token`` → ``var(--source-{css_token})``); the backend owns only the
taxonomy + German labels, so both ends share one source of truth.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from agent.common.brand import PRODUCT_NAME


@dataclass(frozen=True)
class SourceKind:
    """One coarse source kind and its stable presentation metadata."""

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
    """Map a fine lane stratum-key (``lane_for_hit``) to a coarse source kind.

    Fail-open to :data:`DEFAULT_SOURCE_KIND` for unknown inputs, mirroring the
    lane classifier so the two never disagree on the fallback.
    """
    key = (lane_key or "").strip().lower()
    for prefix, kind in _LANE_KIND_PREFIXES:
        if key == prefix or key.startswith(f"{prefix}_"):
            return kind
    return DEFAULT_SOURCE_KIND


def source_kind(key: str | None) -> SourceKind:
    """Look up a :class:`SourceKind` by key, fail-open to the default kind."""
    return SOURCE_KINDS.get((key or "").strip().lower(), SOURCE_KINDS[DEFAULT_SOURCE_KIND])


class Shelf(StrEnum):
    """The shelf a retrieved chunk came from. The wire vocabulary of ADR-0047.

    Deliberately its OWN enum, not a subset of :data:`SOURCE_KINDS`: the display
    taxonomy (``baurecht | buero | projekt | web``) is a different axis, and
    conflating the two is what folded private session attachments into
    "Projektwissen".

    The TypeScript twin declares the same four members
    (``apps/workspace/bff/source-kinds.ts``); neither runtime
    imports the other's — three constants declared twice is looser coupling than
    a generated artifact on the core retrieval path.
    """

    OFFICE_SHELF = "office_shelf"
    PROJECT = "project"
    SESSION = "session"
    BASE = "base"


LEGACY_SHELF_VALUES: dict[str, str] = {"archiv": Shelf.OFFICE_SHELF.value}


def canonical_shelf_value(value: str) -> str:
    """A shelf wire value in its current spelling (trimmed, lower-cased, legacy names mapped)."""
    key = value.strip().lower()
    return LEGACY_SHELF_VALUES.get(key, key)


OFFICE_SHELF_COLLECTION_PREFIX = "archiv_"
OFFICE_SHELF_TARGET_COLLECTION_PREFIX = "office_shelf_"
OFFICE_SHELF_COLLECTION_PREFIXES: tuple[str, ...] = (
    OFFICE_SHELF_TARGET_COLLECTION_PREFIX,
    OFFICE_SHELF_COLLECTION_PREFIX,
)


def is_office_shelf_collection(collection: str | None) -> bool:
    """Whether ``collection`` names an office's shelf (either prefix)."""
    return (collection or "").strip().lower().startswith(OFFICE_SHELF_COLLECTION_PREFIXES)


def office_shelf_organization_id(collection: str | None) -> str | None:
    """The organization id behind an office shelf collection name; ``None`` for any other name."""
    name = (collection or "").strip()
    for prefix in OFFICE_SHELF_COLLECTION_PREFIXES:
        if name.lower().startswith(prefix):
            return name[len(prefix) :] or None
    return None


def parse_shelf(value: object) -> Shelf | None:
    """Narrow a wire value to a :class:`Shelf`; ``None`` when unknown.

    Fails CLOSED: anything that is not one of the four members — a missing
    field, a stale label, a collection id — is unknown, never ``base``.
    """
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
    """The citation-key qualifier for ``shelf``; ``None`` when the shelf is unknown.

    Exhaustive over :class:`Shelf`: the final ``case`` is a guard, so adding a
    member without deciding how it renders raises here instead of silently
    rendering as unattributed.
    """
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
    """Inverse of :func:`shelf_qualifier` — read a key's qualifier back to a shelf.

    Accepts the legacy qualifiers unchanged (they are the same four strings), so
    a citation key persisted before ADR-0047 still resolves.
    """
    return _QUALIFIER_SHELVES.get((qualifier or "").strip().lower())


def scope_for_qualifier(qualifier: str | None) -> str | None:
    """LEGACY: a key's qualifier back to the pre-ADR-0047 coarse-scope token.

    Kept for readers that still speak the old ``buero``/``projekt``/``baurecht``
    vocabulary. New code wants :func:`shelf_for_qualifier`.
    """
    return _QUALIFIER_SCOPES.get((qualifier or "").strip().lower())


def legacy_shelf_for_collection_name(collection: str | None) -> Shelf | None:
    """LEGACY ROLLOUT FALLBACK — guess a shelf from a collection id. REMOVE ME.

    ADR-0047 deletes shelf-by-prefix inference. This is the ONE place the guess
    survives, for exactly one reason: payloads produced BEFORE the shelf
    travelled (an old BFF sending a bare-string scope header, a citation payload
    persisted by a previous deploy) carry a collection name and nothing else.
    Delete this function — and every call to it — once no such producer is left.

    Returns ``None`` for anything it does not recognise. The predecessor
    (``collection_scope``) fell OPEN to ``baurecht``, so an unknown collection
    claimed to be authoritative building law; unknown now means unknown, and an
    unknown shelf renders unattributed.
    """
    key = (collection or "").strip().lower()
    if is_office_shelf_collection(key):
        return Shelf.OFFICE_SHELF
    if key.startswith("proj_"):
        return Shelf.PROJECT
    if key.startswith("s_"):
        return Shelf.SESSION
    return None
