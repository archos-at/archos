from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import pytest


@pytest.fixture
def qdrant_store(monkeypatch, request) -> Iterator[Any]:
    from knowledge_layer_testing import vector_store as qdrant_testing

    yield from qdrant_testing.shared_store(monkeypatch, request)


@pytest.fixture
def fresh_qdrant_store(monkeypatch) -> Iterator[Any]:
    from knowledge_layer_testing import vector_store as qdrant_testing

    yield from qdrant_testing.fresh_store(monkeypatch)
