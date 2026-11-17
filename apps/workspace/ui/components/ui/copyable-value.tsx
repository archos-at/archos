'use client'

import type { JSX, ReactNode } from 'react'
import { Check, Copy } from 'lucide-react'
import { FOCUS_RING } from '@/components/ui/focus-ring'
import { PRESSABLE } from '@/components/ui/press'
import { useTransientFlag } from '@/hooks/use-transient-flag'
import { useTranslations } from '@/i18n'
import { commonCopy } from '@/i18n/namespaces/common'
import { cn } from '@/lib/utils'

export interface CopyableValueProps {
  value: string
  className?: string
  onCopied?: () => void
  children?: ReactNode
}

export function CopyableValue({ value, className, onCopied, children }: CopyableValueProps): JSX.Element {
  const t = useTranslations(commonCopy)
  const [copied, raise] = useTransientFlag()

  const copy = (): void => {
    void navigator.clipboard?.writeText(value).then(() => {
      raise()
      onCopied?.()
    }, () => {})
  }

  return (
    <>
      <button
        type="button"
        onClick={copy}
        aria-label={t('copyableValue.copy', { value })}
        className={cn(
          'hover:bg-hover rounded-control -mx-1 inline-flex max-w-full items-start gap-1.5 px-1 text-right text-xs outline-none',
          PRESSABLE,
          FOCUS_RING,
          children === undefined ? 'break-all' : '[overflow-wrap:anywhere]',
          'pointer-coarse:min-h-11 pointer-coarse:items-center',
          className
        )}
      >
        <span>{children ?? value}</span>
        {copied ? (
          <Check className="pointer-coarse:mt-0 mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        ) : (
          <Copy
            className="text-muted-foreground pointer-coarse:mt-0 mt-0.5 size-3.5 shrink-0"
            aria-hidden="true"
          />
        )}
      </button>
      <span className="sr-only" role="status" aria-live="polite">
        {copied ? t('copyableValue.copied') : ''}
      </span>
    </>
  )
}
