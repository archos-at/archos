'use client'

/**
 * Platform → a country → law map: the country as one outline, country →
 * region → adoption statement, everything opening in place
 * (docs/design/international/country-onboarding-ux.md, section B). It reads
 * the open change request the review reads (`change-requests/[id]`), so what
 * it shows is what a reviewer decides on; `?request=` names another.
 */

import type { JSX } from 'react'
import { useMemo } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Map as MapIcon } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { SectionCard } from '@/features/platform/components/section-card'
import { useLocale, useTranslations } from '@/i18n'
import { lawMapCopy } from '@/i18n/namespaces/law-map'
import { lawMapOf } from '@/lib/base-knowledge/platform/law-map'
import type { ChangeRequestSummary, ChangeRequestView } from '@/lib/base-knowledge/platform/wire'
import { countryName } from '../change-request-format'
import { usePlatformJson } from '../countries/use-platform-json'
import { LawMapOutline } from './law-map-outline'

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
  const list = usePlatformJson<{ changeRequests: ChangeRequestSummary[] }>(named ? null : `${BASE}?countryId=${countryId}&limit=200`)
  const requestId = named ?? (list.load.state === 'ready' ? openRequestOf(list.load.value.changeRequests)?.id ?? null : null)
  const request = usePlatformJson<ChangeRequestView>(requestId ? `${BASE}/${requestId}` : null)
  const map = useMemo(() => (request.load.state === 'ready' ? lawMapOf(countryId, request.load.value.revisions, request.load.value.captures) : null), [request.load, countryId])

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
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4" data-testid="law-map">
      {header(t('request', { title: view.title }))}
      {map.territories.size === 0 && map.statements.length === 0 ? <EmptyState icon={MapIcon} title={t('title')} description={t('empty')} /> : <LawMapOutline map={map} today={today} rootName={name} />}
      <Link href={`${countryHref}?section=review&request=${view.id}`} className="text-muted-foreground text-sm underline underline-offset-2">
        {t('openRequest')}
      </Link>
    </div>
  )
}
