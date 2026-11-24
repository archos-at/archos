from __future__ import annotations

import json
import logging
import threading
from collections import OrderedDict
from typing import Any

from agent.auth.request_identity import headless_turn_requested
from agent.common import build_human_prompt
from agent.common import extract_user_response
from nat.plugin_api import Builder
from nat.plugin_api import Context
from nat.plugin_api import FunctionBaseConfig
from nat.plugin_api import FunctionInfo
from nat.plugin_api import register_function

logger = logging.getLogger(__name__)

MIN_OPTIONS = 2
"""Fewer than two labels is not a choice; that question belongs in the prose."""

MAX_OPTIONS = 6
"""More than six stops being the "small, enumerable set" this tool is for."""

_FALL_BACK_TO_ASSUMPTION = (
    "No question was put to the user. Answer now with the most reasonable assumption and say plainly "
    "which assumption you made, so the user can correct it in their next message."
)
"""What the agent is told whenever the prompt could not be delivered.

Never an error the model has to interpret: the useful next move is always the
same, and a model told only "failed" tends to ask the question in prose anyway
and end the turn — the exact behaviour this tool exists to replace.
"""

DECLINE_REPLIES = frozenset(
    {
        "skip",
        "egal",
        "weiss nicht",
        "weiß nicht",
        "keine ahnung",
        "keine angabe",
        "don't know",
        "dont know",
        "no idea",
        "",
    }
)
"""Replies that mean "decide for me" rather than naming a choice.

Kept literal and short: `skip` is the control word the rest of the product
already teaches (``clarify.SKIP_COMMANDS``), and the German entries are
here because this is a German-first product and "egal" is what people type.
"""

_TOOL_DESCRIPTION = """\
Ask the user ONE multiple-choice question in the middle of your answer and WAIT for their pick, then \
continue this same turn using what they chose. The user sees your question with the options as \
selectable buttons.

WHEN TO USE IT. Whenever you can already name a SMALL, ENUMERABLE set of 2-6 concrete options and \
picking the wrong one would meaningfully change the answer: the two IFC models in the project, the \
three Bundesländer the question could mean, the two document versions that both match, or several \
genuinely distinct ways to read an ambiguous question. You must be able to name the options yourself — \
if you cannot list them, this is not the tool. Prefer asking over silently guessing whenever the \
options would lead to different answers; a good one-shot question here is what makes the rest of the \
answer trustworthy instead of a guess.

WHEN NOT TO USE IT. Do NOT ask for something a search or another tool could establish: look it up \
instead, that is what the tools are for. Do NOT ask for something the project context already states. \
Do NOT ask when the choice would NOT meaningfully change the answer, or when a stated assumption is \
just as good — then answer, and say which assumption you made ("Ich gehe von Bauklasse 4 aus; für eine \
andere Klasse gilt …"). At most ONE ask_user per turn. Never for an open question ("welcher \
Zeitraum?") — write those as prose in your answer instead.

HOW. `question`: the whole question in the user's language, including the framing sentence; it is \
shown above the options. `options`: 2 to 6 SHORT labels, one per choice — a label, not a sentence \
("Ifc2x3_SampleCastle.ifc", not "Das Schloss-Modell, das letzte Woche hochgeladen wurde"). The user \
may also type a free-text answer or decline; you get back whatever they said, and you continue your \
answer from there."""


_MAX_TRACKED_TURNS = 1000


class AskUserGuard:
    def __init__(self) -> None:
        self._asked_turns: OrderedDict[str, str] = OrderedDict()
        self._pending_conversations: dict[str, str] = {}
        self._lock = threading.Lock()

    def claim(self, conversation_id: str | None, turn_id: str | None) -> str | None:
        if not conversation_id:
            return None
        with self._lock:
            if conversation_id in self._pending_conversations:
                return "in_flight"
            if turn_id and self._asked_turns.get(conversation_id) == turn_id:
                return "already_asked"
            self._pending_conversations[conversation_id] = turn_id or ""
            if turn_id:
                self._remember_turn(conversation_id, turn_id)
        return None

    def _remember_turn(self, conversation_id: str, turn_id: str) -> None:
        self._asked_turns[conversation_id] = turn_id
        self._asked_turns.move_to_end(conversation_id)
        while len(self._asked_turns) > _MAX_TRACKED_TURNS:
            self._asked_turns.popitem(last=False)

    def release(self, conversation_id: str | None) -> None:
        if not conversation_id:
            return
        with self._lock:
            self._pending_conversations.pop(conversation_id, None)

    def reset(self) -> None:
        with self._lock:
            self._asked_turns.clear()
            self._pending_conversations.clear()


_guard = AskUserGuard()


def reset_ask_user_guard() -> None:
    _guard.reset()


def _normalize_options(options: list[str] | str | None) -> list[str]:
    if options is None:
        return []
    if isinstance(options, str):
        text = options.strip()
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError, TypeError:
            parsed = [part for part in text.split("\n")] if "\n" in text else text.split(",")
        options = parsed if isinstance(parsed, list) else [str(parsed)]
    return [str(option).strip() for option in options if str(option).strip()]


def _is_decline(reply: str) -> bool:
    return reply.strip().strip(".!").lower() in DECLINE_REPLIES


class AskUserConfig(FunctionBaseConfig, name="ask_user"): ...


class _Undeliverable(Exception): ...


def _reject_arguments(question: str, labels: list[str]) -> str | None:
    if not question:
        return f"Error: `question` was empty. {_FALL_BACK_TO_ASSUMPTION}"
    if len(labels) < MIN_OPTIONS:
        return (
            f"Error: ask_user needs at least {MIN_OPTIONS} options — it is for a choice between "
            f"alternatives you can name. {_FALL_BACK_TO_ASSUMPTION}"
        )
    if len(labels) > MAX_OPTIONS:
        return (
            f"Error: ask_user takes at most {MAX_OPTIONS} options; you passed {len(labels)}. "
            f"A list that long is not a quick choice. {_FALL_BACK_TO_ASSUMPTION}"
        )
    return None


def _turn_scope() -> tuple[str | None, str | None, Any] | None:
    try:
        nat_context = Context.get()
        return nat_context.conversation_id, nat_context.user_message_id, nat_context.user_interaction_manager
    except Exception:  # noqa: BLE001 - a tool must answer the model, never abort the turn
        logger.info("ask_user called with no usable NAT context", exc_info=True)
        return None


async def _prompt_user(manager: Any, question: str, labels: list[str]) -> Any:
    try:
        return await manager.prompt_user_input(build_human_prompt(question, labels))
    except NotImplementedError as exc:
        logger.info("ask_user called with no user-interaction callback bound; question dropped")
        raise _Undeliverable("No channel to ask the user is available here.") from exc
    except TimeoutError as exc:
        logger.info("ask_user prompt expired unanswered")
        raise _Undeliverable("The user did not answer in time.") from exc
    except Exception as exc:  # noqa: BLE001 - an exception out of a tool aborts a turn the user is watching
        logger.warning("ask_user failed to prompt the user", exc_info=True)
        raise _Undeliverable("The question could not be delivered.") from exc


_HEADLESS = (
    "Nobody is watching this turn live: it was started by an event, not typed, so a question here would "
    "never be answered. Do not wait. If you need something from the person, ask it where you were "
    "addressed (in the Anmerkung's thread with `canvas__reply`, or in your answer), and meanwhile answer "
    "with the most reasonable assumption, saying which assumption you made."
)

_REFUSALS = {
    "in_flight": "Another question is already waiting for this conversation.",
    "already_asked": "You already asked the user once this turn.",
}


def _headless() -> bool:
    try:
        return headless_turn_requested()
    except Exception:  # noqa: BLE001 - outside the API tier there is no caller to read
        return False


def _reply_for(answer: str, option_count: int) -> str:
    if _is_decline(answer):
        logger.info("ask_user: user declined to choose")
        return (
            "The user declined to choose. Answer now with the most reasonable assumption and say "
            "which assumption you made."
        )
    logger.info("ask_user: user answered a %d-option question", option_count)
    return f'The user answered: "{answer}". Continue your answer using this. Do not ask again this turn.'


async def _ask(question: str, options: list[str] | str | None = None) -> str:
    question_text = str(question or "").strip()
    labels = _normalize_options(options)
    rejection = _reject_arguments(question_text, labels)
    if rejection is not None:
        return rejection
    if _headless():
        logger.info("ask_user refused on a headless turn")
        return _HEADLESS
    scope = _turn_scope()
    if scope is None:
        return f"No channel to ask the user is available here. {_FALL_BACK_TO_ASSUMPTION}"
    conversation_id, turn_id, manager = scope
    refusal = _guard.claim(conversation_id, turn_id)
    if refusal is not None:
        logger.info("ask_user refused (%s) for conversation %s", refusal, conversation_id)
        return f"{_REFUSALS[refusal]} {_FALL_BACK_TO_ASSUMPTION}"
    try:
        response = await _prompt_user(manager, question_text, labels)
    except _Undeliverable as undeliverable:
        return f"{undeliverable} {_FALL_BACK_TO_ASSUMPTION}"
    finally:
        _guard.release(conversation_id)
    return _reply_for(extract_user_response(response).strip(), len(labels))


@register_function(config_type=AskUserConfig)
async def ask_user(tool_config: AskUserConfig, builder: Builder):
    yield FunctionInfo.from_fn(_ask, description=_TOOL_DESCRIPTION)
