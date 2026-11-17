from typing import Literal

from pydantic import Field
from pydantic import model_validator

from agent.cards.card_model import CardModel


class SurfacedDocument(CardModel):

    file_name: str = Field(min_length=1, description="Exact indexed file name (resolves to the live document row)")
    summary: str | None = Field(default=None, description="One-line description of what the document is")
    snippet: str | None = Field(default=None, description="Best-matching passage — WHY this file surfaced")
    page: int | None = Field(default=None, description="1-based page the snippet came from, if known")
    score: float | None = Field(default=None, description="0..1 relevance score of the best chunk")
    source: Literal["project", "office"] | None = Field(
        default=None, description="Which corpus it came from: 'project' or 'office' (Büroablage)"
    )


class DocumentAnswerSearch(CardModel):

    text: str = Field(min_length=1, max_length=500, description="The search text, as the operation was asked")
    scope: Literal["office", "project", "office_shelf"] = Field(
        description="Where it looked: this project, the office shelf, or both (the office)"
    )


class DocumentAnswerCard(CardModel):

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
