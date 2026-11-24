'use client'

import { useCallback, useState, type Dispatch, type SetStateAction } from 'react'
import { toast } from 'sonner'
import { useTranslations } from '@/i18n'
import { platformCopy } from '@/i18n/namespaces/platform'
import type { IngestWatch } from '@/features/platform/components/knowledge-ingest-watch'

export function useKnowledgeCorpusJobs({
  load,
  ingest,
  setSelected,
}: {
  load: () => Promise<void>
  ingest: IngestWatch
  setSelected: Dispatch<SetStateAction<string[]>>
}) {
  const t = useTranslations(platformCopy)
  const [isSyncing, setIsSyncing] = useState(false)
  const [syncConfirmOpen, setSyncConfirmOpen] = useState(false)
  const [isReingesting, setIsReingesting] = useState(false)
  const [pendingReingest, setPendingReingest] = useState<string[]>([])

  const handleSync = useCallback(() => {
    setSyncConfirmOpen(false)
    setIsSyncing(true)
    fetch('/api/platform/knowledge/sync', { method: 'POST' })
      .then(async (r) => {
        if (!r.ok) throw new Error(`Sync failed (${r.status})`)
        const body = (await r.json()) as { filesAdded?: number; filesTotal?: number }
        toast.success(
          t('knowledge.syncDone', { added: body.filesAdded ?? 0, total: body.filesTotal ?? 0 })
        )
      })
      .catch(() => toast.error(t('knowledge.syncFailed')))
      .finally(() => {
        setIsSyncing(false)
        void load()
      })
  }, [load, t])

  const handleReingest = useCallback(() => {
    const names = [...pendingReingest]
    setPendingReingest([])
    if (names.length === 0) return
    setIsReingesting(true)
    fetch('/api/platform/knowledge/reingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileNames: names }),
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(`Re-ingest failed (${r.status})`)
        const body = (await r.json()) as { queued?: unknown }
        const queued = Array.isArray(body.queued) ? body.queued.map(String) : []
        if (queued.length === 0) {
          toast.error(t('knowledgeAdmin.bulkReingestNothing'))
          return
        }
        toast.success(t('knowledgeAdmin.bulkReingestDone', { count: queued.length }))
        setSelected((prev) => prev.filter((name) => !names.includes(name)))
        ingest.watch(queued)
      })
      .catch(() => toast.error(t('knowledgeAdmin.bulkReingestFailed')))
      .finally(() => {
        setIsReingesting(false)
        void load()
      })
  }, [ingest, load, pendingReingest, t])

  return {
    isSyncing,
    syncConfirmOpen,
    setSyncConfirmOpen,
    isReingesting,
    pendingReingest,
    setPendingReingest,
    handleSync,
    handleReingest,
  }
}
