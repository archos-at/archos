import { discriminatedOptions } from '@/lib/api/zod-union'
import { answerCardSchema } from '@/shared/cards/schemas'

export const SYSTEM_CARD_TYPES = [
  'memory_proposal',
  'document_grid',
  'document_draft',
  'task_created',
  'file_operation_proposal',
  'operation_proposal',
  'canvas_activity',
  'look',
  'revision_compare',
] as const

export interface CardCatalogEntry {
  type: string
  description: string
}

function firstParagraph(text: string): string {
  return text.split(/\n\s*\n/, 1)[0].replace(/\s+/g, ' ').trim()
}

function buildCardCatalog(): CardCatalogEntry[] {
  const withheld = new Set<string>(SYSTEM_CARD_TYPES)
  const entries: CardCatalogEntry[] = []
  for (const [type, option] of discriminatedOptions(answerCardSchema)) {
    if (typeof type !== 'string' || withheld.has(type)) continue
    entries.push({ type, description: firstParagraph(option.description ?? '') })
  }
  return entries
}

export const CARD_CATALOG: readonly CardCatalogEntry[] = buildCardCatalog()

const CARD_TYPE_SET = new Set(CARD_CATALOG.map((entry) => entry.type))

export function isSelectableCardType(type: string): boolean {
  return CARD_TYPE_SET.has(type)
}

export function parsePreferredCardTypes(raw: string | undefined): string[] {
  if (!raw) return []
  const seen = new Set<string>()
  for (const part of raw.split(',')) {
    const type = part.trim()
    if (type && isSelectableCardType(type)) seen.add(type)
  }
  return [...seen]
}

export function formatPreferredCardTypes(types: readonly string[]): string {
  return types.join(',')
}

export function searchCardCatalog(query: string): readonly CardCatalogEntry[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return CARD_CATALOG
  return CARD_CATALOG.filter(
    (entry) =>
      entry.type.toLowerCase().includes(needle) ||
      entry.description.toLowerCase().includes(needle)
  )
}
