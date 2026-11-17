import hashlib
import json
from typing import Any

from agent.common.cost_tracking import USAGE_ROLE_EMBEDDING
from agent.common.cost_tracking import meter_openai_client

from .env import env_float
from .env import env_int

EMBED_BATCH_SIZE = max(1, env_int("EMBED_BATCH_SIZE", 64))


EMBED_TIMEOUT_SECONDS = max(1.0, env_float("EMBED_TIMEOUT_SECONDS", 60.0))


EMBED_MAX_RETRIES = 2


# Query embeddings: 0.66 s median, 8.5 s p99 over 276 live calls (September 2026 census).
QUERY_EMBED_TIMEOUT_SECONDS = max(0.5, env_float("QUERY_EMBED_TIMEOUT_SECONDS", 3.0))


EMBED_FINGERPRINT_KEY = "embed_fingerprint"


EMBED_MODEL_KEY = "embed_model"


def embed_fingerprint(model: str, base_url: str) -> str:
    payload = json.dumps({"model": model, "base_url": (base_url or "").rstrip("/")}, sort_keys=True)
    return hashlib.sha256(payload.encode()).hexdigest()[:16]


def embed_fingerprint_metadata(model: str, base_url: str) -> dict[str, str]:
    return {EMBED_FINGERPRINT_KEY: embed_fingerprint(model, base_url), EMBED_MODEL_KEY: model}


def resolve_embed_api_key(base_url: str, model: str) -> str:
    from agent.common.credential_resolution import resolve_llm_credential

    return resolve_llm_credential(
        primary_env="EMBED_API_KEY",
        default_base_url=base_url,
        default_model=model,
        organization_id=None,
    ).api_key


def make_embed_model(*, base_url: str, model: str, api_key: str, **kwargs: Any):
    from llama_index.embeddings.nvidia import NVIDIAEmbedding

    from agent.common.openrouter import pinned_async_http_client
    from agent.common.openrouter import pinned_http_client

    embed_model = NVIDIAEmbedding(
        base_url=base_url,
        model=model,
        api_key=api_key,
        http_client=pinned_http_client(),
        async_http_client=pinned_async_http_client(),
        **kwargs,
    )
    meter_openai_client(getattr(embed_model, "_client", None), role=USAGE_ROLE_EMBEDDING)
    return embed_model
