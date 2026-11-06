#!/usr/bin/env python3

"""Every place data can leave the cluster has a row in the data-flow register.

The register is ``configs/subprocessors/*.yaml`` (schema and how to add a row:
``docs/compliance/data-flow-register.md``). This script validates it and scans
the code for the four things that open a new outbound flow:

1. an environment variable whose name ends ``_URL``, ``_BASE_URL``, ``_HOST``,
   ``_ENDPOINT``, ``_API_KEY`` or ``_TOKEN_ID`` (a base URL or a key is how a
   vendor is switched on), read in runtime code, set by Pulumi, written in
   Compose or ``deploy/.env.example``, or documented in the env reference;
2. a literal ``http(s)://host`` in runtime code, Pulumi, configs or a Hog file;
3. a ``.hog`` file under ``deploy/posthog/`` (code that runs inside PostHog and
   can ``fetch`` anywhere);
4. a PostHog destination id in a table of ``deploy/posthog/README.md`` (one
   built from PostHog's own templates has no ``.hog`` file here).

Each must be named by a row, by ``in-cluster.yaml`` (an address inside the
cluster), or by ``not-flows.yaml`` with the reason it carries no data out (an
XML namespace, a link a person clicks). ``not-flows.yaml`` entries that no
longer occur fail too, so the exemptions cannot outlive their reason.

Usage: python scripts/check_data_flow_register.py. Exit code 0 when clean.
"""

from __future__ import annotations

import importlib.util
import re
import sys
from dataclasses import dataclass
from dataclasses import field
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parents[1]
REGISTER_DIR = REPO_ROOT / "configs" / "subprocessors"

KINDS = frozenset({"processor"})
STATUSES = frozenset({"active", "conditional", "latent"})
TRANSFERS = frozenset({"eea", "eu_storage_us_access", "third_country"})
CONTRACTS = frozenset({"dpa", "terms", "none", "unknown"})
DELETION = frozenset(
    {
        "covered",
        "partial",
        "gap",
        "unknown",
        "not_retained",
        "no_tenant_text",
        "vendor_retention",
        "controller_designated",
        "not_used",
    }
)
DATA_CLASSES = frozenset(
    {
        "tenant_content",
        "model_io",
        "voice_audio",
        "account_identity",
        "audit_metadata",
        "telemetry",
        "operational_log",
        "support_text",
        "trace_metadata",
        "search_query",
        "address_query",
        "mail_transit",
        "notification",
        "ids_only",
        "backups",
    }
)
PURPOSES = frozenset(
    {"service_provision", "quality_evaluation", "product_improvement", "customer_support", "security", "operations"}
)
#: Deletion states that say tenant text is still held somewhere at contract end.
OPEN_DELETION = frozenset({"partial", "gap", "unknown"})
REQUIRED = (
    "id",
    "kind",
    "status",
    "order",
    "name",
    "entity_country",
    "transfer",
    "contract",
    "data_classes",
    "purposes",
    "holds_tenant_text",
    "deletion",
    "hosts",
    "env",
    "copy",
)
COPY_FIELDS = ("name", "data", "location")
LISTED_COPY_FIELDS = ("purpose", "required")

ENV_SUFFIX = r"(?:_URL|_HOST|_ENDPOINT|_API_KEY|_TOKEN_ID)"
ENV_NAME = rf"[A-Z][A-Z0-9_]*{ENV_SUFFIX}"
#: Where code reads, sets or documents a variable. Literals only: a name that
#: is a constant (``REPOSITORY_URL = "https://…"``) is not a variable.
ENV_PATTERNS = (
    re.compile(rf"""["']({ENV_NAME})["']"""),
    re.compile(rf"\bprocess\.env\.({ENV_NAME})\b"),
    re.compile(rf"\$\{{({ENV_NAME})(?::?-[^}}]*)?\}}"),
    re.compile(rf"^\|\s*`({ENV_NAME})`", re.M),
    re.compile(rf"^#?\s*({ENV_NAME})=", re.M),
)
HOST = re.compile(r"https?://([a-z0-9][a-z0-9.-]*\.[a-z]{2,})", re.I)
#: RFC 2606 and 6761 names, and cluster-internal suffixes: never a vendor.
RESERVED_HOST = re.compile(
    r"(^|\.)(example\.(com|org|net)|[a-z0-9-]+\.(example|invalid|test|localhost|local|internal|svc))$"
    r"|\.(example|invalid|test|localhost|local|internal|svc)$"
)
DESTINATION_ID = re.compile(r"`([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})`")

RUNTIME_ROOTS = (
    "apps/workspace/app",
    "apps/workspace/bff",
    "apps/workspace/ui",
    "apps/workspace/shared",
    "apps/workspace/workers",
    "apps/workspace/purger",
    "apps/workspace/observability",
    "apps/workspace/server.js",
    "apps/workspace/instrumentation.ts",
    "apps/agent-host/src",
    "packages/agent/src",
    "packages/knowledge-layer/src",
    "packages/ris-adapter/src",
    "packages/tavily-web-search/src",
    "deploy/pulumi/src",
    "deploy/posthog",
    "configs",
)
ENV_ONLY_SOURCES = (
    "docs/deployment/environment-variables.md",
    "deploy/.env.example",
    "deploy/compose/docker-compose.yaml",
)
SUFFIXES = frozenset({".ts", ".tsx", ".js", ".mjs", ".cjs", ".py", ".hog", ".yml", ".yaml", ".json"})
#: Not runtime: specs, fixtures, dev preview pages, generated build output.
SKIPPED_PARTS = (
    ".spec.",
    ".test.",
    "/tests/",
    "/test-support/",
    "fixture",
    "/app/dev/",
    "node_modules",
    "__pycache__",
    ".egg-info",
    "configs/subprocessors/",
)


@dataclass
class Register:
    """The register's files, parsed."""

    rows: list[dict] = field(default_factory=list)
    in_cluster: dict = field(default_factory=dict)
    public_sources: list[dict] = field(default_factory=list)
    build: list[dict] = field(default_factory=list)
    not_flows: dict = field(default_factory=dict)


def load(directory: Path = REGISTER_DIR) -> Register:
    """Every file of the register; the four list files by name, the rest rows."""
    register = Register()
    special = {"in-cluster.yaml", "public-sources.yaml", "build.yaml", "not-flows.yaml"}
    for path in sorted(directory.glob("*.yaml")):
        data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        if path.name not in special:
            register.rows.append({**data, "_file": path.name})
    register.in_cluster = _read(directory / "in-cluster.yaml")
    register.public_sources = _read(directory / "public-sources.yaml").get("sources", [])
    register.build = _read(directory / "build.yaml").get("services", [])
    register.not_flows = _read(directory / "not-flows.yaml")
    register.rows.sort(key=lambda row: (row.get("order", 0), row.get("id", "")))
    return register


def _read(path: Path) -> dict:
    return (yaml.safe_load(path.read_text(encoding="utf-8")) or {}) if path.is_file() else {}


def _bilingual(value: object) -> bool:
    return isinstance(value, dict) and all(isinstance(value.get(lang), str) and value[lang] for lang in ("de", "en"))


def row_errors(row: dict, repo_root: Path = REPO_ROOT) -> list[str]:
    """What is wrong with one processor row, each as a sentence."""
    where = row.get("_file", row.get("id", "?"))
    errors = [f"{where}: missing `{key}`" for key in REQUIRED if key not in row]
    if errors:
        return errors
    if row["id"] + ".yaml" != row["_file"]:
        errors.append(f"{where}: `id` must be the file name without .yaml")
    checks = (
        (row["kind"] in KINDS, f"`kind` {row['kind']!r} is not one of {sorted(KINDS)}"),
        (row["status"] in STATUSES, f"`status` {row['status']!r} is not one of {sorted(STATUSES)}"),
        (row["transfer"] in TRANSFERS, f"`transfer` {row['transfer']!r} is not one of {sorted(TRANSFERS)}"),
        (row["contract"] in CONTRACTS, f"`contract` {row['contract']!r} is not one of {sorted(CONTRACTS)}"),
        (set(row["data_classes"]) <= DATA_CLASSES, f"unknown data class in {row['data_classes']}"),
        (set(row["purposes"]) <= PURPOSES, f"unknown purpose in {row['purposes']}"),
        (row["deletion"].get("status") in DELETION, f"`deletion.status` is not one of {sorted(DELETION)}"),
        (_bilingual(row["deletion"]), "`deletion` needs de and en text"),
        (all(_bilingual(row["copy"].get(name)) for name in COPY_FIELDS), f"`copy` needs de/en {COPY_FIELDS}"),
    )
    errors += [f"{where}: {message}" for ok, message in checks if not ok]
    errors += _status_errors(row, where)
    errors += [
        f"{where}: evidence {path} does not exist"
        for path in row.get("evidence", [])
        if not (repo_root / path).exists()
    ]
    errors += [
        f"{where}: hog file {path} does not exist"
        for path in row.get("hog_files", [])
        if not (repo_root / path).is_file()
    ]
    return errors


def _status_errors(row: dict, where: str) -> list[str]:
    errors = []
    if row["status"] == "latent":
        if not row.get("activation_env") and not row.get("no_boot_check"):
            errors.append(f"{where}: a latent row needs `activation_env` or `no_boot_check` with the reason")
    elif not all(_bilingual(row["copy"].get(name)) for name in LISTED_COPY_FIELDS):
        errors.append(f"{where}: a listed row needs de/en {LISTED_COPY_FIELDS} in `copy`")
    if row["holds_tenant_text"] and row["deletion"]["status"] in {"no_tenant_text", "not_used"}:
        errors.append(f"{where}: holds tenant text, so `deletion.status` cannot say it holds none")
    return errors


def register_errors(register: Register) -> list[str]:
    """Every schema error in the register."""
    errors = [error for row in register.rows for error in row_errors(row)]
    ids = [row.get("id") for row in register.rows]
    errors += [f"duplicate id {name}" for name in sorted({name for name in ids if ids.count(name) > 1})]
    for component in register.in_cluster.get("components", []):
        if not (_bilingual(component.get("purpose")) and _bilingual(component.get("data"))):
            errors.append(f"in-cluster.yaml: {component.get('name')} needs de/en `purpose` and `data`")
        if component.get("holds_tenant_text") and not _bilingual(component.get("deletion")):
            errors.append(f"in-cluster.yaml: {component.get('name')} holds tenant text and needs de/en `deletion`")
    for entry in [*register.public_sources, *register.build]:
        if not (_bilingual(entry.get("copy")) and entry.get("hosts") is not None):
            errors.append(f"{entry.get('name')}: needs `hosts` and de/en `copy`")
    errors += [
        f"not-flows.yaml: {kind} {name} needs a reason"
        for kind in ("hosts", "env")
        for name, reason in (register.not_flows.get(kind) or {}).items()
        if not reason
    ]
    return errors


def _files(roots: tuple[str, ...], repo_root: Path) -> list[Path]:
    found = []
    for root in roots:
        path = repo_root / root
        candidates = [path] if path.is_file() else sorted(p for p in path.rglob("*") if p.is_file())
        found += [p for p in candidates if p.suffix in SUFFIXES and not _skipped(p, repo_root)]
    return found


def _skipped(path: Path, repo_root: Path) -> bool:
    relative = "/" + path.relative_to(repo_root).as_posix()
    return any(part in relative for part in SKIPPED_PARTS)


def scan_env(repo_root: Path = REPO_ROOT) -> dict[str, set[str]]:
    """Each matching variable name, with the files that name it."""
    found: dict[str, set[str]] = {}
    paths = _files(RUNTIME_ROOTS, repo_root) + [repo_root / p for p in ENV_ONLY_SOURCES if (repo_root / p).is_file()]
    for path in paths:
        text = path.read_text(encoding="utf-8", errors="ignore")
        for pattern in ENV_PATTERNS:
            for name in pattern.findall(text):
                found.setdefault(name, set()).add(path.relative_to(repo_root).as_posix())
    return found


def _legacy_reader():
    """``current_name`` of ``apps/agent-host/entrypoint.py``: the one map of retired variable names."""
    spec = importlib.util.spec_from_file_location("agent_host_entrypoint", REPO_ROOT / "apps/agent-host/entrypoint.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.current_name


def canonical_env(found: dict[str, set[str]]) -> dict[str, set[str]]:
    """Each retired name folded into the name it is read as now: both images copy the old onto the new."""
    current_name = _legacy_reader()
    merged: dict[str, set[str]] = {}
    for name, files in found.items():
        merged.setdefault(current_name(name) or name, set()).update(files)
    return merged


def scan_hosts(repo_root: Path = REPO_ROOT) -> dict[str, set[str]]:
    """Each literal host in runtime code, with the files that name it."""
    found: dict[str, set[str]] = {}
    for path in _files(RUNTIME_ROOTS, repo_root):
        for host in HOST.findall(path.read_text(encoding="utf-8", errors="ignore")):
            host = host.lower().rstrip(".")
            if not RESERVED_HOST.search(host):
                found.setdefault(host, set()).add(path.relative_to(repo_root).as_posix())
    return found


def scan_hog_files(repo_root: Path = REPO_ROOT) -> set[str]:
    """Every Hog file under ``deploy/posthog``."""
    return {p.relative_to(repo_root).as_posix() for p in (repo_root / "deploy" / "posthog").rglob("*.hog")}


def scan_destinations(repo_root: Path = REPO_ROOT) -> set[str]:
    """The destination ids in the tables of ``deploy/posthog/README.md``."""
    readme = repo_root / "deploy" / "posthog" / "README.md"
    lines = readme.read_text(encoding="utf-8").splitlines() if readme.is_file() else []
    return {match for line in lines if line.startswith("|") for match in DESTINATION_ID.findall(line)}


def registered_env(register: Register) -> set[str]:
    """Every variable the register accounts for."""
    names = {name for row in register.rows for name in [*row.get("env", []), *row.get("activation_env", [])]}
    names |= set((register.in_cluster.get("env") or {}).keys())
    names |= {name for entry in register.public_sources for name in entry.get("env", [])}
    return names | set((register.not_flows.get("env") or {}).keys())


def registered_hosts(register: Register) -> set[str]:
    """Every host the register accounts for."""
    hosts = {host for row in register.rows for host in row.get("hosts", [])}
    hosts |= {host for entry in [*register.public_sources, *register.build] for host in entry.get("hosts", [])}
    hosts |= set(register.in_cluster.get("hosts") or [])
    return hosts | set((register.not_flows.get("hosts") or {}).keys())


def _covered(host: str, known: set[str]) -> bool:
    return any(host == entry or host.endswith("." + entry) for entry in known)


def flow_errors(register: Register, repo_root: Path = REPO_ROOT) -> list[str]:
    """Outbound flows the code opens that the register does not name, and stale exemptions."""
    env, hosts = canonical_env(scan_env(repo_root)), scan_hosts(repo_root)
    known_env, known_hosts = registered_env(register), registered_hosts(register)
    errors = [
        f"env {name} ({', '.join(sorted(files)[:2])}) has no row"
        for name, files in sorted(env.items())
        if name not in known_env
    ]
    errors += [
        f"host {host} ({', '.join(sorted(files)[:2])}) has no row"
        for host, files in sorted(hosts.items())
        if not _covered(host, known_hosts)
    ]
    hog = {path for row in register.rows for path in row.get("hog_files", [])}
    errors += [f"{path} has no row naming it in `hog_files`" for path in sorted(scan_hog_files(repo_root) - hog)]
    destinations = {d for row in register.rows for d in row.get("posthog_destinations", [])}
    errors += [
        f"PostHog destination {d} (deploy/posthog/README.md) has no row naming it in `posthog_destinations`"
        for d in sorted(scan_destinations(repo_root) - destinations)
    ]
    stale_hosts = set((register.not_flows.get("hosts") or {}).keys()) - set(hosts)
    stale_env = set((register.not_flows.get("env") or {}).keys()) - set(env)
    errors += [f"not-flows.yaml: {name} no longer occurs; remove it" for name in sorted(stale_hosts | stale_env)]
    return errors


def main() -> int:
    """Validate the register and scan the code; print every finding."""
    register = load()
    errors = register_errors(register) + flow_errors(register)
    for error in errors:
        print(f"data-flow register: {error}", file=sys.stderr)
    if errors:
        print("How to add a row: docs/compliance/data-flow-register.md", file=sys.stderr)
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
