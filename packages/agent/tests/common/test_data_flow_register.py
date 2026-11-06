"""A latent vendor switched on in a deployment people sign in to stops the boot."""

from __future__ import annotations

from pathlib import Path

import pytest

from agent.common.data_flow_register import UnregisteredVendorError
from agent.common.data_flow_register import assert_no_latent_vendor
from agent.common.data_flow_register import latent_vendors
from agent.common.data_flow_register import register_dir


def _register(tmp_path: Path) -> Path:
    (tmp_path / "modal.yaml").write_text(
        "id: modal\nname: Modal Labs, Inc.\nstatus: latent\nactivation_env: [MODAL_TOKEN_ID, MODAL_TOKEN_SECRET]\n"
    )
    (tmp_path / "tavily.yaml").write_text("id: tavily\nname: Tavily\nstatus: active\nenv: [TAVILY_API_KEY]\n")
    return tmp_path


def test_a_latent_vendor_refuses_the_boot_where_people_sign_in(tmp_path: Path) -> None:
    env = {"REQUIRE_AUTH": "true", "MODAL_TOKEN_ID": "ak-123"}
    with pytest.raises(UnregisteredVendorError, match=r"Modal Labs, Inc\. \(MODAL_TOKEN_ID\)"):
        assert_no_latent_vendor(env, _register(tmp_path))


def test_a_listed_vendor_boots(tmp_path: Path) -> None:
    assert_no_latent_vendor({"REQUIRE_AUTH": "true", "TAVILY_API_KEY": "tvly-1"}, _register(tmp_path))


@pytest.mark.parametrize("value", ["", "false", "0", " off "])
def test_an_off_value_is_not_a_switch(tmp_path: Path, value: str) -> None:
    assert_no_latent_vendor({"REQUIRE_AUTH": "true", "MODAL_TOKEN_ID": value}, _register(tmp_path))


def test_a_local_deployment_is_not_checked(tmp_path: Path) -> None:
    assert_no_latent_vendor({"MODAL_TOKEN_ID": "ak-123"}, _register(tmp_path))


def test_a_missing_register_refuses_the_boot(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("agent.common.data_flow_register.register_dir", lambda: None)
    with pytest.raises(UnregisteredVendorError, match="missing"):
        assert_no_latent_vendor({"REQUIRE_AUTH": "true"})


def test_the_shipped_register_is_found_and_names_the_latent_vendors() -> None:
    found = register_dir()
    assert found is not None
    ids = {vendor.id for vendor in latent_vendors(found)}
    assert {"modal", "serper", "jina", "wandb", "langsmith"} <= ids
