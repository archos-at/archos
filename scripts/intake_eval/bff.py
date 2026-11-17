from __future__ import annotations

import io
import json
import shutil
import subprocess
import threading
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock

from .fixture import REPO_ROOT
from .fixture import Fixture

GATE = Path(__file__).with_name("gate.ts")
JOB_ID = "intake-eval-job"


class GateError(RuntimeError): ...


class Gate:
    def __init__(self) -> None:
        bun = shutil.which("bun")
        if bun is None:
            raise GateError("bun is not on the PATH; the intake route's logic runs under bun (gate.ts)")
        self._process = subprocess.Popen(
            [bun, "run", str(GATE)],
            cwd=REPO_ROOT,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
        )
        self._lock = threading.Lock()

    def ask(self, request: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            assert self._process.stdin is not None and self._process.stdout is not None
            self._process.stdin.write((json.dumps(request, ensure_ascii=False) + "\n").encode("utf-8"))
            self._process.stdin.flush()
            line = self._process.stdout.readline().decode("utf-8")
        if not line:
            raise GateError("the gate process ended")
        return json.loads(line)

    def close(self) -> None:
        if self._process.stdin:
            self._process.stdin.close()
        self._process.wait(timeout=10)


class FakeIntakeBff:
    def __init__(self, fixture: Fixture, gate: Gate) -> None:
        self.fixture = fixture
        self.gate = gate
        self.profile: dict[str, Any] = gate.ask({"op": "empty"})["profile"]
        self.records: list[dict[str, Any]] = []
        self.finish_body: dict[str, Any] | None = None
        self.need_labels: set[str] = set()
        self._lock = threading.Lock()

    def answers(self) -> dict[str, Any]:
        return {"needs": self.needs, "record": self.record, "withdraw": self.withdraw, "finish": self.finish}

    def needs(self, body: dict[str, Any]) -> dict[str, Any] | int:
        if body.get("jobId") != JOB_ID:
            return 409
        with self._lock:
            needs = self.gate.ask({"op": "needs", "profile": self.profile, "mode": "active", "dismissed": []})
            self.need_labels.update(str(need.get("label") or "") for need in needs["needs"])
        return {
            "needs": needs["needs"],
            "unreadFiles": self.fixture.names,
            "description": self.fixture.description,
            "location": None,
            "mode": "active",
            "previousSummary": None,
        }

    def record(self, body: dict[str, Any]) -> dict[str, Any] | int:
        if body.get("jobId") != JOB_ID:
            return 409
        with self._lock:
            answer = self.gate.ask(
                {"op": "record", "profile": self.profile, "body": body, "readableFiles": self.fixture.names}
            )
            if answer.get("status") != 200:
                return int(answer.get("status") or 500)
            self.profile = answer["profile"]
            for value, result in zip(body["values"], answer["results"], strict=True):
                self.records.append({**result, "value": value["value"], **value["evidence"]})
        return {"results": answer["results"], "opened": answer["opened"]}

    def withdraw(self, body: dict[str, Any]) -> dict[str, Any] | int:
        if body.get("jobId") != JOB_ID:
            return 409
        with self._lock:
            answer = self.gate.ask({"op": "withdraw", "profile": self.profile, "body": body})
            if answer.get("status") != 200:
                return int(answer.get("status") or 500)
            self.profile = answer["profile"]
            self.records.extend(dict(result) for result in answer["results"])
        return {"results": answer["results"]}

    def finish(self, body: dict[str, Any]) -> dict[str, Any] | int:
        if body.get("jobId") != JOB_ID:
            return 409
        self.finish_body = body
        return {"status": "ready"}


class FakeIntakeRoute:
    def __init__(self, **answers: Any) -> None:
        self.answers = {"progress": {"filesOpened": 1}, "finish": {"status": "ready"}, **answers}
        self.requests: list[urllib.request.Request] = []

    def bodies(self, op: str | None = None) -> list[dict[str, Any]]:
        bodies = [json.loads(request.data) for request in self.requests]
        return [body for body in bodies if op is None or body["op"] == op]

    def __call__(self, request: urllib.request.Request, timeout: float) -> Any:
        self.requests.append(request)
        body = json.loads(request.data)
        answer = self.answers[body["op"]]
        if callable(answer):
            answer = answer(body)
        if isinstance(answer, BaseException):
            raise answer
        if isinstance(answer, int):
            error = json.dumps({"error": "stale-reading" if answer == 409 else "nope"}).encode()
            raise urllib.error.HTTPError(request.full_url, answer, "refused", {}, io.BytesIO(error))
        response = MagicMock()
        response.__enter__.return_value.read.return_value = json.dumps(answer).encode("utf-8")
        return response
