"""What an edition is to this turn's site, from the knowledge context (ADR-0168, ADR-0175).

The BFF resolves the project's site against the knowledge records and sends every edition's role in the
turn's ``knowledgeContext.uses`` (``common/knowledge_context.py``), with the open-coverage, freshness and
connecting-factor corrections applied: an uncurated node's guidance is information, a stale uncurated law
no longer binds, a work that attaches to the office's seat is information. This module answers, for a
retrieved passage, which of those editions it is a text of and what that edition is here. It is the only
source of a source's binding status: where the context names no role for a passage, its status is
``unknown`` and the chip shows none. It reads the same uses the gate does, so a citation never says
``binding`` where the gate says information. The guesses that came before it (a host regex, a filename
prefix, a doc class, a registry rank) are gone with ``citations/binding.py``, and the second answer, the
turn context's ``buildingLaw``, is gone too.

A role is computed from a route, never stored (design §3.5). The coarse
status the citation chip shows stays the one the UI knows:

- law in its territory binds (``binding``);
- an edition a law makes binding is ``declared_binding``, as the WBTV makes
  OIB-RL 2:2023 binding in Wien, and so is an authority's practice, as the
  registry's ``authority_info`` rank always was;
- an edition that only guides or interprets is ``interpretive``: OIB-RL
  2:2023 in Steiermark, where the 2019 edition binds (defect 7);
- information is ``unknown``: the UI shows no chip rather than a false one;
- so is any edition whose own scope (``applicability``) is open for this project: a person's check, or a
  building fact not yet known. The chain text says it neither binds nor does not bind; so does the chip.

Fail closed: no context bound, or a gate that carries no uses, maps every passage to nothing.

A passage finds its edition BY ID, never by what its file is called or where it was fetched from: its
producer states the knowledge record it read (``SourceEntry.edition_id`` / ``work_id``). A corpus point is
marked with its edition at ingest (``knowledge_edition_id``); a live source's producer finds the work by
the identifier the work's record carries (``knowledge_context.use_for_source_ref``). The role, the route,
the edition's label and its dates are then read off the use with that id. No URL, host, file-name pattern
or country is matched here, so a new country's sources need no code in this module.

One bridge remains for a corpus point that predates the mark: its file name, compared whole with the
names the edition's records list (``corpusFiles``). Records, not a pattern; a file the records name under
another spelling is found once its points carry their edition (the corpus mark route re-marks without a
re-ingest). An office's copy that happens to share a file name is the office's, and its label is the
office layer's.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from agent.citations.citation_keys import entry_shelf
from agent.citations.citation_keys import parse_citation_key
from agent.citations.entries import SourceEntry
from agent.common.knowledge_context import EditionUse
from agent.common.knowledge_context import turn_knowledge_context
from agent.common.source_kinds import Shelf


@dataclass(frozen=True)
class BindingClassification:
    """A source's coarse binding status, as the citation chip shows it.

    ``binding`` / ``declared_binding`` / ``interpretive`` / ``unknown``. The default
    is ``unknown``: a passage no edition role reaches gets no badge, because a
    fabricated binding badge would be a false legal claim.
    """

    binding_status: str = "unknown"


def _use_by_id(uses: tuple[EditionUse, ...], entry: SourceEntry) -> EditionUse | None:
    """The use of the record a passage's producer stated; None when it stated none or the turn carries none.

    An edition id is the whole answer. A work id alone is a text read live at its source, the consolidated
    wording in force: it is the work's use that holds no edition, else the work's only use; where the
    records hold several editions of the work and none was stated, nothing is assumed.
    """
    if entry.edition_id:
        return next((use for use in uses if use.edition_id == entry.edition_id), None)
    if not entry.work_id:
        return None
    of_work = [use for use in uses if use.work_id == entry.work_id]
    live = next((use for use in of_work if use.edition_id is None), None)
    return live or (of_work[0] if len(of_work) == 1 else None)


def _use_by_corpus_file(uses: tuple[EditionUse, ...], entry: SourceEntry) -> EditionUse | None:
    """The edition whose records list the base-corpus file a passage came from, compared whole (the bridge
    for a point that carries no edition yet); None for any other shelf."""
    if not entry.citation_key or entry_shelf(entry) is not Shelf.BASE:
        return None
    file_name, _page = parse_citation_key(entry.citation_key)
    base_name = file_name.rsplit("/", 1)[-1].lower()
    if not base_name:
        return None
    return next((use for use in uses if base_name in (name.lower() for name in use.corpus_files)), None)


def use_for_entry(entry: SourceEntry) -> EditionUse | None:
    """The edition a passage is a text of, with its role here; None when the records do not say.

    By the id of the record its producer stated; for a base-corpus point that states none, by the file
    names the edition's records list. Anything else maps to nothing, and its status is ``unknown`` (fail
    closed).
    """
    uses = turn_knowledge_context().uses
    if not uses:
        return None
    if entry.edition_id or entry.work_id:
        return _use_by_id(uses, entry)
    return _use_by_corpus_file(uses, entry)


def binding_status_for(use: EditionUse) -> str:
    """The coarse status the citation chip shows for a role (module docstring). Pure.

    An edition whose own scope is open for this project (a person's check, a building fact not yet known)
    is ``unknown`` whatever its role: the chain text says it neither binds nor does not bind until then.
    """
    if use.scope_unsettled:
        return "unknown"
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
    """The wire fields a source carries for its edition's role here; empty without one, so the payload is unchanged.

    Everything a citation's status line states, from the records and nowhere else (design §6.7): which
    edition (``designation``, ``edition_label``), what it is here (``role``), through which instrument
    (``route``) and from which day (``role_since``), as of which day that was resolved (``as_of``), and how
    current the platform's check of it is (``last_checked_at``, ``freshness``, ``role_labels``), and which text
    it is (``language``, ``text_status``). A field the records do not state is absent, never guessed. Pure.
    """
    if use is None:
        return {}
    route = use.route
    return {
        "role": use.role,
        "role_qualifier": use.qualifier,
        "work_id": use.work_id,
        "edition_id": use.edition_id,
        "designation": use.designation,
        "edition_label": use.edition_label,
        "route": (
            {
                key: value
                for key, value in (
                    ("work_id", route.work_id),
                    ("designation", route.designation),
                    ("edition_label", route.edition_label),
                    ("provision", route.provision),
                )
                if value is not None
            }
            if route is not None
            else None
        ),
        "role_since": use.role_since,
        "as_of": use.date,
        "last_checked_at": use.last_checked_at,
        "freshness": use.freshness,
        "role_labels": list(use.labels) or None,
        "language": use.language,
        "text_status": use.text_status,
    }
