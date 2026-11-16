import type { AnswerCard } from '@/shared/cards/schemas'
import { cardKey, type CardInteractions } from '@/features/cards/card-decision'
import type { DecidedProposals } from '@/features/cards/decided-proposals'
import type { MessageStages } from '@/lib/conversations/message-stages'

export type TurnMemoryProvenance =
  | 'distillation'
  | 'inTurn'

export interface TurnMemoryItem {
  id: string
  kind: string
  content: string
  provenance: TurnMemoryProvenance
  supersedes?: string
  audience?: TurnMemoryAudience
  noteId?: string
}

export type TurnMemoryAudience = 'personal' | 'project' | 'restricted' | 'organization'

export interface PersonalTurnNote {
  id: string
  kind: string
  content: string
  provenanceType: string
}

const SAVED: ReadonlySet<string> = new Set(['savedOrg', 'savedProject'])

function wasRemembered(
  card: Extract<AnswerCard, { type: 'memory_proposal' }>,
  key: string,
  cardInteractions: CardInteractions | undefined,
  decidedProposals: DecidedProposals | undefined
): boolean {
  if (card.proposal_id) return decidedProposals?.[card.proposal_id]?.status === 'applied'
  return SAVED.has(cardInteractions?.[key]?.decision ?? '')
}

function rememberedFor(
  card: Extract<AnswerCard, { type: 'memory_proposal' }>,
  key: string,
  cardInteractions: CardInteractions | undefined,
  decidedProposals: DecidedProposals | undefined
): TurnMemoryAudience | undefined {
  if (card.proposal_id) {
    return decidedProposals?.[card.proposal_id]?.results?.find((result) => result.scope)?.scope
  }
  return cardInteractions?.[key]?.decision === 'savedOrg' ? 'organization' : 'project'
}

const createdNoteId = (
  card: Extract<AnswerCard, { type: 'memory_proposal' }>,
  decidedProposals: DecidedProposals | undefined
): string | undefined =>
  card.proposal_id ? decidedProposals?.[card.proposal_id]?.results?.find((result) => result.ok && result.itemId)?.itemId : undefined

interface TurnMemoryInput {
  stages?: MessageStages
  cards?: (AnswerCard | undefined)[]
  cardInteractions?: CardInteractions
  decidedProposals?: DecidedProposals
  personalNotes?: readonly PersonalTurnNote[]
}

export function turnMemoryItems({
  stages,
  cards,
  cardInteractions,
  decidedProposals,
  personalNotes,
}: TurnMemoryInput): TurnMemoryItem[] {
  const items: TurnMemoryItem[] = []

  for (const [index, card] of (cards ?? []).entries()) {
    if (!card || card.type !== 'memory_proposal') continue
    const key = cardKey(card, index)
    if (!wasRemembered(card, key, cardInteractions, decidedProposals)) continue
    const supersedes = card.supersedes?.trim()
    const audience = rememberedFor(card, key, cardInteractions, decidedProposals)
    const noteId = createdNoteId(card, decidedProposals)
    items.push({
      id: key,
      kind: card.kind,
      content: card.content,
      provenance: 'inTurn',
      ...(supersedes ? { supersedes } : {}),
      ...(audience ? { audience } : {}),
      ...(noteId ? { noteId } : {}),
    })
  }

  for (const item of stages?.memoryReflection?.items ?? []) {
    items.push({
      id: item.id,
      noteId: item.id,
      kind: item.kind,
      content: item.content,
      provenance: item.provenance === 'agent' ? 'inTurn' : 'distillation',
      audience: item.scope === 'organization' ? 'organization' : item.restricted ? 'restricted' : 'project',
      ...(item.supersedes ? { supersedes: item.supersedes } : {}),
    })
  }

  for (const note of personalNotes ?? []) {
    items.push({
      id: note.id,
      noteId: note.id,
      kind: note.kind,
      content: note.content,
      provenance: note.provenanceType === 'distillation' ? 'distillation' : 'inTurn',
      audience: 'personal',
    })
  }

  return [...items.filter((item) => item.provenance === 'inTurn'), ...items.filter((item) => item.provenance !== 'inTurn')]
}
