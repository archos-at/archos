'use client'

import { useEffect, type JSX } from 'react'
import type { ExternalToast } from 'sonner'
import { LayerToaster } from '@/components/ui/sonner'

export const REVIEW_TOASTER = 'document-review'

let mounted = 0

export function ReviewToaster({ foot }: { foot: number }): JSX.Element {
  useEffect(() => {
    mounted += 1
    return () => {
      mounted -= 1
    }
  }, [])
  return <LayerToaster id={REVIEW_TOASTER} foot={foot} />
}

export function reviewToast(options: ExternalToast = {}): ExternalToast {
  return mounted > 0 ? { ...options, toasterId: REVIEW_TOASTER } : options
}
