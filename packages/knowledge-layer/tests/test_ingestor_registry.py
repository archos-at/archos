import inspect
from pathlib import Path

import pytest

from agent.knowledge.base import BaseIngestor
from agent.knowledge.factory import _INGESTOR_REGISTRY
from agent.knowledge.factory import is_ingestor_registered
from agent.knowledge.factory import list_ingestors


@pytest.fixture(autouse=True)
def _import_adapters():
    import knowledge_layer.ingest.adapter  # noqa: F401


def test_llamaindex_maps_to_an_ingestor_class():
    from knowledge_layer.ingest import LlamaIndexIngestor

    assert is_ingestor_registered("llamaindex")

    registered = _INGESTOR_REGISTRY["llamaindex"]

    assert inspect.isclass(registered), f"llamaindex is registered as {registered!r}, not a class"
    assert issubclass(registered, BaseIngestor)
    assert registered.__qualname__ == LlamaIndexIngestor.__qualname__
    assert Path(inspect.getfile(registered)).resolve() == Path(inspect.getfile(LlamaIndexIngestor)).resolve()


def test_every_registered_ingestor_is_an_ingestor_class():
    for name in list_ingestors():
        registered = _INGESTOR_REGISTRY[name]

        assert inspect.isclass(registered), f"ingestor {name!r} is registered as {registered!r}, not a class"
        assert issubclass(registered, BaseIngestor), f"ingestor {name!r} does not subclass BaseIngestor"
