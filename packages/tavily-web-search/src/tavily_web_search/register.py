import asyncio
import functools
import logging
import os
import re
from typing import Any

from pydantic import Field
from pydantic import SecretStr

from nat.plugin_api import Builder
from nat.plugin_api import FunctionBaseConfig
from nat.plugin_api import FunctionInfo
from nat.plugin_api import register_function

logger = logging.getLogger(__name__)


class _NoRow:
    def __init__(self, *_args: Any, **_fields: Any) -> None:
        pass

    def finish(self, *_args: Any, **_fields: Any) -> None:
        pass


class _NoOutcome:
    def __init__(self) -> None:
        self.hits: int | None = None
        self.failed = False

    def settle(self, *_args: Any, **_fields: Any) -> None:
        pass


try:  # the agent draws one row per call (ADR-0132); the standalone dist has no agent package
    from agent.common.action_outcome import ActionOutcome
    from agent.common.action_rows import ActionRow
    from agent.common.licensed_text import refused_outbound_query
except ImportError:
    ActionOutcome = _NoOutcome  # type: ignore[assignment,misc]
    ActionRow = _NoRow  # type: ignore[assignment,misc]

    def refused_outbound_query(query: str) -> str | None:  # standalone: no turn, so no licensed text to refuse
        return None


_missing_key_warned = False


class TavilyWebSearchToolConfig(FunctionBaseConfig, name="tavily_web_search"):
    include_answer: str = Field(default="advanced", description="Whether to include answers in the search results")
    max_results: int = Field(default=3, description="Maximum number of search results to return")
    api_key: SecretStr | None = Field(default=None, description="The API key for the Tavily service")
    max_retries: int = Field(default=3, ge=1, description="Maximum number of retries for the search request")
    advanced_search: bool = Field(default=False, description="Whether to use advanced search")
    max_content_length: int | None = Field(
        default=None,
        description="Max characters per result content. If set, truncates each result to reduce token usage.",
    )
    api_base_url: str | None = Field(default=None, description="API base URL to use for Tavily Client constructor")
    include_domains: list[str] = Field(
        default_factory=list,
        description=(
            "Restrict results to these domains only. Empty (default) applies no restriction. "
            "This is a hard filter: results from any domain not in the list are dropped."
        ),
    )
    exclude_domains: list[str] = Field(
        default_factory=list,
        description=(
            "Drop results from these domains. Empty (default) applies no restriction. "
            "This is a hard filter: matching domains are removed from the results."
        ),
    )


def _screened(results: list) -> tuple[list, str, bool]:
    try:
        from agent.common.web_sources import preamble
        from agent.common.web_sources import screen
    except ImportError:
        return results, "", False
    from agent.common.web_sources import score_withheld

    kept, withheld = screen(doc for doc in results if isinstance(doc, dict))
    score_withheld(len(withheld))
    return kept, preamble(withheld), bool(withheld)


_RECORD_TAG_RE = re.compile(r"<(/?(?:Document|title|source_note|Answer)\b)", re.IGNORECASE)


def _inert(text: str) -> str:
    return _RECORD_TAG_RE.sub(r"&lt;\1", text)


def _address(url: str) -> str:
    try:
        from agent.common.url_safety import strip_signed_query
    except ImportError:
        return url.replace('"', "%22")
    return strip_signed_query(url).replace('"', "%22")


def _record(doc: dict, content: str) -> str:
    note = doc.get("source_note")
    note_block = f"<source_note>\n{_inert(str(note))}\n</source_note>\n" if note else ""
    return (
        f'<Document href="{_address(str(doc.get("url") or ""))}">\n'
        f"<title>\n{_inert(str(doc.get('title')))}\n</title>\n"
        f"{note_block}{_inert(content)}\n</Document>"
    )


def _client_kwargs(tool_config: TavilyWebSearchToolConfig) -> dict:
    kwargs: dict = {
        "max_results": tool_config.max_results,
        "search_depth": "advanced" if tool_config.advanced_search else "basic",
        "include_answer": tool_config.include_answer,
    }
    if tool_config.api_base_url:
        kwargs["api_base_url"] = tool_config.api_base_url
    if tool_config.include_domains:
        kwargs["include_domains"] = tool_config.include_domains
    if excluded := [*tool_config.exclude_domains, *_product_domains()]:
        kwargs["exclude_domains"] = excluded
    return kwargs


def _product_domains() -> list[str]:
    try:
        from agent.common.brand import PRODUCT_DOMAINS
    except ImportError:
        return []
    return list(PRODUCT_DOMAINS)


def _refusing_licensed_text(search):

    @functools.wraps(search)
    async def searched(question: str) -> str:
        return refused_outbound_query(question) or await search(question)

    return searched


WEB_SEARCH_UNAVAILABLE_DESCRIPTION = "Web search tool (unavailable - missing TAVILY_API_KEY)."


WEB_SEARCH_DESCRIPTION = (
    "Retrieves relevant contexts from web search (using Tavily) for the given question.\n"
    "\n"
    "Args:\n"
    "    question (str): The question to be answered. Will be truncated to 400 characters if longer.\n"
    "\n"
    "Returns:\n"
    "    str: The web search results containing relevant documents and their URLs."
)


@register_function(config_type=TavilyWebSearchToolConfig)
async def tavily_web_search(tool_config: TavilyWebSearchToolConfig, builder: Builder):
    from langchain_tavily import TavilySearch

    if not os.environ.get("TAVILY_API_KEY") and tool_config.api_key:
        os.environ["TAVILY_API_KEY"] = tool_config.api_key.get_secret_value()

    if not os.environ.get("TAVILY_API_KEY"):
        global _missing_key_warned
        if not _missing_key_warned:
            logger.warning(
                "TAVILY_API_KEY not found. The web search tool will be registered but will "
                "return an error when called. To enable: set TAVILY_API_KEY in your environment, "
                ".env file, or specify api_key in your workflow config."
            )
            _missing_key_warned = True

        async def _tavily_web_search_stub(question: str) -> str:
            return (
                "Error: Web search is unavailable because TAVILY_API_KEY is not set.\n"
                "To enable this tool:\n"
                "1. Get an API key from https://tavily.com/\n"
                "2. Set the API key in your environment or in your .env file\n"
                "3. Restart the application"
            )

        yield FunctionInfo.from_fn(
            _tavily_web_search_stub,
            description=WEB_SEARCH_UNAVAILABLE_DESCRIPTION,
        )
        return

    tavily_kwargs = _client_kwargs(tool_config)
    tavily_search = TavilySearch(**tavily_kwargs)

    settings_key = "web.advanced_max_results" if tool_config.advanced_search else "web.max_results"

    def _max_results() -> int:
        try:
            from agent.common.retrieval_settings import get_retrieval_setting
        except ImportError:  # standalone dist: the configured count is the only one there is
            return tool_config.max_results
        return get_retrieval_setting(settings_key, tool_config.max_results)

    def _client_for(max_results: int):
        if max_results == tool_config.max_results:
            return tavily_search
        return TavilySearch(**(tavily_kwargs | {"max_results": max_results}))

    async def _tavily_web_search(question: str) -> str:
        outcome = ActionOutcome()
        row = ActionRow("web", query=question)
        try:
            result = await _search(question, outcome)
        except BaseException:
            row.finish("error")
            raise
        outcome.settle(row, default="error")
        return result

    async def _search(question: str, outcome: ActionOutcome) -> str:
        client = _client_for(_max_results())

        if len(question) > 400:
            question = question[:397] + "..."

        def _truncate_content(content: str) -> str:
            if tool_config.max_content_length and len(content) > tool_config.max_content_length:
                return content[: tool_config.max_content_length - 3] + "..."
            return content

        for attempt in range(tool_config.max_retries):
            try:
                search_docs = await client.ainvoke({"query": question})
                if isinstance(search_docs, str):
                    raise ValueError(f"Search returned an error: {search_docs}")

                if not isinstance(search_docs, dict):
                    raise ValueError(f"Search returned unexpected response type: {type(search_docs).__name__}")

                if "error" in search_docs:
                    raise ValueError(f"Search error: {search_docs['error']}")

                if "results" not in search_docs:
                    raise ValueError("Search returned no results")

                results = search_docs.get("results", [])
                if not isinstance(results, list):
                    raise ValueError(f"Tavily API returned unexpected results format: {type(results)}")
                results, header, withheld = _screened(results)

                outcome.hits = len(results)
                try:
                    from agent.common.turn_status import record_lane_hit as capture_lane_hit
                except ImportError:  # standalone dist without the agent package
                    capture_lane_hit = None
                if capture_lane_hit is not None:
                    for doc in results:
                        if not isinstance(doc, dict):
                            continue
                        url = doc.get("url") or ""
                        if url:
                            capture_lane_hit(url, title=doc.get("title") or None)

                answer_text = header  # no provider summary when it was written from a withheld hit too
                if search_docs.get("answer") and not withheld:
                    answer_text += f"<Answer>\n{_inert(str(search_docs['answer']))}\n</Answer>\n\n---\n\n"

                web_search_results = "\n\n---\n\n".join(
                    _record(doc, _truncate_content(doc.get("content") or "")) for doc in results
                )
                combined = answer_text + web_search_results
                return combined if combined else "Search returned no results"

            except Exception as e:
                if attempt == tool_config.max_retries - 1:
                    outcome.failed = True
                    error_msg = str(e)
                    if isinstance(e, ValueError):
                        return error_msg
                    if "401" in error_msg or "Unauthorized" in error_msg:
                        return (
                            "Error: Web search failed due to invalid API key (401 Unauthorized).\n"
                            "Please check your TAVILY_API_KEY and ensure it is valid.\n"
                        )
                    elif "error" in error_msg.lower():
                        return f"Error: Web search failed - {error_msg}"
                    else:
                        return f"Error: Web search failed - {error_msg}"
                await asyncio.sleep(2**attempt)

        outcome.failed = True
        return "Error: Web search failed - no attempts were made"

    yield FunctionInfo.from_fn(
        _refusing_licensed_text(_tavily_web_search),
        description=WEB_SEARCH_DESCRIPTION,
    )
