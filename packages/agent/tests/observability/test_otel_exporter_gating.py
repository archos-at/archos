import pytest
import yaml

from agent.observability.otel_header_redaction_exporter import OtelCollectorRedactionTelemetryExporter
from agent.observability.otel_header_redaction_exporter import _DisabledSpanExporter
from agent.observability.otel_header_redaction_exporter import otelcollector_redaction_telemetry_exporter

CONFIG_PATH = "configs/config_oib_openrouter.yml"


def _make_config(endpoint: str | None) -> OtelCollectorRedactionTelemetryExporter:
    return OtelCollectorRedactionTelemetryExporter(
        _type="otelcollector_redaction", project="backend-chat", endpoint=endpoint
    )


@pytest.mark.parametrize("endpoint", ["", "   ", None])
async def test_blank_endpoint_yields_a_noop_exporter(endpoint):
    async with otelcollector_redaction_telemetry_exporter(_make_config(endpoint), None) as exporter:
        assert isinstance(exporter, _DisabledSpanExporter)
        assert exporter.export(object()) is None


async def test_configured_endpoint_yields_a_real_exporter():
    config = _make_config("http://otel-collector:4318/v1/traces")
    async with otelcollector_redaction_telemetry_exporter(config, None) as exporter:
        assert not isinstance(exporter, _DisabledSpanExporter)
        assert exporter is not None


def test_shipped_config_does_not_default_to_a_localhost_collector():
    with open(CONFIG_PATH, encoding="utf-8") as fh:
        raw = yaml.safe_load(fh)

    tracing = raw["general"]["telemetry"]["tracing"]["otelcollector_redaction"]
    assert tracing["endpoint"] == "${OTEL_EXPORTER_OTLP_ENDPOINT:-}", (
        "tracing endpoint must default to empty so the exporter no-ops when the observability tier is not deployed"
    )
