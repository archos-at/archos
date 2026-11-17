"""Sufficiency judgement and re-query for ``knowledge_search``.

Retrieval used to be one shot: the query went to every collection in scope,
the channels were fused, the pool was reranked, and whatever came out was the
answer's evidence. Nothing judged whether that pool could answer the question,
and nothing tried a second formulation when it could not. A question phrased
the way a planner talks ("wie lang darf der Fluchtweg sein") and a corpus that
says it the way a norm talks ("Gehweglänge … höchstens 40 m") met only if the
embedding bridged the gap.

This module is the judge half of that loop. Shown the question and the fused
pool, the model says whether the pool contains what is needed and, if not,
proposes a handful of alternative formulations a search index would match.
The caller retrieves those, fuses the new channels into the same RRF, and
reranks the widened pool. The fusion machinery was already N-ary; this is the
part that was missing (rag-system-audit-2026-08 F13).

Fail-open throughout: a missing model, a timeout, an unparseable reply or a
reply that proposes nothing all read as "sufficient", and the search proceeds
exactly as it did before this module existed.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from collections.abc import Sequence
from contextvars import ContextVar
from dataclasses import dataclass
from dataclasses import field
from threading import Lock
from typing import Any

from agent.common.message_utils import response_text
from knowledge_layer.search.rerank import _build_user_prompt

logger = logging.getLogger(__name__)

_JUDGE_CANDIDATES = 12

_COVERAGE_MAX_JUDGED = 24

_JUDGE_EXCERPT_CHARS = 600

DEFAULT_TIMEOUT_SECONDS = 15.0

_MAX_QUERY_CHARS = 300

_NOTICE_QUERY_CHARS = 120

_SYSTEM_PROMPT = (
    "You judge whether a set of retrieved excerpts is enough to answer a question, "
    "and if it is not, you propose better search queries.\n\n"
    "The excerpts come from a search index over building regulations, guidance "
    "documents and project files. They were retrieved for the question as the user "
    "phrased it. The index matches wording, so a question phrased in everyday terms "
    "can miss passages that state the same thing in the terminology the source "
    "texts themselves use.\n\n"
    "Decide:\n"
    "- sufficient: true when the excerpts contain the governing statement the "
    "question needs (the requirement, the threshold, the dimension, the definition, "
    "or the fact about the project). false when they only circle the topic, when the "
    "operative statement is missing, or when there are no excerpts at all.\n"
    "- queries: when not sufficient, up to N alternative search queries, in the "
    "language the source texts are written in. Each must differ in wording from the "
    "original and from each other: use the terminology the sources would use, name "
    "the specific concept the question is about, split a compound question into its "
    "parts. Do not repeat the original query. When sufficient, return an empty list.\n\n"
    'Return ONLY a JSON object of the form {"sufficient": true, "queries": []}. '
    "No prose, no markdown."
)


@dataclass(frozen=True)
class SufficiencyVerdict:
    """What the judge decided, and what to search next if it decided "no"."""

    sufficient: bool
    queries: list[str] = field(default_factory=list)

    @property
    def wants_requery(self) -> bool:
        return not self.sufficient and bool(self.queries)


SUFFICIENT = SufficiencyVerdict(sufficient=True)


def _normalised(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip().casefold()


def _parse_verdict(raw: str, *, original_query: str, max_queries: int) -> SufficiencyVerdict | None:
    """Read the judge's JSON; ``None`` for anything that is not the contract.

    Lenient about a code fence or prose around the object, strict about the
    object itself: ``sufficient`` must be a real boolean and ``queries`` a list
    of strings. Proposed queries are de-duplicated, trimmed, and compared to
    the original so a model that paraphrases by repeating cannot spend a
    retrieval on the query that already ran.
    """
    text = raw.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        parsed = json.loads(text[start : end + 1])
    except json.JSONDecodeError:
        return None
    if not isinstance(parsed, dict):
        return None
    sufficient = parsed.get("sufficient")
    if not isinstance(sufficient, bool):
        return None

    seen = {_normalised(original_query)}
    queries: list[str] = []
    raw_queries = parsed.get("queries")
    for candidate in raw_queries if isinstance(raw_queries, list) else []:
        if not isinstance(candidate, str):
            continue
        cleaned = " ".join(candidate.split())[:_MAX_QUERY_CHARS].strip()
        key = _normalised(cleaned)
        if not key or key in seen:
            continue
        seen.add(key)
        queries.append(cleaned)
        if len(queries) >= max_queries:
            break
    return SufficiencyVerdict(sufficient=sufficient, queries=queries)


DECIDER_LLM = "llm"
DECIDER_JEV = "jev"


async def judge_sufficiency(
    llm: Any,
    query: str,
    chunks: list[Any],
    *,
    max_queries: int,
    timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
    decider: str = DECIDER_LLM,
    decision_threshold: float | None = None,
) -> SufficiencyVerdict:
    """Ask ``llm`` whether ``chunks`` can answer ``query``; fail-open to sufficient.

    Args:
        llm: LangChain chat model with an async ``ainvoke``; ``None`` disables.
        query: The user's question, as asked.
        chunks: The fused candidate pool, best first. May be empty — an empty
            pool is the strongest reason to try another formulation.
        max_queries: Ceiling on proposed alternative queries.
        timeout_seconds: Upper bound for the judge call.
        decider: :data:`DECIDER_LLM` or :data:`DECIDER_JEV`. With ``jev`` the
            decision model answers the yes/no over the head first; a head it
            finds sufficient costs no judge call, and a decision that did not
            run (absent, disabled, failed) falls back to the judge.
        decision_threshold: The sufficiency threshold for ``jev``; ``None``
            is the module default.

    Returns:
        The verdict. On any failure, :data:`SUFFICIENT`, so the caller's search
        is exactly the one-shot search it always was.
    """
    if llm is None or not query or max_queries <= 0:
        return SUFFICIENT

    shown = list(chunks[:_JUDGE_CANDIDATES])
    if decider == DECIDER_JEV and shown:
        from .decisions import DEFAULT_SUFFICIENCY_THRESHOLD
        from .decisions import passage_verdicts

        verdicts = await passage_verdicts(
            query, shown, threshold=DEFAULT_SUFFICIENCY_THRESHOLD if decision_threshold is None else decision_threshold
        )
        if verdicts is not None and verdicts.sufficient:
            logger.info("Decision model found the head sufficient (p=%.2f) for %r", verdicts.best, query[:60])
            return SUFFICIENT
        if verdicts is not None:
            logger.info("Decision model found the head insufficient (p=%.2f); asking the judge", verdicts.best)
    user_prompt = (
        _build_user_prompt(query, shown, _JUDGE_EXCERPT_CHARS) if shown else f"Question: {query}\n\nCandidates: none."
    )
    user_prompt += f"\n\nPropose at most {max_queries} alternative queries if the candidates are not sufficient."

    try:
        response = await asyncio.wait_for(
            llm.ainvoke([("system", _SYSTEM_PROMPT), ("user", user_prompt)]),
            timeout=timeout_seconds,
        )
        raw = response_text(response)
        if not raw:
            raise ValueError("empty judge reply")
        verdict = _parse_verdict(raw, original_query=query, max_queries=max_queries)
        if verdict is None:
            logger.warning("Sufficiency judge reply did not match the contract; treating the pool as sufficient")
            return SUFFICIENT
        if verdict.wants_requery:
            logger.info(
                "Sufficiency judge asked for %d alternative quer(y/ies) for %r", len(verdict.queries), query[:60]
            )
        return verdict
    except Exception as e:
        logger.warning("Sufficiency judge failed (%s: %s); treating the pool as sufficient", type(e).__name__, e)
        return SUFFICIENT


def requery_notice(queries: Sequence[str]) -> str:
    """The one line about the widening that the MODEL reads, or ``""``.

    Until this existed the loop was invisible to the agent that had asked for
    the search: the judge decided the first pool could not answer the question,
    the pipeline searched again in words the model never chose, and the model
    was handed the widened excerpts as if they were the answer to its own
    query. Whichever way the turn then went — an answer built on a paraphrase
    of the question, or a second search repeating a formulation that had
    already been tried — the model could not know which, because nothing told
    it. The live status line said so to the READER (``emit_retrieval_requery``)
    and to nobody else.

    German, because the model writes German and this line sits in the tool
    result beside German excerpts. One sentence, named formulations, no
    instruction: what to do about it is the model's next decision, and a line
    that told it would be the pipeline steering the loop a second time.

    Returns ``""`` when nothing was widened, so the common one-shot search
    carries no prefix at all.
    """
    named = [" ".join(query.split())[:_NOTICE_QUERY_CHARS] for query in queries if query and query.strip()]
    if not named:
        return ""
    count = "one reformulation" if len(named) == 1 else f"{len(named)} reformulations"
    formulations = "; ".join(f"„{query}“" for query in named)
    return (
        f"Note: the search was widened by {count} ({formulations}), "
        "because the first hits did not cover the question.\n\n"
    )


@dataclass(frozen=True)
class CoverageGap:
    """The decider read every judged passage and none answers the question.

    ``unjudged`` delivered passages past :data:`_COVERAGE_MAX_JUDGED` were not
    read, and the reason says so: the claim covers the judged ones only.
    """

    judged: int
    best: float
    threshold: float
    widened: bool
    unjudged: int = 0

    def reason(self) -> str:
        """The clause after "Coverage: insufficient — " (``grounding_block.COVERAGE_GAP_LABEL``)."""
        after = ", even after reformulating the search" if self.widened else ""
        which = f"best {self.judged}" if self.unjudged else f"{self.judged} shown"
        rest = f"; the remaining {self.unjudged} passages were not checked" if self.unjudged else ""
        return (
            f"none of the {which} passages contains the statement sought "
            f"(decision model: highest probability {self.best:.2f}, "
            f"threshold {self.threshold:.2f}){after}{rest}"
        )


async def judge_coverage(
    query: str,
    chunks: Sequence[Any],
    *,
    threshold: float,
    widened: bool,
) -> CoverageGap | None:
    """A :class:`CoverageGap` when the decider says no passage answers; else ``None``.

    Reads ``chunks`` (the pool as the model will get it, best first) up to
    :data:`_COVERAGE_MAX_JUDGED`, with the same question and threshold as the
    first pass, in one decider batch. ``None``
    for everything that is not a complete "no": a passage that answers, a
    decision that did not run, a passage the decider left unanswered, an empty
    pool. Missing evidence is never read as an absent answer. Never raises.
    """
    pool = list(chunks or [])
    head = pool[:_COVERAGE_MAX_JUDGED]
    if not head or not query:
        return None
    try:
        from .decisions import passage_verdicts

        verdicts = await passage_verdicts(query, head, threshold=threshold, injection=False)
    except Exception:
        logger.debug("Coverage check failed open", exc_info=True)
        return None
    if verdicts is None or any(p is None for p in verdicts.answers) or verdicts.sufficient:
        return None
    logger.info("Coverage insufficient for %r: best p=%.2f over %d passage(s)", query[:60], verdicts.best, len(head))
    return CoverageGap(
        judged=len(head), best=verdicts.best, threshold=threshold, widened=widened, unjudged=len(pool) - len(head)
    )


_STRONG_TOP1_FLOOR = 0.88

_STRONG_TOP3_MEAN_FLOOR = 0.80

_STRONG_MIN_CHUNKS = 3

_CALIBRATED_EMBEDDING_MODELS = ("multilingual-e5-small",)


def _is_calibrated_embedding(model_name: str | None) -> bool:
    """True when the deployed embedder is one the floors were calibrated on.

    Suffix match so a provider-qualified or path-qualified id
    (``intfloat/multilingual-e5-small``) still matches. Unknown reads False:
    an uncalibrated deployment keeps the judge, which is the direction the
    failure has to lean.
    """
    if not isinstance(model_name, str) or not model_name.strip():
        return False
    name = model_name.strip().lower().replace("\\", "/")
    return any(name.endswith(known) for known in _CALIBRATED_EMBEDDING_MODELS)


_KNOWN_ENTITY_PATTERNS = (
    r"oib[-\s_]*rl",  # OIB-RL 2, OIB_RL_2, OIB RL 2.1
    r"richtlinie\s*\d",  # Richtlinie 2
    r"\brl\s*\d",  # RL 2
    r"\bpkt\.?\b",  # Pkt. 5.1
    r"\bpunkt\b",  # Punkt 5.1
    r"§",  # § 12
    r"\bseite\b",  # Seite 12
    r"\bpage\b",  # page 12
    r"\btabelle\b",  # Tabelle 1b
    r"\.pdf\b",  # an indexed file name
    r"oib-rl_",  # the corpus file stem
    r"oib-richtlinie_",  # the stem as OIB publishes 2.2
)

_KNOWN_ENTITY_RE = re.compile("|".join(_KNOWN_ENTITY_PATTERNS), re.IGNORECASE)

_NARROW_ANCHOR_PATTERNS = (
    r"oib[-\s_]*rl\s*\d",  # OIB-RL 2
    r"richtlinie\s*\d",  # Richtlinie 2
    r"\brl\s*\d",  # RL 2
    r"\bpkt\.?\s*\d",  # Pkt. 5.1
    r"\bpunkt\s*\d",  # Punkt 3.5.2
    r"§\s*\d",  # § 12 — the symbol needs its paragraph number
    r"\bseite\s*\d",  # Seite 12
    r"\bpage\s*\d",  # page 12
    r"\btabelle\w*\s+(?:nr\.?\s+)?\S*\d",  # Tabelle 1b, Tabellen 3, Tabelle Nr. 3
    r"\.pdf\b",  # an indexed file name
    r"oib-rl_",  # the corpus file stem
    r"oib-richtlinie_",  # the stem as OIB publishes 2.2
)

_NARROW_ANCHOR_RE = re.compile("|".join(_NARROW_ANCHOR_PATTERNS), re.IGNORECASE)

_REQUERY_FIRED: ContextVar[bool] = ContextVar("knowledge_requery_fired", default=False)

_REQUERY_TURN_ID: ContextVar[str | None] = ContextVar("knowledge_requery_turn", default=None)


def _current_turn_id() -> str | None:
    """This turn's id when the agent-runtime context states one, else ``None``.

    Prefers the per-turn user message id and falls back to the workflow run
    id. The conversation id alone is per-conversation, not per-turn, so it
    is never a turn id. Fail-open to ``None`` (unstamped): instrumentation
    never breaks the search.
    """
    try:
        from nat.plugin_api import Context

        ctx = Context.get()
        if ctx is None:
            return None
        for attr in ("user_message_id", "workflow_run_id"):
            value = getattr(ctx, attr, None)
            if isinstance(value, str) and value.strip():
                return value.strip()
        return None
    except Exception:
        return None


def _has_narrow_anchor(query: str) -> bool:
    """True when ``query`` carries a specific locator, not just a topic word.

    Pure string test: the identifier WITH its marker ("Tabelle 1b",
    "Pkt. 5.1", "OIB-RL 2", a file name). A bare mention ("Welche Tabelle
    gilt …") returns False, so the gate keeps such topic questions eligible.
    """
    if not isinstance(query, str) or not query.strip():
        return False
    return _NARROW_ANCHOR_RE.search(query) is not None


def _head_scores(chunks: Sequence[Any]) -> list[float]:
    """The head cosine scores, best first, or ``[]`` when unreadable."""
    try:
        scores: list[float] = []
        for chunk in list(chunks or [])[:_STRONG_MIN_CHUNKS]:
            score = getattr(chunk, "score", None)
            if isinstance(score, bool) or not isinstance(score, (int, float)):
                return []
            value = float(score)
            if not 0.0 <= value <= 1.0:
                return []
            scores.append(value)
        return scores
    except Exception:
        return []


def scores_decisively_strong(chunks: Sequence[Any]) -> bool:
    """True when the pool's head is strong enough that judging wastes a call.

    Pure, so tests pin it without a model: top-1 at or above
    :data:`_STRONG_TOP1_FLOOR` AND the top-3 mean at or above
    :data:`_STRONG_TOP3_MEAN_FLOOR`. Anything unreadable is not strong.
    """
    scores = _head_scores(chunks)
    if len(scores) < _STRONG_MIN_CHUNKS:
        return False
    return scores[0] >= _STRONG_TOP1_FLOOR and (sum(scores) / len(scores)) >= _STRONG_TOP3_MEAN_FLOOR


def is_known_entity_lookup(query: str) -> bool:
    """True when ``query`` names a family, a Fundstelle or a file.

    Pure string test, no model: an OIB-RL mention, a Punkt/paragraph/page
    marker or a filename means the caller is addressing evidence, and the
    judge's paraphrases are the opposite of what was asked.
    """
    if not isinstance(query, str) or not query.strip():
        return False
    return _KNOWN_ENTITY_RE.search(query) is not None


def should_skip_judge(
    query: str,
    chunks: Sequence[Any],
    *,
    file_name: str | None = None,
    doc_class: str | None = None,
    title_contains: str | None = None,
    folder: str | None = None,
    embedding_model: str | None = None,
) -> tuple[bool, str]:
    """Whether the judge should not run, and the machine-readable reason.

    Returns ``(True, reason)`` with reason one of ``"file_pinned"``,
    ``"strong_scores"`` or ``"known_entity"``, else ``(False, "")``.
    A pinned ``file_name`` is the existing precision-lookup rule, stated here
    so instrumentation and tests read one gate instead of two. Never raises.

    Three load-bearing guards:

    * Empty pool forces the judge: even with every skip signal present, an
      empty pool widens once (bounded by the per-turn cap) rather than
      answering from nothing.
    * ``strong_scores`` needs the CALIBRATED embedder
      (:data:`_CALIBRATED_EMBEDDING_MODELS`): the floors are a number on one
      model's cosine distribution, and an uncalibrated deployment gets the
      judge instead of a threshold that means nothing there.
    * ``known_entity`` needs anchoring: the entity mention
      (:func:`is_known_entity_lookup`) PLUS a narrow scope — a specific
      locator in the query (:func:`_has_narrow_anchor`) or a caller filter
      (``file_name``/``doc_class``/``title_contains``/``folder``). A topic
      question that merely mentions a table stays eligible.
    """
    try:
        pool = list(chunks or [])
        if not pool:
            return False, ""
        if file_name and str(file_name).strip():
            return True, "file_pinned"
        if _is_calibrated_embedding(embedding_model) and scores_decisively_strong(pool):
            return True, "strong_scores"
        if is_known_entity_lookup(query):
            narrowed_by_caller = any(
                isinstance(value, str) and bool(value.strip()) for value in (doc_class, title_contains, folder)
            )
            if narrowed_by_caller or _has_narrow_anchor(query):
                return True, "known_entity"
            return False, ""
        return False, ""
    except Exception:
        return False, ""


_REQUERY_SPENT_TURNS: dict[str, None] = {}
_REQUERY_SPENT_LIMIT = 64
_REQUERY_SPENT_LOCK = Lock()


def _visible_turn_id() -> str | None:
    """The turn id this context was stamped with, if any (never raises)."""
    try:
        turn = _REQUERY_TURN_ID.get()
    except Exception:
        return None
    return turn if isinstance(turn, str) and turn else None


def requery_already_fired() -> bool:
    """Whether this turn already spent its one requery firing."""
    turn = _visible_turn_id()
    if turn is not None:
        with _REQUERY_SPENT_LOCK:
            if turn in _REQUERY_SPENT_TURNS:
                return True
    try:
        return bool(_REQUERY_FIRED.get())
    except Exception:
        return False


def claim_requery_slot() -> bool:
    """Claim the turn's one firing; False means it was already spent.

    The first caller wins — across sequential searches AND across the parallel
    rounds of one turn, which is why the claim is recorded per TURN (the
    shared ledger) and not only per context: three sequential searches cost at
    most one second round no matter what three judges would have said, and two
    concurrent ones cost one, not two.
    """
    turn = _visible_turn_id()
    if turn is not None:
        with _REQUERY_SPENT_LOCK:
            if turn in _REQUERY_SPENT_TURNS:
                return False
            _REQUERY_SPENT_TURNS[turn] = None
            while len(_REQUERY_SPENT_TURNS) > _REQUERY_SPENT_LIMIT:
                _REQUERY_SPENT_TURNS.pop(next(iter(_REQUERY_SPENT_TURNS)))
        try:
            _REQUERY_FIRED.set(True)
        except Exception:
            pass
        return True
    try:
        if _REQUERY_FIRED.get():
            return False
        _REQUERY_FIRED.set(True)
        return True
    except Exception:
        return True


def reset_requery_slot() -> None:
    """Open a new turn's firing slot. Fail-open; never raises."""
    try:
        _REQUERY_FIRED.set(False)
    except Exception:
        pass
    try:
        _REQUERY_TURN_ID.set(None)
    except Exception:
        pass


def reset_requery_slot_for_turn(span_round: int | None = None, *, turn_id: str | None = None) -> None:
    """Open the slot when a new turn starts; unstamped callers get a slot.

    Resolution order: the explicit ``turn_id`` (tests) else the context turn
    id (:func:`_current_turn_id`); when no turn id is visible, the
    executing-round stamp (0 opens a new turn); when neither is visible
    (tests, standalone callers), open the slot so the caller gets one firing
    rather than inheriting another context's spent cap. Fail-open; never
    raises.
    """
    try:
        current = turn_id if turn_id is not None else _current_turn_id()
        if current is not None:
            try:
                stored = _REQUERY_TURN_ID.get()
            except Exception:
                stored = None
            if stored != current:
                try:
                    _REQUERY_TURN_ID.set(current)
                except Exception:
                    pass
                try:
                    _REQUERY_FIRED.set(False)
                except Exception:
                    pass
            return
        if span_round is not None:
            if span_round == 0:
                try:
                    _REQUERY_TURN_ID.set(None)
                except Exception:
                    pass
                try:
                    _REQUERY_FIRED.set(False)
                except Exception:
                    pass
            return
        try:
            _REQUERY_TURN_ID.set(None)
        except Exception:
            pass
        try:
            _REQUERY_FIRED.set(False)
        except Exception:
            pass
    except Exception:
        pass
