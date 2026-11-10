"""A captured source's identity and its display labels: which document, which origin, which lane.

Nothing here says whether a source binds. That is the turn's edition roles alone
(``citations/roles.py``, ADR-0168, ADR-0175); this module was split out of the
retired ``citations/binding.py``, whose registry and filename guesses it no longer holds.
"""

from __future__ import annotations

import hashlib
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from agent.common.norm_registry import NormRegistry
from agent.citations.citation_keys import parse_citation_key
from agent.citations.entries import SourceEntry
from agent.citations.entries import normalize_url
from agent.citations.registry import SourceRegistry


def _is_legal_database_source(entry: SourceEntry) -> bool:
    """Whether a source came from a legal-database tool (RIS): its tool name, or the collection ``ris_lookup`` states.

    A display fact about where a passage was read, never about what it is at the site: the same text
    found by web search is a web source.
    """
    name = (entry.tool_name or "").lower()
    if name.startswith("ris_") or "ris_search" in name or "ris_fetch" in name:
        return True
    return (entry.collection or "").lower().startswith("ris/")


def source_lane(entry: SourceEntry, registry: NormRegistry | None = None) -> tuple[str, str]:
    """(stratum_key, German label) for the research fan-out UI's source grouping.

    Deterministic display tagging on top of ``source_origin_token``'s coarse
    origin: Baurecht lanes split by registry rank (RIS) or OIB filename class
    (knowledge base), Projektwissen/Büroablage by collection prefix, Web
    otherwise — see ``norm_registry.lane_for_hit``. The wire tokens
    (``[KB]``/``[RIS]``/``[Web]``) are unchanged; the fan-out UI reads this
    richer label from the structured source payloads instead.
    """
    from agent.common.norm_registry import lane_for_hit
    from agent.common.norm_registry import lane_for_knowledge_hit
    from agent.common.norm_registry import load_registry

    file_name = None
    if entry.citation_key:
        file_name, _ = parse_citation_key(entry.citation_key)
    # The registry only ranks a legal-database page into its federal or state lane, a display label;
    # ``lane_for_hit`` recognises the page by its host. A source without a URL never needs it.
    if registry is None:
        registry = load_registry() if entry.url else None
    classify = lane_for_knowledge_hit if entry.source_type == "knowledge_layer" else lane_for_hit
    # The shelf the hit already carries (ADR-0047) is what decides whether the
    # default doc class means anything; without it the resolver has to guess
    # the shelf back from the collection name.
    return classify(
        doc_class=entry.doc_class,
        file_name=file_name,
        source_url=entry.url,
        collection=entry.collection,
        registry=registry,
        shelf=entry.shelf,
        authored_by=entry.authored_by,
        source_format=entry.source_format,
    )


def document_key(entry: SourceEntry) -> str:
    """Stable identity of the DOCUMENT an entry belongs to.

    A captured source is a *locus* — a passage at one page of one document —
    and the registry has always keyed it on ``(collection, filename, page)``.
    This function drops the page, leaving the identity of the document itself,
    which is what every consumer actually groups by: the chip row shows one chip
    per document, the Herleitung one card per document, and the bibliography one
    row per locus WITHIN a document.

    Stamping it on the wire (``document_id``) means the frontend no longer has
    to re-derive the grouping from filename heuristics. Precedence mirrors the
    registry's own ``_identity``:

      1. ``(collection, filename)`` — the primary key of ``document_metadata``
         and the only pair that is unique. One search fans out across the base
         corpus, the session collection and the project collections at once, so
         two different ``Plan.pdf`` can arrive in one result set.
      2. ``filename`` alone, when the collection is unknown.
      3. the normalized URL, for web/RIS sources.
      4. the title, so a source is never identity-less.
      5. a content digest, when the entry has no human label at all. Falling
         back to a bare ``label:`` made every anonymous entry share one key —
         and because the frontend PREFERS a supplied ``document_id`` over its
         own derivation, distinct sources would have been folded into a single
         document downstream. The digest is deterministic (no clock, no
         randomness), so the same entry keys the same way across processes and
         across a registry rehydrated from cache.
    """
    filename = ""
    if entry.citation_key:
        filename, _page = parse_citation_key(entry.citation_key)
    filename = filename.strip().lower()
    if filename:
        collection = (entry.collection or "").strip().lower()
        return f"doc:{collection}:{filename}" if collection else f"doc:{filename}"
    if entry.url:
        return f"url:{normalize_url(entry.url)}"
    label = (entry.title or entry.tool_name or "").strip().lower()[:120]
    if label:
        return f"label:{label}"
    fingerprint = hashlib.sha256(
        "\x1f".join(
            (entry.source_type or "", entry.tool_name or "", entry.collection or "", entry.chunk_text or "")
        ).encode("utf-8")
    ).hexdigest()[:16]
    return f"anon:{fingerprint}"


def source_label(entry: SourceEntry) -> str | None:
    """Stable identity of a captured source for the citation-health ledger.

    The document key or URL — an identifier, never the retrieved passage — so
    the platform export can name WHICH source was in play without carrying any
    answer or corpus prose across tenants. ``None`` when the entry has neither
    (a bare tool-result source, which identifies nothing citable).
    """
    return entry.citation_key or entry.url or None


def source_origin_token(entry: SourceEntry) -> str:
    """Return a stable leading origin token for a source line.

    Deterministic backend output (never LLM-generated): ``[KB]`` for the
    trusted OIB knowledge base, ``[RIS]`` for the official Austrian legal
    information system, ``[Web]`` for URL-bearing web sources. Returns an empty
    string when the origin is not cleanly identifiable, so callers emit no token
    and the frontend falls open to plain, unlabeled text.
    """
    # RIS first: a ``ris_lookup`` passage is a grounding-block hit, so it is a
    # ``knowledge_layer`` entry too, and checked second it went out as ``[KB]``
    # on every Bauordnung answer the suite read.
    if _is_legal_database_source(entry):
        return "[RIS]"
    if entry.source_type == "knowledge_layer":
        return "[KB]"
    if entry.url:
        return "[Web]"
    return ""


def agent_authored_document_names(registry: SourceRegistry | None) -> frozenset[str]:
    """Normalised names of the AGENT-AUTHORED documents this turn captured.

    The input to the verdict gate (``answer_envelope._gate_verdict``), which
    has a model-written ``reference.document`` and no registry of its own. Both
    identities a model could name a document by are included — the indexed
    filename and the display title — each reduced through
    :func:`~agent.common.provenance.normalize_document_name` so
    ``"**Brandschutzkonzept Haus B.md**"`` and ``"Brandschutzkonzept Haus-B"``
    are the same name.

    Empty when the turn captured no such document, which is the overwhelmingly
    common case and the one that must cost nothing: an empty set makes the gate
    a no-op.
    """
    from agent.common.provenance import is_agent_author
    from agent.common.provenance import normalize_document_name

    names: set[str] = set()
    for entry in registry.all_sources() if registry else ():
        if not is_agent_author(entry.authored_by):
            continue
        file_name, _ = parse_citation_key(entry.citation_key or "")
        # The basename only: a document the agent published is indexed under a
        # namespaced path (``<agent>/<item id>/<slug>.md``) that no model would
        # ever write, while the slug is the name it WOULD write.
        base_name = file_name.rsplit("/", 1)[-1]
        names.update(normalize_document_name(value) for value in (base_name, entry.title))
    names.discard("")
    return frozenset(names)
