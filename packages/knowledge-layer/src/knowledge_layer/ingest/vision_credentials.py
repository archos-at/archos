import logging
import os

logger = logging.getLogger(__name__)

DEFAULT_VLM_MODEL = os.environ.get("VLM_MODEL", "openai/gpt-6-luna")
DEFAULT_VLM_BASE_URL = os.environ.get("VLM_BASE_URL", "https://openrouter.ai/api/v1")


def resolve_vlm_credential(organization_id: str | None = None):
    from agent.common.credential_resolution import resolve_llm_credential

    return resolve_llm_credential(
        primary_env="VLM_API_KEY",
        default_base_url=DEFAULT_VLM_BASE_URL,
        default_model=DEFAULT_VLM_MODEL,
        base_url_env="VLM_BASE_URL",
        model_env="VLM_MODEL",
        organization_id=organization_id,
    )


def _resolve_vlm_model_override(organization_id: str | None) -> str | None:
    if not organization_id:
        return None
    try:
        from agent.common.model_overrides import AgentGroup
        from agent.common.model_overrides import resolve_org_model_overrides

        return resolve_org_model_overrides(organization_id).get(AgentGroup.INGEST_VLM.value)
    except Exception:  # noqa: BLE001 - model selection must never take ingestion down
        logger.warning("VLM model-override resolution failed for org %s", organization_id, exc_info=True)
        return None


def resolve_vlm_api_key() -> str:
    return resolve_vlm_credential(organization_id=None).api_key


def vlm_configured() -> bool:
    return bool(resolve_vlm_api_key())


def _get_vlm_api_key() -> str:
    return resolve_vlm_api_key()
