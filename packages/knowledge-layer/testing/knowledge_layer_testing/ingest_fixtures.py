"""An ingest in a test hands no memory back to the OS after a file.

``knowledge_layer.ingest.adapter._release_memory`` runs a full ``gc.collect()``
and ``malloc_trim`` after every file, which a worker needs and a test does not:
in a suite process the collector walks every module the suite has loaded, about
0.28 s a call, and some 200 end-to-end ingest tests each paid it two or three
times. With a Qdrant server the core suite took 203 s on four cores with it and
101 s without (2026-11-11). Imports nothing heavy, for a conftest every test
loads; a test of the release itself overrides the fixture
(``tests/knowledge_layer_tests/test_text_pass_memory.py``).
"""

from __future__ import annotations

import sys

import pytest


@pytest.fixture(autouse=True)
def _no_memory_release_between_files(monkeypatch) -> None:
    # Only an adapter some import already loaded can be asked to release anything.
    adapter = sys.modules.get("knowledge_layer.ingest.adapter")
    if adapter is not None:
        monkeypatch.setattr(adapter, "_release_memory", lambda file_name: None)
