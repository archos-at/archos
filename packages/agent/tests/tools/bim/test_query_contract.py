from __future__ import annotations

import re
from pathlib import Path

from agent.tools.bim import register

QUERY_TS = Path(__file__).resolve().parents[5] / "apps" / "workspace" / "bff" / "bim" / "query-schema.ts"


def _const_list(source: str, name: str) -> set[str]:
    match = re.search(rf"export const {name} = \[(.*?)\] as const", source, re.DOTALL)
    assert match, f"{name} is no longer a const list in {QUERY_TS.name}: update this reader"
    return set(re.findall(r"'([^']+)'", match.group(1)))


def test_the_operations_are_the_routes() -> None:
    source = QUERY_TS.read_text(encoding="utf-8")
    assert register.VALID_OPERATIONS == set(re.findall(r"op: z\.literal\('([^']+)'\)", source))


def test_the_main_uses_are_the_routes() -> None:
    assert register._MAIN_USES == _const_list(QUERY_TS.read_text(encoding="utf-8"), "BIM_MAIN_USE")


def test_the_metrics_are_the_routes() -> None:
    assert register._METRICS == _const_list(QUERY_TS.read_text(encoding="utf-8"), "BIM_METRICS")
