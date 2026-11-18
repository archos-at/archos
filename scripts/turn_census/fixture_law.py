from __future__ import annotations

import functools
import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

LAW_FILE = Path(__file__).resolve().parents[2] / "tests" / "fixtures" / "base-knowledge" / "turn_law_austria.json"

TERRITORY_OF_STATE: dict[str, str] = {
    "burgenland": "AT-1",
    "carinthia": "AT-2",
    "lower_austria": "AT-3",
    "upper_austria": "AT-4",
    "salzburg": "AT-5",
    "styria": "AT-6",
    "tyrol": "AT-7",
    "vorarlberg": "AT-8",
    "vienna": "AT-9",
}

DEFAULT_TERRITORY = "AT-9"


@functools.cache
def _law() -> dict[str, dict[str, Any]]:
    return json.loads(LAW_FILE.read_text(encoding="utf-8"))


def territory_of(federal_state: str | None) -> str:
    return TERRITORY_OF_STATE.get(federal_state or "", DEFAULT_TERRITORY)


SITE = "site_territory"


def with_law(answer: dict[str, Any], project: dict[str, Any] | None = None) -> dict[str, Any]:
    rest = {key: value for key, value in answer.items() if key != SITE}
    if SITE in answer:
        law = _law().get(str(answer[SITE]), {})
    else:
        law = _law()[territory_of(((project or {}).get("facts") or {}).get("federal_state"))]
    return {**rest, "data": {**answer.get("data", {}), **law}}


class _LawOnly:
    def __init__(self) -> None:
        self._sites: dict[str, str | None] = {}

    def place(self, conversation: str, territory: str | None) -> None:
        self._sites[conversation] = territory

    def turn_context(self, conversation: str | None) -> dict[str, Any]:
        answer: dict[str, Any] = {"data": {"projectContext": None, "projectMemory": None, "orgInstructions": None}}
        if conversation in self._sites:
            answer[SITE] = self._sites[conversation]
        return answer


def start_law_bff(out: Path, envelope: Callable[..., tuple[str, str]]) -> tuple[Any, Any]:
    import secrets

    from fixture_bff import FixtureBFF

    token = secrets.token_hex(16)
    workspace = _LawOnly()
    bff = FixtureBFF(token, out / "requests.jsonl", workspace=workspace).start()

    def env_for(conversation_id: str, question: dict) -> dict[str, str]:
        if "territory" in question:
            workspace.place(conversation_id, question["territory"])
        office = {"organizationId": "org_suite_vienna", "userId": "user_suite"}
        header, signature = envelope(office, conversation_id, token, {"id": None})
        return {
            "FRONTEND_INTERNAL_URL": bff.url,
            "INTERNAL_API_TOKEN": token,
            "EVAL_ENVELOPE": header,
            "EVAL_ENVELOPE_SIG": signature,
        }

    return bff, env_for
