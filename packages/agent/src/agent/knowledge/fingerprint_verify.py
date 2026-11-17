from __future__ import annotations

import logging
from collections.abc import Mapping
from collections.abc import Sequence
from typing import TYPE_CHECKING
from typing import Any

if TYPE_CHECKING:
    from agent.knowledge.project_experience import FingerprintValue
    from agent.knowledge.project_experience import VocabularyEntry

logger = logging.getLogger(__name__)

SLOT = "experience_verify"

# Measured 10 Oct 2026 on 32 hand-labelled quotes: no wrong value scored above 0.32, correct values scored as low as 0.14; at 0.5 the check dropped 5-6 of 17 correct values, at 0.1 it keeps all 17 and still rejects the pen's slips (0.03-0.05).
STATED_THRESHOLD = 0.1

UNCHECKED_KEYS = frozenset({"building_class", "gebaeudeklasse"})

MAX_QUOTES = 3

FACT_LABELS = {
    "federal_state": "Bundesland",
    "construction_method": "Bauweise",
    "uses": "Nutzung",
    "work_type": "Art des Vorhabens",
    "oib_edition": "OIB-Richtlinien-Ausgabe, nach der geplant wurde",
}
FACT_LABELS.update(
    {
        "bundesland": FACT_LABELS["federal_state"],
        "bauweise": FACT_LABELS["construction_method"],
        "nutzungen": FACT_LABELS["uses"],
        "vorhabensart": FACT_LABELS["work_type"],
        "oib_ausgabe": FACT_LABELS["oib_edition"],
    }
)

STATED_QUESTION = {
    "type": "noul",
    "instructions": (
        "The quotes come from one building project's own documents. Do they state that this project's fact, "
        "named in the state, has the value named in the state?"
    ),
    "criteria": {
        "true": (
            "The quoted words say so about this project, in these or equivalent words (a place in that "
            "Bundesland, a construction of that kind, a use of that kind, the named edition)."
        ),
        "false": (
            "The quotes say something else, name the value only for a neighbour, a product, a norm or a "
            "comparison, or do not concern this fact at all."
        ),
    },
}


def _label(entry: VocabularyEntry, token: str) -> str:
    return next((option.label for option in entry.options if option.token == token), token)


def token_state(key: str, label: str, quotes: Sequence[str], *, fact: str | None = None) -> dict[str, Any]:
    return {
        "fact": fact or FACT_LABELS.get(key, key),
        "value": label,
        "quotes": [quote[:300] for quote in quotes[:MAX_QUOTES]],
        "language": "de",
    }


def _tokens(value: FingerprintValue) -> list[str]:
    return [value.value] if isinstance(value.value, str) else list(value.value)


def verify_fingerprint(
    values: Sequence[FingerprintValue],
    vocabulary: Mapping[str, VocabularyEntry],
    *,
    organization_id: str | None = None,
    fact_labels: Mapping[str, str] | None = None,
) -> list[FingerprintValue]:
    asked: list[tuple[int, str]] = []
    states: list[dict[str, Any]] = []
    for index, value in enumerate(values):
        entry = vocabulary.get(value.key)
        if value.key in UNCHECKED_KEYS or entry is None:
            continue
        quotes = [evidence.quote for evidence in value.evidence]
        for token in _tokens(value):
            asked.append((index, token))
            fact = (fact_labels or {}).get(value.key)
            states.append(token_state(value.key, _label(entry, token), quotes, fact=fact))
    if not states:
        return list(values)
    try:
        from agent.common.decisions import decide_many_blocking

        decided = decide_many_blocking(states, {"stated": STATED_QUESTION}, slot=SLOT, organization_id=organization_id)
    except Exception:  # noqa: BLE001 — the reading stands as it was
        logger.debug("Fingerprint verification failed", exc_info=True)
        return list(values)
    rejected: dict[int, set[str]] = {}
    for (index, token), decision in zip(asked, decided, strict=True):
        p = decision.noul("stated") if decision is not None else None
        if p is not None and p < STATED_THRESHOLD:
            rejected.setdefault(index, set()).add(token)
    kept = []
    for index, value in enumerate(values):
        dropped = rejected.get(index, set())
        if not dropped:
            kept.append(value)
            continue
        tokens = [token for token in _tokens(value) if token not in dropped]
        logger.info("Fingerprint %s: the quotes do not state %s", value.key, sorted(dropped))
        if not tokens:
            continue
        kept.append(value.model_copy(update={"value": tokens if isinstance(value.value, list) else tokens[0]}))
    return kept
