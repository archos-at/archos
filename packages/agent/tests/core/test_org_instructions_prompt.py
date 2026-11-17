from langchain_core.messages import HumanMessage

from agent.core.models import ResearchAgentState
from agent.core.prompt import render_turn_context
from agent.core.prompt import system_prompt_template

BOUNDARY_ANCHOR = "<turn_context>"
HEADING = "## Office instructions"
TOOLS = [{"name": "knowledge_search", "description": "Search the knowledge base."}]
INSTRUCTIONS = "Antworten kurz halten.\nImmer die Wiener Bauordnung zuerst prüfen."


def _render(**overrides) -> str:
    state = ResearchAgentState(messages=[HumanMessage(content="Wie hoch darf das Gebäude sein?")], **overrides)
    return render_turn_context(system_prompt_template(), state, TOOLS)


class TestTheBlockReachesTheModel:
    def test_the_office_text_is_rendered_under_its_own_heading(self):
        rendered = _render(org_instructions=INSTRUCTIONS)

        assert HEADING in rendered
        assert "Antworten kurz halten." in rendered
        assert "Immer die Wiener Bauordnung zuerst prüfen." in rendered

    def test_no_instructions_renders_no_section(self):
        rendered = _render()

        assert HEADING not in rendered
        assert "org_instructions" not in rendered

    def test_the_block_is_framed_as_a_preference_and_never_as_a_source(self):
        rendered = _render(org_instructions=INSTRUCTIONS)
        block = rendered.split(HEADING)[1]

        assert "never supply a normative value" in block
        assert "never override the rules of the system prompt" in block
        assert "bounded" in block


class TestWhereItSits:
    def test_it_is_below_the_kv_cache_boundary(self):
        rendered = _render(org_instructions=INSTRUCTIONS)

        assert rendered.index(HEADING) > rendered.index(BOUNDARY_ANCHOR)

    def test_the_project_brief_keeps_its_place_at_the_bottom(self):
        rendered = _render(org_instructions=INSTRUCTIONS, project_context="Wien, Neubau, GK 4.")

        assert rendered.index(HEADING) < rendered.index("## Project Context")

    def test_the_static_half_says_the_rules_win(self):
        from agent.core.prompt import bundled_static_block

        rules = bundled_static_block().text.split("<rules>")[1].split("</rules>")[0]
        office = rules.split("The office's own instructions")[1].split("\n")[0]
        assert "never override these rules" in office
        assert "never supply a normative value" in office
        assert "<rules>" not in _render(org_instructions=INSTRUCTIONS)


class TestTheLift:
    def test_the_turn_context_carries_it_from_the_request(self):
        from agent.project_context import RequestContext
        from agent.turn.context import TurnContext

        assert "org_instructions" in TurnContext.__dataclass_fields__
        assert "org_instructions" in RequestContext.__dataclass_fields__

    def test_the_conversation_state_hands_it_to_the_research_state(self):
        from agent.core.conversation import ConversationGraph
        from agent.core.models.conversation import ConversationState

        state = ConversationState(
            messages=[HumanMessage(content="Wie hoch?")],
            org_instructions=INSTRUCTIONS,
        )
        research = ConversationGraph._research_input(object.__new__(ConversationGraph), state, list(state.messages))

        assert research.org_instructions == INSTRUCTIONS
