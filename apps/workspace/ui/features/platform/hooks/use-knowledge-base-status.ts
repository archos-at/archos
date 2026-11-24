'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useTranslations } from '@/i18n'
import { platformCopy } from '@/i18n/namespaces/platform'
import type { DocClass } from '@/lib/knowledge/doc-class'
import type { KnowledgeBaseStatus, KnowledgeFile } from '@/lib/knowledge/service'
import {
  mergeKnowledgeFileOverrides,
  settleDocClassOverrides,
} from '@/features/platform/lib/knowledge-file-overrides'

export function useKnowledgeBaseStatus() {
  const t = useTranslations(platformCopy)
  const [status, setStatus] = useState<KnowledgeBaseStatus | null>(null)
  const [hasError, setHasError] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)

  const [docClassOverrides, setDocClassOverrides] = useState<Record<string, DocClass>>({})
  const [displayTitleOverrides, setDisplayTitleOverrides] = useState<Record<string, string>>({})

  const hasDataRef = useRef(false)
  const loadSeqRef = useRef(0)

  const fetchStatus = useCallback(async (): Promise<KnowledgeBaseStatus> => {
    const res = await fetch('/api/platform/knowledge/documents')
    if (!res.ok) throw new Error(`Failed to load knowledge base (${res.status})`)
    return (await res.json()) as KnowledgeBaseStatus
  }, [])

  const applyStatus = useCallback((next: KnowledgeBaseStatus) => {
    hasDataRef.current = true
    setStatus(next)
    setHasError(false)
    setDocClassOverrides((prev) => settleDocClassOverrides(prev, next.files))
  }, [])

  const load = useCallback(async (): Promise<void> => {
    const seq = ++loadSeqRef.current
    setIsRefreshing(true)
    try {
      const next = await fetchStatus()
      if (seq === loadSeqRef.current) applyStatus(next)
    } catch {
      if (seq !== loadSeqRef.current) return
      if (hasDataRef.current) toast.error(t('knowledge.refreshFailed'))
      else setHasError(true)
    } finally {
      if (seq === loadSeqRef.current) setIsRefreshing(false)
    }
  }, [applyStatus, fetchStatus, t])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(
    () => () => {
      loadSeqRef.current += 1
    },
    []
  )

  const files = useMemo<KnowledgeFile[]>(
    () => mergeKnowledgeFileOverrides(status?.files ?? [], docClassOverrides, displayTitleOverrides),
    [status, docClassOverrides, displayTitleOverrides]
  )

  return {
    status,
    hasError,
    setHasError,
    isRefreshing,
    fetchStatus,
    applyStatus,
    load,
    files,
    setDocClassOverrides,
    setDisplayTitleOverrides,
  }
}
