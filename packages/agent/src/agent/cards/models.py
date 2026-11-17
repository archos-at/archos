from typing import Annotated

from pydantic import Field
from pydantic import TypeAdapter

from agent.cards.calculation_card import CalculationCard
from agent.cards.canvas_activity_card import CanvasActivityCard
from agent.cards.catalog import CHAT_ONLY_CARD_TYPES
from agent.cards.catalog import SYSTEM_CARD_TYPES
from agent.cards.file_operation_card import FileOperationProposalCard
from agent.cards.formula_card import FormulaCard
from agent.cards.ifc_cards import IfcComplianceCard
from agent.cards.ifc_cards import IfcDiffCard
from agent.cards.ifc_cards import IfcElementCard
from agent.cards.ifc_cards import IfcModelPickerCard
from agent.cards.ifc_cards import IfcScheduleCard
from agent.cards.ifc_cards import IfcViewerCard
from agent.cards.look_card import LookCard
from agent.cards.proposal_cards import MemoryProposalCard
from agent.cards.proposal_cards import OperationProposalCard
from agent.cards.proposal_cards import ProjectProfilePatchCard
from agent.cards.revision_compare_card import RevisionCompareCard
from agent.cards.schematic_cards import BuildingSectionCard
from agent.cards.schematic_cards import DaylightIncidenceCard
from agent.cards.schematic_cards import DimensionDiagramCard
from agent.cards.schematic_cards import EgressDiagramCard
from agent.cards.schematic_cards import FireAccessPlanCard
from agent.cards.schematic_cards import GuardrailCheckCard
from agent.cards.schematic_cards import SetbackPlanCard
from agent.cards.schematic_cards import StairDiagramCard
from agent.cards.surface_card import SurfaceCard
from agent.cards.workspace_cards import DocumentAnswerCard
from agent.cards.workspace_cards import DocumentDraftCard
from agent.cards.workspace_cards import TaskCreatedCard

AnswerCard = (
    ProjectProfilePatchCard
    | CalculationCard
    | FormulaCard
    | BuildingSectionCard
    | StairDiagramCard
    | DimensionDiagramCard
    | SetbackPlanCard
    | EgressDiagramCard
    | DaylightIncidenceCard
    | GuardrailCheckCard
    | FireAccessPlanCard
    | MemoryProposalCard
    | OperationProposalCard
    | DocumentAnswerCard
    | DocumentDraftCard
    | TaskCreatedCard
    | FileOperationProposalCard
    | CanvasActivityCard
    | LookCard
    | RevisionCompareCard
    | IfcViewerCard
    | IfcComplianceCard
    | IfcScheduleCard
    | IfcElementCard
    | IfcDiffCard
    | IfcModelPickerCard
    | SurfaceCard
)


answer_card_adapter = TypeAdapter(Annotated[AnswerCard, Field(discriminator="type")])


__all__ = [
    "AnswerCard",
    "answer_card_adapter",
    "validate_cards",
]


def validate_cards(raw: list[dict]) -> list[dict]:
    import logging

    logger = logging.getLogger(__name__)
    validated: list[dict] = []
    withheld = SYSTEM_CARD_TYPES | CHAT_ONLY_CARD_TYPES
    for item in raw:
        if isinstance(item, dict) and item.get("type") in withheld:
            logger.warning("Dropping model-fabricated system/chat-only card (type=%s)", item.get("type"))
            continue
        try:
            validated.append(answer_card_adapter.validate_python(item).model_dump(exclude_none=True))
        except Exception as exc:
            logger.warning(
                "Dropping invalid card (type=%s): %s",
                item.get("type") if isinstance(item, dict) else type(item).__name__,
                exc,
            )
    return validated
