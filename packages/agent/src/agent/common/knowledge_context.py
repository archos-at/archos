"""The turn's knowledge context (ADR-0173): which country, coverage and editions apply, as the BFF resolved them.

The BFF sends it as ``knowledgeContext`` in the turn context
(``apps/workspace/bff/base-knowledge/context/wire.ts``), behind
``knowledge-context``. Absent means the flag is off, and the turn runs as it
did: nothing here is bound and every reader keeps its old answer. Present but
not the shape the BFF sends reads as ``knowledge_unavailable``, never as
"everything applies": a context we cannot read withholds retrieval, law lookup
and classification (fail closed).

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
    chains: dict[str, tuple[str, ...]] = field(default_factory=dict)
    packs: dict[str, int] = field(default_factory=dict)
    retrieval_countries: frozenset[str] = frozenset()
    #: Per procedure, per node: the reference day's basis (``undetermined`` until a reviewed rule names it).
    stichtage: dict[str, dict[str, str]] = field(default_factory=dict)
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


def _stichtage(procedures: object) -> dict[str, dict[str, str]]:
    result: dict[str, dict[str, str]] = {}
    for procedure in procedures if isinstance(procedures, list) else []:
        if not isinstance(procedure, dict) or not isinstance(procedure.get("id"), str):
            continue
        days = procedure.get("stichtage")
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
        chains=chains,
        packs=packs,
        retrieval_countries=frozenset(countries),
        stichtage=_stichtage(raw.get("procedures")),
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
        "stichtage": ";".join(
            f"{procedure}@{node}={day}"
            for procedure, days in sorted(context.stichtage.items())
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
    return _turn_knowledge_context.get()


#: The country every base-corpus point written before ``country_id`` existed belongs to: the corpus was Austria's alone.
LEGACY_CORPUS_COUNTRY = "AT"


def base_corpus_country_filter() -> dict[str, object] | None:
    """The base-corpus filter the turn's gate sets: only the countries it may read; None when no context is bound.

    A point without ``country_id`` predates it and is Austrian, so it is read only while Austria is.
    An empty list reads nothing: the caller drops the base corpus instead of searching it.
    """
    context = _turn_knowledge_context.get()
    if context is None:
        return None
    countries = sorted(context.retrieval_countries)
    allowed: dict[str, object] = {"country_id": {"$in": countries}}
    if LEGACY_CORPUS_COUNTRY in context.retrieval_countries:
        return {"$or": [allowed, {"country_id": {"$exists": False}}]}
    return allowed


def base_corpus_readable() -> bool | None:
    """Whether the turn may search the base corpus at all; None without a context (the site decides, ADR-0158)."""
    context = _turn_knowledge_context.get()
    return None if context is None else bool(context.retrieval_countries)


def corpus_country_allowed(country: str) -> bool | None:
    """Whether the turn may read ``country``'s shared corpus and law tools; None when no context is bound (flag off)."""
    context = _turn_knowledge_context.get()
    if context is None:
        return None
    return country.upper() in context.retrieval_countries
