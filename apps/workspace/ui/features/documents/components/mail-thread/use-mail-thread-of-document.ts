'use client'

import { useEffect, useState } from 'react'
import { documentTypeOf } from '@/lib/documents/tag-vocabulary'
import type { MailThreadSummaryView } from '@/lib/mail-thread/mail-thread-wire'
import type { MailThreadClient } from './client'

export function mayBeThreadDocument(file: { filename: string; tags?: readonly string[] | null }): boolean {
  return documentTypeOf(file.tags) === 'correspondence' || /\.md$/i.test(file.filename)
}

export function useMailThreadOfDocument(
  projectId: string | undefined,
  file: { id: string; filename: string; tags?: readonly string[] | null },
  client: Pick<MailThreadClient, 'ofDocument'>,
): MailThreadSummaryView | null {
  const [thread, setThread] = useState<MailThreadSummaryView | null>(null)
  const candidate = projectId !== undefined && mayBeThreadDocument(file)

  useEffect(() => {
    setThread(null)
    if (!candidate || !projectId) return
    const controller = new AbortController()
    client
      .ofDocument(projectId, file.id, controller.signal)
      .then((found) => {
        if (!controller.signal.aborted) setThread(found)
      })
      .catch(() => {
        // No thread, no tab.
      })
    return () => controller.abort()
  }, [candidate, client, file.id, projectId])

  return thread
}
