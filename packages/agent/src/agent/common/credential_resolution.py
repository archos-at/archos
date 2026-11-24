from __future__ import annotations

import logging
import os
from collections.abc import Mapping
from dataclasses import dataclass
from dataclasses import replace
from typing import Any
from urllib.parse import urlsplit

from agent.common import residency
from agent.common.config_validation import NIM_API_HOST
from agent.common.config_validation import NIM_UNSUPPORTED_MESSAGE
from agent.common.openrouter import NO_RETENTION_LIMITS
from agent.common.openrouter import DataPolicy
from agent.common.openrouter import data_policy_for
from agent.common.openrouter import targets_openrouter

logger = logging.getLogger(__name__)

LEGACY_NVIDIA_KEY_ENV = "NVIDIA_API_KEY"

_nvidia_deprecation_warned = False


def warn_on_legacy_nvidia_key() -> bool:
    global _nvidia_deprecation_warned
    if _nvidia_deprecation_warned:
        return False
    if read_api_key_env(LEGACY_NVIDIA_KEY_ENV) and not read_api_key_env("OPENROUTER_API_KEY"):
        _nvidia_deprecation_warned = True
        logger.warning(
            "%s is set but OPENROUTER_API_KEY is not — NVIDIA NIM is no longer supported. "
            "Set OPENROUTER_API_KEY instead (see configs/config_oib_openrouter.yml).",
            LEGACY_NVIDIA_KEY_ENV,
        )
        return True
    return False


def read_api_key_env(name: str) -> str:
    value = os.environ.get(name, "")
    if value.startswith("${") and value.endswith("}"):
        logger.error("%s contains an unresolved ${...} placeholder - treating as unset", name)
        return ""
    return value


PROVIDER_KEY_ENV_BY_HOST: dict[str, str] = {
    "openrouter.ai": "OPENROUTER_API_KEY",
    "api.openai.com": "OPENAI_API_KEY",
}


@dataclass(frozen=True)
class ResolvedCredential:
    api_key: str
    base_url: str
    model: str
    source: str
    data_policy: DataPolicy = NO_RETENTION_LIMITS

    def request_body(self, body: Mapping[str, Any]) -> dict[str, Any]:
        if not targets_openrouter(self.base_url):
            return dict(body)
        return self.data_policy.apply(body)

    def request_extra_body(self, extra_body: Mapping[str, Any] | None = None) -> dict[str, Any] | None:
        merged = self.request_body(extra_body or {})
        return merged or None


def _infer_provider_key_env(base_url: str) -> str | None:
    host = urlsplit(base_url).hostname or ""
    if not host:
        return None
    for needle, env_name in PROVIDER_KEY_ENV_BY_HOST.items():
        if needle in host:
            return env_name
    return None


def resolve_llm_credential(
    *,
    primary_env: str,
    fallback_envs: tuple[str, ...] = (),
    default_base_url: str,
    default_model: str,
    base_url_env: str | None = None,
    model_env: str | None = None,
    organization_id: str | None = None,
    data_policy: DataPolicy | None = None,
) -> ResolvedCredential:
    resolved = _resolve(
        primary_env=primary_env,
        fallback_envs=fallback_envs,
        default_base_url=default_base_url,
        default_model=default_model,
        base_url_env=base_url_env,
        model_env=model_env,
        organization_id=organization_id,
    )
    policy = data_policy if data_policy is not None else data_policy_for(organization_id)
    base_url = residency.routed_url(resolved.base_url, residency.active_cell())
    return replace(resolved, base_url=base_url, data_policy=policy)


def _resolve(
    *,
    primary_env: str,
    fallback_envs: tuple[str, ...],
    default_base_url: str,
    default_model: str,
    base_url_env: str | None,
    model_env: str | None,
    organization_id: str | None,
) -> ResolvedCredential:
    base_url = (read_api_key_env(base_url_env) if base_url_env else "") or default_base_url
    base_url = base_url.rstrip("/")
    model = (read_api_key_env(model_env) if model_env else "") or default_model

    warn_on_legacy_nvidia_key()

    if NIM_API_HOST in (urlsplit(base_url).hostname or ""):
        raise ValueError(f"{NIM_UNSUPPORTED_MESSAGE} (base_url {base_url} points at the removed endpoint)")

    if organization_id:
        from agent.common.llm_credentials import resolve_org_llm_credential

        credential = resolve_org_llm_credential(organization_id)
        if credential is not None:
            return ResolvedCredential(
                api_key=credential.api_key,
                base_url=credential.base_url.rstrip("/"),
                model=model,
                source="byok",
            )

    key = read_api_key_env(primary_env) if primary_env else ""
    if key:
        return ResolvedCredential(api_key=key, base_url=base_url, model=model, source="env")

    for name in fallback_envs:
        key = read_api_key_env(name)
        if key:
            return ResolvedCredential(api_key=key, base_url=base_url, model=model, source="env")

    inferred_env = _infer_provider_key_env(base_url)
    if inferred_env:
        key = read_api_key_env(inferred_env)
        if key:
            return ResolvedCredential(api_key=key, base_url=base_url, model=model, source="provider-default")

    return ResolvedCredential(api_key="", base_url=base_url, model=model, source="none")
