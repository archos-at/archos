'use client'

/**
 * Platform → a country → law map: the country as one outline, country →
 * region → adoption statement, everything opening in place
 * (docs/design/international/country-onboarding-ux.md, section B). It reads
 * the open change request the review reads (`change-requests/[id]`), so what
 * it shows is what a reviewer decides on; `?request=` names another. A
 * reviewer confirms there, unit by unit (`law-map-review.ts`); approving and
 * publishing stay in the change request.
 */

import type { JSX } from 'react'
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Map as MapIcon } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { SectionCard } from '@/features/platform/components/section-card'
import { usePlatformCan } from '@/features/platform/platform-access'
import { useAuth } from '@/adapters/auth/use-auth'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { useLocale, useTranslations } from '@/i18n'
import { lawMapCopy } from '@/i18n/namespaces/law-map'
import { lawMapOf } from '@/lib/base-knowledge/platform/law-map'
import { reviewUnitsOf } from '@/lib/base-knowledge/platform/law-map-review'
import type { ChangeRequestSummary, ChangeRequestView } from '@/lib/base-knowledge/platform/wire'
import type { SourceStatusView } from '@/lib/base-knowledge/platform/source-service'
import { countryName } from '../change-request-format'
import { usePlatformJson } from '../countries/use-platform-json'
import { QuietLinks } from './law-map-atoms'
import { branchesOf, LawMapOutline } from './law-map-outline'

const BASE = '/api/platform/knowledge/change-requests'

/** The request a reviewer works on: the newest submitted one, else an approved one not yet published, else the newest draft. */
export function openRequestOf(requests: readonly ChangeRequestSummary[]): ChangeRequestSummary | null {
  const newest = (status: string) => requests.filter((one) => one.status === status).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null
  return newest('submitted') ?? newest('approved') ?? newest('draft')
}

export function LawMapPage({ countryId, today = new Date().toISOString().slice(0, 10) }: { countryId: string; today?: string }): JSX.Element {
  const t = useTranslations(lawMapCopy)
  const { locale } = useLocale()
  const params = useSearchParams()
  // Only a request id goes into the path; anything else reads as no request named.
  const asked = params.get('request')
  const named = asked && /^[0-9a-f-]{36}$/i.test(asked) ? asked : null
  const list = usePlatformJson<{ changeRequests: ChangeRequestSummary[] }>(`${BASE}?countryId=${countryId}&limit=200`)
  const canWrite = usePlatformCan(PLATFORM_PERMISSIONS.knowledgeWrite)
  const sources = usePlatformJson<{ sources: SourceStatusView[] }>(canWrite ? '/api/platform/knowledge/sources' : null)
  const requestId = named ?? (list.load.state === 'ready' ? openRequestOf(list.load.value.changeRequests)?.id ?? null : null)
  const request = usePlatformJson<ChangeRequestView>(requestId ? `${BASE}/${requestId}` : null)
  const map = useMemo(() => (request.load.state === 'ready' ? lawMapOf(countryId, request.load.value.revisions, request.load.value.captures) : null), [request.load, countryId])
  const units = useMemo(() => (map && request.load.state === 'ready' ? reviewUnitsOf(map, request.load.value) : []), [map, request.load])
  const canReview = usePlatformCan(PLATFORM_PERMISSIONS.knowledgeReview)
  const { user } = useAuth()
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [open, setOpen] = useState<string | null>(null)
  const toggle = (id: string) => setExpanded((now) => (now.has(id) ? new Set([...now].filter((one) => one !== id)) : new Set([...now, id])))

  const countryHref = `/app/platform/countries/${countryId.toLowerCase()}`
  const name = countryName(countryId, locale)
  const header = (subtitle?: string) => <PageHeader crumb={<Link href={countryHref} className="hover:underline">{name}</Link>} title={t('title')} subtitle={subtitle} />

  if (!named && list.load.state === 'ready' && !requestId) {
    return (
      <div className="flex flex-col gap-6">
        {header()}
        <EmptyState icon={MapIcon} title={t('title')} description={t('noRequest')} />
      </div>
    )
  }
  if (!map || request.load.state !== 'ready') {
    const failed = request.load.state === 'error' || list.load.state === 'error'
    return (
      <div className="flex flex-col gap-6">
        {header()}
        <SectionCard loading={!failed} error={failed} onRetry={failed ? (list.load.state === 'error' ? list.reload : request.reload) : undefined} />
      </div>
    )
  }

  const view = request.load.value
  // What waits for a verdict; a unit sent back waits for its proposer, not for this reviewer.
  const waiting = units.filter((unit) => unit.review === 'open')
  const reviewable = view.status === 'submitted'
  // "Next" opens what waits and the branches it sits in, then brings it into view.
  const goTo = (key: string): void => {
    const unit = units.find((one) => one.key === key)
    if (!unit) return
    setExpanded((now) => new Set([...now, ...branchesOf(map, unit)]))
    setOpen(key)
    window.setTimeout(() => document.getElementById(`row-${key}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 50)
  }
  const confirm = {
    requestId: view.id,
    open: reviewable,
    canReview,
    // As the server decides it (0208, 0218): an author of any revision in the request.
    authored: Boolean(user?.id) && view.revisions.some((revision) => revision.createdBy === user?.id),
    onDone: (advance: boolean) => {
      request.reload()
      if (!advance) return
      const next = waiting.find((unit) => unit.key !== open)
      if (next) goTo(next.key)
      else setOpen(null)
    },
  }
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4" data-testid="law-map">
      {header(t('request', { title: view.title }))}
      {list.load.state === 'ready' ? (
        <QuietLinks
          links={list.load.value.changeRequests
            .filter((one) => one.id !== view.id && ['draft', 'submitted', 'approved'].includes(one.status))
            .map((one) => ({ href: `${countryHref}/map?request=${one.id}`, label: t('otherRequest', { title: one.title }) }))}
        />
      ) : null}
      {reviewable && canReview ? (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          {waiting.length > 0 ? (
            <Button size="sm" variant="outline" onClick={() => goTo(waiting[0]?.key ?? '')} data-testid="next-to-confirm">
              {t('toConfirm', { count: waiting.length })}
            </Button>
          ) : (
            <span>
              {view.sourcesUnchecked ? t('sourcesUnchecked') : t('allConfirmed')}{' '}
              <Link href={`${countryHref}?section=review&request=${view.id}`} className="underline underline-offset-2">
                {t('approveThere')}
              </Link>
            </span>
          )}
        </div>
      ) : null}
      {units.length === 0 ? (
        <EmptyState icon={MapIcon} title={t('title')} description={t('empty')} />
      ) : (
        <LawMapOutline
          map={map}
          units={new Map(units.map((unit) => [unit.key, unit]))}
          confirm={confirm}
          add={
            canWrite && sources.load.state === 'ready'
              ? {
                  countryId,
                  sources: sources.load.value.sources.filter((source) => source.countryId === countryId),
                  // Stay here: the draft's link appears above, and this request is read again in case it was the draft.
                  onAdded: () => {
                    setOpen(null)
                    list.reload()
                    request.reload()
                  },
                }
              : null
          } today={today} rootName={name} expanded={expanded} toggle={toggle} open={open} setOpen={setOpen} />
      )}
      <Link href={`${countryHref}?section=review&request=${view.id}`} className="text-muted-foreground text-sm underline underline-offset-2">
        {t('openRequest')}
      </Link>
    </div>
  )
}
