import pytest
from fastapi import APIRouter
from fastapi import FastAPI
from httpx import ASGITransport
from httpx import AsyncClient

from agent_host.routes.note_embeddings import add_note_embedding_routes

TOKEN = "note-embeddings-test-token"


class _FakeModel:
    def get_text_embedding_batch(self, texts: list[str]) -> list[list[float]]:
        return [[float(len(text)), 1.0] for text in texts]


@pytest.fixture
def app(monkeypatch: pytest.MonkeyPatch) -> FastAPI:
    monkeypatch.setenv("INTERNAL_API_TOKEN", TOKEN)
    app = FastAPI()
    router = APIRouter()
    add_note_embedding_routes(router)
    app.include_router(router)
    return app


async def _post(app: FastAPI, texts: list[str]) -> dict:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post(
            "/v1/note-embeddings", json={"texts": texts}, headers={"x-grid-internal-token": TOKEN}
        )
    assert response.status_code == 200
    return response.json()


async def test_it_embeds_with_the_deployments_model_and_says_which(app, monkeypatch) -> None:
    from knowledge_layer import embedding
    from knowledge_layer.search import LlamaIndexRetriever

    monkeypatch.setattr(embedding, "resolve_embed_api_key", lambda base_url, model: "key")
    monkeypatch.setattr(embedding, "make_embed_model", lambda **_: _FakeModel())

    body = await _post(app, ["Stiegenhaus in Stahlbeton", "Kapselung"])

    assert body.get("error") is None
    assert body["vectors"] == [[25.0, 1.0], [9.0, 1.0]]
    assert body["dimensions"] == 2
    assert body["fingerprint"] == embedding.embed_fingerprint(
        LlamaIndexRetriever.DEFAULT_EMBED_MODEL, LlamaIndexRetriever.DEFAULT_EMBED_BASE_URL
    )


async def test_without_a_key_it_says_so_rather_than_failing(app, monkeypatch) -> None:
    from knowledge_layer import embedding

    monkeypatch.setattr(embedding, "resolve_embed_api_key", lambda base_url, model: "")

    body = await _post(app, ["Stiegenhaus"])

    assert body["vectors"] == [] and body["error"] == "embedder_not_configured"
