'use client'

import { useEffect, useState } from 'react'
import type { DocumentFindingsResponse } from '@/lib/documents/findings-wire'

export function useDocumentFindings(
  projectId: string | undefined,
  options: { documentId?: string; refreshKey?: string; enabled?: boolean } = {}
): DocumentFindingsResponse | null {
  const { documentId, refreshKey, enabled = true } = options
  const [data, setData] = useState<DocumentFindingsResponse | null>(null)

  useEffect(() => {
    if (!projectId || !enabled) return
    const controller = new AbortController()
    const query = documentId ? `?documentId=${encodeURIComponent(documentId)}` : ''
    fetch(`/api/projects/${encodeURIComponent(projectId)}/document-findings${query}`, { signal: controller.signal })
      .then(async (response) => (response.ok ? ((await response.json()) as DocumentFindingsResponse) : null))
      .then((body) => setData(body && Array.isArray(body.findings) ? body : null))
      .catch(() => {
        if (!controller.signal.aborted) setData(null)
      })
    return () => controller.abort()
  }, [projectId, documentId, refreshKey, enabled])

  return data
}
