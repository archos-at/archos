from __future__ import annotations

from pathlib import Path

import pytest
import yaml

COMPOSE_DIR = Path(__file__).resolve().parents[1] / "deploy" / "compose"


def _init_command(name: str) -> str:
    service = yaml.safe_load((COMPOSE_DIR / name).read_text())["services"]["seaweedfs-init"]
    return " ".join(service["command"])


@pytest.mark.parametrize("name", ["docker-compose.yaml"])
def test_the_init_waits_for_the_master_to_list_the_filer_before_creating_buckets(name):
    command = _init_command(name)
    wait = command.index("echo 'cluster.ps'")
    assert "until" in command[:wait]
    assert wait < command.index("s3.bucket.create")


@pytest.mark.parametrize("name", ["docker-compose.yaml"])
def test_the_init_checks_the_listing_for_whole_bucket_names(name):
    command = _init_command(name)
    assert "s3.bucket.list" in command
    assert "[[:space:]]" in command[command.index("s3.bucket.list") :]
    assert "grep -q grid-documents" not in command
    assert 'grep -q "$$b"' not in command
