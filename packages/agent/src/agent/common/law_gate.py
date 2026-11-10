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

from agent.common.knowledge_context import gate_note
from agent.common.knowledge_context import law_tools_allowed
from agent.common.knowledge_context import turn_knowledge_context

#: The country whose law each legal-database adapter holds (``configs/*.yml`` ``data_sources`` ids).
#: A fact about the source, like its URL: RIS is Austria's legal information system. A turn may call an
#: adapter only where its knowledge context allows that country's law (:func:`law_sources_withheld`).
LAW_SOURCE_COUNTRIES: dict[str, str] = {"ris": "AT"}

#: The tag that marks the turn's building law, in the turn context and in a research prompt.
BUILDING_LAW_TAG = "<building_law>"


def law_sources_withheld() -> frozenset[str]:
    """The legal-database sources this turn may not consult: each one whose country the gate does not allow.

    Joined to the switched-off sources, so a call is refused at the tools node with the same notice
    (the chat agent) or the tool is not offered (deep research), and the gate's note says why.
    """
    return frozenset(source for source, country in LAW_SOURCE_COUNTRIES.items() if not law_tools_allowed(country))


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
    """This turn's ``<building_law>`` block, from the chain text bound for it (``citations/roles.py``)."""
    from agent.citations.roles import get_turn_building_law

    law = get_turn_building_law()
    return building_law_block(law.text if law else None)


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
