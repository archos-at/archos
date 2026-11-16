import type { CitationLineWire } from '@/shared/citation-line'

export interface WireCitationSource extends CitationLineWire {
  content?: string
  url?: string | null
  title?: string | null
  citation_key?: string | null
  collection?: string | null
  source_type?: string | null
  tool?: string | null
  origin?: string | null
  number?: number | null
  document_id?: string | null
  file_name?: string | null
  page?: number | null
  clause?: string | null
  punkt?: string | null
  score?: number | null
  snippet?: string | null
  kind?: string | null
  shelf?: string | null
  lane?: string | null
  lane_label?: string | null
  binding_note?: string | null
  binding_status?: string | null
  regions?: unknown
  project?: unknown
}
