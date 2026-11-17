import logging
from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel
from pydantic import Field

from nat.plugin_api import FunctionBaseConfig
from nat.plugin_api import FunctionGroup
from nat.plugin_api import FunctionInfo
from nat.plugin_api import FunctionRef
from nat.plugin_api import register_function

_GROUP_SEPARATORS = (FunctionGroup.SEPARATOR, FunctionGroup.LEGACY_SEPARATOR)

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class DataSourceMeta:
    id: str
    name: str
    description: str
    default_enabled: bool = True
    requires_auth: bool = False


_registry: dict[str, DataSourceMeta] = {}
_tool_source_map: dict[str, str] = {}  # exact tool name → source ID
_group_source_map: dict[str, str] = {}  # group prefix → source ID
_sorted_prefix_refs: list[tuple[str, str]] = []


class DataSourceEntry(BaseModel):
    id: str = Field(..., description="Source ID used in API and filtering (e.g. 'web_search')")
    name: str = Field(..., description="Display name shown in the UI")
    description: str = Field(default="", description="Human-readable description")
    default_enabled: bool = Field(default=True, description="Whether enabled by default")
    requires_auth: bool = Field(default=False, description="Whether the source requires user authentication")
    tools: list[FunctionRef] = Field(
        default_factory=list,
        description="NAT functions or function groups that belong to this data source",
    )


class DataSourceRegistryConfig(FunctionBaseConfig, name="data_source_registry"):
    sources: list[DataSourceEntry] = Field(
        default_factory=list,
        description="List of data source definitions",
    )


def _populate(sources: list[dict], group_names: set[str] | None = None) -> None:
    group_names = group_names or set()
    tool_map: dict[str, str] = {}
    group_map: dict[str, str] = {}

    for entry in sources:
        source_id = entry["id"]
        _registry[source_id] = DataSourceMeta(
            id=source_id,
            name=entry.get("name", source_id.replace("_", " ").title()),
            description=entry.get("description", ""),
            default_enabled=entry.get("default_enabled", True),
            requires_auth=entry.get("requires_auth", False),
        )
        for ref_name in entry.get("tools", []):
            if ref_name in group_names:
                group_map[ref_name] = source_id
            else:
                tool_map[ref_name] = source_id

    set_tool_source_map(tool_map)
    set_group_source_map(group_map)


@register_function(config_type=DataSourceRegistryConfig)
async def data_source_registry_fn(config: DataSourceRegistryConfig, builder: Any):
    function_groups = set(getattr(builder, "_function_groups", {}))

    entries = [
        {
            "id": entry.id,
            "name": entry.name,
            "description": entry.description,
            "default_enabled": entry.default_enabled,
            "requires_auth": entry.requires_auth,
            "tools": [str(ref) for ref in entry.tools],
        }
        for entry in config.sources
    ]
    _populate(entries, group_names=function_groups)

    logger.info(
        "Loaded %d data source(s): %d tool(s), %d group(s)",
        len(config.sources),
        len(_tool_source_map),
        len(_group_source_map),
    )

    async def _noop(query: str) -> str:
        return "This is a config-only function."

    yield FunctionInfo.from_fn(_noop, description="Data source registry (config-only)")


def get_all_tool_refs() -> list[str]:
    refs: set[str] = set()
    refs.update(_tool_source_map.keys())
    refs.update(_group_source_map.keys())
    return sorted(refs)


def get_all_sources() -> list[DataSourceMeta]:
    return list(_registry.values())


def get_source(source_id: str) -> DataSourceMeta | None:
    return _registry.get(source_id)


def get_source_id_for_tool(tool_name: str) -> str | None:
    source_id = _tool_source_map.get(tool_name)
    if source_id is not None:
        return source_id

    for ref_name, source_id in _sorted_prefix_refs:
        if any(tool_name.startswith(ref_name + sep) for sep in _GROUP_SEPARATORS):
            return source_id

    return None


def _rebuild_prefix_index() -> None:
    global _sorted_prefix_refs
    combined: dict[str, str] = dict(_tool_source_map)
    combined.update(_group_source_map)  # group refs take precedence on tie
    _sorted_prefix_refs = sorted(combined.items(), key=lambda item: len(item[0]), reverse=True)


def set_tool_source_map(mapping: dict[str, str]) -> None:
    global _tool_source_map
    _tool_source_map = mapping
    _rebuild_prefix_index()


def set_group_source_map(mapping: dict[str, str]) -> None:
    global _group_source_map
    _group_source_map = mapping
    _rebuild_prefix_index()


def populate_from_config(sources: list[dict], group_names: set[str] | None = None) -> None:
    _populate(sources, group_names=group_names)


def reset_registry() -> None:
    _registry.clear()
    global _tool_source_map, _group_source_map, _sorted_prefix_refs
    _tool_source_map = {}
    _group_source_map = {}
    _sorted_prefix_refs = []
