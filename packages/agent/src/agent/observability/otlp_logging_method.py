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

    def filter(self, record: logging.LogRecord) -> bool:
        return not record.name.startswith("opentelemetry")


class _NatBuildFailureItemizationFilter(logging.Filter):

    def filter(self, record: logging.LogRecord) -> bool:
        if record.funcName != "_log_build_failure" or not record.name.startswith("nat."):
            return True
        return str(record.msg).startswith("Original error")


class OtlpLoggingMethodConfig(LoggingBaseConfig, name="otelcollector_logs"):

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
