"""The system-emitted workspace cards: surfaced documents, a draft, and a created task."""

from typing import Literal

from pydantic import ConfigDict
from pydantic import Field
from pydantic import model_validator

from agent.cards.card_model import CardModel


class SurfacedDocument(CardModel):
    model_config = ConfigDict(
        json_schema_extra={"description": "One real document surfaced by a corpus search, with its match evidence."}
    )

    file_name: str = Field(min_length=1, description="Exact indexed file name (resolves to the live document row)")
    summary: str | None = Field(default=None, description="One-line description of what the document is")
    snippet: str | None = Field(default=None, description="Best-matching passage — WHY this file surfaced")
    page: int | None = Field(default=None, description="1-based page the snippet came from, if known")
    score: float | None = Field(default=None, description="0..1 relevance score of the best chunk")
    source: Literal["project", "office"] | None = Field(
        default=None, description="Which corpus it came from: 'project' or 'office' (Büroablage)"
    )


class DocumentAnswerSearch(CardModel):
    model_config = ConfigDict(
        json_schema_extra={
            "description": (
                "The ``workspace-search`` question a browse ran, so the reader can open the full result.\n"
                "\n"
                "Set by ``surface_documents`` only when the files came from that operation; the\n"
                "card then links to the search page with the same text and scope."
            )
        }
    )

    text: str = Field(min_length=1, max_length=500, description="The search text, as the operation was asked")
    scope: Literal["office", "project", "office_shelf"] = Field(
        description="Where it looked: this project, the office shelf, or both (the office)"
    )


class DocumentAnswerCard(CardModel):
    model_config = ConfigDict(
        json_schema_extra={
            "description": (
                "Project/Büroablage files the user asked to see.\n"
                "\n"
                "System-emitted by ``surface_documents``. One file or a short browse\n"
                "choice — same card, the list length is the difference. Never a\n"
                "catalogue. Citations of exactly one project/Büro file peek without\n"
                "this card (``useCitationPeek``)."
            )
        }
    )

    type: Literal["document_grid"] = "document_grid"
    title: str = Field(min_length=1, description="Short heading, e.g. 'Relevante Dokumente – Fluchtwege'")
    query: str | None = Field(default=None, description="The search phrase these documents matched")
    documents: list[SurfacedDocument] = Field(min_length=1, description="The surfaced files, best match first")
    search: DocumentAnswerSearch | None = Field(
        default=None,
        description="The workspace search these documents came from; the card offers to open the search page asking it",
    )


DocumentVersionState = Literal[
    "draft",
    "in_review",
    "changes_requested",
    "approved",
    "published",
    "superseded",
    "rejected",
]


class DocumentDraftCard(CardModel):
    model_config = ConfigDict(
        json_schema_extra={
            "description": (
                "A document the agent wrote into this conversation's working directory.\n"
                "\n"
                "System-emitted by the working directory's ``write_file`` / ``edit_file``, and\n"
                "again by ``file_draft`` once the draft has become a project document.\n"
                "\n"
                "**The card has two states, and the difference is three fields.** Unfiled, it\n"
                "reports a file that exists in this conversation and nowhere else: not filed,\n"
                "not indexed, not citable, not in the Files pane. Filed, it names a\n"
                "``documents`` row — and then it can offer the two things a reader wants,\n"
                "opening it and sending it for review, both through the routes the Files pane\n"
                "itself uses.\n"
                "\n"
                "The three fields travel together or not at all: a card carrying a\n"
                "``document_id`` and no ``version_state`` could not say whether the draft is\n"
                "still submittable, and one carrying a state with no ``version_id`` could not\n"
                "submit it. ``_require_filed_together`` is what refuses the half-filled shape,\n"
                "because the alternative is a card that renders a live-looking control over\n"
                "nothing."
            )
        }
    )

    type: Literal["document_draft"] = "document_draft"
    title: str = Field(min_length=1, description="The document's first heading, or its file name when it has none")
    path: str = Field(min_length=1, description="Path in the working directory, e.g. '/drafts/aktenvermerk.md'")
    bytes: int = Field(ge=0, description="Size of the draft as stored, in UTF-8 bytes")
    version: int = Field(ge=1, description="How often this path has been written or edited in this conversation")
    document_id: str | None = Field(
        default=None, description="The project document this draft was filed as; absent while it is unfiled"
    )
    version_id: str | None = Field(
        default=None, description="The open version of that document — what 'submit for review' acts on"
    )
    version_state: DocumentVersionState | None = Field(
        default=None, description="That version's editorial state, as the lifecycle API last reported it"
    )

    @model_validator(mode="after")
    def _require_filed_together(self) -> DocumentDraftCard:
        filed = (self.document_id, self.version_id, self.version_state)
        if any(filed) and not all(filed):
            raise ValueError(
                "document_id, version_id and version_state are the filed state and travel together: "
                "a card with some of them cannot say what it is offering"
            )
        return self


TaskKind = Literal["compliance_check", "submission_check", "document", "revision"]


class TaskCreatedCard(CardModel):
    model_config = ConfigDict(
        json_schema_extra={
            "description": (
                "Work the agent has taken on, as a row somebody can come back to.\n"
                "\n"
                "System-emitted by ``create_task``. What it exists to prevent is the answer\n"
                "„ich mache den Einreichcheck bis Freitag“ with nothing behind it: the card is\n"
                "proof there is a row, and the row is what carries the requester's permission,\n"
                "the deadline and — when a person judges the result — the decision that reaches\n"
                "the next attempt (ADR-0051).\n"
                "\n"
                "Informational, not interactive. The task is already queued when this renders,\n"
                "so there is no Accept: a control would either repeat the delegation or cancel\n"
                "it, and cancelling delegated work is a Files-and-tasks surface decision, not\n"
                "a chat one.\n"
                "\n"
                "``conversation_id`` is the thread the run writes into, so the card can link a\n"
                "reader to the work rather than only announce it. Absent when the run's\n"
                "conversation could not be created, which is the same degraded shape a\n"
                "scheduled job has had since jobs got conversations at all."
            )
        }
    )

    type: Literal["task_created"] = "task_created"
    task_id: str = Field(min_length=1, description="The task row's id")
    kind: TaskKind = Field(description="What kind of work was delegated")
    title: str = Field(min_length=1, max_length=200, description="What the task is called in the inbox and the list")
    goal: str = Field(min_length=1, max_length=500, description="What was asked, in the requester's own words")
    due_at: str | None = Field(
        default=None, description="ISO instant the work is wanted by, or absent when none was named"
    )
    conversation_id: str | None = Field(
        default=None, description="The conversation the run writes into; absent when it could not be created"
    )
