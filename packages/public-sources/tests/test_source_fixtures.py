"""Every source record in ``configs/sources`` is valid and passes its recorded fixtures.

This is the gate "a source is validated by a fixture test before it is used":
a record that does not parse, names a host its URLs are not on, or whose
fixtures fail, fails here on every commit. Recorded responses only, no live call.
"""

from __future__ import annotations

import pytest
from public_sources import load_sources
from public_sources.fixtures import run_source
from public_sources_testing import SOURCES_DIR

SOURCES = load_sources(SOURCES_DIR)


def test_austria_and_a_second_country_are_configured():
    assert {"at-ris", "ch-fedlex"} <= set(SOURCES)


@pytest.mark.parametrize("source_id", sorted(SOURCES))
async def test_the_record_passes_its_fixtures(source_id):
    results = await run_source(SOURCES[source_id])
    assert results, f"{source_id} has no fixtures"
    failures = {r.fixture: r.failures for r in results if not r.ok}
    assert not failures, failures


@pytest.mark.parametrize("source_id", sorted(SOURCES))
def test_the_record_lives_under_its_territory(source_id):
    source = SOURCES[source_id]
    assert source.directory.parent.name == source.territory.split("-")[0].lower()
    assert source.id.startswith(source.directory.parent.name + "-")
