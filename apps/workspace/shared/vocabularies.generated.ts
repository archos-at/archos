// AUTO-GENERATED from the Python sources named below — do not edit; run `uv run python scripts/generate_vocabularies.py`

/** The kinds a person may delegate: `TaskKind` in `packages/agent/src/agent/cards/workspace_cards.py`. */
export const DELEGATABLE_TASK_KINDS = ["compliance_check", "submission_check", "document", "revision"] as const

/** The coarse source kinds: the keys of `SOURCE_KINDS` in `packages/agent/src/agent/common/source_kinds.py`. */
export const SOURCE_KINDS = ["building_law", "office", "project", "web", "measurement"] as const

/** The shelves a retrieved chunk can come from: `Shelf` in `packages/agent/src/agent/common/source_kinds.py`. */
export const SHELVES = ["office_shelf", "project", "session", "base"] as const

/** A source record's protocols: the keys of `ACCESS_TYPES` in `packages/public-sources/src/access`. */
export const SOURCE_PROTOCOLS = ["rest", "http_eli", "web_document", "ogc"] as const

/** A source record's formats: the keys of `ENGINES` in `packages/public-sources/src/engines`. */
export const SOURCE_FORMATS = ["ris_xml", "akn", "html_statute", "geojson", "pdf_document"] as const
