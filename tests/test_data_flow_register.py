"""The data-flow register is complete, valid, and the pages generated from it are current.

``configs/subprocessors/*.yaml`` is the one list of where data leaves the
cluster (``docs/compliance/data-flow-register.md``). This is the ratchet: a new
outbound host, API key, base URL, Hog file or PostHog destination in the code
fails here until a row names it, and the legal page and the DPA annex cannot
drift from the rows because both are generated.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]


def _load(name: str):
    path = REPO_ROOT / "scripts" / f"{name}.py"
    sys.path.insert(0, str(path.parent))
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


check = _load("check_data_flow_register")
generate = _load("generate_subprocessor_pages")


@pytest.fixture(scope="module")
def register():
    return check.load()


def test_the_register_is_valid(register) -> None:
    assert check.register_errors(register) == []


def test_every_outbound_flow_in_the_code_has_a_row(register) -> None:
    errors = check.flow_errors(register)
    assert errors == [], "\n".join([*errors, "How to add a row: docs/compliance/data-flow-register.md"])


def test_the_generated_page_parts_are_current(register) -> None:
    assert generate.TS_PATH.read_text(encoding="utf-8") == generate.render_ts(register), (
        "Run `.venv/bin/python scripts/generate_subprocessor_pages.py` and commit the result."
    )


def test_the_dpa_annex_is_current(register) -> None:
    assert generate.ANNEX_PATH.read_text(encoding="utf-8") == generate.render_annex(register), (
        "Run `.venv/bin/python scripts/generate_subprocessor_pages.py` and commit the result."
    )


@pytest.mark.parametrize(
    "flow",
    [
        "komoot-photon",  # address keystrokes, default since 2026-11-03
        "elevenlabs",  # dictation audio through OpenRouter
        "slack",  # staff notices from PostHog destinations
        "posthog",  # support tickets with the report's masked text
        "workos",  # audit events with document names
        "cloudflare",  # project mail in transit
    ],
)
def test_the_flows_the_design_review_found_are_listed_on_the_page(register, flow: str) -> None:
    row = next(row for row in register.rows if row["id"] == flow)
    assert row["status"] == "active"
    names = [cells[0] for cells in generate.page_tables(register, "de")["processors"]["rows"]]
    assert row["copy"]["name"]["de"] in names


def test_latent_vendors_are_switchable_off_by_the_boot_check(register) -> None:
    latent = {row["id"]: row for row in register.rows if row["status"] == "latent"}
    assert {"modal", "serper", "jina", "wandb", "langsmith"} <= set(latent)
    for row in latent.values():
        assert row.get("activation_env") or row.get("no_boot_check"), row["id"]


def test_every_store_holding_tenant_text_says_how_deletion_reaches_it(register) -> None:
    for row in register.rows:
        if row["holds_tenant_text"]:
            assert row["deletion"]["status"] not in {"no_tenant_text", "not_used"}, row["id"]
    for component in register.in_cluster["components"]:
        if component["holds_tenant_text"]:
            assert component["deletion"]["en"], component["name"]


def test_the_annex_names_every_open_deletion(register) -> None:
    annex = generate.render_annex(register)
    for row in register.rows:
        if row["deletion"]["status"] in check.OPEN_DELETION:
            assert f"**{row['name']}** ({row['deletion']['status']})" in annex


def test_an_unregistered_host_fails_the_scan(tmp_path: Path) -> None:
    code = tmp_path / "apps" / "agent-host" / "src"
    code.mkdir(parents=True)
    (code / "vendor.py").write_text('URL = "https://api.new-vendor.io/v1"\nKEY = os.getenv("NEW_VENDOR_API_KEY")\n')
    (tmp_path / "deploy" / "posthog").mkdir(parents=True)
    (tmp_path / "deploy" / "posthog" / "x.hog").write_text("fetch('https://hooks.example-chat.io/x')\n")
    errors = check.flow_errors(check.Register(), tmp_path)
    assert any("api.new-vendor.io" in error for error in errors)
    assert any("NEW_VENDOR_API_KEY" in error for error in errors)
    assert any("hooks.example-chat.io" in error for error in errors)
    assert any("deploy/posthog/x.hog" in error for error in errors)


def test_reserved_and_in_cluster_names_are_not_flows(tmp_path: Path) -> None:
    code = tmp_path / "apps" / "agent-host" / "src"
    code.mkdir(parents=True)
    (code / "ok.py").write_text('A = "https://x.invalid"\nB = "http://qdrant.default.svc"\nC = "https://example.com"\n')
    assert check.flow_errors(check.Register(), tmp_path) == []


def test_a_stale_exemption_fails(tmp_path: Path) -> None:
    (tmp_path / "apps").mkdir()
    errors = check.flow_errors(check.Register(not_flows={"hosts": {"gone.io": "was a link"}}), tmp_path)
    assert errors == ["not-flows.yaml: gone.io no longer occurs; remove it"]
