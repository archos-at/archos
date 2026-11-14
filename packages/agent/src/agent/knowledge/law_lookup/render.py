"""[6] The grounding block.

A lookup states its passages as :class:`~agent.common.grounding_block.GroundingHit`
records and hands them to the one renderer every evidence tool shares
(ADR-0061). There is no layout of its own: the ``--- Result N ---`` blocks, the
header lines and the ``## Trace-Lanes`` object are the knowledge layer's, which
is the whole reason a law source is evidence rather than a URL in prose. The
same reader that reads a corpus hit reads this.
"""

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
    """Every selected passage as one grounding block.

    The preamble carries the facts that are about the CALL rather than about a
    passage: the call's ``notes`` (the source it read, a day read as today, the
    versions it left unread), the jurisdiction it assumed, and the document it
    left in the session collection. It sits before the first ``--- Result N ---``,
    so the citation reader never sees it as a hit's field, and inside the rendered
    text, under which the block's records are filed.
    """
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
    """The count, the jurisdiction the call assumed, and what it ingested."""
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
    """On a past day, the version documents of that day this call found and did not read, by their provision.

    Each provision of a past day is a document of its own, and a call reads only so many: the rest is named,
    so the caller can ask for each in a call of its own.
    """
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
    """The provisions a list named past the lookup's budget: named, so the caller can ask for them."""
    sign = law.display_sign(address.kind)
    to = law.grammar.range_word
    runs = _runs(address.unread)
    named = ", ".join(f"{sign} {r[0]}" if len(r) == 1 else f"{sign} {r[0]} {to} {sign} {r[-1]}" for r in runs)
    return (
        f"[Only the first {len(address.sections)} of the listed sections were addressed; not read: {named}. "
        "Ask for them in a second call.]"
    )


def _runs(numbers: tuple[str, ...]) -> list[list[str]]:
    """``numbers`` grouped into runs of consecutive plain integers; a lettered one is a run of its own."""
    runs: list[list[str]] = []
    for number in numbers:
        last = runs[-1][-1] if runs else None
        if last is not None and number.isdigit() and last.isdigit() and int(number) == int(last) + 1:
            runs[-1].append(number)
        else:
            runs.append([number])
    return runs


def _hit(passage: Passage, law: LawSource) -> GroundingHit:
    """One passage as a record.

    ``file_name`` is the citation rather than a filename because the source
    holds no file: the key the answer copies IS this passage's identity. The
    shelf is stated (``base``) because a law source is the base corpus of law,
    and the doc_class puts the hit in the statute lane.

    No URL is PRINTED. The one the source has is the WHOLE law, the same for
    every provision, and printed beside the citation it was what the answer
    copied, naming no provision the lookup returned. The address still travels
    as the record's ``public_url`` (and the day the text is in force from as
    ``revision``): fields the renderer prints nowhere, for a reader to open.

    The passage also states the knowledge record it is a text of (``work_id``,
    ``edition_id``): the work whose record carries the identifier this source's
    record reads off the document's address (:func:`_record_of`). A citation's
    role is resolved by that id.
    """
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
        # The locus as a lawyer reads it: the same string the citation key carries and the chip shows.
        clause=passage.clause_label or None,
        score=passage.score,
        content_type="text",
        provenance=None,
        stored_image_index=None,
        # The consolidated-text note rides as its own header line, never inside a quotable body.
        status_note=passage.status_note or None,
        body=body,
        body_truncated=truncated,
        public_url=passage.url or None,
        revision=_revision(passage.version_date),
        work_id=work_id,
        edition_id=edition_id,
    )


def _record_of(url: str, law: LawSource) -> tuple[str | None, str | None]:
    """The work (and held edition, if any) the document at ``url`` is a text of, by the turn's records.

    The source's own record says how a document's address states each identifier (``identifiers``); the
    turn's knowledge context says which work carries that identifier. No identifier, or no work that carries
    it: no record, and the citation states no role.
    """
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
    """The day the source says this text is in force from, as a record; None when it stated none or not a day."""
    day = parse_day(stated)
    return SourceRevision(date=day.isoformat()) if day else None


def _cut_body(body: str) -> tuple[str, bool]:
    """The passage text, and whether it was cut: the marker is protocol, and the renderer appends it."""
    if not body.endswith(TRUNCATION_MARKER):
        return body, False
    return body[: -len(TRUNCATION_MARKER)], True


def _trace_lanes(passages: list[Passage]) -> tuple[TraceLane, ...]:
    """The lane fan-out, through the knowledge layer's own helper.

    The SAME function as corpus lanes, instead of a second table that would
    eventually disagree with it. The two resolver maps are EMPTY on purpose: a
    law passage is not in the metadata store. The fan-out is fed the CITATION
    as the name and no title: the citation key already reads as the law and its
    provision, and a short title there would replace the provision in the
    derivation with the law's name alone.
    """
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
