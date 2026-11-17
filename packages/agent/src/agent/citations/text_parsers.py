"""The text parsers for tool results, by tool name: which grammar a replayed tool result is read back in.

A live turn reads a tool's ``GroundingHit`` records (``extraction``); a turn replayed from its text has
only this. The built-in registrations are at the bottom of this file, in the order they are tried.
"""

from collections.abc import Callable

from agent.citations.entries import SourceEntry
from agent.citations.entries import is_look_tool
from agent.citations.grounding_text import parse_knowledge_layer
from agent.citations.grounding_text import parse_look
from agent.citations.web_results import is_web_search_tool
from agent.citations.web_results import parse_web_results

SourceParser = Callable[[str, str], list[SourceEntry]]


_PARSER_REGISTRY: list[tuple[Callable[[str], bool], SourceParser]] = []


def register_source_parser(
    match_fn: Callable[[str], bool],
    parser_fn: SourceParser,
) -> None:
    """Register a parser for a tool name pattern.

    Args:
        match_fn: Predicate on lowercase tool name.
        parser_fn: (content, tool_name) -> list[SourceEntry]
    """
    _PARSER_REGISTRY.append((match_fn, parser_fn))


def parser_for(tool_name: str) -> SourceParser | None:
    """The first registered parser whose predicate matches ``tool_name`` (lowercased), or ``None``."""
    name_lower = tool_name.lower()
    for match_fn, parser_fn in _PARSER_REGISTRY:
        if match_fn(name_lower):
            return parser_fn
    return None


register_source_parser(lambda name: "knowledge" in name, parse_knowledge_layer)


register_source_parser(is_web_search_tool, parse_web_results)


register_source_parser(lambda name: "law_lookup" in name or "ris_lookup" in name, parse_knowledge_layer)


register_source_parser(lambda name: "read_passage" in name, parse_knowledge_layer)


register_source_parser(lambda name: "project_lookup" in name, parse_knowledge_layer)


register_source_parser(lambda name: name.endswith("list_files"), lambda content, tool_name: [])


register_source_parser(is_look_tool, parse_look)


_FILESYSTEM_PASSAGE_TOOLS = ("read_file", "grep")


_FILESYSTEM_INDEX_TOOLS = ("ls", "glob")


def _is_filesystem_tool(names: tuple[str, ...]) -> Callable[[str], bool]:
    return lambda name: any(name == base or name.endswith(f"__{base}") for base in names)


register_source_parser(_is_filesystem_tool(_FILESYSTEM_PASSAGE_TOOLS), parse_knowledge_layer)


register_source_parser(_is_filesystem_tool(_FILESYSTEM_INDEX_TOOLS), lambda content, tool_name: [])
