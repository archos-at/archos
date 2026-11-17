from __future__ import annotations

import hashlib
from typing import Any

from agent.observability.langfuse_trace_attributes import add_trace_tag
from agent.observability.langfuse_trace_attributes import record_trace_metadata

FEATURE_TAG = "feature:ifc"


def record_ifc_call(op: str, outcome: str, **facts: Any) -> None:
    add_trace_tag(FEATURE_TAG)
    record_trace_metadata(ifc_op=op, ifc_outcome=outcome, **facts)


def model_handle(filename: Any) -> str | None:
    if not isinstance(filename, str) or not filename:
        return None
    return hashlib.sha256(filename.encode("utf-8")).hexdigest()[:12]
