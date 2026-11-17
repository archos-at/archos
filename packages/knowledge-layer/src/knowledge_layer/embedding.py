"""The embedding client and the identity its vectors are written under.

Every embedding client in the process is built by :func:`make_embed_model`, and a
collection records which one wrote it (:func:`embed_fingerprint_metadata`), so a
model swap fails loudly instead of retrieving from a foreign vector space.
"""

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
    """Stable digest of the embedding identity a collection's vectors were written with.

    A same-dimension model swap, or a repointed base URL, produces no error at
    all, only silently wrong retrieval at a score distribution that looks
    normal; this digest is what makes it fail loudly
    (``qdrant.schema.identity_mismatch``). ``base_url`` is part of the
    identity, not decoration: the same model name served by
    a different provider is a different vector space. The model default
    (``openai/text-embedding-3-large`` on OpenRouter) once differed from the code default
    (``nvidia/llama-nemotron-embed-vl-1b-v2`` on NVIDIA), so a deployment path that missed
    the env var wrote foreign vectors into a shared collection; a repointed base URL can
    still do the same.
    """
    payload = json.dumps({"model": model, "base_url": (base_url or "").rstrip("/")}, sort_keys=True)
    return hashlib.sha256(payload.encode()).hexdigest()[:16]


def embed_fingerprint_metadata(model: str, base_url: str) -> dict[str, str]:
    """Collection metadata recording the embedding identity, human-readable digest first."""
    return {EMBED_FINGERPRINT_KEY: embed_fingerprint(model, base_url), EMBED_MODEL_KEY: model}


def resolve_embed_api_key(base_url: str, model: str) -> str:
    """Resolve the embeddings API key through the shared credential resolver.

    Chain: explicit ``EMBED_API_KEY`` → provider inference from
    ``base_url`` (``OPENROUTER_API_KEY`` for the default OpenRouter host).
    Inference only selects the KEY for the configured embeddings endpoint; it
    NEVER changes ``base_url`` (embeddings need an embeddings-capable endpoint,
    so the caller keeps its configured base).

    BYOK is intentionally NOT wired here, but no longer for want of an org id:
    ``/v1/ingest`` forwards ``x-grid-organization-id`` into the ingest thread's
    job config, which is what lets :func:`resolve_vlm_credential` reach BYOK on
    the same pipeline. The blocker is the endpoint — a BYOK credential names a
    chat-completions base URL, and embeddings need an embeddings-capable one, so
    there is nothing to point this at yet. Known follow-up — see docs.
    """
    from agent.common.credential_resolution import resolve_llm_credential

    return resolve_llm_credential(
        primary_env="EMBED_API_KEY",
        default_base_url=base_url,
        default_model=model,
        organization_id=None,
    ).api_key


def make_embed_model(*, base_url: str, model: str, api_key: str, **kwargs: Any):
    """The embedding client. Every one in the process is built here.

    Its HTTP clients pin every OpenRouter request to zero-data-retention
    endpoints (``openrouter.PLATFORM_FIXED``): the embedding model is the
    platform's, not an organization's choice, and document chunks and queries
    of every tenant pass through it. ``NVIDIAEmbedding`` hard-codes its own
    ``extra_body``, so the pin rides on the transport instead.
    """
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
