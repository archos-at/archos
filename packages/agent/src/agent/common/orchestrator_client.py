from __future__ import annotations

import logging
import threading
from collections.abc import Callable
from collections.abc import Sequence
from concurrent.futures import ThreadPoolExecutor
from typing import TYPE_CHECKING
from typing import Any

from .boot_retry import retry_connection
from .task_failures import TaskFailure
from .task_failures import TransientTaskError
from .task_failures import classify

if TYPE_CHECKING:
    from hatchet_sdk import Hatchet


logger = logging.getLogger(__name__)

_lock = threading.Lock()
_client: Hatchet | None = None

REST_TIMEOUT_SECONDS = 15.0
_rest_pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix="orchestrator-rest")


def client() -> Hatchet:
    global _client
    with _lock:
        if _client is None:
            from hatchet_sdk import Hatchet

            _client = Hatchet()
        return _client


def reset_for_tests(fake: Hatchet | None = None) -> None:
    global _client
    with _lock:
        _client = fake


def register_workflows(workflows: Sequence[Any]) -> None:
    admin = client()._client.admin
    for workflow in workflows:
        retry_connection(
            lambda workflow=workflow: admin.put_workflow(workflow.to_proto()),
            what=f"Hatchet registration of {workflow.name}",
        )


def within_rest_timeout[T](call: Callable[[], T], timeout: float = REST_TIMEOUT_SECONDS) -> T:
    return _rest_pool.submit(call).result(timeout=timeout)


def task_error(failure: TaskFailure, *, retry: bool) -> Exception:
    if retry:
        return TransientTaskError(failure.text)
    from hatchet_sdk import NonRetryableException

    return NonRetryableException(failure.text)


def sanitized(what: str, error: BaseException, *, retry: bool = True) -> Exception:
    failure = classify(error)
    logger.error("%s failed on Hatchet: %s", what, failure.text, exc_info=error)
    return task_error(failure, retry=retry)
