from dataclasses import dataclass
from typing import Any
from typing import ClassVar
from typing import Literal

from langchain_core.messages import BaseMessage
from pydantic import BaseModel
from pydantic import ConfigDict
from pydantic import Field
from pydantic import model_validator

from agent.common.plan_documents import PlanDocuments
from agent.common.plan_vocabulary import modernize_plan

PlanDecision = Literal["approved", "shallow", "cancelled", "feedback"]
"""What one reply to the plan preview asks for. ``feedback`` means "revise it"."""

PlanOutcome = Literal["approved", "shallow", "cancelled"]
"""Where the plan preview ended. ``PlanDecision`` minus the one that loops."""

PlanGenre = Literal["inspection_report", "file_note", "comparison", "checklist", "report"]
"""The document genre a run writes. Office genres, not whitepaper shapes."""

PlanDepth = Literal["quick_check", "expert_report"]
"""How deep the report goes: the smallest complete form, or the full derivation."""


class _StrictContract(BaseModel):
    model_config: ClassVar[ConfigDict] = {"extra": "forbid"}


class ClarificationResponse(_StrictContract):
    model_config = ConfigDict(
        json_schema_extra={
            "description": (
                "Structured response from the clarifier LLM.\n"
                "\n"
                "Attributes:\n"
                "    needs_clarification: True if additional clarification is needed,\n"
                "        False if the agent has enough information to proceed.\n"
                "    clarification_question: The clarification question to ask the user.\n"
                "        Required when needs_clarification is True, null otherwise.\n"
                "    options: Short labels for the answers offered by the question, so the\n"
                "        UI can render a picker instead of asking the user to retype one of\n"
                "        them. Empty when the question has no enumerable answers."
            )
        }
    )

    needs_clarification: bool = Field(
        description="True if additional clarification is needed from the user, "
        "False if enough information has been gathered to proceed with research."
    )
    clarification_question: str | None = Field(
        description="The clarification question to ask the user. Required when needs_clarification is True, "
        "null otherwise.",
    )
    options: list[str] = Field(
        description="Short label of each offered answer (the pickable part only, not the explanation). "
        "Empty when the question has no enumerable answers, and always when needs_clarification is false.",
    )

    @model_validator(mode="before")
    @classmethod
    def _fill_omitted_keys(cls, data: Any) -> Any:
        if isinstance(data, dict):
            return {"clarification_question": None, "options": [], **data}
        return data

    @classmethod
    def complete(cls) -> ClarificationResponse:
        return cls(needs_clarification=False, clarification_question=None, options=[])

    def is_valid(self) -> bool:
        if self.needs_clarification:
            return bool(self.clarification_question)
        return not self.options


def _require_every_property(schema: dict[str, Any]) -> None:
    schema["required"] = list(schema.get("properties", {}))


PLAN_RESPONSE_DESCRIPTION = (
    "Structured response from the planner LLM: the research plan preview.\n"
    "\n"
    "``sections`` are what the report will cover, in the order it will. The reader edits them, the genre and\n"
    "the depth on the plan card before the run starts, and the approved plan\n"
    "binds the planner and the writer."
)


def _plan_response_schema(schema: dict[str, Any]) -> None:
    schema["description"] = PLAN_RESPONSE_DESCRIPTION
    _require_every_property(schema)


class PlanResponse(_StrictContract):
    model_config: ClassVar[ConfigDict] = {"extra": "forbid", "json_schema_extra": _plan_response_schema}

    @model_validator(mode="before")
    @classmethod
    def _legacy_spellings(cls, data: Any) -> Any:
        return modernize_plan(data)

    title: str = Field(description="Clear, descriptive title for the research report.")
    sections: list[str] = Field(description="3-8 section headings outlining what the report covers.")
    genre: PlanGenre = Field(
        default="report",
        description="The document genre: inspection_report, file_note, comparison, checklist or report.",
    )
    depth: PlanDepth = Field(
        default="expert_report", description="quick_check for the smallest complete form, expert_report for full depth."
    )
    basis: list[str] = Field(
        default_factory=list,
        description=(
            "File names from the document inventory the run must read in full, because the request is about "
            "them or cannot be answered without them. Empty when no listed document is that."
        ),
    )
    excluded: list[str] = Field(
        default_factory=list,
        description="File names the reader excluded on the plan card. Always empty from the planner.",
    )


@dataclass(frozen=True)
class ClarifyRequest:
    messages: list[BaseMessage]
    data_sources: list[str] | None = None
    project_context: str | None = None
    available_documents: list[dict[str, Any]] | None = None


@dataclass(frozen=True)
class ClarifyResult:
    research_context: str
    outcome: PlanOutcome | None = None
    data_sources: list[str] | None = None
    documents: PlanDocuments | None = None
