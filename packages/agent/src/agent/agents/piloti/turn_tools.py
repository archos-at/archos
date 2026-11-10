"""The tools one turn is sent: the boot set, narrowed to its scope and widened by its entitlements.

The payload does not vary with the data-source toggles (a switched-off source
keeps its tool and refuses the call), so an org lands on a handful of
prompt-cache shards, never one per toggle combination. What does vary is
fixed per turn: whether there is a project, whether the asking page can run a
frontend tool (``common/client_tools``, ADR-0144), and an argument an
entitlement adds to a tool (``time-editions``' ``as_of``, ADR-0171).
"""

from __future__ import annotations

from typing import Any

from agent.common.client_tools import KNOWN_CLIENT_TOOLS
from agent.common.client_tools import client_tool_declared
from agent.common.tool_calls import tool_basename
from agent.project_context import get_project_id_from_context

#: Tools that read the PROJECT's building model. Outside a project they can
#: only answer "no project" (``tools/bim/failures.NO_PROJECT_TEXT``), and
#: their two schemas are ~8 200 of the ~17 000 tool tokens every call of the
#: turn re-sends (measured 2026-09-23 on the live request; deferral did not
#: reduce what was billed).
_PROJECT_MODEL_TOOLS = frozenset({"ifc_query", "ifc_measure"})


def tools_in_scope(tools: list[Any]) -> list[Any]:
    """The turn's tools less those that cannot run in its scope.

    The tool payload still does not vary with the data-source toggles (the
    cache shard stays one per org); it varies with two facts the turn cannot
    change — whether there is a project, and whether the asking page can run a
    frontend tool (``common/client_tools``, ADR-0144) — so an org has at most
    four shards, not one per combination.
    """
    in_project = bool(get_project_id_from_context())

    def runs_here(tool: Any) -> bool:
        # The BASE name: a grouped or MCP tool arrives as ``bim__ifc_query``.
        name = tool_basename(getattr(tool, "name", "") or "")
        if name in KNOWN_CLIENT_TOOLS:
            return client_tool_declared(name)
        return in_project or name not in _PROJECT_MODEL_TOOLS

    return [tool for tool in tools if runs_here(tool)]


def tools_for_flags(tools: list[Any], time_editions_allowed: bool) -> list[Any]:
    """The boot tools, with an argument an entitlement adds shown when this turn's organization has it.

    One today: ``law-lookup``'s ``as_of`` (``time-editions``, ADR-0171). Without the
    flag the registered tool is bound as it is, so the payload is the one before
    the flag existed; with it, an org gets one more cache shard, not one per turn.
    """
    from ris_adapter.lookup.as_of import as_of_offered

    if not as_of_offered(time_editions_allowed):
        return tools
    from ris_adapter.lookup.tool import offer_as_of

    return offer_as_of(tools)
