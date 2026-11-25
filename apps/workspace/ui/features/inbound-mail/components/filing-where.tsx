'use client'

import type { JSX } from 'react'
import { Mail } from 'lucide-react'
import { useTranslations } from '@/i18n'
import type { PlanLine } from '../lib/filing-plan'
import { usePlanWords } from './plan-words'
import { inboundMailCopy } from '@/i18n/namespaces/inbound-mail'

/** The mail text's line of „Wohin abgelegt wird“, in the attachment rows' shape: what it is, and where it goes. */
export function TextDestination({ lines }: { lines: readonly PlanLine[] }): JSX.Element | null {
  const t = useTranslations(inboundMailCopy)
  const words = usePlanWords()
  const line = lines.find((candidate) => candidate.kind === 'text_append' || candidate.kind === 'text_create' || candidate.kind === 'text_left')
  if (!line) return null
  const where = line.kind === 'text_left' ? words.outcome(line) : line.kind === 'text_append' || line.kind === 'text_create' ? words.destination(line) : ''
  return (
    <div className="flex min-w-0 items-center gap-3" data-testid="filing-where-text">
      <span className="bg-desk text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-inline" aria-hidden>
        <Mail className="size-4" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm">{t('filing.textLabel')}</span>
        <span className="text-muted-foreground truncate text-xs">{where}</span>
      </span>
    </div>
  )
}
