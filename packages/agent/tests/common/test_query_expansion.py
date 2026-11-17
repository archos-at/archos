from __future__ import annotations

import pytest

from agent.common.query_expansion import augmented_query
from agent.common.query_expansion import detect_language
from agent.common.query_expansion import expansion_terms


@pytest.fixture(autouse=True)
def _fresh_vocabulary():
    from agent.common.query_expansion import reset_vocabulary_cache

    reset_vocabulary_cache()
    yield
    reset_vocabulary_cache()


def test_an_english_question_gains_the_corpus_own_german_terms() -> None:
    augmented = augmented_query("What are the facade requirements for building class 4 and 5?")
    assert "Fassade" in augmented
    assert "Gebäudeklasse" in augmented


def test_the_users_own_words_are_never_replaced() -> None:
    question = "What applies to smoke alarms in dwellings?"
    assert question in augmented_query(question)


def test_german_terms_lead_because_encoders_weight_early_tokens() -> None:
    augmented = augmented_query("What are the requirements for escape routes?")
    assert augmented.startswith("Fluchtweg")


def test_a_german_question_is_returned_untouched() -> None:
    for question in ("Wie breit muss ein Fluchtweg sein?", "Welche Anforderungen gelten für Fassaden?"):
        assert augmented_query(question) == question


def test_an_english_question_the_glossary_does_not_know_is_unchanged() -> None:
    question = "What is the quarterly revenue forecast?"
    assert augmented_query(question) == question


def test_a_miss_is_logged_once_per_query_and_not_by_a_second_expansion(caplog) -> None:
    question = "What is the quarterly revenue forecast?"
    with caplog.at_level("INFO", logger="agent.common.query_expansion"):
        augmented_query(question)
        augmented_query(question, log_miss=False)
    assert len([r for r in caplog.records if "no glossary concept" in r.getMessage()]) == 1


def test_a_glossary_term_inside_a_longer_word_is_not_a_match() -> None:
    assert expansion_terms("What fire proofing is required?") == []
    assert expansion_terms("Is uplift resistance covered?") == []
    assert expansion_terms("What about stairwell pressurisation?") == []


def test_a_plural_the_glossary_does_not_list_still_matches() -> None:
    assert "Dach" in expansion_terms("What about roofs?")
    assert "Garage" in expansion_terms("Requirements for garages?")


def test_the_longest_form_wins_across_concepts_not_only_within_one() -> None:
    terms = expansion_terms("How far is the fire brigade access road?")
    assert "Aufstellfläche" in terms, "the longer `fire brigade access` must claim the span"


def test_the_longest_concept_wins_so_a_broader_one_cannot_shadow_it() -> None:
    terms = expansion_terms("What are the external wall requirements for building class 4?")
    assert "Außenwand" in terms
    assert "Gebäudeklasse" in terms


def test_a_hyphenated_compound_matches_the_spaced_glossary_form() -> None:
    assert "Feuerwehrzufahrt" in expansion_terms("How far is the fire-brigade access road?")
    assert "U-Wert" in expansion_terms("What u-value applies to an external wall?")
    assert "barrierefrei" in expansion_terms("Is a step-free entrance required?")


def test_hyphenated_and_spaced_spellings_are_the_same_lookup() -> None:
    assert expansion_terms("fire-brigade access") == expansion_terms("fire brigade access")


def test_the_terms_the_corpus_uses_for_sound_are_the_ones_offered() -> None:
    assert "Trittschall" in expansion_terms("What impact sound level is permitted?")
    assert "Luftschall" in expansion_terms("What airborne sound insulation is required?")
    assert "Luftschalldämmung" not in expansion_terms("What airborne sound insulation is required?")


def test_the_austrian_spelling_is_the_one_offered() -> None:
    assert "Geschoß" in expansion_terms("How many storeys are permitted?")


def test_language_detection_admits_when_it_does_not_know() -> None:
    assert detect_language("Fluchtweg") == "unknown"
    assert detect_language("") == "unknown"
    assert detect_language(None) == "unknown"


def test_a_german_character_settles_the_language_immediately() -> None:
    assert detect_language("Wie breit muss ein Fluchtweg für Gebäude sein?") == "de"


def test_expansion_is_deterministic() -> None:
    question = "What are the fire compartment requirements?"
    assert augmented_query(question) == augmented_query(question)


def test_empty_and_missing_input_is_safe() -> None:
    for value in (None, "", "   "):
        assert augmented_query(value) in ("", value or "")
        assert expansion_terms(value) == []


def test_a_missing_glossary_disables_expansion_rather_than_retrieval(monkeypatch) -> None:
    from pathlib import Path

    from agent.common import query_expansion

    monkeypatch.setattr(query_expansion, "VOCABULARY_PATH", Path("/nonexistent/vocabulary.yml"))
    query_expansion.reset_vocabulary_cache()
    question = "What are the facade requirements?"
    assert augmented_query(question) == question
