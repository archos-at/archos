"""What a web search may hand on as a source about law (ADR-0175, staging QC run 1 F1 and run 2 #1)."""

from __future__ import annotations

import pytest

from agent.common.norm_registry import NormFamily
from agent.common.web_sources import WEB_RESULT_NOTE
from agent.common.web_sources import held_norm_copy
from agent.common.web_sources import is_product_site
from agent.common.web_sources import preamble
from agent.common.web_sources import screen
from agent.knowledge.inventory import set_norm_families


@pytest.fixture(autouse=True)
def _no_families():
    set_norm_families(None)
    yield
    set_norm_families(None)


@pytest.mark.parametrize(
    ("url", "title"),
    [
        ("https://www.oib.or.at/sites/default/files/richtlinien/2023/oib-rl_2_ausgabe_mai_2023.pdf", None),
        ("https://www.propellets.at/media/OIB-RL_2_2023.pdf", "Brandschutz"),
        ("https://example.org/download/file123.pdf", "OIB-Richtlinie 2.2 Garagen"),
    ],
)
def test_a_web_pdf_of_an_oib_guideline_is_a_copy_of_a_held_norm(url, title):
    assert held_norm_copy(url, title) is not None


def test_a_web_page_about_a_guideline_is_not_a_copy_of_it():
    assert held_norm_copy("https://example.org/oib-rl-2-erklaert", "OIB-Richtlinie 2 erklärt") is None


def test_only_a_family_the_base_shelf_holds_counts_once_the_inventory_names_them():
    set_norm_families([NormFamily(key="3", members=("3",), files=("oib-rl_3_ausgabe_mai_2023.pdf",))])
    assert held_norm_copy("https://x.example/OIB-RL_2_2023.pdf", None) is None
    assert held_norm_copy("https://x.example/OIB-RL_3_2023.pdf", None) == "OIB-Richtlinie 3"


@pytest.mark.parametrize(
    "url", ["https://archos.tech/glossar", "https://www.archos.tech/x", "https://piloti.at/glossar"]
)
def test_the_product_s_own_domains_current_and_former_are_its_site(url):
    assert is_product_site(url)


def test_a_lookalike_host_is_not_the_product_s_site():
    assert not is_product_site("https://notarchos.tech/x")


def test_screen_keeps_the_rest_and_the_preamble_names_reasons_never_addresses():
    kept, withheld = screen(
        [
            {"url": "https://www.propellets.at/OIB-RL_2.pdf", "title": "OIB"},
            {"url": "https://archos.tech/glossar", "title": "Glossar"},
            {"url": "https://example.org/a", "title": "A"},
        ]
    )
    assert [doc["url"] for doc in kept] == ["https://example.org/a"]
    text = preamble(withheld)
    assert text.startswith(WEB_RESULT_NOTE)
    assert "propellets" not in text and "archos.tech" not in text
    assert text.count("Not shown:") == 2
