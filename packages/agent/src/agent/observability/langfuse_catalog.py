"""Everything Grid configures inside Langfuse, as data (ADR-0089).

Score configs, the review queue, the LLM-as-a-judge evaluators and their rule,
and the golden-question dataset. Clicked together in the Langfuse UI they would
exist on one deployment and not the next, and nobody could review a change to
a judge's prompt. Declared here, ``scripts/langfuse_provision.py`` (``task
langfuse:provision``) compares them with what a Langfuse project holds and,
with ``--apply``, creates what is missing.

Pure data and a loader; no network. The score names come from
``observability.langfuse_scores.SCORE_DEFINITIONS``, the one list.
"""

from __future__ import annotations

from dataclasses import dataclass
from dataclasses import field
from pathlib import Path
from typing import Any

from agent.common.licensed_text import LICENSED_TRACE_TAG
from agent.common.residency import QUALITY_EVALUATION_TAG

#: The queue every down-voted answer lands in (the BFF adds it,
#: ``apps/workspace/bff/langfuse/feedback-score.ts`` ``REVIEW_QUEUE_NAME``).
REVIEW_QUEUE_NAME = "answer-review"


@dataclass(frozen=True)
class QueueDefinition:
    name: str
    description: str
    #: Score names a reviewer fills in; each must be a defined score.
    score_names: tuple[str, ...]


@dataclass(frozen=True)
class JudgeDefinition:
    """One LLM-as-a-judge evaluator. Its name is the score it writes."""

    name: str
    description: str
    prompt: str
    #: Prompt variable -> (source, JSONPath or None), Langfuse's mapping.
    variables: dict[str, tuple[str, str | None]] = field(default_factory=dict)


@dataclass(frozen=True)
class RuleDefinition:
    """Which observations the judges run on. Always provisioned DISABLED.

    Enabling a rule sends answers to the evaluation model and costs money per
    turn, so it is a decision a person makes in the Langfuse UI, after
    checking the project's evaluation model sits on a zero-data-retention
    endpoint (ADR-0074).
    """

    name: str
    judge_names: tuple[str, ...]
    sampling: float
    filter: list[dict[str, Any]]


QUEUES: tuple[QueueDefinition, ...] = (
    QueueDefinition(
        name=REVIEW_QUEUE_NAME,
        description=(
            "Answers an asker marked not helpful. A domain reviewer reads the question, the answer and its "
            "sources and records whether the substance and the sources were right."
        ),
        score_names=("review-correctness", "review-sources"),
    ),
)

#: The root observation of a chat turn: its input is the wire ``UserMessage``
#: (the question is ``$.text``), its output the answer text (``turn_outcome``).
_QUESTION = ("input", "$.text")
_ANSWER = ("output", None)

JUDGES: tuple[JudgeDefinition, ...] = (
    JudgeDefinition(
        name="judge-answers-question",
        description="How directly the answer addresses the question.",
        prompt=(
            "You review answers an assistant gave Austrian architects and planners about building regulations "
            "(OIB-Richtlinien, Bauordnungen). Question and answer are in German.\n\n"
            "Question:\n{{question}}\n\nAnswer:\n{{answer}}\n\n"
            "Score from 0 to 1 how directly the answer addresses what was asked: 1 when it answers the question "
            "itself first, 0.5 when the answer is there but buried or partial, 0 when it answers a different "
            "question or only describes where to look."
        ),
        variables={"question": _QUESTION, "answer": _ANSWER},
    ),
    JudgeDefinition(
        name="judge-uncited-claims",
        description="Normative requirements stated without a citation.",
        prompt=(
            "You review answers about Austrian building regulations. Citations are written as [1], [2] and so on.\n\n"
            "Answer:\n{{answer}}\n\n"
            "Return true when the answer states a normative requirement (a limit, a duty, a permitted value, a "
            "classification) without a [N] citation in the same sentence or the sentence before. Return false "
            "when every such requirement is cited, or the answer states none."
        ),
        variables={"answer": _ANSWER},
    ),
    JudgeDefinition(
        name="judge-clarity",
        description="Whether a planner could act on the answer as written.",
        prompt=(
            "You review answers an assistant gave architects and planners. The answer is in German.\n\n"
            "Question:\n{{question}}\n\nAnswer:\n{{answer}}\n\n"
            "Classify the answer as clear (a planner can act on it as written), partly_clear (the result is "
            "there but needs rereading or interpretation) or unclear (a planner could not act on it)."
        ),
        variables={"question": _QUESTION, "answer": _ANSWER},
    ),
)


def judge_rules(residency_on: bool) -> tuple[RuleDefinition, ...]:
    """The judge rules, for a deployment with a residency cell switched on or not (ADR-0167).

    Inside a cell a judge runs only where the organization allows quality evaluation: include-only, so a trace
    without the ``purpose_ok:quality_evaluation`` tag (a policy that could not be read) is never judged. Without
    a cell the rule is what it was before the policy existed, because only a chat turn carries the tag.
    """
    conditions: list[dict[str, Any]] = [
        {"type": "stringOptions", "column": "traceName", "operator": "any of", "value": ["chat-turn"]},
        {"type": "boolean", "column": "isRootObservation", "operator": "=", "value": True},
        {"type": "arrayOptions", "column": "tags", "operator": "any of", "value": ["outcome:answered"]},
        # A turn that read licensed text holds references in its trace, not the text it was grounded in,
        # so a judge would grade the answer against the wrong evidence (ADR-0164, design 6.1).
        {"type": "arrayOptions", "column": "tags", "operator": "none of", "value": [LICENSED_TRACE_TAG]},
    ]
    if residency_on:
        conditions.append(
            {"type": "arrayOptions", "column": "tags", "operator": "any of", "value": [QUALITY_EVALUATION_TAG]}
        )
    return (
        RuleDefinition(
            name="chat-turn-judges",
            judge_names=tuple(judge.name for judge in JUDGES),
            # One turn in five: enough to chart, a fifth of the cost.
            sampling=0.2,
            # The root observation of an answered chat turn: the one whose input
            # is the question and whose output is the answer.
            filter=conditions,
        ),
    )


GOLDEN_DATASET_NAME = "golden-questions"
GOLDEN_QUESTIONS_PATH = Path("tests/fixtures/derivation/loop_eval_questions.yaml")

#: The fields of a golden question that say what a right answer is.
_EXPECTATION_KEYS = ("family", "clause", "paragraph", "kind", "kind_also", "expect")


def golden_dataset_items(repo_root: Path) -> list[dict[str, Any]]:
    """The answer suite's golden questions as Langfuse dataset items, ids stable across runs."""
    import yaml

    document = yaml.safe_load((repo_root / GOLDEN_QUESTIONS_PATH).read_text(encoding="utf-8"))
    items = []
    for question in document.get("questions") or []:
        expected = {key: question[key] for key in _EXPECTATION_KEYS if question.get(key) is not None}
        items.append(
            {
                "id": f"golden-{question['id']}",
                "input": {"text": " ".join(str(question["question"]).split())},
                "expected_output": expected or None,
                "metadata": {"question_id": question["id"], "suite": question.get("suite")},
            }
        )
    return items
