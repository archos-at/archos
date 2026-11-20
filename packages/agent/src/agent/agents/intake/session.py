from __future__ import annotations

import difflib
from collections import Counter
from dataclasses import dataclass
from dataclasses import field
from typing import Any

CLOSEST_KEYS = 3


@dataclass
class IntakeSession:
    job_id: str
    organization_id: str | None = None
    needs: dict[str, dict[str, Any]] = field(default_factory=dict)
    mode: str = "active"
    decisive_open: int = 0
    finished: bool = False
    finish_status: str | None = None
    summary: str = ""
    stale: bool = False
    finish_held: bool = False
    outcomes: Counter = field(default_factory=Counter)
    refusals: Counter = field(default_factory=Counter)
    files_reported: int = 0
    progress_reports: int = 0

    def remember_needs(self, body: dict[str, Any]) -> None:
        needs = [need for need in body.get("needs") or [] if isinstance(need, dict) and need.get("key")]
        self.needs = {str(need["key"]): need for need in needs}
        self.mode = str(body.get("mode") or self.mode)
        self.decisive_open = sum(1 for need in needs if need.get("decisive") and need.get("state") == "open")

    def closest_keys(self, key: str) -> list[str]:
        return difflib.get_close_matches(key, list(self.needs), n=CLOSEST_KEYS, cutoff=0.5)
