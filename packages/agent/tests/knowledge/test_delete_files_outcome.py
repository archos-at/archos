"""What a batch delete reports (``BaseIngestor.delete_files``): a file with
nothing indexed is ``not_found``, which leaves nothing behind; only a delete
that raised is ``failed``, so the BFF can tell a confirmed purge from one whose
points may remain (``purgeIngestedChunks``)."""

from __future__ import annotations

from types import SimpleNamespace

from agent.knowledge.base import BaseIngestor


def _ingestor(outcomes: dict[str, bool | Exception]) -> SimpleNamespace:
    def delete_file(file_id: str, _collection: str, *, permanent: bool = False) -> bool:
        outcome = outcomes[file_id]
        if isinstance(outcome, Exception):
            raise outcome
        return outcome

    return SimpleNamespace(delete_file=delete_file)


def test_a_file_with_nothing_indexed_is_not_found_and_not_failed():
    result = BaseIngestor.delete_files(_ingestor({"a.pdf": True, "b.pdf": False}), ["a.pdf", "b.pdf"], "c")

    assert result["successful"] == ["a.pdf"]
    assert result["not_found"] == ["b.pdf"]
    assert result["failed"] == []


def test_a_delete_that_raised_is_failed():
    result = BaseIngestor.delete_files(_ingestor({"a.pdf": RuntimeError("qdrant down")}), ["a.pdf"], "c")

    assert result["failed"] == [{"file_id": "a.pdf", "error": "qdrant down"}]
    assert result["total_deleted"] == 0
