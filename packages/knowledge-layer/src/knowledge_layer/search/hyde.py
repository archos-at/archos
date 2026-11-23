import logging

logger = logging.getLogger(__name__)


async def draft_hyde_text(hyde_llm_obj, query: str, *, enabled: bool, timeout_seconds: float) -> str | None:
    try:
        from agent.common.hyde import draft_passage
        from agent.common.hyde import should_draft
    except ImportError:
        return None
    if not should_draft(query, enabled=enabled and hyde_llm_obj is not None):
        return None
    return await draft_passage(hyde_llm_obj, query, timeout_seconds=timeout_seconds)
