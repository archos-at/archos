"""What a web search may hand on as a source about law (ADR-0175, staging QC run 1 F1 and run 2 #1).

What is a copy is read from data: the source records and the works the turn holds. The data-driven cases use
invented hosts and works; the live cases (dev, 2026-11-10) run against the repository's own records.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from agent.common import web_sources
from agent.common.knowledge_context import EditionUse
from agent.common.knowledge_context import KnowledgeContext
from agent.common.knowledge_context import SourceRef
from agent.common.knowledge_context import set_turn_knowledge_context
from agent.common.norm_registry import NormFamily
from agent.common.web_sources import SOURCE_NOTE_KEY
from agent.common.web_sources import WEB_RESULT_NOTE
from agent.common.web_sources import HeldWork
from agent.common.web_sources import SourceHosts
from agent.common.web_sources import assess
from agent.common.web_sources import copied_work
from agent.common.web_sources import is_product_site
from agent.common.web_sources import preamble
from agent.common.web_sources import screen
from agent.knowledge.inventory import set_norm_families

#: An invented country's legal database: its own host, and a site that republishes it.
INVENTED = SourceHosts(
    title="Lawbase of Ruritania", country="XR", hosts=("law.example.org",), copy_hosts=("mirror.example.net",)
)


@pytest.fixture(autouse=True)
def _clean_turn():
    set_norm_families(None)
    set_turn_knowledge_context(None)
    yield
    set_norm_families(None)
    set_turn_knowledge_context(None)


@pytest.fixture
def invented_source(monkeypatch):
    monkeypatch.setattr(web_sources, "configured_sources", lambda: (INVENTED,))


def _reads(*countries: str, uses: tuple[EditionUse, ...] = (), gate: str = "site_unknown") -> None:
    site = countries[0] if countries else None
    set_turn_knowledge_context(
        KnowledgeContext(gate=gate, site_country=site, retrieval_countries=frozenset(countries), uses=uses)
    )


# -- a copy by host: the source record's copy_hosts ---------------------------


def test_a_hit_on_a_copy_host_is_withheld_while_the_source_can_be_read(invented_source):
    _reads("XR")
    found = assess("https://www.mirror.example.net/code/para-7", "§ 7 Building Code")
    assert found.withheld is not None and "Lawbase of Ruritania" in found.withheld
    assert found.note is None


def test_a_hit_on_a_copy_host_is_labelled_while_the_source_cannot_be_read(invented_source):
    """Withholding the only text the turn can reach would leave the answer nothing to say what it rests on."""
    _reads()  # the gate reads no country's law
    found = assess("https://mirror.example.net/code/para-7", "§ 7 Building Code")
    assert found.withheld is None
    assert found.note is not None and "not the law's source" in found.note
    assert found.work == "Lawbase of Ruritania"


def test_a_source_s_own_host_is_kept_as_it_is(invented_source):
    _reads("XR")
    assert assess("https://law.example.org/code/para-7", "§ 7 Building Code") == web_sources.KEEP


def test_a_lookalike_of_a_copy_host_is_not_one(invented_source):
    _reads("XR")
    assert assess("https://notmirror.example.net/x", "A page") == web_sources.KEEP


def test_the_copy_hosts_are_read_from_a_source_record_s_file(tmp_path, monkeypatch):
    """A new country's mirrors are a line in its source record: no code names them."""
    from public_sources_testing import HTML_PAGE
    from public_sources_testing import html_source
    from public_sources_testing import write_source

    write_source(tmp_path, html_source(copy_hosts=["mirror.example.net"]), {"bo.html": HTML_PAGE})
    monkeypatch.setenv("PUBLIC_SOURCES_DIR", str(tmp_path))
    web_sources._sources_under.cache_clear()
    try:
        (source,) = web_sources.configured_sources()
        assert (source.country, source.hosts, source.copy_hosts) == (
            "DE",
            ("law.example.org",),
            ("mirror.example.net",),
        )
        _reads("DE")
        assert assess("https://mirror.example.net/bo/art-6a", "Art. 6a").withheld is not None
        assert assess("https://law.example.org/bo.html", "Art. 6a") == web_sources.KEEP
    finally:
        web_sources._sources_under.cache_clear()


def test_a_released_record_the_turn_carries_names_its_copies(monkeypatch):
    """A published source's ``copy_hosts`` screen the web as a repository file's did, with no file at all."""
    from agent.common.knowledge_context import KnowledgeContext
    from agent.common.knowledge_context import LawSource
    from agent.common.knowledge_context import set_turn_knowledge_context

    monkeypatch.setenv("PUBLIC_SOURCES_DIR", "/nonexistent/sources")
    web_sources._sources_under.cache_clear()
    config = {"title": "Lawbase of Ruritania", "hosts": ["law.example.org"], "copy_hosts": ["mirror.example.net"]}
    released = LawSource(key="xr-lawbase", revision_id="r1", country="XR", config=config)
    set_turn_knowledge_context(
        KnowledgeContext(gate="core", site_country="XR", sources=(released,), retrieval_countries=frozenset({"XR"}))
    )
    try:
        (source,) = web_sources.configured_sources()
        assert (source.country, source.hosts, source.copy_hosts) == (
            "XR",
            ("law.example.org",),
            ("mirror.example.net",),
        )
        assert assess("https://mirror.example.net/bo", "Bauordnung").withheld
    finally:
        set_turn_knowledge_context(None)
        web_sources._sources_under.cache_clear()


def test_an_unreadable_record_set_knows_no_copy_and_fails_no_search(monkeypatch):
    """An unreadable repository record set is no error: no host of it is known as a copy."""
    monkeypatch.setenv("PUBLIC_SOURCES_DIR", "/nonexistent/sources")
    web_sources._sources_under.cache_clear()
    try:
        assert web_sources.configured_sources() == ()
        assert screen([{"url": "https://www.jusline.at/gesetz/x", "title": "X"}])[1] == []
    finally:
        web_sources._sources_under.cache_clear()


# -- a copy by designation: the works the turn holds --------------------------

GUIDELINE = EditionUse(
    work_id="xr:guideline-2",
    edition_id="xr:guideline-2:2023",
    role="binding",
    via="relation",
    corpus_files=("guideline_2_edition_2023.pdf",),
    designation="Technical Guideline 2",
    edition_label="Edition 2023",
)
STATUTE = EditionUse(
    work_id="xr:parking-act",
    edition_id=None,
    role="binding",
    via="territory",
    designation="Ruritanian Parking Act 2008",
    source_refs=(SourceRef(scheme="eli", value="https://statutes.example.org/eli/2008/34"),),
)


@pytest.mark.parametrize(
    ("url", "title"),
    [
        ("https://vendor.example.com/media/guideline_2_edition_2023.pdf", "Fire safety"),  # the corpus file's name
        ("https://vendor.example.com/download/file123.pdf", "Technical Guideline 2 (2023)"),  # the designation
        ("https://vendor.example.com/technical-guideline-2.pdf", None),  # the designation in the address
    ],
)
def test_a_web_document_of_a_work_the_knowledge_base_holds_is_withheld(invented_source, url, title):
    _reads("XR", uses=(GUIDELINE,), gate="core")
    found = assess(url, title)
    assert found.withheld is not None and "Technical Guideline 2" in found.withheld
    assert "knowledge base" in found.withheld


def test_a_web_page_about_a_held_work_is_handed_on_with_a_label(invented_source):
    _reads("XR", uses=(GUIDELINE,), gate="core")
    found = assess("https://blog.example.com/technical-guideline-2-explained", "Technical Guideline 2 explained")
    assert found.withheld is None
    assert found.note is not None and "not its source" in found.note


def test_part_2_2_is_not_part_2(invented_source):
    """``2.2`` is one token: a document of another part is no copy of this one."""
    _reads("XR", uses=(GUIDELINE,), gate="core")
    assert assess("https://vendor.example.com/x.pdf", "Technical Guideline 2.2 Garages") == web_sources.KEEP


def test_a_page_naming_a_law_a_legal_database_holds_is_labelled_never_withheld(invented_source):
    _reads("XR", uses=(STATUTE,), gate="core")
    found = assess("https://chamber.example.com/parking", "The Ruritanian Parking Act 2008 in practice")
    assert found.withheld is None
    assert found.note is not None and "Ruritanian Parking Act 2008" in found.note
    assert "legal-database lookup" in found.note  # the turn may read XR's law


def test_the_host_an_edition_s_identity_names_is_its_own_source(invented_source):
    """The records name where an edition is read (its ELI): a hit there is the law's source, not a copy."""
    _reads("XR", uses=(STATUTE,), gate="core")
    assert assess("https://statutes.example.org/eli/2008/34", "Ruritanian Parking Act 2008") == web_sources.KEEP


def test_a_work_nobody_holds_is_nobody_s_copy(invented_source):
    _reads("XR")
    assert assess("https://vendor.example.com/technical-guideline-2.pdf", "Technical Guideline 2") == web_sources.KEEP


def test_a_short_name_identifies_no_work():
    work = HeldWork(designation="BC", where="legal_database", names=web_sources._names("BC"), country="XR")
    assert work.names == ()
    assert web_sources.named_work("https://example.com/a", "The BC of the province", [work]) is None


def test_the_base_shelf_s_documents_are_held_works(invented_source):
    """The shelf names its documents by the display title their file resolves to; no pattern in this module."""
    set_norm_families([NormFamily(key="3", members=("3",), files=("oib-rl_3_ausgabe_mai_2023.pdf",))])
    held = web_sources.held_works()
    assert [work.designation for work in held if work.where == "knowledge_base"] == ["OIB-Richtlinie 3"]
    assert assess("https://vendor.example.com/media/x.pdf", "OIB-Richtlinie 3 – Hygiene").withheld is not None
    assert assess("https://vendor.example.com/media/x.pdf", "OIB-Richtlinie 2 – Brandschutz") == web_sources.KEEP


# -- the live cases (dev, 2026-11-10), against the repository's records -------

LIVE_MIRRORS = [
    (
        "https://gesetzefinden.at/landesrecht/landesgesetze/wgarg-2008/para-50",
        "§ 50 Umfang der Stellplatzverpflichtung: Regelbedarf — WGarG ...",
    ),
    (
        "https://www.jusline.at/gesetz/wgarg_2008/paragraf/50a",
        "§ 50a WGarG 2008 (Wiener Garagengesetz 2008) - JUSLINE Österreich",
    ),
    (
        "https://www.jusline.at/gesetz/wgarg_2008/paragraf/48",
        "§ 48 WGarG 2008 (Wiener Garagengesetz 2008) - JUSLINE Österreich",
    ),
]


@pytest.mark.parametrize(("url", "title"), LIVE_MIRRORS)
def test_the_mirrors_the_dev_answer_cited_are_withheld_where_the_legal_database_can_be_read(url, title):
    """„Was sagt § 50 Wiener Garagengesetz?" (dev, 20:10Z) cited these three; the legal database was not read."""
    _reads("AT")
    assert assess(url, title).withheld is not None
    assert copied_work(url, title) is not None


@pytest.mark.parametrize(("url", "title"), LIVE_MIRRORS)
def test_the_mirrors_are_labelled_copies_where_the_gate_reads_no_law(url, title):
    found = assess(url, title)  # no knowledge context: the gate fails closed
    assert found.withheld is None and found.note is not None


def test_a_plain_http_page_is_never_handed_on_as_a_source():
    """„Laut OIB gilt dort seit 16. Juli 2026 die Ausgabe 2025 [2]" rested on this address (dev, 17:21Z)."""
    reason = assess("http://www.oib.or.at/de/inkrafttreten-2015", "Inkrafttreten").withheld
    assert reason is not None and "not an https address" in reason


@pytest.mark.parametrize("url", ["https://localhost/x", "https://frontend/x", "https://10.0.0.7/x", "https://[::1]/x"])
def test_a_local_or_internal_address_is_never_handed_on_as_a_source(url):
    assert assess(url, "A page").withheld is not None


def test_the_legal_database_s_own_host_is_not_a_copy():
    _reads("AT")
    url = "https://www.ris.bka.gv.at/GeltendeFassung.wxe?Abfrage=LrW&Gesetzesnummer=20000052"
    assert assess(url, "Wiener Garagengesetz 2008") == web_sources.KEEP


def test_the_site_the_norm_registry_points_at_for_a_law_is_not_labelled_a_copy():
    """The city's own gazette page was among the hits of that turn: it is where the registry reads such law."""
    _reads("AT")
    url = "https://www.wien.gv.at/recht/landesrecht-wien/landesgesetzblatt/jahrgang/2010/html/lg2010046.html"
    assert assess(url, "LGBl 46/2010 - Wiener Garagengesetz 2008 – WGarG 2008; Änderung") == web_sources.KEEP


# -- the product's own site, and what the agent reads -------------------------


@pytest.mark.parametrize(
    "url", ["https://archos.tech/glossar", "https://www.archos.tech/x", "https://piloti.at/glossar"]
)
def test_the_product_s_own_domains_current_and_former_are_its_site(url):
    assert is_product_site(url)


def test_a_lookalike_host_is_not_the_product_s_site():
    assert not is_product_site("https://notarchos.tech/x")


def test_screen_keeps_the_rest_labels_a_copy_and_the_preamble_names_reasons_never_addresses(invented_source):
    _reads("XR", uses=(GUIDELINE,), gate="core")
    kept, withheld = screen(
        [
            {"url": "https://vendor.example.com/guideline_2_edition_2023.pdf", "title": "Guideline"},
            {"url": "https://archos.tech/glossar", "title": "Glossar"},
            {"url": "https://mirror.example.net/code/para-7", "title": "§ 7"},
            {"url": "https://blog.example.com/a", "title": "Technical Guideline 2 explained"},
            {"url": "https://example.org/a", "title": "A"},
        ]
    )
    assert [doc["url"] for doc in kept] == ["https://blog.example.com/a", "https://example.org/a"]
    assert SOURCE_NOTE_KEY in kept[0] and SOURCE_NOTE_KEY not in kept[1]
    text = preamble(withheld)
    assert text.startswith(WEB_RESULT_NOTE)
    assert "vendor.example" not in text and "archos.tech" not in text and "mirror.example" not in text
    assert text.count("Not shown:") == 3


def test_a_search_scores_how_many_hits_it_withheld(monkeypatch):
    from agent.observability import langfuse_scores

    emitted: list = []
    monkeypatch.setattr(langfuse_scores, "emit_scores", lambda scores, **_: emitted.extend(scores) or len(scores))
    web_sources.score_withheld(2)
    assert [(score.name, score.value) for score in emitted] == [("web-sources-withheld", 2.0)]


# -- a country is data --------------------------------------------------------

_SRC = Path(web_sources.__file__).resolve().parents[1]
DATA_DRIVEN_MODULES = [
    _SRC / "common" / "web_sources.py",
    _SRC / "common" / "binding_claims.py",
    _SRC / "common" / "url_safety.py",
    _SRC / "citations" / "web_results.py",
]


def _data_names() -> set[str]:
    """Every host of a source record and every law the norm registry names: what may stand in data only."""
    from public_sources.source import load_sources

    from agent.common.norm_registry import load_registry

    names: set[str] = set()
    for source in load_sources().values():
        names.update(source.hosts)
        names.update(source.copy_hosts)
    registry = load_registry()
    for entry in registry.entries if registry else ():
        names.update(name for name in (entry.title, entry.short) if len(name) >= 6)
    return names


@pytest.mark.parametrize("module", DATA_DRIVEN_MODULES, ids=lambda path: path.name)
def test_no_host_and_no_law_of_a_country_is_written_into_the_screen_s_code(module):
    """A country is data (ADR-0162, ADR-0173): a host or a law's name in these modules is a rule that holds
    for one country and silently for no other. They are read from the records."""
    source = module.read_text(encoding="utf-8").casefold()
    found = sorted(name for name in _data_names() if name.casefold() in source)
    assert not found, f"{module.name} names {found}: put it in a source record or the norm registry"
    assert not re.search(r"\boib\b|\bris\b|\b[a-z0-9-]+\.(?:at|de|ch)\b", source), module.name


def test_a_hit_whose_url_does_not_parse_is_screened_not_raised(invented_source):
    """A malformed hit (an unclosed IPv6 bracket) used to raise in urlparse and fail the whole search."""
    _reads("XR")
    found = assess("https://[::1/x", "§ 7 Building Code")
    assert found.withheld is not None or found.note is not None
    kept, _ = web_sources.screen(
        [{"url": "https://[::1/x", "title": "x"}, {"url": "https://www.example.org/a", "title": "a"}]
    )
    assert all(hit["url"] != "https://[::1/x" for hit in kept)
