from __future__ import annotations

import json
from typing import Any


def message_content(data: Any) -> tuple[str | None, str | None]:
    try:
        choice = data["choices"][0]
        content = choice["message"]["content"]
        finish_reason = choice.get("finish_reason")
    except (KeyError, IndexError, AttributeError, TypeError) as exc:
        raise ValueError("chat completion has no usable first choice") from exc

    if content is not None and not isinstance(content, str):
        raise ValueError("message content is not text")
    return content, finish_reason if isinstance(finish_reason, str) else None


def extract_json_object(raw: str | None) -> dict:
    text = _strip_code_fence((raw or "").strip())
    span = _object_span(text)
    if span is None:
        raise ValueError("no JSON object in response")

    try:
        data = json.loads(span)
    except json.JSONDecodeError:
        repaired = _close_truncated(span)
        if repaired is None:
            raise ValueError("response is not valid JSON") from None
        try:
            data = json.loads(repaired)
        except json.JSONDecodeError:
            raise ValueError("response was cut off mid-object and could not be recovered") from None

    if not isinstance(data, dict):
        raise ValueError("response JSON is not an object")
    return data


def _strip_code_fence(text: str) -> str:
    if not text.startswith("```"):
        return text
    body = text.split("\n", 1)[1] if "\n" in text else ""
    closing = body.rfind("```")
    return (body[:closing] if closing != -1 else body).strip()


def _object_span(text: str) -> str | None:
    start = text.find("{")
    if start == -1:
        return None

    depth = 0
    in_string = False
    escaped = False
    for index in range(start, len(text)):
        char = text[index]
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
        elif char == '"':
            in_string = True
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return text[start : index + 1]
    return text[start:]


def _close_truncated(span: str) -> str | None:
    stack: list[str] = []
    in_string = False
    escaped = False
    for char in span:
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
        elif char == '"':
            in_string = True
        elif char in "{[":
            stack.append(char)
        elif char in "}]" and stack:
            stack.pop()

    if not stack and not in_string:
        return None

    repaired = span[:-1] if escaped else span
    if in_string:
        repaired += '"'
    repaired = repaired.rstrip()
    if repaired.endswith(","):
        repaired = repaired[:-1]
    return repaired + "".join("}" if opener == "{" else "]" for opener in reversed(stack))
