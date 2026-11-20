import logging

from fastapi import APIRouter
from fastapi import Request

from ..models.writing_requests import NoteEmbeddingRequest
from ..models.writing_requests import NoteEmbeddingResponse
from .internal_auth import _require_internal_token

logger = logging.getLogger(__name__)

_MAX_TEXTS = 64
_MAX_TEXT_CHARS = 2000


def _clip(value: str) -> str:
    flat = " ".join(value.split())
    return flat[:_MAX_TEXT_CHARS]


def add_note_embedding_routes(router: APIRouter) -> None:

    @router.post(
        "/v1/note-embeddings",
        response_model=NoteEmbeddingResponse,
        tags=["platform"],
        summary="Embed short notes (memory items, platform lessons)",
        description=(
            "Batch-embeds short texts with the deployment's configured embedding model "
            "and returns the vectors plus the model fingerprint the caller must store "
            "alongside them."
        ),
    )
    async def note_embeddings(request: NoteEmbeddingRequest, http_request: Request) -> NoteEmbeddingResponse:
        _require_internal_token(http_request)

        texts = [_clip(text) for text in request.texts[:_MAX_TEXTS] if text and text.strip()]
        if not texts:
            return NoteEmbeddingResponse(vectors=[], fingerprint="", dimensions=0)

        try:
            import asyncio

            from knowledge_layer.embedding import embed_fingerprint
            from knowledge_layer.embedding import resolve_embed_api_key
            from knowledge_layer.search import LlamaIndexRetriever

            model = LlamaIndexRetriever.DEFAULT_EMBED_MODEL
            base_url = LlamaIndexRetriever.DEFAULT_EMBED_BASE_URL
            api_key = resolve_embed_api_key(base_url, model)
            if not api_key:
                logger.warning("No embeddings API key resolved; notes stay on the lexical path")
                return NoteEmbeddingResponse(vectors=[], fingerprint="", dimensions=0, error="embedder_not_configured")

            from knowledge_layer.embedding import make_embed_model

            embedder = make_embed_model(base_url=base_url, model=model, api_key=api_key)
            vectors = await asyncio.to_thread(embedder.get_text_embedding_batch, texts)
        except ImportError:
            logger.warning("Embedding dependencies unavailable; notes stay on the lexical path")
            return NoteEmbeddingResponse(vectors=[], fingerprint="", dimensions=0, error="embedder_unavailable")
        except Exception:
            logger.exception("Note embedding failed")
            return NoteEmbeddingResponse(vectors=[], fingerprint="", dimensions=0, error="embedding_failed")

        if not vectors or not isinstance(vectors, list) or not vectors[0]:
            return NoteEmbeddingResponse(vectors=[], fingerprint="", dimensions=0, error="embedding_failed")

        return NoteEmbeddingResponse(
            vectors=[[float(value) for value in vector] for vector in vectors],
            fingerprint=embed_fingerprint(model, base_url),
            dimensions=len(vectors[0]),
        )
