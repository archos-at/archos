from langchain_core.messages import HumanMessage

from agent.agents.piloti.models import ResearchAgentState
from agent.agents.piloti.prompt import render_turn_context
from agent.agents.piloti.prompt import system_prompt_template

BOUNDARY_ANCHOR = "<turn_context>"
HEADING = "## Reference projects of the office"
CATALOG = "- Wohnbau Graz (id p1): 2019–2021, steiermark, GK 4, holzbau · gemeinsam: GK 4"
LOOKUP = {"name": "project_lookup", "description": "Schlägt in anderen Projekten nach."}
SEARCH = {"name": "knowledge_search", "description": "Search the knowledge base."}


def _render(tools, **overrides) -> str:
    state = ResearchAgentState(messages=[HumanMessage(content="Wie haben wir die Fluchttreppe gelöst?")], **overrides)
    return render_turn_context(system_prompt_template(), state, tools)


def test_the_catalog_reaches_the_model_below_the_cache_boundary_with_the_rule_to_look_unasked():
    rendered = _render([SEARCH, LOOKUP], reference_projects=CATALOG)

    assert HEADING in rendered
    assert CATALOG in rendered
    assert rendered.index(BOUNDARY_ANCHOR) < rendered.index(HEADING)
    block = rendered.split(HEADING)[1]
    assert "`project_lookup`" in block
    assert "as a precedent, not a norm" in block


def test_a_precedent_is_kept_apart_into_what_applies_what_the_office_does_and_where_it_was_done():
    block = _render([SEARCH, LOOKUP], reference_projects=CATALOG).split(HEADING)[1]

    assert "keep three parts apart and in this order" in block
    assert block.index("what applies") < block.index("how the office usually") < block.index("where the office did it")
    assert "project, year, Bundesland" in block
    assert "if the precedent's edition or Bundesland differs" in block


def test_no_catalog_without_the_tool_to_act_on_it():
    assert HEADING not in _render([SEARCH], reference_projects=CATALOG)


def test_no_catalog_renders_no_section():
    assert HEADING not in _render([SEARCH, LOOKUP])


def test_the_conversation_state_hands_the_catalog_to_the_research_state():
    from agent.agents.piloti.conversation import ConversationGraph
    from agent.agents.piloti.models.conversation import ConversationState

    state = ConversationState(messages=[HumanMessage(content="Wie?")], reference_projects=CATALOG)
    research = ConversationGraph._research_input(object.__new__(ConversationGraph), state, list(state.messages))

    assert research.reference_projects == CATALOG
