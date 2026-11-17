from unittest.mock import MagicMock

import pytest

from agent.common.llm_provider import LLMProvider
from agent.common.llm_provider import LLMRole


class TestLLMRole:
    def test_llm_role_values(self):
        assert LLMRole.ROUTER == "router"
        assert LLMRole.PLANNER == "planner"
        assert LLMRole.RESEARCHER == "researcher"
        assert LLMRole.EVIDENCE_JUDGE == "evidence_judge"
        assert LLMRole.GRADER == "grader"
        assert LLMRole.SUMMARIZER == "summarizer"
        assert LLMRole.ORCHESTRATOR == "orchestrator"
        assert LLMRole.REFLECTION == "reflection"
        assert LLMRole.CLARIFIER == "clarifier"
        assert LLMRole.META_CHATTER == "meta_chatter"
        assert LLMRole.REPORT_WRITER == "report_writer"

    def test_llm_role_is_string_enum(self):
        assert isinstance(LLMRole.ROUTER, str)
        assert str(LLMRole.ROUTER) == "router"


class TestLLMProvider:
    def test_init_empty_provider(self):
        provider = LLMProvider()
        assert provider.configured_roles() == []

    def test_set_default(self):
        provider = LLMProvider()
        mock_llm = MagicMock()
        provider.set_default(mock_llm)

        assert provider.get(LLMRole.ROUTER) is mock_llm
        assert provider.get(LLMRole.PLANNER) is mock_llm

    def test_configure_specific_role(self):
        provider = LLMProvider()
        default_llm = MagicMock(name="default")
        router_llm = MagicMock(name="router")

        provider.set_default(default_llm)
        provider.configure(LLMRole.ROUTER, router_llm)

        assert provider.get(LLMRole.ROUTER) is router_llm
        assert provider.get(LLMRole.PLANNER) is default_llm

    def test_get_without_default_raises_error(self):
        provider = LLMProvider()

        with pytest.raises(ValueError) as exc_info:
            provider.get(LLMRole.ROUTER)

        assert "No LLM configured for role 'router'" in str(exc_info.value)
        assert "Call set_default() or configure() first" in str(exc_info.value)

    def test_get_with_only_role_configured(self):
        provider = LLMProvider()
        router_llm = MagicMock(name="router")
        provider.configure(LLMRole.ROUTER, router_llm)

        assert provider.get(LLMRole.ROUTER) is router_llm

        with pytest.raises(ValueError):
            provider.get(LLMRole.PLANNER)

    def test_has_role_true(self):
        provider = LLMProvider()
        mock_llm = MagicMock()
        provider.configure(LLMRole.RESEARCHER, mock_llm)

        assert provider.has_role(LLMRole.RESEARCHER) is True

    def test_has_role_false(self):
        provider = LLMProvider()
        assert provider.has_role(LLMRole.RESEARCHER) is False

    def test_has_role_false_even_with_default(self):
        provider = LLMProvider()
        provider.set_default(MagicMock())

        assert provider.has_role(LLMRole.RESEARCHER) is False

    def test_configured_roles_returns_only_explicit(self):
        provider = LLMProvider()
        provider.set_default(MagicMock())
        provider.configure(LLMRole.ROUTER, MagicMock())
        provider.configure(LLMRole.PLANNER, MagicMock())

        roles = provider.configured_roles()
        assert LLMRole.ROUTER in roles
        assert LLMRole.PLANNER in roles
        assert len(roles) == 2

    def test_configure_overwrites_previous(self):
        provider = LLMProvider()
        llm1 = MagicMock(name="llm1")
        llm2 = MagicMock(name="llm2")

        provider.configure(LLMRole.ROUTER, llm1)
        assert provider.get(LLMRole.ROUTER) is llm1

        provider.configure(LLMRole.ROUTER, llm2)
        assert provider.get(LLMRole.ROUTER) is llm2

    def test_set_default_overwrites_previous(self):
        provider = LLMProvider()
        default1 = MagicMock(name="default1")
        default2 = MagicMock(name="default2")

        provider.set_default(default1)
        assert provider.get(LLMRole.ROUTER) is default1

        provider.set_default(default2)
        assert provider.get(LLMRole.ROUTER) is default2

    def test_multiple_roles_configured(self):
        provider = LLMProvider()
        default_llm = MagicMock(name="default")
        router_llm = MagicMock(name="router")
        planner_llm = MagicMock(name="planner")
        researcher_llm = MagicMock(name="researcher")

        provider.set_default(default_llm)
        provider.configure(LLMRole.ROUTER, router_llm)
        provider.configure(LLMRole.PLANNER, planner_llm)
        provider.configure(LLMRole.RESEARCHER, researcher_llm)

        assert provider.get(LLMRole.ROUTER) is router_llm
        assert provider.get(LLMRole.PLANNER) is planner_llm
        assert provider.get(LLMRole.RESEARCHER) is researcher_llm
        assert provider.get(LLMRole.GRADER) is default_llm  # Falls back to default
        assert provider.get(LLMRole.SUMMARIZER) is default_llm  # Falls back to default


class TestProviderWithZdr:
    def test_zdr_off_is_identity(self):
        provider = LLMProvider()
        provider.set_default(MagicMock(name="default"))
        assert provider.with_zdr(False) is provider

    def test_zdr_on_rebuilds_all_llms_via_apply_zdr_routing(self, monkeypatch):
        import agent.common.model_overrides as M

        wrapped = {}

        def fake_apply(llm):
            marker = MagicMock(name=f"zdr({llm._mock_name})")
            wrapped[llm] = marker
            return marker

        monkeypatch.setattr(M, "apply_zdr_routing", fake_apply)

        provider = LLMProvider()
        default_llm = MagicMock(name="default")
        router_llm = MagicMock(name="router")
        provider.set_default(default_llm)
        provider.configure(LLMRole.ROUTER, router_llm)

        derived = provider.with_zdr(True)
        assert derived is not provider
        assert derived.get(LLMRole.ROUTER) is wrapped[router_llm]
        assert derived.get(LLMRole.PLANNER) is wrapped[default_llm]
        assert provider.get(LLMRole.ROUTER) is router_llm

    def test_shared_instances_deduped(self, monkeypatch):
        import agent.common.model_overrides as M

        calls = []

        def fake_apply(llm):
            calls.append(llm)
            return MagicMock(name="zdr")

        monkeypatch.setattr(M, "apply_zdr_routing", fake_apply)

        shared = MagicMock(name="shared")
        provider = LLMProvider()
        provider.set_default(shared)
        provider.configure(LLMRole.ROUTER, shared)
        provider.with_zdr(True)
        assert calls.count(shared) == 1
