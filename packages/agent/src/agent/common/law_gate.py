from __future__ import annotations

from collections.abc import Iterable
from typing import TYPE_CHECKING

from agent.common.knowledge_context import gate_note
from agent.common.knowledge_context import gate_policy
from agent.common.knowledge_context import law_tools_allowed
from agent.common.knowledge_context import turn_knowledge_context

if TYPE_CHECKING:
    from agent.citations.entries import SourceEntry

LAW_SOURCE_COUNTRIES: dict[str, str] = {"ris": "AT"}

BUILDING_LAW_TAG = "<building_law>"


def law_sources_withheld(*, reads_turn_sources: bool = False) -> frozenset[str]:
    if reads_turn_sources and turn_carries_readable_source():
        return frozenset()
    return frozenset(source for source, country in LAW_SOURCE_COUNTRIES.items() if not law_tools_allowed(country))


def turn_carries_readable_source() -> bool:
    return any(law_tools_allowed(source.country) for source in turn_knowledge_context().sources)


def withheld_notice(source_id: str, label: str) -> str | None:
    country = LAW_SOURCE_COUNTRIES.get(source_id.lower())
    return None if country is None else withheld_notice_for_country(country, label)


def withheld_notice_for_country(country: str, label: str) -> str | None:
    if law_tools_allowed(country):
        return None
    context = turn_knowledge_context()
    site = context.site_country or "a country"
    reason = {
        "organization_unplaced": "the office's country is not set, so no country's law is read",
        "not_entitled": f"the site is in {site} and this office's workspace does not include its law",
        "knowledge_unavailable": "the building-law base could not be read for this turn",
    }.get(context.gate, f"{label} holds the law of {country}, which this turn does not read")
    return (
        f"Not executed: {label} was not consulted because {reason}. Answer with what you already have, say in "
        "one sentence which source could not be read and why, and keep confidence below high."
    )


def law_unsettled(cited: Iterable[SourceEntry]) -> bool:
    if gate_policy(turn_knowledge_context().gate).settled:
        return False
    from agent.citations.source_identity import source_lane
    from agent.common.source_kinds import kind_for_lane

    return any(kind_for_lane(source_lane(entry)[0]) == "building_law" for entry in cited)


def jurisdiction_note() -> str | None:
    return gate_note(turn_knowledge_context())


def building_law_block(chain_text: str | None) -> str | None:
    if not chain_text or not chain_text.strip() or turn_knowledge_context().withholds_law:
        return None
    return f"{BUILDING_LAW_TAG}\n{chain_text.strip()}\n</building_law>"


def turn_building_law_block() -> str | None:
    return building_law_block(turn_knowledge_context().text)


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
    parts = [LEGAL_METHOD, jurisdiction_note(), turn_building_law_block()]
    return "\n\n".join(part for part in parts if part)


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
