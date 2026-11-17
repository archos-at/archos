from __future__ import annotations

import asyncio
import contextvars
from pathlib import Path

import pytest

from agent.agents.piloti import prompt as prompt_module
from agent.agents.piloti.prompt import PROMPTS_DIR
from agent.agents.piloti.prompt import STATIC_PROMPT_FILE
from agent.agents.piloti.prompt import STATIC_PROMPT_NAME
from agent.agents.piloti.prompt import bundled_static_block
from agent.agents.piloti.prompt import record_static_prompt_metadata
from agent.agents.piloti.prompt import render_static_block
from agent.agents.piloti.prompt import resolve_static_block
from agent.agents.piloti.prompt import stamp_static_prompt_for_turn
from agent.agents.piloti.prompt import system_prompt_template
from agent.common.brand import PRODUCT_NAME
from agent.common.prompt_store import PromptStore
from agent.common.prompt_store import ResolvedPrompt
from agent.common.prompt_utils import render_prompt_template
from agent.observability import langfuse_trace_attributes as lta

FIXTURE = Path(__file__).parent / "fixtures" / "chat_prompt_rendered.txt"


PINNED = dict(
    product_name="<<PRODUCT NAME>>",
    answer_envelope_schema="<<ENVELOPE SCHEMA>>",
    document_inventory="<<DOCUMENT INVENTORY>>",
    current_datetime="2026-01-02",
    user_info={"name": "Test User", "email": "test@example.invalid"},
    already_read_block="<<ALREADY READ>>",
    org_instructions="<<ORG INSTRUCTIONS>>",
    focus_file_name="Einreichplan.pdf",
    focus_shelf_label="<<SHELF>>",
    building_law="<building_law>\n<<CHAIN TEXT>>\n</building_law>",
    jurisdiction_note="<<JURISDICTION NOTE>>",
    parcel_note="<<PARCEL NOTE>>",
    platform_lessons="<<PLATFORM LESSONS>>",
    project_context="name: Testprojekt\nPROPOSAL_DECISIONS v1\ndocuments_missing:\n- Bebauungsplan",
    skills_block="<<SKILLS>>",
)

MESSAGE_SEAM = "\n\n===== turn context message =====\n\n"


def _forget_what_resolving_recorded() -> None:
    lta.reset_prompt_link()
    lta.reset_contributions()


@pytest.fixture(autouse=True)
def _clean_trace_state():
    _forget_what_resolving_recorded()
    yield
    _forget_what_resolving_recorded()


def _render(static_text: str) -> str:
    system = render_prompt_template(static_text, **PINNED).rstrip("\n")
    return system + MESSAGE_SEAM + render_prompt_template(system_prompt_template(), **PINNED) + "\n"


def regenerate() -> None:
    committed = (PROMPTS_DIR / STATIC_PROMPT_FILE).read_text(encoding="utf-8")
    FIXTURE.write_text(_render(committed), encoding="utf-8")


class TestByteIdentity:
    def test_the_two_halves_render_the_committed_prompt(self):
        committed = (PROMPTS_DIR / STATIC_PROMPT_FILE).read_text(encoding="utf-8")

        assert _render(committed) == FIXTURE.read_text(encoding="utf-8")

    def test_the_turn_context_is_one_tagged_block_and_no_system_prompt(self):
        context = render_prompt_template(system_prompt_template(), **PINNED)

        assert context.startswith("<turn_context>\n")
        assert context.rstrip().endswith("</turn_context>")
        assert "static_block" not in system_prompt_template()

    def test_the_static_half_is_where_the_cacheable_text_lives(self):
        committed = (PROMPTS_DIR / STATIC_PROMPT_FILE).read_text(encoding="utf-8")

        assert "{%" not in committed
        assert committed.count("{{") == 2
        assert "{{ answer_envelope_schema }}" in committed
        assert "{{ product_name }}" in committed

    def test_the_static_prompt_stays_within_its_budget(self):
        committed = (PROMPTS_DIR / STATIC_PROMPT_FILE).read_text(encoding="utf-8")
        paid = committed.replace("{{ product_name }}", PRODUCT_NAME)

        assert len(paid) // 4 <= 5_000


class TestTheRulesThePolishMustNotInvert:
    def test_an_accepted_proposal_reads_as_settled(self):
        rendered = FIXTURE.read_text(encoding="utf-8")

        assert "that point is settled, and a further proposal is about something else." in rendered
        assert "and propose something else" not in rendered


class TestStoreSeam:
    def test_the_bundled_file_is_the_fallback_and_names_itself(self):
        bundled = bundled_static_block()

        assert bundled.is_fallback is True
        assert bundled.name == "git:prompts/chat_static.md"
        assert len(bundled.version) == 7
        assert bundled.text == (PROMPTS_DIR / STATIC_PROMPT_FILE).read_text(encoding="utf-8")

    def test_the_render_uses_the_stores_text_rather_than_the_file(self, monkeypatch):
        monkeypatch.setattr(prompt_module, "prompt_store", lambda: PromptStore(enabled=False))
        template = system_prompt_template()
        served = _FakeStore(ResolvedPrompt(text="MANAGED STATIC HALF", name=STATIC_PROMPT_NAME, version="12"))
        monkeypatch.setattr(prompt_module, "prompt_store", lambda: served)

        resolved = resolve_static_block()
        context = render_prompt_template(template, **PINNED)

        assert served.asked == [STATIC_PROMPT_NAME]
        assert resolved.text == "MANAGED STATIC HALF"
        assert "MANAGED" not in context and context.startswith("<turn_context>")

    def test_the_fallback_handed_to_the_store_is_the_bundled_text(self, monkeypatch):
        served = _FakeStore(None)
        monkeypatch.setattr(prompt_module, "prompt_store", lambda: served)

        resolve_static_block()

        assert served.fallbacks[0].text == bundled_static_block().text

    def test_a_disabled_store_renders_the_bundled_prompt(self, monkeypatch):
        monkeypatch.setattr(prompt_module, "prompt_store", lambda: PromptStore(enabled=False))

        assert resolve_static_block() == bundled_static_block()

    def test_the_rendered_static_block_is_cached_per_distinct_text(self):
        render_static_block.cache_clear()
        first = render_static_block("A {{ answer_envelope_schema }}")
        again = render_static_block("A {{ answer_envelope_schema }}")
        other = render_static_block("B {{ answer_envelope_schema }}")

        assert first is again
        assert other != first
        assert render_static_block.cache_info().hits == 1


class TestPromptLink:
    def test_resolving_records_the_version_the_traces_will_name(self, monkeypatch):
        served = _FakeStore(ResolvedPrompt(text="MANAGED", name=STATIC_PROMPT_NAME, version="12"))
        monkeypatch.setattr(prompt_module, "prompt_store", lambda: served)

        resolve_static_block()

        assert lta.current_prompt_attributes() == {
            lta.OBSERVATION_PROMPT_NAME: STATIC_PROMPT_NAME,
            lta.OBSERVATION_PROMPT_VERSION: 12,
        }

    def test_a_fallback_render_is_no_link_and_is_named_in_the_trace_metadata(self, monkeypatch):
        monkeypatch.setattr(prompt_module, "prompt_store", lambda: PromptStore(enabled=False))

        resolve_static_block()
        record_static_prompt_metadata()

        assert lta.current_prompt_attributes() == {}
        assert lta.snapshot_contributions()["metadata"] == {
            "prompt_name": "git:prompts/chat_static.md",
            "prompt_version": bundled_static_block().version,
        }

    async def test_the_stamp_returns_the_bytes_the_system_prompt_is(self, monkeypatch):
        from agent.agents.piloti.models import ResearchAgentState
        from agent.agents.piloti.prompt import render_turn_prompt

        monkeypatch.setattr(prompt_module, "prompt_store", lambda: PromptStore(enabled=False))

        static = await stamp_static_prompt_for_turn()
        sent = render_turn_prompt(system_prompt_template(), ResearchAgentState(messages=[]), []).system

        assert static and sent == static

    async def test_the_turn_stamp_names_what_this_turn_resolved(self, monkeypatch):
        served = _FakeStore(ResolvedPrompt(text="MANAGED", name=STATIC_PROMPT_NAME, version="12"))
        monkeypatch.setattr(prompt_module, "prompt_store", lambda: served)
        resolve_static_block()
        monkeypatch.setattr(prompt_module, "prompt_store", lambda: PromptStore(enabled=False))

        await stamp_static_prompt_for_turn()

        assert lta.current_prompt_attributes() == {}
        assert lta.snapshot_contributions()["metadata"]["prompt_name"] == "git:prompts/chat_static.md"

    async def test_another_turn_s_transition_does_not_rename_this_turn_s_fallback(self, monkeypatch):
        token = lta.begin_turn_prompt_link()
        try:
            monkeypatch.setattr(prompt_module, "prompt_store", lambda: PromptStore(enabled=False))
            await asyncio.to_thread(resolve_static_block)

            def _other_turn() -> None:
                other = lta.begin_turn_prompt_link()
                served = _FakeStore(ResolvedPrompt(text="MANAGED", name=STATIC_PROMPT_NAME, version="12"))
                monkeypatch.setattr(prompt_module, "prompt_store", lambda: served)
                resolve_static_block()
                lta.end_turn_prompt_link(other)

            contextvars.copy_context().run(_other_turn)
            record_static_prompt_metadata()

            assert lta.current_prompt_attributes() == {}
            assert lta.snapshot_contributions()["metadata"]["prompt_name"] == "git:prompts/chat_static.md"
        finally:
            lta.end_turn_prompt_link(token)

    def test_falling_back_stops_the_process_naming_the_version_it_served(self, monkeypatch):
        served = _FakeStore(ResolvedPrompt(text="MANAGED", name=STATIC_PROMPT_NAME, version="12"))
        monkeypatch.setattr(prompt_module, "prompt_store", lambda: served)
        resolve_static_block()

        monkeypatch.setattr(prompt_module, "prompt_store", lambda: PromptStore(enabled=False))
        resolve_static_block()

        assert lta.current_prompt_attributes() == {}


class TestServedTextThatDoesNotRender:
    def _serve(self, monkeypatch, text: str) -> None:
        served = _FakeStore(ResolvedPrompt(text=text, name=STATIC_PROMPT_NAME, version="13"))
        monkeypatch.setattr(prompt_module, "prompt_store", lambda: served)

    def test_an_undefined_variable_in_the_served_text_serves_the_bundled_file(self, monkeypatch):
        self._serve(monkeypatch, "Hallo {{ buero_name }}")

        assert resolve_static_block() == bundled_static_block()

    def test_a_version_holding_the_retired_building_law_block_serves_the_bundled_file(self, monkeypatch):
        self._serve(monkeypatch, "<role>x</role>\n<building_law>\nAustrian building law is a chain\n</building_law>")

        assert resolve_static_block() == bundled_static_block()

    def test_json_braces_in_the_served_text_serve_the_bundled_file(self, monkeypatch):
        self._serve(monkeypatch, 'Beispiel: {{"a": 1}}')

        assert resolve_static_block() == bundled_static_block()

    def test_the_trace_names_the_git_file_when_the_served_text_did_not_render(self, monkeypatch):
        self._serve(monkeypatch, "Hallo {{ buero_name }}")

        resolve_static_block()
        record_static_prompt_metadata()

        assert lta.current_prompt_attributes() == {}
        assert lta.snapshot_contributions()["metadata"]["prompt_name"] == "git:prompts/chat_static.md"

    def test_a_served_text_that_renders_is_still_served(self, monkeypatch):
        self._serve(monkeypatch, "MANAGED {{ answer_envelope_schema }}")

        resolved = resolve_static_block()

        assert resolved.is_fallback is False
        assert resolved.version == "13"


class TestTheRoundCostIsStatedAsAFact:
    def test_the_prompt_says_a_round_costs_one_whatever_it_holds(self):
        rendered = FIXTURE.read_text(encoding="utf-8")

        assert "a round is one decision, however many calls it holds" in rendered

    def test_the_prompt_names_the_round_budget_the_config_sets(self):
        import re

        config = (Path(__file__).resolve().parents[5] / "configs" / "config_oib_openrouter.yml").read_text(
            encoding="utf-8"
        )
        configured = re.search(r"^\s*max_tool_iterations:\s*(\d+)", config, re.MULTILINE)
        assert configured, "the production config no longer sets max_tool_iterations"
        rendered = FIXTURE.read_text(encoding="utf-8")

        assert f"You have up to {configured.group(1)} tool rounds this turn" in rendered

    def test_the_family_search_is_stated_as_the_members_opened(self):
        from knowledge_layer.register import _KNOWLEDGE_SEARCH_DESCRIPTION as description

        assert "every member is then open at the level a read of one document opens it" in description
        assert "what is left to open is a Punkt by number" in description


class _FakeStore:
    def __init__(self, answer: ResolvedPrompt | None):
        self.answer = answer
        self.asked: list[str] = []
        self.fallbacks: list[ResolvedPrompt] = []

    def get(self, name: str, *, fallback: ResolvedPrompt) -> ResolvedPrompt:
        self.asked.append(name)
        self.fallbacks.append(fallback)
        return self.answer or fallback


def test_project_record_names_the_three_file_blocks_and_says_look_before_missing():
    record = render_prompt_template(system_prompt_template(), **PINNED)

    for key in ("documents:", "documents_missing:", "documents_unreadable:"):
        assert key in record
    assert "`glob`" in record and "`grep`" in record
    without = render_prompt_template(system_prompt_template(), **{**PINNED, "project_context": "name: X"})
    assert "documents_missing:" not in without


def test_the_static_prompt_names_no_country_s_law():
    static = (PROMPTS_DIR / STATIC_PROMPT_FILE).read_text(encoding="utf-8")

    assert "<building_law>" not in static and "building_law>" not in static
    assert "<legal_method>" in static
    for austrian in ("ÖNORM", "Bauordnung", "Land declared", "Flächenwidmungsplan", "MA 37"):
        assert austrian not in static, austrian
