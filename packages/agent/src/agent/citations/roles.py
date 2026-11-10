"""What an edition is to this turn's site, from the platform's records (ADR-0168).

The BFF resolves the project's site against the knowledge records and sends
the turn the chain text and every edition's role (``buildingLaw`` in the turn
context, ``apps/workspace/bff/base-knowledge/chain/wire.ts``). This module
holds them for the turn and answers, for a retrieved passage, which edition
it is a text of and what that edition is here. It is the only source of
a source's binding status (ADR-0175): where the records name no role for a
passage, its status is ``unknown`` and the chip shows none. The guesses that
came before it (a host regex, a filename prefix, a doc class, a registry
rank) are gone with ``citations/binding.py``.

A role is computed from a route, never stored (design §3.5). The coarse
status the citation chip shows stays the one the UI knows:

- law in its territory binds (``binding``);
- an edition a law makes binding is ``declared_binding``, as the WBTV makes
  OIB-RL 2:2023 binding in Wien, and so is an authority's practice, as the
  registry's ``authority_info`` rank always was;
- an edition that only guides or interprets is ``interpretive``: OIB-RL
  2:2023 in Steiermark, where the 2019 edition binds (defect 7);
- information is ``unknown``: the UI shows no chip rather than a false one.

Per turn and fail closed: bound once before the graph starts, ``None``
included (that is the reset), and a malformed use is dropped, never guessed.
Only a base-corpus passage maps to an edition: an office's copy that happens
to share a file name is the office's, and its label is the office layer's.
"""

from __future__ import annotations

import contextvars
from dataclasses import dataclass
from typing import Any

from agent.citations.citation_keys import entry_shelf
from agent.citations.citation_keys import parse_citation_key
from agent.citations.entries import SourceEntry
from agent.common.norm_registry import canonical_oib_file_name
from agent.common.source_kinds import Shelf

#: The roles an edition can have (design §3.5); the TypeScript source is
#: ``EDITION_ROLES`` in ``apps/workspace/bff/base-knowledge/wire/vocab.ts``.
EDITION_ROLES: tuple[str, ...] = ("binding", "guidance", "interpretation", "authority_practice", "information")

#: How a role arose: law in its territory, a relation's route, or nothing (a norm no route reaches).
ROUTE_VIAS: tuple[str, ...] = ("territory", "relation", "none")

#: Most uses a turn holds; the BFF's own bound (``MAX_TURN_USES``).
MAX_USES = 40

#: Longest chain text kept; the BFF's text is far shorter, this only bounds a broken one.
MAX_TEXT_CHARS = 12_000


@dataclass(frozen=True)
class BindingClassification:
    """A source's coarse binding status, as the citation chip shows it.

    ``binding`` / ``declared_binding`` / ``interpretive`` / ``unknown``. The default
    is ``unknown``: a passage no edition role reaches gets no badge, because a
    fabricated binding badge would be a false legal claim.
    """

    binding_status: str = "unknown"


#: The German binding statuses an older pod wrote into the shared session cache
#: (and onto the wire) before the English names. Read-only: nothing writes these.
LEGACY_BINDING_STATUS: dict[str, str] = {
    "bindend": "binding",
    "verbindlich_erklaert": "declared_binding",
    "auslegend": "interpretive",
    "unbekannt": "unknown",
}


@dataclass(frozen=True)
class EditionUse:
    """One edition's role at the turn's site."""

    work_id: str
    edition_id: str | None
    role: str
    via: str
    qualifier: str | None = None
    corpus_files: tuple[str, ...] = ()
    designation: str | None = None
    edition_label: str | None = None


@dataclass(frozen=True)
class BuildingLaw:
    """The turn's building law: the chain text and every edition's role."""

    text: str
    chain: tuple[str, ...]
    date: str
    uses: tuple[EditionUse, ...]


def _text(value: object) -> str | None:
    return value if isinstance(value, str) and value else None


def _use(raw: object) -> EditionUse | None:
    if not isinstance(raw, dict):
        return None
    work_id, role, via = _text(raw.get("workId")), raw.get("role"), raw.get("via")
    if work_id is None or role not in EDITION_ROLES or via not in ROUTE_VIAS:
        return None
    files = raw.get("corpusFiles")
    return EditionUse(
        work_id=work_id,
        edition_id=_text(raw.get("editionId")),
        role=str(role),
        via=str(via),
        qualifier="office_maintained" if raw.get("qualifier") == "office_maintained" else None,
        corpus_files=tuple(name for name in files if isinstance(name, str)) if isinstance(files, list) else (),
        designation=_text(raw.get("designation")),
        edition_label=_text(raw.get("editionLabel")),
    )


def parse_building_law(raw: object) -> BuildingLaw | None:
    """The turn context's ``buildingLaw``, or None when absent or not the shape the BFF sends. Pure."""
    if not isinstance(raw, dict):
        return None
    text, date, chain, uses = _text(raw.get("text")), _text(raw.get("date")), raw.get("chain"), raw.get("uses")
    if text is None or date is None or not isinstance(chain, list) or not isinstance(uses, list):
        return None
    parsed = tuple(use for use in (_use(item) for item in uses[:MAX_USES]) if use is not None)
    return BuildingLaw(
        text=text[:MAX_TEXT_CHARS],
        chain=tuple(item for item in chain if isinstance(item, str)),
        date=date,
        uses=parsed,
    )


_turn_building_law: contextvars.ContextVar[BuildingLaw | None] = contextvars.ContextVar(
    "_turn_building_law", default=None
)


def set_turn_building_law(value: BuildingLaw | None) -> None:
    """Bind this turn's building law. Called on every turn, ``None`` included: that is the reset."""
    _turn_building_law.set(value)


def get_turn_building_law() -> BuildingLaw | None:
    return _turn_building_law.get()


def use_for_entry(entry: SourceEntry) -> EditionUse | None:
    """The edition a base-corpus passage is a text of, with its role here; None when the records do not say."""
    law = _turn_building_law.get()
    if law is None or not entry.citation_key or entry_shelf(entry) is not Shelf.BASE:
        return None
    file_name, _page = parse_citation_key(entry.citation_key)
    base_name = canonical_oib_file_name(file_name.rsplit("/", 1)[-1])
    if not base_name:
        return None
    return next(
        (use for use in law.uses if base_name in (canonical_oib_file_name(name) for name in use.corpus_files)), None
    )


def binding_status_for(use: EditionUse) -> str:
    """The coarse status the citation chip shows for a role (module docstring). Pure."""
    if use.role == "binding":
        return "binding" if use.via == "territory" else "declared_binding"
    if use.role == "authority_practice":
        return "declared_binding"
    if use.role in ("guidance", "interpretation"):
        return "interpretive"
    return "unknown"


def classification_for(use: EditionUse | None, *, place: bool) -> BindingClassification:
    """The classification a source carries: its edition's role here, else ``unknown``; a place never binds. Pure."""
    if place or use is None:
        return BindingClassification()
    return BindingClassification(binding_status=binding_status_for(use))


def role_fields(use: EditionUse | None) -> dict[str, Any]:
    """The wire fields a source carries for its role; empty without one, so the payload is unchanged."""
    if use is None:
        return {}
    return {"role": use.role, "role_qualifier": use.qualifier, "edition_id": use.edition_id}
