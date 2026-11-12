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

import contextlib
import contextvars
import re
from collections.abc import Iterator
from dataclasses import dataclass
from dataclasses import field
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from agent.project_context import RequestContext


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
MAX_USES = 500

#: Longest chain text kept: the BFF's own bound (``MAX_CONTEXT_TEXT_CHARS``), which cuts at a line and says so.
MAX_TEXT_CHARS = 16_000

#: The roles an edition can have (design §3.5); the TypeScript source is
#: ``EDITION_ROLES`` in ``apps/workspace/bff/base-knowledge/wire/vocab.ts``.
EDITION_ROLES: tuple[str, ...] = ("binding", "guidance", "interpretation", "authority_practice", "information")

#: How a role arose: law in its territory, a relation's route, or nothing (a norm no route reaches).
ROUTE_VIAS: tuple[str, ...] = ("territory", "relation", "none")

#: What qualifies a role: law nobody curated (open coverage), or an edition the office keeps itself.
QUALIFIERS: tuple[str, ...] = ("uncurated", "office_maintained")


#: How current an edition is by the platform's newest check (``FRESHNESS`` in the TypeScript wire).
FRESHNESS: tuple[str, ...] = ("current", "check_due", "newer_known", "superseded")

#: What an edition's held text is (``TEXT_STATUSES`` in the TypeScript wire).
TEXT_STATUSES: tuple[str, ...] = ("authentic", "official_non_prevailing", "translation")

#: The label tokens a use carries (``USE_LABELS`` in the TypeScript wire); a renderer words each.
USE_LABELS: tuple[str, ...] = ("uncurated_source", "check_overdue", "unchecked_since", "depends_on_connecting_factor")


@dataclass(frozen=True)
class UseRoute:
    """The instrument that declares an edition binding here: the last step of its route, as the records name it."""

    work_id: str
    designation: str | None = None
    edition_label: str | None = None
    provision: str | None = None


@dataclass(frozen=True)
class SourceRef:
    """One identifier of a work at its source, as its record states it: ``scheme`` is an open word (``eli``, a
    law number) that a source record declares under its ``identifiers``, and ``value`` is compared whole with
    what that source reads off a passage's address (:func:`use_for_source_ref`). No scheme is named in code."""

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
    #: Who issues the work, as its record names it: the publisher a citation of the edition's text names.
    issuer: str | None = None
    #: The work's identifiers at its source: what a passage read live there is matched by (:func:`use_for_source_ref`).
    source_refs: tuple[SourceRef, ...] = ()
    #: Whether the edition's own scope (``applicability``) leaves it open for this project: a person's check
    #: (``check``), a building fact not yet known (``open``), or ``not_applicable``. False when the edition
    #: states no scope or its scope applies. The chain text then says neither binds nor does not bind, and so
    #: does the citation chip (``citations/roles.binding_status_for``).
    scope_unsettled: bool = False
    #: The day the role holds on: the day the context was resolved for. A citation states its status as of it.
    date: str | None = None
    #: How current the edition is by the platform's newest check; None when the BFF sent no known token.
    freshness: str | None = None
    #: The platform's newest check, as a day; None when never checked or law read live.
    last_checked_at: str | None = None
    labels: tuple[str, ...] = ()
    #: Where a person opens the edition's text in public, from its manifestation records.
    source_url: str | None = None
    #: The declaring instrument when the role came by a relation; None for law in its territory.
    route: UseRoute | None = None
    #: The first day a binding role holds from by the records; None for every other role.
    role_since: str | None = None
    #: The language of the edition's held text (BCP 47); None where no text is held.
    language: str | None = None
    #: What the held text is (``TEXT_STATUSES``); None where none is held.
    text_status: str | None = None


#: Most sources a turn carries (``MAX_CONTEXT_SOURCES`` in the TypeScript wire).
MAX_SOURCES = 8


@dataclass(frozen=True)
class LawSource:
    """A released public source a law lookup may read this turn: its key, the revision, its country, its record.

    ``config`` is the record as ``public_sources.source.Source`` reads it, without the fixtures that proved it
    before release (``public_sources.source.parse_released_source``). Which source answers is its country.
    """

    key: str
    revision_id: str
    country: str
    config: dict = field(default_factory=dict, compare=False, hash=False)


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
    #: Per procedure, per node: the reference day (a filing day that has come), else its basis (``undetermined``).
    reference_dates: dict[str, dict[str, str]] = field(default_factory=dict)
    uses: tuple[EditionUse, ...] = ()
    #: The chain text the BFF rendered for the site: the turn's ``<building_law>`` block. None when nothing binds.
    text: str | None = None
    date: str | None = None
    #: The packs released since this conversation's last answer (E42): the answer says the base was updated.
    updated_since_last_answer: tuple[str, ...] = ()
    #: Law on the chain whose edition at the date the records cannot name, as ``work_id=reason``: no edition is assumed.
    undetermined: tuple[str, ...] = ()
    #: The released sources with a law lookup of the countries the turn reads; empty where it reads none.
    sources: tuple[LawSource, ...] = ()
    #: Released sources the BFF could not carry this turn (too large, or past the cap): never read silently.
    sources_dropped: tuple[str, ...] = ()

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


_ISO_DAY = re.compile(r"\d{4}-\d{2}-\d{2}")


def _day(value: object) -> str | None:
    """An ISO day as the BFF sends it; anything else is no date (never guessed). Pure."""
    return value if isinstance(value, str) and _ISO_DAY.fullmatch(value) else None


def _route(raw: object) -> UseRoute | None:
    """A use's ``route``; None when absent, null or not the shape the BFF sends. Pure."""
    if not isinstance(raw, dict):
        return None
    work_id = _text(raw.get("workId"))
    if work_id is None:
        return None
    return UseRoute(
        work_id=work_id,
        designation=_text(raw.get("designation")),
        edition_label=_text(raw.get("editionLabel")),
        provision=_text(raw.get("provision")),
    )


def _language(value: object) -> str | None:
    """A language tag as the records state it (BCP 47, bounded); anything else is none. Pure."""
    text = _text(value)
    return text.strip() if text and len(text.strip()) <= 35 else None


def _public_url(value: object) -> str | None:
    """A public address a person may open: https only, bounded; anything else is none. Pure."""
    text = _text(value)
    return text if text and text.startswith("https://") and len(text) <= 2000 else None


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
        issuer=_text(raw.get("issuer")),
        source_refs=_source_refs(raw.get("sourceRefs")),
        scope_unsettled=_scope_unsettled(raw.get("applicability")),
        date=_day(raw.get("date")),
        freshness=raw.get("freshness") if raw.get("freshness") in FRESHNESS else None,
        last_checked_at=_day(raw.get("lastCheckedAt")),
        labels=tuple(label for label in _strings(raw.get("labels")) if label in USE_LABELS),
        source_url=_public_url(raw.get("sourceUrl")),
        route=_route(raw.get("route")),
        role_since=_day(raw.get("roleSince")),
        language=_language(raw.get("language")),
        text_status=raw.get("textStatus") if raw.get("textStatus") in TEXT_STATUSES else None,
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


def _sources(value: object) -> tuple[LawSource, ...]:
    """``sources`` as the BFF sends them; an item of any other shape is dropped. Pure."""
    items = value if isinstance(value, list) else []
    return tuple(
        LawSource(key=item["key"], revision_id=item["revisionId"], country=item["country"], config=item["config"])
        for item in items[:MAX_SOURCES]
        if isinstance(item, dict)
        and all(_text(item.get(name)) for name in ("key", "revisionId", "country"))
        and isinstance(item.get("config"), dict)
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
        sources=_sources(raw.get("sources")),
        sources_dropped=_strings(raw.get("sourcesDropped"))[:MAX_SOURCES],
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
        "law_sources": ",".join(f"{source.key}@{source.revision_id}" for source in context.sources),
        "law_sources_dropped": ",".join(context.sources_dropped),
    }


def use_for_source_ref(context: KnowledgeContext, scheme: str, value: str) -> EditionUse | None:
    """The use whose work carries the identifier ``{scheme, value}`` at its source; None when no record does. Pure.

    How a live source's producer finds the record of the text it read: the identifier is one the work's
    record states (``sourceRefs``), compared whole and by its scheme. Law read live has one use (no edition
    held); where the work's editions are held, the one a route binds comes first.
    """
    wanted = (scheme, value.strip())
    named = [use for use in context.uses if any((ref.scheme, ref.value) == wanted for ref in use.source_refs)]
    return next((use for use in named if use.edition_id is None), named[0] if named else None)


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


class _Unscoped:
    """The marker type of :data:`UNSCOPED`; a class of its own so it can never be mistaken for a country set."""

    def __repr__(self) -> str:
        return "UNSCOPED"

    def __bool__(self) -> bool:
        return False


#: "No country filter on the base corpus": the answer of :func:`corpus_countries` for a read that belongs to no
#: request (a script, a sync loop, an internal service call), or that runs under :func:`unscoped_corpus_reads`.
#: It is a marker, never an absence: an empty ``frozenset`` is the opposite, a request that may read no country.
UNSCOPED = _Unscoped()

_unscoped_reads: contextvars.ContextVar[bool] = contextvars.ContextVar("_unscoped_reads", default=False)


@contextlib.contextmanager
def unscoped_corpus_reads() -> Iterator[None]:
    """Declare a block of code an operator or offline job that reads the whole base corpus, whatever countries.

    For code that must run unfiltered while a request context happens to be bound (a platform path inside a
    request). Never wrap code that answers a person: that code is bounded by its entitled countries.
    """
    token = _unscoped_reads.set(True)
    try:
        yield
    finally:
        _unscoped_reads.reset(token)


def corpus_countries() -> frozenset[str] | _Unscoped:
    """The countries whose base-corpus chunks this read may see, or :data:`UNSCOPED` for a read of no request.

    Strict for a request, unscoped only for no request at all:

    - the turn's own gate when its context is bound (the site's countries, ADR-0173);
    - otherwise, for a request, the countries the BFF signed onto the base corpus's entry of the
      collection scope. A request whose scope carries no such list (no base entry, a legacy bare
      name, an entry without ``countries``) reads **no** country: an empty set, which
      ``vector_store.scope.corpus_country_condition`` turns into the ``__none__`` filter. The BFF omits
      ``countries`` only for a request with no organization, and signs an empty list there
      (``collection-scope-request.ts``), so it reads none either;
    - :data:`UNSCOPED` only for a read that belongs to no request: no organization, no user, no signed
      envelope, no scope (a script, an offline job, the sync loop, an internal service call that signs
      no context), or code that says so with :func:`unscoped_corpus_reads`.

    ``vector_store.scope.scope_filter`` asks this on every read, so no path to the base corpus goes
    around it.
    """
    context = _turn_knowledge_context.get()
    if context is not None:
        return context.retrieval_countries
    if _unscoped_reads.get():
        return UNSCOPED
    from agent.project_context import RequestContext

    try:
        request = RequestContext.from_context()
    except Exception:  # noqa: BLE001 - a context that cannot be read is a request we cannot vouch for
        return frozenset()
    if _belongs_to_no_request(request):
        return UNSCOPED
    for entry in request.collection_scope_entries or []:
        if isinstance(entry, dict) and entry.get("shelf") == "base" and isinstance(entry.get("countries"), list):
            return frozenset(country for country in entry["countries"] if isinstance(country, str))
    return frozenset()


def _belongs_to_no_request(request: RequestContext) -> bool:
    """Whether ``request`` is the empty context of a script or an unsigned internal call. Pure."""
    return (
        request.collection_scope_entries is None
        and request.organization_id is None
        and request.user_id is None
        and request.envelope_header is None
    )


def binding_editions() -> frozenset[str]:
    """The editions that bind at the turn's site, by record id; empty without a bound context or a binding edition.

    Retrieval prefers their passages (``vector_store.boost.ranking_formula``): a preference, never a filter,
    so a question about another edition still finds it.
    """
    context = _turn_knowledge_context.get()
    if context is None:
        return frozenset()
    return frozenset(use.edition_id for use in context.uses if use.role == "binding" and use.edition_id)


def base_corpus_readable() -> bool | None:
    """Whether this read may search the base corpus at all: some country is readable (:func:`corpus_countries`).

    None only for a read of no request (a script, :data:`UNSCOPED`): nothing filters it, and the vector
    store's own filter (``corpus_country_condition``) says the same. A request whose scope names no
    countries is False, never None.
    """
    countries = corpus_countries()
    return None if countries is UNSCOPED else bool(countries)


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
