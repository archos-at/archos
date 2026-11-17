"""What of a chunk's metadata is embedded and shown to the model, and what stays stored only.

LlamaIndex renders a node's metadata into the text it embeds and charges it against
the chunk size. :func:`stamp_chunk_metadata` sets a file's documents up so only the
keys people ask by are rendered, and the header always fits the splitter.
"""

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
    """The provenance keys a job config carries, or an empty dict.

    Read through ``agent.common.provenance`` rather than by picking four
    strings out of ``config``, so the ingest side and the retrieval side spell
    the keys once. Empty for every human document, which is what makes the
    stamping loop a no-op for them.
    """
    from agent.common.provenance import parse_agent_provenance
    from agent.common.provenance import provenance_metadata

    provenance = parse_agent_provenance(config)
    return provenance_metadata(provenance) if provenance else {}


def apply_metadata_exclusions(document: Any) -> None:
    """Exclude non-semantic metadata from a document's embed and LLM renderings.

    Extends rather than replaces any existing exclusions -- ``SimpleDirectoryReader``
    already populates ``excluded_embed_metadata_keys`` on the non-PDF path, and
    clobbering it would re-embed the reader's own bookkeeping.

    Both lists are set because the splitter budgets on whichever of the two renderings
    is longer, so excluding from only one would leave the token cost in place.
    """
    for attribute in ("excluded_embed_metadata_keys", "excluded_llm_metadata_keys"):
        existing = list(getattr(document, attribute, None) or [])
        merged = existing + [key for key in EMBED_EXCLUDED_METADATA_KEYS if key not in existing]
        try:
            setattr(document, attribute, merged)
        except AttributeError, ValueError:  # pragma: no cover - non-llama-index document
            logger.debug("Could not set %s on %r", attribute, type(document).__name__)


_ALWAYS_RENDERED_METADATA_KEYS = frozenset({"file_name", "page_label", "content_type", "doc_class"})


def _rendered_metadata_tokens(document: Any) -> int:
    """Tokens of the longer of the document's two metadata renderings, as the splitter counts them."""
    from llama_index.core.schema import MetadataMode
    from llama_index.core.utils import get_tokenizer

    tokenizer = get_tokenizer()
    return max(len(tokenizer(document.get_metadata_str(mode=mode))) for mode in (MetadataMode.EMBED, MetadataMode.LLM))


def _is_rendered(document: Any, key: str) -> bool:
    """Whether ``key`` still reaches the embed or the LLM rendering of the document's header."""
    return key not in document.excluded_embed_metadata_keys or key not in document.excluded_llm_metadata_keys


def _fit_rendered_metadata(document: Any, limit: int) -> list[str]:
    """Stop rendering the longest free-text keys until the metadata header fits ``limit`` tokens.

    ``SentenceSplitter`` prepends the rendered metadata to every chunk and raises when it
    alone exceeds the chunk size, which fails the whole file, not the one chunk. Keys
    such as ``clause_title``/``clause_path`` carry text read out of the document, so their
    length is the document's to choose. The value stays stored for display and
    filtering; it only leaves the embedded header, and the chunk body already starts
    with the same breadcrumb. Returns the keys dropped, for the caller to log.

    The always-rendered keys go last, longest first, and only when everything else is
    gone and the header is still over ``limit``. The header can stay over ``limit`` only
    if no key is left to drop (a single value past the whole budget cannot be cut here);
    the caller measures and reports that (``stamp_chunk_metadata``).
    """
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
    """Stamp ``doc_class``, provenance and format on a file's documents; fit each header to half of ``chunk_size``.

    ``chunk_size`` is the one this job's splitter runs with (the job config's, which
    ``_ingest_job`` also sets on ``Settings``), not the ingestor's default: budgeted
    against a larger default, a header passes here and still fails the file in the
    splitter. Logs once per file, not once per page: the keys left out of the header,
    and a header still over budget although every key is out.
    """
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
