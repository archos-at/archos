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

from knowledge_layer.search.rerank import _build_user_prompt

from agent.common.message_utils import response_text

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

    sufficient: bool
    queries: list[str] = field(default_factory=list)

    @property
    def wants_requery(self) -> bool:
        return not self.sufficient and bool(self.queries)


SUFFICIENT = SufficiencyVerdict(sufficient=True)


def _normalised(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip().casefold()


def _parse_verdict(raw: str, *, original_query: str, max_queries: int) -> SufficiencyVerdict | None:
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

    judged: int
    best: float
    threshold: float
    widened: bool
    unjudged: int = 0

    def reason(self) -> str:
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
    if not isinstance(query, str) or not query.strip():
        return False
    return _NARROW_ANCHOR_RE.search(query) is not None


def _head_scores(chunks: Sequence[Any]) -> list[float]:
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
    scores = _head_scores(chunks)
    if len(scores) < _STRONG_MIN_CHUNKS:
        return False
    return scores[0] >= _STRONG_TOP1_FLOOR and (sum(scores) / len(scores)) >= _STRONG_TOP3_MEAN_FLOOR


def is_known_entity_lookup(query: str) -> bool:
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
    try:
        turn = _REQUERY_TURN_ID.get()
    except Exception:
        return None
    return turn if isinstance(turn, str) and turn else None


def requery_already_fired() -> bool:
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
    try:
        _REQUERY_FIRED.set(False)
    except Exception:
        pass
    try:
        _REQUERY_TURN_ID.set(None)
    except Exception:
        pass


def reset_requery_slot_for_turn(span_round: int | None = None, *, turn_id: str | None = None) -> None:
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
