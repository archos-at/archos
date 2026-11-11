"""Prompt wiring: the norm registry block reaches the deep-research prompt.

Piloti no longer renders the catalog. Its entries are RIS addresses, and
``ris_lookup`` resolves one out of the question itself (ADR-0060 (d)), so a
per-turn copy of the list below the KV-cache boundary bought the turn nothing
and cost it ~1,500 tokens. Deep research, whose researcher orchestrates RIS by
hand, still gets it — which is why the wiring is still pinned here.
"""

from pathlib import Path
from unittest.mock import MagicMock

import pytest
import yaml

from agent.agents.deep_researcher.factory import DeepResearchGraphContext
from agent.agents.deep_researcher.models import DeepResearchAgentState
from agent.common.norm_registry import ENV_NORMS_DIR
from agent.common.norm_registry import reset_registry_cache
from agent.common.prompt_utils import render_prompt_template

REPO_ROOT = Path(__file__).resolve().parents[4]
CHAT_TEMPLATE = REPO_ROOT / "packages" / "agent" / "src" / "agent" / "agents" / "piloti" / "prompts" / "piloti.j2"
DEEP_TEMPLATE = (
    REPO_ROOT / "packages" / "agent" / "src" / "agent" / "agents" / "deep_researcher" / "prompts" / "researcher.j2"
)

_HEADING = "## Normenregister (verifizierte Normen, Rang und Rolle annotiert)"

_REGISTRY = {
    "version": 1,
    "entries": [
        {
            "id": "bo-wien",
            "title": "Bauordnung für Wien",
            "short": "BO Wien",
            "rank": "state_law",
            "federal_state": "Wien",
            "topics": ["bauordnung", "bauantrag"],
            "relevance": "State building code for Vienna",
            "application": "LrKons",
            "document_number": "NOR12345678",
            "citation_url": "https://www.ris.bka.gv.at/eli/lgbl/WI/1930/11",
            "full_law_url": "https://www.ris.bka.gv.at/GeltendeFassung.wxe?Abfrage=LrW&Gesetzesnummer=1",
            "verified_at": "2026-07-16",
        }
    ],
}


@pytest.fixture(autouse=True)
def _registry_env(tmp_path, monkeypatch):
    norms_dir = tmp_path / "norms"
    country_dir = norms_dir / "at"
    country_dir.mkdir(parents=True)
    (country_dir / "registry.yml").write_text(yaml.safe_dump(_REGISTRY, allow_unicode=True), encoding="utf-8")
    monkeypatch.setenv(ENV_NORMS_DIR, str(norms_dir))
    reset_registry_cache()
    yield norms_dir
    reset_registry_cache()


def _render_template(template_path: Path, ris_catalog) -> str:
    return render_prompt_template(
        template_path.read_text(encoding="utf-8"),
        static_block="",
        current_datetime="2026-07-16",
        user_info=None,
        tools=[],
        available_documents=[],
        project_context=None,
        execution_enabled=False,
        ris_catalog=ris_catalog,
    )


def test_the_deep_template_renders_the_registry_block_when_present():
    rendered = _render_template(DEEP_TEMPLATE, "- BO Wien — Bauordnung für Wien [LrKons/NOR12345678]")

    assert _HEADING in rendered
    assert "BO Wien" in rendered


def test_the_deep_template_omits_the_registry_block_when_absent():
    rendered = _render_template(DEEP_TEMPLATE, None)

    assert _HEADING not in rendered


def test_chat_carries_no_catalog_variable_at_all():
    """Not "renders empty": the variable is gone from the template, so a
    caller cannot reintroduce 1,500 tokens by passing one."""
    source = CHAT_TEMPLATE.read_text(encoding="utf-8")

    assert "ris_catalog" not in source
    assert _HEADING not in source


def _graph_context(prompts: dict[str, str], project_context: str | None = None) -> DeepResearchGraphContext:
    return DeepResearchGraphContext(
        llm_provider=MagicMock(),
        state=DeepResearchAgentState(messages=[], project_context=project_context),
        prompts=prompts,
        tools=[],
        runtime=MagicMock(),
        tool_set=MagicMock(),
        middleware_set=MagicMock(),
        domain_catalog_path=None,
        current_datetime="2026-07-16",
        max_research_concurrency=1,
        enable_source_router=False,
        backend=MagicMock(),
        visibility_middleware=[],
    )


@pytest.fixture
def austria_core():
    from agent.common.knowledge_context import KnowledgeContext
    from agent.common.knowledge_context import set_turn_knowledge_context

    set_turn_knowledge_context(KnowledgeContext(gate="core", site_country="AT", retrieval_countries=frozenset({"AT"})))
    yield
    set_turn_knowledge_context(None)


def test_deep_render_prompt_passes_registry_block(austria_core):
    context = _graph_context({"researcher": "{% if ris_catalog %}RIS-BLOCK\n{{ ris_catalog }}{% endif %}"})

    rendered = context.render_prompt("researcher")

    assert "RIS-BLOCK" in rendered
    assert "BO Wien" in rendered
    assert "NOR12345678" in rendered


def test_without_a_context_that_allows_ris_the_catalogue_is_withheld():
    """ADR-0175: no knowledge context bound, no RIS tool, and no RIS addresses either."""
    context = _graph_context({"researcher": "{% if ris_catalog %}RIS-BLOCK{% else %}no-catalog{% endif %}"})

    assert context.render_prompt("researcher") == "no-catalog"


def test_deep_render_prompt_registry_block_empty_when_registry_missing(monkeypatch, tmp_path, austria_core):
    monkeypatch.setenv(ENV_NORMS_DIR, str(tmp_path / "empty-norms"))
    reset_registry_cache()
    context = _graph_context({"researcher": "{% if ris_catalog %}RIS-BLOCK{% else %}no-catalog{% endif %}"})

    rendered = context.render_prompt("researcher")

    assert rendered == "no-catalog"


_PROBE = "Bauherr sitzt in der Wiener Straße, Grundstück in Linz"


@pytest.fixture
def two_lands(_registry_env):
    """The registry with Linz's Land beside Vienna's."""
    registry = {**_REGISTRY, "entries": [*_REGISTRY["entries"], {**_REGISTRY["entries"][0], "id": "bo-ooe"}]}
    registry["entries"][1].update(short="OÖ BauO", title="Oö. Bauordnung 1994", federal_state="Oberösterreich")
    (_registry_env / "at" / "registry.yml").write_text(yaml.safe_dump(registry, allow_unicode=True), encoding="utf-8")
    reset_registry_cache()


def _catalog_with(gate: str, chains: dict) -> str:
    from agent.common.knowledge_context import KnowledgeContext
    from agent.common.knowledge_context import set_turn_knowledge_context

    set_turn_knowledge_context(
        KnowledgeContext(gate=gate, site_country="AT", retrieval_countries=frozenset({"AT"}), chains=chains)
    )
    try:
        return _graph_context({"researcher": "{{ ris_catalog }}"}, project_context=_PROBE).render_prompt("researcher")
    finally:
        set_turn_knowledge_context(None)


def test_with_no_site_every_land_renders_and_the_project_text_decides_nothing(two_lands):
    """Review of #1582: under ``site_unknown`` the text "Wiener Straße … Linz" narrowed the catalogue to Wien
    and dropped Oberösterreich. With no site in the context, every Land's lane renders (ADR-0175)."""
    rendered = _catalog_with("site_unknown", {})
    assert "BO Wien" in rendered and "OÖ BauO" in rendered


def test_the_site_s_land_comes_from_the_context_s_leaf(two_lands):
    rendered = _catalog_with("core", {"AT-4": ("AT-4", "AT", "EU")})
    assert "OÖ BauO" in rendered and "BO Wien" not in rendered


def test_a_site_placed_by_its_municipality_still_narrows_to_its_land(two_lands):
    """Review of #1582: the BFF's leaf is the register municipality first, so the Land is found down the chain."""
    rendered = _catalog_with("core", {"AT:gkz:40101": ("AT:gkz:40101", "AT-4", "AT", "EU")})
    assert "OÖ BauO" in rendered and "BO Wien" not in rendered
