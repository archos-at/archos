from __future__ import annotations

from unittest import mock

import pytest

from agent_host.jobs.conversation_output import _TRANSPARENCY_METADATA_KEYS
from agent_host.jobs.conversation_output import FAILURE_NOTICE
from agent_host.jobs.conversation_output import _transparency_metadata
from agent_host.jobs.conversation_output import report_message_id
from agent_host.jobs.conversation_output import write_job_notice
from agent_host.jobs.conversation_output import write_job_turn

USAGE = {"identity": {"organization_id": "org_1", "user_id": "u1"}}


def _posts(calls) -> list[dict]:
    return [c.kwargs for c in calls]


@pytest.fixture(autouse=True)
def _no_run_message():
    with mock.patch(
        "agent_host.jobs.conversation_output.post_internal_run_report",
        new_callable=mock.AsyncMock,
        return_value=None,
    ) as report:
        yield report


@pytest.mark.asyncio
async def test_writes_the_question_then_the_answer() -> None:
    with mock.patch(
        "agent_host.jobs.conversation_output.post_internal_conversation_message",
        new_callable=mock.AsyncMock,
    ) as post:
        await write_job_turn(
            conversation_id="s_abc",
            job_id="job-1",
            usage_context=USAGE,
            prompt="Fasse die Woche zusammen.",
            answer="Hier ist die Zusammenfassung.",
            cards=[{"type": "summary"}],
        )

    posts = _posts(post.await_args_list)
    assert [p["role"] for p in posts] == ["user", "assistant"]
    assert posts[0]["text"] == "Fasse die Woche zusammen."
    assert posts[1]["text"] == "Hier ist die Zusammenfassung."
    assert posts[0]["created_at"] < posts[1]["created_at"]
    assert posts[1]["metadata"]["deep_research_job_id"] == "job-1"
    assert posts[1]["metadata"]["cards"] == [{"type": "summary"}]


@pytest.mark.asyncio
async def test_ids_are_deterministic_so_a_retry_is_a_no_op() -> None:
    with mock.patch(
        "agent_host.jobs.conversation_output.post_internal_conversation_message",
        new_callable=mock.AsyncMock,
    ) as post:
        for _ in range(2):
            await write_job_turn(
                conversation_id="s_abc",
                job_id="job-1",
                usage_context=USAGE,
                prompt="q",
                answer="a",
            )

    posts = _posts(post.await_args_list)
    assert posts[0]["message_id"] == posts[2]["message_id"]
    assert posts[1]["message_id"] == posts[3]["message_id"]
    assert posts[0]["message_id"] != posts[1]["message_id"]


@pytest.mark.asyncio
async def test_no_conversation_means_no_call() -> None:
    with mock.patch(
        "agent_host.jobs.conversation_output.post_internal_conversation_message",
        new_callable=mock.AsyncMock,
    ) as post:
        await write_job_turn(conversation_id=None, job_id="job-1", usage_context=USAGE, prompt="q", answer="a")
        await write_job_notice(conversation_id=None, job_id="job-1", usage_context=USAGE, notice=FAILURE_NOTICE)
    post.assert_not_awaited()


@pytest.mark.asyncio
async def test_a_failed_write_never_propagates() -> None:
    with mock.patch(
        "agent_host.jobs.conversation_output.post_internal_conversation_message",
        new_callable=mock.AsyncMock,
        side_effect=RuntimeError("bff down"),
    ):
        await write_job_turn(conversation_id="s_abc", job_id="job-1", usage_context=USAGE, prompt="q", answer="a")
        await write_job_notice(conversation_id="s_abc", job_id="job-1", usage_context=USAGE, notice=FAILURE_NOTICE)


@pytest.mark.asyncio
async def test_a_run_that_produced_nothing_says_so() -> None:
    with mock.patch(
        "agent_host.jobs.conversation_output.post_internal_conversation_message",
        new_callable=mock.AsyncMock,
    ) as post:
        await write_job_notice(
            conversation_id="s_abc",
            job_id="job-1",
            usage_context=USAGE,
            notice=FAILURE_NOTICE,
        )
    posts = _posts(post.await_args_list)
    assert len(posts) == 1
    assert posts[0]["role"] == "assistant"
    assert posts[0]["text"] == FAILURE_NOTICE


@pytest.mark.asyncio
async def test_no_organization_id_skips_rather_than_posting_a_doomed_write() -> None:
    with mock.patch(
        "agent_host.jobs.conversation_output.post_internal_conversation_message",
        new_callable=mock.AsyncMock,
    ) as post:
        await write_job_turn(conversation_id="s_abc", job_id="job-1", usage_context={}, prompt="q", answer="a")
    post.assert_not_awaited()


@pytest.mark.asyncio
async def test_a_job_that_ran_under_a_skill_says_so_in_the_thread() -> None:
    with mock.patch(
        "agent_host.jobs.conversation_output.post_internal_conversation_message",
        new_callable=mock.AsyncMock,
    ) as post:
        await write_job_turn(
            conversation_id="s_abc",
            job_id="job-1",
            usage_context=USAGE,
            prompt="q",
            answer="a",
            skills_activated=["oib-brandschutznachweis"],
        )

    assert _posts(post.await_args_list)[1]["metadata"]["skills_activated"] == ["oib-brandschutznachweis"]


@pytest.mark.asyncio
async def test_a_job_without_skills_writes_no_skills_key() -> None:
    with mock.patch(
        "agent_host.jobs.conversation_output.post_internal_conversation_message",
        new_callable=mock.AsyncMock,
    ) as post:
        await write_job_turn(
            conversation_id="s_abc",
            job_id="job-1",
            usage_context=USAGE,
            prompt="q",
            answer="a",
            skills_activated=[],
        )

    assert "skills_activated" not in _posts(post.await_args_list)[1]["metadata"]


class TestTransparencyReachesTheThread:
    @pytest.mark.asyncio
    async def test_a_cut_off_run_says_so_in_the_thread(self) -> None:
        with mock.patch(
            "agent_host.jobs.conversation_output.post_internal_conversation_message",
            new_callable=mock.AsyncMock,
        ) as post:
            await write_job_turn(
                conversation_id="s_abc",
                job_id="job-1",
                usage_context=USAGE,
                prompt="q",
                answer="a",
                transparency={
                    "research_truncated": True,
                    "truncation_reason": "wall_clock",
                    "degraded_reasons": ["no_valid_citations"],
                    "citations_removed": {"count": 2, "reasons": ["url_not_in_registry"]},
                },
            )

        metadata = _posts(post.await_args_list)[1]["metadata"]
        assert metadata["research_truncated"] is True
        assert metadata["truncation_reason"] == "wall_clock"
        assert metadata["degraded_reasons"] == ["no_valid_citations"]
        assert metadata["citations_removed"] == {"count": 2, "reasons": ["url_not_in_registry"]}

    @pytest.mark.asyncio
    async def test_the_answers_self_assessment_travels_whole(self) -> None:
        with mock.patch(
            "agent_host.jobs.conversation_output.post_internal_conversation_message",
            new_callable=mock.AsyncMock,
        ) as post:
            await write_job_turn(
                conversation_id="s_abc",
                job_id="job-1",
                usage_context=USAGE,
                prompt="q",
                answer="a",
                transparency={
                    "answer_confidence": "low",
                    "answer_confidence_reason": "Keine bindende Quelle gefunden.",
                    "answer_confidence_capped_reason": "ungrounded",
                },
            )

        metadata = _posts(post.await_args_list)[1]["metadata"]
        assert metadata["answer_confidence"] == "low"
        assert metadata["answer_confidence_reason"] == "Keine bindende Quelle gefunden."
        assert metadata["answer_confidence_capped_reason"] == "ungrounded"

    @pytest.mark.asyncio
    async def test_a_clean_run_writes_no_transparency_keys_at_all(self) -> None:
        with mock.patch(
            "agent_host.jobs.conversation_output.post_internal_conversation_message",
            new_callable=mock.AsyncMock,
        ) as post:
            await write_job_turn(
                conversation_id="s_abc",
                job_id="job-1",
                usage_context=USAGE,
                prompt="q",
                answer="a",
                transparency={},
            )
            await write_job_turn(
                conversation_id="s_abc",
                job_id="job-2",
                usage_context=USAGE,
                prompt="q",
                answer="a",
            )

        for metadata in (p["metadata"] for p in _posts(post.await_args_list) if p["role"] == "assistant"):
            for key in _TRANSPARENCY_METADATA_KEYS:
                assert key not in metadata

    @pytest.mark.asyncio
    async def test_empty_values_are_not_claims(self) -> None:
        with mock.patch(
            "agent_host.jobs.conversation_output.post_internal_conversation_message",
            new_callable=mock.AsyncMock,
        ) as post:
            await write_job_turn(
                conversation_id="s_abc",
                job_id="job-1",
                usage_context=USAGE,
                prompt="q",
                answer="a",
                transparency={
                    "research_truncated": False,
                    "truncation_reason": "",
                    "degraded_reasons": [],
                    "citations_removed": {},
                    "answer_confidence": None,
                },
            )

        metadata = _posts(post.await_args_list)[1]["metadata"]
        for key in _TRANSPARENCY_METADATA_KEYS:
            assert key not in metadata

    @pytest.mark.asyncio
    async def test_only_the_known_keys_travel(self) -> None:
        with mock.patch(
            "agent_host.jobs.conversation_output.post_internal_conversation_message",
            new_callable=mock.AsyncMock,
        ) as post:
            await write_job_turn(
                conversation_id="s_abc",
                job_id="job-1",
                usage_context=USAGE,
                prompt="q",
                answer="a",
                transparency={"research_truncated": True, "internal_debug_state": {"secret": 1}},
            )

        metadata = _posts(post.await_args_list)[1]["metadata"]
        assert metadata["research_truncated"] is True
        assert "internal_debug_state" not in metadata

    @pytest.mark.asyncio
    async def test_a_malformed_payload_costs_the_caveat_not_the_message(self) -> None:
        with mock.patch(
            "agent_host.jobs.conversation_output.post_internal_conversation_message",
            new_callable=mock.AsyncMock,
        ) as post:
            await write_job_turn(
                conversation_id="s_abc",
                job_id="job-1",
                usage_context=USAGE,
                prompt="q",
                answer="a",
                transparency=["research_truncated"],  # type: ignore[arg-type]
            )

        posts = _posts(post.await_args_list)
        assert [p["role"] for p in posts] == ["user", "assistant"]
        assert posts[1]["text"] == "a"
        assert "research_truncated" not in posts[1]["metadata"]


class TestTheRunWritesIntoItsOwnMessage:
    @pytest.mark.asyncio
    async def test_the_report_fills_in_the_run_message_and_writes_no_question(self, _no_run_message) -> None:
        _no_run_message.return_value = "msg-run-1"
        with mock.patch(
            "agent_host.jobs.conversation_output.post_internal_conversation_message",
            new_callable=mock.AsyncMock,
        ) as post:
            await write_job_turn(
                conversation_id="s_abc",
                job_id="job-1",
                usage_context=USAGE,
                prompt="Fasse die Woche zusammen.",
                answer="Hier ist die Zusammenfassung.",
                cards=[{"type": "summary"}],
                skills_activated=["oib-brandschutznachweis"],
                sources=[{"title": "OIB-2"}],
                transparency={"research_truncated": True},
            )

        post.assert_not_awaited()
        written = _no_run_message.await_args.kwargs
        assert written["job_id"] == "job-1"
        assert written["text"] == "Hier ist die Zusammenfassung."
        assert written["metadata"]["deep_research_job_id"] == "job-1"
        assert written["metadata"]["cards"] == [{"type": "summary"}]
        assert written["metadata"]["skills_activated"] == ["oib-brandschutznachweis"]
        assert written["metadata"]["sources"] == [{"title": "OIB-2"}]
        assert written["metadata"]["research_truncated"] is True

    @pytest.mark.asyncio
    async def test_the_writer_names_the_message_the_report_landed_in(self, _no_run_message) -> None:
        _no_run_message.return_value = "msg-run-1"
        with mock.patch(
            "agent_host.jobs.conversation_output.post_internal_conversation_message",
            new_callable=mock.AsyncMock,
        ):
            landed = await write_job_turn(
                conversation_id="s_abc", job_id="job-1", usage_context=USAGE, prompt="q", answer="a"
            )
        assert landed == "msg-run-1"

        _no_run_message.return_value = None
        with mock.patch(
            "agent_host.jobs.conversation_output.post_internal_conversation_message",
            new_callable=mock.AsyncMock,
        ):
            fallback = await write_job_turn(
                conversation_id="s_abc", job_id="job-1", usage_context=USAGE, prompt="q", answer="a"
            )
        assert fallback == report_message_id("s_abc", "job-1")
        nothing = await write_job_turn(
            conversation_id=None, job_id="job-1", usage_context=USAGE, prompt="q", answer="a"
        )
        assert nothing is None

    @pytest.mark.asyncio
    async def test_a_failure_is_stated_in_the_run_message_too(self, _no_run_message) -> None:
        _no_run_message.return_value = "msg-run-1"
        with mock.patch(
            "agent_host.jobs.conversation_output.post_internal_conversation_message",
            new_callable=mock.AsyncMock,
        ) as post:
            await write_job_notice(
                conversation_id="s_abc",
                job_id="job-1",
                usage_context=USAGE,
                notice=FAILURE_NOTICE,
            )

        post.assert_not_awaited()
        assert _no_run_message.await_args.kwargs["text"] == FAILURE_NOTICE

    @pytest.mark.asyncio
    async def test_a_run_without_a_message_still_gets_its_question_and_answer(self) -> None:
        with mock.patch(
            "agent_host.jobs.conversation_output.post_internal_conversation_message",
            new_callable=mock.AsyncMock,
        ) as post:
            await write_job_turn(
                conversation_id="s_abc",
                job_id="job-1",
                usage_context=USAGE,
                prompt="q",
                answer="a",
            )

        assert [p["role"] for p in _posts(post.await_args_list)] == ["user", "assistant"]

    @pytest.mark.asyncio
    async def test_a_run_message_needs_no_conversation_id_of_its_own(self, _no_run_message) -> None:
        _no_run_message.return_value = "msg-run-1"
        with mock.patch(
            "agent_host.jobs.conversation_output.post_internal_conversation_message",
            new_callable=mock.AsyncMock,
        ) as post:
            await write_job_turn(
                conversation_id=None,
                job_id="job-1",
                usage_context=USAGE,
                prompt="q",
                answer="Der Bericht",
            )

        post.assert_not_awaited()
        assert _no_run_message.await_args.kwargs["text"] == "Der Bericht"

    @pytest.mark.asyncio
    async def test_a_failing_report_write_never_propagates(self, _no_run_message) -> None:
        _no_run_message.side_effect = RuntimeError("bff down")
        with mock.patch(
            "agent_host.jobs.conversation_output.post_internal_conversation_message",
            new_callable=mock.AsyncMock,
        ) as post:
            await write_job_turn(
                conversation_id="s_abc",
                job_id="job-1",
                usage_context=USAGE,
                prompt="q",
                answer="a",
            )

        assert [p["role"] for p in _posts(post.await_args_list)] == ["user", "assistant"]


class TestTransparencyMetadataFilter:
    def test_nothing_in_nothing_out(self) -> None:
        assert _transparency_metadata(None) == {}
        assert _transparency_metadata({}) == {}

    def test_only_literal_true_counts_as_a_cutoff(self) -> None:
        assert _transparency_metadata({"research_truncated": True}) == {"research_truncated": True}
        assert _transparency_metadata({"research_truncated": False}) == {}

    def test_the_keys_are_the_backends_wire_spelling(self) -> None:
        assert _TRANSPARENCY_METADATA_KEYS == (
            "research_truncated",
            "truncation_reason",
            "degraded_reasons",
            "citations_removed",
            "answer_confidence",
            "answer_confidence_reason",
            "answer_confidence_capped_reason",
            "answer_meta",
            "findings",
            "retrieval_ledger",
            "skills_hidden",
            "stages",
        )


async def test_the_report_row_names_the_trace_the_run_ran_in():
    with mock.patch(
        "agent_host.jobs.conversation_output.post_internal_run_report", new=mock.AsyncMock(return_value="run-msg")
    ) as report:
        await write_job_turn(
            conversation_id="s_abc",
            job_id="job-1",
            usage_context=USAGE,
            prompt="q",
            answer="a",
            trace_id="0f0f0f0f000040008000000000000001",
        )
        await write_job_turn(conversation_id="s_abc", job_id="job-2", usage_context=USAGE, prompt="q", answer="a")

    first, second = (call.kwargs["metadata"] for call in report.await_args_list)
    assert first["trace_id"] == "0f0f0f0f000040008000000000000001"
    assert "trace_id" not in second
