from __future__ import annotations

import base64
import json
import logging
from dataclasses import dataclass

logger = logging.getLogger(__name__)

BUDGET_HEADER = "x-grid-budget"

USAGE_ACTIVITY_INGEST = "ingest"


class BudgetExceededError(RuntimeError):
    expected_outcome = True

    def __init__(self, scope: str, message: str | None = None) -> None:
        self.scope = scope
        super().__init__(
            message
            or (
                "The organization's LLM budget is exhausted "
                f"(limit scope: {scope}). An org admin can raise limits under Organization → Usage & budgets."
            )
        )


@dataclass
class BudgetSnapshot:
    remaining_org_usd: float | None = None
    remaining_user_usd: float | None = None
    remaining_project_usd: float | None = None
    remaining_org_tokens: float | None = None
    remaining_user_tokens: float | None = None
    remaining_project_tokens: float | None = None
    activity: str | None = None

    @classmethod
    def from_header(cls, raw: str | None) -> BudgetSnapshot | None:
        if not raw:
            return None
        try:
            padded = raw + "=" * (-len(raw) % 4)
            data = json.loads(base64.urlsafe_b64decode(padded.encode("ascii")).decode("utf-8"))
        except Exception:
            logger.warning("Ignoring malformed %s header", BUDGET_HEADER, exc_info=True)
            return None
        if not isinstance(data, dict):
            return None

        def _num(key: str) -> float | None:
            value = data.get(key)
            return float(value) if isinstance(value, int | float) else None

        return cls(
            remaining_org_usd=_num("remainingOrgUsd"),
            remaining_user_usd=_num("remainingUserUsd"),
            remaining_project_usd=_num("remainingProjectUsd"),
            remaining_org_tokens=_num("remainingOrgTokens"),
            remaining_user_tokens=_num("remainingUserTokens"),
            remaining_project_tokens=_num("remainingProjectTokens"),
            activity=USAGE_ACTIVITY_INGEST if data.get("activity") == USAGE_ACTIVITY_INGEST else None,
        )

    def exhausted_scope(self, pending_cost_usd: float, pending_tokens: int = 0) -> str | None:
        for scope, remaining_usd, remaining_tokens in (
            ("organization", self.remaining_org_usd, self.remaining_org_tokens),
            ("member", self.remaining_user_usd, self.remaining_user_tokens),
            ("project", self.remaining_project_usd, self.remaining_project_tokens),
        ):
            if remaining_usd is not None and pending_cost_usd >= remaining_usd:
                return scope
            if remaining_tokens is not None and pending_tokens >= remaining_tokens:
                return scope
        return None
