"""A third party's PDF is parsed in the fetcher, never in a pod that reaches the cluster (ADR-0162 amendment).

With ``PUBLIC_SOURCE_FETCHER_URL`` set, as on every backend role, ``read_pdf``
sends the bytes to the fetcher's ``/v1/extract`` and parses nothing itself; an
unreachable fetcher is a refusal, not a parse here. Without a fetcher, a
source is not read at all: the in-process guard is gone.
"""

from __future__ import annotations

import httpx
import pytest
from public_sources import pdf as pdf_module
from public_sources import routing
from public_sources.egress import EgressRefused
from public_sources.fetcher import make_app
from public_sources.pdf import PdfError
from public_sources.pdf import read_pdf
from public_sources.routing import source_transport
from public_sources_testing import SOURCES_DIR
from public_sources_testing.pdf_fixture import REAL_PDF
from public_sources_testing.pdf_fixture import password_pdf
from public_sources_testing.pdf_fixture import real_text
from starlette.testclient import TestClient

FETCHER = "http://public-source-fetcher:8095"


@pytest.fixture(autouse=True)
def _sources(monkeypatch):
    monkeypatch.setenv("PUBLIC_SOURCES_DIR", str(SOURCES_DIR))


@pytest.fixture
def fetcher(monkeypatch):
    """The fetcher app behind ``PUBLIC_SOURCE_FETCHER_URL``; ``paths`` records what was asked of it."""
    monkeypatch.setenv(routing.ENV_FETCHER_URL, FETCHER)
    paths: list[str] = []
    app = make_app()

    def client(*args, **kwargs):
        test_client = TestClient(app, base_url=FETCHER)
        test_client.event_hooks["request"].append(lambda request: paths.append(request.url.path))
        return test_client

    monkeypatch.setattr(httpx, "Client", client)
    return paths


def test_with_a_fetcher_the_text_comes_from_its_extract(fetcher):
    read = read_pdf(REAL_PDF.read_bytes())

    assert fetcher == ["/v1/extract"]
    assert read.text == real_text() and read.page_count == 16


def test_a_refusal_in_the_fetcher_keeps_its_code(fetcher):
    with pytest.raises(PdfError) as refused:
        read_pdf(password_pdf())
    assert refused.value.code == "pdf_encrypted"


def test_an_unreachable_fetcher_is_a_refusal_and_nothing_is_parsed_here(monkeypatch):
    monkeypatch.setenv(routing.ENV_FETCHER_URL, "http://127.0.0.1:9")  # nothing listens on discard
    parsed: list[bytes] = []
    monkeypatch.setattr(pdf_module, "parse_pdf", lambda content, **_: parsed.append(content))

    with pytest.raises(PdfError) as refused:
        read_pdf(REAL_PDF.read_bytes())
    assert refused.value.code == "pdf_reader_failed"
    assert parsed == []


def test_the_pdf_module_and_the_router_name_the_same_fetcher_variable():
    assert pdf_module.ENV_FETCHER_URL == routing.ENV_FETCHER_URL


def test_without_a_fetcher_a_source_is_not_read_in_process(monkeypatch):
    monkeypatch.delenv(routing.ENV_FETCHER_URL, raising=False)

    with pytest.raises(EgressRefused, match="no public-source fetcher"):
        source_transport("at-ris")


def test_a_rollout_lets_the_fetcher_finish_the_longest_extract_a_caller_waits_for():
    """Else a deploy kills a parse mid-read, and the capture it belongs to answers pdf_reader_failed."""
    import re
    from pathlib import Path

    root = Path(__file__).resolve().parents[3]
    source = (root / "deploy/pulumi/src/app/public-source-fetcher.ts").read_text(encoding="utf-8")
    profile = re.search(r"export const FETCHER_ROLLOUT: RolloutProfile = \{(.*?)\n\};", source, re.S).group(1)
    grace = int(re.search(r"terminationGracePeriodSeconds: (\d+)", profile).group(1))
    drain = int(re.search(r"endpointDrainSeconds: (\d+)", profile).group(1))
    assert grace > drain + pdf_module.EXTRACT_TIMEOUT_SECONDS
