'use client'

import { type FC, type ReactNode } from 'react'
import { CircleAlert, CircleCheck, ExternalLink } from 'lucide-react'
import { Chip } from '@/components/ui/chip'
import { Quote } from '@/components/ui/quote'
import { SectionLabel } from '@/components/ui/section-label'
import { useTranslations } from '@/i18n'
import { commonCopy } from '@/i18n/namespaces/common'
import { cn } from '@/lib/utils'

export const ExcerptFigure: FC<{
  number: string
  source: ReactNode
  stamp?: ReactNode
  paraphrase?: boolean
  children: ReactNode
}> = ({ number, source, stamp, paraphrase = false, children }) => (
  <figure className="my-5 @container break-inside-avoid" data-excerpt={number} data-paraphrase={paraphrase ? 'true' : undefined}>
    <div className={cn('grid gap-2', source && '@[36rem]:grid-cols-[minmax(0,1fr)_12rem] @[36rem]:gap-6')}>
      <div className="flex min-w-0 flex-col gap-1.5">
        {/* The wording on a quiet ground; a paraphrase upright on a dashed
            hairline, its stamp below saying so in words. */}
        <Quote
          variant={paraphrase ? 'paraphrase' : 'excerpt'}
          className="max-w-prose leading-relaxed [&_p]:mb-2 [&_p:last-child]:mb-0"
        >
          {children}
        </Quote>
        {stamp}
      </div>
      {source && <figcaption className="min-w-0 pl-4 @[36rem]:pl-0 @[36rem]:pt-0.5">{source}</figcaption>}
    </div>
  </figure>
)

export const ExcerptMargin: FC<{ title: ReactNode; locus?: ReactNode; action?: ReactNode }> = ({ title, locus, action }) => {
  const t = useTranslations(commonCopy)
  return (
    <div className="flex flex-col gap-1">
      <SectionLabel as="p">{t('markdown.excerptSource')}</SectionLabel>
      <p className="card-caption break-words font-medium text-foreground">{title}</p>
      {locus && <div className="card-meta text-muted-foreground">{locus}</div>}
      {action && <div className="mt-0.5">{action}</div>}
    </div>
  )
}

export const QuoteStampLine: FC<{ verbatim: boolean; number?: number; locus?: string; action?: ReactNode }> = ({
  verbatim,
  number,
  locus,
  action,
}) => {
  const t = useTranslations(commonCopy)
  return (
    <p data-testid="quote-stamp" data-status={verbatim ? 'verbatim' : 'not_found'} className="flex flex-wrap items-center gap-1.5 pl-4">
      <Chip size="sm" variant={verbatim ? 'success' : 'warning'}>
        {verbatim ? <CircleCheck aria-hidden="true" /> : <CircleAlert aria-hidden="true" />}
        {verbatim
          ? number !== undefined
            ? t('markdown.stamp.verbatimNumbered', { n: number })
            : t('markdown.stamp.verbatim')
          : t('markdown.stamp.notFound')}
      </Chip>
      {locus && <span className="card-meta text-muted-foreground">{locus}</span>}
      {action}
    </p>
  )
}

export const OpenPassageButton: FC<{ onOpen: () => void }> = ({ onOpen }) => {
  const t = useTranslations(commonCopy)
  return (
    <button
      type="button"
      data-testid="open-passage"
      onClick={onOpen}
      className="card-meta inline-flex items-center gap-1 rounded text-brand underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 touch-target print:hidden"
    >
      <ExternalLink aria-hidden="true" className="size-3" />
      {t('markdown.stamp.open')}
    </button>
  )
}
