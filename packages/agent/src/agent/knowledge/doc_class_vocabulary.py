from __future__ import annotations

DOCUMENT_CLASS_LABELS: dict[str, str] = {
    "oib_guideline": "OIB-Richtlinie",
    "oib_guide": "OIB-Leitfaden",
    "oib_explanatory_note": "OIB-Erläuterung",
    "oib_definitions": "OIB-Begriffsbestimmungen",
    "oib_reference": "OIB-Referenzdokument",
    "oib_amendment": "OIB-Änderungsdokument",
    "external_standard": "Norm (ÖNORM u.a.)",
    "law": "Gesetz / Bauordnung",
    "other": "Sonstiges Basisdokument",
}

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

DOCUMENT_CLASSES: tuple[str, ...] = tuple(DOCUMENT_CLASS_LABELS.keys())

DEFAULT_DOC_CLASS = "other"


def is_valid_doc_class(value: str | None) -> bool:
    return value in DOCUMENT_CLASS_LABELS


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

QDRANT_DOC_CLASSES: dict[str, str] = {current: legacy for legacy, current in LEGACY_DOC_CLASSES.items()}


def canonical_doc_class(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    key = LEGACY_DOC_CLASSES.get(value.strip(), value.strip())
    return key if key in DOCUMENT_CLASS_LABELS else None


def qdrant_doc_class(value: str) -> str:
    return QDRANT_DOC_CLASSES.get(value, value)
