"""The website claims a country's law only as far as its pack's coverage goes (ADR-0173, design §1.3)."""

from __future__ import annotations

import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
_spec = importlib.util.spec_from_file_location("check_coverage_copy", ROOT / "scripts" / "check_coverage_copy.py")
assert _spec and _spec.loader
check = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(check)


def test_the_committed_copy_is_what_the_packs_coverage_gives():
    assert check.main([]) == 0


def test_austria_at_core_is_claimed_and_the_other_markets_are_not():
    copy = check.render({"AT": "core"})
    assert "decken heute Österreich ab" in copy
    assert "itemKey: 'Deutschland und Schweiz'" in copy


def test_a_pack_that_states_no_coverage_claims_nothing():
    copy = check.render({})
    assert "noch kein Land" in copy and "no country yet" in copy
    assert "decken heute Österreich" not in copy


def test_a_country_at_open_is_claimed_once_its_pack_says_so():
    copy = check.render({"AT": "core", "DE": "open"})
    assert "decken heute Österreich und Deutschland ab" in copy
    assert "itemKey: 'Schweiz'" in copy


def test_a_hand_written_claim_about_another_country_is_found():
    page = "/** header Germany */\nconst de = { x: 'Wir decken Deutschland ab.' }\n"
    assert check.hand_written_claims(page) == ["const de = { x: 'Wir decken Deutschland ab.' }"]
    assert check.hand_written_claims("/** Germany */\nconst de = { x: coverageCopy.de.itemKey }\n") == []
