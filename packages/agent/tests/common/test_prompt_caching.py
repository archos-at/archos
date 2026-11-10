"""Tests for the prompt-cache/sticky-routing key derivation.

The contract under test is narrow and load-bearing: the key must be the same
for every call that shares a cached prefix (so a turn's iterations land on the
endpoint that cached it) and different the moment the prefix changes (so a miss
is never pinned to a warm shard).
"""

import json

from langchain_core.messages import AIMessage
from langchain_core.messages import HumanMessage
from langchain_core.messages import SystemMessage

from agent.common.prompt_caching import CACHE_CONTROL_FIELD
from agent.common.prompt_caching import PROMPT_CACHE_KEY_FIELD
from agent.common.prompt_caching import SESSION_ID_FIELD
from agent.common.prompt_caching import begin_stable_prefix
from agent.common.prompt_caching import cached_system_message
from agent.common.prompt_caching import end_stable_prefix
from agent.common.prompt_caching import needs_cache_marker
from agent.common.prompt_caching import one_shot_calls
from agent.common.prompt_caching import prompt_cache_extra_body
from agent.common.prompt_caching import prompt_cache_key
from agent.common.prompt_caching import strip_block_breakpoints
from agent.common.prompt_caching import with_cache_marker
from agent.common.prompt_caching import with_prompt_cache_routing

TOOLS = [{"type": "function", "name": "knowledge_search", "parameters": {"type": "object"}}]


def _key(**overrides):
    args = {
        "system_prompt": "You are the office colleague.",
        "tools": TOOLS,
        "organization_id": "org_1",
        "model": "openai/gpt-5.6-luna",
    }
    args.update(overrides)
    return prompt_cache_key(**args)


def test_same_prefix_gives_the_same_key():
    assert _key() == _key()


def test_key_changes_with_the_system_prompt():
    assert _key() != _key(system_prompt="You are Piloti. ")


def test_key_changes_with_the_tool_set():
    other = [{"type": "function", "name": "ifc_query", "parameters": {"type": "object"}}]
    assert _key() != _key(tools=other)


def test_key_changes_with_the_tenant_and_the_model():
    assert _key() != _key(organization_id="org_2")
    assert _key() != _key(model="anthropic/claude-sonnet-5")


def test_key_is_independent_of_dict_ordering():
    # Two builds of one tool set may serialize their mappings in different
    # orders; that is not a different prefix and must not split the shard.
    reordered = [{"name": "knowledge_search", "type": "function", "parameters": {"type": "object"}}]
    assert _key() == _key(tools=reordered)


def test_key_fits_openrouters_session_id_limit():
    # `session_id` is capped at 256 characters by the API.
    assert len(_key()) <= 256


def test_parts_cannot_collide_across_the_separator():
    assert prompt_cache_key(system_prompt="ab", tools="c") != prompt_cache_key(system_prompt="a", tools="bc")


def test_routing_fields_preserve_an_existing_extra_body():
    merged = with_prompt_cache_routing({"plugins": [{"id": "response-healing"}]}, "session-abc")
    assert merged["plugins"] == [{"id": "response-healing"}]
    assert merged[SESSION_ID_FIELD] == "session-abc"
    assert merged[PROMPT_CACHE_KEY_FIELD] == "session-abc"


def test_routing_never_overwrites_an_explicit_key():
    merged = with_prompt_cache_routing({SESSION_ID_FIELD: "chosen-by-the-caller"}, "session-abc")
    assert merged[SESSION_ID_FIELD] == "chosen-by-the-caller"


def test_routing_does_not_mutate_the_input():
    original = {"plugins": []}
    with_prompt_cache_routing(original, "session-abc")
    assert original == {"plugins": []}


def test_no_leading_system_message_means_no_key():
    # Nothing to pin, and a prompt with no system prefix is below every
    # provider's caching minimum anyway.
    assert prompt_cache_extra_body([HumanMessage(content="hi")], {}) is None
    assert prompt_cache_extra_body([], {}) is None


def test_one_turns_iterations_share_a_key():
    system = SystemMessage(content="You are the office colleague.")
    kwargs = {"tools": TOOLS}
    first = prompt_cache_extra_body([system, HumanMessage(content="q")], kwargs, organization_id="org_1")
    grown = [system, HumanMessage(content="q"), AIMessage(content="thinking"), HumanMessage(content="tool result")]
    second = prompt_cache_extra_body(grown, kwargs, organization_id="org_1")
    assert first[SESSION_ID_FIELD] == second[SESSION_ID_FIELD]


def test_a_narrowed_tool_set_gets_its_own_key():
    system = SystemMessage(content="You are the office colleague.")
    messages = [system, HumanMessage(content="q")]
    full = prompt_cache_extra_body(messages, {"tools": TOOLS})
    narrowed = prompt_cache_extra_body(messages, {"tools": []})
    assert full[SESSION_ID_FIELD] != narrowed[SESSION_ID_FIELD]


def test_the_envelope_response_format_is_part_of_the_key():
    # response_format sits in the cached prefix (OpenAI: "text.format … adds
    # output-format instructions and the requested schema"), so a call that
    # fell through to another rung must not claim the stronger rung's shard.
    system = SystemMessage(content="You are the office colleague.")
    messages = [system, HumanMessage(content="q")]
    strict = prompt_cache_extra_body(messages, {"response_format": {"type": "json_schema"}})
    loose = prompt_cache_extra_body(messages, {"response_format": {"type": "json_object"}})
    assert strict[SESSION_ID_FIELD] != loose[SESSION_ID_FIELD]


class TestClaudeIsAskedToCache:
    """Anthropic caches only on request; the OpenAI family caches on its own."""

    def test_only_the_opt_in_families_need_the_marker(self):
        assert needs_cache_marker("anthropic/claude-opus-5.5")
        assert needs_cache_marker("~anthropic/claude-opus-latest")
        assert not needs_cache_marker("openai/gpt-6-luna")
        assert not needs_cache_marker(None)

    def test_a_claude_call_carries_the_marker_and_the_routing_key(self):
        messages = [SystemMessage(content="You are the office colleague."), HumanMessage(content="q")]
        body = prompt_cache_extra_body(messages, {}, model="anthropic/claude-opus-5.5")
        assert body[CACHE_CONTROL_FIELD] == {"type": "ephemeral"}
        assert body[SESSION_ID_FIELD].startswith("grid-")

    def test_a_claude_call_without_a_system_prompt_still_caches(self):
        body = prompt_cache_extra_body([HumanMessage(content="hi")], {}, model="anthropic/claude-opus-5.5")
        assert body == {CACHE_CONTROL_FIELD: {"type": "ephemeral"}}

    def test_an_explicit_cache_control_wins(self):
        mine = {CACHE_CONTROL_FIELD: {"type": "ephemeral", "ttl": "1h"}}
        assert with_cache_marker(mine, "anthropic/claude-opus-5.5") == mine

    def test_other_models_are_untouched(self):
        messages = [SystemMessage(content="You are the office colleague."), HumanMessage(content="q")]
        assert CACHE_CONTROL_FIELD not in prompt_cache_extra_body(messages, {}, model="openai/gpt-6-luna")


class TestAStablePrefixKeepsTheShard:
    """An agent whose system prompt has a stable head and a per-turn tail names the head.

    Piloti's dynamic half changes every turn of one conversation (the
    already-read digest), so keying on the whole message gave each turn a new
    key and a cold static prefix. Named, the prefix is the key; unnamed, or not
    matching, the whole message still is.
    """

    STATIC = "You are Piloti. [rules, tools, schema]"

    def _body(self, tail: str):
        messages = [SystemMessage(content=self.STATIC + tail), HumanMessage(content="q")]
        return prompt_cache_extra_body(messages, {"tools": TOOLS}, organization_id="org_1")

    def test_turns_that_share_the_prefix_share_the_key(self):
        token = begin_stable_prefix(self.STATIC)
        try:
            first = self._body("\n## Context\nCurrent date: 2026-09-15\nread: nothing")
            second = self._body("\n## Context\nCurrent date: 2026-09-16\nread: OIB-2 4.1")
        finally:
            end_stable_prefix(token)
        assert first[SESSION_ID_FIELD] == second[SESSION_ID_FIELD]

    def test_unnamed_the_whole_message_is_the_key(self):
        first = self._body("\nread: nothing")
        second = self._body("\nread: OIB-2 4.1")
        assert first[SESSION_ID_FIELD] != second[SESSION_ID_FIELD]

    def test_a_prompt_that_does_not_open_with_the_prefix_is_keyed_whole(self):
        token = begin_stable_prefix("Another agent's prefix")
        try:
            named = self._body("\nread: nothing")
        finally:
            end_stable_prefix(token)
        assert named[SESSION_ID_FIELD] == self._body("\nread: nothing")[SESSION_ID_FIELD]

    def test_the_named_prefix_is_the_key_itself(self):
        token = begin_stable_prefix(self.STATIC)
        try:
            named = self._body("\nanything")
        finally:
            end_stable_prefix(token)
        bare = prompt_cache_key(system_prompt=self.STATIC, tools=(TOOLS, None), organization_id="org_1", model=None)
        assert named[PROMPT_CACHE_KEY_FIELD] == bare


class TestTheStaticSystemPromptCarriesOneBreakpoint:
    """The block marker reaches a provider that takes it, and no other.

    Writes happen only at breakpoints, so without this marker nothing is ever
    written at the end of the bytes every turn shares (``prompt_caching``,
    "one block breakpoint").
    """

    MARKED = [cached_system_message("You are the office colleague."), HumanMessage(content="Frage")]

    def test_the_helper_puts_the_marker_at_the_end_of_the_one_text_block(self):
        assert self.MARKED[0].content == [
            {"type": "text", "text": "You are the office colleague.", CACHE_CONTROL_FIELD: {"type": "ephemeral"}}
        ]

    def test_kept_for_the_families_that_take_a_block_marker(self):
        for model in ("anthropic/claude-opus-5.5", "openai/gpt-6.1-terra", "google/gemini-4-argon", "~openai/x"):
            assert strip_block_breakpoints(self.MARKED, model) is self.MARKED, model

    def test_taken_off_for_any_other_family_and_off_openrouter(self):
        for model, openrouter in (("mistralai/mistral-large-4-0", True), ("openai/gpt-6.1-terra", False)):
            stripped = strip_block_breakpoints(self.MARKED, model, openrouter=openrouter)
            assert stripped[0].content == "You are the office colleague.", model
            assert stripped[1] is self.MARKED[1]
        assert self.MARKED[0].content[0][CACHE_CONTROL_FIELD] == {"type": "ephemeral"}, "input mutated"

    def test_the_marker_does_not_re_key_a_shard(self):
        """The block form keys as its text: the move to it did not start every org cold."""
        plain = [SystemMessage(content="You are the office colleague."), HumanMessage(content="Frage")]
        model = "openai/gpt-6.1-terra"
        marked_key = prompt_cache_extra_body(self.MARKED, {}, organization_id="org_1", model=model)
        plain_key = prompt_cache_extra_body(plain, {}, organization_id="org_1", model=model)
        assert marked_key[PROMPT_CACHE_KEY_FIELD] == plain_key[PROMPT_CACHE_KEY_FIELD]


class TestTheMarkerIsOnTheWire:
    """What langchain actually sends: the request body, not our message objects."""

    def _payload(self, model: str, *, responses: bool = False) -> dict:
        from langchain_openai import ChatOpenAI

        from agent.common.llm_factory import prepare_request

        llm = ChatOpenAI(
            model=model, api_key="test", base_url="https://openrouter.ai/api/v1", use_responses_api=responses
        )
        kwargs: dict = {}
        messages = prepare_request(llm, TestTheStaticSystemPromptCarriesOneBreakpoint.MARKED, kwargs)
        return llm._get_request_payload(messages, **kwargs)

    def test_chat_completions_carries_the_block_marker_to_openrouter(self):
        system = self._payload("openai/gpt-6.1-terra")["messages"][0]
        assert system["content"][-1][CACHE_CONTROL_FIELD] == {"type": "ephemeral"}

    def test_a_family_without_block_markers_gets_the_plain_prompt(self):
        system = self._payload("mistralai/mistral-large-4-0")["messages"][0]
        assert system["content"] == "You are the office colleague."

    def test_the_responses_api_drops_it_which_is_why_the_chat_role_left_it(self):
        """Measured 2026-11-10: langchain's Responses converter keeps no per-block key.

        If this ever starts passing the marker through, the chat role could go
        back to ``api_type: responses`` without losing the breakpoint.
        """
        system = self._payload("openai/gpt-6.1-terra", responses=True)["input"][0]
        assert all(CACHE_CONTROL_FIELD not in block for block in system["content"])


def test_the_chat_role_runs_on_chat_completions():
    """The breakpoint reaches the provider only on Chat Completions (``TestTheMarkerIsOnTheWire``)."""
    from pathlib import Path

    import yaml

    root = Path(__file__).resolve().parents[4]
    config = yaml.safe_load((root / "configs" / "config_oib_openrouter.yml").read_text())
    assert config["llms"]["research_llm"].get("api_type", "chat_completion") == "chat_completion"


class TestAOneShotCallWritesNothing:
    """A call whose tail is its own writes an entry nobody reads, at 1.25x: inside ``one_shot_calls`` it writes none."""

    MESSAGES = [SystemMessage(content="Judge the answer."), HumanMessage(content="the evidence of one answer")]

    def _payload(self, model: str) -> dict:
        from langchain_openai import ChatOpenAI

        from agent.common.llm_factory import prepare_request

        llm = ChatOpenAI(model=model, api_key="test", base_url="https://openrouter.ai/api/v1")
        kwargs: dict = {}
        with one_shot_calls():
            messages = prepare_request(llm, self.MESSAGES, kwargs)
        return llm._get_request_payload(messages, **kwargs)

    def test_the_openai_family_turns_its_automatic_caching_off(self):
        payload = self._payload("openai/gpt-6.1-terra")
        assert payload["extra_body"]["prompt_cache_options"] == {"mode": "explicit"}
        assert "cache_control" not in json.dumps(payload)

    def test_claude_is_not_asked_to_cache(self):
        payload = self._payload("anthropic/claude-haiku-5.5")
        assert "cache_control" not in json.dumps(payload)
        assert "prompt_cache_options" not in json.dumps(payload)

    def test_outside_it_a_call_caches_as_before(self):
        body = prompt_cache_extra_body(self.MESSAGES, {}, model="anthropic/claude-haiku-5.5")
        assert body[CACHE_CONTROL_FIELD] == {"type": "ephemeral"}
        assert "prompt_cache_options" not in body
