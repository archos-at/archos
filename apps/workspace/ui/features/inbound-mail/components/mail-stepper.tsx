'use client'

import type { JSX } from 'react'
import Link from 'next/link'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTranslations } from '@/i18n'
import { inboundMailCopy } from '@/i18n/namespaces/inbound-mail'

export function MailStepper({
  ids,
  openId,
  hrefFor,
}: {
  ids: readonly string[]
  openId: string
  hrefFor: (mailId: string) => string
}): JSX.Element | null {
  const t = useTranslations(inboundMailCopy)
  const index = ids.indexOf(openId)
  if (index < 0 || ids.length < 2) return null
  const previous = ids[index - 1] ?? null
  const next = ids[index + 1] ?? null
  const step = (id: string | null, label: string, Icon: typeof ChevronUp, testId: string): JSX.Element =>
    id ? (
      <Button asChild variant="ghost" size="icon" className="size-11">
        <Link href={hrefFor(id)} replace aria-label={label} title={label} data-testid={testId}>
          <Icon className="size-5" aria-hidden />
        </Link>
      </Button>
    ) : (
      <Button type="button" variant="ghost" size="icon" className="size-11" disabled aria-label={label} data-testid={testId}>
        <Icon className="size-5" aria-hidden />
      </Button>
    )
  return (
    <nav className="-mr-2.5 ml-3 flex items-center" aria-label={t('stepper.label')} data-testid="inbound-mail-stepper">
      <span className="text-muted-foreground mr-1 text-xs tabular-nums whitespace-nowrap" data-testid="inbound-mail-stepper-position">
        {t('stepper.position', { index: index + 1, count: ids.length })}
      </span>
      {step(previous, t('stepper.previous'), ChevronUp, 'inbound-mail-stepper-previous')}
      {step(next, t('stepper.next'), ChevronDown, 'inbound-mail-stepper-next')}
    </nav>
  )
}
