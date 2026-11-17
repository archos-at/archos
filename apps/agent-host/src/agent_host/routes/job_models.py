from __future__ import annotations

import logging
from typing import Any

from pydantic import BaseModel
from pydantic import ConfigDict
from pydantic import Field

logger = logging.getLogger(__name__)


class JobDocumentRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=256, description="The file name, as the inventory lists it")
    title: str | None = Field(None, max_length=256, description="The document's display title")
    shelf: str | None = Field(None, max_length=64, description="Where it sits: office_shelf / project / session / base")


class JobSubmitRequest(BaseModel):
    agent_type: str = Field(..., description="Agent type (e.g., 'deep_researcher')")
    input: str = Field(..., min_length=1, max_length=32000, description="Input query for the agent")
    job_id: str | None = Field(
        None,
        pattern=r"^[a-zA-Z0-9_-]+$",
        max_length=64,
        description="Optional custom job ID (auto-generated if omitted)",
    )
    expiry_seconds: int | None = Field(
        None,
        ge=600,
        le=604800,
        description="Job expiry in seconds (default from config, max 7 days)",
    )
    data_sources: list[str] | None = Field(
        None,
        description=(
            "Optional data source IDs to target. Omit or set null to use all data-source tools "
            "available to the chosen agent. When specific IDs are passed, unmapped utility tools "
            "(e.g., 'think') remain available. Pass an empty list to run the agent with no "
            "data-source tools; unmapped utility tools remain available."
        ),
    )


JOB_SUBMIT_EXAMPLES: dict[str, dict] = {
    "default": {
        "summary": "Default (all data sources)",
        "value": {
            "agent_type": "deep_researcher",
            "input": "What are the latest advances in quantum computing?",
            "expiry_seconds": 86400,
        },
    },
    "scoped": {
        "summary": "Scoped to specific data sources",
        "value": {
            "agent_type": "deep_researcher",
            "input": "What are the latest advances in quantum computing?",
            "data_sources": ["web_search"],
        },
    },
}


class JobStatusResponse(BaseModel):
    model_config = ConfigDict(
        json_schema_extra={
            "examples": [
                {
                    "job_id": "abc123",
                    "status": "submitted",
                    "agent_type": "deep_researcher",
                    "error": None,
                    "created_at": "2026-02-12T10:30:00Z",
                }
            ]
        }
    )

    job_id: str = Field(..., description="Unique job identifier")
    status: str = Field(
        ...,
        description="Current status: submitted, running, success, failure, interrupted, not_found",
    )
    agent_type: str | None = Field(None, description="Agent type used for this job")
    error: str | None = Field(None, description="Error message if job failed")
    created_at: str | None = Field(None, description="Creation timestamp (ISO format)")


class JobStateResponse(BaseModel):
    job_id: str = Field(..., description="Unique job identifier")
    has_state: bool = Field(..., description="Whether state/artifacts are available")
    state: dict | None = Field(None, description="Internal job state")
    artifacts: dict | None = Field(None, description="Tool calls, outputs, and sources collected during execution")


def report_cards(raw: Any) -> list[dict] | None:
    if not isinstance(raw, list):
        return None
    cards = [card for card in raw if isinstance(card, dict)]
    return cards or None


class JobReportResponse(BaseModel):
    job_id: str = Field(..., description="Unique job identifier")
    project_collection: str | None = Field(
        None,
        description=(
            "Collection of the project this run was commissioned in, recorded at "
            "submit time. The report is filed into THIS project or into none — "
            "never into one the report request names, which is a property of the "
            "reader rather than of the run."
        ),
    )
    has_report: bool = Field(..., description="Whether the final report is available")
    report: str | None = Field(None, description="Final research report from the agent")
    cards: list[dict] | None = Field(
        None,
        description=(
            "Grid response cards generated from this report, as the runner persisted them "
            "(already validated at write time). Null when the run produced none."
        ),
    )
    sources: list[dict] | None = Field(
        None,
        description=(
            "The report's verified sources, each carrying the [N] the report cites it by, "
            "as the runner persisted them. The live event stream discovers sources before "
            "verification numbers them, so this is the only place a reader of the finished "
            "report can learn which row [3] is. Null when the run recorded none."
        ),
    )


def report_sources(raw: Any) -> list[dict] | None:
    if not isinstance(raw, list):
        return None
    sources = [entry for entry in raw if isinstance(entry, dict)]
    return sources or None


class InternalJobOutcomeResponse(BaseModel):
    job_id: str
    status: str = Field(..., description="submitted, running, success, failure or interrupted")
    error: str | None = None
    report: str | None = None
    cards: list[dict] | None = None
    message: dict[str, Any] | None = Field(
        None, description="What the run message should hold: {content, metadata}; null while the job runs"
    )


class ResearchRunItem(BaseModel):
    job_id: str = Field(..., description="Unique job identifier")
    status: str = Field(..., description="Current job status")
    created_at: str | None = Field(None, description="Creation timestamp (ISO format)")
    conversation_id: str | None = Field(None, description="Conversation the job was submitted from, if any")
    project_collection: str | None = Field(None, description="Project collection the job was scoped to, if any")


class ResearchRunsResponse(BaseModel):
    jobs: list[ResearchRunItem] = Field(..., description="Matching research runs, newest first")
    total: int = Field(..., description="Total number of matching runs (before limit/offset)")


class AgentInfo(BaseModel):
    agent_type: str = Field(..., description="Agent identifier used in submit requests")
    description: str = Field(..., description="Human-readable description of the agent")


class AgentListResponse(BaseModel):
    agents: list[AgentInfo] = Field(..., description="Registered agent types")


class DataSource(BaseModel):
    id: str = Field(..., description="Unique identifier for the data source")
    name: str = Field(..., description="Display name")
    description: str | None = Field(default=None, description="Human-readable description")
    requires_auth: bool = Field(default=False, description="Whether user authentication is required")


class DataSourcesResponse(BaseModel):
    data_sources: list[DataSource] = Field(..., description="Registered data sources")
    vlm_available: bool = Field(
        default=False,
        description="Whether a vision model (VLM) is configured (derived from VLM API key presence)",
    )
