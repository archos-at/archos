"""The explicit per-document classification ("Dokumentart" / doc_class).

Unlike the free-form ``tags`` of :mod:`agent.knowledge.document_classification`
(document type + OIB discipline), the doc_class is a SINGLE, human-settable label describing what role a document
plays in the norm hierarchy. It is the authoritative signal preferred over the
filename guess (``norm_registry.oib_doc_class``) everywhere: stored on the
summaries row, stamped into chunk metadata, shown to the LLM, and used by the
lane/SourceKind classifiers. Each doc_class maps to exactly one fine lane key
(see ``norm_registry._OIB_CLASS_LANES``/``_RANK_LANES`` and ADR-0026).

Ordered + immutable so callers cannot mutate the vocabulary and any future
edit endpoint validates against the same closed set. Fail-open: an unknown
value validates to False and callers fall back to :data:`DEFAULT_DOC_CLASS`.

``document_classification`` re-exports every name here.
"""

from __future__ import annotations

# doc_class key -> German label (the "Dokumentart" the user picks / the LLM sees).
DOCUMENT_CLASS_LABELS: dict[str, str] = {
    "oib_guideline": "OIB-Richtlinie (verbindlich)",
    "oib_guide": "OIB-Leitfaden",
    "oib_explanatory_note": "OIB-Erläuterung",
    "oib_definitions": "OIB-Begriffsbestimmungen",
    "oib_reference": "OIB-Referenzdokument",
    "oib_amendment": "OIB-Änderungsdokument",
    "external_standard": "Norm (ÖNORM u.a.)",
    "law": "Gesetz / Bauordnung",
    "other": "Sonstiges Basisdokument",
}

# doc_class key -> fine lane key (``norm_registry`` stratum). The lane label is
# looked up from the registry's lane tables so the two never drift.
DOCUMENT_CLASS_LANES: dict[str, str] = {
    "oib_guideline": "building_law_oib",
    "oib_guide": "building_law_oib_guide",
    "oib_explanatory_note": "building_law_oib_explanatory_note",
    "oib_definitions": "building_law_oib_definitions",
    "oib_reference": "building_law_oib_reference",
    "oib_amendment": "building_law_oib_amendment",
    "external_standard": "external_standard",
    "law": "building_law_ris",
    "other": "building_law_base",
}

# The ordered, immutable vocabulary (keys), the single source of truth.
DOCUMENT_CLASSES: tuple[str, ...] = tuple(DOCUMENT_CLASS_LABELS.keys())

# Neutral base class assigned when no human class is set and the filename gives
# no OIB hint — a real value beats a null, and it lands in the neutral base lane.
DEFAULT_DOC_CLASS = "other"


def is_valid_doc_class(value: str | None) -> bool:
    """Return whether ``value`` is a member of the closed doc_class vocabulary."""
    return value in DOCUMENT_CLASS_LABELS


#: The keys as they were stored before the English names, old -> current. The metadata database
#: rewrites them on open (``DocumentMetadataStore._run_schema``); a queued ingest job, an older
#: pod's request and a point in the vector store written before still carry them, so every place
#: that accepts a class from outside passes it through :func:`canonical_doc_class`. Nothing writes
#: an old key into the metadata database again. Remove after one release.
LEGACY_DOC_CLASSES: dict[str, str] = {
    "oib_richtlinie": "oib_guideline",
    "oib_leitfaden": "oib_guide",
    "oib_erlaeuterung": "oib_explanatory_note",
    "oib_begriffe": "oib_definitions",
    "oib_referenz": "oib_reference",
    "oib_aenderung": "oib_amendment",
    "norm_extern": "external_standard",
    "gesetz": "law",
    "sonstiges": "other",
}

#: How the vector store still spells each class, current -> old. Qdrant payloads are renamed with the
#: vector store's own rebuild, not here, so ``doc_class`` and ``chunk_doc_class`` are written in this
#: form and a ``doc_class`` filter is pushed down in it (:func:`qdrant_doc_class`). The one place the
#: two vocabularies meet; the rebuild deletes this table.
QDRANT_DOC_CLASSES: dict[str, str] = {current: legacy for legacy, current in LEGACY_DOC_CLASSES.items()}


def canonical_doc_class(value: object) -> str | None:
    """The current key for ``value`` (current or legacy); ``None`` for anything else, blank included."""
    if not isinstance(value, str):
        return None
    key = LEGACY_DOC_CLASSES.get(value.strip(), value.strip())
    return key if key in DOCUMENT_CLASS_LABELS else None


def qdrant_doc_class(value: str) -> str:
    """The spelling the vector store holds for ``value``; a value outside the vocabulary as given."""
    return QDRANT_DOC_CLASSES.get(value, value)
