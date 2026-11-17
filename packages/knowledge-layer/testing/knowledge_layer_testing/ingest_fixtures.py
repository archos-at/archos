from __future__ import annotations

import sys

import pytest


@pytest.fixture(autouse=True)
def _no_memory_release_between_files(monkeypatch) -> None:
    adapter = sys.modules.get("knowledge_layer.ingest.adapter")
    if adapter is not None:
        monkeypatch.setattr(adapter, "_release_memory", lambda file_name: None)
