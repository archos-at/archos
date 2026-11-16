import dataclasses
import json

import pytest
from pydantic import ValidationError

from agent.common.canned_replies import GENERIC_ERROR_MESSAGE
from agent.common.model_overrides import AgentGroup
from agent.stages import get_stage
from agent.stages.follow_ups import FOLLOW_UPS
from agent.stages.follow_ups import FOLLOW_UPS_SYSTEM_PROMPT
from agent.stages.follow_ups import FollowUpQuestion
from agent.stages.follow_ups import FollowUpsPayload
from agent.stages.follow_ups import build_user_prompt
from agent.stages.follow_ups import sanitize_items
from agent.stages.spec import StageContext
from agent.stages.spec import StageEmpty
from agent.stages.spec import TurnFacts

ANSWER = (
    "Für die Gebäudeklasse ist das Fluchtniveau maßgeblich: gemessen wird es vom Fußboden des "
    "höchstgelegenen Aufenthaltsraums bis zum angrenzenden Gelände. Liegt dieses Niveau nicht "
    "über 11 m, fällt das Gebäude nach OIB-Richtlinie 2 in die Gebäudeklasse 4, sofern es "
    "höchstens drei oberirdische Geschoße aufweist und die Nutzungseinheiten je nicht mehr als "
    "400 m² betragen. Wird das Dachgeschoß zu Aufenthaltsräumen ausgebaut, verschiebt sich das "
    "Fluchtniveau nach oben und die Einstufung kann auf Gebäudeklasse 5 wechseln. Für die "
    "Einreichung ist die Gebäudeklasse im Bauansuchen anzugeben und durch einen Nachweis der "
    "Fluchtniveaus zu belegen."
)

GOOD_ITEMS = [
    {"question": "Wie wird das Fluchtniveau genau gemessen?", "hint": "Messpunkt und Bezugsebene"},
    {"question": "Ändert sich die Einstufung, wenn das Dachgeschoß ausgebaut wird?", "hint": ""},
    {"question": "Was hätte für die Gebäudeklasse 5 gegolten?", "hint": ""},
    {"question": "Welche Nachweise verlangt die Einreichung dafür?", "hint": ""},
]

FILLER_ITEMS = [
    {"question": "Kannst du mehr dazu sagen?", "hint": ""},
    {"question": "Was gilt sonst noch?", "hint": ""},
    {"question": "Gibt es weitere Anforderungen?", "hint": ""},
    {"question": "Erzähl mir mehr dazu.", "hint": ""},
]


def _body(items) -> str:
    return json.dumps({"items": [{"question": item["question"], "hint": ""} for item in items]})


def _facts(**overrides) -> TurnFacts:
    base = TurnFacts(
        conversation_id="conv_1",
        ws_parent_id="msg_1",
        organization_id="org_1",
        query="In welche Gebäudeklasse fällt mein Haus?",
        answer=ANSWER,
        routing_decision="shallow",
        enabled_stages=frozenset({"follow_ups"}),
    )
    return dataclasses.replace(base, **overrides)


def _gate(**overrides):
    return FOLLOW_UPS.gate(_facts(**overrides))


class _StubLLM:
    def __init__(self, body: str, *, fail_bind: bool = False):
        self.body = body
        self.fail_bind = fail_bind
        self.calls = 0

    def bind(self, **kwargs):
        if self.fail_bind:
            raise RuntimeError("this model rejects response_format")
        return self

    async def ainvoke(self, messages):
        from agent.common import prompt_caching

        self.calls += 1
        self.messages = messages
        self.one_shot = prompt_caching._ONE_SHOT.get()
        return type("_Response", (), {"content": self.body})()


class TestDeclaration:
    def test_it_is_registered_under_its_wire_id(self):
        assert get_stage("follow_ups") is FOLLOW_UPS

    def test_it_delivers_a_frame(self):
        assert FOLLOW_UPS.delivery == "frame"

    def test_it_runs_on_its_own_agent_group_and_flag(self):
        assert FOLLOW_UPS.agent_group is AgentGroup.FOLLOW_UPS
        assert FOLLOW_UPS.flag_slug == "post-answer-follow-ups"

    def test_no_two_stages_share_an_agent_group(self):
        from agent.stages import iter_stages

        groups = [spec.agent_group for spec in iter_stages()]
        assert len(set(groups)) == len(groups)

    def test_it_is_bounded_tighter_than_reflection(self):
        assert FOLLOW_UPS.timeout_s == 20.0
        assert FOLLOW_UPS.max_output_tokens == 512


class TestGate:
    def test_a_substantive_research_turn_runs(self):
        assert _gate().run is True

    @pytest.mark.parametrize(
        ("overrides", "reason"),
        [
            ({"run_id": "run_1"}, "commissioned_run"),
            ({"routing_decision": "meta"}, "routing_meta"),
            ({"routing_decision": "error"}, "routing_error"),
            ({"research_truncated": True}, "research_truncated"),
            ({"query": ""}, "empty_turn"),
            ({"answer": GENERIC_ERROR_MESSAGE * 12}, "canned_non_answer"),
            ({"answer": "Ja, 100 cm."}, "answer_too_short"),
            ({"answer": ANSWER + "\n\nIn welchem Bundesland liegt das Projekt?"}, "answer_ends_in_question"),
        ],
    )
    def test_each_declined_turn_names_its_own_condition(self, overrides, reason):
        decision = _gate(**overrides)
        assert decision.run is False
        assert decision.reason == reason

    def test_a_turn_that_already_emitted_the_card_still_runs(self):
        assert _gate(emitted_card_types=frozenset({"follow_ups"})).run is True

    def test_no_condition_consults_a_model(self):
        facts = _facts()
        assert FOLLOW_UPS.gate(facts) == FOLLOW_UPS.gate(facts)


class TestPayloadShape:
    def test_a_topic_label_is_not_a_sendable_question(self):
        with pytest.raises(ValidationError, match="end with"):
            FollowUpQuestion(question="Fluchtniveau und Gebäudeklasse")

    def test_two_questions_in_one_chip_are_refused(self):
        with pytest.raises(ValidationError, match="compete for the same reply"):
            FollowUpQuestion(question="Wie wird gemessen? Und was gilt dann?")

    def test_a_hint_that_restates_the_question_is_dropped(self):
        item = FollowUpQuestion(question="Wie wird das Fluchtniveau gemessen?", hint="Wie wird das Fluchtniveau")
        assert item.hint is None

    def test_one_chip_is_not_a_set_of_options(self):
        with pytest.raises(ValidationError):
            FollowUpsPayload(items=GOOD_ITEMS[:1])

    def test_five_is_a_menu(self):
        with pytest.raises(ValidationError):
            FollowUpsPayload(items=GOOD_ITEMS + [{"question": "Und wie hoch ist die Brüstung dann?"}])

    def test_the_same_question_twice_is_not_two_questions(self):
        with pytest.raises(ValidationError, match="the same question"):
            FollowUpsPayload(items=[GOOD_ITEMS[0], dict(GOOD_ITEMS[0])])

    def test_the_payload_has_no_heading_to_write_chrome_into(self):
        assert "title" not in FollowUpsPayload.model_fields
        with pytest.raises(ValidationError):
            FollowUpsPayload(items=GOOD_ITEMS[:2], title="Weiterführende Fragen")


class TestAnchoring:
    def test_the_documented_good_set_survives(self):
        items = sanitize_items(GOOD_ITEMS, answer=ANSWER)
        assert [item["question"] for item in items] == [entry["question"] for entry in GOOD_ITEMS]
        assert FollowUpsPayload(items=items)

    def test_the_documented_bad_set_is_inexpressible(self):
        assert sanitize_items(FILLER_ITEMS, answer=ANSWER) == []

    def test_one_filler_question_costs_only_itself(self):
        items = sanitize_items(GOOD_ITEMS[:2] + FILLER_ITEMS[:1], answer=ANSWER)
        assert len(items) == 2

    def test_german_inflection_does_not_break_an_anchor(self):
        items = sanitize_items([{"question": "Wie belegt man die Fluchtniveaus?"}], answer=ANSWER)
        assert len(items) == 1

    def test_a_hint_is_never_promoted_into_the_anchor(self):
        assert sanitize_items([{"question": "Kannst du mehr dazu sagen?", "hint": "Fluchtniveau"}], answer=ANSWER) == []


class TestHandler:
    @pytest.mark.asyncio
    async def test_a_good_set_becomes_a_ready_payload(self):
        llm = _StubLLM(_body(GOOD_ITEMS))
        result = await FOLLOW_UPS.handler(StageContext(facts=_facts(), llm=llm))
        assert FollowUpsPayload.model_validate(result)
        assert len(result["items"]) == 4

    @pytest.mark.asyncio
    async def test_the_model_declining_is_its_own_bucket(self):
        llm = _StubLLM('{"items": []}')
        result = await FOLLOW_UPS.handler(StageContext(facts=_facts(), llm=llm))
        assert result == StageEmpty("model_declined")

    @pytest.mark.asyncio
    async def test_filler_that_survives_the_prompt_is_a_different_bucket(self):
        llm = _StubLLM(_body(FILLER_ITEMS))
        result = await FOLLOW_UPS.handler(StageContext(facts=_facts(), llm=llm))
        assert result == StageEmpty("no_usable_items")

    @pytest.mark.asyncio
    async def test_a_model_that_rejects_response_format_still_answers(self):
        body = _body(GOOD_ITEMS[:2])
        llm = _StubLLM(body, fail_bind=True)
        result = await FOLLOW_UPS.handler(StageContext(facts=_facts(), llm=llm))
        assert len(result["items"]) == 2

    @pytest.mark.asyncio
    async def test_exactly_one_llm_call_per_turn(self):
        llm = _StubLLM('{"items": []}')
        await FOLLOW_UPS.handler(StageContext(facts=_facts(), llm=llm))
        assert llm.calls == 1


class TestPromptInputs:
    def test_the_prompt_sees_the_finished_answer(self):
        assert ANSWER in build_user_prompt(_facts())

    def test_a_long_answer_is_sliced_and_the_slice_is_marked(self):
        prompt = build_user_prompt(_facts(answer="x" * 9000))
        assert "(Antwort gekürzt)" in prompt
        assert len(prompt) < 7000

    def test_the_federal_state_rides_along(self):
        assert "Tirol" in build_user_prompt(_facts(federal_state="Tirol"))

    def test_the_project_memory_digest_does_not(self):
        digest = '- [decision | high] "Bauherr wählt Flachdach"'
        assert digest not in build_user_prompt(_facts(memory_digest=digest))


class TestCostCeiling:
    MAX_SYSTEM_TOKENS = 800
    MAX_WORST_CASE_TOKENS = 2_600

    @staticmethod
    def _encoding():
        tiktoken = pytest.importorskip("tiktoken")
        return tiktoken.get_encoding("cl100k_base")

    def test_the_fixed_prompt_stays_under_its_ceiling(self):
        encoding = self._encoding()
        tokens = len(encoding.encode(FOLLOW_UPS_SYSTEM_PROMPT))
        assert tokens <= self.MAX_SYSTEM_TOKENS, (
            f"The follow-ups system prompt is {tokens} tokens, over the {self.MAX_SYSTEM_TOKENS} "
            "ceiling. This is paid on every substantive answer. Craft that teaches how to WRITE an "
            "answer belongs in the `piloti-cards` skill; what belongs here is only what is decidable "
            "by reading a finished one."
        )

    def test_a_saturated_turn_stays_under_its_ceiling(self):
        encoding = self._encoding()
        facts = _facts(
            query="Frage. " * 600, answer="Ein Satz über das Fluchtniveau. " * 400, federal_state="Vorarlberg"
        )
        prompt = FOLLOW_UPS_SYSTEM_PROMPT + build_user_prompt(facts)
        tokens = len(encoding.encode(prompt))
        assert tokens <= self.MAX_WORST_CASE_TOKENS, (
            f"A saturated follow-ups turn costs {tokens} prompt tokens, over the "
            f"{self.MAX_WORST_CASE_TOKENS} ceiling. Either the slices grew or the framing did."
        )

    def test_the_output_ceiling_has_room_for_a_full_set(self):
        encoding = self._encoding()
        body = json.dumps({"items": GOOD_ITEMS}, ensure_ascii=False)
        assert len(encoding.encode(body)) * 2 < FOLLOW_UPS.max_output_tokens


async def test_the_follow_ups_call_writes_nothing_to_the_cache():
    llm = _StubLLM('{"items": []}')
    await FOLLOW_UPS.handler(StageContext(facts=_facts(), llm=llm))
    assert llm.calls == 1 and llm.one_shot is True
