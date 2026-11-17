'use client'

import { useCallback } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

import { SEARCH_PARAMS, withoutSearchParams } from '../lib/search-url'

export const SHELF_SEARCH_MODE_PARAM = 'mode'
export const SHELF_SEARCH_MODE = 'search'

export interface ShelfSearchMode {
  active: boolean
  folderId: string | null
  open: (text?: string) => void
  close: () => void
}

export function useShelfSearchMode(): ShelfSearchMode {
  const router = useRouter()
  const pathname = usePathname() ?? ''
  const searchParams = useSearchParams()
  const query = searchParams?.toString() ?? ''
  const params = new URLSearchParams(query)
  const active = params.get(SHELF_SEARCH_MODE_PARAM) === SHELF_SEARCH_MODE
  const folderId = params.get('folder')?.trim() || null

  const open = useCallback(
    (text?: string) => {
      const next = new URLSearchParams(query)
      next.delete('doc')
      next.set(SHELF_SEARCH_MODE_PARAM, SHELF_SEARCH_MODE)
      if (text) next.set(SEARCH_PARAMS.text, text)
      router.push(`${pathname}?${next.toString()}`, { scroll: false })
    },
    [pathname, query, router]
  )

  const close = useCallback(() => {
    const next = withoutSearchParams(new URLSearchParams(query))
    next.delete(SHELF_SEARCH_MODE_PARAM)
    const rest = next.toString()
    router.push(rest ? `${pathname}?${rest}` : pathname, { scroll: false })
  }, [pathname, query, router])

  return { active, folderId, open, close }
}
