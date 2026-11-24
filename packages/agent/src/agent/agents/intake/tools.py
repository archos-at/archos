from __future__ import annotations

from collections.abc import Callable

from langchain_core.tools import StructuredTool

from . import client
from .finishing import finish_hold
from .finishing import finish_intake
from .needs_rendering import MAX_RENDERED_NEEDS
from .needs_rendering import render_needs
from .recording import record_values
from .session import IntakeSession
from .tool_inputs import MAX_QUOTE_CHARS
from .tool_inputs import FinishInput
from .tool_inputs import NeedsInput
from .tool_inputs import RecordedValue
from .tool_inputs import RecordValuesInput
from .tool_inputs import WithdrawInput
from .withdrawal import withdraw_values

INTAKE_NEEDS_TOOL = "intake_needs"
RECORD_VALUES_TOOL = "record_values"
WITHDRAW_VALUES_TOOL = "withdraw_values"
FINISH_INTAKE_TOOL = "finish_intake"

INTAKE_NEEDS_DESCRIPTION = (
    "What the project's profile still needs, from the intake API, as it stands now: every question the wizard "
    "would ask for what is known (key, label, type, option tokens, unit, where the value is usually found, why it "
    "is asked), and the files no reading has read yet. `decisive`: filling it could change a Bauwerk's "
    "building class. State `open`: nothing on the profile. `suggested`: a document's value is there, unconfirmed; "
    "record it again only from another document, which corroborates it or, if different, is kept beside it for "
    "a person. `confirmed`: a person confirmed a building-class input; record it only from a document that states "
    "it (a newer Stand, say): the same value corroborates it, a different one becomes a contradiction a person "
    "decides, and the confirmed value is never overwritten. Answers change as values are recorded: a recorded "
    "value can open new questions (Nutzungen open the Wohnungen of a Wohnbau). A key you know from the "
    "documents need not be listed yet to be recorded: any key a wizard question writes is taken. Bounded at "
    f"{MAX_RENDERED_NEEDS} needs per answer; `start` pages on."
)

RECORD_VALUES_DESCRIPTION = (
    "Record values the project's documents state, each with where it stands (citation, or file_name and page) "
    f"and the verbatim quote that states it. Up to {client.MAX_RECORD_VALUES} per call, several keys at once. "
    "Nothing you record becomes a fact: each value is a suggestion a person confirms against the quote, so "
    "record only what a document states for THIS project, as its Zielzustand (a Bestand key: the existing "
    "building), never a guess, a typical value or something you worked out. A value the document calls "
    "undecided, under review or one of several options is not stated: a person would be confirming a decision "
    "nobody made. A drawing's Planart (Einreichplan) names the drawing, not the project's phase. Never record "
    "the building class, even where a document states one: the system derives it from the inputs you record and "
    "a person confirms it there, so record the inputs the document gives. Value: select, the option "
    "token exactly (multi_select: a list); number, "
    "a plain number in the question's unit, no unit text (`7,2 m` is 7.2); yes/no, true or false; text, the "
    "words as written. Quote: the document's own words, copied from text a tool showed you in this run in that "
    f"file, at most {MAX_QUOTE_CHARS} characters, the sentence, table row or title-block line, never paraphrased "
    "or joined from two places. Checked before anything is sent: the quote stands in what you read of that file "
    "(when it does not, the answer shows the closest passage you did read), a select value is one of the option "
    'tokens and its quote says it. Example: {"values": [{"key": "storeys_above_ground@bldg1", '
    '"value": 3, "citation": "Baubeschreibung.pdf, S. 3", "quote": "Das Gebäude hat drei '
    'oberirdische Geschoße"}]}. Outcomes, one per value: suggested (new on the profile, a person will check '
    "it); corroborated (the profile holds the same value; your evidence was added); contradiction (the profile "
    "holds a different value; yours is kept beside it for a person to decide); refused, with the reason and "
    "what to do instead. The answer also names the needs your values opened (a building opens its storeys, "
    "heights and areas), decisive ones marked: they are needs now, and intake_needs lists them with their "
    "options."
)

WITHDRAW_VALUES_DESCRIPTION = (
    "Take back values you recorded in this run once you see a document does not state them for this project: "
    "undecided after all, one of several options, another building's, an older Fassung's. Only your own "
    "suggestions from this run can go; a value a person gave or confirmed, the derived building class and an "
    "earlier reading's suggestion stay, and the answer says so. A withdrawn value is not refused: no person said "
    "no, so a later reading may record it again from a document that states it. To replace a value with "
    "another, withdraw it and record the other."
)

FINISH_INTAKE_DESCRIPTION = (
    "End the reading: tell the intake API it is done, with your summary, and stop. Call it when the needs "
    "are covered, when the documents hold nothing more for them, or when the budget is spent. Nothing runs after "
    "it. While decisive needs are open and files are unread, the first call does not finish: it names them, "
    "and a second call finishes as it is. The summary is shown to the person who checks the reading and is "
    "handed to the next reading of this project as its starting note: every claim in it rests on something a "
    "tool returned in this run (files read, values recorded, refusals), and it says plainly what stays open and "
    "which document would answer it."
)


def make_intake_tools(
    session: IntakeSession, *, budget_spent: Callable[[], bool] = lambda: False
) -> list[StructuredTool]:

    async def _needs(start: int = 0) -> str:
        reply = await client.call_intake("needs", client.needs_request(session.job_id))
        if not reply.ok:
            session.stale = session.stale or reply.stale
            return reply.refusal
        session.remember_needs(reply.body)
        return render_needs(reply.body, start)

    async def _record(values: list[RecordedValue]) -> str:
        return await record_values(session, values)

    async def _withdraw(keys: list[str]) -> str:
        return await withdraw_values(session, keys)

    async def _finish(summary: str) -> str:
        held = None if budget_spent() else await finish_hold(session)
        return held or await finish_intake(session, summary)

    return [
        StructuredTool.from_function(
            coroutine=_needs, name=INTAKE_NEEDS_TOOL, description=INTAKE_NEEDS_DESCRIPTION, args_schema=NeedsInput
        ),
        StructuredTool.from_function(
            coroutine=_record,
            name=RECORD_VALUES_TOOL,
            description=RECORD_VALUES_DESCRIPTION,
            args_schema=RecordValuesInput,
        ),
        StructuredTool.from_function(
            coroutine=_withdraw,
            name=WITHDRAW_VALUES_TOOL,
            description=WITHDRAW_VALUES_DESCRIPTION,
            args_schema=WithdrawInput,
        ),
        StructuredTool.from_function(
            coroutine=_finish,
            name=FINISH_INTAKE_TOOL,
            description=FINISH_INTAKE_DESCRIPTION,
            args_schema=FinishInput,
        ),
    ]
