'use client'

import { useEffect, useRef } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

export const ROOT_SORT_PARAM = 'rootSort'

export function useRootSortParam(mayOpen: boolean, open: () => void): void {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const runId = searchParams?.get(ROOT_SORT_PARAM)?.trim() || null
  const handled = useRef<string | null>(null)

  useEffect(() => {
    if (!runId || !mayOpen) return
    if (handled.current === runId) return
    handled.current = runId
    open()
    const params = new URLSearchParams(searchParams?.toString() ?? '')
    params.delete(ROOT_SORT_PARAM)
    const query = params.toString()
    const path = pathname ?? ''
    router.replace(query ? `${path}?${query}` : path, { scroll: false })
  }, [mayOpen, open, pathname, router, runId, searchParams])
}
