'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useChatStore } from '@/features/chat/store'
import { openReviewAt } from '@/features/documents/lib/open-review'

export type ShowInDocument = (annotationId: string) => void

export function useShowInDocument(documentId: string): (annotationId: string) => Promise<boolean> {
  const router = useRouter()
  const pathname = usePathname()
  const projectId = useChatStore((s) => s.projectId)
  return async (annotationId) => {
    if (!projectId) return false
    const result = await openReviewAt(
      { documentId, annotationId },
      {
        projectId,
        location: pathname ? { pathname, search: window.location.search, hash: window.location.hash } : undefined,
        navigate: (href, how) => (how === 'push' ? router.push(href) : router.replace(href, { scroll: false })),
      }
    )
    return result !== 'unavailable'
  }
}
