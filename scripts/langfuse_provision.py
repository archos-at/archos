#!/usr/bin/env python3


from __future__ import annotations

import argparse
import os
import sys
from dataclasses import dataclass
from dataclasses import field
from pathlib import Path
from typing import Any

from agent.common.residency import active_cell
from agent.observability.langfuse_catalog import GOLDEN_DATASET_NAME
from agent.observability.langfuse_catalog import JUDGES
from agent.observability.langfuse_catalog import QUEUES
from agent.observability.langfuse_catalog import JudgeDefinition
from agent.observability.langfuse_catalog import RuleDefinition
from agent.observability.langfuse_catalog import golden_dataset_items
from agent.observability.langfuse_catalog import judge_rules
from agent.observability.langfuse_scores import SCORE_DEFINITIONS
from agent.observability.langfuse_scores import ScoreDefinition

REPO_ROOT = Path(__file__).resolve().parents[1]
_DEFINITIONS = {definition.name: definition for definition in SCORE_DEFINITIONS}


def _rules() -> tuple[RuleDefinition, ...]:
    return judge_rules(active_cell() is not None)


@dataclass
class Plan:
    score_configs: list[ScoreDefinition] = field(default_factory=list)
    queues: list[str] = field(default_factory=list)
    judges: list[str] = field(default_factory=list)
    rules: list[str] = field(default_factory=list)
    dataset: bool = False
    dataset_items: list[dict[str, Any]] = field(default_factory=list)
    drift: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    def is_empty(self) -> bool:
        return not (
            self.score_configs or self.queues or self.judges or self.rules or self.dataset or self.dataset_items
        )


def _paged(fetch: Any) -> list[Any]:
    rows: list[Any] = []
    page = 1
    while True:
        response = fetch(page=page, limit=100)
        rows.extend(response.data)
        if page >= int(getattr(response.meta, "total_pages", 1) or 1):
            return rows
        page += 1


def _cursored(fetch: Any) -> list[Any]:
    rows: list[Any] = []
    cursor = None
    while True:
        response = fetch(limit=100, cursor=cursor) if cursor else fetch(limit=100)
        rows.extend(response.data)
        cursor = getattr(response.meta, "next_cursor", None) or getattr(response.meta, "cursor", None)
        if not cursor:
            return rows


def _category_labels(config: Any) -> tuple[str, ...]:
    return tuple(category.label for category in (getattr(config, "categories", None) or []))


def config_drift(definition: ScoreDefinition, config: Any) -> str | None:
    data_type = str(getattr(config, "data_type", ""))
    if data_type != definition.data_type:
        return f"score config {definition.name}: type {data_type}, declared {definition.data_type}"
    if definition.categories and _category_labels(config) != definition.categories:
        return (
            f"score config {definition.name}: categories {_category_labels(config)}, declared {definition.categories}"
        )
    if getattr(config, "is_archived", False):
        return f"score config {definition.name}: archived in Langfuse"
    return None


def plan_against(state: dict[str, Any]) -> Plan:
    plan = Plan()
    configs = {config.name: config for config in state["score_configs"]}
    for definition in SCORE_DEFINITIONS:
        existing = configs.get(definition.name)
        if existing is None:
            plan.score_configs.append(definition)
            continue
        drift = config_drift(definition, existing)
        if drift:
            plan.drift.append(drift)
    queue_names = {queue.name for queue in state["queues"]}
    plan.queues = [queue.name for queue in QUEUES if queue.name not in queue_names]
    evaluator_names = {evaluator.name for evaluator in state["evaluators"]}
    plan.judges = [judge.name for judge in JUDGES if judge.name not in evaluator_names]
    rule_names = {rule.name for rule in state["rules"]}
    plan.rules = [rule.name for rule in _rules() if rule.name not in rule_names]
    if not state["llm_connections"] and (plan.judges or plan.rules):
        plan.notes.append(
            "No LLM connection in this project: the judges are created but cannot run until one is added "
            "(Project Settings > LLM Connections), on a zero-data-retention endpoint."
        )
    plan.dataset = not state["dataset"]
    known = set(state["dataset_item_ids"])
    plan.dataset_items = [item for item in golden_dataset_items(REPO_ROOT) if item["id"] not in known]
    return plan


def read_state(api: Any) -> dict[str, Any]:
    from langfuse.api.core.api_error import ApiError

    try:
        dataset = api.datasets.get(GOLDEN_DATASET_NAME) is not None
        item_ids = [
            item.id for item in _paged(lambda **page: api.dataset_items.list(dataset_name=GOLDEN_DATASET_NAME, **page))
        ]
    except ApiError as error:
        if error.status_code != 404:
            raise
        dataset, item_ids = False, []
    return {
        "score_configs": _paged(api.score_configs.get),
        "queues": _paged(api.annotation_queues.list_queues),
        "evaluators": _cursored(api.evaluators.list),
        "rules": _cursored(api.evaluation_rules.list),
        "llm_connections": len(_paged(api.llm_connections.list)),
        "dataset": dataset,
        "dataset_item_ids": item_ids,
    }


def _create_score_config(api: Any, definition: ScoreDefinition) -> None:
    from langfuse.api.commons.types.config_category import ConfigCategory

    kwargs: dict[str, Any] = {"name": definition.name, "data_type": definition.data_type}
    kwargs["description"] = definition.description
    if definition.categories:
        kwargs["categories"] = [
            ConfigCategory(label=label, value=index) for index, label in enumerate(definition.categories)
        ]
    if definition.min_value is not None:
        kwargs["min_value"] = definition.min_value
    if definition.max_value is not None:
        kwargs["max_value"] = definition.max_value
    api.score_configs.create(**kwargs)


def _output_definition(definition: ScoreDefinition) -> Any:
    from langfuse.api.evaluation_commons.types import evaluator_output_definition as output

    if definition.data_type == "CATEGORICAL":
        return output.EvaluatorOutputDefinition_Categorical(
            categories=list(definition.categories), should_allow_multiple_matches=False
        )
    if definition.data_type == "BOOLEAN":
        return output.EvaluatorOutputDefinition_Boolean()
    return output.EvaluatorOutputDefinition_Numeric(min_value=definition.min_value, max_value=definition.max_value)


def _variable_mapping(judge: JudgeDefinition) -> list[Any]:
    from langfuse.api.evaluation_commons.types.prompt_variable_mapping_input import PromptVariableMappingInput

    return [
        PromptVariableMappingInput(variable=variable, source=source, json_path=json_path)
        for variable, (source, json_path) in judge.variables.items()
    ]


def _create_judge(api: Any, judge: JudgeDefinition) -> None:
    from langfuse.api.evaluators.types.create_evaluator_request import CreateEvaluatorRequest_LlmAsJudge

    api.evaluators.create(
        request=CreateEvaluatorRequest_LlmAsJudge(
            name=judge.name,
            description=judge.description,
            prompt=judge.prompt,
            variable_mapping=_variable_mapping(judge),
            output_definition=_output_definition(_DEFINITIONS[judge.name]),
        )
    )


def _create_rule(api: Any, name: str) -> None:
    from langfuse.api.evaluation_commons.types.evaluation_rule_filter import EvaluationRuleFilter
    from langfuse.api.evaluation_rules.types.evaluation_rule_evaluator_assignment_input import (
        EvaluationRuleEvaluatorAssignmentInput,
    )
    from pydantic import TypeAdapter

    rule = next(rule for rule in _rules() if rule.name == name)
    evaluator_ids = {evaluator.name: evaluator.id for evaluator in _cursored(api.evaluators.list)}
    api.evaluation_rules.create(
        name=rule.name,
        enabled=False,
        sampling=rule.sampling,
        filter=[TypeAdapter(EvaluationRuleFilter).validate_python(condition) for condition in rule.filter],
        evaluator_assignments=[
            EvaluationRuleEvaluatorAssignmentInput(evaluator_id=evaluator_ids[judge]) for judge in rule.judge_names
        ],
    )


def _create_queue(api: Any, name: str) -> None:
    queue = next(queue for queue in QUEUES if queue.name == name)
    config_ids = {config.name: config.id for config in _paged(api.score_configs.get)}
    api.annotation_queues.create_queue(
        name=queue.name,
        description=queue.description,
        score_config_ids=[config_ids[score] for score in queue.score_names],
    )


def apply(api: Any, plan: Plan) -> None:
    for definition in plan.score_configs:
        _create_score_config(api, definition)
    for name in plan.queues:
        _create_queue(api, name)
    for name in plan.judges:
        _create_judge(api, next(judge for judge in JUDGES if judge.name == name))
    for name in plan.rules:
        _create_rule(api, name)
    if plan.dataset:
        api.datasets.create(
            name=GOLDEN_DATASET_NAME,
            description="The answer suite's golden questions (tests/fixtures/derivation/loop_eval_questions.yaml).",
        )
    for item in plan.dataset_items:
        api.dataset_items.create(dataset_name=GOLDEN_DATASET_NAME, **item)


def render(plan: Plan) -> str:
    lines = []
    lines += [f"+ score config {definition.name} ({definition.data_type})" for definition in plan.score_configs]
    lines += [f"+ annotation queue {name}" for name in plan.queues]
    lines += [f"+ LLM-as-a-judge evaluator {name}" for name in plan.judges]
    lines += [f"+ evaluation rule {name} (disabled; enable it in the Langfuse UI)" for name in plan.rules]
    if plan.dataset:
        lines.append(f"+ dataset {GOLDEN_DATASET_NAME}")
    if plan.dataset_items:
        lines.append(f"+ {len(plan.dataset_items)} dataset items in {GOLDEN_DATASET_NAME}")
    lines += [f"! drift: {drift}" for drift in plan.drift]
    lines += [f"i {note}" for note in plan.notes]
    return "\n".join(lines) if lines else "Nothing to change: the project matches the declarations."


def _client() -> Any:
    from langfuse import Langfuse

    missing = [
        name for name in ("LANGFUSE_HOST", "LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY") if not os.environ.get(name)
    ]
    if missing:
        raise SystemExit(f"Set {', '.join(missing)} to reach the Langfuse project.")
    return Langfuse(host=os.environ["LANGFUSE_HOST"], tracing_enabled=False).api


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Bring a Langfuse project in line with what Grid declares, or say what that would change."
    )
    parser.add_argument("--apply", action="store_true", help="create what is missing (default: only print the plan)")
    args = parser.parse_args(argv)
    api = _client()
    plan = plan_against(read_state(api))
    print(render(plan))
    if not args.apply or plan.is_empty():
        if not args.apply and not plan.is_empty():
            print("\nCheck only. Run with --apply to create the items marked +.")
        return 0
    apply(api, plan)
    print("\nApplied.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
