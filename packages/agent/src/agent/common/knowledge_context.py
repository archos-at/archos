"""The turn's knowledge context (ADR-0173): which country, coverage and editions apply, as the BFF resolved them.

The BFF sends it as ``knowledgeContext`` on every turn (``apps/workspace/bff/base-knowledge/context/wire.ts``,
ADR-0175) and in every research run's payload. It is the only source of which law applies: nothing here
guesses a country from the project's text. Absent, or not the shape the BFF sends, reads as
``knowledge_unavailable``, never as "everything applies": a context we cannot read withholds law lookup,
verdicts and every edition's binding role (fail closed), and the turn says so (:func:`gate_note`).

Bound per turn in a ``ContextVar`` (the per-turn state rule of this package),
so the retrieval scope, the RIS tools and the round-0 prefetch ask
:func:`corpus_country_allowed` instead of re-deriving the site.
"""

from __future__ import annotations

import contextvars
from dataclasses import dataclass
from dataclasses import field

#: The gate states, weakest first (``GATE_STATES`` in the TypeScript wire).
GATE_STATES: tuple[str, ...] = (
    "organization_unplaced",
    "site_unknown",
    "not_entitled",
    "knowledge_unavailable",
    "none",
    "open",
    "core",
    "full",
)

#: Most leaves, packs and uses kept; the BFF's own bounds.
MAX_LEAVES = 8
MAX_PACKS = 16
MAX_USES = 40


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
    uses: tuple[dict[str, object], ...] = ()
    date: str | None = None
    #: The packs released since this conversation's last answer (E42): the answer says the base was updated.
    updated_since_last_answer: tuple[str, ...] = ()

    @property
    def withholds_law(self) -> bool:
        """Whether law lookup and classification are withheld: no territorial pack answers this turn."""
        return self.gate in ("organization_unplaced", "site_unknown", "not_entitled", "knowledge_unavailable", "none")


UNAVAILABLE = KnowledgeContext(gate="knowledge_unavailable")


def _strings(value: object) -> tuple[str, ...]:
    return tuple(item for item in value if isinstance(item, str)) if isinstance(value, list) else ()


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
    uses = tuple(use for use in (raw.get("uses") or [])[:MAX_USES] if isinstance(use, dict))
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
        date=raw.get("date") if isinstance(raw.get("date"), str) else None,
        updated_since_last_answer=_strings(raw.get("updatedSinceLastAnswer"))[:MAX_PACKS],
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
    """The countries whose base-corpus chunks this read may see; None when nothing says (no request at all).

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

    Stricter than the corpus: a gate that withholds law (:attr:`KnowledgeContext.withholds_law`) withholds
    the legal-database tools even where the turn may still read the office's entitled corpus (``site_unknown``).
    """
    context = turn_knowledge_context()
    return not context.withholds_law and country.upper() in context.retrieval_countries


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
        "Nothing places this project's site, so no country's building law is known to apply: no requirement is "
        "presented as binding, no building class is derived, and the legal-database tools are not used. When the "
        "answer turns on the jurisdiction, say that the site is missing and ask for the country and Land."
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
        "No building-law base is held for {country} yet. Present no rule as binding for this site and derive "
        "no building class; say once that its building law is not yet covered here."
    ),
    "open": (
        "## Building law: {country}, open coverage\n\n"
        "The base for {country} holds its works and editions, not yet reviewed in depth. Cite what it holds, and "
        "say once that the coverage is open, so the person checks the source before relying on it."
    ),
}


def gate_note(context: KnowledgeContext) -> str | None:
    """What the turn context says about the gate (ADR-0173 §4.6); None for core or full with nothing moved. Pure."""
    note = _GATE_NOTES.get(context.gate)
    lines = [note.format(country=context.site_country or "the site's country")] if note else []
    if context.updated_since_last_answer:
        lines.append(
            "The building-law base was updated since this conversation's last answer "
            f"({', '.join(context.updated_since_last_answer)}). Where this answer differs from an earlier one, say so."
        )
    return "\n\n".join(lines) or None
