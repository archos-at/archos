import asyncio
import logging
from typing import Any

from pydantic import AliasChoices
from pydantic import BaseModel
from pydantic import Field

from agent.common.action_outcome import ActionOutcome
from agent.common.action_rows import ActionRow
from agent.knowledge.bim_query import run_bim_query
from agent.project_context import get_organization_id_from_context
from agent.project_context import get_project_id_from_context
from agent.tools.bim.failures import NO_ORG_TEXT
from agent.tools.bim.failures import NO_PROJECT_TEXT
from agent.tools.bim.failures import QUERY_FAILURES
from agent.tools.bim.handover import with_query_data
from agent.tools.bim.query_build import VALID_OPERATIONS
from agent.tools.bim.query_build import _build_query
from agent.tools.bim.query_render import _render
from agent.tools.bim.trace import model_handle
from agent.tools.bim.trace import record_ifc_call
from nat.plugin_api import Builder
from nat.plugin_api import FunctionBaseConfig
from nat.plugin_api import FunctionInfo
from nat.plugin_api import register_function

__all__ = ["NO_PROJECT_TEXT", "VALID_OPERATIONS", "IfcQueryConfig", "IfcQueryInput", "ifc_query"]

logger = logging.getLogger(__name__)

_TOOL_DESCRIPTION = (
    "Query the project's IFC/BIM model for EXACT facts about the building: element counts, "
    "rooms and their areas, storeys, property values (fire rating, U-value, load-bearing, …), "
    "materials and classifications. Use this INSTEAD of knowledge_search whenever the question "
    "is about THIS building rather than about a regulation — 'how many escape doors', 'net floor "
    "area per storey', 'which walls are external', 'what is the U-value of the windows'.\n"
    "\n"
    "An IFC model is a TREE: project → site → building → storey → elements, and rooms are "
    "IfcSpace elements sitting in a storey. 'which storey is this on' and 'which rooms are in "
    "the Erdgeschoss' are answered by that containment, not by geometry.\n"
    "\n"
    "operation:\n"
    "  'overview'   — what the model is: project/site/building names, storeys, totals, areas. "
    "Start here when you do not yet know what the model contains.\n"
    "  'health'     — the model's VALIDATION report: elements assigned to no storey, rooms "
    "with no published area, duplicated GlobalIds, missing standard property sets. Read this "
    "before making a claim about model coverage, and never present a model as complete without "
    "it.\n"
    "  'types'      — element counts per IFC type (IfcWall: 128, IfcDoor: 34, …).\n"
    "  'properties' — the model's OWN property vocabulary: which property sets exist, which "
    "properties they carry, and the values those properties actually take, with counts. "
    "ALWAYS call this before filtering on a property you have not seen — guessing a plausible "
    "property name returns zero rows, which reads like 'the building has none'.\n"
    "  'elements'   — list matching elements (name, type, storey, tag).\n"
    "  'element'    — everything about ONE element, addressed by its IFC GlobalId.\n"
    "  'schedule'   — the Raumbuch: every room with its storey, area and volume, plus the "
    "per-storey and building totals. Use for 'Flächenaufstellung', 'welche Räume', 'wie groß ist'. "
    "The totals already say how many rooms publish no area — report that too.\n"
    "  'takeoff'    — Massenermittlung: one quantity summed per element type, optionally split "
    "by material. Set 'quantity' (NetSideArea, NetVolume, …) and group_by=\"material\" for a "
    "cost-estimate breakdown. The material split matches the material NAMES the export wrote "
    "(a substring match on names like 'Beton C25/30'); it does not read the layer structure, so "
    "a wall counts once under its first material rather than per layer.\n"
    "  'profile'    — project facts the MODEL implies: storeys above/below ground, the "
    "Fluchtniveau band, the main use. These are PROPOSALS with their evidence — offer them "
    "through a project_profile_patch card for the user to confirm, never state them as settled.\n"
    "  'compliance' — run the OIB rule catalogue against the model and report, per requirement, "
    "how many elements are met / not met / UNDECIDABLE (the model does not publish the value, NOT "
    "that the building fails). Each row names the exact property (e.g. Pset_WallCommon.FireRating) "
    "that would settle it — report that list, it is what the architect has to add in their CAD. Pass "
    "building_class and main_use from the project data when you know them; a rule that "
    "needs a fact it was not given stands down WITH its reason rather than guessing. "
    "main_use must be one of residential, office, lodging, assembly, healthcare, "
    "agriculture, manufacturing, storage, other — anything else makes rules stand down as "
    "'not applicable', which reads as a verdict and is not one. building_class is 1-5.\n"
    "  'compliance-diff' — the same catalogue over two revisions, reporting only the "
    "requirements whose STATUS MOVED. Set 'compare_with' to a substring of the OLDER file's "
    "name. This answers 'was hat sich der letzte Stand kaputt gemacht', including a "
    "requirement that stopped being decidable.\n"
    "  'compare'    — what changed between TWO revisions of the same building. Set "
    "'compare_with' to a substring of the OLDER file's name; this model is the newer one. "
    "Matched by IFC GlobalId. Use it for 'what changed since the last submission'.\n"
    "  'aggregate'  — count/sum/avg/min/max over the matching elements, optionally grouped by "
    "ifcType, storey, predefinedType, typeName or material. This is how you answer "
    "'how many' and 'how much' — never add up an element list yourself.\n"
    "\n"
    'filters (JSON object, all optional): {"ifcTypes": ["IfcWall"], "storeys": '
    '["Erdgeschoss"], "nameContains": "Flucht", "material": "Beton", "classification": '
    '"B.1.2", "properties": [{"set": "Pset_WallCommon", "name": "IsExternal", '
    '"operator": "eq", "value": true}]}. Property operators: eq, neq, contains, gt, gte, lt, '
    "lte, exists, missing. 'set' may be omitted to search every property set. Use "
    '"source": "quantity" inside a property filter to match a quantity instead.\n'
    "\n"
    "STOREY NAMES are matched exactly, and exports name storeys whatever the modeller typed "
    "('EG', '00 Erdgeschoss', 'Level 0'). Call 'overview' first and copy the storey names it "
    "returns verbatim; any other name matches nothing, and an empty result reads like 'the ground "
    "floor has no walls'.\n"
    "\n"
    "Every filter key is validated. An unknown key is REJECTED, not ignored — if the tool says a "
    "key was not recognised, fix the spelling and call again rather than reporting the result of "
    "a query that never ran. Only 'elements', 'aggregate' and 'takeoff' take filters at all; the "
    "rest read the whole model and refuse one rather than quietly answering a wider question.\n"
    "\n"
    "If a result says its figures cover only PART of the model, say so in the answer. Those are "
    "not the building's totals and must not be presented as such.\n"
    "\n"
    "For aggregate: metric is count (default), sum, avg, min or max; sum/avg/min/max need "
    "'quantity' (e.g. NetFloorArea, NetSideArea, NetVolume). groupBy is optional. sum and avg "
    "SKIP elements that do not publish the quantity, and the summary says so as 'über X von Y "
    "Bauteilen' — report both numbers.\n"
    "\n"
    "Never turn a compliance result into a statement that the building complies. The catalogue "
    "is an orienting check (orientierende Prüfung) over the values the model publishes, it reads no geometry, and "
    "escape-route lengths, parapet heights and fire-compartment sizes are not in it at all. Say what was "
    "checked, what was not, and what could not be decided.\n"
    "\n"
    "Report the caveat line verbatim whenever one comes back: it says which parts of the "
    "building the numbers do NOT cover.\n"
    "\n"
    "A missing value is a fact about the EXPORT, not about the building. IFC2X3 models in "
    "particular rarely publish Qto_* quantity sets at all, so 'no NetFloorArea' on a 2X3 file "
    "usually means the exporter did not write quantities — not that the rooms have no area. "
    "Check 'overview' for the schema version and say which of the two it is rather than "
    "reporting zero.\n"
    "\n"
    "Whenever a row comes back with a 'Link:' value, the path is data: copy it verbatim if you "
    "name that element in a sentence. Never invent a path.\n"
    "\n"
    "How a query becomes a card is `ifc-spatial-reasoning`, not this description. Load that "
    "skill before emitting a model card. Highlight a set with the same filter that found it, "
    "rather than a list of ids. A highlight group takes exactly one of the two per group.\n"
    "\n"
    "When a compliance result comes back with a 'BCF export of the open issues:' path, OFFER it as "
    "a link at the end of the answer — `[offene Punkte als BCF](/api/projects/…/bim/checks/export?…)` "
    "using that exact path. It downloads the open requirements as a BCF 2.1 file that opens in "
    "ArchiCAD, Revit, Solibri or BIMcollab with the affected elements selected. The export is ONE-WAY: "
    "nothing reads the topics back, so a resolved item shows up here only after the corrected "
    "model is re-uploaded and checked again — say that rather than implying the BCF tracks "
    "status.\n"
    "\n"
    "model_name selects one model when the project has several (a substring of the file name); "
    "leave it empty when there is only one. Report the numbers this tool returns as they are — "
    "do not recompute, round differently, or extrapolate them."
)


class IfcQueryInput(BaseModel):
    operation: str = "overview"
    filters: str = ""
    metric: str = "count"
    quantity: str = ""
    group_by: str = ""
    global_id: str = ""
    ifc_type: str = ""
    model_name: str = ""
    compare_with: str = ""
    building_class: int = Field(default=0, validation_alias=AliasChoices("building_class", "gebaeudeklasse"))
    main_use: str = Field(default="", validation_alias=AliasChoices("main_use", "hauptnutzung"))
    limit: int = 0


def _trace(
    query: dict[str, Any],
    result: dict[str, Any] | None,
    *,
    unavailable: bool = False,
    outcome: str | None = None,
) -> None:
    operation = str(query.get("op", "unknown"))
    found = result or {}
    if outcome is None and unavailable:
        outcome = "service_unavailable"
    if outcome is None and not found.get("resolved"):
        outcome = f"unresolved:{found.get('reason', 'unknown')}"
    if outcome is not None:
        record_ifc_call(operation, outcome)
        return
    model = found.get("model") or {}
    scan = found.get("propertyScan") or {}
    record_ifc_call(
        operation,
        "resolved",
        ifc_model=model_handle(model.get("filename")),
        ifc_elements=model.get("elementCount"),
        ifc_truncated=bool(found.get("truncated")) or None,
        ifc_total_is_lower_bound=bool(found.get("totalIsLowerBound")) or None,
        ifc_catalog_sampled=(not scan.get("complete")) if scan else None,
    )


def _query_row_fields(arguments: IfcQueryInput) -> dict[str, str]:
    about = arguments.ifc_type or arguments.quantity or arguments.group_by
    return {"query": f"{arguments.operation.strip().lower() or 'overview'} {about}".strip()}


def _listed(result: dict[str, Any]) -> int | None:
    for key in ("elements", "takeoff"):
        if isinstance(result.get(key), list):
            return len(result[key])
    return None


async def run_ifc_query(arguments: IfcQueryInput, default_limit: int) -> str:
    outcome = ActionOutcome()
    row = ActionRow("model", **_query_row_fields(arguments))
    try:
        result = await _query(arguments, default_limit, outcome)
    except BaseException:
        row.finish("error")
        raise
    outcome.settle(row)
    return result


async def _query(arguments: IfcQueryInput, default_limit: int, outcome: ActionOutcome | None = None) -> str:
    outcome = outcome if outcome is not None else ActionOutcome()
    outcome.failed = True  # cleared once the model answered; a refusal on the way leaves it set
    organization_id = get_organization_id_from_context()
    if not organization_id:
        return NO_ORG_TEXT
    project_id = get_project_id_from_context()
    if not project_id:
        return NO_PROJECT_TEXT
    query = _build_query(
        operation=arguments.operation.strip().lower() or "overview",
        filters=arguments.filters,
        metric=arguments.metric,
        quantity=arguments.quantity,
        group_by=arguments.group_by,
        global_id=arguments.global_id,
        ifc_type=arguments.ifc_type,
        limit=arguments.limit if arguments.limit > 0 else default_limit,
        building_class=arguments.building_class,
        main_use=arguments.main_use,
    )
    if isinstance(query, str):
        return query
    try:
        result = await asyncio.to_thread(
            run_bim_query,
            organization_id=organization_id,
            project_id=project_id,
            query=query,
            model_name=arguments.model_name.strip() or None,
            compare_with_name=arguments.compare_with.strip() or None,
        )
    except QUERY_FAILURES.exceptions as exc:
        failure = QUERY_FAILURES.describe(exc)
        logger.log(failure.level, "ifc_query %s: %s", failure.outcome, exc)
        _trace(query, None, outcome=failure.outcome)
        return failure.text(exc)
    _trace(query, result)
    outcome.failed = not result.get("resolved")
    outcome.hits = _listed(result) if not outcome.failed else None
    rendered = _render(result, project_id, arguments.building_class, arguments.main_use.strip().lower())
    return await with_query_data(result, rendered)


class IfcQueryConfig(FunctionBaseConfig, name="ifc_query"):
    default_limit: int = Field(default=25, description="Rows returned by 'elements' when none is given.")


@register_function(config_type=IfcQueryConfig)
async def ifc_query(tool_config: IfcQueryConfig, builder: Builder):
    async def _ifc_query(arguments: IfcQueryInput) -> str:
        return await run_ifc_query(arguments, tool_config.default_limit)

    yield FunctionInfo.from_fn(_ifc_query, input_schema=IfcQueryInput, description=_TOOL_DESCRIPTION)
