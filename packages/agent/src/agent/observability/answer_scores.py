from __future__ import annotations

from collections.abc import Iterable
from typing import Any

from .langfuse_scores import RuntimeScore


def dialect_scores(repairs: list[dict[str, str]], sketches: Iterable[Any] = ()) -> list[RuntimeScore]:
    kinds = sorted({repair.get("repair", "") for repair in repairs if repair.get("repair")})
    return [
        RuntimeScore("dialect-repairs", float(len(repairs)), comment=", ".join(kinds) or None),
        *sketch_scores(sketches),
    ]


def sketch_scores(checks: Iterable[Any]) -> list[RuntimeScore]:
    return [
        RuntimeScore(
            "sketch-drawn",
            "drawn" if check.drawn else "refused",
            comment=check.refusal,
            item=str(index),
            metadata={"elements": check.elements, "dimension_labels": check.dimension_labels},
        )
        for index, check in enumerate(checks)
    ]


def quote_patch_scores(patched: int) -> list[RuntimeScore]:
    return [RuntimeScore("quotes-patched", float(max(0, patched)))]


def steer_scores(inbox: Any) -> list[RuntimeScore]:
    received = int(getattr(inbox, "received", 0) or 0)
    if received <= 0:
        return []
    applied = len(getattr(inbox, "applied", None) or [])
    return [RuntimeScore("steer-count", float(received), comment=f"applied {applied}")]
