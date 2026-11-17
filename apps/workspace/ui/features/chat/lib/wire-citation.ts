import type { CitationProject, CitationSource, WireCitationSource } from '../types'
import { asShelf, asSourceKind, modernizeLane } from '@/lib/source-kinds'
import { parsePageRegions } from '@/features/knowledge/lib/page-region'
import { toProjectStatus } from '@/lib/projects/project-status'
import { citationLineOf, hasCitationLine, type CitationLineWire } from '@/shared/citation-line'

const trimmed = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined

export const normalizeOrigin = (value: unknown): CitationSource['origin'] | undefined => {
  if (typeof value !== 'string') return undefined
  const lower = value
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
  if (lower === 'kb' || lower === 'ris' || lower === 'web') return lower
  return undefined
}

export const projectFromWire = (value: unknown): CitationProject | undefined => {
  if (!value || typeof value !== 'object') return undefined
  const { id, name, status, federalStateNote, landNote } = value as Record<string, unknown>
  const projectId = trimmed(id)
  if (!projectId) return undefined
  return {
    id: projectId,
    name: trimmed(name) ?? '',
    status: toProjectStatus(status),
    federalStateNote: trimmed(federalStateNote ?? landNote) ?? null,
  }
}

const wireIdentity = (wire: WireCitationSource): string => {
  if (wire.citation_key?.trim()) return `key:${wire.citation_key.trim().toLowerCase()}`
  if (wire.url?.trim()) return `url:${wire.url.trim().toLowerCase()}`
  if (wire.file_name?.trim()) {
    return `file:${wire.file_name.trim().toLowerCase()}:${wire.page ?? ''}`
  }
  return `content:${(wire.content || wire.title || '').trim().toLowerCase().slice(0, 120)}`
}

export const citationFromWire = (
  wire: WireCitationSource,
  options?: { isCited?: boolean; id?: string; timestamp?: Date }
): CitationSource => {
  const origin = normalizeOrigin(wire.origin)
  const url = typeof wire.url === 'string' && wire.url.trim() ? wire.url.trim() : undefined
  const content =
    (typeof wire.content === 'string' && wire.content.trim() && wire.content) ||
    (wire.citation_key && wire.citation_key.trim()) ||
    (wire.title && wire.title.trim()) ||
    url ||
    ''

  return {
    id: options?.id ?? wireIdentity(wire),
    url,
    content,
    timestamp: options?.timestamp ?? new Date(),
    isCited: options?.isCited,
    origin,
    title: wire.title?.trim() || undefined,
    citationKey: wire.citation_key?.trim() || undefined,
    documentId: wire.document_id?.trim() || undefined,
    collection: wire.collection?.trim() || undefined,
    sourceType: wire.source_type?.trim() || undefined,
    tool: wire.tool?.trim() || undefined,
    fileName: wire.file_name?.trim() || undefined,
    page: typeof wire.page === 'number' && Number.isFinite(wire.page) ? wire.page : undefined,
    clause: trimmed(wire.clause ?? wire.punkt),
    snippet: trimmed(wire.snippet),
    score: typeof wire.score === 'number' && Number.isFinite(wire.score) ? wire.score : undefined,
    number:
      typeof wire.number === 'number' && Number.isInteger(wire.number) && wire.number > 0
        ? wire.number
        : undefined,
    kind: asSourceKind(wire.kind),
    shelf: asShelf(wire.shelf),
    lane: trimmed(modernizeLane(wire.lane)),
    laneLabel: trimmed(wire.lane_label),
    bindingNote: trimmed(wire.binding_note),
    bindingStatus: bindingStatusOrUndefined(wire.binding_status),
    regions: parsePageRegions(wire.regions),
    project: projectFromWire(wire.project),
    line: lineOrUndefined(wire),
  }
}

const lineOrUndefined = (wire: WireCitationSource): CitationLineWire | undefined => {
  const line = citationLineOf(wire)
  return hasCitationLine(line) ? line : undefined
}

export const LEGACY_BINDING_STATUS: Readonly<Record<string, string>> = {
  bindend: 'binding',
  verbindlich_erklaert: 'declared_binding',
  auslegend: 'interpretive',
  unbekannt: 'unknown',
}

const bindingStatusOrUndefined = (value: string | null | undefined): string | undefined => {
  const raw = value?.trim()
  const status = raw && Object.hasOwn(LEGACY_BINDING_STATUS, raw) ? LEGACY_BINDING_STATUS[raw] : raw
  return status && status !== 'unknown' ? status : undefined
}

const citationIdentity = (citation: CitationSource): string => {
  const key = citation.citationKey?.trim().toLowerCase()
  if (key) return `key:${key}`
  const url = citation.url?.trim().toLowerCase().replace(/\/+$/, '')
  if (url) return `url:${url}`
  const file = citation.fileName?.trim().toLowerCase()
  if (file) return `file:${file}:${citation.page ?? ''}`
  return `content:${(citation.content || '').trim().toLowerCase().slice(0, 120)}`
}

export const sameCitation = (a: CitationSource, b: CitationSource): boolean =>
  citationIdentity(a) === citationIdentity(b)

export const mergeCitation = (
  existing: CitationSource,
  incoming: CitationSource
): CitationSource => ({
  ...existing,
  ...Object.fromEntries(
    Object.entries(incoming).filter(([, value]) => value !== undefined && value !== '')
  ),
  id: existing.id,
  timestamp: existing.timestamp,
  isCited: incoming.isCited || existing.isCited,
})

export const dedupeBufferedCitations = (
  buffered: ReadonlyArray<{ wire: WireCitationSource; isCited?: boolean }>,
  timestamp: Date
): CitationSource[] => {
  const out: CitationSource[] = []
  for (const { wire, isCited } of buffered) {
    const incoming = citationFromWire(wire, { isCited, timestamp })
    const existing = out.findIndex((candidate) => sameCitation(candidate, incoming))
    if (existing >= 0) out[existing] = mergeCitation(out[existing], incoming)
    else out.push(incoming)
  }
  return out
}

export const citationsFromWireList = (
  sources: unknown[] | undefined | null
): CitationSource[] | undefined => {
  if (!Array.isArray(sources) || sources.length === 0) return undefined
  const out: CitationSource[] = []
  for (const item of sources) {
    if (!item || typeof item !== 'object') continue
    out.push(citationFromWire(item as WireCitationSource))
  }
  return out.length > 0 ? out : undefined
}
