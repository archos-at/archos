import logging
from typing import Any

from pydantic import BaseModel
from pydantic import Field

from agent.observability.langfuse_trace_attributes import InlineImageRedactionProcessor
from agent.observability.langfuse_trace_attributes import LangfuseTraceAttributeProcessor
from agent.observability.langfuse_trace_attributes import PromptLinkProcessor
from agent.observability.langfuse_trace_attributes import TraceContextProcessor
from agent.observability.langfuse_trace_attributes import UsageAttributeProcessor
from agent.observability.langfuse_trace_attributes import UserIdentityStripProcessor
from agent.observability.langfuse_trace_attributes import identity_attributes_enabled
from agent.observability.processing_location import ProcessingLocationProcessor
from agent.observability.trace_context import langfuse_release
from nat.observability.exporter.base_exporter import BaseExporter
from nat.plugin_api import Builder
from nat.plugin_api import register_telemetry_exporter

logger = logging.getLogger(__name__)


def ensure_registered() -> None:
    return None


def _should_redact_from_headers(headers: dict[str, Any]) -> bool:
    for value in headers.values():
        if value is None:
            continue
        if str(value).strip().lower() == "true":
            return True
    return False


try:
    from nat.observability.mixin.redaction_config_mixin import HeaderRedactionConfigMixin  # type: ignore
except Exception:

    class HeaderRedactionConfigMixin(BaseModel):
        redaction_enabled: bool = Field(default=False, description="Whether to enable redaction processing.")
        redaction_value: str = Field(default="[REDACTED]", description="Value to replace redacted attributes with.")
        redaction_attributes: list[str] = Field(
            default_factory=lambda: ["input.value", "output.value", "nat.metadata"],
            description="Attributes to redact when redaction is triggered.",
        )
        force_redaction: bool = Field(default=False, description="Always redact regardless of other conditions.")
        redaction_tag: str | None = Field(default=None, description="Tag to add to spans when redaction is triggered.")
        redaction_headers: list[str] = Field(default_factory=list, description="Headers to check for redaction.")


try:
    from nat.observability.mixin.tagging_config_mixin import PrivacyTaggingConfigMixin  # type: ignore
except Exception:

    class PrivacyTaggingConfigMixin(BaseModel):
        tags: dict[str, str] | None = Field(default=None, description="Tags to add to spans.")


try:
    from nat.plugins.opentelemetry.register import OtelCollectorTelemetryExporter  # type: ignore
except Exception as e:
    raise RuntimeError(
        "OpenTelemetry telemetry plugin is required for otelcollector_redaction. "
        "Install NeMo Agent toolkit with telemetry extras."
    ) from e


class OtelCollectorRedactionTelemetryExporter(
    HeaderRedactionConfigMixin,
    PrivacyTaggingConfigMixin,
    OtelCollectorTelemetryExporter,
    name="otelcollector_redaction",
):
    resource_attributes: dict[str, str] = Field(default_factory=dict, description="Resource attributes to attach.")
    endpoint: str | None = Field(default=None, description="The endpoint of the telemetry collector service.")


class _DisabledSpanExporter(BaseExporter):
    """
    No-op exporter yielded when no OTLP endpoint is configured.

    The agent runtime has no way to conditionally declare a `general.telemetry.tracing`
    entry, so the exporter is always constructed. Availability is therefore
    derived here from the dependency (ADR-0029 "availability = flag AND
    capability"): no endpoint means nothing to export to, so spans are dropped
    at the source instead of being queued and retried forever against an
    address that does not exist. Mirrors `apps/workspace/instrumentation.ts`,
    which no-ops on the same missing env var.
    """

    def export(self, event: Any) -> None:
        return None


@register_telemetry_exporter(config_type=OtelCollectorRedactionTelemetryExporter)
async def otelcollector_redaction_telemetry_exporter(
    config: OtelCollectorRedactionTelemetryExporter, _builder: Builder
):
    if not config.endpoint or not config.endpoint.strip():
        logger.info(
            "otelcollector_redaction: no OTLP endpoint configured "
            "(OTEL_EXPORTER_OTLP_ENDPOINT unset) - span export disabled.",
        )
        yield _DisabledSpanExporter()
        return

    from nat.plugins.opentelemetry.otel_span_exporter import get_opentelemetry_sdk_version
    from nat.plugins.opentelemetry.otlp_span_redaction_adapter_exporter import OTLPSpanHeaderRedactionAdapterExporter

    default_resource_attributes = {
        "telemetry.sdk.language": "python",
        "telemetry.sdk.name": "opentelemetry",
        "telemetry.sdk.version": get_opentelemetry_sdk_version(),
        "service.name": config.project,
    }
    release = langfuse_release()
    if release:
        default_resource_attributes["service.version"] = release
    merged_resource_attributes = {**default_resource_attributes, **config.resource_attributes}

    exporter = OTLPSpanHeaderRedactionAdapterExporter(
        endpoint=config.endpoint,
        resource_attributes=merged_resource_attributes,
        batch_size=config.batch_size,
        flush_interval=config.flush_interval,
        max_queue_size=config.max_queue_size,
        drop_on_overflow=config.drop_on_overflow,
        shutdown_timeout=config.shutdown_timeout,
        redaction_attributes=config.redaction_attributes,
        redaction_headers=config.redaction_headers,
        redaction_callback=_should_redact_from_headers,
        redaction_enabled=config.redaction_enabled,
        force_redaction=config.force_redaction,
        redaction_tag=config.redaction_tag,
        redaction_value=getattr(config, "redaction_value", "[REDACTED]"),
        tags=config.tags,
    )

    for processor, name, lost in (
        (UsageAttributeProcessor, "usage_attributes", "usage"),
        (PromptLinkProcessor, "prompt_link", "a prompt version"),
        (ProcessingLocationProcessor, "processing_location", "a processing location"),
    ):
        if processor is None:
            continue
        try:
            exporter.add_processor(processor(), name=name, position=0)
        except Exception:
            logger.warning(
                "otelcollector_redaction: could not install the %s processor - generations will export without %s.",
                name,
                lost,
                exc_info=True,
            )

    if TraceContextProcessor is not None:
        try:
            exporter.add_processor(TraceContextProcessor(), name="trace_context", position=0)
        except Exception:
            logger.warning(
                "otelcollector_redaction: could not install the trace context processor - "
                "traces will export without environment, release or observation types.",
                exc_info=True,
            )

    if not identity_attributes_enabled() and UserIdentityStripProcessor is not None:
        exporter.add_processor(UserIdentityStripProcessor(), name="strip_user_identity", position=0)
    if not identity_attributes_enabled() and LangfuseTraceAttributeProcessor is not None:
        exporter.add_processor(LangfuseTraceAttributeProcessor(identity=False), name="trace_contributions", position=0)
    if identity_attributes_enabled() and LangfuseTraceAttributeProcessor is not None:
        try:
            exporter.add_processor(
                LangfuseTraceAttributeProcessor(),
                name="langfuse_trace_attributes",
                position=0,
            )
            logger.info("otelcollector_redaction: Langfuse trace identity attributes enabled.")
        except Exception:
            logger.warning(
                "otelcollector_redaction: could not install the Langfuse trace attribute "
                "processor - traces will export without session/user attribution.",
                exc_info=True,
            )

    if InlineImageRedactionProcessor is not None:
        exporter.add_processor(InlineImageRedactionProcessor(), name="inline_image_redaction", position=0)

    yield exporter
