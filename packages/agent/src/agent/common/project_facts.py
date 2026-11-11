"""A project's confirmed facts, read from its prompt view: ``- key=value`` lines under ``confirmed:``.

What the turn decision reads about the project (the chat agent's ``register._turn_facts``) and what the office
decision eval replays (``scripts/decision_eval_office.py``). Facts only: which law they trigger is the
platform's records (ADR-0175), never code here. A prompt view an older pod stored still names the German
keys and tokens; they are read as the English ones (``profile_names``).
"""

from __future__ import annotations

import json
import math
from typing import Any

from agent.profile_names import normalize_prompt_view

Facts = dict[str, Any]


def _as_number(value: Any) -> float | None:
    """A finite number, else None. Booleans are never numbers; strings are read as the prompt view writes them."""
    if isinstance(value, bool):
        return None
    if isinstance(value, int | float):
        number = float(value)
    elif isinstance(value, str):
        try:
            number = float(value.strip())
        except ValueError:
            return None
    else:
        return None
    return number if math.isfinite(number) else None


def facts_from_project_context(text: str) -> Facts:
    """Parse ``- key=value`` lines from the ``confirmed:`` section of PROJECT_CONTEXT.

    Numbers are coerced to int/float; ``true``/``false`` to bool (the four intake
    triggers arrive as strings in the prompt-text view); quoted strings are unquoted.

    The section ends at the first line that is neither an item nor indented: the
    profile's next section (``goals:``), or the next block of the composed turn
    context (``PROJECT_MEMORY v1``, ``PROPOSAL_DECISIONS v1``, ...). It used to
    end only at a ``...:`` header, so a profile whose last section is
    ``confirmed:`` read every memory line holding a ``=`` as a confirmed fact,
    for the turn decision and the prompt's project block alike.
    """
    facts: Facts = {}
    in_confirmed = False
    for raw_line in normalize_prompt_view(text).splitlines():
        line = raw_line.rstrip()
        if line.strip() == "confirmed:":
            in_confirmed = True
            continue
        if in_confirmed and line and not line.startswith((" ", "-")):
            break
        if not in_confirmed:
            continue
        stripped = line.strip()
        if not stripped.startswith("-") or "=" not in stripped:
            continue
        key, _, value = stripped[1:].partition("=")
        facts[key.strip()] = _fact_value(value.strip())
    return facts


def _fact_value(value: str) -> Any:
    """A fact's value as the prompt view writes it: a quoted string, a boolean, a number, else the text. Pure."""
    if value.startswith('"'):
        try:
            return json.loads(value)
        except ValueError:
            return value
    if value.lower() in ("true", "false"):
        return value.lower() == "true"
    number = _as_number(value)
    if number is None:
        return value
    return int(number) if number == int(number) else number
