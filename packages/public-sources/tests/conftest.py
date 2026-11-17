import pytest
from public_sources import pdf as _pdf


@pytest.fixture(autouse=True)
def _parse_pdfs_here(monkeypatch):
    monkeypatch.setattr(_pdf, "_parse_here", True)
