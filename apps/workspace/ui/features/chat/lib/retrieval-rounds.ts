import type { RetrievalLedger, RetrievalLedgerEntry } from '@/lib/conversations/message-retrieval-ledger'
import type { StoredThinkingStep } from '@/lib/conversations/message-provenance'
import { normalizeFileName, type CitedDocument } from './citations/model'

export type RoundStep = Pick<StoredThinkingStep, 'kind' | 'round' | 'turnEvent' | 'traceLanes'>

export interface RetrievalRound {
  index: number
  key: string
  values?: Record<string, string>
  reason?: string
  tools: string[]
  sourceNames: string[]
}

export const retrievalRounds = (steps: readonly RoundStep[]): RetrievalRound[] => {
  const byIndex = new Map<number, RetrievalRound>()
  for (const step of steps) {
    if (step.kind !== 'retrieval' || step.round === undefined || !step.turnEvent) continue
    const { key, values, reason, tools } = step.turnEvent
    byIndex.set(step.round, {
      index: step.round,
      key,
      ...(values ? { values } : {}),
      ...(reason ? { reason } : {}),
      tools: [...new Set(tools ?? [])],
      sourceNames: byIndex.get(step.round)?.sourceNames ?? [],
    })
  }
  for (const step of steps) {
    if (step.kind !== 'sources') continue
    for (const lane of step.traceLanes ?? []) {
      for (const source of lane.sources) {
        const round = byIndex.get(source.round ?? step.round ?? -1)
        const name = source.name.trim()
        if (!round || !name) continue
        if (round.sourceNames.some((known) => known.toLowerCase() === name.toLowerCase())) continue
        round.sourceNames.push(name)
      }
    }
  }
  return [...byIndex.values()].sort((a, b) => a.index - b.index)
}

const cardKey = (card: CitedDocument): string =>
  normalizeFileName(card.fileName) || normalizeFileName(card.title) || normalizeFileName(card.id)

const cardKeys = (card: CitedDocument): string[] =>
  [cardKey(card), normalizeFileName(card.fileName), normalizeFileName(card.title)].filter(Boolean)

export const documentsForRound = (round: RetrievalRound, cards: CitedDocument[]): CitedDocument[] => {
  if (round.sourceNames.length === 0) return []
  const wanted = new Set(round.sourceNames.map((name) => normalizeFileName(name)).filter(Boolean))
  return cards.filter((card) => cardKeys(card).some((key) => wanted.has(key)))
}

const cardsByName = (cards: CitedDocument[]): Map<string, CitedDocument> => {
  const index = new Map<string, CitedDocument>()
  for (const card of cards) {
    for (const key of cardKeys(card)) if (!index.has(key)) index.set(key, card)
  }
  return index
}

export interface RoundLocus {
  detail?: string
  repeat: boolean
}

export interface FanCard {
  key: string
  card?: CitedDocument
  name: string
  workspace?: boolean
  title?: string
  loci?: RoundLocus[]
}

export const WORKSPACE_SHELF = 'workspace'

type LedgerSlot = FanCard & { loci: RoundLocus[] }

const foldKey = (name: string): string => normalizeFileName(name) || name.trim().toLowerCase()

export const ledgerFan = (entry: RetrievalLedgerEntry, cards: CitedDocument[]): FanCard[] => {
  const index = cardsByName(cards)
  const fresh = new Set(entry.newDocs.map((name) => normalizeFileName(name)).filter(Boolean))
  const slots = new Map<string, LedgerSlot>()
  for (const doc of entry.docs) {
    const cardKey = normalizeFileName(doc.name)
    const fold = foldKey(doc.name)
    const locus: RoundLocus = {
      ...(doc.detail ? { detail: doc.detail } : {}),
      repeat: doc.repeat ?? !fresh.has(cardKey),
    }
    const existing = slots.get(fold)
    if (existing) {
      existing.loci.push(locus)
      continue
    }
    const card = cardKey ? index.get(cardKey) : undefined
    slots.set(fold, {
      key: `r${entry.index}-${doc.name}`,
      ...(card ? { card } : {}),
      name: doc.name,
      ...(doc.title ? { title: doc.title } : {}),
      ...(doc.shelf === WORKSPACE_SHELF ? { workspace: true } : {}),
      loci: [locus],
    })
  }
  return [...slots.values()]
}

export const roundFan = (
  round: RetrievalRound,
  cards: CitedDocument[],
  ledger?: RetrievalLedger | null
): FanCard[] => {
  const entry = ledger?.find((candidate) => candidate.index === round.index)
  if (entry) return ledgerFan(entry, cards)
  return documentsForRound(round, cards).map((card) => ({
    key: card.id,
    card,
    name: card.fileName ?? card.title,
  }))
}
