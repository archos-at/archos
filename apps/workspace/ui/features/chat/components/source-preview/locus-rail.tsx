'use client'

import type { FC } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import { SectionLabel } from '@/components/ui/section-label'
import { sourceSignalStyle } from '@/features/layout/components/SourceSignalChip'
import type { CitationLocus, CitedDocument } from '../../lib/citations'
import { navigableLoci } from './document-target'

export const LocusRail: FC<{
  document: CitedDocument
  activeKey: string | undefined
  onSelect: (locus: CitationLocus) => void
}> = ({ document: doc, activeKey, onSelect }) => {
  const t = useTranslations(chatCopy)
  const loci = navigableLoci(doc)
  if (!loci.length) return null

  const activeIndex = loci.findIndex((locus) => locus.key === activeKey)
  const step = (delta: number): void => {
    const next = loci[Math.min(loci.length - 1, Math.max(0, activeIndex + delta))]
    if (next && next.key !== activeKey) onSelect(next)
  }

  return (
    <nav
      aria-label={t('citationPeek.lociAria')}
      className="flex min-h-0 shrink-0 flex-col gap-1.5 md:w-64"
      onKeyDown={(event) => {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
        event.preventDefault()
        step(event.key === 'ArrowDown' ? 1 : -1)
      }}
    >
      <div className="flex shrink-0 items-center gap-1.5">
        <SectionLabel>{t('citationPeek.lociLabel', { count: loci.length })}</SectionLabel>
        <span className="flex-1" />
        {/* The stepper is for reading STRAIGHT THROUGH — the reader who wants
            the next passage rather than a particular one, and who should not
            have to find it in the list to get there. A single Fundstelle has no
            through-line, so the controls for one would be three dead affordances
            over the only entry. */}
        {loci.length > 1 && (
          <>
            <span className="text-muted-foreground text-xs tabular-nums">
              {t('citationPeek.lociPosition', {
                index: activeIndex >= 0 ? activeIndex + 1 : 0,
                count: loci.length,
              })}
            </span>
            <button data-attr="chat-step"
              type="button"
              onClick={() => step(-1)}
              disabled={activeIndex <= 0}
              aria-label={t('citationPeek.previousLocus')}
              className={stepperClasses}
            >
              <ChevronUp aria-hidden="true" className="size-3.5" />
            </button>
            <button data-attr="chat-step"
              type="button"
              onClick={() => step(1)}
              disabled={activeIndex === loci.length - 1}
              aria-label={t('citationPeek.nextLocus')}
              className={stepperClasses}
            >
              <ChevronDown aria-hidden="true" className="size-3.5" />
            </button>
          </>
        )}
      </div>

      <ol className="flex min-h-0 gap-1.5 overflow-x-auto pb-1 md:flex-1 md:flex-col md:overflow-y-auto md:overflow-x-hidden md:pb-0">
        {loci.map((locus) => {
          const isActive = locus.key === activeKey
          return (
            <li key={locus.key} className="w-52 shrink-0 md:w-full">
              <button data-attr="chat-select"
                type="button"
                ref={(node) => {
                  if (isActive) node?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
                }}
                onClick={() => onSelect(locus)}
                aria-current={isActive ? 'true' : undefined}
                className={cn(
                  'duration-snap w-full rounded-surface border px-2.5 py-2 text-left transition-colors ease-out',
                  'focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-2',
                  isActive ? 'border-transparent' : 'border-border bg-card hover:bg-sheet-hover'
                )}
                style={isActive ? sourceSignalStyle(doc.tint) : undefined}
              >
                <span className="flex items-center gap-1.5">
                  {locus.number != null ? (
                    <span className="shrink-0 text-xs font-semibold tabular-nums opacity-70">
                      [{locus.number}]
                    </span>
                  ) : (
                    <SectionLabel className={cn('shrink-0', isActive && 'text-current opacity-70')}>
                      {t('citationPeek.retrievedOnly')}
                    </SectionLabel>
                  )}
                  <span className="flex-1" />
                  <span className="shrink-0 text-xs font-medium tabular-nums">
                    {locus.clause
                      ? t('answerSources.clausePage', { clause: locus.clause, page: locus.page! })
                      : t('answerSources.page', { page: locus.page! })}
                  </span>
                </span>
                {locus.snippet && (
                  <span
                    className={cn(
                      'mt-1 block text-xs leading-snug',
                      isActive
                        ? 'line-clamp-3 opacity-80 md:line-clamp-none md:max-h-48 md:overflow-y-auto'
                        : 'text-muted-foreground line-clamp-2'
                    )}
                  >
                    {locus.snippet}
                  </span>
                )}
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

const stepperClasses =
  'inline-flex size-5 items-center justify-center rounded-full border border-border text-muted-foreground ' +
  'transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 ' +
  'focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-40'
