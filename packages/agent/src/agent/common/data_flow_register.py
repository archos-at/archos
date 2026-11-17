from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

import yaml

REGISTER_DIR = Path("configs") / "subprocessors"

OFF_VALUES = frozenset({"", "0", "false", "no", "off"})


class UnregisteredVendorError(RuntimeError):
    ...


@dataclass(frozen=True)
class LatentVendor:

    id: str
    name: str
    activation_env: tuple[str, ...]
    activation_files: tuple[str, ...] = ()


def register_dir(cwd: Path | None = None) -> Path | None:
    candidates = [(cwd or Path.cwd()) / REGISTER_DIR]
    candidates += [parent / REGISTER_DIR for parent in Path(__file__).resolve().parents]
    return next((path for path in candidates if path.is_dir()), None)


def latent_vendors(directory: Path) -> list[LatentVendor]:
    vendors = []
    for path in sorted(directory.glob("*.yaml")):
        row = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        if row.get("status") != "latent":
            continue
        vendors.append(
            LatentVendor(
                id=str(row["id"]),
                name=str(row["name"]),
                activation_env=tuple(row.get("activation_env") or ()),
                activation_files=tuple(row.get("activation_files") or ()),
            )
        )
    return vendors


def switched_on(vendor: LatentVendor, env: Mapping[str, str], home: Path | None = None) -> list[str]:
    names = [name for name in vendor.activation_env if (env.get(name) or "").strip().lower() not in OFF_VALUES]
    base = home or Path.home()
    return names + [path for path in vendor.activation_files if (base / path.removeprefix("~/")).exists()]


def is_real_deployment(env: Mapping[str, str]) -> bool:
    return (env.get("REQUIRE_AUTH") or "").lower() == "true"


def assert_no_latent_vendor(
    env: Mapping[str, str] | None = None, directory: Path | None = None, home: Path | None = None
) -> None:
    source = os.environ if env is None else env
    if not is_real_deployment(source):
        return
    found = directory or register_dir()
    if found is None:
        raise UnregisteredVendorError(
            f"{REGISTER_DIR} is missing, so the data-flow register cannot be checked; refusing to start."
        )
    offenders = [(vendor, names) for vendor in latent_vendors(found) if (names := switched_on(vendor, source, home))]
    if not offenders:
        return
    listed = "; ".join(f"{vendor.name} ({', '.join(names)})" for vendor, names in offenders)
    raise UnregisteredVendorError(
        f"Configured but not on the processor list: {listed}. Unset the variables, or set the vendor's row in "
        f"{REGISTER_DIR} to status: active (docs/compliance/data-flow-register.md)."
    )
