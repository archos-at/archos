from __future__ import annotations

import json
from pathlib import Path

from knowledge_layer.vector_store import LICENCE_CLASSES

FIXTURE = Path(__file__).resolve().parents[3] / "apps/workspace/tests/fixtures/base-knowledge.schema.json"


def test_the_points_licence_classes_are_the_records_own():
    defs = json.loads(FIXTURE.read_text(encoding="utf-8"))["$defs"]
    assert sorted(LICENCE_CLASSES) == sorted(defs["knowledge_manifestation_revisions.licence_class"]["enum"])
