'use client'

import { PHONE_QUERY } from '@/hooks/use-is-mobile'
import { useMediaQuery } from '@/hooks/use-media-query'

export function usePhoneLayout(): boolean {
  return useMediaQuery(PHONE_QUERY)
}
