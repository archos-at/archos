from __future__ import annotations

from knowledge_layer.search.trace_lanes import _trace_lanes_for_chunks
from ris_adapter.lookup.address import Address
from ris_adapter.lookup.address import federal_state_sentence
from ris_adapter.lookup.passages import DOC_CLASS
from ris_adapter.lookup.passages import Passage

from agent.common.grounding_block import TRUNCATION_MARKER
from agent.common.grounding_block import GroundingBlock
from agent.common.grounding_block import GroundingHit
from agent.common.grounding_block import SourceRevision
from agent.common.grounding_block import render_grounding_block
from agent.common.source_kinds import Shelf
from agent.common.wire_v2 import TraceLane

from .as_of import parse_day

RIS_LOOKUP_TOOL = "ris_lookup"


def format_passages(passages: list[Passage], ingested_name: str | None, address: Address) -> str:
    hits = tuple(_hit(passage) for passage in passages)
    return render_grounding_block(
        GroundingBlock(
            preamble="\n".join(_preamble_lines(passages, ingested_name, address)),
            degraded_banner="",
            hits=hits,
            lanes=_trace_lanes(passages),
            tool=RIS_LOOKUP_TOOL,
        )
    )


def _preamble_lines(passages: list[Passage], ingested_name: str | None, address: Address) -> list[str]:
    documents = len({passage.url for passage in passages})
    lines = [f"Found {len(passages)} relevant passage(s) in {documents} document(s):"]
    if address.federal_state:
        lines.append(federal_state_sentence(address))
    if address.unread:
        lines.append(_unread_sentence(address))
    if ingested_name:
        lines.append(
            f'[The complete document was added to the knowledge base as "{ingested_name}" — '
            "read_passage reopens any other § of it.]"
        )
    return lines


def _unread_sentence(address: Address) -> str:
    sign = "§" if address.kind == "§" else "Art."
    runs = _runs(address.unread)
    named = ", ".join(f"{sign} {r[0]}" if len(r) == 1 else f"{sign} {r[0]} bis {sign} {r[-1]}" for r in runs)
    addressed = len(address.sections)
    return (
        f"[Only the first {addressed} of the listed sections were addressed; not read: {named}. "
        "Ask for them in a second call.]"
    )


def _runs(numbers: tuple[str, ...]) -> list[list[str]]:
    runs: list[list[str]] = []
    for number in numbers:
        last = runs[-1][-1] if runs else None
        if last is not None and number.isdigit() and last.isdigit() and int(number) == int(last) + 1:
            runs[-1].append(number)
        else:
            runs.append([number])
    return runs


def _hit(passage: Passage) -> GroundingHit:
    work_id, edition_id = _record_of(passage.url)
    body, truncated = _cut_body(passage.body)
    return GroundingHit(
        citation_key=passage.citation,
        file_name=passage.citation,
        page=None,
        shelf=Shelf.BASE,
        collection=passage.collection,
        doc_class=DOC_CLASS,
        display_title=passage.title,
        folder_path=None,
        clause=passage.clause_label or None,
        score=passage.score,
        content_type="text",
        provenance=None,
        stored_image_index=None,
        status_note=passage.status_note or None,
        body=body,
        body_truncated=truncated,
        public_url=passage.url or None,
        revision=_revision(passage.version_date),
        work_id=work_id,
        edition_id=edition_id,
    )


def _record_of(url: str) -> tuple[str | None, str | None]:
    from agent.common.knowledge_context import turn_knowledge_context
    from agent.common.knowledge_context import use_for_source_ref

    from ..client import source_record

    source = source_record()
    context = turn_knowledge_context()
    for scheme in source.identifiers:
        value = source.identifier_at(url, scheme) if url else None
        use = use_for_source_ref(context, scheme, value) if value else None
        if use is not None:
            return use.work_id, use.edition_id
    return None, None


def _revision(stated: str) -> SourceRevision | None:
    day = parse_day(stated)
    return SourceRevision(date=day.isoformat()) if day else None


def _cut_body(body: str) -> tuple[str, bool]:
    if not body.endswith(TRUNCATION_MARKER):
        return body, False
    return body[: -len(TRUNCATION_MARKER)], True


def _trace_lanes(passages: list[Passage]) -> tuple[TraceLane, ...]:
    from types import SimpleNamespace

    chunks = [
        SimpleNamespace(
            file_name=passage.citation,
            page_number=None,
            content=passage.body,
            content_type=SimpleNamespace(value="text"),
            score=passage.score,
            metadata={"collection": passage.collection, "shelf": "base", "doc_class": DOC_CLASS},
        )
        for passage in passages
    ]
    return _trace_lanes_for_chunks(chunks, {}, {})
