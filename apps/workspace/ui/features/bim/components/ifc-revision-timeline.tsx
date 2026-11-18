'use client'

import type { JSX } from 'react'
import { GitBranch, GitCompare } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useLocale, useTranslations } from '@/i18n'
import { bimCopy } from '@/i18n/namespaces/bim'
import type { BimModelHeaderView } from '../hooks/use-bim-model'
import type { BimRevision, BimRevisionDelta, BimRevisionSeries } from '../lib/revisions'

export interface IfcRevisionTimelineProps {
  series: BimRevisionSeries | null
  currentModelId: string | null
  onOpen: (model: BimModelHeaderView) => void
  onCompareWithPrevious: (revision: BimRevision, previous: BimModelHeaderView) => void
}

function useSigned(): (value: number | null) => string {
  const { locale } = useLocale()
  const format = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 1,
    signDisplay: 'exceptZero',
  })
  return (value) => (value === null ? '—' : value === 0 ? '±0' : format.format(value))
}

function DeltaRow({ delta }: { delta: BimRevisionDelta }): JSX.Element {
  const t = useTranslations(bimCopy)
  const signed = useSigned()
  const entries: Array<{ key: string; value: number | null; judged?: boolean }> = [
    { key: 'elements', value: delta.elements },
    { key: 'spaces', value: delta.spaces },
    { key: 'storeys', value: delta.storeys },
    { key: 'netFloorArea', value: delta.netFloorArea },
    { key: 'health', value: delta.healthScore, judged: true },
  ]
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
      {entries.map((entry) => (
        <li key={entry.key} className="flex items-center gap-1">
          <span>{t(`timeline.delta.${entry.key}`)}</span>
          <span
            className={`tabular-nums ${
              !entry.judged || entry.value === null || entry.value === 0
                ? ''
                : entry.value > 0
                  ? 'text-success'
                  : 'text-destructive'
            }`}
          >
            {signed(entry.value)}
          </span>
        </li>
      ))}
    </ul>
  )
}

export function IfcRevisionTimeline({
  series,
  currentModelId,
  onOpen,
  onCompareWithPrevious,
}: IfcRevisionTimelineProps): JSX.Element | null {
  const t = useTranslations(bimCopy)
  const { locale } = useLocale()

  if (!series || series.revisions.length < 2) return null

  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' })

  return (
    <section aria-labelledby="bim-timeline-heading" className="space-y-2">
      <h2 id="bim-timeline-heading" className="flex items-center gap-2 text-sm font-medium">
        <GitBranch className="size-4 text-muted-foreground" aria-hidden="true" />
        {t('timeline.title')}
      </h2>
      <p className="text-xs text-muted-foreground">
        {t('timeline.description', { count: series.revisions.length, name: series.label })}
      </p>

      <ol className="relative space-y-3 border-l pl-4">
        {/* Newest first: the revision being worked on is the one you look at. */}
        {[...series.revisions].reverse().map((revision) => {
          const previous = series.revisions[revision.index - 2]?.model ?? null
          const isCurrent = revision.model.id === currentModelId
          return (
            <li key={revision.model.id} className="relative">
              <span
                aria-hidden="true"
                className={`absolute -left-[21px] top-1.5 size-2.5 rounded-full border-2 border-background ${
                  isCurrent ? 'bg-brand' : 'bg-muted-foreground/40'
                }`}
              />
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => onOpen(revision.model)}
                  aria-current={isCurrent ? 'true' : undefined}
                  className={`truncate text-sm font-medium transition-colors duration-quick ease-out ${
                    isCurrent ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {t('timeline.revision', { index: revision.index })} · {revision.model.filename}
                </button>
                {revision.isLatest && <Badge variant="info">{t('timeline.latest')}</Badge>}
                {revision.model.status !== 'ready' && (
                  <Badge variant="secondary">{t(`status.${revision.model.status}`)}</Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {date.format(new Date(revision.model.updatedAt))}
              </p>

              {revision.delta ? (
                <div className="mt-1 space-y-1">
                  <DeltaRow delta={revision.delta} />
                  {previous && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => onCompareWithPrevious(revision, previous)}
                    >
                      <GitCompare className="size-3.5" aria-hidden="true" />
                      {t('timeline.compare', { previous: previous.filename })}
                    </Button>
                  )}
                </div>
              ) : (
                revision.index > 1 && (
                  <p className="mt-1 text-xs text-muted-foreground">{t('timeline.noDelta')}</p>
                )
              )}
            </li>
          )
        })}
      </ol>
    </section>
  )
}
