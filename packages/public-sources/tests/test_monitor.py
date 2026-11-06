"""Change monitors decide by the record's rule, with no model, and say what a reviewer must look at."""

from __future__ import annotations

from public_sources.access.base import Fetched
from public_sources.engines.base import ParsedDocument
from public_sources.engines.base import Passage
from public_sources.monitor import Snapshot
from public_sources.monitor import changes_since


def _snapshot(body: bytes, *, etag="", version="", passages=()) -> Snapshot:
    fetched = Fetched(url="https://law.example.org/bo.html", status=200, content_type="text/html", body=body, etag=etag)
    document = ParsedDocument(title="BO", uri=fetched.url, version=version, passages=tuple(passages))
    return Snapshot.of("xx-portal", "bo", fetched, document)


def test_the_first_look_is_no_change():
    assert changes_since("sha256", None, _snapshot(b"a")) is None


def test_sha256_sees_new_bytes_and_names_the_passages_that_moved():
    before = _snapshot(b"a", passages=[Passage("art_1", "1", "", "old"), Passage("art_2", "2", "", "same")])
    after = _snapshot(
        b"b",
        passages=[Passage("art_1", "1", "", "new"), Passage("art_2", "2", "", "same"), Passage("art_3", "3", "", "x")],
    )
    change = changes_since("sha256", before, after)
    assert change is not None
    assert (change.changed, change.added, change.removed) == (("art_1",), ("art_3",), ())
    item = change.review_item()
    assert item["origin"] == "monitor" and item["needs"] == ["review_text"]


def test_same_bytes_is_no_change():
    assert changes_since("sha256", _snapshot(b"a"), _snapshot(b"a")) is None


def test_etag_and_not_modified():
    assert changes_since("etag", _snapshot(b"a", etag='"1"'), _snapshot(b"b", etag='"1"')) is None
    assert changes_since("etag", _snapshot(b"a", etag='"1"'), _snapshot(b"a", etag='"2"')) is not None
    assert changes_since("sha256", _snapshot(b"a"), _snapshot(b""), not_modified=True) is None


def test_a_new_version_asks_for_an_edition_and_a_removed_provision_for_relations():
    before = _snapshot(
        b"a", version="2026-01-01", passages=[Passage("art_1", "1", "", "x"), Passage("art_2", "2", "", "y")]
    )
    after = _snapshot(b"b", version="2026-07-01", passages=[Passage("art_1", "1", "", "x")])
    change = changes_since("version", before, after)
    assert change is not None
    assert change.needs == ("review_text", "new_edition", "recheck_relations")
    assert changes_since("version", before, _snapshot(b"c", version="2026-01-01")) is None
