'use client'

/**
 * Platform → a country → law map: the country as a tree you walk down,
 * country → region → adoption statement, with a path on top and no sidebar
 * (docs/design/international/country-onboarding-ux.md, section B). It reads
 * the open change request the review reads (`change-requests/[id]`), so what
 * it shows is what a reviewer decides on; `?request=` names another, and
 * `?node=` is where you are, so a link lands there.
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
import { PathBar } from './law-map-atoms'
import { CountryView, StatementView, TerritoryView } from './law-map-views'

const BASE = '/api/platform/knowledge/change-requests'

/** The request a reviewer works on: the newest submitted one, else the newest draft. */
export function openRequestOf(requests: readonly ChangeRequestSummary[]): ChangeRequestSummary | null {
  const newest = (status: string) => requests.filter((one) => one.status === status).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null
  return newest('submitted') ?? newest('draft')
}

export function LawMapPage({ countryId, today = new Date().toISOString().slice(0, 10), mapHref }: { countryId: string; today?: string; mapHref?: string }): JSX.Element {
  const t = useTranslations(lawMapCopy)
  const { locale } = useLocale()
  const params = useSearchParams()
  const named = params.get('request')
  const node = params.get('node')
  const list = usePlatformJson<{ changeRequests: ChangeRequestSummary[] }>(named ? null : `${BASE}?countryId=${countryId}&limit=200`)
  const requestId = named ?? (list.load.state === 'ready' ? openRequestOf(list.load.value.changeRequests)?.id ?? null : null)
  const request = usePlatformJson<ChangeRequestView>(requestId ? `${BASE}/${requestId}` : null)
  const map = useMemo(() => (request.load.state === 'ready' ? lawMapOf(countryId, request.load.value.revisions, request.load.value.captures) : null), [request.load, countryId])

  const countryHref = `/app/platform/countries/${countryId.toLowerCase()}`
  const hrefOf = (target: string): string => `${mapHref ?? `${countryHref}/map`}?${new URLSearchParams({ ...(named ? { request: named } : {}), node: target })}`
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
        <SectionCard loading={!failed} error={failed} onRetry={failed ? request.reload : undefined} />
      </div>
    )
  }

  const view = request.load.value
  const statement = map.statements.find((one) => one.key === node)
  const territoryId = statement ? statement.territoryId : node && map.territories.has(node) ? node : null
  const rootId = map.rootIds[0] ?? countryId
  const steps: { href: string; name: string }[] = []
  for (let id: string | null = territoryId; id && map.territories.has(id); id = map.territories.get(id)?.parentId ?? null) steps.unshift({ href: hrefOf(id), name: map.territories.get(id)?.name ?? id })
  if (steps.length === 0 || steps[0]?.href !== hrefOf(rootId)) steps.unshift({ href: hrefOf(rootId), name: map.territories.get(rootId)?.name ?? name })
  if (statement) steps.push({ href: hrefOf(statement.key), name: statement.provision ?? statement.actTitle })

  const lead = statement ? t('lead.statement') : territoryId && territoryId !== rootId ? t('lead.territory') : t('lead.country')
  return (
    <div className="flex flex-col gap-5" data-testid="law-map">
      {header(t('request', { title: view.title }))}
      <PathBar steps={steps} label={t('path')} />
      <p className="text-muted-foreground max-w-prose text-sm">{lead}</p>
      {map.territories.size === 0 && map.statements.length === 0 ? <EmptyState icon={MapIcon} title={t('title')} description={t('empty')} /> : null}
      {statement ? (
        <StatementView map={map} statement={statement} />
      ) : territoryId && territoryId !== rootId ? (
        <TerritoryView map={map} today={today} hrefOf={hrefOf} territoryId={territoryId} />
      ) : (
        <CountryView map={map} today={today} hrefOf={hrefOf} rootId={rootId} />
      )}
      <Link href={`${countryHref}?section=review&request=${view.id}`} className="text-muted-foreground text-sm underline underline-offset-2">
        {t('openRequest')}
      </Link>
    </div>
  )
}
