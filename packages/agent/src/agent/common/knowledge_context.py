"""The turn's knowledge context (ADR-0173): which country, coverage and editions apply, as the BFF resolved them.

The BFF sends it as ``knowledgeContext`` on every turn (``apps/workspace/bff/base-knowledge/context/wire.ts``,
ADR-0175) and in every research run's payload. It is the only source of which law applies: nothing here
guesses a country from the project's text. Absent, or not the shape the BFF sends, reads as
``knowledge_unavailable``, never as "everything applies": a context we cannot read withholds law lookup,
verdicts and every edition's binding role (fail closed), and the turn says so (:func:`gate_note`).

It is also the turn's one answer to which law applies: the chain text (``text``, the turn context's
``<building_law>`` block) and every edition's role (``uses``), with the open-coverage, freshness and
connecting-factor corrections already applied by the BFF. A citation's binding status reads these roles
(``citations/roles.py``), so it can never say more than the gate.

Bound per turn in a ``ContextVar`` (the per-turn state rule of this package),
so the retrieval scope, the RIS tools and the round-0 prefetch ask
:func:`corpus_country_allowed` instead of re-deriving the site.
"""

from __future__ import annotations

import contextvars
from dataclasses import dataclass
from dataclasses import field


@dataclass(frozen=True)
class GatePolicy:
    """What a gate state lets a turn do with the law of its site."""

    #: The primary law may be read (the legal-database lookup runs): reading is no verdict.
    reads_law: bool
    #: A rule may be presented as this project's requirement and the chain text shown.
    may_bind: bool
    #: Reviewed coverage: the records settle which edition binds, and nothing caps the answer for it.
    settled: bool


#: Every gate state, weakest first (``GATE_STATES`` in the TypeScript wire), and what it allows: the one
#: table every reader asks through :func:`gate_policy`. A state not listed fails closed.
GATES: dict[str, GatePolicy] = {
    "organization_unplaced": GatePolicy(reads_law=False, may_bind=False, settled=False),
    "site_unknown": GatePolicy(reads_law=True, may_bind=False, settled=False),
    "not_entitled": GatePolicy(reads_law=False, may_bind=False, settled=False),
    "knowledge_unavailable": GatePolicy(reads_law=False, may_bind=False, settled=False),
    "none": GatePolicy(reads_law=True, may_bind=False, settled=False),
    "open": GatePolicy(reads_law=True, may_bind=True, settled=False),
    "core": GatePolicy(reads_law=True, may_bind=True, settled=True),
    "full": GatePolicy(reads_law=True, may_bind=True, settled=True),
}
GATE_STATES: tuple[str, ...] = tuple(GATES)

#: What an unknown state allows: nothing.
FAIL_CLOSED = GatePolicy(reads_law=False, may_bind=False, settled=False)


def gate_policy(state: str) -> GatePolicy:
    """What ``state`` allows; an unknown state allows nothing. Pure."""
    return GATES.get(state, FAIL_CLOSED)


#: Most leaves, packs and uses kept; the BFF's own bounds.
MAX_LEAVES = 8
MAX_PACKS = 16
MAX_USES = 40

#: Longest chain text kept: the BFF's own bound (``MAX_CONTEXT_TEXT_CHARS``), which cuts at a line and says so.
MAX_TEXT_CHARS = 16_000

#: The roles an edition can have (design §3.5); the TypeScript source is
#: ``EDITION_ROLES`` in ``apps/workspace/bff/base-knowledge/wire/vocab.ts``.
EDITION_ROLES: tuple[str, ...] = ("binding", "guidance", "interpretation", "authority_practice", "information")

#: How a role arose: law in its territory, a relation's route, or nothing (a norm no route reaches).
ROUTE_VIAS: tuple[str, ...] = ("territory", "relation", "none")

#: What qualifies a role: law nobody curated (open coverage), or an edition the office keeps itself.
QUALIFIERS: tuple[str, ...] = ("uncurated", "office_maintained")


@dataclass(frozen=True)
class SourceRef:
    """One identity of an edition in a legal database, from its manifestation records: ``ris_gesetzesnummer``
    (``20000006``), ``ris_dokumentnummer``, ``eli`` (``https://…``). How each is matched: ``citations/roles.py``."""

    scheme: str
    value: str


@dataclass(frozen=True)
class EditionUse:
    """One edition's role at the turn's site, as the knowledge context resolved it."""

    work_id: str
    edition_id: str | None
    role: str
    via: str
    qualifier: str | None = None
    corpus_files: tuple[str, ...] = ()
    designation: str | None = None
    edition_label: str | None = None
    #: The edition's identities in a legal database: what a RIS passage is matched by (``citations/roles.py``).
    source_refs: tuple[SourceRef, ...] = ()
    #: Whether the edition's own scope (``applicability``) leaves it open for this project: a person's check
    #: (``check``), a building fact not yet known (``open``), or ``not_applicable``. False when the edition
    #: states no scope or its scope applies. The chain text then says neither binds nor does not bind, and so
    #: does the citation chip (``citations/roles.binding_status_for``).
    scope_unsettled: bool = False


@dataclass(frozen=True)
class KnowledgeContext:
    """What the turn may claim about the law of its site, and what it may retrieve."""

    gate: str
    reason: str | None = None
    #: The coverage at the first leaf; None when not entitled, unplaced or unknown.
    coverage: str | None = None
    #: The first leaf's country (ISO 3166-1 alpha-2); None when no site is placed.
    site_country: str | None = None
    chains: dict[str, tuple[str, ...]] = field(default_factory=dict)
    packs: dict[str, int] = field(default_factory=dict)
    retrieval_countries: frozenset[str] = frozenset()
    #: Per procedure, per node: the reference day's basis (``undetermined`` until a reviewed rule names it).
    reference_dates: dict[str, dict[str, str]] = field(default_factory=dict)
    uses: tuple[EditionUse, ...] = ()
    #: The chain text the BFF rendered for the site: the turn's ``<building_law>`` block. None when nothing binds.
    text: str | None = None
    date: str | None = None
    #: The packs released since this conversation's last answer (E42): the answer says the base was updated.
    updated_since_last_answer: tuple[str, ...] = ()
    #: Law on the chain whose edition at the date the records cannot name, as ``work_id=reason``: no edition is assumed.
    undetermined: tuple[str, ...] = ()

    @property
    def withholds_law(self) -> bool:
        """Whether a binding claim and classification are withheld: no territorial pack answers this turn."""
        return not gate_policy(self.gate).may_bind


UNAVAILABLE = KnowledgeContext(gate="knowledge_unavailable")


def _strings(value: object) -> tuple[str, ...]:
    return tuple(item for item in value if isinstance(item, str)) if isinstance(value, list) else ()


def _text(value: object) -> str | None:
    return value if isinstance(value, str) and value.strip() else None


def _source_refs(raw: object) -> tuple[SourceRef, ...]:
    """``sourceRefs`` as ``{scheme, value}`` items; an item of any other shape is dropped. Pure."""
    items = raw if isinstance(raw, list) else []
    return tuple(
        SourceRef(scheme=item["scheme"], value=item["value"].strip())
        for item in items
        if isinstance(item, dict) and _text(item.get("scheme")) and _text(item.get("value"))
    )


def _scope_unsettled(raw: object) -> bool:
    """Whether a use's ``applicability`` leaves its scope open here; absent or null states no scope. Pure.

    Anything but ``verdict: "applies"`` with no ``open`` fact is unsettled, an unknown verdict included:
    a scope the agent cannot read never lets a badge claim more than the text.
    """
    if raw is None:
        return False
    if not isinstance(raw, dict):
        return True
    return raw.get("verdict") != "applies" or bool(_strings(raw.get("open")))


def _use(raw: object) -> EditionUse | None:
    """One ``uses`` item; None when it is not the shape the BFF sends (dropped, never guessed). Pure."""
    if not isinstance(raw, dict):
        return None
    work_id, role, via = _text(raw.get("workId")), raw.get("role"), raw.get("via")
    if work_id is None or role not in EDITION_ROLES or via not in ROUTE_VIAS:
        return None
    qualifier = raw.get("qualifier")
    return EditionUse(
        work_id=work_id,
        edition_id=_text(raw.get("editionId")),
        role=str(role),
        via=str(via),
        qualifier=qualifier if qualifier in QUALIFIERS else None,
        corpus_files=_strings(raw.get("corpusFiles")),
        designation=_text(raw.get("designation")),
        edition_label=_text(raw.get("editionLabel")),
        source_refs=_source_refs(raw.get("sourceRefs")),
        scope_unsettled=_scope_unsettled(raw.get("applicability")),
    )


def _reference_dates(procedures: object) -> dict[str, dict[str, str]]:
    result: dict[str, dict[str, str]] = {}
    for procedure in procedures if isinstance(procedures, list) else []:
        if not isinstance(procedure, dict) or not isinstance(procedure.get("id"), str):
            continue
        days = procedure.get("referenceDates")
        if not isinstance(days, dict):
            continue
        result[procedure["id"]] = {
            str(node): (day.get("date") or day.get("basis") or "undetermined")
            for node, day in days.items()
            if isinstance(day, dict)
        }
    return result


def _undetermined(value: object) -> tuple[str, ...]:
    entries = value if isinstance(value, list) else []
    return tuple(
        f"{entry['workId']}={entry['reason']}"
        for entry in entries[:MAX_USES]
        if isinstance(entry, dict) and isinstance(entry.get("workId"), str) and isinstance(entry.get("reason"), str)
    )


def parse_knowledge_context(raw: object) -> KnowledgeContext:
    """The turn context's ``knowledgeContext``; anything not its shape is ``knowledge_unavailable``. Pure."""
    if not isinstance(raw, dict):
        return UNAVAILABLE
    gate = raw.get("gate")
    if not isinstance(gate, dict) or gate.get("state") not in GATE_STATES:
        return UNAVAILABLE
    retrieval = raw.get("retrieval")
    countries = _strings(retrieval.get("countries")) if isinstance(retrieval, dict) else None
    if countries is None:
        return UNAVAILABLE
    leaves = [leaf for leaf in gate.get("leaves") or [] if isinstance(leaf, dict)][:MAX_LEAVES]
    coverage = leaves[0].get("coverage") if leaves and isinstance(leaves[0].get("coverage"), str) else None
    site_country = leaves[0].get("country") if leaves and isinstance(leaves[0].get("country"), str) else None
    chains_raw = raw.get("chains")
    chains = {str(leaf): _strings(chain) for leaf, chain in chains_raw.items()} if isinstance(chains_raw, dict) else {}
    packs = {
        pack["packId"]: pack["seq"]
        for pack in (raw.get("packs") or [])[:MAX_PACKS]
        if isinstance(pack, dict) and isinstance(pack.get("packId"), str) and isinstance(pack.get("seq"), int)
    }
    raw_uses = raw.get("uses")
    uses = tuple(use for use in map(_use, raw_uses[:MAX_USES] if isinstance(raw_uses, list) else []) if use)
    text = _text(raw.get("text"))
    return KnowledgeContext(
        gate=str(gate["state"]),
        reason=gate.get("reason") if isinstance(gate.get("reason"), str) else None,
        coverage=coverage,
        site_country=site_country,
        chains=chains,
        packs=packs,
        retrieval_countries=frozenset(countries),
        reference_dates=_reference_dates(raw.get("procedures")),
        uses=uses,
        text=text[:MAX_TEXT_CHARS] if text else None,
        date=raw.get("date") if isinstance(raw.get("date"), str) else None,
        updated_since_last_answer=_strings(raw.get("updatedSinceLastAnswer"))[:MAX_PACKS],
        undetermined=_undetermined(raw.get("undetermined")),
    )


def trace_metadata(context: KnowledgeContext) -> dict[str, object]:
    """The Langfuse trace metadata of a turn's knowledge context (design §7.3): tokens and ids only. Pure."""
    return {
        "gate": context.gate,
        "coverage": context.coverage or "none",
        "jurisdiction_chains": ";".join(f"{leaf}:{'>'.join(chain)}" for leaf, chain in sorted(context.chains.items())),
        "pack_seqs": ",".join(f"{pack}:{seq}" for pack, seq in sorted(context.packs.items())),
        "reference_dates": ";".join(
            f"{procedure}@{node}={day}"
            for procedure, days in sorted(context.reference_dates.items())
            for node, day in sorted(days.items())
        ),
        "base_updated_since_last_answer": ",".join(context.updated_since_last_answer),
        "building_law_uses": len(context.uses),
        "undetermined_editions": ";".join(context.undetermined),
    }


_turn_knowledge_context: contextvars.ContextVar[KnowledgeContext | None] = contextvars.ContextVar(
    "_turn_knowledge_context", default=None
)


def set_turn_knowledge_context(value: KnowledgeContext | None) -> None:
    """Bind this turn's knowledge context. Called on every turn, ``None`` included: that is the reset."""
    _turn_knowledge_context.set(value)


def get_turn_knowledge_context() -> KnowledgeContext | None:
    """The bound context, or None outside a turn or run (a script, a door call): see :func:`corpus_countries`."""
    return _turn_knowledge_context.get()


def turn_knowledge_context() -> KnowledgeContext:
    """The turn's context; ``knowledge_unavailable`` when none is bound, so a reader fails closed."""
    return _turn_knowledge_context.get() or UNAVAILABLE


#: The country no office is entitled to (ISO 3166-1 user-assigned): a base-corpus chunk whose text no
#: release names, or whose ingest job named no country, carries it and is read by nobody (fail closed).
UNRELEASED_COUNTRY = "ZZ"


def corpus_countries() -> frozenset[str] | None:
    """The countries whose base-corpus chunks this read may see; None when nothing says.

    Nothing says when there is no request at all (a script) or the signed base entry carries no ``countries``
    field, which the BFF omits only for a request with no organization. An empty list is no country (fail
    closed), not "unscoped".

    The turn's own gate when its context is bound (the site's countries, ADR-0173); otherwise the
    office's entitled countries the BFF signed onto the base corpus's entry of the collection scope,
    which every door call carries too. ``vector_store.scope.scope_filter`` asks this on
    every read, so no path to the base corpus goes around it.
    """
    context = _turn_knowledge_context.get()
    if context is not None:
        return context.retrieval_countries
    from agent.project_context import RequestContext

    try:
        entries = RequestContext.from_context().collection_scope_entries or []
    except Exception:  # noqa: BLE001 - no request context (a script, a test): nothing to filter by
        return None
    for entry in entries:
        if isinstance(entry, dict) and entry.get("shelf") == "base" and isinstance(entry.get("countries"), list):
            return frozenset(country for country in entry["countries"] if isinstance(country, str))
    return None


def base_corpus_readable() -> bool | None:
    """Whether this read may search the base corpus at all: some country is readable (:func:`corpus_countries`).

    None only without any request (a script): nothing is known to filter by, and the vector store's own
    filter (``corpus_country_condition``) says the same.
    """
    countries = corpus_countries()
    return None if countries is None else bool(countries)


def law_tools_allowed(country: str) -> bool:
    """Whether the turn may run ``country``'s law lookup; False without a bound context (fail closed).

    Reading the primary source is not a verdict: coverage ``none`` or ``open`` and an unknown site withhold
    verdicts and binding claims (:attr:`KnowledgeContext.withholds_law`), never reading the law itself. So the
    lookup runs wherever the office may read ``country`` (an office-level question in its home country, a
    project placed there), and is withheld only by a gate that reads no law (``GatePolicy.reads_law``: the
    office has no country, the site's country is not the office's, the base could not be read) or a country
    the turn may not read.
    """
    context = turn_knowledge_context()
    return gate_policy(context.gate).reads_law and country.upper() in context.retrieval_countries


def corpus_country_allowed(country: str) -> bool:
    """Whether the turn may read ``country``'s shared corpus; False without a bound context (fail closed)."""
    return country.upper() in turn_knowledge_context().retrieval_countries


_GATE_NOTES: dict[str, str] = {
    "organization_unplaced": (
        "## Building law: the office's country is not set\n\n"
        "No country's building law is read for this turn: the legal corpus and the legal-database tools are "
        "withheld. Answer from the project's documents and general planning knowledge, present no rule as "
        "binding, and say once that an administrator sets the office's country in the settings."
    ),
    "site_unknown": (
        "## Building law: site not stated\n\n"
        "Nothing places this project's site, so no country's building law is known to apply. Present no value as "
        "this project's requirement, derive no building class, name no edition as binding, and do not assume a "
        "country: a place the project memory, a note or a document mentions is not a confirmed site and settles "
        "nothing. {covered} When the answer turns on the jurisdiction, say that the site is missing and ask "
        "for the country and Land."
    ),
    "not_entitled": (
        "## Building law: {country}, not included\n\n"
        "The site is in {country}, whose building law this office's workspace does not include. Present no rule "
        "as binding for it, derive no building class, and do not cite another country's law as a requirement "
        "here. Say so once; the project's documents and general planning knowledge still answer."
    ),
    "knowledge_unavailable": (
        "## Building law: not available this turn\n\n"
        "The building-law base could not be read for this turn. Present no rule as binding and derive no "
        "building class; say once that the building law could not be read just now and the person may ask again."
    ),
    "none": (
        "## Building law: {country}, no base yet\n\n"
        "{country}'s base knowledge is not published yet. You may read and quote its primary law, but present "
        "no edition as binding at this site and derive no building class; say once that which edition binds "
        "cannot be determined until the base is published."
    ),
    "open": (
        "## Building law: {country}, open coverage\n\n"
        "The base for {country} holds its works and editions, not yet reviewed in depth. Cite what it holds, and "
        "say once that the coverage is open, so the person checks the source before relying on it."
    ),
}

#: Said under every note that withholds a binding claim, and under open coverage: the web never fills the gap.
WEB_IS_INFORMATION = (
    "A web page is never the source of a requirement or of which edition binds: what the web says about a "
    "law is unverified information, labelled as such, and a norm the knowledge base holds is cited from the "
    "knowledge base, never from a web copy."
)


def covered_sentences(countries: frozenset[str]) -> str:
    """What the base covers, for a site nobody placed (dev acceptance A4): the countries whose primary law may
    be read, and that a place outside them is not covered; or, with none, that no country's law is read. Pure."""
    if not countries:
        return (
            "This office's base covers no country, so no country's primary law is read here: a place the "
            "question names is not covered, so say so plainly."
        )
    covered = ", ".join(sorted(countries))
    return (
        f"You may read and quote the primary law of {covered} as information. A place the question names "
        f"outside {covered} is not covered by this office's base: say so plainly."
    )


def gate_note(context: KnowledgeContext) -> str | None:
    """What the turn context says about the gate (ADR-0173 §4.6); None for core or full with nothing moved. Pure."""
    note = _GATE_NOTES.get(context.gate)
    covered = covered_sentences(context.retrieval_countries)
    lines = [note.format(country=context.site_country or "the site's country", covered=covered)] if note else []
    if note:
        lines.append(WEB_IS_INFORMATION)
    if context.updated_since_last_answer:
        lines.append(
            "The building-law base was updated since this conversation's last answer "
            f"({', '.join(context.updated_since_last_answer)}). Where this answer differs from an earlier one, say so."
        )
    return "\n\n".join(lines) or None
