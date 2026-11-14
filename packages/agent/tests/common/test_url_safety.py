"""Whether an address may stand in an answer as a source (citations spec G28)."""

from __future__ import annotations

import pytest

from agent.common.url_safety import has_signed_query
from agent.common.url_safety import host_problem
from agent.common.url_safety import is_citable_url
from agent.common.url_safety import strip_signed_query


@pytest.mark.parametrize(
    "url",
    [
        "https://www.example.org/a/b?page=2#top",
        "https://example.co.uk/a",
        "https://example.org./a",
        "https://example.org:443/a",
        "https://österreich.example.org/a",
    ],
)
def test_an_https_address_on_a_public_dns_name_is_citable(url):
    assert host_problem(url) is None and is_citable_url(url)


@pytest.mark.parametrize(
    ("url", "says"),
    [
        ("http://www.oib.or.at/de/inkrafttreten-2015", "not an https address"),  # the live case
        ("ftp://example.org/x", "not an https address"),
        ("javascript:alert(1)", "not an https address"),
        ("https://localhost/x", "not a public DNS name"),
        ("https://frontend/api", "not a public DNS name"),  # single label
        ("https://app.default.svc/x", "not a public DNS name"),
        ("https://app.default.svc.cluster.local/x", "not a public DNS name"),
        ("https://api.internal/x", "not a public DNS name"),
        ("https://printer.local/x", "not a public DNS name"),
        ("https://10.0.0.1/a", "private, loopback or link-local"),
        ("https://192.168.1.4/a", "private, loopback or link-local"),
        ("https://169.254.169.254/latest/meta-data", "private, loopback or link-local"),
        ("https://[::1]/a", "private, loopback or link-local"),
        ("https://[fe80::1]/a", "private, loopback or link-local"),
        ("https://[::ffff:10.0.0.1]/a", "private, loopback or link-local"),
        ("https://8.8.8.8/a", "an IP address"),
        ("https://[2001:4860:4860::8888]/a", "an IP address"),
        ("https://user:secret@example.org/a", "user part"),
        ("https://example.org:8443/a", "non-standard port"),
        ("https:///a", "without a host"),
    ],
)
def test_what_is_not_a_public_https_page_is_refused_with_its_reason(url, says):
    problem = host_problem(url)
    assert problem is not None and says in problem
    assert not is_citable_url(url)


@pytest.mark.parametrize(
    "url",
    [
        "https://bucket.example.com/f.pdf?X-Amz-Algorithm=AWS4&X-Amz-Signature=abc&X-Amz-Expires=300",
        "https://storage.example.com/f.pdf?X-Goog-Signature=abc",
        "https://account.example.net/c/f.pdf?sv=2022&se=2026&sig=abc",
        "https://cdn.example.org/f.pdf?Expires=1&Signature=abc&Key-Pair-Id=K1",
        "https://files.example.org/f.pdf?access_token=abc",
    ],
)
def test_a_signed_query_is_taken_off_whole(url):
    assert has_signed_query(url)
    stripped = strip_signed_query(url)
    assert "?" not in stripped and stripped.endswith("/f.pdf")


def test_an_ordinary_query_stays():
    url = "https://example.org/search?q=signature+rules&page=2"
    assert not has_signed_query(url)
    assert strip_signed_query(url) == url
