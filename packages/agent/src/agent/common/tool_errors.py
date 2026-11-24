from __future__ import annotations

from pydantic import ValidationError

_PYDANTIC_DOCS_HOST = "errors.pydantic.dev"

_MAX_INPUT_CHARS = 60


FAILURE_IS_NOT_A_FACT = (
    "This is the tool failing, not a fact about the work: never repeat this text, a tool name or the failure "
    "in the answer. Say in plain words what could not be checked, and keep confidence below high."
)


def render_tool_error(exc: Exception) -> str:
    validation = _validation_error(exc)
    if validation is None:
        return f"Error: {render_error_detail(exc)}. {FAILURE_IS_NOT_A_FACT}"
    from agent.common.retired_calls import retired_hints

    extra = [str(e["loc"][-1]) for e in validation.errors() if e.get("type") == "extra_forbidden" and e.get("loc")]
    instead = "".join(f" Instead: {hint}." for hint in retired_hints(extra))
    return f"Error: the call was rejected. {render_error_detail(exc)}.{instead} Fix the arguments and call again."


def render_error_detail(exc: BaseException) -> str:
    validation = _validation_error(exc)
    if validation is None:
        return f"{type(exc).__name__}: {_without_pydantic_links(str(exc))}"
    return "; ".join(_clauses(validation)) or "the arguments did not match the tool's schema"


def is_argument_rejection(exc: BaseException) -> bool:
    return _validation_error(exc) is not None


def _validation_error(exc: BaseException) -> ValidationError | None:
    if isinstance(exc, ValidationError):
        return exc
    source = getattr(exc, "source", None)
    return source if isinstance(source, ValidationError) else None


def _clauses(exc: ValidationError) -> list[str]:
    clauses: list[str] = []
    for error in exc.errors():
        location = ".".join(str(part) for part in error.get("loc", ()))
        problem = f"{error.get('msg', 'invalid')}{_got(error.get('input'))}"
        clauses.append(f"{location}: {problem}" if location else problem)
    return clauses


def _got(value: object) -> str:
    if value is None or not isinstance(value, (str, int, float, bool)):
        return ""
    shown = repr(value)
    return f" (got {shown})" if len(shown) <= _MAX_INPUT_CHARS else ""


def _without_pydantic_links(text: str) -> str:
    kept = [line for line in text.splitlines() if _PYDANTIC_DOCS_HOST not in line]
    return " ".join(line.strip() for line in kept if line.strip())
