'use client'

import { useMemo, useState } from 'react'
import { useChatStore } from '@/features/chat/store'
import {
  deleteDraft,
  draftLifeKey,
  mergedDraftLife,
  newestDraftLife,
  restoreDraft,
  useDraftLifeStore,
} from '../lib/draft-life'

export interface DraftLifeInput {
  path: string
  version: number
  previousVersion?: number | null
  removed?: boolean | null
}

export function useDraftLife({ path, version, previousVersion, removed }: DraftLifeInput) {
  const conversationId = useChatStore((s) => s.currentConversation?.id ?? null)
  const messages = useChatStore((s) => s.currentConversation?.messages)
  const change = useDraftLifeStore((s) => (conversationId ? s.changes[draftLifeKey(conversationId, path)] : undefined))
  const record = useDraftLifeStore((s) => s.record)
  const [busy, setBusy] = useState<'restore' | 'delete' | null>(null)
  const [failed, setFailed] = useState<'restore' | 'delete' | null>(null)

  const life = useMemo(
    () =>
      mergedDraftLife(
        { version, previousVersion: previousVersion ?? null, removed: removed === true },
        newestDraftLife(messages ?? [], path),
        change,
      ),
    [version, previousVersion, removed, messages, path, change],
  )

  const restore = async (): Promise<void> => {
    if (!conversationId || busy) return
    setBusy('restore')
    setFailed(null)
    try {
      const restored = await restoreDraft(conversationId, path)
      record(conversationId, path, { version: restored, previousVersion: life.version })
    } catch {
      setFailed('restore')
    } finally {
      setBusy(null)
    }
  }

  const remove = async (): Promise<boolean> => {
    if (!conversationId || busy) return false
    setBusy('delete')
    setFailed(null)
    try {
      await deleteDraft(conversationId, path)
      record(conversationId, path, { removed: true })
      return true
    } catch {
      setFailed('delete')
      return false
    } finally {
      setBusy(null)
    }
  }

  return {
    newestVersion: life.version,
    superseded: life.version > version,
    removed: life.removed,
    canRestore: !life.removed && life.previousVersion !== null && life.previousVersion < life.version,
    restoreTarget: life.previousVersion,
    busy,
    failed,
    restore,
    remove,
  }
}

export type DraftLifeState = ReturnType<typeof useDraftLife>
