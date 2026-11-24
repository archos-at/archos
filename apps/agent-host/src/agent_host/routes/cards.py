from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from agent.cards.catalog import describe_card_catalog

REPOSITORY_URL = "https://github.com/GRID-check/grid-oib-agent"
FEATURE_REQUEST_URL = f"{REPOSITORY_URL}/issues/new?template=02-enhancement.yml&title=%5BFeature%5D%3A+"


def add_card_catalog_routes(router: APIRouter) -> None:

    @router.get(
        "/v1/platform/cards",
        summary="Every card type the agent can render, and where to request another",
        tags=["platform"],
    )
    async def card_catalog() -> dict[str, Any]:
        catalog = describe_card_catalog()
        return {
            **catalog,
            "cardCount": len(catalog["cards"]),
            "featureRequest": {
                "repository": REPOSITORY_URL,
                "url": FEATURE_REQUEST_URL,
                "label": "Missing a card, or a value on one? Open a feature request.",
            },
        }
