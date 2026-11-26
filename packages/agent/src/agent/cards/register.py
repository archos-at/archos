import json
import logging

from agent.cards import surface_documents as _surface_documents  # noqa: F401
from agent.cards.card_doctrine import render_card_doctrine
from agent.cards.card_examples import CARD_EXAMPLES as _CARD_EXAMPLES  # noqa: F401
from agent.cards.catalog import CHAT_ONLY_CARD_TYPES
from agent.cards.catalog import model_facing_card_types
from agent.cards.catalog import render_card_details
from agent.cards.catalog import render_card_index
from agent.cards.catalog import shape_hint_for as _shape_hint_for  # noqa: F401 — re-exported
from agent.cards.envelope import REFUSED_SHAPE
from agent.cards.envelope import REFUSED_SYSTEM_TYPE
from agent.cards.envelope import validate_model_card
from nat.plugin_api import Builder
from nat.plugin_api import FunctionBaseConfig
from nat.plugin_api import FunctionInfo
from nat.plugin_api import register_function

logger = logging.getLogger(__name__)


_CARD_DOCTRINE = render_card_doctrine()


def _build_tool_description() -> str:
    return (
        "Render a rich UI card alongside your answer, in addition to your written reply — always "
        "write the prose too: delete the cards mentally and the answer must still answer. On an "
        "ordinary turn put your cards in the `cards` field of your answer envelope instead, in the "
        "same message as the answer — that costs no further call; this tool is for a card you must "
        "show BEFORE the answer is written. Several cards are one call: pass a JSON array of card "
        "objects.\n\n"
        + _CARD_DOCTRINE
        + "\n\nHOW. Pass `card_json`: a JSON object with a `type` field plus that type's fields. "
        "Fill it from the type's line below and the rules above; you are not shown every shape up "
        "front, and you do not need to look one up first — if a field is wrong, the error hands "
        "you that type's full shape and a worked example, so an unfamiliar shape is never a reason "
        "to skip a card the answer called for. Fields marked * are "
        "required; omit optional ones rather than passing null. Numbers are plain JSON numbers. For "
        "schematic cards, supply the measured/actual value from the question or project profile and "
        "the OIB limit in `required`; if a value is unknown, omit it and set that check's status to "
        '"needs_input" — never estimate.\n\n' + render_card_index(exclude=CHAT_ONLY_CARD_TYPES)
    )


_DESCRIBE_DESCRIPTION = (
    "Return the exact JSON shape, the shared building blocks and a worked example for one or more "
    "card types, so you can fill `emit_card` in correctly on the first attempt. Pass `card_types`: "
    "one type name, or several separated by commas. Call this once for the types you intend to "
    "emit; the shapes stay in context afterwards."
)


_NO_CHANNEL = "Noted, but no card channel is available in this context; continue with your written answer."


def _declared_type(payload: object) -> str:
    if not isinstance(payload, dict):
        return type(payload).__name__
    return str(payload.get("type", "?"))


def _many_result(markers: list[str], refusals: list[str]) -> str:
    if not markers:
        return "\n".join(refusals)

    count = "1 card" if len(markers) == 1 else f"{len(markers)} cards"
    registered = (
        f"{count} will be shown with your answer, as {', '.join(markers)}. Write each marker on a "
        "line of its own at the point in your answer where that card belongs, and it is drawn there "
        "instead of after the whole answer. A marker you leave out lands its card at the end."
    )
    if not refusals:
        return registered
    return registered + "\n\n" + "\n".join(refusals)


class EmitCardConfig(FunctionBaseConfig, name="emit_card"): ...


@register_function(config_type=EmitCardConfig)
async def emit_card(tool_config: EmitCardConfig, builder: Builder):
    from agent.cards.registry import get_card_registry

    def _validated_or_refusal(payload: object) -> tuple[dict | None, str | None]:
        if isinstance(payload, dict) and payload.get("type") in CHAT_ONLY_CARD_TYPES:
            logger.warning("emit_card rejected a '%s' card: chat envelope only", payload["type"])
            return None, (
                f"Error: card type '{payload['type']}' cannot be emitted with emit_card. Emit the cards it "
                "would hold one by one."
            )
        validated, refusal = validate_model_card(payload)
        if refusal is None:
            return validated, None
        if refusal.kind == REFUSED_SHAPE:
            return None, (
                f"Error: {refusal.message} Fix the fields and call emit_card again, or skip the card."
                + (f"\n\n{refusal.hint}" if refusal.hint else "")
            )
        if refusal.kind == REFUSED_SYSTEM_TYPE:
            return None, (
                f"Error: card type '{refusal.card_type}' is system-emitted and cannot be created with "
                "emit_card. Do not emit this card type."
            )
        return None, f"Error: {refusal.message}"

    def _register(validated: dict) -> int | None:
        registry = get_card_registry()
        if registry is None:
            logger.info("emit_card called with no active card registry; card of type %s dropped", validated["type"])
            return None

        registry.add(validated)
        position = len(registry)
        logger.info("emit_card registered a '%s' card as card %d", validated["type"], position)
        return position

    def _emit_one(payload: object) -> str:
        validated, refusal = _validated_or_refusal(payload)
        if refusal is not None:
            return refusal

        position = _register(validated)
        if position is None:
            return _NO_CHANNEL

        return (
            f"Card '{validated['type']}' will be shown with your answer, as card {position}. "
            f"Write [[card:{position}]] on a line of its own at the point in your answer where the "
            "card belongs, and it is drawn there instead of after the whole answer. Leave the marker "
            "out and the card lands at the end."
        )

    def _emit_many(payloads: list) -> str:
        if not payloads:
            return "Error: card_json is an empty array. Pass at least one card object."

        markers: list[str] = []
        refusals: list[str] = []
        for index, element in enumerate(payloads):
            validated, refusal = _validated_or_refusal(element)
            if refusal is not None:
                refusals.append(f"Card at index {index} (type '{_declared_type(element)}'): {refusal}")
                continue
            position = _register(validated)
            if position is None:
                return _NO_CHANNEL
            markers.append(f"[[card:{position}]]")

        return _many_result(markers, refusals)

    async def _emit(card_json: str) -> str:
        try:
            payload = json.loads(card_json, strict=False) if isinstance(card_json, str) else card_json
        except (json.JSONDecodeError, TypeError) as exc:
            logger.warning("emit_card rejected a card: card_json is not valid JSON (%s)", exc)
            return (
                f"Error: card_json is not valid JSON ({exc}). "
                "Pass a JSON object with a 'type' field, or an array of them."
            )

        if isinstance(payload, list):
            return _emit_many(payload)
        return _emit_one(payload)

    yield FunctionInfo.from_fn(_emit, description=_build_tool_description())


class DescribeCardConfig(FunctionBaseConfig, name="describe_card"): ...


@register_function(config_type=DescribeCardConfig)
async def describe_card(tool_config: DescribeCardConfig, builder: Builder):

    async def _describe(card_types: str) -> str:
        requested = [t.strip() for t in str(card_types).replace(" ", ",").split(",") if t.strip()]
        if not requested:
            return "Error: pass at least one card type name, e.g. 'stair_diagram'."

        known = model_facing_card_types() - CHAT_ONLY_CARD_TYPES
        unknown = [t for t in requested if t not in known]
        detail = render_card_details([t for t in requested if t in known])

        if not detail:
            return f"No such card type: {', '.join(unknown)}. Available types: {', '.join(sorted(known))}."
        if unknown:
            detail += f"\n\nNot a card type, ignored: {', '.join(unknown)}."
        return detail

    yield FunctionInfo.from_fn(_describe, description=_DESCRIBE_DESCRIPTION)
