from agent.knowledge.base import _delete_each


def _boom() -> bool:
    raise RuntimeError("store down")


def test_two_namesakes_are_told_apart_by_their_ids():
    outcome = _delete_each(
        [("Plan.pdf", "doc-eg", lambda: True), ("Plan.pdf", "doc-og", lambda: False), ("Plan.pdf", "doc-x", _boom)]
    )

    assert outcome["successful"] == ["Plan.pdf"] and outcome["not_found"] == ["Plan.pdf"]
    assert outcome["documents"] == {"successful": ["doc-eg"], "not_found": ["doc-og"], "failed": ["doc-x"]}
    assert outcome["failed"] == [{"file_id": "Plan.pdf", "error": "store down", "document_id": "doc-x"}]


def test_a_delete_by_file_ids_answers_as_before():
    outcome = _delete_each([("plan.pdf", None, lambda: True)])

    assert outcome["successful"] == ["plan.pdf"]
    assert "documents" not in outcome
