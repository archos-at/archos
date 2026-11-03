"""A PDF version's parsed document is stored once and read back on a retry (``parsed_store``).

The proof that matters: a run served from the stored artefact produces the same
pages, triage and tables as a fresh run of the passes, and does not run them.
Offline: an in-memory object store behind the presign seam.
"""

from __future__ import annotations

import json
from types import SimpleNamespace

import pytest
from knowledge_layer.ingest import adapter
from knowledge_layer.ingest import page_triage
from knowledge_layer.ingest import parsed_store
from knowledge_layer.ingest.captioned_tables import PageTable
from knowledge_layer.ingest.chunk_identity import file_version

from .test_ingest_screen_before_tables import _ingest
from .test_ingest_screen_before_tables import calls  # noqa: F401 - fixtures, shared with the harness
from .test_ingest_screen_before_tables import store  # noqa: F401
from .test_ingest_screen_before_tables import summary_db  # noqa: F401
from .test_upload_screening_ingestion import _pdf_with_table_page


class _ObjectStore:
    """The BFF's presign and SeaweedFS, in memory: one key per (document, part)."""

    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}
        self.puts = 0

    def presign(self, document_id, collection, part, organization_id):
        key = f"org/doc/{document_id}/v1/_text/{part}"
        return SimpleNamespace(upload_url=key, storage_key=key, storage_bucket="docs")

    def fetch(self, bucket, key):
        return self.objects.get(key)

    def upload(self, url, body, content_type):
        self.puts += 1
        self.objects[url] = body


@pytest.fixture
def objects():
    return _ObjectStore()


def _parsed_store(objects: _ObjectStore) -> parsed_store.ParsedStore:
    return parsed_store.ParsedStore(
        "doc-1", "proj_1", "org_1", presign=objects.presign, fetch=objects.fetch, upload=objects.upload
    )


def _run(path: str, objects: _ObjectStore):
    """The pass as the pipeline runs it: text, triage, tables, then the save after the screen."""
    with parsed_store.file_parse(_parsed_store(objects), file_version(path)) as parse:
        text_pages = parse.text_pages(path)
        page_texts = adapter.page_texts_for_visual_heuristic(text_pages)
        triage = parse.triage(path, page_texts, min_text_chars=200, min_paths=300)
        taken = {page["page_number"]: page.get("table_boxes") or [] for page in text_pages}
        tables = parse.tables(path, taken, list(text_pages.dense_pages))
        parse.save()
        return text_pages, triage, tables, parse


def _passes(monkeypatch) -> dict[str, int]:
    ran = {"text": 0, "triage": 0, "tables": 0}
    for name, attr, module in (
        ("text", "_extract_text_from_pdf", adapter),
        ("tables", "_extract_tables_from_pdf", adapter),
        ("triage", "triage_pdf", page_triage),
    ):
        real = getattr(module, attr)

        def counted(*args, _real=real, _name=name, **kwargs):
            ran[_name] += 1
            return _real(*args, **kwargs)

        monkeypatch.setattr(module, attr, counted)
    return ran


def test_a_retry_reads_back_the_same_pages_triage_and_tables_without_the_passes(tmp_path, monkeypatch, objects):
    path = str(_pdf_with_table_page(tmp_path, monkeypatch, [["Raum", "Fläche"], ["Küche", "12,5"], ["Bad", "4,0"]]))
    ran = _passes(monkeypatch)

    fresh_pages, fresh_triage, fresh_tables, first = _run(path, objects)
    assert ran == {"text": 1, "triage": 1, "tables": 1} and objects.puts == 1 and not first.parsed.read_back

    cached_pages, cached_triage, cached_tables, second = _run(path, objects)

    assert ran == {"text": 1, "triage": 1, "tables": 1}, "a read-back run parses nothing"
    assert second.parsed.read_back and objects.puts == 1, "nothing new to store"
    assert list(cached_pages) == list(fresh_pages)
    assert type(cached_pages) is type(fresh_pages)
    for attr in ("failed_pages", "page_count", "dense_pages"):
        assert getattr(cached_pages, attr) == getattr(fresh_pages, attr)
    assert cached_triage == fresh_triage
    assert cached_tables == fresh_tables and fresh_tables, "the ruled table was read"
    assert adapter.page_texts_for_visual_heuristic(cached_pages) == adapter.page_texts_for_visual_heuristic(fresh_pages)


def test_the_codec_keeps_tuples_and_captioned_tables_exact():
    pages = adapter.PdfTextPages(
        [
            {
                "page_number": 3,
                "text": "Tabelle 2 – Flächen",
                "tables": [PageTable("2", "Flächen", [["Raum", "m²"], ["Küche", "12,5"]], 3, continuation=False)],
                "table_boxes": [(50.0, 100.25, 545.5, 300.0)],
                "line_styles": [["Tabelle 2", 12.0, 0.5]],
                "image_count": 0,
            }
        ],
        failed_pages=[5],
        page_count=6,
        dense_pages=[4],
    )
    round_trip = parsed_store.decode_text_pages(json.loads(json.dumps(parsed_store.encode_text_pages(pages))))

    assert list(round_trip) == list(pages)
    assert isinstance(round_trip[0]["table_boxes"][0], tuple)
    assert (round_trip.failed_pages, round_trip.page_count, round_trip.dense_pages) == ([5], 6, [4])


def test_another_version_or_pipeline_is_parsed_afresh(tmp_path, monkeypatch, objects):
    path = str(_pdf_with_table_page(tmp_path, monkeypatch, [["A", "B"], ["1", "2"]]))
    _run(path, objects)

    assert _parsed_store(objects).load(file_version(path)) is not None
    assert _parsed_store(objects).load("0" * 64) is None, "another version's bytes"
    monkeypatch.setattr(parsed_store, "_PIPELINE", "a-later-pipeline")
    assert _parsed_store(objects).load(file_version(path)) is None, "a code change"


def test_a_table_pass_is_reused_only_for_the_same_skipped_pages(tmp_path, monkeypatch, objects):
    path = str(_pdf_with_table_page(tmp_path, monkeypatch, [["A", "B"], ["1", "2"]]))
    _run(path, objects)
    ran = _passes(monkeypatch)

    with parsed_store.file_parse(_parsed_store(objects), file_version(path)) as parse:
        parse.tables(path, {}, [2])

    assert ran["tables"] == 1


def test_an_artefact_over_the_bound_is_refused_and_logged(tmp_path, monkeypatch, objects, caplog):
    path = str(_pdf_with_table_page(tmp_path, monkeypatch, [["A", "B"], ["1", "2"]]))
    monkeypatch.setattr(parsed_store, "PARSED_MAX_BYTES", 64)

    _run(path, objects)

    assert objects.puts == 0
    assert "over INGEST_PARSED_MAX_BYTES" in caplog.text


def test_without_a_document_id_nothing_is_read_or_stored(tmp_path, monkeypatch, objects):
    path = str(_pdf_with_table_page(tmp_path, monkeypatch, [["A", "B"], ["1", "2"]]))
    inert = parsed_store.ParsedStore(None, "proj_1", None, presign=objects.presign, upload=objects.upload)

    with parsed_store.file_parse(inert, file_version(path)) as parse:
        parse.text_pages(path)
        assert parse.save() is False
    assert objects.puts == 0


def test_a_store_that_fails_costs_the_artefact_not_the_file(tmp_path, monkeypatch):
    path = str(_pdf_with_table_page(tmp_path, monkeypatch, [["A", "B"], ["1", "2"]]))

    def broken(*args, **kwargs):
        raise ConnectionError("seaweedfs away")

    failing = parsed_store.ParsedStore("doc-1", "proj_1", None, presign=broken, fetch=broken, upload=broken)
    with parsed_store.file_parse(failing, file_version(path)) as parse:
        pages = parse.text_pages(path)
        assert parse.save() is False
    assert len(pages) == 5


class TestThroughTheIngest:
    """`_ingest_job` itself, on the offline harness: the second attempt of one version parses nothing."""

    def test_a_retry_skips_the_passes_and_writes_the_same_chunks(self, tmp_path, calls, monkeypatch, objects):  # noqa: F811
        from knowledge_layer.ingest import page_text_store
        from knowledge_layer.vector_store import writes

        monkeypatch.setattr(page_text_store, "request_slot", objects.presign)
        monkeypatch.setattr(page_text_store, "put_part", objects.upload)
        monkeypatch.setattr(parsed_store, "_fetch", objects.fetch)
        written: list[list[tuple[str, str]]] = []
        monkeypatch.setattr(
            writes,
            "write_chunks",
            lambda scope, name, records, **k: written.append([(r.chunk_id, r.text) for r in records]),
        )
        path = _pdf_with_table_page(tmp_path, monkeypatch, [["Raum", "Fläche"], ["Küche", "12,5"], ["Bad", "4,0"]])
        ran = _passes(monkeypatch)
        document = "0b9c4f1e-1c1a-4f7e-9f55-1d2b3c4d5e6f"

        first = _ingest(calls, path, "Liste.pdf", None, document_id=document)
        assert ran["text"] == 1 and ran["tables"] == 1
        assert "org/doc/" + document + "/v1/_text/parsed.json" in objects.objects
        second = _ingest(calls, path, "Liste.pdf", None, document_id=document)

        assert first.status.value == second.status.value == "success"
        assert ran["text"] == 1 and ran["tables"] == 1, "the retry read the parsed document back"
        assert written[0] == written[1] and written[0]
