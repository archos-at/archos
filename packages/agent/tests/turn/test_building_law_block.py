"""The ``<building_law>`` block belongs to the turn, not to every turn (ADR-0168, defect 6).

While the static prompt still holds the block, nothing is added. Once it does
not, an Austrian site reads the same block in its turn context, a site the
records resolved reads their chain text before the same doctrine, and any
other site, or none, reads no block. The byte-for-byte checks against the
static prompt and the rendered turn context sit beside the static prompt's
own tests (``test_static_prompt_split.py``, ``test_turn_context_message.py``).
"""

from __future__ import annotations

from agent.turn.building_law import BUILDING_LAW_TAG
from agent.turn.building_law import building_law_block
from agent.turn.building_law import bundled_building_law
from agent.turn.building_law import with_chain

VIENNA = "PROJECT_CONTEXT v1\n\nconfirmed:\n- federal_state=vienna\n"
MUNICH = "PROJECT_CONTEXT v1\n\nconfirmed:\n- country=de\n"
UNPLACED = "PROJECT_CONTEXT v1\n\nconfirmed:\n- main_use=residential\n"
WITH_BLOCK = f"<role>…</role>\n\n{BUILDING_LAW_TAG}\n…\n</building_law>"
NEUTRAL = "<role>a static prompt without the block</role>"
CHAIN = "Building law at this site, Steiermark (AT-6, AT, EU), on 2026-11-10, from the platform's reviewed records."


def test_nothing_is_added_while_the_static_prompt_holds_the_block():
    assert building_law_block(WITH_BLOCK, VIENNA, CHAIN) is None
    assert building_law_block(WITH_BLOCK, MUNICH, None) is None


def test_an_austrian_site_reads_the_bundled_block():
    assert building_law_block(NEUTRAL, VIENNA, None) == bundled_building_law()


def test_defect_6_a_german_site_an_unplaced_project_or_no_project_reads_no_block():
    assert building_law_block(NEUTRAL, MUNICH, None) is None
    assert building_law_block(NEUTRAL, UNPLACED, None) is None
    assert building_law_block(NEUTRAL, None, None) is None


def test_the_records_chain_replaces_the_opening_paragraph_and_keeps_the_doctrine():
    block = building_law_block(NEUTRAL, VIENNA, CHAIN)
    assert block is not None
    bundled = bundled_building_law()
    assert block.startswith(f"{BUILDING_LAW_TAG}\n{CHAIN}\n- The edition and the Land decide the number.")
    assert block.endswith("</building_law>")
    assert "Austrian building law is a chain" not in block
    assert block.split("\n- ", 1)[1] == bundled.split("\n- ", 1)[1]


def test_the_records_chain_applies_to_a_site_the_records_resolved_whatever_the_profile_says():
    # The BFF resolved the chain from the project's own Land; the block follows it.
    assert building_law_block(NEUTRAL, MUNICH, CHAIN) == with_chain(bundled_building_law(), CHAIN)
