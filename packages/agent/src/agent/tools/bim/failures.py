from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass

from agent.knowledge.bim_query import BimQueryRejectedError
from agent.knowledge.bim_query import BimQueryUnavailableError
from agent.knowledge.ifc_spatial_client import ModelTooLargeError
from agent.knowledge.ifc_spatial_client import ModelUnreadableError
from agent.knowledge.ifc_spatial_client import SpatialEngineUnavailableError
from agent.knowledge.ifc_spatial_client import SpatialToolError

NO_PROJECT_TEXT = (
    "Error: this conversation is not attached to a project, so no BIM model can be selected. "
    "Do not retry — no argument to this tool can fix it. Tell the user (in German) that the "
    "question refers to a building model and that they need to open the conversation inside the "
    "project the model belongs to. Do not state anything about the building."
)

NO_ORG_TEXT = "Error: organization unknown for this session — the BIM model cannot be read. Do not retry."

NO_MODEL_TEXT = (
    "This one call is the answer: tell the user (in German) that no readable IFC model is stored for "
    "this project, and answer the rest of their question without any claim about the building. "
    "Another call with different arguments returns this same result."
)

NOT_READY_TEXT = (
    "This one call is the answer for this turn: tell the user (in German) that this model is not ready "
    "to be queried yet, in the words of the sentence above, and answer the rest of their question "
    "without any claim about the building. Readiness does not change inside this turn, so another call "
    "returns this same result."
)

UNAVAILABLE_TEXT = (
    "Error: the model could not be read right now (the model service is unreachable). "
    "Do NOT state anything about the building's geometry; tell the user the model could not be read."
)

QUERY_UNAVAILABLE_TEXT = (
    "Error: the BIM model could not be queried right now (the model service is "
    "unavailable). Do NOT state anything about the building's contents; tell the user "
    "the model could not be read."
)

ENGINE_UNAVAILABLE_TEXT = (
    "Error: geometric measurement is not available in this deployment (the spatial engine is not "
    "installed). Metadata questions can still be answered with ifc_query. Do NOT estimate the number."
)


def rejected_text(reason: str) -> str:
    return (
        f"Error: the request was rejected — {reason}. This is a problem with the arguments, not "
        "with the model. Correct them and call the tool again. Do NOT state anything about the "
        "building on the strength of this."
    )


def unrunnable_text(reason: str) -> str:
    if "Fehler im Aufruf" in reason:
        return (
            f"Error: {reason}. The GlobalId is fine — the OPERATOR is wrong for this kind of "
            "element. Do not look the id up again; use the operator named above."
        )
    return (
        f"Error: {reason}. This is a problem with the arguments, not with the building — "
        "check the GlobalId with operation='find_elements' and call again."
    )


def too_large_text(model_bytes: int | None, limit_bytes: int) -> str:
    size = f"{model_bytes / (1024 * 1024):.0f} MB" if model_bytes else "This model"
    limit = f"{limit_bytes // (1024 * 1024)} MB"
    return (
        f"Error: the model ({size}) is too large for geometric evaluation on this server "
        f"(limit {limit}). This is a statement about the FILE, not an outage — waiting does not help. "
        "Tell the user: either export the model split by building element or construction phase, "
        "or ask for the limit to be raised. Metadata questions (element lists, "
        "property values, counts) can still be answered with ifc_query — they run on the "
        "extracted index and not on the file. Do not estimate dimensions."
    )


MAX_REASON_CHARS = 400


def unreadable_text(reason: str) -> str:
    return (
        f"Error: the model file could not be opened. The reason: {reason[:MAX_REASON_CHARS]} "
        "This is a statement about the FILE, not an outage — waiting or calling again does not help. "
        "Pass this reason on to the user. Metadata questions can still be tried with ifc_query, which "
        "reads the extracted index and not the file. Do NOT state anything about the building's geometry."
    )


@dataclass(frozen=True)
class Failure:
    exception: type[BaseException]
    level: int
    outcome: str
    text: Callable[[BaseException], str]


class FailureTable:
    def __init__(self, *failures: Failure) -> None:
        self._failures = failures
        self.exceptions: tuple[type[BaseException], ...] = tuple(failure.exception for failure in failures)

    def describe(self, exc: BaseException) -> Failure:
        return next(failure for failure in self._failures if isinstance(exc, failure.exception))


def _constant(text: str) -> Callable[[BaseException], str]:
    return lambda _exc: text


QUERY_FAILURES = FailureTable(
    Failure(BimQueryRejectedError, logging.INFO, "rejected", lambda exc: rejected_text(str(exc))),
    Failure(BimQueryUnavailableError, logging.WARNING, "service_unavailable", _constant(QUERY_UNAVAILABLE_TEXT)),
)

MEASURE_FAILURES = FailureTable(
    Failure(BimQueryRejectedError, logging.INFO, "rejected", lambda exc: rejected_text(str(exc))),
    Failure(
        ModelTooLargeError,
        logging.INFO,
        "model_too_large",
        lambda exc: too_large_text(exc.model_bytes, exc.limit_bytes),  # type: ignore[attr-defined]
    ),
    Failure(ModelUnreadableError, logging.INFO, "model_unreadable", lambda exc: unreadable_text(str(exc))),
    Failure(BimQueryUnavailableError, logging.WARNING, "service_unavailable", _constant(UNAVAILABLE_TEXT)),
    Failure(SpatialEngineUnavailableError, logging.WARNING, "engine_unavailable", _constant(ENGINE_UNAVAILABLE_TEXT)),
    Failure(SpatialToolError, logging.INFO, "rejected", lambda exc: unrunnable_text(str(exc))),
)
