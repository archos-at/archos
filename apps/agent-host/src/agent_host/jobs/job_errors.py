from __future__ import annotations

import logging

logger = logging.getLogger(__name__)

_LLM_PROVIDER_ERROR_MODULES = frozenset(
    {
        "openai",
        "anthropic",
        "litellm",
        "langchain",
        "langchain_core",
        "langchain_openai",
        "langchain_anthropic",
        "langchain_nvidia_ai_endpoints",
    }
)

_NETWORK_ERROR_MODULES = frozenset({"httpx", "httpcore", "aiohttp", "requests", "urllib3"})

try:
    from langgraph.errors import GraphRecursionError as _GraphRecursionError
except ImportError:
    _GraphRecursionError = None

_WALL_CLOCK_TIMEOUT_MSG = "Die Recherche hat ihr Zeitlimit erreicht und wurde ohne vollständiges Ergebnis abgebrochen."
_GENERIC_TIMEOUT_MSG = "The job timed out while waiting on an external service."
_GRAPH_RECURSION_ERROR_MSG = "Die Recherche hat ihr Schritt-Limit erreicht, ohne ein vollständiges Ergebnis zu liefern."
_LLM_PROVIDER_ERROR_MSG = "The LLM provider returned an error while running the job."
_CONNECTION_ERROR_MSG = "A connection error occurred while running the job."
_INTERNAL_ERROR_MSG = "The job failed due to an internal error."


def sanitize_job_error(exc: BaseException) -> str:
    from agent.common import RunBudgetExceededError
    from agent.common.cost_tracking import BudgetExceededError

    if isinstance(exc, (RunBudgetExceededError, BudgetExceededError)):
        return str(exc)

    root_module = (type(exc).__module__ or "").split(".")[0]
    if isinstance(exc, TimeoutError):
        if "wall-clock" in str(exc).lower():
            return _WALL_CLOCK_TIMEOUT_MSG
        return _GENERIC_TIMEOUT_MSG
    from agent.common.canned_replies import ZDR_MODEL_REFUSED_MESSAGE
    from agent.common.openrouter import is_data_policy_refusal

    if is_data_policy_refusal(exc):
        return ZDR_MODEL_REFUSED_MESSAGE
    if _GraphRecursionError is not None and isinstance(exc, _GraphRecursionError):
        return _GRAPH_RECURSION_ERROR_MSG
    if root_module in _LLM_PROVIDER_ERROR_MODULES:
        return _LLM_PROVIDER_ERROR_MSG
    if root_module in _NETWORK_ERROR_MODULES or isinstance(exc, (ConnectionError, OSError)):
        return _CONNECTION_ERROR_MSG
    return _INTERNAL_ERROR_MSG
