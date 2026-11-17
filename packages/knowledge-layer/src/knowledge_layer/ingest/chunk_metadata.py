import logging
from typing import Any

logger = logging.getLogger(__name__)


EMBED_EXCLUDED_METADATA_KEYS = (
    "file_size",
    "file_path",
    "table_index",
    "rows",
    "cols",
    "image_index",
    "image_format",
    "image_width",
    "image_height",
    "image_key",
    "stored_image_index",
    "drawing_type",
    "drawing_scale",
    "captured_at",
    "camera",
    "drawing_data",
    "segment_index",
    "segment_count",
    "authored_by",
    "approved_by",
    "approved_at",
    "producer",
    "source_format",
)


def provenance_from_config(config: dict) -> dict[str, str]:
    from agent.common.provenance import parse_agent_provenance
    from agent.common.provenance import provenance_metadata

    provenance = parse_agent_provenance(config)
    return provenance_metadata(provenance) if provenance else {}


def apply_metadata_exclusions(document: Any) -> None:
    for attribute in ("excluded_embed_metadata_keys", "excluded_llm_metadata_keys"):
        existing = list(getattr(document, attribute, None) or [])
        merged = existing + [key for key in EMBED_EXCLUDED_METADATA_KEYS if key not in existing]
        try:
            setattr(document, attribute, merged)
        except AttributeError, ValueError:  # pragma: no cover - non-llama-index document
            logger.debug("Could not set %s on %r", attribute, type(document).__name__)


_ALWAYS_RENDERED_METADATA_KEYS = frozenset({"file_name", "page_label", "content_type", "doc_class"})


def _rendered_metadata_tokens(document: Any) -> int:
    from llama_index.core.schema import MetadataMode
    from llama_index.core.utils import get_tokenizer

    tokenizer = get_tokenizer()
    return max(len(tokenizer(document.get_metadata_str(mode=mode))) for mode in (MetadataMode.EMBED, MetadataMode.LLM))


def _is_rendered(document: Any, key: str) -> bool:
    return key not in document.excluded_embed_metadata_keys or key not in document.excluded_llm_metadata_keys


def _fit_rendered_metadata(document: Any, limit: int) -> list[str]:
    if limit <= 0:
        raise ValueError(f"Metadata token budget must be positive, got {limit}")
    dropped: list[str] = []
    while _rendered_metadata_tokens(document) > limit:
        rendered = [
            key
            for key in document.metadata
            if key not in _ALWAYS_RENDERED_METADATA_KEYS and _is_rendered(document, key)
        ]
        if not rendered:
            rendered = [
                key
                for key in document.metadata
                if key in _ALWAYS_RENDERED_METADATA_KEYS and _is_rendered(document, key)
            ]
        if not rendered:
            break
        key = max(rendered, key=lambda name: len(str(document.metadata[name])))
        for attribute in ("excluded_embed_metadata_keys", "excluded_llm_metadata_keys"):
            excluded = getattr(document, attribute)
            if key not in excluded:
                excluded.append(key)
        dropped.append(key)
    return dropped


def stamp_chunk_metadata(
    documents: list[Any],
    *,
    doc_class: Any,
    provenance: dict[str, Any],
    chunk_size: int,
    file_name: str,
    source_format: str | None = None,
) -> None:
    limit = chunk_size // 2
    unrendered: set[str] = set()
    longest = 0
    for doc in documents:
        doc.metadata["doc_class"] = doc_class
        doc.metadata.update(provenance)
        if source_format:
            doc.metadata["source_format"] = source_format
        apply_metadata_exclusions(doc)
        unrendered.update(_fit_rendered_metadata(doc, limit))
        longest = max(longest, _rendered_metadata_tokens(doc))
    if unrendered:
        logger.warning(
            "Metadata too long to embed in %s; left out of the header: %s", file_name, ", ".join(sorted(unrendered))
        )
    if longest > limit:
        # nosemgrep: python.lang.security.audit.logging.logger-credential-leak.python-logger-credential-disclosure
        logger.warning(
            "Metadata header of %s stays at %d tokens with every key left out, over its %d-token budget "
            "(chunk size %d); past the chunk size the splitter fails the file",
            file_name,
            longest,
            limit,
            chunk_size,
        )
