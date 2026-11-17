'use client'

import { useEffect, useState } from 'react'
import { useDocumentsGeneration } from '@/lib/documents/document-changes'
import type { MissingDocument } from '@/lib/document-roles/prompt-loader'

export function useMissingDocuments(projectId: string | null): readonly MissingDocument[] | null {
  const generation = useDocumentsGeneration()
  const [missing, setMissing] = useState<readonly MissingDocument[] | null>(null)
  useEffect(() => {
    if (!projectId) return
    let cancelled = false
    fetch(`/api/projects/${projectId}/document-roles`)
      .then((response) => (response.ok ? response.json() : null))
      .then((body: unknown) => {
        if (cancelled) return
        const list = (body as { missing?: unknown } | null)?.missing
        setMissing(Array.isArray(list) ? (list as MissingDocument[]) : null)
      })
      .catch(() => {
        if (!cancelled) setMissing(null)
      })
    return () => {
      cancelled = true
    }
  }, [projectId, generation])
  return projectId ? missing : null
}
