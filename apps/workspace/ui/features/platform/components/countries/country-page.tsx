'use client'

/**
 * One country's knowledge (Platform → Länder → a country), the only place it is
 * kept. Its sections follow the work: overview with the one next step, works
 * and editions with their texts, sources, rules, review, quality. The open
 * section is in the address (`?section=`), so a link lands on it; a change
 * request opens over the page (`?request=`).
 */

import type { JSX } from 'react'
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Globe2 } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { SectionCard } from '@/features/platform/components/section-card'
import { useLocale, useTranslations } from '@/i18n'
import { platformCopy } from '@/i18n/namespaces/platform'
import type { ChangeRequestSummary, PlatformKnowledgeOverview } from '@/lib/base-knowledge/platform/wire'
import type { TextPlacementList } from '@/lib/base-knowledge/platform/text-wire'
import type { SourceStatusView } from '@/lib/base-knowledge/platform/source-service'
import { countryName } from '../change-request-format'
import { ChangeRequestDialog } from './change-request-dialog'
import { StageBadge } from './country-atoms'
import { COUNTRY_SECTIONS, countryNextStep, countryStage, isCountrySection, type CountrySection } from './country-state'
import { OverviewSection, QualitySection, ReviewSection, RulesSection, SourcesSection, WorksSection } from './country-sections'
import { usePlatformJson } from './use-platform-json'

const BASE = '/api/platform/knowledge'

/** The open section and request, kept in the address without a navigation. */
function useAddressState(): [CountrySection, (section: CountrySection) => void, string | null, (id: string | null) => void] {
  const [section, setSection] = useState<CountrySection>('overview')
  const [request, setRequest] = useState<string | null>(null)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const named = params.get('section')
    if (isCountrySection(named)) setSection(named)
    setRequest(params.get('request'))
  }, [])
  const write = useCallback((key: string, value: string | null) => {
    const url = new URL(window.location.href)
    if (value) url.searchParams.set(key, value)
    else url.searchParams.delete(key)
    window.history.replaceState(null, '', url)
  }, [])
  const go = useCallback((next: CountrySection) => (setSection(next), write('section', next)), [write])
  const open = useCallback((id: string | null) => (setRequest(id), write('request', id)), [write])
  return [section, go, request, open]
}

export function CountryPage({ countryId }: { countryId: string }): JSX.Element {
  const t = useTranslations(platformCopy)
  const { locale } = useLocale()
  const [section, go, request, open] = useAddressState()
  const overview = usePlatformJson<PlatformKnowledgeOverview>(BASE)
  const requests = usePlatformJson<{ changeRequests: ChangeRequestSummary[] }>(`${BASE}/change-requests?countryId=${countryId}&limit=200`)
  const texts = usePlatformJson<TextPlacementList>(`${BASE}/texts?countryId=${countryId}`)
  const allSources = usePlatformJson<{ sources: SourceStatusView[] }>(`${BASE}/sources`)

  const reloadAll = (): void => {
    overview.reload()
    requests.reload()
    texts.reload()
  }

  const name = countryName(countryId, locale)
  const crumb = (
    <Link href="/app/platform/countries" className="hover:underline">
      {t('sections.countries.title')}
    </Link>
  )

  if (overview.load.state === 'error' && overview.load.status === 403) {
    return <EmptyState icon={Globe2} title={t('countryKnowledge.disabledTitle')} description={t('countryKnowledge.disabledBody')} />
  }
  if (overview.load.state !== 'ready') {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader crumb={crumb} title={name} />
        <SectionCard loading={overview.load.state === 'loading'} error={overview.load.state === 'error'} onRetry={overview.reload} />
      </div>
    )
  }

  const value = overview.load.value
  const coverage = value.countries.find((country) => country.countryId === countryId) ?? {
    countryId,
    released: {},
    openRequests: 0,
    entitledOffices: 0,
    overdueEditions: 0,
  }
  const step = countryNextStep(coverage, value.queue)
  const drafts = requests.load.state === 'ready' ? requests.load.value.changeRequests.filter((one) => one.status === 'draft') : []
  const sources: typeof allSources.load =
    allSources.load.state === 'ready'
      ? { state: 'ready', value: { sources: allSources.load.value.sources.filter((source) => source.countryId === countryId) } }
      : allSources.load

  return (
    <div className="flex flex-col gap-6" data-testid="country-page">
      <PageHeader crumb={crumb} title={name} subtitle={t('countryPages.page.subtitle')} action={<StageBadge stage={countryStage(coverage, value.queue)} />} />
      <Tabs value={section} onValueChange={(next) => (isCountrySection(next) ? go(next) : null)} className="gap-6">
        <TabsList className="w-full overflow-x-auto sm:w-fit" aria-label={t('countryPages.page.sectionsLabel')}>
          {COUNTRY_SECTIONS.map((key) => (
            <TabsTrigger key={key} value={key} data-testid={`country-tab-${key}`}>
              {t(`countryPages.sections.${key}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="overview">
          <OverviewSection coverage={coverage} step={step} onGo={go} />
        </TabsContent>
        <TabsContent value="works">
          <WorksSection
            countryId={countryId}
            texts={texts.load}
            drafts={drafts}
            onRetry={texts.reload}
            onOpen={open}
            onAdded={reloadAll}
            onReview={(id) => (go('review'), open(id))}
          />
        </TabsContent>
        <TabsContent value="sources">
          <SourcesSection sources={sources} onRetry={allSources.reload} />
        </TabsContent>
        <TabsContent value="rules">
          <RulesSection coverage={coverage} />
        </TabsContent>
        <TabsContent value="review">
          <ReviewSection requests={requests.load} onRetry={requests.reload} onOpen={open} />
        </TabsContent>
        <TabsContent value="quality">
          <QualitySection />
        </TabsContent>
      </Tabs>
      <ChangeRequestDialog id={request} onClose={() => open(null)} onChanged={reloadAll} />
    </div>
  )
}
