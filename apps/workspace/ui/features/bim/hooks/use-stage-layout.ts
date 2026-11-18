'use client'

import { useMediaQuery } from '@/hooks/use-media-query'

export type StageLayout = 'desktop' | 'phone' | 'phone-landscape'

export const PHONE_QUERY = '(max-width: 639px)'
export const PHONE_LANDSCAPE_QUERY =
  '(pointer: coarse) and (orientation: landscape) and (max-height: 500px)'

export function resolveStageLayout(phone: boolean, landscape: boolean): StageLayout {
  if (landscape) return 'phone-landscape'
  return phone ? 'phone' : 'desktop'
}

export function useStageLayout(): StageLayout {
  const phone = useMediaQuery(PHONE_QUERY)
  const landscape = useMediaQuery(PHONE_LANDSCAPE_QUERY)
  return resolveStageLayout(phone, landscape)
}
