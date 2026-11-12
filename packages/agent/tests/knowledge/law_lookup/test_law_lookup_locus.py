"""The citation grammar is the record's: a locus in another language reads its own references.

The RIS record's grammar is held by the ported address and grammar suites; this
one holds that nothing of it is in the code, with a locus no record ships.
"""

from __future__ import annotations

from public_sources.lookup import Locus

from agent.knowledge.law_lookup.address import _first_section
from agent.knowledge.law_lookup.address import _list_from
from agent.knowledge.law_lookup.locus import compile_grammar
from agent.knowledge.law_lookup.sections import split_sections
from agent.knowledge.law_lookup.sections import subsection_body

_LOCUS = Locus(
    units=({"sign": "Art", "forms": ("Article", "Art"), "dot": True},),
    subsection=("para", "paragraph"),
    item=("point",),
    conjunctions=("and",),
    range_words=("to",),
    see_also=("see",),
)
_GRAMMAR = compile_grammar(_LOCUS)


def _sections_named(text: str) -> tuple[str, ...]:
    kind, _number, where = _first_section(text, _GRAMMAR)
    return _list_from(text, kind, where, _GRAMMAR)[0]


def test_a_list_and_a_range_read_in_the_records_words():
    assert _sections_named("Article 5 and 7 of the Act") == ("5", "7")
    assert _sections_named("Art. 3 to 5 of the Act") == ("3", "4", "5")
    assert _sections_named("Art. 3-5") == ("3", "4", "5")


def test_a_part_after_a_provision_is_a_qualifier_not_a_provision():
    assert _sections_named("Article 5 para 2 and 3 of the Act") == ("5",)
    assert _GRAMMAR.subsection.search("Article 5 paragraph 2").group(1) == "2"


def test_a_german_sign_is_nothing_to_this_grammar():
    assert _first_section("§ 63 Abs 1", _GRAMMAR) == ("", "", -1)


def test_the_text_splits_on_the_records_sign():
    text = "Scope\nArticle 1. (1) This Act applies.\n(2) It binds.\nArticle 2. Definitions follow."
    sections = split_sections(text, _GRAMMAR)
    assert [s.label for s in sections] == ["Art 1", "Art 2"]
    assert subsection_body(sections[0], "2", _GRAMMAR) == ("(2) It binds.", "2")
