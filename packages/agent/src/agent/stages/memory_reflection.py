"""Memory reflection, declared as a post-answer stage.

This is the migration of the bespoke block that used to sit inline in
``agents/piloti/conversation_register.py`` (schedule + gate) and in
``project_memory/reflection.schedule_memory_reflection`` (semaphore, pending cap,
cost/profile tracking). **What it does is unchanged** — the same predicate, the
same prompt, the same writes through the same token-guarded endpoint. What
changed is how it is wired and bounded:

- it now runs under a **hard 45s timeout**. Before, the only bound was the
  provider's ``request_timeout: 120`` with ``max_retries: 2`` — nearly six
  minutes holding one of four concurrency slots, i.e. one stalled provider
  silently disabled reflection for the whole replica;
- the gate now reads ``research_truncated``. A turn cut off at its
  tool-iteration ceiling produces a substantive-looking answer, and reflection
  was distilling durable project memory out of evidence-gathering that had been
  interrupted;
- every terminal state — including "the gate declined, and here is which
  condition declined" — emits a span;
- it delivers a **frame** as well as writing its rows (slice 4b). The write is
  still the durable act and still the source of truth; the frame tells the turn
  that caused it what was written, which is what let the per-answer memory poll
  be deleted rather than merely reduced (§5.1, §1.7);
- the frame also lists what the ``remember`` tool wrote to project or
  organization memory WHILE the answer was written (``provenance: agent``), so
  every shared note of a turn is on that turn's answer. A turn with such notes
  gets its frame even where the reflection pass itself is declined. A personal
  note never rides the frame (ADR-0180): it is stored with the answer's id and
  only its owner's browser asks for it.

See docs/architecture/post-answer-stages.md and
docs/architecture/project-memory-design.md.
"""

from __future__ import annotations

import logging
from typing import Any
from typing import Literal

from pydantic import BaseModel
from pydantic import Field

from agent.common.canned_replies import NON_ANSWER_PREFIXES
from agent.common.model_overrides import AgentGroup
from agent.knowledge.project_memory import begin_turn_memory_log
from agent.knowledge.project_memory import end_turn_memory_log
from agent.knowledge.project_memory import turn_memory_notes
from agent.knowledge.project_memory import turn_refreshed_memory_ids
from agent.stages.registry import register_stage
from agent.stages.spec import GateDecision
from agent.stages.spec import StageContext
from agent.stages.spec import StageEmpty
from agent.stages.spec import StageSpec
from agent.stages.spec import TurnFacts

logger = logging.getLogger(__name__)

#: Canned error/empty answers that must never be reflected on. Built from the
#: constants the nodes send, so a rewording cannot unhook this gate.
REFLECTION_NON_ANSWERS = NON_ANSWER_PREFIXES

#: Phrases that make the tail of an answer an insufficiency statement rather
#: than a finding. Only the reflection gate reads them: escalation itself
#: requires Piloti's explicit structured ask, because a substring match
#: on German legal hedging false-positived on successful answers.
_INSUFFICIENCY_PHRASES = (
    "i don't have enough information",
    "unable to find",
    "need more research",
    "keine ausreichenden informationen",
    "nicht genügend informationen",
    "konnte keine informationen",
    "keine informationen gefunden",
    "nicht finden",
    "weitere recherche erforderlich",
    "genauere prüfung erforderlich",
)

#: How much of the answer's tail is examined for them.
_INSUFFICIENCY_TAIL_CHARS = 800


def matches_escalation_keywords(content: str) -> bool:
    """Whether the tail of an answer reads as an insufficiency statement."""
    tail = content[-_INSUFFICIENCY_TAIL_CHARS:].lower()
    return any(phrase in tail for phrase in _INSUFFICIENCY_PHRASES)


#: Paths with nothing durable to record: a direct reply (greeting, shelf
#: listing, off-topic decline) or an error. Reflecting on them only risks
#: spurious writes.
_SKIP_ROUTES = {"meta", "error"}

#: A generous bound, not a tuning knob. Reflection is one structured-output call
#: over a turn that is already sliced to ~6k characters of prompt; 45s covers a
#: slow provider and still frees the concurrency slot long before a stall could
#: disable the stage for the replica.
REFLECTION_TIMEOUT_S = 45.0

#: The most in-turn notes one frame lists. The tool is not bounded per turn;
#: the frame is stored on a message, and the BFF caps the list again.
MAX_NOTED_ITEMS = 6


class MemoryReflectionItem(BaseModel):
    """One ``project_memory`` row this turn wrote, as the reader sees it.

    ``content`` rides along and not just the id, because the surface this
    payload feeds — the „Piloti hat sich gemerkt" chip — renders the item's own
    words. Sending ids alone would make the browser ask the database for text
    the writer already had in hand, which is the round trip §5.1 is removing.

    The four optional fields are absent for the common case (a project note
    this stage added), so a frame stored before they existed reads the same.
    A restricted note rides the frame like an open one: the frame is stored on
    the answer of a turn that drew on the same restricted folders, and that
    conversation's readers are already held to them (ADR-0087, ADR-0093).
    """

    id: str = Field(description="Id of the project_memory row.")
    kind: str = Field(description="decision | constraint | open_question | derived_fact | preference.")
    content: str = Field(description="The finding, verbatim as it was written.")
    provenance: Literal["agent"] | None = Field(
        default=None, description="'agent': the remember tool wrote it during the answer. Absent: this stage did."
    )
    scope: Literal["organization"] | None = Field(
        default=None, description="'organization': everyone in the office reads it. Absent: the project's members."
    )
    supersedes: str | None = Field(
        default=None, description="The earlier note this one retired, quoted. Absent when it retired none."
    )
    restricted: Literal[True] | None = Field(
        default=None, description="True: restricted memory, shown only to people cleared for its folders."
    )


class MemoryReflectionPayload(BaseModel):
    """What the turn wrote to shared memory: the tool's notes first, then this stage's, each in write order.

    The DB write stays the source of truth — this payload is a notification of
    what happened, never a transfer of authority. ``app`` stays
    single-writer, and a client may not create, edit or delete an item through
    this channel; it only learns that one exists.

    There is no ``empty`` payload: a turn that established nothing durable is a
    ``StageEmpty``, so an items list on the wire is never empty.
    """

    items: list[MemoryReflectionItem] = Field(description="The project_memory rows written, in write order.")


def _gate(facts: TurnFacts) -> GateDecision:
    """Whether the stage has anything to do: a reflection pass, or in-turn notes to report.

    A turn whose ``remember`` calls wrote shared notes owes its answer the
    record of them even where reflection is declined (a direct reply, a short
    answer, a turn outside a project); the handler then reports and reflects
    on nothing.
    """
    decision = _reflection_gate(facts)
    if not decision.run and facts.noted_this_turn:
        return GateDecision.proceed()
    return decision


def _reflection_gate(facts: TurnFacts) -> GateDecision:
    """The existing predicate, moved verbatim, plus the truncation skip.

    Deterministic Python over facts the backend already has — never a model's
    opinion about its own answer. Each failed condition names itself, so the
    gate's own correctness is measurable rather than assumed.
    """
    if facts.temporary:
        # ADR-0180: a temporary conversation keeps nothing. The BFF refuses
        # the write too; skipping here saves the model call and names why.
        return GateDecision.skip("temporary_conversation")
    if facts.run_id:
        # The turn only commissioned the work; the run reflects on its own
        # report, on the worker, once that report exists.
        return GateDecision.skip("commissioned_run")
    if not facts.project_id:
        # The autonomous stage writes project-scoped memory ONLY (audit S1), so
        # an org-only conversation has nothing it may safely write.
        return GateDecision.skip("no_project")
    # A turn that could read a restricted folder is NOT skipped (ADR-0087):
    # what it establishes is written as restricted memory, served only to
    # people cleared for the folders it draws on (`memory/restriction.py`).
    text = (facts.answer or "").strip()
    if not facts.query or not text:
        return GateDecision.skip("empty_turn")
    if facts.research_truncated:
        # The turn ran out of budget before it ran out of question. Distilling
        # durable memory from interrupted evidence-gathering is memory rot with
        # a plausible surface.
        return GateDecision.skip("research_truncated")
    if any(text.startswith(prefix) for prefix in REFLECTION_NON_ANSWERS):
        return GateDecision.skip("canned_non_answer")
    if matches_escalation_keywords(text):
        return GateDecision.skip("escalation")
    if facts.routing_decision in _SKIP_ROUTES:
        return GateDecision.skip(f"routing_{facts.routing_decision}")
    return GateDecision.proceed()


def digest_with_turn_writes(memory_digest: str | None, written: tuple[str, ...]) -> str | None:
    """The digest the agent saw, plus what the ``remember`` tool wrote after it.

    Rendered in the digest's own line grammar, so the reflection prompt shows
    them as existing memory and the "already in the digest" filter drops a
    finding that restates one — the tool and the stage no longer write the
    same fact twice within one turn.
    """
    if not written:
        return memory_digest
    lines = [f'- [this turn | recorded] "{content.replace(chr(34), chr(39))}"' for content in written]
    return "\n".join(([memory_digest.rstrip()] if memory_digest else []) + lines)


async def _reflected_items(ctx: StageContext) -> tuple[list[dict[str, Any]], str | None]:
    """One reflection pass: the frame items of the project rows it created, and which nothing an empty list is.

    The pass writes under a memory log of its own, so each row's outcome (an
    earlier note retired, restricted memory, a restated note only refreshed) is
    read from what the BFF answered, and a personal note it keeps is stored
    with this answer's id.
    """
    from agent.memory.reflection import run_memory_reflection
    from agent.turn.response import answer_message_id

    facts = ctx.facts
    answer_id = answer_message_id(facts.conversation_id, facts.ws_parent_id) if facts.ws_parent_id else None
    token = begin_turn_memory_log(answer_message_id=answer_id)
    try:
        recorded = await run_memory_reflection(
            llm=ctx.llm,
            query=facts.query,
            answer=facts.answer,
            project_id=facts.project_id,
            organization_id=facts.organization_id,
            conversation_id=facts.conversation_id,
            memory_digest=digest_with_turn_writes(facts.memory_digest, facts.remembered_this_turn),
            restriction=facts.restriction,
            personal_memory=facts.personal_memory,
            envelope=facts.envelope,
        )
        created = {note.id: note for note in turn_memory_notes()}
        refreshed = turn_refreshed_memory_ids()
    finally:
        end_turn_memory_log(token)
    # The frame is stored on the answer's message, which everyone the
    # conversation is shared with reads: it carries the project's rows only.
    # A note written to the asker's personal memory never rides it (ADR-0180).
    items: list[dict[str, Any]] = []
    for item in recorded or []:
        if item.get("about") == "person" or item["id"] in refreshed:
            continue
        note = created.get(item["id"])
        items.append(note.frame_item(in_turn=False) if note else {key: item[key] for key in ("id", "kind", "content")})
    if items or not recorded:
        return items, None
    # Kept something, none of it for the frame: a note about the person, or a
    # note the project already held.
    personal = any(item.get("about") == "person" for item in recorded)
    return items, "personal_notes_only" if personal else "restated_notes_only"


async def _handler(ctx: StageContext) -> dict[str, Any] | StageEmpty | None:
    """What the turn wrote to shared memory, after one reflection pass where the turn earns one.

    ``None`` when the turn established nothing durable — the common, correct
    outcome, recorded as ``empty`` rather than invented into a payload.
    """
    facts = ctx.facts
    noted = [note.frame_item(in_turn=True) for note in facts.noted_this_turn[:MAX_NOTED_ITEMS]]
    reflected: list[dict[str, Any]] = []
    empty_reason: str | None = None
    # ADR-0094: nothing from a conversation that drew on another project is
    # remembered (the BFF refuses the write too), so the model call is saved.
    if _reflection_gate(facts).run and not facts.drew_on_other_projects:
        reflected, empty_reason = await _reflected_items(ctx)
    items = [*noted, *reflected]
    if items:
        return {"items": items}
    # `None` is `empty` — a first-class success rather than a failure to invent
    # output. A pass that kept only personal or restated notes names itself.
    return StageEmpty(empty_reason) if empty_reason else None


MEMORY_REFLECTION = register_stage(
    StageSpec(
        id="memory_reflection",
        agent_group=AgentGroup.MEMORY_REFLECTION,
        # Unchanged from the pre-stage wiring: this migration is not a
        # user-visible change, so the flag that governed it still does.
        flag_slug="memory-reflection",
        timeout_s=REFLECTION_TIMEOUT_S,
        gate=_gate,
        handler=_handler,
        payload_model=MemoryReflectionPayload,
        # BOTH, and in that order: the write to project_memory is the durable
        # act and stays the source of truth, and the frame is a notification of
        # it addressed to the turn that caused it.
        #
        # The frame is what retires the poll. Before it, the only way a reader
        # learned that reflection had written anything was a three-shot HTTP
        # poll on a fixed `[0, 1500, 4000]` ms schedule — a guess about how long
        # an LLM takes, made by the half of the system that cannot know, and
        # mounted once per RENDERED ANSWER, so a ten-answer thread fired thirty
        # GETs for one conversation's memory (§1.7). The stage knows exactly
        # when it finished and exactly what it wrote; saying so costs one frame.
        delivery="frame",
        # Deliberately unbound HERE. The configured model already caps output
        # (``card_llm.max_tokens``), and the model runs with reasoning enabled —
        # reasoning tokens count against that ceiling, so a tighter cap set by
        # this migration would truncate the response and silently turn a working
        # stage into one that writes nothing. The cost bound that matters for
        # reflection is the input side, which is already sliced
        # (``_MAX_ANSWER_CHARS`` / ``_MAX_QUERY_CHARS`` / ``_MAX_DIGEST_CHARS``),
        # plus ``timeout_s`` above.
        max_output_tokens=None,
    )
)
