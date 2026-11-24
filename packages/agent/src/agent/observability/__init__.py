def ensure_registered() -> None:
    from agent.observability.otel_header_redaction_exporter import ensure_registered as register_redaction
    from agent.observability.otlp_logging_method import ensure_registered as register_logs

    register_logs()
    register_redaction()
