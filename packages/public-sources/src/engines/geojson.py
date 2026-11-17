"""``geojson``: a GeoJSON FeatureCollection (RFC 7946) as anchored records (ADR-0174).

What an ``ogc`` source answers. Each feature becomes one passage, anchored by
its ``id`` (or the configured property), headed by the configured title
property, its text the configured properties as ``name: value`` lines. A
change monitor compares passages by anchor, as it does a statute's.

Geometry is not text: it is dropped here and stays with the source. The
record's ``properties`` list says which attributes are read, so a service that
adds a column does not change what an answer can cite until a reviewer adds it.
"""

from __future__ import annotations

import json

from public_sources.engines.base import Engine
from public_sources.engines.base import EngineConfig
from public_sources.engines.base import EngineError
from public_sources.engines.base import ParsedDocument
from public_sources.engines.base import Passage
from pydantic import Field


class GeoJsonConfig(EngineConfig):
    #: The property that identifies a feature when the feature has no ``id``.
    id_property: str = ""
    #: The property a passage is headed by.
    title_property: str = ""
    #: The properties read into the passage's text, in this order.
    properties: tuple[str, ...] = Field(default=(), max_length=50)
    #: The document's title.
    title: str = ""


class GeoJson(Engine):
    name = "geojson"
    config_model = GeoJsonConfig

    def _anchor(self, feature: dict, index: int) -> str:
        props = feature.get("properties") or {}
        raw = feature.get("id")
        if raw in (None, "") and self.config.id_property:
            raw = props.get(self.config.id_property)
        return f"feature_{raw}" if raw not in (None, "") else f"feature_{index}"

    def document(self, body: bytes, *, url: str = "") -> ParsedDocument:
        try:
            data = json.loads(body)
        except ValueError as exc:
            raise EngineError(f"not JSON: {exc}") from exc
        if not isinstance(data, dict) or data.get("type") != "FeatureCollection":
            raise EngineError("not a GeoJSON FeatureCollection")
        features = data.get("features")
        if not isinstance(features, list):
            raise EngineError("a FeatureCollection without features")
        passages = []
        for index, feature in enumerate(features):
            if not isinstance(feature, dict):
                raise EngineError(f"feature {index} is not an object")
            props = feature.get("properties") or {}
            heading = str(props.get(self.config.title_property, "")) if self.config.title_property else ""
            lines = [f"{name}: {props[name]}" for name in self.config.properties if props.get(name) not in (None, "")]
            anchor = self._anchor(feature, index)
            passages.append(
                Passage(anchor=anchor, number=anchor.removeprefix("feature_"), heading=heading, text="\n".join(lines))
            )
        version = str(data.get("timeStamp", "") or "")
        return ParsedDocument(title=self.config.title, uri=url, version=version, passages=tuple(passages))
