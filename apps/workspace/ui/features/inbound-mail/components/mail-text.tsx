'use client'

import type { JSX } from 'react'
import { useState } from 'react'
import { CalendarDays, ChevronDown, EyeOff, FileWarning, Scissors } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CopyableValue } from '@/components/ui/copyable-value'
import { LoadError } from '@/components/ui/load-error'
import { SectionLabel } from '@/components/ui/section-label'
import { Quote } from '@/components/ui/quote'
import { Skeleton } from '@/components/ui/skeleton'
import { useLocale, useTranslations } from '@/i18n'
import type { InboundMailTextView } from '@/lib/inbound-mail/inbound-mail-wire'
import { formatAbsoluteTime, formatCalendarDate } from '@/lib/format'
import { textPreview, textRuns, tidyText } from '../lib/mail-text'
import { FactLine, QuietPanel } from './inbound-mail-atoms'
import { inboundMailCopy } from '@/i18n/namespaces/inbound-mail'

export type MailTextState = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; text: InboundMailTextView }

/** A link stays text; its domain is said in ink (a look-alike host shows itself) with a press that copies it. */
function InertText({ text }: { text: string }): JSX.Element {
  const t = useTranslations(inboundMailCopy)
  return (
    <>
      {textRuns(text).map((run, index) =>
        run.kind === 'text' ? (
          <span key={index}>{run.value}</span>
        ) : (
          <span key={index} data-testid="mail-text-link">
            <span title={t('text.linkTitle', { domain: run.domain })} className="text-muted-foreground break-all underline decoration-dotted underline-offset-2">
              {run.value}
            </span>{' '}
            <span className="text-xs">
              <span className="text-foreground font-medium" data-testid="mail-text-link-domain">
                {t('text.linkDomain', { domain: run.domain })}
              </span>{' '}
              <CopyableValue value={run.value} className="mx-0 align-baseline text-xs pointer-coarse:align-middle">
                {t('text.linkCopy')}
              </CopyableValue>
            </span>
          </span>
        )
      )}
    </>
  )
}

const PROSE = 'text-foreground max-w-[72ch] whitespace-pre-wrap text-sm leading-relaxed [overflow-wrap:anywhere]'

const DISCLOSURE = 'text-muted-foreground hover:text-foreground h-auto gap-0.5 px-0 text-xs no-underline hover:no-underline [&_svg]:size-3.5 [&_svg]:transition-transform aria-expanded:[&_svg]:rotate-180 motion-reduce:[&_svg]:transition-none'

export function MailText({ state, onRetry }: { state: MailTextState; onRetry: () => void }): JSX.Element {
  const t = useTranslations(inboundMailCopy)
  const { locale } = useLocale()
  const [expanded, setExpanded] = useState(false)
  const [quotedOpen, setQuotedOpen] = useState(false)

  let body: JSX.Element
  if (state.kind === 'loading') {
    body = (
      <div className="flex flex-col gap-2" aria-label={t('text.loading')} role="status">
        <Skeleton className="h-3.5 w-11/12" />
        <Skeleton className="h-3.5 w-10/12" />
        <Skeleton className="h-3.5 w-8/12" />
      </div>
    )
  } else if (state.kind === 'error') {
    body = <LoadError title={t('text.loadError')} onRetry={onRetry} />
  } else {
    const { text } = state
    const own = tidyText(text.ownText)
    const preview = textPreview(own)
    body = (
      <div className="flex flex-col gap-3">
        {text.unreadable ? (
          <FactLine icon={FileWarning} tone="warning">
            {t('text.unreadable')}
          </FactLine>
        ) : own === '' ? (
          <p className="text-muted-foreground text-sm">{t('text.empty')}</p>
        ) : (
          <div className="flex flex-col items-start gap-1.5">
            <p className={PROSE} data-testid="mail-text-own">
              <InertText text={expanded ? own : preview.head} />
            </p>
            {preview.more && (
              <Button type="button" variant="link" size="sm" className={DISCLOSURE} onClick={() => setExpanded((open) => !open)} aria-expanded={expanded}>
                {expanded ? t('text.showLess') : t('text.showAll')}
                <ChevronDown aria-hidden />
              </Button>
            )}
          </div>
        )}
        {text.masked && (
          <FactLine icon={EyeOff} testId="mail-text-masked">
            {t('text.masked')}
          </FactLine>
        )}
        {text.ownTextTruncated && (
          <FactLine icon={Scissors}>{t('text.truncated')}</FactLine>
        )}
        {text.calendar.map((event, index) => (
          <QuietPanel key={index} className="gap-0.5 px-3 py-2 text-xs">
            <FactLine icon={CalendarDays} tone="default">
              {t('text.calendar', { summary: event.summary ?? '—' })}
            </FactLine>
            {event.start && (
              <p className="text-muted-foreground pl-5 tabular-nums">
                {event.allDay
                  ? t('text.calendarAllDay', { date: formatCalendarDate(event.start, locale) })
                  : t('text.calendarWhen', {
                      start: formatAbsoluteTime(event.start, locale),
                      end: event.end ? formatAbsoluteTime(event.end, locale) : '…',
                    })}
              </p>
            )}
            {event.location && <p className="text-muted-foreground pl-5 [overflow-wrap:anywhere]">{t('text.calendarLocation', { location: event.location })}</p>}
          </QuietPanel>
        ))}
        {text.quoted.length > 0 && (
          <div className="flex flex-col items-start gap-2">
            <Button type="button" variant="link" size="sm" className={DISCLOSURE} onClick={() => setQuotedOpen((open) => !open)} aria-expanded={quotedOpen}>
              {quotedOpen ? t('text.hideQuoted') : t('text.showQuoted', { count: text.quoted.length })}
              <ChevronDown aria-hidden />
            </Button>
            {quotedOpen &&
              text.quoted.map((quote, index) => (
                <Quote key={index} data-testid="mail-text-quote">
                  {quote.header && <p className="text-muted-foreground mb-1 text-xs not-italic [overflow-wrap:anywhere]">{quote.header}</p>}
                  {/* The quote's muted ink, the prose's measure. */}
                  <p className="max-w-[72ch] whitespace-pre-wrap text-sm leading-relaxed [overflow-wrap:anywhere]">
                    <InertText text={tidyText(quote.text)} />
                  </p>
                </Quote>
              ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <section className="flex flex-col gap-2" aria-label={t('text.label')}>
      <SectionLabel as="h3">{t('text.label')}</SectionLabel>
      {body}
    </section>
  )
}
