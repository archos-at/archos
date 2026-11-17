from __future__ import annotations

import pytest

from agent.tools.tasks import register as task_tools
from agent.tools.tasks.client import DelegationError

from .conftest import ACCEPTED
from .conftest import ENVELOPE_HEADER
from .conftest import ENVELOPE_SIG
from .conftest import PROJECT
from .conftest import bind_context
from .conftest import envelope
from .conftest import raiser
from .conftest import responder
from .conftest import task_cards


class TestTheWire:
    async def test_it_posts_a_create_with_the_project_kind_and_goal(self, monkeypatch, calls) -> None:
        responder(monkeypatch, ACCEPTED, calls)
        await task_tools.run_create_task("submission_check", "Mach den Einreichcheck bis Freitag")

        payload, _ = calls[0]
        assert payload["op"] == "create"
        assert payload["projectId"] == PROJECT
        assert payload["kind"] == "submission_check"
        assert payload["goal"] == "Mach den Einreichcheck bis Freitag"

    async def test_the_old_name_of_a_kind_is_sent_by_the_new_one(self, monkeypatch, calls) -> None:
        responder(monkeypatch, ACCEPTED, calls)
        await task_tools.run_create_task("einreichcheck", "Prüf das")

        assert calls[0][0]["kind"] == "submission_check"

    async def test_it_echoes_the_envelope_unchanged(self, monkeypatch, calls) -> None:
        responder(monkeypatch, ACCEPTED, calls)
        await task_tools.run_create_task("submission_check", "Prüf das")

        _, envelope = calls[0]
        assert envelope.header == ENVELOPE_HEADER
        assert envelope.signature == ENVELOPE_SIG

    async def test_a_due_date_is_forwarded_and_an_empty_one_is_omitted(self, monkeypatch, calls) -> None:
        responder(monkeypatch, ACCEPTED, calls)
        await task_tools.run_create_task("submission_check", "Prüf das", "2026-09-18")
        assert calls[0][0]["due"] == "2026-09-18"

        await task_tools.run_create_task("submission_check", "Prüf das", "   ")
        assert "due" not in calls[1][0]

    async def test_the_goal_is_collapsed_and_bounded(self, monkeypatch, calls) -> None:
        responder(monkeypatch, ACCEPTED, calls)
        await task_tools.run_create_task("document", "  Schreib   den\n  Aktenvermerk  ")
        assert calls[0][0]["goal"] == "Schreib den Aktenvermerk"

        await task_tools.run_create_task("document", "x" * (task_tools.MAX_GOAL_CHARS + 50))
        assert len(calls[1][0]["goal"]) == task_tools.MAX_GOAL_CHARS

    async def test_a_cadence_is_forwarded_and_an_empty_one_is_omitted(self, monkeypatch, calls) -> None:
        responder(monkeypatch, ACCEPTED, calls)
        await task_tools.run_create_task("submission_check", "Prüf das", cadence="0 8 * * 1")
        assert calls[0][0]["cadence"] == "0 8 * * 1"

        await task_tools.run_create_task("submission_check", "Prüf das", cadence="   ")
        assert "cadence" not in calls[1][0]


class TestRefusals:
    async def test_a_run_with_no_envelope_delegates_nothing(self, monkeypatch, calls) -> None:
        responder(monkeypatch, ACCEPTED, calls)
        bind_context(monkeypatch, headers={"x-grid-project-id": PROJECT}, conversation_id="conv-1")

        answer = await task_tools.run_create_task("submission_check", "Prüf das")
        assert "signed session credential" in answer
        assert calls == []

    async def test_a_turn_with_no_project_delegates_nothing(self, monkeypatch, calls) -> None:
        responder(monkeypatch, ACCEPTED, calls)
        header, signature = envelope(
            {"organizationId": "org_1", "userId": "user_1", "conversationId": "conv-1", "issuedAt": 1_757_500_000_000}
        )
        bind_context(
            monkeypatch,
            headers={"x-grid-request-context": header, "x-grid-request-context-sig": signature},
            conversation_id="conv-1",
        )

        answer = await task_tools.run_create_task("submission_check", "Prüf das")
        assert "no project" in answer
        assert calls == []

    async def test_an_unknown_kind_is_refused_with_the_set_named(self, monkeypatch, calls) -> None:
        responder(monkeypatch, ACCEPTED, calls)
        answer = await task_tools.run_create_task("kostenschaetzung", "Rechne das durch")
        assert "not a task kind" in answer
        for kind in task_tools.TASK_KINDS:
            assert kind in answer
        assert calls == []

    async def test_an_empty_goal_is_refused(self, monkeypatch, calls) -> None:
        responder(monkeypatch, ACCEPTED, calls)
        answer = await task_tools.run_create_task("submission_check", "   ")
        assert "description" in answer
        assert calls == []

    async def test_an_overlong_cadence_is_refused_and_nothing_is_posted(self, monkeypatch, calls) -> None:
        responder(monkeypatch, ACCEPTED, calls)
        cadence = ",".join(["0 8 * * 1"] * 20)
        assert len(cadence) > task_tools.MAX_CADENCE_CHARS

        answer = await task_tools.run_create_task("submission_check", "Prüf das", cadence=cadence)

        assert "too long" in answer
        assert calls == []

    async def test_a_refusal_from_the_route_says_nothing_was_created(self, monkeypatch) -> None:
        raiser(monkeypatch, DelegationError("the task API refused the call (403)", status=403))
        answer = await task_tools.run_create_task("submission_check", "Prüf das")
        assert "was not accepted" in answer


class TestWhatTheReaderSees:
    async def test_it_emits_one_task_created_card_from_the_routes_own_answer(
        self, monkeypatch, calls, registry
    ) -> None:
        responder(monkeypatch, ACCEPTED, calls)
        await task_tools.run_create_task("submission_check", "Mach den Einreichcheck bis Freitag", "2026-09-18")

        cards = task_cards(registry)
        assert len(cards) == 1
        assert cards[0]["task_id"] == "task-1"
        assert cards[0]["title"] == "Einreichcheck: Bauansuchen Haus A"
        assert cards[0]["conversation_id"] == "s_conv_2"
        assert cards[0]["due_at"] == "2026-09-18T23:59:59.999Z"
        assert cards[0]["goal"] == "Mach den Einreichcheck bis Freitag"

    async def test_the_answer_says_the_work_is_running_and_not_done(self, monkeypatch, calls) -> None:
        responder(monkeypatch, ACCEPTED, calls)
        answer = await task_tools.run_create_task("submission_check", "Prüf das")
        assert "created" in answer
        assert "NOT done" in answer

    async def test_a_scheduled_answer_says_the_plan_stands_and_nothing_ran_yet(self, monkeypatch, calls) -> None:
        responder(
            monkeypatch,
            {**ACCEPTED, "scheduled": True, "nextRunAt": "2026-09-21T08:00:00.000Z"},
            calls,
        )
        answer = await task_tools.run_create_task("submission_check", "Prüf das jeden Montag", cadence="0 8 * * 1")
        assert "Schedule created" in answer
        assert "not now" in answer
        assert "The first run is planned for 2026-09-21T08:00:00.000Z." in answer
        assert "NOT done" not in answer

    async def test_a_cadence_refusal_from_the_route_is_relayed_verbatim(self, monkeypatch) -> None:
        raiser(
            monkeypatch,
            DelegationError(
                "the task API refused the call (403): Für wiederkehrende Aufträge fehlt die "
                "Berechtigung project:skills:manage.",
                status=403,
                code="FORBIDDEN",
            ),
        )
        answer = await task_tools.run_create_task("document", "Prüf das", cadence="0 8 * * 1")
        assert "project:skills:manage" in answer
        assert "was not accepted" in answer

    async def test_a_missing_card_registry_does_not_cost_the_delegation(self, monkeypatch, calls) -> None:
        responder(monkeypatch, ACCEPTED, calls)
        answer = await task_tools.run_create_task("submission_check", "Prüf das")
        assert "Task created" in answer
        assert len(calls) == 1

    async def test_an_answer_with_no_task_id_emits_no_card(self, monkeypatch, calls, registry) -> None:
        responder(monkeypatch, {**ACCEPTED, "taskId": ""}, calls)
        await task_tools.run_create_task("submission_check", "Prüf das")
        assert task_cards(registry) == []


@pytest.mark.parametrize("kind", ["compliance_check", "submission_check", "document", "revision"])
async def test_every_declared_kind_is_accepted(monkeypatch, calls, kind: str) -> None:
    responder(monkeypatch, {**ACCEPTED, "kind": kind}, calls)
    await task_tools.run_create_task(kind, "Tu das")
    assert calls[0][0]["kind"] == kind
