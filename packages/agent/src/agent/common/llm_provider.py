import logging
from collections.abc import Mapping
from enum import StrEnum

from langchain_core.language_models import BaseChatModel

from agent.common.model_overrides import AgentGroup
from agent.common.model_overrides import override_model
from agent.common.model_overrides import override_reasoning_effort

logger = logging.getLogger(__name__)


class LLMRole(StrEnum):
    ROUTER = "router"
    PLANNER = "planner"
    RESEARCHER = "researcher"
    EVIDENCE_JUDGE = "evidence_judge"
    GRADER = "grader"
    SUMMARIZER = "summarizer"
    ORCHESTRATOR = "orchestrator"
    REFLECTION = "reflection"
    CLARIFIER = "clarifier"
    META_CHATTER = "meta_chatter"
    REPORT_WRITER = "report_writer"


class LLMProvider:
    def __init__(self) -> None:
        self._llms: dict[LLMRole, BaseChatModel] = {}
        self._default: BaseChatModel | None = None
        self._groups: dict[LLMRole, AgentGroup] = {}
        self._default_group: AgentGroup | None = None

    def set_default(self, llm: BaseChatModel, group: AgentGroup | None = None) -> None:
        self._default = llm
        self._default_group = group

    def configure(self, role: LLMRole, llm: BaseChatModel, group: AgentGroup | None = None) -> None:
        self._llms[role] = llm
        if group is not None:
            self._groups[role] = group

    def get(self, role: LLMRole) -> BaseChatModel:
        if role in self._llms:
            return self._llms[role]
        if self._default is not None:
            return self._default
        raise ValueError(
            f"No LLM configured for role '{role}' and no default LLM set. Call set_default() or configure() first."
        )

    def with_model_overrides(self, overrides: Mapping[str, str]) -> LLMProvider:
        override_groups = {g for g in AgentGroup if g.value in overrides}
        tagged_groups = {g for g in (self._default_group, *self._groups.values()) if g is not None}
        applied_groups = override_groups & tagged_groups
        if not applied_groups:
            return self

        logger.info(
            "Applying model overrides: %s",
            {g.value: overrides[g.value] for g in sorted(applied_groups, key=lambda g: g.value)},
        )

        derived = LLMProvider()
        derived._groups = dict(self._groups)
        derived._default_group = self._default_group

        def _resolve(llm: BaseChatModel, group: AgentGroup | None) -> BaseChatModel:
            model_id = overrides.get(group.value) if group is not None else None
            return override_model(llm, model_id) if model_id else llm

        if self._default is not None:
            derived._default = _resolve(self._default, self._default_group)
        for role, llm in self._llms.items():
            derived._llms[role] = _resolve(llm, self._groups.get(role))
        return derived

    def with_reasoning_efforts(self, efforts: Mapping[str, str]) -> LLMProvider:
        tagged_groups = {g for g in (self._default_group, *self._groups.values()) if g is not None}
        applied = {g: efforts[g.value] for g in tagged_groups if efforts.get(g.value)}
        if not applied:
            return self

        logger.info(
            "Reasoning effort active: %s",
            {g.value: applied[g] for g in sorted(applied, key=lambda g: g.value)},
        )

        derived = LLMProvider()
        derived._groups = dict(self._groups)
        derived._default_group = self._default_group

        def _resolve(llm: BaseChatModel, group: AgentGroup | None) -> BaseChatModel:
            effort = applied.get(group) if group is not None else None
            return override_reasoning_effort(llm, effort) if effort else llm

        if self._default is not None:
            derived._default = _resolve(self._default, self._default_group)
        for role, llm in self._llms.items():
            derived._llms[role] = _resolve(llm, self._groups.get(role))
        return derived

    def with_zdr(self, zdr_only: bool) -> LLMProvider:
        if not zdr_only:
            return self

        from agent.common.model_overrides import apply_zdr_routing

        rebuilt: dict[int, BaseChatModel] = {}

        def _resolve(llm: BaseChatModel) -> BaseChatModel:
            key = id(llm)
            if key not in rebuilt:
                rebuilt[key] = apply_zdr_routing(llm)
            return rebuilt[key]

        derived = LLMProvider()
        derived._groups = dict(self._groups)
        derived._default_group = self._default_group
        if self._default is not None:
            derived._default = _resolve(self._default)
        for role, llm in self._llms.items():
            derived._llms[role] = _resolve(llm)
        return derived

    def with_credential(self, credential) -> LLMProvider:
        if credential is None:
            return self

        from agent.common.llm_credentials import apply_org_credential

        rebuilt: dict[int, BaseChatModel] = {}

        def _resolve(llm: BaseChatModel) -> BaseChatModel:
            key = id(llm)
            if key not in rebuilt:
                rebuilt[key] = apply_org_credential(llm, credential)
            return rebuilt[key]

        derived = LLMProvider()
        derived._groups = dict(self._groups)
        derived._default_group = self._default_group
        if self._default is not None:
            derived._default = _resolve(self._default)
        for role, llm in self._llms.items():
            derived._llms[role] = _resolve(llm)
        return derived

    def has_role(self, role: LLMRole) -> bool:
        return role in self._llms

    def configured_roles(self) -> list[LLMRole]:
        return list(self._llms.keys())
