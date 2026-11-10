"""The licence port: what the agent reads of a document's licence, and of a licensed passage's source (ADR-0159).

Beside ``knowledge.factory``, the one other module that reaches ``knowledge_layer`` for the agent
(ADR-0072): ``look`` asks a page's licence before it shows the page to a model, and
``common.licensed_recall`` reads an earlier turn's licensed passage again from its document.
Both fail closed in the layer below; this module only names the edge.
"""

from __future__ import annotations

from typing import Any


def document_licence(collection: str, file_name: str) -> Any:
    """The licence a document's points carry (``knowledge_layer.estate.document_licence``); fails closed."""
    from knowledge_layer.estate import document_licence as read

    return read(collection, file_name)


def licensed_passage_sources(collection: str, file_name: str, page: int | None) -> tuple[Any, list[str]]:
    """A licensed document's licence now and the texts a hit on ``page`` came from (``knowledge_layer.estate``)."""
    from knowledge_layer.estate import licensed_passage_sources as read

    return read(collection, file_name, page)
