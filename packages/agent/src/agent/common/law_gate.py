"""What a turn may say about building law, read from its knowledge context alone (ADR-0173, ADR-0175).

Which country's law applies, which edition binds and whether the legal-database tools may run is the
BFF's to resolve: the knowledge context (``knowledge_context.py``) and the chain text with every
edition's role (``citations/roles.py``). Nothing here reads the project's text for a country or a
Land, and nothing defaults to one. With no context bound the gate reads ``knowledge_unavailable``:
no verdict, no edition named binding, the legal-database tools withheld, and the gate's note.

What stays in code is method, which holds in every country: what binds outranks what explains, a
requirement comes only from a normative text, a plot's plans settle a parcel question. A country's
own law, its editions and its doctrine are records in its pack, and reach the prompt as the chain text.
"""

from __future__ import annotations

from collections.abc import Iterable
from typing import TYPE_CHECKING

from agent.common.knowledge_context import gate_note
from agent.common.knowledge_context import gate_policy
from agent.common.knowledge_context import law_tools_allowed
from agent.common.knowledge_context import turn_knowledge_context

if TYPE_CHECKING:
    from agent.citations.entries import SourceEntry

#: The country whose law each legal-database adapter holds (``configs/*.yml`` ``data_sources`` ids).
#: A fact about the source, like its URL: RIS is Austria's legal information system. Deep research's three
#: RIS tools read their database directly, so a turn may call them only where its knowledge context allows
#: that country's law (:func:`law_sources_withheld`). The law lookup is not in it: its record says its country.
LAW_SOURCE_COUNTRIES: dict[str, str] = {"ris": "AT"}

#: The data source of the country-neutral law lookup (``agent.knowledge.law_lookup``). Which country it reads is
#: its source record's, so the gate withholds it only on a turn that reads no law at all.
LAW_LOOKUP_SOURCE = "law_lookup"

#: The tag that marks the turn's building law, in the turn context and in a research prompt.
BUILDING_LAW_TAG = "<building_law>"


def law_sources_withheld(*, reads_turn_sources: bool = False) -> frozenset[str]:
    """The legal-database sources this turn may not consult.

    Joined to the switched-off sources, so a call is refused at the tools node with the same notice
    (the chat agent) or the tool is not offered (deep research), and the gate's note says why.

    The law lookup is withheld only where the turn reads no law (``GatePolicy.reads_law``); otherwise the
    lookup decides by its source record's country (``law_lookup.turn_source.withheld_note``), never by a table
    here. ``reads_turn_sources``: the caller binds only the lookup (the chat binding), so the adapters' table
    is not read. Deep research's RIS tools stay gated by their country.
    """
    lookup = frozenset() if gate_policy(turn_knowledge_context().gate).reads_law else frozenset({LAW_LOOKUP_SOURCE})
    if reads_turn_sources:
        return lookup
    return lookup | {source for source, country in LAW_SOURCE_COUNTRIES.items() if not law_tools_allowed(country)}


def withheld_notice(source_id: str, label: str) -> str | None:
    """What a call to a legal database the gate withholds is answered with; None when the gate lets it run.

    It names what is missing, so the answer can say so: never that the source is "switched off", which reads
    as a setting the person could change (QC on staging: „RIS ist deaktiviert"). The answer then says what it
    could not read and holds its confidence below high.
    """
    if source_id.lower() == LAW_LOOKUP_SOURCE:
        return None if gate_policy(turn_knowledge_context().gate).reads_law else _refusal(label, None)
    country = LAW_SOURCE_COUNTRIES.get(source_id.lower())
    return None if country is None else withheld_notice_for_country(country, label)


def withheld_notice_for_country(country: str, label: str) -> str | None:
    """:func:`withheld_notice` for a source known by its country (a source record's territory)."""
    return None if law_tools_allowed(country) else _refusal(label, country)


def _refusal(label: str, country: str | None) -> str:
    """The refusal, saying why from the turn's gate; ``country`` is the source's, when it holds one country's law."""
    context = turn_knowledge_context()
    site = context.site_country or "a country"
    holds = f"{label} holds the law of {country}, which this turn does not read" if country else "no law is read"
    reason = {
        "organization_unplaced": "the office's country is not set, so no country's law is read",
        "not_entitled": f"the site is in {site} and this office's workspace does not include its law",
        "knowledge_unavailable": "the building-law base could not be read for this turn",
    }.get(context.gate, holds)
    return (
        f"Not executed: {label} was not consulted because {reason}. Answer with what you already have, say in "
        "one sentence which source could not be read and why, and keep confidence below high."
    )


def law_unsettled(cited: Iterable[SourceEntry]) -> bool:
    """Whether an answer citing ``cited`` rests on building law the turn's records do not settle.

    The gate withholds a binding claim, or the coverage is open (uncurated), and at least one cited source
    is building law (``source_kinds``). The answer check's level is then capped (``markers``, staging QC F6):
    structurally, so the grader is handed no new vocabulary.
    """
    if gate_policy(turn_knowledge_context().gate).settled:
        return False
    from agent.citations.source_identity import source_lane
    from agent.common.source_kinds import kind_for_lane

    return any(kind_for_lane(source_lane(entry)[0]) == "building_law" for entry in cited)


def jurisdiction_note() -> str | None:
    """The gate's note for this turn (``knowledge_context.gate_note``); None for core or full with nothing moved."""
    return gate_note(turn_knowledge_context())


def building_law_block(chain_text: str | None) -> str | None:
    """The ``<building_law>`` block of a turn: the chain text the BFF rendered, or None without one. Pure.

    A gate that withholds law shows none, whatever text came with it: the note speaks instead.
    """
    if not chain_text or not chain_text.strip() or turn_knowledge_context().withholds_law:
        return None
    return f"{BUILDING_LAW_TAG}\n{chain_text.strip()}\n</building_law>"


def turn_building_law_block() -> str | None:
    """This turn's ``<building_law>`` block, from its knowledge context's chain text."""
    return building_law_block(turn_knowledge_context().text)


#: How to reason about building law in any country, injected into the research prompts as
#: ``{{ norm_doctrine }}`` ahead of the turn's own building law. ONE copy; the chat's static prompt
#: carries the same method in ``<legal_method>``.
LEGAL_METHOD = """## Norm hierarchy & document roles

**Order of authority ≠ order of retrieval.** Which source ANSWERS a question (law > ordinance > a technical
guideline or standard a law makes binding > guide or explanatory note) is not the order in which sources are
RETRIEVED (knowledge base — project documents and base knowledge — → legal database → web). The knowledge
base comes first: its binding text is there, citable with page.

**Respect document roles:**
- Requirements („muss", „darf nicht", minimum values) come exclusively from NORMATIVE documents (law,
  ordinance, a guideline or standard declared binding).
- Guides describe the APPLICATION of a guideline, explanatory notes give its RATIONALE; neither establishes
  a requirement.
- Information from an authority shows its practice — never cite it as a norm.
- Legal commentaries are not available. When asked for them, say so openly.

**Which law and which edition.** The building-law block below, from the platform's reviewed records, is the
only statement of what binds at this site and in which edition. Cite the edition it names binding, never
automatically the newest. Without that block, or where its note says the law is not covered, present no
rule as binding and derive no building class.

**Parcel questions: settle them at the plot first.** Zoning, permitted building height, building lines and
the like are answered by the plot's zoning and development plans, not by the building code in general. If
the plan is not in the knowledge base, say so openly instead of answering generically.

**Terms follow the level of the question.** The same term can be defined differently in a guideline, state
law and federal law; always name the definition level used.

**Standards honesty:** full texts of technical standards are usually not in the sources. Name a standard
where a document refers to it, disclose that its text is not available, and never reproduce it from memory.

**Existing buildings/transitional law:** for a refurbishment, extension or alteration, point out that
grandfathering and transitional provisions may apply and must be checked."""


def research_doctrine() -> str:
    """The research prompts' ``{{ norm_doctrine }}``: the method, then the gate's note or the turn's building law."""
    parts = [LEGAL_METHOD, jurisdiction_note(), turn_building_law_block()]
    return "\n\n".join(part for part in parts if part)


# The jurisdiction + project-hard-limits grounding, injected into every deep-research
# prompt as {{ jurisdiction_grounding }} — ONE copy, rendered by the prompt factories.
JURISDICTION_GROUNDING = """## Jurisdiction

Which country's building law applies to this project, and how far this workspace covers it, is stated once:
by the building-law block and the jurisdiction note in the norm doctrine below, both from the platform's
records. Follow them, not the project text and not your own knowledge of where the project might be.

- **A building-law block is present:** answer with binding-law precision for the editions it names binding,
  name the exact regulation, the edition and the clause, and state the territory it binds in.
- **A jurisdiction note is present instead** (the office's country is not set, the site is not stated, the
  country is not included or not covered, the base could not be read): present no rule as binding, derive
  no building class, and say once, plainly, what the note says and what the answer would need. Another
  country's rule appears only as a comparison the person asked for, labelled as not binding here.

## Project Hard Limits & Grounding

The project context includes confirmed facts (hard constraints), unknowns (gaps), and assumptions
(provisional). Use them as follows:

- **Confirmed facts** are binding — never contradict them. If research sources conflict with a confirmed
  fact, flag the conflict and explain.
- **Unknowns** are known gaps — if a critical fact for the answer (especially building-class relevant:
  escape_level_m, storeys, gfa, uses, federal_state) is flagged unknown, the answer must either ask for
  it or state the gap clearly.
- **Assumptions** are provisional estimates — treat as likely but note the uncertainty.
- Wizard facts that constrain building-regulation outputs: **escape_level_m** → building class;
  **storeys_above_ground / storeys_below_ground**; **max_building_height**; **gfa_above_ground**;
  **work_type** (new_build/extension/conversion/refurbishment/...); **uses** (residential/office/retail/...);
  **construction_method**; **elevator**; **conditioning**; **fireplaces**; **public_access**; **hazard_zones**;
  **fire_safety_systems**; **heat_supply**; **further_technology** (pv/ventilation/cooling/infiltration).
- Keys with `@bldgN` suffix apply to a specific building; keys with `@zone` suffix to a use zone.
- When the plan or synthesis concerns a building-regulation question, cross-check the projected output
  against the project's hard limits. If the research produces a requirement that contradicts a confirmed
  fact, note the contradiction in the output rather than blindly repeating both."""
