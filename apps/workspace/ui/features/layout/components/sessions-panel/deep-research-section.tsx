import type { FC } from 'react'
import Link from 'next/link'
import { AlertCircle, FileCheck2, FlaskConical, Loader2, Search, Square } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CountPill } from '@/components/ui/count-pill'
import { EmptyState } from '@/components/ui/empty-state'
import { Item, ItemContent, ItemList, ItemMedia } from '@/components/ui/item'
import { SectionLabel } from '@/components/ui/section-label'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { formatAbsoluteTime, formatRelativeTime } from '@/lib/format'
import { useLocale, useTranslations } from '@/i18n'
import { commonCopy } from '@/i18n/namespaces/common'
import { researchCopy } from '@/i18n/namespaces/research'
import type { ResearchRun } from '@/adapters/api/research-runs-client'
import { isRunActive, runBadgeVariant, runStatusKey } from '../../lib/research-run-status'

interface DeepResearchSectionProps {
  filteredRuns: ResearchRun[]
  isResearchLoading: boolean
  deepResearchError: boolean
  isSearching: boolean
  trimmedQuery: string
  runLabel: (run: ResearchRun) => string
  runHref: (run: ResearchRun) => string | null
  handleClearSearch: () => void
  fetchDeepResearchRuns: () => void
  handleClose: () => void
  handleStopRun: (run: ResearchRun) => void
}

export const DeepResearchSection: FC<DeepResearchSectionProps> = ({
  filteredRuns,
  isResearchLoading,
  deepResearchError,
  isSearching,
  trimmedQuery,
  runLabel,
  runHref,
  handleClearSearch,
  fetchDeepResearchRuns,
  handleClose,
  handleStopRun,
}) => {
  const t = useTranslations(researchCopy)
  const tCommon = useTranslations(commonCopy)
  const { locale } = useLocale()

  return (
    <section data-testid="deep-research-section" className="mb-4 flex flex-col gap-1.5">
      <SectionLabel
        as="h3"
        icon={FlaskConical}
        className="flex items-center gap-1.5 pt-1"
      >
        {t('sessionsPanel.deepResearchHeading')}
        <CountPill
          className={cn(filteredRuns.length === 0 && 'invisible')}
          aria-hidden={filteredRuns.length === 0 || undefined}
          count={filteredRuns.length}
        />
      </SectionLabel>

      {isResearchLoading ? (
        <ItemList
          as="ul"
          aria-busy="true"
          data-testid="deep-research-skeleton"
          className="border-border bg-card shadow-xs"
        >
          {Array.from({ length: 2 }).map((_, index) => (
            <Item as="li" key={index} className="items-start py-3.5">
              <ItemMedia>
                <Skeleton className="size-8 shrink-0 rounded-full" />
              </ItemMedia>
              <ItemContent className="flex flex-col gap-2">
                <Skeleton className="h-3.5 w-3/5" />
                <Skeleton className="h-4 w-24" />
              </ItemContent>
            </Item>
          ))}
        </ItemList>
      ) : deepResearchError ? (
        <div className="bg-card flex min-h-11 flex-wrap items-center justify-between gap-2 rounded-surface px-4 py-2.5 shadow-xs">
          <p className="text-muted-foreground text-xs">
            {t('sessionsPanel.researchLoadFailed')}
          </p>
          <Button variant="secondary" size="sm" onClick={fetchDeepResearchRuns}>
            {tCommon('actions.retry')}
          </Button>
        </div>
      ) : filteredRuns.length === 0 ? (
        isSearching ? (
          <EmptyState
            variant="bare"
            icon={Search}
            title={t('sessionsPanel.noMatching')}
            description={t('sessionsPanel.noMatchingDescription', { query: trimmedQuery })}
            action={
              <Button variant="secondary" size="sm" onClick={handleClearSearch}>
                {t('sessionsPanel.clearSearch')}
              </Button>
            }
          />
        ) : (
          <EmptyState
            variant="bare"
            icon={FlaskConical}
            title={t('sessionsPanel.noRuns')}
            description={t('sessionsPanel.noRunsDescription')}
          />
        )
      ) : (
        <ItemList as="ul" className="border-0 bg-card shadow-xs">
          {filteredRuns.map((run) => {
            const status = run.status
            const href = runHref(run)
            return (
            <Item key={run.job_id} as="li" className="relative items-start py-3.5">
              {/* The media disc mirrors the inbox anatomy; a failed run
                  is the one tinted case, and its Badge below says the
                  same in words — colour never travels alone. */}
              <ItemMedia
                aria-hidden
                className={cn(
                  'mt-0.5 rounded-full border',
                  status === 'failed'
                    ? 'border-transparent bg-destructive/10 text-destructive'
                    : 'border-border bg-card text-muted-foreground'
                )}
              >
                <RunStatusIcon status={status} />
              </ItemMedia>
              <ItemContent>
                <div className="flex min-w-0 items-start justify-between gap-2">
                  {/* Stretched link: the whole row is the target. The
                      truncation lives on an inner span so the overlay
                      pseudo-element cannot be clipped by it.

                      A run with no thread to open keeps the same line
                      without the link and without the overlay: the row
                      still names the run and states its status, and it
                      no longer promises a click it cannot honour. */}
                  {href ? (
                    <Link
                      href={href}
                      onClick={handleClose}
                      aria-label={t('sessionsPanel.deepResearchRunLabel', {
                        label: runLabel(run),
                        status: t(runStatusKey(status)),
                      })}
                      className="min-w-0 flex-1 rounded-control text-sm font-medium leading-snug outline-none after:absolute after:inset-0 after:content-[''] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50"
                    >
                      <span className="block truncate" title={runLabel(run)}>
                        {runLabel(run)}
                      </span>
                    </Link>
                  ) : (
                    <span
                      className="min-w-0 flex-1 truncate text-sm font-medium leading-snug"
                      title={runLabel(run)}
                    >
                      {runLabel(run)}
                    </span>
                  )}
                  <time
                    className="text-muted-foreground shrink-0 text-xs"
                    dateTime={run.created_at}
                    title={formatAbsoluteTime(run.created_at, locale)}
                  >
                    {formatRelativeTime(run.created_at, locale)}
                  </time>
                </div>
                {/* The state in WORDS, on its own line — a failed run
                    and a finished one used to differ only by icon. */}
                <div className="mt-1.5 flex items-center gap-1">
                  <Badge variant={runBadgeVariant(status)}>
                    {t(runStatusKey(status))}
                  </Badge>
                  {/* A run that will never finish cannot be waited out:
                      stop it here. The stretched link covers the whole
                      row, so the button sits above it (`relative z-10`)
                      the way the chat rows' overlay actions do. */}
                  {isRunActive(status) && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="relative z-10 size-7 pointer-coarse:size-11"
                      onClick={() => handleStopRun(run)}
                      aria-label={t('sessionsPanel.stopResearch')}
                      title={t('sessionsPanel.stopResearchTitle')}
                    >
                      <Square className="size-4" aria-hidden="true" />
                    </Button>
                  )}
                </div>
              </ItemContent>
            </Item>
            )
          })}
        </ItemList>
      )}
    </section>
  )
}

const RunStatusIcon: FC<{ status: string }> = ({ status }) => {
  if (status === 'completed') {
    return <FileCheck2 className="size-4 shrink-0" aria-hidden="true" />
  }
  if (status === 'failed' || status === 'cancelled') {
    return <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
  }
  return <Loader2 className="size-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />
}
