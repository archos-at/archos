"""The claim lease the workers share: one env reader, one liveness marker, and defaults the BFF agrees with."""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from agent_host.jobs import lease_policy

_WORKSPACE = Path(__file__).resolve().parents[3] / "apps" / "workspace"
# Where each BFF default is read since the claim loop moved to Hatchet (ADR-0150).
_BFF_RUNNER = _WORKSPACE / "workers" / "jobs" / "index.js"
_BFF_ATTEMPTS = _WORKSPACE / "bff" / "jobs-queue" / "attempts.ts"
_BFF_TASK = _WORKSPACE / "bff" / "jobs-queue" / "task.ts"


@pytest.mark.parametrize(
    ("raw", "floor", "expected"),
    [
        (None, None, 7),
        ("", None, 7),
        ("many", None, 7),
        ("-2", None, -2),
        ("0", 0, 0),
        ("-1", 0, 7),
        ("0", 1, 7),
        ("12", 1, 12),
    ],
)
def test_int_env_falls_back_below_its_floor_and_on_anything_not_a_number(monkeypatch, raw, floor, expected):
    if raw is None:
        monkeypatch.delenv("TEST_LEASE", raising=False)
    else:
        monkeypatch.setenv("TEST_LEASE", raw)

    assert lease_policy.int_env("TEST_LEASE", 7, floor=floor) == expected


def test_the_liveness_marker_is_written_and_a_failed_write_does_not_raise(tmp_path, caplog):
    marker = tmp_path / "alive"
    lease_policy.touch_liveness(str(marker))
    assert marker.read_text() == "ok"

    lease_policy.touch_liveness(str(tmp_path / "missing" / "alive"))
    assert "Could not write the liveness file" in caplog.text


def _bff_default(source: Path, name: str) -> int:
    declared = re.search(rf"toInt\(env\.{name},\s*([\d_]+)\)", source.read_text())
    assert declared, f"{name} has no default in {source}"
    return int(declared.group(1))


def _bff_max_attempts() -> int:
    declared = re.search(r"const DEFAULT_MAX_ATTEMPTS = ([\d_]+)", _BFF_ATTEMPTS.read_text())
    assert declared, f"BFF_JOBS_MAX_ATTEMPTS has no default in {_BFF_ATTEMPTS}"
    return int(declared.group(1))


def test_the_bff_jobs_share_the_lease_defaults_that_are_meant_to_be_shared():
    """Max attempts and dead retention are one policy. The drain is not: a BFF slice is a minute, a run ten."""
    assert _bff_max_attempts() == lease_policy.MAX_ATTEMPTS
    assert _bff_default(_BFF_TASK, "BFF_JOBS_DEAD_RETENTION_DAYS") == lease_policy.DEAD_RETENTION_DAYS
    assert _bff_default(_BFF_RUNNER, "BFF_JOBS_DRAIN_SECONDS") == 60
    assert lease_policy.DRAIN_SECONDS == 600
