from __future__ import annotations

import json

import pytest

from agent.tools.bim import capability_gaps as cg
from agent.tools.bim.measure_register import _build_call


@pytest.fixture(autouse=True)
def _ledger(tmp_path, monkeypatch):
    path = tmp_path / "gaps.jsonl"
    monkeypatch.setenv("CAPABILITY_GAP_LOG", str(path))
    yield path


class TestWhatCountsAsAGap:
    def test_a_measure_that_does_not_exist_is_recorded(self, _ledger):
        answer = _build_call(operation="measure", global_id="g1", measure="wandstaerke")
        assert isinstance(answer, str) and "does not exist" in answer

        rows = cg.read_gaps(_ledger)
        assert [(r["field"], r["askedFor"]) for r in rows] == [("measure", "wandstaerke")]
        assert "clearHeight" in rows[0]["known"]

    def test_an_operation_the_model_invented_is_recorded(self, _ledger):
        _build_call(operation="schallschutz")
        assert [r["askedFor"] for r in cg.read_gaps(_ledger)] == ["schallschutz"]

    def test_each_grouped_aspect_has_its_own_field(self, _ledger):
        _build_call(operation="envelope", kind="uValue")
        _build_call(operation="fire", kind="rauchabschnitt")
        fields = {r["field"] for r in cg.read_gaps(_ledger)}
        assert fields == {"envelope.kind", "fire.kind"}


class TestWhatMustNeverBeRecorded:
    def test_a_call_that_works_writes_nothing(self, _ledger):
        assert _build_call(operation="measure", global_id="g1", measure="clearHeight")[0] == "measure"
        assert cg.read_gaps(_ledger) == []

    def test_a_missing_argument_is_the_callers_mistake_not_our_gap(self, _ledger):
        answer = _build_call(operation="measure", measure="clearHeight")
        assert isinstance(answer, str) and "needs a global_id" in answer
        assert cg.read_gaps(_ledger) == []

    def test_an_export_that_cannot_answer_is_a_finding_about_the_file(self, _ledger):
        cg.record_gap(surface="ifc_measure", field="measure", asked_for="")
        assert cg.read_gaps(_ledger) == []


class TestTheRowKeepsTheVocabularyAndNotTheBuilding:
    def test_no_global_id_or_measured_value_can_reach_a_row(self, _ledger):
        _build_call(operation="measure", global_id="3cUkl32yn9qRSPvBJVyWcE", measure="wandstaerke")
        text = json.dumps(cg.read_gaps(_ledger), ensure_ascii=False)
        assert "3cUkl32yn9qRSPvBJVyWcE" not in text
        assert set(cg.read_gaps(_ledger)[0]) == {"at", "surface", "field", "askedFor", "known"}

    def test_a_pasted_paragraph_cannot_fill_the_disk(self, _ledger):
        cg.record_gap(surface="ifc_measure", field="measure", asked_for="x" * 5000)
        assert len(cg.read_gaps(_ledger)[0]["askedFor"]) == cg.MAX_VALUE_CHARS

    def test_a_value_with_newlines_stays_one_row(self, _ledger):
        cg.record_gap(surface="ifc_measure", field="measure", asked_for="wand\nstaerke\r\n")
        assert _ledger.read_text(encoding="utf-8").count("\n") == 1
        assert cg.read_gaps(_ledger)[0]["askedFor"] == "wandstaerke"

    def test_the_ledger_stops_growing_at_the_cap(self, _ledger):
        _ledger.write_text("x" * (cg.MAX_BYTES + 1), encoding="utf-8")
        cg.record_gap(surface="ifc_measure", field="measure", asked_for="wandstaerke")
        assert cg.read_gaps(_ledger) == []


class TestTheReportIsRankedByWhatToBuildNext:
    def test_the_most_wanted_thing_comes_first(self, _ledger):
        for _ in range(3):
            _build_call(operation="measure", global_id="g1", measure="wandstaerke")
        _build_call(operation="measure", global_id="g1", measure="uWert")

        ranked = cg.summarise(_ledger)
        assert [(r["askedFor"], r["count"]) for r in ranked] == [("wandstaerke", 3), ("uWert", 1)]

        report = cg.render_report(_ledger)
        assert report.index("wandstaerke") < report.index("uWert")
        assert "Wunschliste" in report

    def test_an_empty_ledger_says_so_rather_than_printing_a_bare_table(self, _ledger):
        assert "Keine Lücken erfasst" in cg.render_report(_ledger)


class TestWritingIsNeverAllowedToBreakAnAnswer:
    def test_an_unwritable_ledger_does_not_fail_the_call(self, monkeypatch, tmp_path):
        monkeypatch.setenv("CAPABILITY_GAP_LOG", str(tmp_path / "nope" / "gaps.jsonl"))

        def _explode(*_args, **_kwargs):
            raise OSError("read-only file system")

        monkeypatch.setattr(cg.Path, "mkdir", _explode)
        answer = _build_call(operation="measure", global_id="g1", measure="wandstaerke")
        assert isinstance(answer, str) and "does not exist" in answer

    def test_a_corrupt_line_is_skipped_rather_than_raised(self, _ledger):
        _ledger.write_text('{"askedFor": "gut"}\nnot json at all\n', encoding="utf-8")
        assert [r["askedFor"] for r in cg.read_gaps(_ledger)] == ["gut"]


class TestTheLedgerIsNotSomewhereAnyoneElseCanReachIt:
    def test_the_default_is_not_a_shared_directory(self, monkeypatch, tmp_path):
        monkeypatch.delenv("CAPABILITY_GAP_LOG", raising=False)
        monkeypatch.setenv("XDG_STATE_HOME", str(tmp_path / "state"))
        assert cg.default_path() == tmp_path / "state" / "aiq" / "capability-gaps.jsonl"

    def test_the_env_override_still_wins_because_an_operator_chose_it(self, monkeypatch, tmp_path):
        monkeypatch.setenv("CAPABILITY_GAP_LOG", str(tmp_path / "chosen.jsonl"))
        assert cg.ledger_path() == tmp_path / "chosen.jsonl"

    def test_a_symlink_on_the_path_is_refused_rather_than_followed(self, monkeypatch, tmp_path):
        victim = tmp_path / "someone-elses-file"
        victim.write_text("important\n", encoding="utf-8")
        link = tmp_path / "gaps.jsonl"
        link.symlink_to(victim)
        monkeypatch.setenv("CAPABILITY_GAP_LOG", str(link))

        cg.record_gap(surface="ifc_measure", field="measure", asked_for="wandstaerke")

        assert victim.read_text(encoding="utf-8") == "important\n"

    def test_the_file_is_not_readable_by_other_users(self, monkeypatch, tmp_path):
        target = tmp_path / "nested" / "gaps.jsonl"
        monkeypatch.setenv("CAPABILITY_GAP_LOG", str(target))

        cg.record_gap(surface="ifc_measure", field="measure", asked_for="wandstaerke")

        assert target.exists()
        assert target.stat().st_mode & 0o077 == 0, "group/other can read the model-authored values"
        assert target.parent.stat().st_mode & 0o077 == 0, "the directory is browsable by others"


class TestAMissIsAnErrorSoItBecomesAnIssue:
    @pytest.fixture(autouse=True)
    def _fresh(self):
        cg.reset_escalations_for_tests()
        yield
        cg.reset_escalations_for_tests()

    def test_a_miss_is_logged_at_error_with_the_fields_an_issue_needs(self, caplog, _ledger):
        with caplog.at_level("ERROR", logger=cg.logger.name):
            _build_call(operation="measure", global_id="g1", measure="wandstaerke")

        record = next(r for r in caplog.records if getattr(r, "ifc_capability_gap", False))
        assert record.levelname == "ERROR"
        assert record.ifc_gap_field == "measure"
        assert record.ifc_gap_asked_for == "wandstaerke"
        assert record.ifc_gap_surface == "ifc_measure"
        assert "clearHeight" in record.ifc_gap_known

    def test_the_same_miss_is_escalated_once_however_often_it_repeats(self, caplog, _ledger):
        with caplog.at_level("ERROR", logger=cg.logger.name):
            for _ in range(25):
                _build_call(operation="measure", global_id="g1", measure="wandstaerke")

        escalated = [r for r in caplog.records if getattr(r, "ifc_capability_gap", False)]
        assert len(escalated) == 1
        assert cg.summarise(_ledger)[0]["count"] == 25

    def test_a_different_miss_is_still_escalated(self, caplog, _ledger):
        with caplog.at_level("ERROR", logger=cg.logger.name):
            _build_call(operation="measure", global_id="g1", measure="wandstaerke")
            _build_call(operation="measure", global_id="g1", measure="uWert")
        assert len([r for r in caplog.records if getattr(r, "ifc_capability_gap", False)]) == 2

    def test_a_model_inventing_a_new_word_every_turn_cannot_page_all_night(self, caplog, _ledger):
        with caplog.at_level("ERROR", logger=cg.logger.name):
            for index in range(cg.MAX_ESCALATIONS + 20):
                _build_call(operation="measure", global_id="g1", measure=f"erfundenes_mass_{index}")

        escalated = [r for r in caplog.records if getattr(r, "ifc_capability_gap", False)]
        assert len(escalated) == cg.MAX_ESCALATIONS
        assert len(cg.read_gaps(_ledger)) == cg.MAX_ESCALATIONS + 20

    def test_only_a_name_shaped_value_leaves_the_process(self, caplog, _ledger):
        pasted = "hier ist der ganze Raum: 3cUkl32yn9qRSPvBJVyWcE, 15.42 m², Bedroom @ 2.47 m"
        with caplog.at_level("ERROR", logger=cg.logger.name):
            cg.record_gap(surface="ifc_measure", field="measure", asked_for=pasted)

        record = next(r for r in caplog.records if getattr(r, "ifc_capability_gap", False))
        assert record.ifc_gap_asked_for == cg.UNEXPORTABLE
        assert "3cUkl32yn9qRSPvBJVyWcE" not in json.dumps(record.__dict__, default=str)
        assert cg.read_gaps(_ledger)[0]["askedFor"].startswith("hier ist der ganze Raum")

    def test_a_german_measure_name_is_exported_as_written(self, caplog, _ledger):
        with caplog.at_level("ERROR", logger=cg.logger.name):
            cg.record_gap(surface="ifc_measure", field="measure", asked_for="lichte Raumhöhe-2")
        record = next(r for r in caplog.records if getattr(r, "ifc_capability_gap", False))
        assert record.ifc_gap_asked_for == "lichte Raumhöhe-2"

    def test_a_broken_logger_does_not_break_the_answer(self, monkeypatch, _ledger):

        def _explode(*_args, **_kwargs):
            raise RuntimeError("the collector is on fire")

        monkeypatch.setattr(cg.logger, "error", _explode)
        answer = _build_call(operation="measure", global_id="g1", measure="wandstaerke")
        assert isinstance(answer, str) and "does not exist" in answer
        assert cg.read_gaps(_ledger)[0]["askedFor"] == "wandstaerke"
