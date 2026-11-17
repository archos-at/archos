from typing import Annotated
from typing import Literal

from pydantic import Field

from agent.cards.card_model import CardModel

MAX_CANVAS_ACTIVITY_ITEMS = 20


class CanvasDocument(CardModel):

    id: str = Field(
        pattern=r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$",
        description="The document's id, as the BFF returned it",
    )
    name: str = Field(min_length=1, description="The file name, as the BFF returned it")


class _CanvasSetMark(CardModel):

    annotation_id: str = Field(min_length=1, description="The mark's id")
    number: int = Field(ge=1, description="The mark's number on the document")
    page: int = Field(ge=1, description="The page, from 1")
    shape: Literal["point", "region"]
    x: float = Field(ge=0, le=1, description="Left edge (or the point), as a share of the page's width")
    y: float = Field(ge=0, le=1, description="Top edge (or the point), as a share of the page's height")
    w: float | None = Field(default=None, gt=0, le=1, description="Width share, for a region")
    h: float | None = Field(default=None, gt=0, le=1, description="Height share, for a region")
    kind: Literal["hint", "question", "defect"]
    body: str = Field(min_length=1, max_length=2000, description="What the mark says")


class CanvasProposedItem(_CanvasSetMark):

    action: Literal["proposed"] = "proposed"


class CanvasCreatedItem(_CanvasSetMark):

    action: Literal["created"] = "created"


class CanvasFieldChange(CardModel):

    field: Literal["status", "assignee", "due_on", "kind", "body"]
    before: str | None = Field(default=None, max_length=2000, description="The value before; absent when empty")
    after: str | None = Field(default=None, max_length=2000, description="The value after; absent when empty")
    before_label: str | None = Field(default=None, max_length=200, description="The assignee's name before")
    after_label: str | None = Field(default=None, max_length=200, description="The assignee's name after")


class CanvasChangedItem(CardModel):

    action: Literal["changed"] = "changed"
    annotation_id: str = Field(min_length=1, description="The mark's id")
    number: int = Field(ge=1, description="The mark's number on the document")
    status: Literal["proposed", "open", "resolved", "dismissed"] = Field(
        description="The mark's status after the change: what an undo expects to find"
    )
    changes: list[CanvasFieldChange] = Field(min_length=1, max_length=5)
    note: str = Field(min_length=1, max_length=300, description="The start of the agent's note in the thread")


class CanvasDeletedItem(CardModel):

    action: Literal["deleted"] = "deleted"
    number: int = Field(ge=1, description="The deleted mark's number")
    body: str = Field(min_length=1, max_length=2000, description="What the mark said")


class CanvasRepliedItem(CardModel):

    action: Literal["replied"] = "replied"
    annotation_id: str = Field(min_length=1, description="The mark whose thread was answered")
    number: int = Field(ge=1, description="The mark's number on the document")
    excerpt: str = Field(min_length=1, max_length=300, description="The start of the reply")


CanvasActivityItem = Annotated[
    CanvasProposedItem | CanvasCreatedItem | CanvasChangedItem | CanvasDeletedItem | CanvasRepliedItem,
    Field(discriminator="action"),
]


class CanvasActivityCard(CardModel):

    type: Literal["canvas_activity"] = "canvas_activity"
    document: CanvasDocument
    items: list[CanvasActivityItem] = Field(
        min_length=1,
        max_length=MAX_CANVAS_ACTIVITY_ITEMS,
        description="What happened, in the order it happened",
    )
