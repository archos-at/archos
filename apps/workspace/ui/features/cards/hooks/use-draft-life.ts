'use client'

import { useState } from 'react'
import { useChatStore } from '@/features/chat/store'
import { deleteDraft, draftLifeKey, newestDraftLife, useDraftLifeStore } from '../lib/draft-life'

export interface DraftLifeInput {
  path: string
  version: number
  removed?: boolean | null
}

export function useDraftLife({ path, version, removed }: DraftLifeInput) {
  const conversationId = useChatStore((s) => s.currentConversation?.id ?? null)
  const messages = useChatStore((s) => s.currentConversation?.messages)
  const removedHere = useDraftLifeStore((s) =>
    conversationId ? s.removed[draftLifeKey(conversationId, path)] === true : false,
  )
  const markRemoved = useDraftLifeStore((s) => s.markRemoved)
  const [deleting, setDeleting] = useState(false)
  const [deleteFailed, setDeleteFailed] = useState(false)
  const newest = newestDraftLife(messages ?? [], path)

  const remove = async (): Promise<boolean> => {
    if (!conversationId || deleting) return false
    setDeleting(true)
    setDeleteFailed(false)
    try {
      await deleteDraft(conversationId, path)
      markRemoved(conversationId, path)
      return true
    } catch {
      setDeleteFailed(true)
      return false
    } finally {
      setDeleting(false)
    }
  }

  return {
    superseded: newest !== null && newest.version > version,
    removed: removed === true || removedHere || (newest?.removed ?? false),
    deleting,
    deleteFailed,
    remove,
  }
}

export type DraftLifeState = ReturnType<typeof useDraftLife>
