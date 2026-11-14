"""Fixtures every knowledge-layer test may ask for."""

from knowledge_layer_testing.vector_store import few_payload_indexes  # noqa: F401 - a cheap collection
from knowledge_layer_testing.vector_store import fresh_qdrant_store  # noqa: F401 - a store of its own
from knowledge_layer_testing.vector_store import qdrant_store  # noqa: F401 - the shared store fixture
from knowledge_layer_testing.vector_store import reads_as_an_office  # noqa: F401 - a search names its office
