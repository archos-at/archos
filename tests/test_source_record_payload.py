"""The source records an operator proposes through the door are the repository records they are made from.

``scripts/source_record_payload.py`` writes them; a stale payload would put a
record on the platform that differs from the one the image reads while both exist.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

_SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "source_record_payload.py"


def _module():
    spec = importlib.util.spec_from_file_location("source_record_payload", _SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_every_payload_is_the_record_it_is_made_from():
    assert _module().main(["--check"]) == 0


def test_a_payload_takes_a_key_no_repository_record_has():
    from public_sources.source import load_sources

    keys = {key for _source, key, _target in _module().PAYLOADS}
    assert keys.isdisjoint(load_sources())
