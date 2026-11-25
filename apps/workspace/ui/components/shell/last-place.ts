'use client'

import { useEffect } from 'react'
import { LAST_PLACE_COOKIE, isPlace } from './landing'
import { sideOfPath } from './shell-side'

const A_YEAR = 60 * 60 * 24 * 365

export function useRecordLastPlace(pathname: string): void {
  useEffect(() => {
    if (!isPlace(pathname) || !sideOfPath(pathname)) return
    document.cookie = `${LAST_PLACE_COOKIE}=${encodeURIComponent(pathname)}; path=/app; max-age=${A_YEAR}; samesite=lax`
  }, [pathname])
}
