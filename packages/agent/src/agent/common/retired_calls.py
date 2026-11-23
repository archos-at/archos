from __future__ import annotations

from collections.abc import Iterable

RETIRED_CALL_TAG = "retired-call"

RETIRED_ARGUMENTS = {
    "match": 'a literal search is `grep(pattern=…, mode="exact"|"regex", output_mode="content")`',
    "stemmed": "inflected forms are `grep(pattern=…, stemmed=true)`",
    "context": 'lines around a match are `grep(pattern=…, output_mode="content", context=…)`',
    "view": "a folder's tree is `ls(path=…, depth=2)`",
    "depth": "a folder's tree is `ls(path=…, depth=2)`",
}


def retired_hints(fields: Iterable[str]) -> list[str]:
    hints = list(dict.fromkeys(RETIRED_ARGUMENTS[field] for field in fields if field in RETIRED_ARGUMENTS))
    if hints:
        note_retired_call()
    return hints


def note_retired_call() -> None:
    from agent.observability.langfuse_trace_attributes import add_trace_tag

    add_trace_tag(RETIRED_CALL_TAG)
