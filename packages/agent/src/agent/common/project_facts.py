from __future__ import annotations

import json
import math
from typing import Any

from agent.profile_names import normalize_prompt_view

Facts = dict[str, Any]


def _as_number(value: Any) -> float | None:
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
