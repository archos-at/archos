"""Fixtures for the public-sources suite; helpers live in ``public_sources_testing``."""

import pytest
from public_sources import pdf as _pdf


@pytest.fixture(autouse=True)
def _parse_pdfs_here(monkeypatch):
    """The suite runs without a fetcher, so a PDF is parsed in the test's process (as the fixture runner does)."""
    monkeypatch.setattr(_pdf, "_parse_here", True)
