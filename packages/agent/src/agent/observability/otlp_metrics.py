from __future__ import annotations

import logging
import os
import threading
from collections.abc import Mapping

from opentelemetry import metrics
from opentelemetry.sdk.metrics import MeterProvider

from agent.observability.otlp_resource import ENDPOINT_ENV
from agent.observability.otlp_resource import resource_attributes
from agent.observability.otlp_resource import signal_endpoint

logger = logging.getLogger(__name__)

EXPORT_INTERVAL_MS = 30_000

_provider: MeterProvider | None = None
_lock = threading.Lock()


def install(endpoint: str, env: Mapping[str, str] | None = None) -> MeterProvider:
    global _provider
    with _lock:
        if _provider is None:
            _provider = _build(endpoint, os.environ if env is None else env)
            metrics.set_meter_provider(_provider)
        return _provider


def install_from_env(env: Mapping[str, str] | None = None) -> MeterProvider | None:
    env = os.environ if env is None else env
    endpoint = env.get(ENDPOINT_ENV, "").strip()
    return install(endpoint, env) if endpoint else None


def _build(endpoint: str, env: Mapping[str, str]) -> MeterProvider:
    from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
    from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
    from opentelemetry.sdk.resources import Resource

    url = signal_endpoint(endpoint, "metrics")
    reader = PeriodicExportingMetricReader(OTLPMetricExporter(endpoint=url), export_interval_millis=EXPORT_INTERVAL_MS)
    logger.info("otlp_metrics: exporting OTLP metrics to %s", url)
    return MeterProvider(resource=Resource.create(resource_attributes(env)), metric_readers=[reader])
