"""The shape of one declared Langfuse score (``ScoreDefinition``), apart from the list of them.

Its own module so a part that declares scores of its own (``base_knowledge_scores``)
builds them without importing ``langfuse_scores``, which spreads them into
``SCORE_DEFINITIONS``. ``langfuse_scores`` re-exports both names.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

DataType = Literal["NUMERIC", "CATEGORICAL", "BOOLEAN"]


@dataclass(frozen=True)
class ScoreDefinition:
    """One score name Grid writes, and the Langfuse score config that describes it."""

    name: str
    data_type: DataType
    description: str
    #: Who writes it: the agent at runtime, the BFF from a vote, a reviewer in
    #: an annotation queue, or a Langfuse LLM-as-a-judge evaluator.
    writer: Literal["agent", "bff", "annotation", "judge"] = "agent"
    categories: tuple[str, ...] = ()
    min_value: float | None = None
    max_value: float | None = None
