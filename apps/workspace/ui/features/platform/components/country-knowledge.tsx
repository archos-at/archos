'use client'

/**
 * Platform → Länder (ADR-0165): the one place a country's knowledge is kept.
 * One row per country, in words: where it stands (not started, in progress,
 * published), the one thing it needs next, and how many offices read it. A row
 * opens the country's page, where that work is done.
 *
 * A link from elsewhere (`?request=<id>`) still lands on that change request:
 * on its country's law map, where a request is reviewed and released.
 */

import type { JSX } from 'react'
import { useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronRight, Globe2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { SectionCard } from '@/features/platform/components/section-card'
import { useLocale, useTranslations } from '@/i18n'
import { platformCopy } from '@/i18n/namespaces/platform'
import type { PlatformKnowledgeOverview } from '@/lib/base-knowledge/platform/wire'
import { countryName } from './country-name'
import { countryNextStep, countryStage } from './countries/country-state'
import { NextStepText, StageBadge } from './countries/country-atoms'
import { usePlatformJson } from './countries/use-platform-json'

export const COUNTRIES_HREF = '/app/platform/countries'

export function CountryKnowledge(): JSX.Element {
  const t = useTranslations(platformCopy)
  const router = useRouter()
  const { locale } = useLocale()
  const { load, reload } = usePlatformJson<PlatformKnowledgeOverview>('/api/platform/knowledge')

  useEffect(() => {
    const linked = new URLSearchParams(window.location.search).get('request')
    if (!linked || !/^[0-9a-f-]{36}$/i.test(linked)) return
    void (async () => {
      const response = await fetch(`/api/platform/knowledge/change-requests/${linked}`).catch(() => null)
      const view = response?.ok ? ((await response.json()) as { countryId?: string }) : null
      if (view?.countryId) router.replace(`${COUNTRIES_HREF}/${view.countryId.toLowerCase()}/map?request=${linked}`)
    })()
  }, [router])

  if (load.state === 'error' && load.status === 403) {
    return <EmptyState icon={Globe2} title={t('countryKnowledge.disabledTitle')} description={t('countryKnowledge.disabledBody')} />
  }

  const ready = load.state === 'ready' ? load.value : null
  return (
    <>
      <SectionCard
        title={t('countryPages.list.title')}
        description={t('countryPages.list.description')}
        loading={load.state === 'loading'}
        error={load.state === 'error'}
        onRetry={reload}
        empty={ready !== null && ready.countries.length === 0}
        emptyIcon={Globe2}
        emptyTitle={t('countryPages.list.emptyTitle')}
        emptyDescription={t('countryPages.list.emptyDescription')}
      >
        {ready && ready.countries.length > 0 ? (
          <Table data-testid="country-knowledge-countries">
            <TableHeader>
              <TableRow>
                <TableHead>{t('countryKnowledge.columns.country')}</TableHead>
                <TableHead>{t('countryPages.list.stage')}</TableHead>
                <TableHead>{t('countryPages.list.next')}</TableHead>
                <TableHead className="text-right">{t('countryKnowledge.columns.offices')}</TableHead>
                <TableHead className="w-8" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {ready.countries.map((country) => {
                const step = countryNextStep(country, ready.queue)
                const href = `${COUNTRIES_HREF}/${country.countryId}`
                return (
                  // The whole row opens the country. Not a link stretched over the row: Safari ignores position on a
                  // <tr>, so every row's overlay covered the table and the last row took every tap.
                  <TableRow key={country.countryId} data-testid={`country-row-${country.countryId}`} className="cursor-pointer" onClick={() => router.push(href)}>
                    <TableCell>
                      <Link href={href} className="font-medium" onClick={(event) => event.stopPropagation()}>
                        {countryName(country.countryId, locale)}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <StageBadge stage={countryStage(country, ready.queue)} />
                    </TableCell>
                    <TableCell>
                      {step.kind === 'none' ? (
                        <span className="text-muted-foreground">{t('countryPages.next.none.short')}</span>
                      ) : (
                        <Badge variant={step.kind === 'review' || step.kind === 'check_editions' ? 'warning' : 'outline'}>
                          <NextStepText step={step} short />
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{country.entitledOffices}</TableCell>
                    <TableCell>
                      <ChevronRight className="text-muted-foreground size-4" aria-hidden />
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        ) : null}
      </SectionCard>
    </>
  )
}
