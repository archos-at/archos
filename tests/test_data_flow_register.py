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


def test_the_shipped_packages_are_all_classified() -> None:
    """The scan reads real manifests: the workspace's SDKs, PostHog's among them, are found."""
    packages = check.scan_packages()
    assert {"js:posthog-node", "js:@workos-inc/node", "py:langchain-tavily", "js:web-push"} <= set(packages)


def test_a_flow_needs_a_processing_location_and_the_rows_classes(register) -> None:
    """Residency enforcement reads ``processing_location`` per flow; a flow cannot widen its row."""
    row = {**next(row for row in register.rows if row["id"] == "posthog")}
    row["flows"] = [
        {"id": "x", "what": {"de": "x", "en": "x"}, "data_classes": ["voice_audio"], "purposes": ["security"]}
    ]
    errors = check.row_errors(row)
    assert any("needs `processing_location`" in error for error in errors)
    assert any("data class the row does not list" in error for error in errors)
    assert any("purpose the row does not list" in error for error in errors)


@pytest.mark.parametrize(
    ("relative", "code", "finding"),
    [
        ("apps/agent-host/src/a.py", 'DSN = os.getenv("SENTRY_DSN")', "SENTRY_DSN"),
        ("apps/agent-host/src/a.py", 'TOKEN = os.environ["ACME_TOKEN"]', "ACME_TOKEN"),
        ("apps/agent-host/src/a.py", 'S = os.getenv("ACME_SECRET")', "ACME_SECRET"),
        (
            "apps/workspace/bff/a.ts",
            "const socket = new WebSocket('wss://stream.vendor-rt.io/v1')",
            "stream.vendor-rt.io",
        ),
        ("apps/agent-host/src/a.py", 'URL = f"https://{region}.ingest.vendor-x.io/v1"', "ingest.vendor-x.io"),
        (
            "apps/workspace/bff/a.ts",
            "const url = `https://${region}.collector.vendor-y.com/v1`",
            "collector.vendor-y.com",
        ),
        ("apps/agent-host/src/a.py", 'HOST = "telemetry.vendor-z.com"', "telemetry.vendor-z.com"),
        ("apps/agent-host/src/a.py", 'ENDPOINT = "http://203.1.113.9:8080/v1"', "203.1.113.9"),
        ("apps/cms/src/hook.ts", "await fetch('https://hooks.vendor-cms.io/x')", "hooks.vendor-cms.io"),
        (
            "apps/website/src/views/X.astro",
            '<script src="https://cdn.vendor-web.com/a.js"></script>',
            "cdn.vendor-web.com",
        ),
        ("packages/ifc-spatial-py/src/x.py", 'URL = "https://api.vendor-ifc.io"', "api.vendor-ifc.io"),
        ("deploy/helm/values.yaml", "endpoint: https://otlp.vendor-helm.io", "otlp.vendor-helm.io"),
        ("apps/agent-host/src/a.py", 'DEFAULT_MODEL = "newvendor/model-1"', "model vendor newvendor"),
    ],
)
def test_every_class_of_flow_fails_until_registered(tmp_path: Path, relative: str, code: str, finding: str) -> None:
    """The positive controls: each kind of flow the review planted makes the scan fail."""
    path = tmp_path / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(code + "\n")
    errors = check.flow_errors(check.Register(), tmp_path)
    assert any(finding in error for error in errors), errors


def test_a_private_or_documentation_address_is_not_a_flow(tmp_path: Path) -> None:
    code = tmp_path / "apps" / "agent-host" / "src"
    code.mkdir(parents=True)
    (code / "a.py").write_text('A = "http://10.0.0.5:80/x"\nB = "http://192.0.2.1/"\nC = "cert-manager.io/v1"\n')
    # A NetworkPolicy's exceptions: CGNAT, IETF assignments, benchmarking, multicast, reserved.
    special = ["100.64.0.0", "100.127.0.0", "192.0.0.0", "198.18.0.0", "224.0.0.0", "240.0.0.0"]
    (code / "b.py").write_text("".join(f'X{i} = "{ip}/10"\n' for i, ip in enumerate(special)))
    assert check.flow_errors(check.Register(), tmp_path) == []


def test_a_public_address_beside_the_special_ranges_is_still_a_flow(tmp_path: Path) -> None:
    code = tmp_path / "apps" / "agent-host" / "src"
    code.mkdir(parents=True)
    (code / "a.py").write_text('A = "100.128.0.1/"\nB = "198.20.0.1/"\n')
    errors = check.flow_errors(check.Register(), tmp_path)
    assert any("100.128.0.1" in error for error in errors) and any("198.20.0.1" in error for error in errors)


def test_an_unused_public_source_is_recorded_but_not_on_the_page(register) -> None:
    """Fedlex is configured and fetched for nobody: the annex says so, the page does not list it."""
    fedlex = next(source for source in register.public_sources if source["id"] == "fedlex")
    assert fedlex["status"] == "unused"
    assert fedlex["copy"]["de"] not in generate.page_tables(register, "de")["publicSources"]
    assert "**not in use**" in generate.render_annex(register)
    reasonless = check.Register(public_sources=[{**fedlex, "unused_reason": ""}])
    assert any("needs `unused_reason`" in error for error in check.register_errors(reasonless))


def test_a_posthog_destination_fails_until_registered_even_when_cut_short(tmp_path: Path) -> None:
    readme = tmp_path / "deploy" / "posthog" / "README.md"
    readme.parent.mkdir(parents=True)
    readme.write_text("Spikes go to Slack (`01a15d7e…`); costs (`01a17ea5-06b2-0000-a138-a2d2cd892bc5`).\n")
    errors = check.flow_errors(check.Register(), tmp_path)
    assert any("01a15d7e" in error for error in errors)
    assert any("01a17ea5-06b2" in error for error in errors)
    named = check.Register(
        rows=[
            {
                "id": "slack",
                "posthog_destinations": [
                    "01a15d7e-e622-0000-12c9-4226994d613e",
                    "01a17ea5-06b2-0000-a138-a2d2cd892bc5",
                ],
            }
        ]
    )
    assert check.flow_errors(named, tmp_path) == []


def test_a_row_the_scan_cannot_find_fails(register) -> None:
    """Deleting such a row would leave the check clean, so the row itself is refused."""
    row = {**next(row for row in register.rows if row["id"] == "elevenlabs"), "model_vendors": [], "env": []}
    assert any("names nothing the scan can find" in error for error in check.row_errors(row))


def test_a_latent_vendor_switched_on_in_a_shipped_config_fails(tmp_path: Path) -> None:
    (tmp_path / "configs").mkdir()
    (tmp_path / "configs" / "workflow.yml").write_text("functions:\n  sandbox:\n    _type: deep_research_sandbox\n")
    register = check.Register(
        rows=[
            {
                "id": "modal",
                "name": "Modal",
                "status": "latent",
                "activation_config": [r"_type:\s*deep_research_sandbox"],
            }
        ]
    )
    assert any("switches on Modal" in error for error in check.latent_config_errors(register, tmp_path))
