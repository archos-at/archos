import os
import re
from typing import Any

NIM_API_HOST = "integrate.api.nvidia.com"

NIM_UNSUPPORTED_MESSAGE = "nim configs no longer supported; migrate to config_oib_openrouter.yml"

LLM_API_KEY_MAP = {
    "openai": ["OPENAI_API_KEY"],
    "anthropic": ["ANTHROPIC_API_KEY"],
    "google": ["GOOGLE_API_KEY"],
    "gemini": ["GOOGLE_API_KEY"],
}


def _extract_env_var(value: str) -> str | None:
    if isinstance(value, str):
        match = re.match(r"\$\{([^}]+)\}", value)
        if match:
            return match.group(1)
    return None


def _get_llm_api_key_requirements(llm_config: dict[str, Any]) -> list[str]:
    llm_type = llm_config.get("_type", "").lower()
    required_keys = LLM_API_KEY_MAP.get(llm_type, [])

    api_key_config = llm_config.get("api_key")
    if api_key_config:
        env_var = _extract_env_var(api_key_config)
        if env_var:
            return [env_var]
        return []

    return required_keys


def find_nim_llms(config: dict[str, Any]) -> list[str]:
    offenders = []
    llms_config = config.get("llms", {}) or {}
    for llm_name, llm_config in llms_config.items():
        if not isinstance(llm_config, dict):
            continue
        llm_type = str(llm_config.get("_type", "")).lower()
        base_url = str(llm_config.get("base_url", "")).lower()
        if llm_type == "nim" or (base_url and NIM_API_HOST in base_url):
            offenders.append(llm_name)
    return offenders


def assert_no_nim_llms(config: dict[str, Any]) -> None:
    offenders = find_nim_llms(config)
    if offenders:
        raise ValueError(f"{NIM_UNSUPPORTED_MESSAGE} (offending llm entries: {', '.join(offenders)})")


def validate_llm_configs(config: dict[str, Any]) -> tuple[bool, list[str]]:
    assert_no_nim_llms(config)
    llms_config = config.get("llms", {})
    if not llms_config:
        return True, []

    missing_keys = []
    checked_keys = set()  # Track which keys we've already checked

    for llm_name, llm_config in llms_config.items():
        if not isinstance(llm_config, dict):
            continue

        required_keys = _get_llm_api_key_requirements(llm_config)

        for key in required_keys:
            if key not in checked_keys:
                checked_keys.add(key)
                if not os.getenv(key):
                    missing_keys.append(key)

    return len(missing_keys) == 0, missing_keys


def get_llm_provider_info(llm_config: dict[str, Any]) -> str:
    llm_type = llm_config.get("_type", "unknown")
    api_key_config = llm_config.get("api_key")

    if api_key_config:
        env_var = _extract_env_var(api_key_config)
        if env_var:
            return f"{llm_type} (requires {env_var})"
        return f"{llm_type} (api_key set in config)"

    required_keys = LLM_API_KEY_MAP.get(llm_type.lower(), [])
    if required_keys:
        return f"{llm_type} (requires {', '.join(required_keys)})"

    return f"{llm_type} (no API key required)"
