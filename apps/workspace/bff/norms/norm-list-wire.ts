import { z } from 'zod'
import { pageQueryShape } from '@/lib/api/offset-page'
import type { NormEntry, NormsFile } from './schemas'
import type { NORM_RANKS } from './schemas'

export const listNormsQuerySchema = z.object({
  federalState: z.string().trim().min(1).max(60).optional(),
  topic: z.string().trim().min(1).max(100).optional(),
  ...pageQueryShape,
})

export interface NormListItem {
  id: string
  short: string
  title: string
  rank: (typeof NORM_RANKS)[number]
  federalState: string | null
  topics: string[]
  citationUrl: string
  documentNumber: string
  bindingNote: string | null
}

export function toNormListItem(entry: NormEntry): NormListItem {
  return {
    id: entry.id,
    short: entry.short,
    title: entry.title,
    rank: entry.rank,
    federalState: entry.federal_state || null,
    topics: entry.topics,
    citationUrl: entry.citation_url || entry.source_url,
    documentNumber: entry.document_number,
    bindingNote: entry.binding_note || null,
  }
}

const fold = (text: string): string => text.trim().toLocaleLowerCase('de')

export function filterNorms(
  registry: Pick<NormsFile, 'entries' | 'states'>,
  query: { federalState?: string; topic?: string }
): NormListItem[] {
  const state = query.federalState === undefined ? undefined : fold(query.federalState)
  const stateName =
    state === undefined
      ? undefined
      : fold(Object.entries(registry.states).find(([token]) => fold(token) === state)?.[1] ?? state)
  const topic = query.topic === undefined ? undefined : fold(query.topic)
  return registry.entries
    .filter((entry) => stateName === undefined || !entry.federal_state || fold(entry.federal_state) === stateName)
    .filter(
      (entry) =>
        topic === undefined ||
        [entry.short, entry.title, ...entry.topics, ...entry.aliases].some((text) => fold(text).includes(topic))
    )
    .map(toNormListItem)
}
