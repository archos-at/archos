from __future__ import annotations

from typing import Any  # noqa: F401

from ifc_spatial.tools_analysis import _draw_tool  # noqa: F401
from ifc_spatial.tools_analysis import _envelope_tool  # noqa: F401
from ifc_spatial.tools_analysis import _fire_tool  # noqa: F401
from ifc_spatial.tools_analysis import _light_incidence_tool  # noqa: F401
from ifc_spatial.tools_analysis import _overhang_tool  # noqa: F401
from ifc_spatial.tools_analysis import _sun_position_tool  # noqa: F401
from ifc_spatial.tools_analysis import _view_tool  # noqa: F401
from ifc_spatial.tools_constants import GEOMETRIC_RELATIONS  # noqa: F401
from ifc_spatial.tools_constants import MEASURE_EXPENSIVE  # noqa: F401
from ifc_spatial.tools_constants import MEASURE_FN  # noqa: F401
from ifc_spatial.tools_constants import MEASURE_HEADLINE  # noqa: F401
from ifc_spatial.tools_constants import MEASURE_SUBJECT  # noqa: F401
from ifc_spatial.tools_constants import MEASURES  # noqa: F401
from ifc_spatial.tools_constants import RELATION_FN  # noqa: F401
from ifc_spatial.tools_constants import RELATIONS  # noqa: F401
from ifc_spatial.tools_helpers import _jsonable  # noqa: F401
from ifc_spatial.tools_inspect import _element_profile_tool  # noqa: F401
from ifc_spatial.tools_inspect import _element_tool  # noqa: F401
from ifc_spatial.tools_inspect import _find_elements_tool  # noqa: F401
from ifc_spatial.tools_inspect import _relations_tool  # noqa: F401
from ifc_spatial.tools_inspect import _room_inventory_tool  # noqa: F401
from ifc_spatial.tools_inspect import _shopping_list_tool  # noqa: F401
from ifc_spatial.tools_measure import _clearance_tool  # noqa: F401
from ifc_spatial.tools_measure import _distance_tool  # noqa: F401
from ifc_spatial.tools_measure import _measure_tool  # noqa: F401
from ifc_spatial.tools_measure import _storey_heights_tool  # noqa: F401
from ifc_spatial.tools_measure import _survey_tool  # noqa: F401
from ifc_spatial.tools_session import _briefing_tool  # noqa: F401
from ifc_spatial.tools_session import _model_table  # noqa: F401
from ifc_spatial.tools_session import _open_model_tool  # noqa: F401
from ifc_spatial.tools_types import ToolDef  # noqa: F401
from ifc_spatial.tools_types import ToolError  # noqa: F401

from .cache import SpatialCache  # noqa: F401
from .model import UnknownElementError  # noqa: F401
from .model import WrongKindError  # noqa: F401


def create_tools(cache: SpatialCache | None = None) -> list[ToolDef]:
    cache = cache or SpatialCache()
    register, resolve = _model_table()

    return [
        _open_model_tool(cache, register),
        _briefing_tool(resolve),
        _find_elements_tool(resolve),
        _element_tool(resolve),
        _relations_tool(resolve),
        _measure_tool(resolve),
        _survey_tool(resolve),
        _element_profile_tool(resolve),
        _distance_tool(resolve),
        _clearance_tool(resolve),
        _fire_tool(resolve),
        _envelope_tool(resolve),
        _shopping_list_tool(resolve),
        _view_tool(resolve),
        _draw_tool(resolve),
        _overhang_tool(resolve),
        _light_incidence_tool(resolve),
        _sun_position_tool(resolve),
        _storey_heights_tool(resolve),
        _room_inventory_tool(resolve),
    ]


def call(tools: list[ToolDef], name: str, args: dict[str, Any]) -> Any:
    for tool in tools:
        if tool.name == name:
            try:
                return _jsonable(tool.handler(args))
            except UnknownElementError as error:
                raise ToolError(f"{error} — GlobalId mit find_elements prüfen") from None
            except WrongKindError as error:
                raise ToolError(str(error)) from None
    raise ToolError(f'Unbekanntes Werkzeug "{name}". Verfügbar: {", ".join(t.name for t in tools)}')


__all__ = [
    "GEOMETRIC_RELATIONS",
    "MEASURES",
    "RELATIONS",
    "ToolDef",
    "ToolError",
    "call",
    "create_tools",
]
