from unittest.mock import MagicMock

import pytest

from agent_host.routes.job_models import JobReportResponse
from agent_host.routes.job_models import JobStateResponse
from agent_host.routes.job_models import JobStatusResponse
from agent_host.routes.job_models import JobSubmitRequest


class TestJobSubmitRequest:
    def test_valid_request(self):
        req = JobSubmitRequest(agent_type="deep_researcher", input="What is CUDA?")

        assert req.input == "What is CUDA?"
        assert req.agent_type == "deep_researcher"
        assert req.job_id is None
        assert req.expiry_seconds is None
        assert req.data_sources is None

    def test_with_data_sources(self):
        req = JobSubmitRequest(agent_type="deep_researcher", input="query", data_sources=["web_search"])

        assert req.data_sources == ["web_search"]

    def test_null_data_sources_defaults_to_all_sources(self):
        req = JobSubmitRequest(agent_type="deep_researcher", input="query", data_sources=None)

        assert req.data_sources is None

    def test_empty_data_sources_accepted(self):
        req = JobSubmitRequest(agent_type="deep_researcher", input="query", data_sources=[])

        assert req.data_sources == []

    def test_with_custom_job_id(self):
        req = JobSubmitRequest(agent_type="deep_researcher", input="query", job_id="custom-123")

        assert req.job_id == "custom-123"

    def test_with_custom_expiry(self):
        req = JobSubmitRequest(agent_type="deep_researcher", input="query", expiry_seconds=7200)

        assert req.expiry_seconds == 7200

    def test_empty_input_rejected(self):
        with pytest.raises(ValueError):
            JobSubmitRequest(agent_type="deep_researcher", input="")

    def test_input_at_max_length_accepted(self):
        req = JobSubmitRequest(agent_type="deep_researcher", input="x" * 32000)

        assert len(req.input) == 32000

    def test_input_over_max_length_rejected(self):
        with pytest.raises(ValueError):
            JobSubmitRequest(agent_type="deep_researcher", input="x" * 32001)

    def test_expiry_too_low_rejected(self):
        with pytest.raises(ValueError):
            JobSubmitRequest(agent_type="deep_researcher", input="query", expiry_seconds=300)

    def test_expiry_too_high_rejected(self):
        with pytest.raises(ValueError):
            JobSubmitRequest(agent_type="deep_researcher", input="query", expiry_seconds=700000)


class TestJobStatusResponse:
    def test_minimal_response(self):
        resp = JobStatusResponse(job_id="123", status="running")

        assert resp.job_id == "123"
        assert resp.status == "running"
        assert resp.error is None
        assert resp.created_at is None

    def test_full_response(self):
        resp = JobStatusResponse(
            job_id="123",
            status="success",
            error="some error",
            created_at="2026-01-20T10:00:00",
        )

        assert resp.job_id == "123"
        assert resp.status == "success"
        assert resp.error == "some error"
        assert resp.created_at == "2026-01-20T10:00:00"


class TestJobStateResponse:
    def test_without_state(self):
        resp = JobStateResponse(job_id="123", has_state=False)

        assert resp.job_id == "123"
        assert resp.has_state is False
        assert resp.state is None

    def test_with_artifacts(self):
        artifacts = {"tools": [], "outputs": []}
        resp = JobStateResponse(job_id="123", has_state=True, artifacts=artifacts)

        assert resp.has_state is True
        assert resp.artifacts == artifacts


class TestJobReportResponse:
    def test_without_report(self):
        resp = JobReportResponse(job_id="123", has_report=False)

        assert resp.job_id == "123"
        assert resp.has_report is False
        assert resp.report is None

    def test_with_report(self):
        resp = JobReportResponse(job_id="123", has_report=True, report="# Report\n\nContent here")

        assert resp.has_report is True
        assert resp.report == "# Report\n\nContent here"

    def test_cards_are_optional(self):
        resp = JobReportResponse(job_id="123", has_report=True, report="# Report")

        assert resp.cards is None

    def test_with_cards(self):
        cards = [{"type": "legal_basis", "title": "OIB-Richtlinie 2", "lane": "oib"}]
        resp = JobReportResponse(job_id="123", has_report=True, report="# Report", cards=cards)

        assert resp.cards == cards


def _registered(app: MagicMock, method: str) -> int:
    added = sum(1 for call in app.add_api_route.call_args_list if call.kwargs.get("methods") == [method])
    return added + getattr(app, method.lower()).call_count


class TestRegisterRoutes:
    @pytest.mark.asyncio
    async def test_routes_registered_without_any_scheduler(self, tmp_path, monkeypatch):
        from agent_host.routes.jobs import register_job_routes

        monkeypatch.delenv("NAT_CONFIG_FILE", raising=False)
        mock_app = MagicMock()
        mock_builder = MagicMock()
        mock_builder.get_function_config.side_effect = KeyError("Not found")
        mock_worker = MagicMock()
        mock_worker._db_url = f"sqlite+aiosqlite:///{tmp_path / 'test.db'}"
        mock_worker._config_file_path = "/path/to/config.yml"
        mock_worker._front_end_config = MagicMock(expiry_seconds=86400)

        await register_job_routes(mock_app, mock_builder, mock_worker)

        assert _registered(mock_app, "POST") >= 2
        assert _registered(mock_app, "GET") >= 6

    @pytest.mark.asyncio
    async def test_no_config_file_registers_no_job_routes(self, monkeypatch):
        from agent_host.routes.jobs import register_job_routes

        monkeypatch.delenv("NAT_CONFIG_FILE", raising=False)
        mock_app = MagicMock()
        mock_builder = MagicMock()
        mock_builder.get_function_config.side_effect = KeyError("Not found")
        mock_worker = MagicMock()
        mock_worker._db_url = "sqlite+aiosqlite:///unused.db"
        mock_worker._config_file_path = None

        await register_job_routes(mock_app, mock_builder, mock_worker)

        assert _registered(mock_app, "POST") == 0
        assert _registered(mock_app, "GET") == 2


class TestArtifactHelpers:
    def test_extract_event_metadata_with_data(self):
        from agent_host.routes.job_artifacts import _extract_event_metadata

        event = {
            "type": "tool.start",
            "data": {"name": "test", "input": "query"},
            "metadata": {"workflow": "agent-1"},
        }

        data, metadata = _extract_event_metadata(event)

        assert data == {"name": "test", "input": "query"}
        assert metadata == {"workflow": "agent-1"}

    def test_extract_event_metadata_fallback_to_nested(self):
        from agent_host.routes.job_artifacts import _extract_event_metadata

        event = {
            "type": "tool.start",
            "data": {"name": "test", "metadata": {"workflow": "nested"}},
        }

        data, metadata = _extract_event_metadata(event)

        assert metadata == {"workflow": "nested"}

    def test_extract_event_metadata_handles_non_dict(self):
        from agent_host.routes.job_artifacts import _extract_event_metadata

        event = {"type": "test", "data": "string_data"}

        data, metadata = _extract_event_metadata(event)

        assert data == {}
        assert metadata == {}

    def test_process_tool_start(self):
        from agent_host.routes.job_artifacts import _process_tool_start

        event = {"type": "tool.start", "id": "tool-1", "name": "search", "timestamp": "2026-01-22T10:00:00"}
        data = {"input": "query"}
        metadata = {"workflow": "agent-1"}
        tool_call_map: dict = {}

        _process_tool_start(event, data, metadata, tool_call_map)

        assert "tool-1" in tool_call_map
        assert tool_call_map["tool-1"]["name"] == "search"
        assert tool_call_map["tool-1"]["status"] == "running"

    def test_process_tool_end_updates_existing(self):
        from agent_host.routes.job_artifacts import _process_tool_end

        event = {"type": "tool.end", "id": "event-9", "name": "search", "timestamp": "2026-01-22T10:00:01"}
        data = {"output": "result"}
        metadata = {"workflow": "agent-1"}
        tool_call_map = {
            "tool-1": {
                "id": "tool-1",
                "name": "search",
                "input": "query",
                "output": None,
                "status": "running",
            }
        }

        _process_tool_end(event, data, metadata, tool_call_map)

        assert tool_call_map["tool-1"]["output"] == "result"
        assert tool_call_map["tool-1"]["status"] == "completed"

    def test_process_tool_end_creates_new(self):
        from agent_host.routes.job_artifacts import _process_tool_end

        event = {"type": "tool.end", "id": "tool-2", "name": "other", "timestamp": "2026-01-22T10:00:01"}
        data = {"output": "result"}
        metadata = {"workflow": "agent-1"}
        tool_call_map: dict = {}

        _process_tool_end(event, data, metadata, tool_call_map)

        assert "tool-2" in tool_call_map
        assert tool_call_map["tool-2"]["status"] == "completed"

    def test_process_artifact_update(self):
        from agent_host.routes.job_artifacts import _process_artifact_update

        event = {"name": "output.md", "timestamp": "2026-01-22T10:00:00"}
        data = {"type": "output", "content": "Report content", "extra": "value"}
        metadata = {"workflow": "agent-1"}
        outputs: list = []
        sources_found: set = set()
        sources_cited: set = set()

        _process_artifact_update(event, data, metadata, outputs, sources_found, sources_cited)

        assert len(outputs) == 1
        assert outputs[0]["type"] == "output"
        assert outputs[0]["content"] == "Report content"
        assert outputs[0]["extra"] == "value"

    def test_process_artifact_update_skips_empty_content(self):
        from agent_host.routes.job_artifacts import _process_artifact_update

        event = {"name": "empty.md", "timestamp": "2026-01-22T10:00:00"}
        data = {"type": "output", "content": None}
        metadata = {}
        outputs: list = []
        sources_found: set = set()
        sources_cited: set = set()

        _process_artifact_update(event, data, metadata, outputs, sources_found, sources_cited)

        assert len(outputs) == 0

    def test_process_artifact_update_tracks_citation_source(self):
        from agent_host.routes.job_artifacts import _process_artifact_update

        event = {"name": "https://example.com", "timestamp": "2026-01-22T10:00:00"}
        data = {"type": "citation_source", "content": "https://example.com", "url": "https://example.com"}
        metadata = {}
        outputs: list = []
        sources_found: set = set()
        sources_cited: set = set()

        _process_artifact_update(event, data, metadata, outputs, sources_found, sources_cited)

        assert len(sources_found) == 1
        assert sources_found == {"https://example.com"}
        assert len(sources_cited) == 0

    def test_process_artifact_update_tracks_citation_use(self):
        from agent_host.routes.job_artifacts import _process_artifact_update

        event = {"name": "https://example.com", "timestamp": "2026-01-22T10:00:00"}
        data = {"type": "citation_use", "content": "https://example.com", "url": "https://example.com"}
        metadata = {}
        outputs: list = []
        sources_found: set = set()
        sources_cited: set = set()

        _process_artifact_update(event, data, metadata, outputs, sources_found, sources_cited)

        assert len(sources_cited) == 1
        assert sources_cited == {"https://example.com"}
        assert len(sources_found) == 0
