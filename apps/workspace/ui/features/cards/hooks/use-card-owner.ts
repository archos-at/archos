'use client'

import { useChatStore } from '@/features/chat/store'
import type { AnswerCard } from '@/shared/cards/schemas'
import { findCardOwnerMessageId } from '../card-owner'

export function useCardOwnerMessageId(
  jobId: string | null | undefined,
  cards: readonly (AnswerCard | undefined)[]
): string | null {
  return useChatStore((state) => findCardOwnerMessageId(state, jobId, cards))
}
