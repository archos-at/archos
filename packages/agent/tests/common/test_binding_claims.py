"""Sentences that state law the turn's records do not carry (citations spec G27, dev answers of 2026-11-10).

The rules read data: the works the turn holds, the gate, and the words in ``configs/norms/*/claim_terms.yml``.
The data-driven cases use an invented work and its own words; the live cases run against the repository's.
"""

from __future__ import annotations

import pytest

from agent.citations.entries import SourceEntry
from agent.common import binding_claims as module
from agent.common import web_sources
from agent.common.binding_claims import ClaimTerms
from agent.common.binding_claims import binding_claims
from agent.common.binding_claims import law_cited_from_web
from agent.common.binding_claims import load_claim_terms
from agent.common.binding_claims import turn_binding_claims
from agent.common.knowledge_context import KnowledgeContext
from agent.common.knowledge_context import set_turn_knowledge_context
from agent.common.web_sources import HeldWork
from agent.common.web_sources import SourceHosts
from agent.common.web_sources import tokens


@pytest.fixture(autouse=True)
def _clean_turn():
    set_turn_knowledge_context(None)
    yield
    set_turn_knowledge_context(None)


def _runs(*words: str) -> tuple[tuple[str, ...], ...]:
    return tuple(tokens(word) for word in words)


#: An invented language's words, to show the rule reads them and holds none of its own.
TERMS = ClaimTerms(
    binding=_runs("bindet", "in Geltung"),
    requirement=_runs("zwingend"),
    edition=_runs("Auflage"),
    negation=_runs("unbekannt"),
)
WORK = HeldWork(
    designation="Technische Regel 2",
    where="knowledge_base",
    names=web_sources._names("Technische Regel 2"),
    files=frozenset({"technische_regel_2.pdf"}),
)
WEB = SourceEntry(url="https://blog.example.com/regel-2", title="Ein Artikel", source_type="generic", tool_name="web")
KB = SourceEntry(citation_key="technische_regel_2.pdf, p.4", source_type="knowledge_layer", shelf="base")


def _claims(content: str, *, may_bind: bool, cited=((WEB, 1), (KB, 2)), terms: ClaimTerms = TERMS):
    return binding_claims(content, cited, may_bind=may_bind, works=[WORK], terms=terms)


# -- only web sources ---------------------------------------------------------


def test_a_sentence_that_names_a_held_work_from_a_web_page_alone_is_a_claim_under_any_gate():
    (claim,) = _claims("Nach Technische Regel 2 sind es 40 m [1].", may_bind=True)
    assert claim.reason == "web_only"


def test_naming_an_edition_from_a_web_page_alone_is_a_claim():
    (claim,) = _claims("Dort ist seit Juli die Auflage 2025 anzuwenden [1].", may_bind=True)
    assert claim.reason == "web_only"


def test_the_same_sentence_backed_by_the_knowledge_base_is_no_claim_where_the_gate_binds():
    assert _claims("Nach Technische Regel 2 sind es 40 m [2].", may_bind=True) == []
    assert _claims("Nach Technische Regel 2 sind es 40 m [1][2].", may_bind=True) == []


def test_a_web_cited_sentence_that_names_no_law_is_no_claim():
    assert _claims("Der Hersteller empfiehlt eine jährliche Wartung [1].", may_bind=True) == []


def test_the_reference_list_is_not_read_as_sentences():
    content = (
        "Ein Satz ohne Recht.\n\n## Quellen\n"
        "- [1] [Web] Technische Regel 2, Auflage 2025 – https://blog.example.com/regel-2\n"
    )
    assert _claims(content, may_bind=True) == []


# -- a gate that may not bind -------------------------------------------------


@pytest.mark.parametrize(
    "sentence",
    [
        "Die Technische Regel 2 bindet hier [2].",
        "Am Standort ist die Auflage 2023 in Geltung.",
        "Nach Technische Regel 2 ist die Wand zwingend in REI 90 auszuführen [2].",
    ],
)
def test_a_binding_or_required_statement_is_a_claim_while_the_gate_may_not_bind(sentence):
    (claim,) = _claims(sentence, may_bind=False)
    assert claim.reason == "gate_may_not_bind"
    assert _claims(sentence, may_bind=True) == []


def test_saying_that_the_binding_edition_is_not_known_is_the_honest_sentence():
    assert _claims("Welche Auflage hier bindet, ist unbekannt.", may_bind=False) == []


def test_quoting_a_held_work_without_saying_it_binds_is_no_claim():
    assert _claims("Die Technische Regel 2 nennt 40 m [2].", may_bind=False) == []


def test_without_the_words_only_the_rules_that_need_none_run():
    """No locale data for a language: the gate rule is silent, the web-only rule still names the held work."""
    assert _claims("Die Technische Regel 2 bindet hier [2].", may_bind=False, terms=ClaimTerms()) == []
    assert len(_claims("Nach Technische Regel 2 sind es 40 m [1].", may_bind=False, terms=ClaimTerms())) == 1


# -- the words are data -------------------------------------------------------


def _country_dir(tmp_path, terms_yaml: str):
    country = tmp_path / "xr"
    country.mkdir()
    (country / "registry.yml").write_text("version: 1\nentries: []\n", encoding="utf-8")
    (country / "claim_terms.yml").write_text(terms_yaml, encoding="utf-8")
    return str(tmp_path)


def test_the_words_are_read_from_the_file_beside_a_country_s_registry(tmp_path):
    root = _country_dir(tmp_path, "locales:\n  xx:\n    binding: [bindet, in Geltung]\n    edition: [Auflage]\n")
    terms = load_claim_terms(root)
    assert terms.binding == (("bindet",), ("in", "geltung"))
    assert terms.edition == (("auflage",),)
    assert terms.requirement == () and terms.negation == ()


def test_a_broken_word_file_switches_its_words_off_and_fails_nothing(tmp_path):
    root = _country_dir(tmp_path, "locales:\n  xx:\n    bidning: [x]\n")
    assert load_claim_terms(root) == ClaimTerms()


def test_the_repository_s_words_load_for_german_and_english():
    terms = load_claim_terms()
    assert ("verbindlich",) in terms.binding and ("binding",) in terms.binding
    assert ("in", "kraft") in terms.binding
    assert ("ausgabe",) in terms.edition and ("nicht",) in terms.negation


# -- the live cases (dev, 2026-11-10), against the repository's records -------

LAW_MIRRORS = (
    SourceEntry(
        url="https://gesetzefinden.at/landesrecht/landesgesetze/wgarg-2008/para-50",
        title="§ 50 Umfang der Stellplatzverpflichtung: Regelbedarf — WGarG ...",
        source_type="generic",
        tool_name="web_search_tool",
    ),
    SourceEntry(
        url="https://www.jusline.at/gesetz/wgarg_2008/paragraf/50a",
        title="§ 50a WGarG 2008 (Wiener Garagengesetz 2008) - JUSLINE Österreich",
        source_type="generic",
        tool_name="web_search_tool",
    ),
)
GUIDELINE_PASSAGE = SourceEntry(
    citation_key="oib-rl_2_ausgabe_mai_2023.pdf, p.26", source_type="knowledge_layer", shelf="base", doc_class="oib"
)
REQUIREMENT = "In Wien beträgt die Anforderung nach OIB-Richtlinie 2 für tragende Wände in GK 4 R 60 [1]."


def _gate(state: str) -> None:
    set_turn_knowledge_context(KnowledgeContext(gate=state, site_country="AT", retrieval_countries=frozenset({"AT"})))


def test_the_garage_law_answer_cited_from_two_mirrors_is_recorded_and_scored():
    """„Was sagt § 50 Wiener Garagengesetz?" (dev, 20:10Z): cited [Web] gesetzefinden and jusline."""
    set_turn_knowledge_context(KnowledgeContext(gate="site_unknown", retrieval_countries=frozenset({"AT"})))
    content = (
        "§ 50 Wiener Garagengesetz 2008 legt den **Regelbedarf an Stellplätzen nach Nutzungsart** fest [1]. "
        "Dieser Regelbedarf ist noch nicht in jedem Fall die endgültige Zahl der Pflichtstellplätze.\n\n"
        "Für die konkrete Verpflichtung ist auch die Lage maßgeblich: § 50a sieht je nach Zone **70 %, 80 % "
        "oder 100 %** des Regelbedarfs vor [2].\n"
    )
    cited = [(LAW_MIRRORS[0], 1), (LAW_MIRRORS[1], 2)]
    claims = turn_binding_claims(content, cited)
    assert [claim.reason for claim in claims] == ["web_only", "web_only"]
    assert len(law_cited_from_web(entry for entry, _number in cited)) >= 1


def test_a_binding_edition_named_from_a_web_page_is_recorded():
    """„Laut OIB gilt dort seit 16. Juli 2026 die Ausgabe 2025 [2]" (dev, 17:21Z), from a page of the publisher."""
    _gate("none")
    page = SourceEntry(
        url="https://www.oib.or.at/de/inkrafttreten-2015", title="Inkrafttreten", source_type="generic", tool_name="web"
    )
    claims = turn_binding_claims("Laut OIB gilt dort seit 16. Juli 2026 die Ausgabe 2025 [2].", [(page, 2)])
    assert [claim.reason for claim in claims] == ["web_only"]


def test_a_requirement_stated_before_the_records_are_published_is_recorded():
    """The fire-resistance answer of dev, 17:20Z, with coverage none."""
    _gate("none")
    assert [claim.reason for claim in turn_binding_claims(REQUIREMENT, [(GUIDELINE_PASSAGE, 1)])] == [
        "gate_may_not_bind"
    ]


def test_the_same_requirement_is_no_claim_once_the_gate_binds():
    _gate("core")
    assert turn_binding_claims(REQUIREMENT, [(GUIDELINE_PASSAGE, 1)]) == []


def test_the_honest_pre_publication_sentence_is_left_alone():
    _gate("none")
    content = "Welche Ausgabe der OIB-Richtlinie 2 in Wien verbindlich ist, lässt sich derzeit nicht bestimmen."
    assert turn_binding_claims(content, []) == []


def test_a_passage_read_from_the_legal_database_is_not_a_web_source(monkeypatch):
    monkeypatch.setattr(
        web_sources,
        "configured_sources",
        lambda: (SourceHosts(title="Lawbase", country="XR", hosts=("law.example.org",), copy_hosts=()),),
    )
    own = SourceEntry(url="https://law.example.org/code/7", title="Technische Regel 2", source_type="generic")
    assert not module.is_web_source(own)
    assert _claims("Nach Technische Regel 2 sind es 40 m [1].", may_bind=True, cited=((own, 1),)) == []


def test_a_check_that_cannot_run_leaves_the_answer_alone(monkeypatch):
    monkeypatch.setattr(module, "binding_claims", lambda *_args, **_kwargs: 1 / 0)
    assert turn_binding_claims("Ein Satz [1].", [(WEB, 1)]) == []


def test_the_answer_s_scores_are_one_boolean_each_with_counts_and_no_prose(monkeypatch):
    from agent.observability import langfuse_scores

    emitted: list = []
    monkeypatch.setattr(langfuse_scores, "emit_scores", lambda scores, **_: emitted.extend(scores) or len(scores))
    claims = _claims("Nach Technische Regel 2 sind es 40 m [1].", may_bind=True)
    module.score_answer(claims, ["Technische Regel 2"])
    assert [(score.name, score.value, score.comment) for score in emitted] == [
        ("binding-claim-without-records", 1.0, "1 web_only"),
        ("law-cited-from-web", 1.0, "1 work(s)"),
    ]
    emitted.clear()
    module.score_answer([], [])
    assert [(score.name, score.value, score.comment) for score in emitted] == [
        ("binding-claim-without-records", 0.0, None),
        ("law-cited-from-web", 0.0, None),
    ]


def test_the_three_scores_are_declared_as_the_agent_s_or_nothing_is_written():
    """``emit_scores`` refuses a name ``SCORE_DEFINITIONS`` does not hold: an undeclared score is silence."""
    from agent.observability.langfuse_scores import SCORE_DEFINITIONS

    declared = {definition.name: definition for definition in SCORE_DEFINITIONS}
    for name, data_type in (
        ("law-cited-from-web", "BOOLEAN"),
        ("binding-claim-without-records", "BOOLEAN"),
        ("web-sources-withheld", "NUMERIC"),
    ):
        assert declared[name].writer == "agent" and declared[name].data_type == data_type
