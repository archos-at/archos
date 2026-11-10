"""The boot check of the data-flow register: no latent vendor in a real deployment.

``configs/subprocessors/*.yaml`` lists every place data leaves the cluster
(``docs/compliance/data-flow-register.md``). A row with ``status: latent`` is a
vendor the code can reach but nobody has disclosed: Modal's sandbox, Serper,
Jina, Weights & Biases, LangSmith tracing. Its ``activation_env`` names the
variables that would switch it on, ``activation_files`` the files
(``~/.modal.toml``). Set one in a deployment people sign in to
(``REQUIRE_AUTH=true``) and the process refuses to start: data would flow to a
processor the legal page does not name. To use such a vendor, move its row to
``status: active``, which puts it on the page, and the boot passes.

The register is read from ``configs/subprocessors`` below the working directory
(the image's ``/app``), or the nearest such directory above this file. A
deployment without it refuses to start rather than skip the check.
"""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

import yaml

REGISTER_DIR = Path("configs") / "subprocessors"

#: Values of an activation variable that leave the vendor off.
OFF_VALUES = frozenset({"", "0", "false", "no", "off"})


class UnregisteredVendorError(RuntimeError):
    """A latent vendor is configured in a deployment people sign in to."""


@dataclass(frozen=True)
class LatentVendor:
    """One ``status: latent`` row: its id, display name and switches."""

    id: str
    name: str
    activation_env: tuple[str, ...]
    activation_files: tuple[str, ...] = ()


def register_dir(cwd: Path | None = None) -> Path | None:
    """The register directory: below the working directory, else above this file."""
    candidates = [(cwd or Path.cwd()) / REGISTER_DIR]
    candidates += [parent / REGISTER_DIR for parent in Path(__file__).resolve().parents]
    return next((path for path in candidates if path.is_dir()), None)


def latent_vendors(directory: Path) -> list[LatentVendor]:
    """Every ``status: latent`` row in the register, in file order."""
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
    """The vendor's switches that are on: variables set to something other than off, files that exist.

    A file is written ``~/…`` in the register and read below ``home`` (the
    process's home directory unless a test names another).
    """
    names = [name for name in vendor.activation_env if (env.get(name) or "").strip().lower() not in OFF_VALUES]
    base = home or Path.home()
    return names + [path for path in vendor.activation_files if (base / path.removeprefix("~/")).exists()]


def is_real_deployment(env: Mapping[str, str]) -> bool:
    """A deployment people sign in to: the rule ``startup_banner.flag_source`` applies."""
    return (env.get("REQUIRE_AUTH") or "").lower() == "true"


def assert_no_latent_vendor(
    env: Mapping[str, str] | None = None, directory: Path | None = None, home: Path | None = None
) -> None:
    """Refuse the boot when a latent vendor is switched on where people sign in.

    A no-op in a local or test deployment (``REQUIRE_AUTH`` not ``true``).
    """
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
