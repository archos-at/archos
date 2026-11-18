from __future__ import annotations

from collections.abc import Sequence
from types import SimpleNamespace

from knowledge_layer.search import trace_lanes_for_chunks as _trace_lanes_for_chunks

from agent.common.grounding_block import TRUNCATION_MARKER
from agent.common.grounding_block import GroundingBlock
from agent.common.grounding_block import GroundingHit
from agent.common.grounding_block import SourceRevision
from agent.common.grounding_block import render_grounding_block
from agent.common.source_kinds import Shelf
from agent.common.wire_v2 import TraceLane
from agent.knowledge.law_lookup.address import Address
from agent.knowledge.law_lookup.address import territory_sentence
from agent.knowledge.law_lookup.as_of import parse_day
from agent.knowledge.law_lookup.passages import DOC_CLASS
from agent.knowledge.law_lookup.passages import Passage
from agent.knowledge.law_lookup.source import LawSource


def format_passages(
    passages: list[Passage],
    ingested_name: str | None,
    address: Address,
    law: LawSource,
    tool: str,
    notes: Sequence[str] = (),
) -> str:
    return render_grounding_block(
        GroundingBlock(
            preamble="\n".join([*notes, *_preamble_lines(passages, ingested_name, address, law)]),
            degraded_banner="",
            hits=tuple(_hit(passage, law) for passage in passages),
            lanes=_trace_lanes(passages),
            tool=tool,
        )
    )


def _preamble_lines(passages: list[Passage], ingested_name: str | None, address: Address, law: LawSource) -> list[str]:
    documents = len({passage.url for passage in passages})
    lines = [f"Found {len(passages)} relevant passage(s) in {documents} document(s):"]
    if address.territory:
        lines.append(territory_sentence(address, law))
    if address.unread:
        lines.append(unread_sentence(address, law))
    if ingested_name:
        lines.append(
            f'[The complete document was added to the knowledge base as "{ingested_name}" — '
            f"read_passage reopens any other {law.section_sign} of it.]"
        )
    return lines


def unread_versions(trace, law: LawSource) -> list[str]:
    if not trace.as_of:
        return []
    unread = [c for c in trace.candidates if c.fetchable and c.url not in trace.fetched]
    if not unread:
        return []
    labels = ", ".join(c.provision or c.citation_url for c in unread)
    return [
        f"Versions of {trace.as_of} found and not read in this call: {labels}. "
        f"Ask for each in a call of its own, with the same as_of; {law.wording.source} holds each as its own document."
    ]


def unread_sentence(address: Address, law: LawSource) -> str:
    sign = law.display_sign(address.kind)
    to = law.grammar.range_word
    runs = _runs(address.unread)
    named = ", ".join(f"{sign} {r[0]}" if len(r) == 1 else f"{sign} {r[0]} {to} {sign} {r[-1]}" for r in runs)
    return (
        f"[Only the first {len(address.sections)} of the listed sections were addressed; not read: {named}. "
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


def _hit(passage: Passage, law: LawSource) -> GroundingHit:
    work_id, edition_id = _record_of(passage.url, law)
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


def _record_of(url: str, law: LawSource) -> tuple[str | None, str | None]:
    from agent.common.knowledge_context import turn_knowledge_context
    from agent.common.knowledge_context import use_for_source_ref

    context = turn_knowledge_context()
    for scheme in law.source.identifiers:
        value = law.source.identifier_at(url, scheme) if url else None
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
