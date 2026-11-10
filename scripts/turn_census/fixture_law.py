"""The law a suite turn reads about its site: what an entitled Austrian office's turn carries.

Since ADR-0175 the agent reads which law applies from the turn context's ``knowledgeContext`` and
``buildingLaw`` and nothing else; a turn without them reads no law at all. Every fixture BFF answer to
``POST /api/internal/turn-context`` therefore carries them, for the Land of the turn's project, as the
production resolvers wrote them from the Austria and EU packs
(``tests/fixtures/base-knowledge/turn_law_austria.json``, from
``apps/workspace/bff/base-knowledge/context/suite-turn-law.fixture.spec.ts``).
"""

from __future__ import annotations

import functools
import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

LAW_FILE = Path(__file__).resolve().parents[2] / "tests" / "fixtures" / "base-knowledge" / "turn_law_austria.json"

#: The intake's Land tokens (``federal_state``) as the territories the packs name.
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

#: Where a suite question sits when nothing says: the question set is a Viennese office's.
DEFAULT_TERRITORY = "AT-9"


@functools.cache
def _law() -> dict[str, dict[str, Any]]:
    return json.loads(LAW_FILE.read_text(encoding="utf-8"))


def territory_of(federal_state: str | None) -> str:
    """The territory of an intake Land token; Vienna when there is none."""
    return TERRITORY_OF_STATE.get(federal_state or "", DEFAULT_TERRITORY)


def with_law(answer: dict[str, Any], project: dict[str, Any] | None = None) -> dict[str, Any]:
    """A turn-context answer with the ``knowledgeContext`` and ``buildingLaw`` of ``project``'s Land in its data."""
    territory = territory_of(((project or {}).get("facts") or {}).get("federal_state"))
    data = {**answer.get("data", {}), **_law()[territory]}
    return {**answer, "data": data}


class _LawOnly:
    """The norm set's turn context: no project, no memory; ``FixtureBFF`` adds Vienna's law (``fixture_law.py``)."""

    def turn_context(self, conversation: str | None) -> dict[str, Any]:
        return {"data": {"projectContext": None, "projectMemory": None, "orgInstructions": None}}


def start_law_bff(out: Path, envelope: Callable[..., tuple[str, str]]) -> tuple[Any, Any]:
    """``--set loop``: a fixture BFF that serves the turn context alone, with Vienna's law (ADR-0175).

    The norm questions are a Viennese office's. Since ADR-0175 a turn reads which law applies from the
    knowledge context and the chain the BFF sends, and a turn without them reads none; this serves what an
    entitled Austrian office's turn in Vienna carries once the packs are published. Every other route is
    dropped, as it was when this set ran with no BFF at all.
    """
    import secrets

    from fixture_bff import FixtureBFF

    token = secrets.token_hex(16)
    bff = FixtureBFF(token, out / "requests.jsonl", workspace=_LawOnly()).start()

    def env_for(conversation_id: str, question: dict) -> dict[str, str]:
        office = {"organizationId": "org_suite_vienna", "userId": "user_suite"}
        header, signature = envelope(office, conversation_id, token, {"id": None})
        return {
            "FRONTEND_INTERNAL_URL": bff.url,
            "INTERNAL_API_TOKEN": token,
            "EVAL_ENVELOPE": header,
            "EVAL_ENVELOPE_SIG": signature,
        }

    return bff, env_for
