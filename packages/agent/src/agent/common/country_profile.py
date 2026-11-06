"""CountryProfile: the binding contract a supported country implements. Austria is #1.

Design rule (learned the hard way — see ADR-0025 Context): **every field on this
contract has a named consumer that exists today.** Adding a field without wiring
its consumer in the same change is forbidden; that is how the previous country
abstraction became dead code.

The contract is DATA-FIRST: everything that is vocabulary, prose, or pointers
lives in the per-country registry file (``configs/norms/<cc>/registry.yml``,
admin-editable through the platform norms surface) and merely *defaults* from
the code constants below. Only two things are code: the applicability resolver
and the corpus filename classifier — behavior that genuinely differs per legal
system. The country's legal-database access (RIS for Austria) is deliberately
NOT part of this contract: it is a source adapter (``packages/ris-adapter``)
registered through the normal agent-runtime tool mechanism; the profile only *names* the
tools so prompts and docs can reference them.

Adding a country therefore means:
1. ``configs/norms/<cc>/registry.yml`` — catalog entries + states/doctrine/
   corpus_note/parcel_tags/language overrides (data, admin-editable),
2. a corpus collection with that country's norm texts (platform upload),
3. a source adapter for its legal database (the one real code artifact),
4. registering a ``CountryProfile`` instance below with its two code hooks.

Consumers (kept current — update when re-pointing):
- ``states``/``state_probe_order`` → ``norm_registry.extract_federal_state``/``resolve_federal_state``
- ``doctrine`` → ``{{ norm_doctrine }}`` in researcher/planner/writer prompts
- ``corpus_collection`` → retrieval base-collection routing + admin store passthrough
- ``corpus_note`` → ``norm_registry.render_prompt_block`` corpus section
- ``parcel_tags`` → ``norm_registry.parcel_note`` (per-parcel source-of-truth signal)
- ``legal_source_tools`` → tool-name references in rendered prompt blocks/docs
- ``applicability`` → ``applicability.render_project_block``
- ``corpus_doc_class`` → ``norm_registry.lane_for_hit`` display tagging

Where the project is (``resolve_site``) is a separate axis from which profile
exists (design ``docs/design/international/design.md`` 3.1, invariant A1). A
project is placed by its own facts: a ``country`` line, else a Land token. A
project nothing places has NO country, never the default one: no country's law
is then applicable to it, and every consumer below says what is missing instead
of falling back to Austria. A project placed outside the covered countries gets
``UNCOVERED_SITE_NOTE``, never Austrian doctrine. The office's own seat never
places a project.
"""

from __future__ import annotations

import logging
import re
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

logger = logging.getLogger(__name__)

#: The country whose profile keys the norm store and the configured corpus. It
#: is never a project's country by default: see ``resolve_site``.
DEFAULT_COUNTRY = "at"

#: The intake's token for a country without a profile of its own (``A2_country``).
OTHER_COUNTRY = "other"

#: Country names for the notes the model reads, by the intake's tokens.
_COUNTRY_NAMES: dict[str, str] = {
    "at": "Austria",
    "de": "Germany",
    "ch": "Switzerland",
    OTHER_COUNTRY: "a country outside Austria",
}


@dataclass(frozen=True)
class CountryProfile:
    """Everything that varies per country, with data-first defaults."""

    country: str
    language: str
    states: dict[str, str | None]  # intake token -> canonical name (None = "outside" sentinel)
    state_probe_order: tuple[str, ...]  # canonical names, free-text probing order
    corpus_collection: str  # RAG base collection holding this country's norm texts
    corpus_note: str  # prompt paragraph describing the corpus + citation format
    doctrine: str  # Normenhierarchie doctrine text ({{ norm_doctrine }})
    parcel_tags: tuple[str, ...]  # document tags naming the per-parcel source of truth
    legal_source_tools: tuple[str, ...]  # tool names of the country's legal-DB adapter
    applicability: Callable[[dict], list[Any]] | None = None  # facts -> verdicts
    corpus_doc_class: Callable[[str], str | None] | None = None  # corpus filename -> doc class

    def with_overrides(self, **overrides: Any) -> CountryProfile:
        """Profile with non-empty registry-file overrides applied (data wins over code)."""
        cleaned = {k: v for k, v in overrides.items() if v}
        if not cleaned:
            return self
        from dataclasses import replace

        return replace(self, **cleaned)


_PROFILES: dict[str, CountryProfile] = {}


def register_country_profile(profile: CountryProfile) -> None:
    _PROFILES[profile.country] = profile


def get_country_profile(country: str | None = None) -> CountryProfile | None:
    """The profile for a country code, with registry-file overrides applied.

    Data overrides (states/doctrine/corpus_note/parcel_tags/language/
    corpus_collection) come from the country's registry file so admins can
    evolve them without a deploy; the code hooks always come from the
    registered instance. No country, or one without a profile → None: the
    caller says the site is not covered, never falls back to Austria.
    """
    if not country:
        return None
    code = country.lower()
    base = _PROFILES.get(code)
    if base is None:
        return None
    try:
        from agent.common import norm_registry

        norms_file = norm_registry.load_norms_file(code)
    except Exception:  # noqa: BLE001 — profile lookup must never break the hot path
        logger.warning("country_profile: registry overrides unavailable for '%s'", code, exc_info=True)
        norms_file = None
    if norms_file is None:
        return base
    return base.with_overrides(
        language=norms_file.language,
        states=dict(norms_file.states) if norms_file.states else None,
        corpus_collection=norms_file.corpus_collection,
        corpus_note=norms_file.corpus_note,
        doctrine=norms_file.doctrine,
        parcel_tags=tuple(norms_file.parcel_tags) if norms_file.parcel_tags else None,
    )


def _register_austria() -> None:
    """Austria: implementation #1 of the contract. Defaults live in norm_registry."""
    from agent.common import applicability as at_applicability
    from agent.common import norm_registry as nr

    register_country_profile(
        CountryProfile(
            country="at",
            language="de-AT",
            states=dict(nr.FEDERAL_STATE_TOKENS),
            state_probe_order=tuple(nr.BUNDESLAENDER),
            corpus_collection="oib_knowledge",
            corpus_note=nr.OIB_CORPUS_NOTE,
            doctrine=nr.NORM_DOCTRINE,
            parcel_tags=("Bebauungsplan", "Flächenwidmungsplan"),
            legal_source_tools=("ris_search", "ris_fetch_document", "ris_catalog_lookup"),
            applicability=at_applicability.resolve_oib_applicability,
            corpus_doc_class=nr.oib_doc_class,
        )
    )


_register_austria()


# The jurisdiction + project-hard-limits grounding, injected into every deep-research
# prompt as {{ jurisdiction_grounding }} — ONE copy, rendered by the prompt factories
# (same pattern as norm_registry.NORM_DOCTRINE). Keep the rendered prompts long and specific; only
# the authorship is deduplicated here so the four prompts cannot drift apart.
JURISDICTION_GROUNDING = """## Jurisdiction & Country Handling

The project context (injected at the bottom of this prompt) places the project with a `country=<cc>` line: an
ISO-2 country code (e.g. `at`, `de`, `ch`) or the sentinel `other` for a country without a dedicated
pipeline. For Austrian projects a `federal_state=<token>` line names the Land. A line under `assumptions:`
places the project too, as unverified.

- **country=at**: The Austrian building-regulation pipeline applies. OIB-Richtlinien, Landesbauordnung and
  RIS are authoritative; cite ÖNORM only as a reference unless its binding incorporation and applicable text
  are verified; never reproduce ÖNORM full text as binding. Answer with binding-law precision, name the exact
  regulation, the edition the Land declared binding and the Punkt, and state the applicable Land.
- **country != at** (any other ISO-2 code, the `other` sentinel, or `federal_state=outside_austria`): the
  OIB corpus and the RIS tools are Austrian only, and this workspace does not yet cover that country's law.
  The norm doctrine below says so for this project. Never present an Austrian rule, OIB-Richtlinie or
  Austrian building class as applicable; say plainly that the site's law is not covered and what the answer
  would need. An Austrian rule appears only as a comparison the person asked for, labelled as Austrian.
- **No country and no Land** (the site is not stated): no country's law is known to apply. Austrian sources
  answer a question about Austrian law, labelled as such, but nothing is presented as binding for this
  project. When the answer turns on the jurisdiction, say that the site is missing and ask for it.

## Project Hard Limits & Grounding

The project context includes confirmed facts (hard constraints), unknowns (gaps), and assumptions
(provisional). Use them as follows:

- **Confirmed facts** are binding — never contradict them. If research sources conflict with a confirmed
  fact, flag the conflict and explain.
- **Unknowns** are known gaps — if a critical fact for the answer (especially building-class relevant:
  escape_level_m, storeys, gfa, uses, federal_state) is flagged unknown, the answer must either ask for
  it or state the gap clearly.
- **Assumptions** are provisional estimates — treat as likely but note the uncertainty.
- Wizard facts that constrain building-regulation outputs: **escape_level_m** → Gebäudeklasse per OIB-RL 2;
  **storeys_above_ground / storeys_below_ground**; **max_building_height**; **gfa_above_ground**;
  **work_type** (new_build/extension/conversion/refurbishment/...); **uses** (residential/office/retail/...);
  **construction_method**; **elevator**; **conditioning**; **fireplaces**; **public_access**; **hazard_zones**;
  **fire_safety_systems**; **heat_supply**; **further_technology** (pv/ventilation/cooling/infiltration).
- Keys with `@bldgN` suffix apply to a specific building; keys with `@zone` suffix to a use zone.
- When the plan or synthesis concerns a building-regulation question, cross-check the projected output
  against the project's hard limits. If the research produces a requirement that contradicts a confirmed
  fact, note the contradiction in the output rather than blindly repeating both."""


# ---------------------------------------------------------------------------
# Where the project is: the site, read from the project's own facts.
# ---------------------------------------------------------------------------

_SECTION_HEADER = re.compile(r"^(confirmed|assumptions):\s*$")
_SITE_LINE = re.compile(r"^-\s*(country|federal_state)=([a-z_]+)\b")


@dataclass(frozen=True)
class Site:
    """Where the project's site is, as far as its profile says.

    ``country`` is an ISO-2 code (lower case), ``other`` for a country the
    intake does not name, or None when nothing places the project (design
    ``site_unknown``). ``federal_state`` is the Austrian Land token, if any.
    ``confirmed`` is False when the placing line is only an assumption (a
    typed address, a reading's suggestion): it still places the project, as
    unverified (design A1).
    """

    country: str | None
    federal_state: str | None = None
    confirmed: bool = False

    @property
    def covered(self) -> bool:
        """Whether a country profile answers for this site's law."""
        return self.country is not None and self.country in _PROFILES


SITE_UNKNOWN = Site(country=None)


def _site_lines(project_context: str) -> dict[str, dict[str, str]]:
    """The ``country`` and ``federal_state`` lines of the confirmed and assumptions sections. Pure."""
    from agent.profile_names import normalize_prompt_view

    found: dict[str, dict[str, str]] = {"confirmed": {}, "assumptions": {}}
    section: str | None = None
    for raw in normalize_prompt_view(project_context).splitlines():
        line = raw.strip()
        header = _SECTION_HEADER.match(raw.rstrip())
        if header:
            section = header.group(1)
            continue
        if section and raw and not raw.startswith((" ", "-")):
            section = None
        if section is None:
            continue
        match = _SITE_LINE.match(line)
        if match:
            found[section].setdefault(match.group(1), match.group(2))
    return found


def _site_from(lines: dict[str, str], confirmed: bool) -> Site | None:
    """The site one section places, or None when it places nothing. Pure."""
    from agent.common.norm_registry import FEDERAL_STATE_TOKENS

    country = lines.get("country")
    state = lines.get("federal_state")
    state = state if state in FEDERAL_STATE_TOKENS else None
    if country and (len(country) == 2 or country == OTHER_COUNTRY):
        return Site(country=country, federal_state=state if country == "at" else None, confirmed=confirmed)
    if state == "outside_austria":
        return Site(country=OTHER_COUNTRY, confirmed=confirmed)
    if state:
        return Site(country="at", federal_state=state, confirmed=confirmed)
    return None


def resolve_site(project_context: str | None) -> Site:
    """Where the project is: confirmed facts first, then assumptions, else ``SITE_UNKNOWN``.

    Reads the profile's own lines and nothing else: not the office's seat, not
    a default. The signed envelope's ``federal_state`` places a project whose
    text carries no line (a caller that sends the envelope and no view).
    """
    if project_context:
        lines = _site_lines(project_context)
        for section, confirmed in (("confirmed", True), ("assumptions", False)):
            site = _site_from(lines[section], confirmed)
            if site is not None:
                return site
    try:
        from agent.project_context import RequestContext

        token = RequestContext.from_context().federal_state
    except Exception:  # noqa: BLE001 — no live request context
        token = None
    if token:
        return _site_from({"federal_state": token}, True) or SITE_UNKNOWN
    return SITE_UNKNOWN


def country_name(country: str | None) -> str:
    """The country's English name for a note the model reads."""
    if not country:
        return "unknown"
    return _COUNTRY_NAMES.get(country, country.upper())


#: What the model reads for a project placed in a country no profile covers. It
#: replaces the Austrian doctrine and project block for that project.
UNCOVERED_SITE_NOTE = """## Jurisdiction: {country}, not covered

This project's site is in {country} (`country={code}`). The legal corpus, the norm catalogue and the
legal-database tools of this workspace cover Austrian law only. For this project:
- No Austrian law, OIB-Richtlinie, Austrian Gebäudeklasse, authority practice or ÖNORM applies. Do not
  present one as applicable, do not derive a building class or a fire-safety level from Austrian rules,
  and do not cite an Austrian passage as a requirement for this site.
- Say once, plainly, that the building law of {country} is not yet covered here, and name what the
  answer would need (the Land's or canton's building code, its technical rules, the local plan).
- The project's own documents still answer, and so does general planning knowledge. An Austrian rule
  may be named only as a comparison the person asked for, labelled as Austrian and not binding here."""

#: What the model reads for a project whose site nothing states.
SITE_UNKNOWN_NOTE = """## Jurisdiction: site not stated

This project's profile does not say where the site is (no country, no Land). No country's building
law is known to apply, so no requirement is presented as binding for this project. Austrian law and
the OIB-Richtlinien may answer a question about Austrian law, labelled as such. When the answer turns
on the jurisdiction, say that the site is missing and ask for the country and Land."""


def site_note(project_context: str | None) -> str | None:
    """The jurisdiction note for the turn context, or None for a covered site or no project.

    A project placed in Austria reads nothing new: its prompt stays as it was.
    """
    if not project_context or not project_context.strip():
        return None
    site = resolve_site(project_context)
    if site.covered:
        return None
    if site.country is None:
        return SITE_UNKNOWN_NOTE
    return UNCOVERED_SITE_NOTE.format(country=country_name(site.country), code=site.country)
