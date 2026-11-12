/**
 * The citation source as the backend sends it and a stored message keeps it. Split from `types.ts`,
 * which re-exports it.
 */

import type { CitationLineWire } from '@/shared/citation-line'

/** Wire shape of a structured source attached to a shallow ChatResponse. */
export interface WireCitationSource extends CitationLineWire {
  content?: string
  url?: string | null
  title?: string | null
  citation_key?: string | null
  collection?: string | null
  source_type?: string | null
  tool?: string | null
  origin?: string | null
  /** Citation label ([N]) this source carries in the answer prose. */
  number?: number | null
  /** Backend identity of the document this source is a passage of. */
  document_id?: string | null
  file_name?: string | null
  page?: number | null
  /** The Punkt this passage belongs to ("3.5.2"), when the chunker established one. */
  clause?: string | null
  /** @deprecated The pre-rename spelling of `clause`; read by `citationFromWire`, never written. */
  punkt?: string | null
  /** Retrieval score (cosine similarity) the knowledge layer printed for this passage. */
  score?: number | null
  /** The retrieved passage text, bounded by the serializer. */
  snippet?: string | null
  kind?: string | null
  /** Shelf the chunk came from: `archiv | project | session | base` (ADR-0047). */
  shelf?: string | null
  lane?: string | null
  lane_label?: string | null
  binding_note?: string | null
  /**
   * Coarse binding status the backend classified this source as:
   * `binding` (statute/ordinance) | `declared_binding` (OIB-Richtlinie /
   * the lane a Land declares binding) | `interpretive` (Leitfaden/ÖNORM,
   * interpretive) | `unknown` (matched no catalogued norm — the honest
   * default, never a guess). Rides the `sources` schema's `.passthrough()`;
   * declared here so the renderer can badge it. Structured companion to the
   * prose `binding_note`.
   */
  binding_status?: string | null
  /** Boxes on the page, `[{box: [x0, y0, x1, y1], label}]` normalised 0-1 (issue #433). */
  regions?: unknown
  /** `{id, name, status}` of the other project (ADR-0094); validated by `projectFromWire`. */
  project?: unknown
}
