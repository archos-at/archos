import logging

from knowledge_layer.search.grounding_hits import grounding_hits
from knowledge_layer.search.trace_lanes import trace_lanes_for_hits

logger = logging.getLogger(__name__)


def empty_search_message(
    query: str,
    *,
    file_name: str | None = None,
    doc_class: str | None = None,
    title_contains: str | None = None,
    folder: str | None = None,
) -> str:
    bits = [f"query={query!r}"]
    if file_name:
        bits.append(f"file_name={file_name!r}")
    if doc_class:
        bits.append(f"doc_class={doc_class!r}")
    if title_contains:
        bits.append(f"title_contains={title_contains!r}")
    if folder:
        bits.append(f"folder={folder!r}")
    return (
        "No passage matched " + ", ".join(bits) + ". "
        "Retry once with a shorter topic query"
        + (", a different `file_name` from the inventory" if file_name else ", or `file_name=` an exact inventory name")
        + ", or `title_contains=` a fragment. "
        + (
            "If the question is about the law (OIB, Bauordnung) rather than this file's own content, "
            "retry WITHOUT `file_name=`: the norms are not filed under the reader's documents. "
            if file_name
            else ""
        )
        + (
            f"Nothing is filed under {folder!r}, or nothing there matched — drop `folder=` "
            "to search the whole shelf, or take the exact folder from the inventory. "
            if folder
            else ""
        )
        + "Do not invent a citation. This search returns passages, not whole documents: open a document by the "
        "name a hit's `Source:` line gives."
    )


async def coverage_gap(query: str, merged, verdict, config, *, widened: bool):
    from knowledge_layer.search.requery import DECIDER_JEV
    from knowledge_layer.search.requery import judge_coverage

    if verdict is None or verdict.sufficient or config.requery_decider != DECIDER_JEV:
        return None
    if not merged.success or getattr(merged, "error_message", None) or not merged.chunks:
        return None
    return await judge_coverage(query, merged.chunks, threshold=config.decision_sufficiency_threshold, widened=widened)


def format_results(
    retrieval_result,
    query: str,
    notice: str = "",
    trailer: str = "",
    preamble_note: str = "",
    opened_files: frozenset[str] = frozenset(),
    coverage_gap: str | None = None,
    reading_of: str | None = None,
) -> str:
    tail = f"\n{trailer}" if trailer else ""

    if not retrieval_result.success:
        error_msg = getattr(retrieval_result, "error_message", None) or "Unknown error"
        return f"Knowledge retrieval failed: {error_msg}\n\nQuery: '{query}'{tail}"

    degraded_detail = getattr(retrieval_result, "error_message", None)
    degraded_banner = notice + (f"WARNING: {degraded_detail}\n\n" if degraded_detail else "")

    if not retrieval_result.chunks:
        return f"{degraded_banner}No relevant documents found for query: '{query}'{tail}"

    from agent.common.grounding_block import GroundingBlock
    from agent.common.grounding_block import render_grounding_block
    from agent.common.tool_calls import KNOWLEDGE_SEARCH_TOOL
    from agent.common.turn_status import current_lane_tool

    hits = grounding_hits(retrieval_result.chunks)
    if reading_of:
        preamble = f"Read {len(hits)} passage(s) of {reading_of}, in reading order:"
    elif coverage_gap:
        preamble = f"Found {len(hits)} document(s); none of the judged ones answers the question:"
    else:
        preamble = f"Found {len(hits)} relevant document(s):"
    return render_grounding_block(
        GroundingBlock(
            preamble=f"{preamble}\n{preamble_note}" if preamble_note else preamble,
            degraded_banner=degraded_banner,
            hits=hits,
            lanes=trace_lanes_for_hits(hits, opened_files),
            tool=current_lane_tool() or KNOWLEDGE_SEARCH_TOOL,
            trailer=trailer,
            coverage_gap=coverage_gap,
        )
    )
