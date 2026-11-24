'use client'

import { useCallback } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { BIN_PARAM } from '../lib/bin-href'

export function useBinParam(): { open: boolean; setOpen: (open: boolean) => void } {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const open = searchParams?.get(BIN_PARAM) === '1'
  const setOpen = useCallback(
    (next: boolean) => {
      const params = new URLSearchParams(searchParams?.toString() ?? '')
      if (next) params.set(BIN_PARAM, '1')
      else params.delete(BIN_PARAM)
      const query = params.toString()
      const path = pathname ?? ''
      router.replace(query ? `${path}?${query}` : path, { scroll: false })
    },
    [pathname, router, searchParams]
  )
  return { open, setOpen }
}
