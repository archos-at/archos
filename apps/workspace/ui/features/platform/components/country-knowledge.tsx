'use client'

/**
 * Platform → Länder (ADR-0165): each country's platform knowledge, and the
 * review queue that is the only way it changes.
 *
 * Reading order: the countries, one row each (what is released, what is open,
 * how many offices read it, what is overdue for a check); then the requests
 * waiting for review. Opening a request shows every claim with its sources and
 * the reviewer's verdict in a modal, and the next step it can take: review, approve,
 * publish to preview, publish to stable, roll back. Approve, publish and
 * rollback ask first, because each is the person's own decision and the last
 * two change what every entitled office reads. Read-only staff see everything
 * and none of the write controls.
 */

import type { JSX } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { Globe2, ListChecks } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { LoadError } from '@/components/ui/load-error'
import { LoadMore } from '@/components/ui/load-more'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { SectionCard } from '@/features/platform/components/section-card'
import { countryName } from './change-request-format'
import { ChangeRequestReview } from './change-request-review'
import { ApprovalBadges } from './approval-badges'
import { usePlatformCan } from '@/features/platform/platform-access'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { useLocale, useTranslations } from '@/i18n'
import type { Translator } from '@/i18n'
import { platformCopy } from '@/i18n/namespaces/platform'
import type { ChangeRequestSummary, PlatformKnowledgeOverview } from '@/lib/base-knowledge/platform/wire'

type Load<T> =
  { state: 'loading' } | { state: 'error'; status: number } | { state: 'ready'; value: T }

const BASE = '/api/platform/knowledge'

function released(counts: Record<string, number>, t: Translator): string {
  const parts = (['territory', 'authority', 'work', 'edition', 'manifestation'] as const)
    .filter((type) => (counts[type] ?? 0) > 0)
    .map((type) => `${counts[type]} ${t(`countryKnowledge.types.${type}`)}`)
  return parts.length > 0 ? parts.join(' · ') : t('countryKnowledge.noneReleased')
}

export function CountryKnowledge(): JSX.Element {
  const t = useTranslations(platformCopy)
  const canManage = usePlatformCan(PLATFORM_PERMISSIONS.knowledgeReview)
  const { locale } = useLocale()
  const [overview, setOverview] = useState<Load<PlatformKnowledgeOverview>>({ state: 'loading' })
  const [openId, setOpenId] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<ChangeRequestSummary[]>([])
  /** The next page of drafts, or null on the last; a failed read keeps what was listed and offers the read again. */
  const [draftsCursor, setDraftsCursor] = useState<string | null>(null)
  /** The read that failed, by the cursor it asked with (null: the first page), so asking again repeats that read. */
  const [draftsFailure, setDraftsFailure] = useState<{ cursor: string | null } | null>(null)
  const [draftsLoading, setDraftsLoading] = useState(false)

  // Drafts are where texts are attached; the queue above holds what waits for review.
  const loadDrafts = useCallback(async (cursor: string | null) => {
    setDraftsLoading(true)
    const open = await fetch(`${BASE}/change-requests?status=draft${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`).catch(() => null)
    const listed = open?.ok ? ((await open.json().catch(() => null)) as { changeRequests?: ChangeRequestSummary[]; nextCursor?: string | null } | null) : null
    setDraftsLoading(false)
    const page = listed?.changeRequests
    if (!Array.isArray(page)) {
      setDraftsFailure({ cursor })
      return
    }
    setDraftsFailure(null)
    setDrafts((listedBefore) => (cursor ? [...listedBefore, ...page] : page))
    setDraftsCursor(listed?.nextCursor ?? null)
  }, [])

  const load = useCallback(async () => {
    const response = await fetch(BASE).catch(() => null)
    if (!response || !response.ok) {
      setOverview({ state: 'error', status: response?.status ?? 0 })
      return
    }
    setOverview({ state: 'ready', value: (await response.json()) as PlatformKnowledgeOverview })
    await loadDrafts(null)
  }, [loadDrafts])

  // A link from the base corpus opens the request a file belongs to.
  useEffect(() => {
    const linked = new URLSearchParams(window.location.search).get('request')
    if (linked) setOpenId(linked)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (overview.state === 'error' && overview.status === 403) {
    return (
      <EmptyState
        icon={Globe2}
        title={t('countryKnowledge.disabledTitle')}
        description={t('countryKnowledge.disabledBody')}
      />
    )
  }

  const ready = overview.state === 'ready' ? overview.value : null
  // The first page failed: the next page waits until the list it would extend is read again.
  const refreshFailed = draftsFailure !== null && draftsFailure.cursor === null
  return (
    <div className="flex flex-col gap-6">
      <SectionCard
        title={t('countryKnowledge.countriesTitle')}
        description={t('countryKnowledge.countriesDescription')}
        loading={overview.state === 'loading'}
        error={overview.state === 'error'}
        onRetry={() => void load()}
      >
        {ready ? (
          <Table data-testid="country-knowledge-countries">
            <TableHeader>
              <TableRow>
                <TableHead>{t('countryKnowledge.columns.country')}</TableHead>
                <TableHead>{t('countryKnowledge.columns.released')}</TableHead>
                <TableHead className="text-right">{t('countryKnowledge.columns.open')}</TableHead>
                <TableHead className="text-right">
                  {t('countryKnowledge.columns.offices')}
                </TableHead>
                <TableHead className="text-right">
                  {t('countryKnowledge.columns.overdue')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ready.countries.map((country) => (
                <TableRow key={country.countryId}>
                  <TableCell>
                    <span className="font-medium">{countryName(country.countryId, locale)}</span>{' '}
                    <span className="text-muted-foreground font-mono text-xs">{country.countryId}</span>
                  </TableCell>
                  <TableCell>{released(country.released, t)}</TableCell>
                  <TableCell className="text-right tabular-nums">{country.openRequests}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {country.entitledOffices}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {country.overdueEditions > 0 ? (
                      <Badge variant="warning">{country.overdueEditions}</Badge>
                    ) : (
                      0
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
      </SectionCard>

      <SectionCard
        title={t('countryKnowledge.queueTitle')}
        description={t('countryKnowledge.queueDescription')}
        loading={overview.state === 'loading'}
      >
        {ready && ready.queue.length === 0 ? (
          <EmptyState icon={ListChecks} title={t('countryKnowledge.queueEmpty')} />
        ) : null}
        {ready && ready.queue.length > 0 ? (
          <Table data-testid="country-knowledge-queue">
            <TableHeader>
              <TableRow>
                <TableHead>{t('countryKnowledge.columns.request')}</TableHead>
                <TableHead>{t('countryKnowledge.columns.country')}</TableHead>
                <TableHead className="text-right">
                  {t('countryKnowledge.columns.records')}
                </TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {ready.queue.map((request) => (
                <TableRow key={request.id}>
                  <TableCell className="font-medium">
                    <div className="flex flex-col gap-1">
                      {request.title}
                      <ApprovalBadges approval={request.approval} secondReview={request.secondReview} />
                    </div>
                  </TableCell>
                  <TableCell>{countryName(request.countryId, locale)}</TableCell>
                  <TableCell className="text-right tabular-nums">{request.revisionCount}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="outline" onClick={() => setOpenId(request.id)}>
                      {t('countryKnowledge.open')}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
      </SectionCard>

      {drafts.length > 0 || draftsFailure ? (
        <SectionCard title={t('countryKnowledge.draftsTitle')} description={t('countryKnowledge.draftsDescription')}>
          {/* A failed first page, with drafts listed or not: what is listed may be out of date, and the retry reads the first page again. */}
          {refreshFailed ? (
            <LoadError title={t('countryKnowledge.draftsLoadError')} onRetry={() => loadDrafts(null)} retrying={draftsLoading} />
          ) : null}
          <Table data-testid="country-knowledge-drafts">
            <TableBody>
              {drafts.map((request) => (
                <TableRow key={request.id}>
                  <TableCell className="font-medium">{request.title}</TableCell>
                  <TableCell>{countryName(request.countryId, locale)}</TableCell>
                  <TableCell className="text-right tabular-nums">{request.revisionCount}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="outline" onClick={() => setOpenId(request.id)}>
                      {t('countryKnowledge.open')}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <LoadMore
            auto={false}
            hasMore={draftsCursor !== null && !refreshFailed}
            loading={draftsLoading && drafts.length > 0 && !refreshFailed}
            failed={draftsFailure !== null}
            onLoadMore={() => void loadDrafts(draftsFailure ? draftsFailure.cursor : draftsCursor)}
            loadMoreLabel={t('countryKnowledge.draftsMore')}
            loadingLabel={t('countryKnowledge.draftsLoadingMore')}
            failedLabel={t('countryKnowledge.draftsLoadError')}
          />
        </SectionCard>
      ) : null}

      <Dialog open={openId !== null} onOpenChange={(open) => (open ? null : setOpenId(null))}>
        <DialogContent
          className="max-h-[85dvh] overflow-y-auto sm:max-w-3xl"
          fullScreenOnMobile
          closeLabel={t('countryKnowledge.close')}
        >
          {openId ? (
            <ChangeRequestReview id={openId} canManage={canManage} onChanged={() => void load()} />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}
