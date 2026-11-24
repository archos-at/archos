import logging

_NOISY_DEPENDENCY_LOGGERS = ("nat.builder.intermediate_step_manager", "nat.builder.function_info", "pdfminer")


def suppress_noisy_dependency_logs() -> None:
    for name in _NOISY_DEPENDENCY_LOGGERS:
        logging.getLogger(name).setLevel(logging.ERROR)
