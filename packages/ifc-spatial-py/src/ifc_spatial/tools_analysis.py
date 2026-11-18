from __future__ import annotations

import base64
import os
import tempfile
import time
from collections.abc import Callable
from functools import partial
from typing import Any

from ifc_spatial.tools_constants import ENVELOPE_ASPECTS
from ifc_spatial.tools_constants import FIRE_ASPECTS
from ifc_spatial.tools_helpers import _jsonable
from ifc_spatial.tools_helpers import _require
from ifc_spatial.tools_helpers import _short
from ifc_spatial.tools_session import run
from ifc_spatial.tools_types import ToolDef
from ifc_spatial.tools_types import ToolError

from . import circulation as circ
from . import daylight as dl
from . import envelope_geometry as env
from . import fire as fi
from . import operators as op
from .briefing import content_hash
from .model import SpatialModel


def _plan_note(drawn: Any) -> str:
    head = f"Grundriss „{drawn.storey}“, waagrechter Schnitt {drawn.cut_z:.2f} m über Null"
    tail = "Maße NICHT aus dem Bild ablesen; dafür measure/distance."
    if drawn.drawn == 0:
        return (
            f"{head}. ACHTUNG: auf dieser Schnitthöhe wurde KEIN Bauteil gezeichnet "
            "(elementsDrawn = 0) — kein Bauteil dieses Geschoßes schneidet die Ebene. Im Bild "
            "stehen nur die Raumumrisse; das Fehlen von Wänden, Türen und Fenstern im Bild ist "
            f"keine Aussage über das Gebäude. {tail}"
        )
    return f"{head} — auf dieser Höhe erscheinen Tür- und Fensteröffnungen als Lücken in der Wand. {tail}"


def fire_op(resolve: Callable[[Any], SpatialModel], args: dict[str, Any]) -> Any:
    model = resolve(args.get("model"))
    wanted = str(args.get("what") or "escape_level").strip().lower()
    wanted = "escape_level" if wanted == "fluchtniveau" else wanted
    what = next((k for k in FIRE_ASPECTS if k.lower() == wanted), wanted)
    ids = [part.strip() for part in str(args.get("globalId") or "").split(",") if part.strip()]
    if what == "escape_level":
        return run(lambda: fi.escape_level(model))
    if what == "compartmentArea":
        if not ids:
            raise ToolError(
                "compartmentArea braucht globalId: ein Geschoß oder die Räume des Abschnitts, "
                "mehrere durch Komma getrennt. GlobalIds liefert find_elements."
            )
        return run(lambda: fi.compartment_area(model, ids))
    if what == "separatingElements":
        if len(ids) != 2:
            raise ToolError(
                "separatingElements braucht ZWEI Räume in globalId, durch Komma getrennt — "
                "gefragt ist, was zwischen ihnen liegt."
            )
        return run(lambda: fi.separating_elements(model, ids[0], ids[1]))
    if what == "siteBoundary":
        return run(lambda: fi.distance_to_site_boundary(model, ids[0] if ids else None))
    if what == "doorGraph":
        return run(lambda: circ.door_graph(model))
    raise ToolError(f'what "{what}" gibt es nicht. Erlaubt: {", ".join(FIRE_ASPECTS)}')


def envelope_op(resolve: Callable[[Any], SpatialModel], args: dict[str, Any]) -> Any:
    model = resolve(args.get("model"))
    wanted = str(args.get("what") or "thermalEnvelope").strip().lower()
    what = next((k for k in ENVELOPE_ASPECTS if k.lower() == wanted), wanted)
    if what == "thermalEnvelope":
        return run(lambda: env.thermal_envelope(model))
    if what == "areaByOrientation":
        return run(lambda: env.envelope_area_by_orientation(model))
    if what == "compactness":
        return run(lambda: env.compactness(model))
    raise ToolError(f'what "{what}" gibt es nicht. Erlaubt: {", ".join(ENVELOPE_ASPECTS)}')


def view(resolve: Callable[[Any], SpatialModel], args: dict[str, Any]) -> Any:
    from . import render as rendering

    model = resolve(args.get("model"))
    started = time.perf_counter()
    drawn = rendering.plan(
        model,
        storey=(str(args["storey"]).strip() if args.get("storey") else None),
        highlight=[str(v) for v in (args.get("highlight") or [])],
        only=[str(v) for v in (args.get("only") or [])],
    )
    seconds = time.perf_counter() - started
    if drawn is None:
        raise ToolError(
            "Für dieses Geschoß gibt es nichts zu zeichnen — kein Bauteil dieses Geschoßes trägt "
            "Geometrie, oder der Geschoßname trifft nichts. Geschoßnamen stehen im Briefing."
        )

    return {
        "pngBase64": base64.b64encode(drawn.png).decode("ascii"),
        "mediaType": "image/png",
        "width": drawn.width,
        "height": drawn.height,
        "storey": drawn.storey,
        "cutHeight": round(drawn.cut_z, 3),
        "rooms": drawn.rooms,
        "highlighted": drawn.highlighted,
        "elementsDrawn": drawn.drawn,
        "northDeclared": drawn.north_deg is not None,
        "seconds": round(seconds, 2),
        "note": _plan_note(drawn),
    }


def draw(resolve: Callable[[Any], SpatialModel], args: dict[str, Any]) -> Any:
    import ifcopenshell.draw as drawing

    model = resolve(args.get("model"))
    settings = drawing.draw_settings(
        width=float(args.get("widthMm") or 420.0),
        height=float(args.get("heightMm") or 297.0),
        include_projection=False,
        space_names=True,
    )
    if args.get("storey"):
        settings.storey_filter = str(args["storey"])
    if args.get("include"):
        settings.include_entities = ",".join(str(v) for v in args["include"])

    started = time.perf_counter()
    data = drawing.main(settings, [model.file])
    seconds = time.perf_counter() - started

    directory = tempfile.mkdtemp(prefix="ifc-spatial-")
    path = os.path.join(directory, f"plan-{_short(content_hash(model))}.svg")
    with open(path, "wb") as handle:
        handle.write(data)

    return {
        "path": path,
        "bytes": len(data),
        "seconds": round(seconds, 2),
        "note": (
            "Die Zeichnung liegt als Datei vor und kann dem Nutzer gezeigt werden. "
            "Maße nicht aus dem Bild ablesen — dafür measure/distance verwenden."
        ),
    }


def sun_position(resolve: Callable[[Any], SpatialModel], args: dict[str, Any]) -> Any:
    model = resolve(args.get("model"))
    when = args.get("when")
    if not isinstance(when, str) or not when.strip():
        raise ToolError(
            "when fehlt — den Zeitpunkt nach ISO 8601 MIT Zeitzone angeben, "
            "z. B. 2026-06-21T12:00:00+02:00 (Sommerzeit) oder 2026-06-21T10:00:00Z."
        )
    return run(lambda: dl.sun_position(model, when.strip()))


def _fire_tool(resolve: Callable[[Any], SpatialModel]) -> ToolDef:
    return ToolDef(name="fire", handler=partial(fire_op, resolve))


def _envelope_tool(resolve: Callable[[Any], SpatialModel]) -> ToolDef:
    return ToolDef(name="envelope", handler=partial(envelope_op, resolve))


def _view_tool(resolve: Callable[[Any], SpatialModel]) -> ToolDef:
    return ToolDef(name="view", handler=partial(view, resolve))


def _draw_tool(resolve: Callable[[Any], SpatialModel]) -> ToolDef:
    return ToolDef(name="draw", handler=partial(draw, resolve))


def _overhang_tool(resolve: Callable[[Any], SpatialModel]) -> ToolDef:
    return ToolDef(
        name="overhang",
        handler=lambda args: _jsonable(
            op.overhang(resolve(args.get("model")), _require(args, "projecting"), _require(args, "facade"))
        ),
    )


def _light_incidence_tool(resolve: Callable[[Any], SpatialModel]) -> ToolDef:
    return ToolDef(name="light_incidence", handler=lambda args: _light_incidence(resolve(args.get("model")), args))


def _sun_position_tool(resolve: Callable[[Any], SpatialModel]) -> ToolDef:
    return ToolDef(name="sun_position", handler=partial(sun_position, resolve))


def _light_incidence(model: SpatialModel, args: dict[str, Any]) -> Any:
    opening = _require(args, "globalId")

    angle = args.get("angle")
    if isinstance(angle, bool) or not isinstance(angle, (int, float)) or not 0 < float(angle) < 90:
        raise ToolError("angle muss ein Winkel zwischen 0 und 90 Grad sein — der Wert kommt aus der Bestimmung")
    swivel = args.get("swivel") or 0
    if isinstance(swivel, bool) or not isinstance(swivel, (int, float)) or not 0 <= float(swivel) < 90:
        raise ToolError("swivel muss zwischen 0 und 90 Grad liegen")

    built = op.prism(model, opening, float(angle), float(swivel))
    if not built.decidable or built.value is None:
        return _jsonable(built)

    exclude = [e for e in (args.get("exclude") or []) if isinstance(e, str)]
    found = op.obstructions(model, built.value, exclude=exclude or None)
    payload = _jsonable(found)
    if isinstance(payload, dict):
        blocking = found.value or []
        payload["free"] = bool(found.decidable and not blocking)
        payload["prism"] = {"angleDeg": float(angle), "swivelDeg": float(swivel), "openingId": opening}
        note = (
            "Diese Antwort ist Geometrie, kein Befund: ein geschnittenes Prisma vergrößert nach OIB 3 "
            "die erforderliche Lichteintrittsfläche, es verbietet das Fenster nicht. Die Bewertung "
            "gehört zum Regelwerk."
        )
        existing = payload.get("caveat") or ""
        if "kein Befund" not in existing:
            payload["caveat"] = f"{existing} {note}".strip() if existing else note
    return payload
