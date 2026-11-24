'use client'

import { useEffect, type JSX } from 'react'
import type { ExternalToast } from 'sonner'
import { LayerToaster } from '@/components/ui/sonner'
import { cn } from '@/lib/utils'

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

const TOUCH_ACTION = 'pointer-coarse:min-h-11 pointer-coarse:px-3'

export function reviewToast(options: ExternalToast = {}): ExternalToast {
  const classNames = { ...options.classNames, actionButton: cn(TOUCH_ACTION, options.classNames?.actionButton) }
  const touchable = options.action ? { ...options, classNames } : options
  return mounted > 0 ? { ...touchable, toasterId: REVIEW_TOASTER } : touchable
}
