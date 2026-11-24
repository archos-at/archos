'use client'

import { useState } from 'react'
import { useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import { ChangeRequestError, undoChange } from '@/lib/changes/client'
import type { AgentChangeView } from '@/lib/changes/types'
import type { LiveMarks } from './use-canvas-document'
import type { TurnChanges } from './use-turn-changes'

export function useServerUndo(change: AgentChangeView | undefined, live: LiveMarks, changes: TurnChanges) {
  const t = useTranslations(chatCopy)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const undo = async () => {
    if (!change || busy) return
    setBusy(true)
    setNotice(null)
    setError(null)
    try {
      const done = await undoChange(change.id)
      changes.adopt(done.change)
      await live.refresh()
    } catch (failure) {
      if (failure instanceof ChangeRequestError && failure.status === 409 && failure.code === 'already-undone') {
        const fresh = await changes.refetch()
        if (!fresh?.some((row) => row.id === change.id && row.undoneAt !== null)) {
          setNotice(t('cards.canvasActivity.alreadyUndone'))
        }
      } else if (failure instanceof ChangeRequestError && failure.status === 409) {
        setNotice(t('cards.canvasActivity.movedOn'))
        await Promise.all([changes.refetch(), live.refresh()])
      } else if (failure instanceof ChangeRequestError && failure.status === 403) {
        setError(t('cards.canvasActivity.forbidden'))
      } else {
        setError(t('cards.canvasActivity.error'))
      }
    } finally {
      setBusy(false)
    }
  }

  return { undo, busy, notice, error }
}
