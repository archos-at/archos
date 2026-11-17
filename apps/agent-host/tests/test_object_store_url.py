from __future__ import annotations

import pytest
from pydantic import BaseModel
from pydantic import ValidationError

from agent_host.object_store_url import MAX_URL_LENGTH
from agent_host.object_store_url import ObjectStoreUrl
from agent_host.object_store_url import ObjectStoreUrlError
from agent_host.object_store_url import assert_fetchable_object_store_url
from agent_host.object_store_url import object_store_origins
from agent_host.object_store_url import object_store_request_url

_SIGNATURE = "X-Amz-Signature=secret-signature"


@pytest.fixture(autouse=True)
def store(monkeypatch):
    monkeypatch.setenv("SEAWEED_ENDPOINT", "http://seaweedfs:8333")
    monkeypatch.setenv("SEAWEED_PUBLIC_ENDPOINT", "https://files.buero.example")


class _Body(BaseModel):
    url: ObjectStoreUrl


def test_the_origins_are_the_two_configured_endpoints():
    assert object_store_origins() == {("http", "seaweedfs", 8333), ("https", "files.buero.example", 443)}


@pytest.mark.parametrize(
    "url",
    [
        f"http://seaweedfs:8333/bucket/org/o1/doc/Plan.pdf?{_SIGNATURE}",
        f"https://files.buero.example/bucket/key?{_SIGNATURE}",
        "https://files.buero.example:443/bucket/key",
        "HTTP://SEAWEEDFS:8333/bucket/key",
        "http://seaweedfs:8333/bucket/Grundriss%20%C3%84.pdf",
    ],
)
def test_a_presigned_url_into_the_store_passes(url):
    assert_fetchable_object_store_url(url)
    assert _Body(url=url).url == url


@pytest.mark.parametrize(
    ("url", "reason"),
    [
        ("http://169.254.169.254/latest/meta-data/", "configured object store"),
        ("http://evil-seaweedfs:8333/bucket/key", "configured object store"),
        ("http://seaweedfs.evil.test:8333/bucket/key", "configured object store"),
        ("http://seaweedfs:9333/cluster/status", "configured object store"),
        ("http://seaweedfs:8888/buckets/", "configured object store"),
        ("http://seaweedfs/bucket/key", "configured object store"),
        ("https://seaweedfs:8333/bucket/key", "configured object store"),
        ("file:///etc/passwd", "http(s) URL"),
        ("gopher://seaweedfs:8333/", "http(s) URL"),
        ("seaweedfs:8333/bucket/key", "http(s) URL"),
        ("/bucket/key", "http(s) URL"),
        ("http:///bucket/key", "name a host"),
        ("http://seaweedfs:99999/bucket/key", "invalid port"),
        ("http://seaweedfs:8333@internal-admin/", "credentials"),
        ("http://user@seaweedfs:8333/bucket/key", "credentials"),
        ("http://internal-admin\\@seaweedfs:8333/", "backslashes"),
        ("http://seaweedfs:8333/bucket/key with space", "spaces"),
        ("http://seaweedfs:8333/bucket/Ä.pdf", "printable ASCII"),
        ("http://seaweedfs:8333/bucket/key\r\nHost: internal-admin", "printable ASCII"),
    ],
)
def test_anything_else_is_refused_with_a_reason(url, reason):
    with pytest.raises(ObjectStoreUrlError) as raised:
        assert_fetchable_object_store_url(url, field="file_ref")
    message = str(raised.value)
    assert message.startswith("file_ref ")
    assert reason in message
    with pytest.raises(ValidationError):
        _Body(url=url)


def test_with_no_endpoint_configured_nothing_passes(monkeypatch):
    monkeypatch.delenv("SEAWEED_ENDPOINT")
    monkeypatch.delenv("SEAWEED_PUBLIC_ENDPOINT")

    assert object_store_origins() == frozenset()
    with pytest.raises(ObjectStoreUrlError):
        assert_fetchable_object_store_url("http://seaweedfs:8333/bucket/key")


def test_an_endpoint_without_a_scheme_trusts_nothing(monkeypatch):
    monkeypatch.setenv("SEAWEED_ENDPOINT", "seaweedfs:8333")
    monkeypatch.delenv("SEAWEED_PUBLIC_ENDPOINT")

    assert object_store_origins() == frozenset()


def test_an_overlong_url_is_refused_before_it_is_parsed():
    url = "http://seaweedfs:8333/" + "k" * MAX_URL_LENGTH
    with pytest.raises(ObjectStoreUrlError, match="longer than"):
        assert_fetchable_object_store_url(url)
    with pytest.raises(ValidationError):
        _Body(url=url)


def test_an_empty_url_is_refused():
    with pytest.raises(ValidationError):
        _Body(url="")


def test_a_refusal_never_repeats_the_url():
    url = f"http://elsewhere.test/bucket/key?{_SIGNATURE}"
    with pytest.raises(ObjectStoreUrlError) as raised:
        assert_fetchable_object_store_url(url)
    assert "secret-signature" not in str(raised.value)
    assert "elsewhere" not in str(raised.value)
    with pytest.raises(ValidationError) as invalid:
        _Body(url=url)
    assert "secret-signature" not in invalid.value.errors(include_input=False)[0]["msg"]


def test_a_refusal_is_a_value_error_so_a_model_reports_it_as_422():
    assert issubclass(ObjectStoreUrlError, ValueError)


def test_the_type_stays_a_plain_string_in_the_schema():
    assert _Body.model_json_schema()["properties"]["url"] == {
        "maxLength": MAX_URL_LENGTH,
        "minLength": 1,
        "title": "Url",
        "type": "string",
    }


def test_the_request_url_takes_its_origin_from_configuration():
    assert (
        object_store_request_url("HTTPS://Files.Buero.Example:443/bucket/org/a.eml?X-Amz-Signature=abc")
        == "https://files.buero.example/bucket/org/a.eml?X-Amz-Signature=abc"
    )
    assert object_store_request_url("http://seaweedfs:8333/b/k") == "http://seaweedfs:8333/b/k"


def test_the_request_url_drops_a_fragment():
    assert object_store_request_url("http://seaweedfs:8333/b/k#frag") == "http://seaweedfs:8333/b/k"


@pytest.mark.parametrize("url", ["http://seaweedfs:9333/b/k", "http://evil.example/b/k", "file:///etc/passwd"])
def test_the_request_url_refuses_what_the_gate_refuses(url):
    with pytest.raises(ObjectStoreUrlError):
        object_store_request_url(url)
