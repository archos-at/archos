'use client'

import type { JSX } from 'react'
import * as React from 'react'
import { ArrowLeft } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useTranslations } from '@/i18n'
import { feedbackCopy } from '@/i18n/namespaces/feedback'
import { cn } from '@/lib/utils'

export function PaneHeader({
  heading,
  description,
  onBack,
  className,
  children,
}: {
  heading: React.ReactNode
  description: React.ReactNode
  onBack?: () => void
  className?: string
  children?: React.ReactNode
}): JSX.Element {
  const t = useTranslations(feedbackCopy)
  return (
    <header
      className={cn(
        'flex shrink-0 flex-col gap-3 border-b px-4 py-3 phone:pt-[max(0.75rem,env(safe-area-inset-top))]',
        onBack && 'pr-14',
        className,
      )}
    >
      <div className="flex min-h-10 items-center gap-1.5">
        {onBack && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onBack}
            aria-label={t('threads.back')}
            className="-ml-1 md:hidden"
            data-testid="feedback-pane-back"
          >
            <ArrowLeft className="size-4" aria-hidden />
          </Button>
        )}
        <div className="flex min-w-0 flex-col gap-1">
          {heading}
          {description}
        </div>
      </div>
      {children}
    </header>
  )
}
