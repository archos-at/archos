import { z } from 'zod'
import type { CitationSource, WireCitationSource } from '../../types'
import { citationFromWire } from '../wire-citation'

export const CITATIONS_PAYLOAD_VERSION = 1

const renameLegacyProjectNote = (value: unknown): unknown => {
  if (typeof value !== 'object' || value === null || !('landNote' in value)) return value
  const { landNote, ...rest } = value as Record<string, unknown>
  return 'federalStateNote' in rest ? rest : { ...rest, federalStateNote: landNote }
}

const wireSourceSchema = z
  .object({
    content: z.string().optional(),
    url: z.string().nullish(),
    title: z.string().nullish(),
    citation_key: z.string().nullish(),
    document_id: z.string().nullish(),
    collection: z.string().nullish(),
    source_type: z.string().nullish(),
    tool: z.string().nullish(),
    origin: z.string().nullish(),
    number: z.number().int().positive().nullish(),
    file_name: z.string().nullish(),
    page: z.number().int().positive().nullish(),
    clause: z.string().nullish(),
    punkt: z.string().nullish(),
    score: z.number().nullish(),
    snippet: z.string().nullish(),
    kind: z.string().nullish(),
    shelf: z.string().nullish(),
    lane: z.string().nullish(),
    lane_label: z.string().nullish(),
    binding_note: z.string().nullish(),
    binding_status: z.string().nullish(),
    regions: z.array(z.unknown()).nullish(),
    project: z
      .preprocess(
        renameLegacyProjectNote,
        z.object({
          id: z.string(),
          name: z.string(),
          status: z.string(),
          federalStateNote: z.string().nullish(),
        })
      )
      .nullish(),
    is_cited: z.boolean().nullish(),
  })
  .passthrough()

const payloadSchema = z.object({
  v: z.literal(CITATIONS_PAYLOAD_VERSION),
  sources: z.array(wireSourceSchema),
})

export type PersistedCitations = z.infer<typeof payloadSchema>

const MAX_CONTENT = 400

const MAX_SNIPPET = 1200

export const encodeCitations = (
  citations: CitationSource[] | undefined
): PersistedCitations | undefined => {
  if (!citations?.length) return undefined
  return {
    v: CITATIONS_PAYLOAD_VERSION,
    sources: citations.map((citation) => ({
      content: citation.content.slice(0, MAX_CONTENT),
      snippet: citation.snippet?.slice(0, MAX_SNIPPET),
      url: citation.url,
      title: citation.title,
      citation_key: citation.citationKey,
      document_id: citation.documentId,
      collection: citation.collection,
      source_type: citation.sourceType,
      tool: citation.tool,
      origin: citation.origin,
      number: citation.number,
      file_name: citation.fileName,
      page: citation.page,
      clause: citation.clause,
      score: citation.score,
      kind: citation.kind,
      shelf: citation.shelf,
      lane: citation.lane,
      lane_label: citation.laneLabel,
      binding_note: citation.bindingNote,
      binding_status: citation.bindingStatus,
      regions: citation.regions,
      project: citation.project,
      is_cited: citation.isCited,
      ...citation.line,
    })),
  }
}

export const decodeCitations = (value: unknown, timestamp: Date): CitationSource[] | undefined => {
  const sources = readSources(value)
  if (!sources?.length) return undefined

  const citations = sources.map((wire, index) =>
    citationFromWire(wire as WireCitationSource, {
      isCited: typeof wire.is_cited === 'boolean' ? wire.is_cited : undefined,
      id: `stored-${index}`,
      timestamp,
    })
  )
  return citations.length > 0 ? citations : undefined
}

const readSources = (value: unknown): Array<z.infer<typeof wireSourceSchema>> | null => {
  const versioned = payloadSchema.safeParse(value)
  if (versioned.success) return versioned.data.sources

  const legacy = z.array(z.record(z.string(), z.unknown())).safeParse(value)
  if (!legacy.success) return null
  const mapped = legacy.data.map((row) => ({
    ...row,
    citation_key: pickString(row.citation_key ?? row.citationKey),
    document_id: pickString(row.document_id ?? row.documentId),
    file_name: pickString(row.file_name ?? row.fileName),
    lane_label: pickString(row.lane_label ?? row.laneLabel),
    binding_note: pickString(row.binding_note ?? row.bindingNote),
    binding_status: pickString(row.binding_status ?? row.bindingStatus),
    source_type: pickString(row.source_type ?? row.sourceType),
    is_cited: typeof row.isCited === 'boolean' ? row.isCited : undefined,
    content: pickString(row.content) ?? '',
  }))
  const validated = z.array(wireSourceSchema).safeParse(mapped)
  return validated.success ? validated.data : null
}

const pickString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value : undefined
