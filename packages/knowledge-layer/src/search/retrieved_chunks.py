import logging
import math
import uuid
from typing import Any

from agent.knowledge.schema import Chunk
from agent.knowledge.schema import ContentType

logger = logging.getLogger(__name__)


def unit_score(score: Any) -> float:
    try:
        value = float(score)
    except TypeError, ValueError:
        return 0.0
    if not math.isfinite(value):
        return 0.0
    return min(1.0, max(0.0, value))


_CONTENT_TYPES = {
    "table": ContentType.TABLE,
    "image": ContentType.IMAGE,
    "chart": ContentType.CHART,
    "drawing": ContentType.DRAWING,
}


def chunk_from_node(raw_result: Any) -> Chunk:
    try:
        if raw_result is None:
            raise ValueError("raw_result is None")
        node = getattr(raw_result, "node", None)
        if node is None:
            raise ValueError("raw_result.node is None")
        score = raw_result.score if hasattr(raw_result, "score") else 0.0

        _meta = getattr(node, "metadata", None)
        metadata = _meta if isinstance(_meta, dict) else {}
        file_name = metadata.get("file_name", "unknown")
        page_number = _page_number(metadata.get("page_label"))
        content_type = _CONTENT_TYPES.get(str(metadata.get("content_type", "text")), ContentType.TEXT)
        content = node.get_content() if hasattr(node, "get_content") else str(node)

        return Chunk(
            chunk_id=node.node_id if hasattr(node, "node_id") else str(uuid.uuid4()),
            content=content,
            score=unit_score(score),
            file_name=file_name,
            page_number=page_number,
            display_citation=_display_citation(content_type, metadata, file_name, page_number, content),
            content_type=content_type,
            metadata=metadata,
        )

    except Exception as e:
        logger.error(f"Error normalizing LlamaIndex result: {e}")
        return Chunk(
            chunk_id=str(uuid.uuid4()),
            content=str(raw_result),
            score=0.0,
            file_name="unknown",
            display_citation="Unknown Result",
            content_type=ContentType.TEXT,
        )


def _page_number(label: Any) -> int | None:
    if label is None:
        return None
    try:
        return int(label)
    except ValueError, TypeError:
        return None


def _display_citation(
    content_type: ContentType, metadata: dict[str, Any], file_name: str, page_number: int | None, content: str
) -> str:
    if content_type == ContentType.TABLE and "table_index" not in metadata:
        return f"{file_name}, p.{page_number}" if page_number else file_name
    if content_type == ContentType.TABLE:
        table_idx = metadata.get("table_index", 0)
        return f"{file_name}, p.{page_number}, Table {table_idx + 1}"
    if content_type == ContentType.IMAGE:
        img_idx = metadata.get("image_index", 0)
        return f"{file_name}, p.{page_number}, Image {img_idx + 1}"
    if content_type == ContentType.DRAWING:
        drawing_type = metadata.get("drawing_type", "Zeichnung")
        return f"{file_name}, p.{page_number}, {drawing_type}"
    if not page_number:
        return file_name
    text_preview = content[:40].replace("\n", " ").strip()
    if text_preview:
        return f"{file_name}, p.{page_number} ('{text_preview}...')"
    return f"{file_name}, p.{page_number}"
