from __future__ import annotations

import contextvars
from typing import Literal

MAX_IMAGE_VIEWS_PER_TURN = 6
MAX_OVERVIEW_VIEWS_PER_TURN = 2

ViewKind = Literal["overview", "region"]


class ImageViewBudget:
    def __init__(
        self, limit: int = MAX_IMAGE_VIEWS_PER_TURN, overview_limit: int = MAX_OVERVIEW_VIEWS_PER_TURN
    ) -> None:
        self.limit = limit
        self.overview_limit = overview_limit
        self.used = 0
        self.overviews_used = 0
        self.regions_viewed = 0

    @property
    def remaining(self) -> int:
        return max(0, self.limit - self.used)

    @property
    def overviews_remaining(self) -> int:
        return min(self.remaining, max(0, self.overview_limit - self.overviews_used))

    def try_consume(self, kind: ViewKind = "region") -> bool:
        if self.used >= self.limit:
            return False
        if kind == "overview":
            if self.overviews_used >= self.overview_limit:
                return False
            self.overviews_used += 1
        self.used += 1
        return True

    def remaining_text(self) -> str:
        looks = "look" if self.remaining == 1 else "looks"
        return f"{self.remaining} {looks} left this turn ({self.overviews_remaining} of them whole pages)."


_budget_var: contextvars.ContextVar[ImageViewBudget | None] = contextvars.ContextVar("_image_view_budget", default=None)


def begin_image_view_budget(limit: int = MAX_IMAGE_VIEWS_PER_TURN) -> contextvars.Token:
    return _budget_var.set(ImageViewBudget(limit))


def end_image_view_budget(token: contextvars.Token) -> None:
    _budget_var.reset(token)


def get_image_view_budget() -> ImageViewBudget | None:
    return _budget_var.get()


def try_consume_image_view(kind: ViewKind = "region") -> bool:
    budget = _budget_var.get()
    return True if budget is None else budget.try_consume(kind)


def remaining_views_text() -> str:
    budget = _budget_var.get()
    return "" if budget is None else budget.remaining_text()


def note_region_viewed() -> None:
    budget = _budget_var.get()
    if budget is not None:
        budget.regions_viewed += 1
