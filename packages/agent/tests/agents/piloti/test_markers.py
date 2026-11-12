"""Tests for the answer's control markers: escalation, confidence, and the guard."""

import sys
from urllib.parse import urlparse

from agent.agents.piloti.markers import ESCALATION_MARKER
from agent.agents.piloti.markers import detect_and_strip_confidence_marker
from agent.agents.piloti.markers import detect_and_strip_escalation_marker
from agent.agents.piloti.markers import surface_answer_confidence


class TestDetectAndStripEscalationMarker:
    """Tests for detect_and_strip_escalation_marker."""

    def test_marker_on_own_final_line(self):
        content = "Here is my best partial answer.\n\n" + ESCALATION_MARKER
        stripped, present = detect_and_strip_escalation_marker(content)
        assert present is True
        assert ESCALATION_MARKER not in stripped
        assert stripped == "Here is my best partial answer."
        # No trailing blank lines left behind.
        assert not stripped.endswith("\n")

    def test_marker_mid_text(self):
        content = f"Partial answer {ESCALATION_MARKER} continues here."
        stripped, present = detect_and_strip_escalation_marker(content)
        assert present is True
        assert ESCALATION_MARKER not in stripped

    def test_marker_absent(self):
        content = "A perfectly adequate answer with references."
        stripped, present = detect_and_strip_escalation_marker(content)
        assert present is False
        assert stripped == content

    def test_marker_only(self):
        content = ESCALATION_MARKER
        stripped, present = detect_and_strip_escalation_marker(content)
        assert present is True
        assert stripped == ""

    def test_multiple_occurrences_removed(self):
        content = f"{ESCALATION_MARKER} answer body {ESCALATION_MARKER}\n{ESCALATION_MARKER}"
        stripped, present = detect_and_strip_escalation_marker(content)
        assert present is True
        assert ESCALATION_MARKER not in stripped

    def test_non_str_content_unchanged(self):
        content = [{"type": "text", "text": "structured content"}]
        stripped, present = detect_and_strip_escalation_marker(content)
        assert present is False
        assert stripped is content

    def test_marker_quoted_above_tail_region_is_untouched(self):
        # The marker is quoted inside an explanation well above the last three
        # non-empty lines → body text, not a trailing signal.
        content = (
            f"When I lack enough evidence I append {ESCALATION_MARKER} to my reply.\n"
            "Here, however, I found what you asked for.\n"
            "The OIB-Richtlinie 2 governs fire safety.\n"
            "It applies to buildings above 22 metres.\n"
            "See the reference below [1]."
        )
        stripped, present = detect_and_strip_escalation_marker(content)
        assert present is False
        assert ESCALATION_MARKER in stripped
        assert stripped == content

    def test_marker_in_tail_after_references_detected(self):
        # A trailing marker following a References section is still in the tail.
        content = (
            "Partial answer grounded in one source [1].\n\n"
            "**References:**\n"
            "- [1] Example - https://example.com\n"
            f"{ESCALATION_MARKER}"
        )
        stripped, present = detect_and_strip_escalation_marker(content)
        assert present is True
        assert ESCALATION_MARKER not in stripped
        assert urlparse(stripped.split()[-1]).hostname == "example.com"


class TestDetectAndStripConfidenceMarker:
    """Tests for detect_and_strip_confidence_marker."""

    def test_high_marker_on_own_final_line(self):
        content = "OIB-Richtlinie 2 regelt den Brandschutz [1].\n\n[CONFIDENCE:high]"
        stripped, level, _reason = detect_and_strip_confidence_marker(content)
        assert level == "high"
        assert "[CONFIDENCE" not in stripped
        assert stripped == "OIB-Richtlinie 2 regelt den Brandschutz [1]."
        assert not stripped.endswith("\n")

    def test_medium_and_low_values(self):
        for value in ("medium", "low"):
            stripped, level, _reason = detect_and_strip_confidence_marker(f"Answer.\n[CONFIDENCE:{value}]")
            assert level == value
            assert "[CONFIDENCE" not in stripped

    def test_case_insensitive_and_whitespace_tolerant(self):
        stripped, level, _reason = detect_and_strip_confidence_marker("Answer.\n[confidence: HIGH ]")
        assert level == "high"
        assert "[confidence" not in stripped.lower()

    def test_absent_marker(self):
        content = "A perfectly adequate answer with references [1]."
        stripped, level, _reason = detect_and_strip_confidence_marker(content)
        assert level is None
        assert stripped == content

    def test_malformed_value_stripped_but_no_signal(self):
        # Unknown value: never shown to the user, but yields no signal.
        content = "Answer.\n[CONFIDENCE:certain]"
        stripped, level, _reason = detect_and_strip_confidence_marker(content)
        assert level is None
        assert "[CONFIDENCE" not in stripped
        assert stripped == "Answer."

    def test_empty_value_stripped_but_no_signal(self):
        stripped, level, _reason = detect_and_strip_confidence_marker("Answer.\n[CONFIDENCE:]")
        assert level is None
        assert "[CONFIDENCE" not in stripped

    def test_last_valid_marker_wins(self):
        content = "Answer.\n[CONFIDENCE:low]\n[CONFIDENCE:high]"
        stripped, level, _reason = detect_and_strip_confidence_marker(content)
        assert level == "high"
        assert "[CONFIDENCE" not in stripped

    def test_combined_with_escalation_marker_any_order(self):
        # Both markers present, confidence before escalation (prompt-defined order).
        content = f"Partial answer.\n[CONFIDENCE:low]\n{ESCALATION_MARKER}"
        without_esc, esc_present = detect_and_strip_escalation_marker(content)
        assert esc_present is True
        stripped, level, _reason = detect_and_strip_confidence_marker(without_esc)
        assert level == "low"
        assert "[CONFIDENCE" not in stripped
        assert ESCALATION_MARKER not in stripped
        assert stripped == "Partial answer."

        # Reversed order — detection is order-insensitive.
        reversed_content = f"Partial answer.\n{ESCALATION_MARKER}\n[CONFIDENCE:high]"
        stripped2, level2, _reason2 = detect_and_strip_confidence_marker(reversed_content)
        without_esc2, esc_present2 = detect_and_strip_escalation_marker(stripped2)
        assert esc_present2 is True
        assert level2 == "high"
        assert "[CONFIDENCE" not in without_esc2
        assert ESCALATION_MARKER not in without_esc2

    def test_marker_quoted_above_tail_region_is_untouched(self):
        # A quoted marker inside an explanation, several lines above the tail,
        # must be left intact and yield no signal.
        content = (
            "The answer contract asks me to end with [CONFIDENCE:high] or similar.\n"
            "In this case I am confident in the finding below.\n"
            "OIB-Richtlinie 2 regelt den Brandschutz.\n"
            "Sie gilt für Gebäude über 22 Metern.\n"
            "Details siehe Quelle [1]."
        )
        stripped, level, _reason = detect_and_strip_confidence_marker(content)
        assert level is None
        assert "[CONFIDENCE:high]" in stripped
        assert stripped == content

    def test_marker_in_tail_after_references_detected(self):
        # A trailing confidence marker after a References block is in the tail.
        content = (
            "OIB-Richtlinie 2 regelt den Brandschutz [1].\n\n"
            "**References:**\n"
            "- [1] Example - https://example.com\n"
            "[CONFIDENCE:high]"
        )
        stripped, level, _reason = detect_and_strip_confidence_marker(content)
        assert level == "high"
        assert "[CONFIDENCE" not in stripped
        assert urlparse(stripped.split()[-1]).hostname == "example.com"

    def test_non_str_content_unchanged(self):
        content = [{"type": "text", "text": "structured content"}]
        stripped, level, _reason = detect_and_strip_confidence_marker(content)
        assert level is None
        assert stripped is content


class TestConfidenceMarkerReason:
    """Tests for the optional `| reason` payload on the confidence marker."""

    def test_reason_parsed_and_marker_stripped(self):
        content = "OIB 2 [1].\n[CONFIDENCE:high | Direkt durch OIB-RL 2 belegt]"
        stripped, level, reason = detect_and_strip_confidence_marker(content)
        assert level == "high"
        assert reason == "Direkt durch OIB-RL 2 belegt"
        assert stripped == "OIB 2 [1]."

    def test_no_reason_yields_none(self):
        _stripped, level, reason = detect_and_strip_confidence_marker("Answer.\n[CONFIDENCE:medium]")
        assert level == "medium"
        assert reason is None

    def test_reason_whitespace_only_yields_none(self):
        _stripped, level, reason = detect_and_strip_confidence_marker("Answer.\n[CONFIDENCE:low |  ]")
        assert level == "low"
        assert reason is None

    def test_reason_keeps_content_after_first_separator(self):
        # Partition on the FIRST `|`: later separators are part of the reason.
        _stripped, level, reason = detect_and_strip_confidence_marker("Answer.\n[CONFIDENCE:low | a | b]")
        assert level == "low"
        assert reason == "a | b"

    def test_reason_capped_at_300_chars(self):
        long_reason = "x" * 400
        _stripped, level, reason = detect_and_strip_confidence_marker(f"Answer.\n[CONFIDENCE:high | {long_reason}]")
        assert level == "high"
        assert reason == "x" * 300

    def test_invalid_level_discards_reason(self):
        # An unknown level never invents a signal — and a reason without a
        # valid level is meaningless.
        stripped, level, reason = detect_and_strip_confidence_marker("Answer.\n[CONFIDENCE:certain | whatever]")
        assert level is None
        assert reason is None
        assert "[CONFIDENCE" not in stripped

    def test_last_valid_marker_wins_with_reason(self):
        content = "Answer.\n[CONFIDENCE:low | erster Grund]\n[CONFIDENCE:high | zweiter Grund]"
        _stripped, level, reason = detect_and_strip_confidence_marker(content)
        assert level == "high"
        assert reason == "zweiter Grund"

    def test_reason_survives_case_insensitive_marker(self):
        _stripped, level, reason = detect_and_strip_confidence_marker("Answer.\n[confidence: HIGH | Grund]")
        assert level == "high"
        assert reason == "Grund"


class TestSurfaceAnswerConfidence:
    """Tests for the deterministic overconfidence guard."""

    def test_none_self_report_surfaces_nothing(self):
        assert surface_answer_confidence(None, True) is None
        assert surface_answer_confidence(None, False) is None

    def test_grounded_answer_surfaces_verbatim(self):
        assert surface_answer_confidence("high", True) == "high"
        assert surface_answer_confidence("medium", True) == "medium"
        assert surface_answer_confidence("low", True) == "low"

    def test_ungrounded_answer_capped_to_low(self):
        assert surface_answer_confidence("high", False) == "low"
        assert surface_answer_confidence("medium", False) == "low"
        assert surface_answer_confidence("low", False) == "low"


# The law gate (staging QC F6, ADR-0175): building law the records do not settle caps a checked level.
# Read off the module the names above come from, so this file names the package no more often than before.
_markers = sys.modules[surface_answer_confidence.__module__]
checked_confidence_capped_reason = _markers.checked_confidence_capped_reason
surface_checked_confidence = _markers.surface_checked_confidence


def test_the_law_gate_holds_a_checked_high_to_medium_and_names_itself():
    assert surface_checked_confidence("high", law_unsettled=True) == "medium"
    assert checked_confidence_capped_reason("high", law_unsettled=True) == "law_unsettled"
    assert surface_checked_confidence("low", law_unsettled=True) == "low"
    assert checked_confidence_capped_reason("low", law_unsettled=True) is None
    # The quote gate speaks first when both lower the level.
    assert checked_confidence_capped_reason("high", quotes_verified=False, law_unsettled=True) == "quote_unverified"


# The open-point cap (golden at-a6, 2026-11-12): an answer that names a gap of its own is not high.
answer_names_open_point = _markers.answer_names_open_point


def test_an_open_point_the_answer_names_holds_a_checked_high_to_medium_and_names_itself():
    assert surface_checked_confidence("high", open_point=True) == "medium"
    assert checked_confidence_capped_reason("high", open_point=True) == "open_point"
    assert surface_checked_confidence("low", open_point=True) == "low"
    assert checked_confidence_capped_reason("low", open_point=True) is None
    assert checked_confidence_capped_reason("high", law_unsettled=True, open_point=True) == "law_unsettled"
    assert checked_confidence_capped_reason("high", quotes_verified=False, open_point=True) == "quote_unverified"


def test_an_open_point_is_one_the_check_read_or_a_self_report_below_high():
    assert answer_names_open_point(["Bindung nicht geprüft"], "high") is True
    assert answer_names_open_point([], "medium") is True
    assert answer_names_open_point([], "low") is True
    assert answer_names_open_point([], "high") is False
    assert answer_names_open_point([], None) is False
