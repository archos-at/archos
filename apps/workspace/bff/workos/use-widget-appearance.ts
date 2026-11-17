'use client'

import { useEffect, useState } from 'react'
import type { WorkOsWidgetsProps } from '@workos-inc/widgets'
import { useLayoutStore } from '@/features/layout/store'

export function widgetTheme(appearance: 'light' | 'dark'): WorkOsWidgetsProps['theme'] {
  return { appearance, hasBackground: false, grayColor: 'sand', radius: 'medium', scaling: '100%' }
}

export function useResolvedAppearance(): 'light' | 'dark' {
  const theme = useLayoutStore((s) => s.theme)
  const [systemDark, setSystemDark] = useState(false)

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    setSystemDark(mediaQuery.matches)
    const handler = (e: MediaQueryListEvent): void => setSystemDark(e.matches)
    mediaQuery.addEventListener('change', handler)
    return () => mediaQuery.removeEventListener('change', handler)
  }, [])

  if (theme === 'dark') return 'dark'
  if (theme === 'light') return 'light'
  return systemDark ? 'dark' : 'light'
}
