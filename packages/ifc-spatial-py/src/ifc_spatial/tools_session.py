from __future__ import annotations

import os
import time
from collections.abc import Callable
from functools import partial
from typing import Any

from ifc_spatial.tools_helpers import _lower
from ifc_spatial.tools_helpers import _short
from ifc_spatial.tools_types import ToolDef
from ifc_spatial.tools_types import ToolError

from .briefing import briefing as build_briefing
from .briefing import content_hash
from .briefing import render_briefing
from .cache import SpatialCache
from .model import SpatialModel
from .model import UnknownElementError
from .model import WrongKindError


def _model_table() -> tuple[Callable[[SpatialModel], str], Callable[[Any], SpatialModel]]:

    models: dict[str, SpatialModel] = {}

    def register(model: SpatialModel) -> str:
        digest = content_hash(model)
        models[digest] = model
        return digest

    def resolve(raw: Any) -> SpatialModel:
        key = str(raw or "").strip().lower()
        if not key:
            raise ToolError("model fehlt — zuerst open_model aufrufen")
        exact = models.get(key)
        if exact is not None:
            return exact
        if len(key) >= 8:
            matches = [h for h in models if h.startswith(key)]
            if len(matches) == 1:
                return models[matches[0]]
            if len(matches) > 1:
                raise ToolError(f'model "{key}" ist mehrdeutig ({len(matches)} Treffer) — mehr Stellen angeben')
        offen = ", ".join(_short(h) for h in models) or "keines"
        raise ToolError(f'model "{key}" ist nicht geöffnet — open_model aufrufen. Offen: {offen}')

    return register, resolve


def run(fn: Callable[[], Any]) -> Any:
    try:
        return fn()
    except UnknownElementError as error:
        raise ToolError(f"{error} — GlobalId mit find_elements prüfen") from None
    except WrongKindError as error:
        raise ToolError(str(error)) from None


def open_model(cache: SpatialCache, register: Callable[[SpatialModel], str], args: dict[str, Any]) -> Any:
    source = str(args.get("path") or "").strip()
    started = time.perf_counter()
    try:
        if not source:
            raise ToolError("Eine Quelle angeben: path")
        if not os.path.isfile(source):
            raise ToolError(f'Datei nicht gefunden: "{source}"')
        model = cache.load(source)
    except ToolError:
        raise
    except Exception as error:  # noqa: BLE001
        raise ToolError(f"Modell konnte nicht geöffnet werden: {error}") from error
    digest = register(model)
    return {
        "model": _short(digest),
        "contentHash": digest,
        "briefing": render_briefing(model),
        "seconds": round(time.perf_counter() - started, 3),
        "geometry": {
            "pass": "gelaufen" if model.geometry_seconds > 0 else "noch nicht gelaufen",
            "note": (
                "Der Geometrie-Pass läuft beim ersten Maß automatisch (~2 s für ein Einfamilienhaus). "
                "Topologische Fragen brauchen ihn nicht."
            ),
        },
    }


def _open_model_tool(cache: SpatialCache, register: Callable[[SpatialModel], str]) -> ToolDef:
    return ToolDef(name="open_model", handler=partial(open_model, cache, register))


def _briefing_tool(resolve: Callable[[Any], SpatialModel]) -> ToolDef:
    return ToolDef(
        name="briefing",
        handler=lambda args: (
            {"briefing": render_briefing(resolve(args.get("model")))}
            if _lower(args.get("format")) != "json"
            else build_briefing(resolve(args.get("model"))).to_dict()
        ),
    )
