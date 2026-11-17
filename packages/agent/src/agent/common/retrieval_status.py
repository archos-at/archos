"""The live status lines of a turn's reading.

Documents loading, the subject document, each retrieval round, a look, the
checkpoint, and the answer phase (citations, repair, escalation, synthesis).
"""

from __future__ import annotations

import logging
from collections.abc import Sequence
from typing import Any
from typing import Literal

from agent.common import turn_status
from agent.common.source_kinds import canonical_shelf_value
from agent.common.status_keys import KEY_CITATIONS
from agent.common.status_keys import KEY_DOCUMENTS_PREFIX
from agent.common.status_keys import KEY_DOCUMENTS_WAITING
from agent.common.status_keys import KEY_ESCALATION
from agent.common.status_keys import KEY_REPAIR
from agent.common.status_keys import KEY_RETRIEVAL_PLAIN
from agent.common.status_keys import KEY_RETRIEVAL_REQUERY
from agent.common.status_keys import KEY_RETRIEVAL_WITH_QUERY
from agent.common.status_keys import KEY_SYNTHESIS
from agent.common.tool_calls import CHECKPOINT_FROM_NONE
from agent.common.tool_calls import LOCATOR_TOOL_BASENAMES
from agent.common.tool_calls import action_status_key
from agent.common.tool_calls import call_corpus
from agent.common.tool_calls import is_skill_read
from agent.common.tool_calls import locator_line
from agent.common.tool_calls import query_text
from agent.common.tool_calls import resolve_conclusion
from agent.common.tool_calls import tool_basename
from agent.common.turn_status import CHANNEL_TECHNICAL
from agent.common.turn_status import MAX_QUERY_CHARS
from agent.common.turn_status import MAX_REASON_CHARS
from agent.common.turn_status import STATUS_STEP_PREFIX
from agent.common.turn_status import clip
from agent.common.turn_status import current_retrieval_round
from agent.common.turn_status import status_step
from agent.common.wire_v2 import LookStep
from agent.common.wire_v2 import RetrievalStep
from agent.common.wire_v2 import StatusStep

logger = logging.getLogger(__name__)

_SHELF_IDS = {
    "office_shelf": "officeShelf",
    "project": "project",
    "session": "session",
}


_SHELF_SEVERAL = "several"


def documents_loading_step(shelves: list[str] | None = None) -> StatusStep | None:
    """The pre-graph I/O phase — but ONLY when the reader's own files are in it.

    Returned, not emitted: it runs in the setup phase, before any graph, and
    ``_run`` yields it.

    The first hole in the turn, and until now a total one: no frame of any kind
    existed before the intent classifier's LLM call, so the user watched a
    generic label through every one of these round-trips.

    Gated on the turn actually being scoped to a shelf of theirs, which is what
    makes this an event rather than a constant. "Unterlagen werden geladen" on
    every turn is the availability-as-activity mistake this product has already
    paid for once.
    """
    named: list[str] = []
    for shelf in shelves or ():
        shelf_id = _SHELF_IDS.get(canonical_shelf_value(str(shelf)))
        if shelf_id and shelf_id not in named:
            named.append(shelf_id)
    if not named:
        return None
    where = named[0] if len(named) == 1 else _SHELF_SEVERAL
    return status_step("documents", f"{KEY_DOCUMENTS_PREFIX}{where}", shelves=[str(shelf) for shelf in shelves or ()])


SUBJECT_DOCUMENT_SLOT = "documents:subject"


SUBJECT_UNREACHABLE = "unreachable"


SUBJECT_REFUSED = "refused"


SUBJECT_EMPTY = "empty"


SUBJECT_NOT_STORED = "not_stored"


SUBJECT_ABSENT = "absent"


def subject_document_step(
    *,
    loaded: bool,
    document_id: str | None = None,
    version_id: str | None = None,
    state: str | None = None,
    path: str | None = None,
    chars: int | None = None,
    reason: str | None = None,
) -> StatusStep:
    """Record that the turn's subject document was (or was not) read as bytes.

    Returned, not emitted: the read runs in the setup phase and ``_run`` yields it.

    **Technical channel, and therefore no ``key``.** A live key is resolved
    against ``chat.thinking.turnStatus.*`` in the frontend dictionary, and every
    key in :data:`ALL_STATUS_KEYS` is asserted to have a German AND an English
    string there. This event has nothing to add to the reader's live line that
    „Unterlagen werden geladen" has not already said — the file it names is the
    one they are looking at — and the operator question it does answer is how
    often a conversation about an unpublished document silently fell back to a
    corpus that cannot see it. That is telemetry, which is what the technical
    channel is for (see the module docstring's "What earns a line").

    Args:
        loaded: Whether the version's text reached the working directory.
        document_id: The subject document.
        version_id: The open version the turn was told about.
        state: That version's editorial state (``draft``, ``in_review``, …).
        path: Where it was written, when it was written.
        chars: How much text was written.
        reason: One of :data:`SUBJECT_UNREACHABLE`, :data:`SUBJECT_REFUSED`,
            :data:`SUBJECT_ABSENT`, :data:`SUBJECT_EMPTY`,
            :data:`SUBJECT_NOT_STORED` — only on a miss.
    """
    return status_step(
        SUBJECT_DOCUMENT_SLOT,
        channel=CHANNEL_TECHNICAL,
        loaded=loaded,
        document_id=document_id,
        version_id=version_id,
        state=state,
        path=path,
        chars=chars,
        reason=reason,
    )


def _describe_calls(calls: list[dict[str, Any]]) -> dict[str, Any]:
    """What one batch of tool calls SAYS: corpora, tools, query, key, values.

    Shared by :func:`emit_retrieval` (the live line) and
    :func:`record_round_announcement` (the stored ledger): the status frame
    and the announcement are two renderings of one parsing, and two parsings
    would eventually disagree about what a round was.
    """
    corpora: list[str] = []
    tools: list[str] = []
    query: str | None = None
    locator: tuple[str, dict[str, str]] | None = None
    action_key: str | None = None
    for call in calls:
        base = tool_basename(str(call.get("name") or ""))
        if not base or is_skill_read(call):
            continue
        tools.append(base)
        corpus = call_corpus(base, call.get("args"))
        if corpus is not None:
            if corpus not in corpora:
                corpora.append(corpus)
            if base in LOCATOR_TOOL_BASENAMES:
                locator = locator or locator_line(call.get("args"))
            else:
                query = query or query_text(call.get("args"))
        elif action_key is None:
            action_key = action_status_key(base, call.get("args"), str(call.get("name") or ""))

    key: str | None
    values: dict[str, Any]
    if corpora:
        values = {"corpus": ",".join(corpora)}
        if query:
            values["query"] = clip(query, MAX_QUERY_CHARS)
            key = KEY_RETRIEVAL_WITH_QUERY
        elif locator is not None:
            key, values = locator
        else:
            key = KEY_RETRIEVAL_PLAIN
    elif action_key is not None:
        key = action_key
        values = {}
    else:
        key = None
        values = {}
    return {"corpora": corpora, "tools": tools, "query": query, "key": key, "values": values}


def record_round_announcement(
    *,
    round_index: int,
    calls: Sequence[dict[str, Any]],
    conclusion: str | None,
) -> dict[str, Any] | None:
    """The stored half of :func:`emit_retrieval`: what round N was, for the ledger.

    Same parsing (:func:`_describe_calls`), same conclusion ranking
    (:func:`resolve_conclusion`), same budgets (``clip``): the live frame and
    this record cannot disagree because neither parses twice. Returns None for
    batches that are not a retrieval round — exactly the batches the round
    counter skips, so the stored list and the ``status:retrieval:N`` slots
    always cover the same rounds. Query and reason are clipped exactly like
    the frame; the full text stays in the messages.

    No "why" is recorded. The facts that answer it are already here — the
    corpora it touched, the query, the key (search vs locator), and the docs
    the join finds it returned — and an inferred reason would be a guess
    sitting in a wire contract.
    """
    batch = [call for call in (calls or []) if isinstance(call, dict)]
    if not batch:
        return None
    described = _describe_calls(batch)
    if not described["corpora"]:
        return None
    reason_text, _conclusion_source = resolve_conclusion(batch, conclusion)
    announcement: dict[str, Any] = {
        "index": round_index,
        "key": described["key"],
        "tools": described["tools"],
        "corpora": described["corpora"],
    }
    if described["query"]:
        announcement["query"] = clip(described["query"], MAX_QUERY_CHARS)
    reason = clip(reason_text, MAX_REASON_CHARS) or None
    if reason is not None:
        announcement["reason"] = reason
    return announcement


def emit_retrieval(
    tool_calls: list[dict[str, Any]] | None,
    *,
    round_index: int,
    conclusion: str | None = None,
    prefetch: bool = False,
) -> bool:
    """ONE line for a whole round of tool calls: where it looks, and for what.

    "Sucht im OIB-Wissen: „Fluchtweglänge GK4“" is a different sentence from
    "searching": it names the body of law being read and shows the reader
    whether the question was understood, while there is still time to say no.
    What is emitted here is the ingredients of that sentence — the corpus ids
    and the user's own query — never the sentence.

    Aggregated per round rather than per call because the model emits its calls
    in parallel batches — three separate lines in the same instant would be a
    log stream, not a status. ``round_index`` keeps successive rounds from
    collapsing into one row under one step id.

    ``conclusion`` is the model's own one-sentence Thought for this round —
    what it now knows and what it still needs. Same discipline as escalation
    ``reason``: it travels as a field, never as a live-line value, because it
    has a language. The Herleitung renders it as the spine node's body. Absent
    when the model wrote none; the graph then keeps the layer without
    inventing a conclusion, and without falling back to the query (PF-12).

    It has TWO channels and this function is where they are ranked. The
    retrieval tools declare a ``conclusion`` ARGUMENT, which is what the prompt
    now asks the model to fill; the parameter here is the prose written beside
    the tool calls, which is what it used to be asked for. The argument wins,
    prose is the fallback, and :func:`emit_checkpoint` records which one it
    was — ranking them anywhere else would let the sentence the spine renders
    and the source it is counted under disagree.

    ``prefetch`` marks the round the decision ran before the model's first
    call (round 0 of ``ChatAgent._prefetch_node``). The Herleitung draws no
    row for it: its sources join the first fan like any other (ADR-0132). The
    round index cannot say this, since a turn with nothing prefetched numbers
    the model's own first search 0 too.

    Returns True when a retrieval round was emitted (search corpora), so the
    caller can increment the round counter. Action-only rounds return False.
    """
    calls = [call for call in (tool_calls or []) if isinstance(call, dict)]
    if not calls:
        return False

    described = _describe_calls(calls)
    corpora = described["corpora"]
    tools = described["tools"]
    key = described["key"]
    values = described["values"]
    if key is None:
        return False

    reason_text, conclusion_source = resolve_conclusion(calls, conclusion)
    reason = clip(reason_text, MAX_REASON_CHARS) or None
    if corpora:
        turn_status.stamp_retrieval_round(round_index)
        turn_status.emit_step(
            RetrievalStep(
                id=f"{STATUS_STEP_PREFIX}retrieval:{round_index}",
                round=round_index,
                key=key,
                values=values,
                tools=tools,
                reason=reason,
                prefetch=prefetch,
            )
        )
        emit_checkpoint(round_index=round_index, has_conclusion=reason is not None, source=conclusion_source)
        return True
    slot = f"action:{key.rsplit('.', 1)[-1]}"
    turn_status.emit_status(slot, key, values=values, tools=tools, reason=reason)
    return False


LOOK_STEP_PREFIX = "look:"


def emit_look_step(
    number: int | str,
    *,
    document_name: str,
    page: int,
    document_id: str | None = None,
    revision_id: str | None = None,
    shelf: Literal["stored", "base"] = "stored",
    region: list[float] | None = None,
    image_index: int | None = None,
    where: str | None = None,
    question: str | None = None,
    reading: str | None = None,
) -> None:
    """One Herleitung row per look that rendered (ADR-0128): „Angesehen: Grundriss EG.pdf, S. 2, oben rechts“.

    ``number`` is the look's place in the turn, so two looks are two rows. The
    words are the frontend's; this carries the address and the region's place
    in words (``common/page_region_words``), which is domain text like a file
    name. Fail-open: a step that does not validate is logged, never raised.
    """
    try:
        step = LookStep(
            id=f"{LOOK_STEP_PREFIX}{number}",
            round=current_retrieval_round(),
            document_name=clip(document_name, 300),
            document_id=document_id,
            revision_id=revision_id,
            shelf=shelf,
            page=page,
            region=region,
            image_index=image_index,
            where=clip(where, 60) if where else None,
            question=clip(question, 200) if question else None,
            reading=clip(reading, 300) if reading else None,
        )
    except ValueError:
        logger.warning("A look step did not validate (page=%s)", page, exc_info=True)
        return
    turn_status.emit_step(step)


CHECKPOINT_SLOT = "checkpoint"


def emit_checkpoint(*, round_index: int, has_conclusion: bool, source: str = CHECKPOINT_FROM_NONE) -> None:
    """Record that a retrieval round drew a Herleitung checkpoint, and whether
    that checkpoint has a BODY.

    Technical channel, like :func:`emit_research_truncated`, and for the same
    kind of operator question. The spine draws one layer per round; the body of
    a layer is the model's own Thought, which exists only when the model wrote
    prose beside its tool calls — with tool-calling models, often it did not.
    That rate decides whether the Herleitung reads as reasoning or as a list of
    empty headers, and nothing could answer it: the conclusion travels as
    ``reason`` on a LIVE event, so counting its absence meant reading the
    reader's own text out of traces.

    What is counted here is therefore the BOOLEAN and never the sentence:
    ``round`` says which layer, ``hasConclusion`` whether it has a body, and
    ``source`` which channel produced it (:data:`CHECKPOINT_FROM_ARGUMENT` /
    :data:`CHECKPOINT_FROM_PROSE` / :data:`CHECKPOINT_FROM_NONE`). None of the
    three is language-specific and none is anybody's words.

    ``source`` is what makes the change measurable rather than merely believed.
    Asking for the sentence in a tool ARGUMENT instead of in prose is a bet that
    a tool-calling model fills a declared slot more reliably than it narrates;
    the rate of ``argument`` against ``prose`` against ``none``, per round, is
    that bet's scoreboard, and without it a prompt edit could only be argued
    about.
    """
    turn_status.emit_technical(
        f"{CHECKPOINT_SLOT}:{round_index}", round=round_index, hasConclusion=has_conclusion, source=source
    )


def documents_waiting_step(*, file_count: int) -> StatusStep:
    """The turn holding for an upload that is still being indexed.

    Returned, not emitted: the hold is in the setup phase and ``_run`` yields it.

    Rare by construction — most turns have nothing in flight — and the one
    honest account of a turn whose first byte is seconds later than usual:
    the question is about a file that does not exist to search yet, and the
    answer is worth more after it does.
    """
    return status_step("documents:waiting", KEY_DOCUMENTS_WAITING, file_count=file_count)


def emit_retrieval_requery(*, query_count: int) -> None:
    """The search widening itself: the first pool was judged insufficient and
    other formulations are being tried.

    Worth a line because it varies — most searches never reach it — and
    because it is the honest account of a turn that takes a few seconds
    longer than usual. The count travels as detail, not in the sentence.
    """
    turn_status.emit_status("retrieval:requery", KEY_RETRIEVAL_REQUERY, query_count=query_count)


def emit_citation_check(*, source_count: int | None = None) -> None:
    """The last stretch before the answer, and the blankest one.

    This one is worth a line even though it is near-constant on a research
    turn: it is the product's trust proposition stated out loud — every
    citation in the answer is checked against what was actually retrieved
    before the reader sees it.
    """
    turn_status.emit_status("citations", KEY_CITATIONS, source_count=source_count)


def emit_answer_repair(*, quotes: int) -> None:
    """A quote no passage holds verbatim is being checked against its passage.

    Worth a line because it varies — most answers verify clean — and because
    it is the honest account of an answer that arrives a few seconds late:
    a quotation the model misremembered is corrected to the passage's own
    wording, in place, rather than shipped marked (ADR-0067).

    The count rides this step as technical detail rather than a second,
    technical-channel step of its own: a second step in the same slot would
    replace this one. The live line renders from ``key``; ``quotesFailed`` is what the
    opt-in Herleitung detail shows, a count rather than text for the same
    reason every other record here is: a quote is the model's words about the
    reader's document, and telemetry keeps neither.
    """
    turn_status.emit_status("repair", KEY_REPAIR, quotesFailed=quotes)


def emit_escalation(reason: str | None = None) -> None:
    """Chat answer → deep research, announced at the moment the router decides it.

    Deep research is minutes, not seconds. A reader who is told the short
    answer was not good enough is waiting; one who is not is wondering whether
    the turn broke.

    The key is fixed and deliberately NOT built from the internal
    ``escalation_reason`` ("Shallow agent emitted insufficiency marker"), which
    names a marker in a message and tells an architect nothing. The internal
    string still travels as the ``reason`` field for the details panel.
    """
    reason_text = " ".join(str(reason).split()) if reason else ""
    turn_status.emit_status("escalation", KEY_ESCALATION, reason=clip(reason_text, MAX_REASON_CHARS) or None)


def emit_synthesis() -> None:
    """The tool calls are over and the answer is being written.

    Fires exactly once per turn that researched: the agent node's response
    carries tool calls on every round but the last, so a call-less response
    after at least one tool round IS the synthesis — no heuristic, no timer.
    Value-less like the repair line: what is being written is the reader's
    answer, and quoting it back as a status would be the model narrating
    itself.
    """
    turn_status.emit_status("synthesis", KEY_SYNTHESIS)
