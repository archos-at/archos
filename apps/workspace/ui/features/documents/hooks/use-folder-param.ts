'use client'

import { useCallback } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { clearDocumentLocus } from '../lib/document-locus'

export function useFolderParam(): readonly [string | null, (next: string | null) => void] {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const selected = searchParams?.get('folder')?.trim() || null

  const select = useCallback(
    (next: string | null) => {
      const params = new URLSearchParams(searchParams?.toString() ?? '')
      if (next === null) params.delete('folder')
      else params.set('folder', next)
      params.delete('doc')
      clearDocumentLocus(params)
      const query = params.toString()
      const path = pathname ?? ''
      router.push(query ? `${path}?${query}` : path, { scroll: false })
    },
    [pathname, router, searchParams]
  )

  return [selected, select] as const
}
