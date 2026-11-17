import logging
import os

from pydantic import Field

from agent.common.log_redaction import PresignedUrlFilter
from agent.common.log_redaction import install_presigned_url_scrubbing
from agent.observability import otlp_metrics
from agent.observability import posthog_exceptions
from agent.observability.otlp_resource import resource_attributes
from agent.observability.otlp_resource import signal_endpoint
from nat.cli.register_workflow import register_logging_method  # noqa: TID251
from nat.data_models.logging import LoggingBaseConfig
from nat.plugin_api import Builder

logger = logging.getLogger(__name__)


def ensure_registered() -> None:
    return None


class _OtelSdkFilter(logging.Filter):
    """Drops records emitted by the OTel SDK itself.

    Without this, a failed log export logs a warning through the very handler
    that triggered it, feeding the next export attempt — an amplification loop
    against an unreachable collector.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        return not record.name.startswith("opentelemetry")


class _NatBuildFailureItemizationFilter(logging.Filter):
    """Keeps one ERROR per failed workflow build instead of one per line.

    ``nat.builder.workflow_builder._log_build_failure`` reports a failed build
    as a dozen ``logger.error`` calls: a header, then every built and every
    remaining component on its own line, then ``Original error`` with the
    traceback. Each record is an ERROR, so err2issue filed one startup failure
    as eleven issues (#742-#752), none of which carried the cause. Only the
    ``Original error`` record is exported; the itemization still reaches stdout
    through the other handlers. If the agent runtime renames the function, nothing matches
    and every line is exported again: this fails towards reporting.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        if record.funcName != "_log_build_failure" or not record.name.startswith("nat."):
            return True
        return str(record.msg).startswith("Original error")


class OtlpLoggingMethodConfig(LoggingBaseConfig, name="otelcollector_logs"):
    """Ships runtime logs to the OTLP collector (ADR-0029), which forwards WARN and above to PostHog Logs.

    It is also the seam that installs the process's ``MeterProvider``
    (``otlp_metrics``): every agent-runtime process passes it, and the ``grid.*``
    instruments reach the collector, which forwards them to PostHog Metrics.
    The provider outlives this workflow on purpose; see ``otlp_metrics``.

    `endpoint` is Optional because `${OTEL_EXPORTER_OTLP_ENDPOINT:-}`
    interpolates to None (not "") when the observability tier is not deployed.
    """

    endpoint: str | None = Field(
        default=None,
        description="OTLP traces endpoint (…/v1/traces); the /v1/logs sibling is derived from it.",
    )
    level: str = Field(default="INFO", description="The logging level of the OTLP log exporter.")


@register_logging_method(config_type=OtlpLoggingMethodConfig)
async def otlp_logging_method(config: OtlpLoggingMethodConfig, _builder: Builder):
    posthog_exceptions.install()

    if not config.endpoint or not config.endpoint.strip():
        logger.info(
            "otelcollector_logs: no OTLP endpoint configured "
            "(OTEL_EXPORTER_OTLP_ENDPOINT unset) - OTLP log export disabled.",
        )
        yield logging.NullHandler()
        return

    from opentelemetry.exporter.otlp.proto.http._log_exporter import OTLPLogExporter
    from opentelemetry.sdk._logs import LoggerProvider
    from opentelemetry.sdk._logs import LoggingHandler
    from opentelemetry.sdk._logs.export import BatchLogRecordProcessor
    from opentelemetry.sdk.resources import Resource

    otlp_metrics.install(config.endpoint)

    provider = LoggerProvider(resource=Resource.create(resource_attributes(os.environ)))
    provider.add_log_record_processor(
        BatchLogRecordProcessor(OTLPLogExporter(endpoint=signal_endpoint(config.endpoint, "logs")))
    )

    level = getattr(logging, config.level.upper(), logging.INFO)
    handler = LoggingHandler(level=level, logger_provider=provider)
    handler.addFilter(_OtelSdkFilter())
    handler.addFilter(_NatBuildFailureItemizationFilter())
    handler.addFilter(PresignedUrlFilter())

    install_presigned_url_scrubbing()

    yield handler

    provider.shutdown()
