from __future__ import annotations

from collections.abc import Callable
from functools import partial
from typing import Any

from ifc_spatial.tools_constants import _PROFILE_LIST_CAP
from ifc_spatial.tools_constants import MAX_BATCH
from ifc_spatial.tools_constants import MEASURE_FN
from ifc_spatial.tools_constants import MEASURE_HEADLINE
from ifc_spatial.tools_constants import MEASURE_SLOW_PER_ELEMENT
from ifc_spatial.tools_constants import MEASURE_SUBJECT
from ifc_spatial.tools_constants import MEASURES
from ifc_spatial.tools_constants import SLOW_DEFAULT_LIMIT
from ifc_spatial.tools_helpers import _clamp
from ifc_spatial.tools_helpers import _jsonable
from ifc_spatial.tools_helpers import _lower
from ifc_spatial.tools_helpers import _require
from ifc_spatial.tools_helpers import _select
from ifc_spatial.tools_session import run
from ifc_spatial.tools_types import ToolDef
from ifc_spatial.tools_types import ToolError

from . import clearance as clr
from . import operators as op
from .briefing import storey_heights
from .model import SpatialModel


def _measure_one(
    run: Callable[[Callable[[], Any]], Any],
    fn: Callable[..., Any],
    model: SpatialModel,
    global_id: str,
) -> Any:
    try:
        return run(lambda: fn(model, global_id))
    except Exception as exc:  # noqa: BLE001
        return {"decidable": False, "error": f"{type(exc).__name__}: {exc}"}


def _headline(measure: str, answer: dict[str, Any] | None) -> float | None:
    value = (answer or {}).get("value")
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    key = MEASURE_HEADLINE.get(measure)
    if key and isinstance(value, dict):
        inner = value.get(key)
        if isinstance(inner, (int, float)) and not isinstance(inner, bool):
            return float(inner)
    return None


def _compact(value: Any) -> Any:
    if isinstance(value, list):
        if len(value) > _PROFILE_LIST_CAP:
            return [_compact(item) for item in value[:_PROFILE_LIST_CAP]] + [
                f"… {len(value) - _PROFILE_LIST_CAP} weitere (measure aufrufen für die vollständige Liste)"
            ]
        return [_compact(item) for item in value]
    if isinstance(value, dict):
        return {key: _compact(inner) for key, inner in value.items()}
    return value


def measure(resolve: Callable[[Any], SpatialModel], args: dict[str, Any]) -> Any:
    model = resolve(args.get("model"))
    name = str(args.get("measure") or "")
    fn = MEASURE_FN.get(name)
    if fn is None:
        raise ToolError(f'measure "{name}" gibt es nicht. Erlaubt: {", ".join(MEASURES)}')

    ids = [part.strip() for part in str(args.get("globalId") or "").split(",") if part.strip()]
    if not ids:
        raise ToolError("globalId fehlt — eine GlobalId angeben (aus find_elements)")
    if len(ids) == 1:
        return run(lambda: fn(model, ids[0]))
    if len(ids) > MAX_BATCH:
        raise ToolError(
            f"höchstens {MAX_BATCH} GlobalIds je Aufruf — {len(ids)} übergeben. "
            "In mehreren Aufrufen messen, oder mit find_elements eingrenzen."
        )

    results = _batch_results(model, fn, ids)
    decided = [r for r in results if (r["answer"] or {}).get("decidable")]
    numeric = [value for value in (_headline(name, r["answer"]) for r in decided) if value is not None]
    agreement: dict[str, Any] = {
        "measured": len(decided),
        "of": len(ids),
        "undecidable": [r["globalId"] for r in results if not (r["answer"] or {}).get("decidable")],
    }
    _survey_spread(agreement, name, numeric)
    return {"measure": name, "results": results, "summary": agreement}


def _batch_results(model: SpatialModel, fn: Any, ids: list[str]) -> list[dict[str, Any]]:
    return [{"globalId": gid, "answer": _jsonable(_measure_one(run, fn, model, gid))} for gid in ids]


def _check_survey_limit(requested: Any) -> None:
    try:
        if int(requested) < 1:
            raise ToolError(
                f'limit muss mindestens 1 sein — "{requested}" übergeben. Ohne limit werden '
                f"bis zu {MAX_BATCH} Bauteile gemessen."
            )
    except TypeError, ValueError:
        raise ToolError(
            f'limit muss eine ganze Zahl sein — "{requested}" übergeben. Ohne limit werden '
            f"bis zu {MAX_BATCH} Bauteile gemessen."
        ) from None


def _empty_survey(name: str, subjects: tuple[str, ...], auto_scoped: bool) -> dict[str, Any]:
    return {
        "measure": name,
        "results": [],
        "summary": {"measured": 0, "of": 0, "undecidable": []},
        "hint": (
            "Kein Bauteil passt zu dieser Auswahl — gemessen wurde daher nichts. "
            + (f"Gesucht wurde nach {', '.join(subjects)}, weil {name} darüber definiert ist. " if auto_scoped else "")
            + "Geschoßnamen und Typen stehen im Briefing; sie stammen aus diesem Export "
            "und lauten selten so, wie die Frage sie nennt."
        ),
    }


def _survey_rows(
    model: SpatialModel, matches: list[Any], subjects: tuple[str, ...], fn: Any
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    results: list[dict[str, Any]] = []
    not_applicable: list[dict[str, Any]] = []
    for element in matches:
        ref = model.ref(element).to_dict()
        global_id = str(ref.get("globalId") or "")
        if subjects and not any(element.is_a(subject) for subject in subjects):
            not_applicable.append({"globalId": global_id, "name": ref.get("name"), "ifcType": element.is_a()})
            continue
        answer = _jsonable(_measure_one(run, fn, model, global_id))
        results.append(
            {
                "globalId": global_id,
                "name": ref.get("name"),
                "storey": getattr(model.storey_of(element), "Name", None),
                "answer": answer,
            }
        )
    return results, not_applicable


def _survey_summary(results: list[dict[str, Any]], decided: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "measured": len(decided),
        "of": len(results),
        "undecidable": [
            {"globalId": r["globalId"], "name": r["name"]} for r in results if not (r["answer"] or {}).get("decidable")
        ],
    }


def _survey_spread(summary: dict[str, Any], name: str, numeric: list[Any]) -> None:
    if len(numeric) >= 2:
        low, high = min(numeric), max(numeric)
        summary |= {
            "min": round(low, 6),
            "max": round(high, 6),
            "spread": round(high - low, 6),
            "spreadOver": len(numeric),
            "spreadOf": MEASURE_HEADLINE.get(name) or "value",
        }
    elif len(numeric) == 1:
        summary["note"] = (
            "Nur ein Bauteil lieferte eine Zahl — daraus folgt keine Spanne und keine Aussage über die übrigen."
        )


def _survey_not_applicable(
    summary: dict[str, Any], name: str, subjects: tuple[str, ...], not_applicable: list[dict[str, Any]]
) -> None:
    if not_applicable:
        kinds = sorted({entry["ifcType"] for entry in not_applicable})
        summary["notApplicable"] = {
            "count": len(not_applicable),
            "ifcTypes": kinds,
            "why": (
                f"{name} ist über {', '.join(subjects)} definiert; diese Bauteile sind "
                f"{', '.join(kinds)}. Sie wurden übergangen, nicht gemessen und nicht als "
                "unentscheidbar gewertet — das ist eine Aussage über die Auswahl."
            ),
        }


def _survey_provenance(summary: dict[str, Any], decided: list[dict[str, Any]]) -> None:
    provenances = [(r["answer"] or {}).get("provenance") for r in decided]
    summary["provenance"] = {
        kind: provenances.count(kind) for kind in ("declared", "computed", "inferred") if provenances.count(kind)
    }
    disagreeing = [r for r in decided if (r["answer"] or {}).get("agreement") == "disagree"]
    if disagreeing:
        summary["disagree"] = [{"globalId": r["globalId"], "name": r["name"]} for r in disagreeing]


def _mark_survey_truncated(
    out: dict[str, Any],
    name: str,
    total: int,
    not_applicable: list[dict[str, Any]],
    results: list[dict[str, Any]],
    requested: Any,
    slow: bool,
) -> None:
    if total - len(not_applicable) <= len(results):
        return
    out["truncated"] = True
    measurable = total - len(not_applicable)
    out["summary"]["selected"] = measurable
    out["hint"] = (
        f"{measurable} messbare Bauteile passen zur Auswahl, gemessen wurden die ersten {len(results)}. "
        "Die Spanne gilt NUR für diese; enger auswählen (storey, nameContains) und erneut messen."
        + (
            f" {name} kostet je Bauteil spürbar Zeit, deshalb liegt die Voreinstellung hier bei "
            f"{SLOW_DEFAULT_LIMIT} statt {MAX_BATCH} — mit einem ausdrücklichen limit messbar."
            if slow and requested is None
            else ""
        )
    )


def survey(resolve: Callable[[Any], SpatialModel], args: dict[str, Any]) -> Any:
    model = resolve(args.get("model"))
    name = str(args.get("measure") or "")
    fn = MEASURE_FN.get(name)
    if fn is None:
        raise ToolError(f'measure "{name}" gibt es nicht. Erlaubt: {", ".join(MEASURES)}')

    requested = args.get("limit")
    slow = name in MEASURE_SLOW_PER_ELEMENT
    default = SLOW_DEFAULT_LIMIT if slow else MAX_BATCH
    limit = _clamp(default if requested is None else requested, 1, MAX_BATCH)
    if requested is not None:
        _check_survey_limit(requested)

    subjects = MEASURE_SUBJECT.get(name, ())
    auto_scoped = bool(subjects) and not _lower(args.get("ifcType"))
    matches, total = _select(model, args, limit, subjects if auto_scoped else ())
    if not matches:
        return _empty_survey(name, subjects, auto_scoped)

    results, not_applicable = _survey_rows(model, matches, subjects, fn)
    decided = [r for r in results if (r["answer"] or {}).get("decidable")]
    numeric = [value for value in (_headline(name, r["answer"]) for r in decided) if value is not None]
    summary = _survey_summary(results, decided)
    _survey_spread(summary, name, numeric)
    _survey_not_applicable(summary, name, subjects, not_applicable)
    _survey_provenance(summary, decided)

    out: dict[str, Any] = {"measure": name, "results": results, "summary": summary}
    if auto_scoped:
        out["scopedTo"] = list(subjects)
    _mark_survey_truncated(out, name, total, not_applicable, results, requested, slow)
    return out


def distance(resolve: Callable[[Any], SpatialModel], args: dict[str, Any]) -> Any:
    model = resolve(args.get("model"))
    mode = str(args.get("mode") or "min")
    return run(lambda: op.distance(model, str(args.get("a") or ""), str(args.get("b") or ""), mode))


def _measure_tool(resolve: Callable[[Any], SpatialModel]) -> ToolDef:
    return ToolDef(name="measure", handler=partial(measure, resolve))


def _survey_tool(resolve: Callable[[Any], SpatialModel]) -> ToolDef:
    return ToolDef(name="survey", handler=partial(survey, resolve))


def _distance_tool(resolve: Callable[[Any], SpatialModel]) -> ToolDef:
    return ToolDef(name="distance", handler=partial(distance, resolve))


def _clearance_tool(resolve: Callable[[Any], SpatialModel]) -> ToolDef:
    return ToolDef(
        name="clearance",
        handler=lambda args: _jsonable(
            clr.clear_width(resolve(args.get("model")), _require(args, "a"), _require(args, "b"))
        ),
    )


def _storey_heights_tool(resolve: Callable[[Any], SpatialModel]) -> ToolDef:
    return ToolDef(name="storey_heights", handler=lambda args: storey_heights(resolve(args.get("model"))))
