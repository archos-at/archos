from __future__ import annotations

from agent.common import german_text as g


def test_austrian_eszett_folds_so_a_german_keyboard_still_finds_the_corpus() -> None:
    assert g.fold("Geschoß") == g.fold("Geschoss")
    assert g.fold("Straße") == g.fold("Strasse")


def test_umlauts_fold_consistently_on_both_sides() -> None:
    assert g.fold("Gebäude") == g.fold("Gebaude")
    assert g.fold("Öffnung")[0] == g.fold("Offnung")[0]


def test_every_inflected_form_of_one_lemma_reaches_the_same_lexeme() -> None:
    forms = ["Fluchtweg", "Fluchtwege", "Fluchtwegen", "Fluchtweges", "Fluchtwegs"]
    assert len({g.stem(g.fold(form)) for form in forms}) == 1


def test_the_same_analyzer_serves_the_index_and_the_query() -> None:
    indexed = g.analyze("Die nutzbare Breite von Fluchtwegen")
    queried = g.analyze("Wie breit ist der Fluchtweg?")
    assert "fluchtweg" in indexed
    assert "fluchtweg" in queried


def test_single_characters_carry_no_signal_but_digits_do() -> None:
    assert "4" in g.analyze("Gebaeudeklasse 4")
    assert all(len(lexeme) >= 2 or lexeme.isdigit() for lexeme in g.analyze("a b Fluchtweg 4"))


def test_glossary_terms_are_analyzed_alongside_the_query_and_lead_it() -> None:
    lexemes = g.analyze_query("escape route width", extra_terms=["Fluchtweg Breite"])
    assert lexemes[:2] == ["fluchtweg", "breit"]
    assert "escap" in lexemes, "the original wording is kept, not replaced"


def test_an_english_query_without_a_glossary_term_yields_no_german_lexemes() -> None:
    lexemes = g.analyze_query("escape route width")
    assert "fluchtweg" not in lexemes


def test_a_term_in_almost_every_chunk_is_dropped_before_searching() -> None:
    terms = ["oib", "fluchtweg"]
    frequencies = {"oib": 467, "fluchtweg": 12}
    assert g.select_terms(terms, frequencies, total=490) == ["fluchtweg"]


def test_a_small_corpus_does_not_have_its_terms_thinned_away() -> None:
    terms = ["oib", "fluchtweg"]
    frequencies = {"oib": 9, "fluchtweg": 1}
    assert g.select_terms(terms, frequencies, total=10) == terms


def test_a_query_made_only_of_corpus_wide_words_selects_nothing() -> None:
    terms = ["oib", "richtlinie"]
    frequencies = {"oib": 480, "richtlinie": 470}
    assert g.select_terms(terms, frequencies, total=490) == []


def test_terms_are_combined_disjunctively() -> None:
    assert "|" in g.build_tsquery(["fluchtweg", "breit"])
    assert "&" not in g.build_tsquery(["fluchtweg", "breit"])


def test_empty_and_missing_input_is_safe_everywhere() -> None:
    for value in (None, "", "   "):
        assert g.fold(value) == "" or g.fold(value).isspace()
        assert g.analyze(value) == []
        assert g.query_terms(value) == []
    assert g.build_tsquery([]) == ""


def test_the_sqlite_index_blob_is_delimited_so_a_prefix_cannot_match_a_word() -> None:
    blob = g.index_blob("Fluchtwege im Geschoß")
    assert blob.startswith(" ") and blob.endswith(" ")
    assert g.like_pattern("fluchtweg").strip("%").strip() == "fluchtweg"
    assert " fluchtweg " in blob
    assert " weg " not in blob, "a suffix of a compound must not match as a word"
