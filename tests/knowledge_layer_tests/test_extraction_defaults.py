from __future__ import annotations

import time

import pytest
from knowledge_layer.ingest import COVERAGE_KEY
from knowledge_layer.ingest import STAGE_SECONDS_KEY
from knowledge_layer.ingest import LlamaIndexIngestor
from knowledge_layer.ingest import adapter
from knowledge_layer.ingest import caption_documents
from knowledge_layer.ingest import limits
from knowledge_layer.ingest import pdf_rasters
from knowledge_layer.ingest import pdf_tables
from knowledge_layer.ingest import pdf_text
from knowledge_layer.ingest import vision_credentials
from knowledge_layer.ingest import vision_reads
from knowledge_layer_testing.vector_store import FakeEmbedder
from knowledge_layer_testing.vector_store import capture_indexed_documents

from agent.common.credential_resolution import ResolvedCredential


def _counters(metadata: dict) -> dict:
    return {k: v for k, v in metadata.items() if k not in (STAGE_SECONDS_KEY, COVERAGE_KEY)}


_SWITCHES = ("EXTRACT_TABLES", "EXTRACT_IMAGES", "EXTRACT_CHARTS")


@pytest.mark.parametrize("name", _SWITCHES)
def test_unset_switch_is_on(monkeypatch, name):
    monkeypatch.delenv(name, raising=False)
    assert adapter.env_switch(name) is True


@pytest.mark.parametrize("value", ["", "true", "1", "yes", "TRUE", "garbage"])
def test_anything_but_an_off_value_leaves_it_on(monkeypatch, value):
    monkeypatch.setenv("EXTRACT_TABLES", value)
    assert adapter.env_switch("EXTRACT_TABLES") is True


@pytest.mark.parametrize("value", ["false", "FALSE", "0", "no", "off", " False "])
def test_off_values_switch_it_off(monkeypatch, value):
    monkeypatch.setenv("EXTRACT_CHARTS", value)
    assert adapter.env_switch("EXTRACT_CHARTS") is False


def test_an_ingestor_built_without_config_extracts_everything(tmp_path, monkeypatch):
    for name in _SWITCHES:
        monkeypatch.delenv(name, raising=False)
    for attr, name in (
        ("DEFAULT_EXTRACT_TABLES", "EXTRACT_TABLES"),
        ("DEFAULT_EXTRACT_IMAGES", "EXTRACT_IMAGES"),
        ("DEFAULT_EXTRACT_CHARTS", "EXTRACT_CHARTS"),
    ):
        monkeypatch.setattr(LlamaIndexIngestor, attr, adapter.env_switch(name))

    ing = LlamaIndexIngestor({})

    assert (ing.extract_tables, ing.extract_images, ing.extract_charts) == (True, True, True)


def test_the_corpus_sync_leaves_the_switches_to_the_adapter(monkeypatch):
    from agent import oib_sync

    for name in _SWITCHES:
        monkeypatch.delenv(name, raising=False)
    seen = {}
    monkeypatch.setattr(oib_sync, "get_ingestor", lambda backend, config=None: seen.update(config or {}))

    oib_sync._get_oib_ingestor()

    assert not {"extract_tables", "extract_images", "extract_charts"} & seen.keys()


@pytest.mark.parametrize(
    ("content_type", "images", "charts", "expected"),
    [
        ("chart", True, True, "chart"),
        ("chart", True, False, "image"),
        ("chart", False, True, "chart"),
        ("image", True, True, "image"),
        ("drawing", True, False, "drawing"),
        ("image", False, True, None),
        ("drawing", False, True, None),
    ],
)
def test_indexed_visual_type(content_type, images, charts, expected):
    assert caption_documents.indexed_visual_type(content_type, extract_images=images, extract_charts=charts) == expected


def _raster(page: int, index: int, width: int, height: int) -> dict:
    return {
        "image_bytes": f"{page}-{index}".encode(),
        "page_number": page,
        "image_index": index,
        "format": "jpeg",
        "width": width,
        "height": height,
    }


def test_under_the_cap_everything_is_kept():
    images = [_raster(1, 0, 200, 200), _raster(2, 0, 300, 300)]
    assert pdf_rasters.cap_images(images, 2) == (images, 0)


def test_over_the_cap_the_largest_are_kept_in_document_order():
    stamp = _raster(1, 0, 120, 120)
    photo = _raster(1, 1, 2000, 1500)
    logo = _raster(2, 0, 150, 100)
    plan = _raster(3, 0, 3000, 2000)

    kept, left_out = pdf_rasters.cap_images([stamp, photo, logo, plan], 2)

    assert kept == [photo, plan]
    assert left_out == 2


def test_a_zero_cap_analyses_none():
    assert pdf_rasters.cap_images([_raster(1, 0, 200, 200)], 0) == ([], 1)


def test_rasters_on_rendered_pages_are_not_extracted(monkeypatch):
    pdfium = pytest.importorskip("pypdfium2")
    from PIL import Image

    class _Bitmap:
        def __init__(self, color):
            self._img = Image.new("RGB", (200, 200), color)
            self.width = self.height = 200

        def to_pil(self):
            return self._img

    class _Obj:
        type = 3  # FPDF_PAGEOBJ_IMAGE

        def __init__(self, color):
            self._bitmap = _Bitmap(color)

        def get_bitmap(self):
            return self._bitmap

    class _Page:
        def __init__(self, color):
            self._objects = [_Obj(color)]

        def get_objects(self):
            return self._objects

        def close(self):
            pass

    pages = [_Page("white"), _Page("black"), _Page("red")]

    class _Doc:
        def __init__(self, path):
            pass

        def __len__(self):
            return len(pages)

        def __getitem__(self, idx):
            return pages[idx]

        def close(self):
            pass

    monkeypatch.setattr(pdfium, "PdfDocument", _Doc)

    images = pdf_rasters._extract_images_from_pdf("ignored.pdf", skip_pages={2})

    assert [image["page_number"] for image in images] == [1, 3]


@pytest.fixture
def summary_db(tmp_path):
    from agent.knowledge import configure_summary_db
    from agent.knowledge import factory

    factory._document_metadata_store = None
    configure_summary_db(f"sqlite:///{tmp_path / 'summaries.db'}")
    yield
    factory._document_metadata_store = None


@pytest.fixture
def ingestor(tmp_path, monkeypatch, qdrant_store):
    for name in _SWITCHES:
        monkeypatch.delenv(name, raising=False)
        monkeypatch.setattr(LlamaIndexIngestor, f"DEFAULT_{name.removeprefix('GRID_')}", adapter.env_switch(name))
    ing = LlamaIndexIngestor({})
    ing._embed_model = FakeEmbedder()
    ing._initialized = True
    capture_indexed_documents(monkeypatch, into=_INDEXED)
    return ing


def _wait_terminal(ing, job_id, timeout=30):
    deadline = time.time() + timeout
    while time.time() < deadline:
        status = ing.get_job_status(job_id)
        if status.is_terminal:
            return status
        time.sleep(0.05)
    raise AssertionError("ingestion job did not terminate in time")


_INDEXED: list[list] = []


def _indexed_documents():
    return [document for documents in _INDEXED for document in documents]


class _Pipeline:
    def __init__(self, tmp_path, monkeypatch, *, rendered_pages=(1,), over_pixel_budget=0):
        self.analysed: list[bytes] = []
        self.extract_calls: list[set] = []
        self.over_pixel_budget = over_pixel_budget
        cred = ResolvedCredential(api_key="vlm-key", base_url="https://vlm.test/v1", model="test-vlm", source="env")
        monkeypatch.setattr(vision_credentials, "resolve_vlm_credential", lambda organization_id=None: cred)
        monkeypatch.setattr(pdf_text, "_extract_text_from_pdf", lambda p: [])
        monkeypatch.setattr(pdf_tables, "_extract_tables_from_pdf", lambda *a, **k: [])
        rasters = [_raster(1, 0, 2000, 2000), _raster(2, 0, 800, 600), _raster(3, 0, 400, 300)]

        def _extract(pdf_path, *, min_width, min_height, skip_pages=frozenset(), max_images=None, **kwargs):
            self.extract_calls.append(set(skip_pages))
            candidates = [r for r in rasters if r["page_number"] not in skip_pages]
            if max_images is None:
                return candidates, 0, self.over_pixel_budget
            kept, over_cap = pdf_rasters.cap_images(candidates, max_images)
            return kept, over_cap, self.over_pixel_budget

        monkeypatch.setattr(pdf_rasters, "_extract_image_records", _extract)

        def _analyze(image_bytes, *args, **kwargs):
            self.analysed.append(image_bytes)
            if image_bytes == b"2-0":
                return ("chart", "Balkendiagramm Energiebedarf 2020-2024.", {})
            return ("image", "Foto der Fassade.", {})

        monkeypatch.setattr(vision_reads, "analyze_visual", _analyze)
        import knowledge_layer.ingest.processing as processing_module

        monkeypatch.setattr(
            processing_module,
            "render_visual_pages_no_vlm",
            lambda *a, **k: [
                {"image_bytes": b"render-%d" % page, "page_number": page, "width": 2048, "height": 1448}
                for page in rendered_pages
            ],
        )
        self.pdf = tmp_path / "bericht.pdf"
        self.pdf.write_bytes(b"%PDF-1.4\n% minimal\n")


def _ingest(ingestor, pipeline):
    job_id = ingestor.submit_job([str(pipeline.pdf)], "proj_1", config={"original_filenames": ["bericht.pdf"]})
    status = _wait_terminal(ingestor, job_id)
    assert status.is_success
    return status


def test_a_chart_is_indexed_by_default(tmp_path, monkeypatch, ingestor, summary_db):
    pipeline = _Pipeline(tmp_path, monkeypatch)

    status = _ingest(ingestor, pipeline)

    charts = [d for d in _indexed_documents() if d.metadata.get("content_type") == "chart"]
    assert [d.metadata["page_label"] for d in charts] == ["2"]
    assert status.metadata["charts_extracted"] == 1


def test_each_page_is_analysed_once(tmp_path, monkeypatch, ingestor, summary_db):
    pipeline = _Pipeline(tmp_path, monkeypatch)

    _ingest(ingestor, pipeline)

    assert pipeline.extract_calls == [{1}]
    assert sorted(pipeline.analysed) == sorted([b"render-1", b"2-0", b"3-0"])


def test_the_cap_bounds_analysis_and_records_what_it_left_out(tmp_path, monkeypatch, ingestor, summary_db):
    monkeypatch.setattr(limits, "MAX_IMAGES_PER_DOCUMENT", 1)
    pipeline = _Pipeline(tmp_path, monkeypatch, rendered_pages=())

    status = _ingest(ingestor, pipeline)

    assert pipeline.analysed == [b"1-0"]
    assert _counters(status.file_details[0].metadata) == {"images_over_cap": 2}


def test_under_the_cap_nothing_is_recorded(tmp_path, monkeypatch, ingestor, summary_db):
    pipeline = _Pipeline(tmp_path, monkeypatch)

    status = _ingest(ingestor, pipeline)

    assert _counters(status.file_details[0].metadata) == {}


def test_a_raster_over_the_pixel_budget_is_counted_on_the_file_status(tmp_path, monkeypatch, ingestor, summary_db):
    pipeline = _Pipeline(tmp_path, monkeypatch, rendered_pages=(), over_pixel_budget=1)

    status = _ingest(ingestor, pipeline)

    assert _counters(status.file_details[0].metadata) == {"images_over_pixel_budget": 1}


def test_pages_read_without_layout_are_counted_and_kept_from_the_table_pass(
    tmp_path, monkeypatch, ingestor, summary_db
):
    pipeline = _Pipeline(tmp_path, monkeypatch, rendered_pages=())
    table_calls: list = []
    monkeypatch.setattr(
        pdf_text,
        "_extract_text_from_pdf",
        lambda p: pdf_text.PdfTextPages([], page_count=3, dense_pages=[2, 3]),
    )
    monkeypatch.setattr(pdf_tables, "_extract_tables_from_pdf", lambda *a, **k: table_calls.append(a) or [])
    monkeypatch.setattr(LlamaIndexIngestor, "DEFAULT_EXTRACT_TABLES", True)

    status = _ingest(ingestor, pipeline)

    assert _counters(status.file_details[0].metadata) == {"pages_read_without_layout": 2}
    assert [call[2] for call in table_calls] == [[2, 3]]
