from __future__ import annotations

import sys

import pytest


@pytest.fixture(autouse=True)
def _no_memory_release_between_files(monkeypatch) -> None:
    memory_use = sys.modules.get("knowledge_layer.ingest.memory_use")
    if memory_use is not None:
        monkeypatch.setattr(memory_use, "_release_memory", lambda file_name: None)
