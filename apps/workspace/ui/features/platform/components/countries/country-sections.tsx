'use client'

/**
 * The sections of one country's page (Platform → Länder → a country), in the
 * order the work runs: overview, works and editions with their texts, sources,
 * rules, review, quality. Each reads a route the platform door also offers, and
 * each empty state says what to do. Every change goes through a change request:
 * a text is attached inside a draft, never uploaded beside one.
 */

import type { JSX } from 'react'
import { useState } from 'react'
import Link from 'next/link'
import { BookOpen, FilePlus2, FileText, Gauge, ListChecks, Plug, Scale, ShieldCheck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { StatCard } from '@/components/ui/stat-card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { SectionCard } from '@/features/platform/components/section-card'
import { useTranslations } from '@/i18n'
import { platformCopy } from '@/i18n/namespaces/platform'
import type { ChangeRequestSummary, CountryCoverage } from '@/lib/base-knowledge/platform/wire'
import type { TextPlacementList, TextPlacementView } from '@/lib/base-knowledge/platform/text-wire'
import type { SourceStatusView } from '@/lib/base-knowledge/platform/source-service'
import { usePlatformCan } from '@/features/platform/platform-access'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { AcceptAllButton } from './accept-all-button'
import { AddDocumentDialog } from './add-document-dialog'
import { NextStepText } from './country-atoms'
import { REQUEST_GROUPS, requestGroup, sectionOf, type CountryNextStep, type CountrySection } from './country-state'
import type { Load } from './use-platform-json'

const AGENTS_HREF = '/app/platform/agents'

/** Where to go when nothing is there yet: the operator's own assistant on the platform door proposes records. */
function ConnectAssistant(): JSX.Element {
  const t = useTranslations(platformCopy)
  return (
    <Button asChild size="sm" variant="outline">
      <Link href={AGENTS_HREF}>
        <Plug className="size-3.5" aria-hidden />
        {t('countryPages.connectAssistant')}
      </Link>
    </Button>
  )
}

export function OverviewSection({
  coverage,
  step,
  onGo,
}: {
  coverage: CountryCoverage
  step: CountryNextStep
  onGo: (section: CountrySection) => void
}): JSX.Element {
  const t = useTranslations(platformCopy)
  const released = coverage.released
  const target = sectionOf(step)
  return (
    <div className="flex flex-col gap-6" data-testid="country-section-overview">
      <SectionCard title={t('countryPages.overview.nextTitle')} testId="country-next-step">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm">
            <NextStepText step={step} />
          </p>
          {step.kind === 'start' ? (
            <ConnectAssistant />
          ) : step.kind !== 'none' && target !== 'overview' ? (
            <Button size="sm" onClick={() => onGo(target)}>
              {t(`countryPages.sections.${target}`)}
            </Button>
          ) : null}
        </div>
      </SectionCard>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={<BookOpen />}
          label={t('countryPages.overview.works')}
          value={released.work ?? 0}
          hint={t('countryPages.overview.worksHint', { editions: released.edition ?? 0, texts: released.manifestation ?? 0 })}
        />
        <StatCard
          icon={<ListChecks />}
          label={t('countryPages.overview.open')}
          value={coverage.openRequests}
          hint={t('countryPages.overview.openHint')}
        />
        <StatCard icon={<Gauge />} label={t('countryPages.overview.due')} value={coverage.overdueEditions} hint={t('countryPages.overview.dueHint')} />
        <StatCard
          icon={<ShieldCheck />}
          label={t('countryPages.overview.offices')}
          value={coverage.entitledOffices}
          hint={t('countryPages.overview.officesHint')}
        />
      </div>
      <SectionCard title={t('countryPages.overview.qualityTitle')}>
        <p className="text-muted-foreground text-sm">{t('countryPages.quality.none')}</p>
      </SectionCard>
    </div>
  )
}

/** The texts grouped by work, then edition: what offices read, and what a draft still holds. */
function byWork(texts: readonly TextPlacementView[]): { work: string; editions: { edition: string; texts: TextPlacementView[] }[] }[] {
  const works = new Map<string, Map<string, TextPlacementView[]>>()
  for (const text of texts) {
    const work = text.workTitle ?? text.editionId
    const editions = works.get(work) ?? new Map<string, TextPlacementView[]>()
    const edition = text.editionLabel ?? text.editionId
    editions.set(edition, [...(editions.get(edition) ?? []), text])
    works.set(work, editions)
  }
  return [...works.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([work, editions]) => ({ work, editions: [...editions.entries()].map(([edition, list]) => ({ edition, texts: list })) }))
}

export function WorksSection({
  countryId,
  texts,
  drafts,
  onRetry,
  onOpen,
  onAdded,
  onReview,
}: {
  countryId: string
  texts: Load<TextPlacementList>
  drafts: ChangeRequestSummary[]
  onRetry: () => void
  onOpen: (id: string) => void
  onAdded: () => void
  onReview: (id: string) => void
}): JSX.Element {
  const t = useTranslations(platformCopy)
  const [adding, setAdding] = useState(false)
  const ready = texts.state === 'ready' ? texts.value.texts : null
  return (
    <div className="flex flex-col gap-6" data-testid="country-section-works">
      <SectionCard title={t('countryPages.works.addTitle')} description={t('countryPages.works.addDescription')}>
        <div className="flex flex-col gap-3">
          <div>
            <Button size="sm" onClick={() => setAdding(true)} data-testid="country-add-document">
              <FilePlus2 className="size-3.5" aria-hidden />
              {t('countryPages.addDocument.open')}
            </Button>
          </div>
          {drafts.length > 0 ? (
            <ul className="flex flex-col gap-2" data-testid="country-works-drafts">
              {drafts.map((draft) => (
                <li key={draft.id} className="flex items-center justify-between gap-3">
                  <span className="font-medium">{draft.title}</span>
                  <Button size="sm" variant="outline" onClick={() => onOpen(draft.id)}>
                    {t('countryPages.works.attach')}
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <AddDocumentDialog countryId={countryId} open={adding} onOpenChange={setAdding} onAdded={onAdded} onReview={onReview} />
      </SectionCard>
      <SectionCard
        title={t('countryPages.works.title')}
        description={t('countryPages.works.description')}
        loading={texts.state === 'loading'}
        error={texts.state === 'error'}
        onRetry={onRetry}
        empty={ready !== null && ready.length === 0}
        emptyIcon={FileText}
        emptyTitle={t('countryPages.works.emptyTitle')}
        emptyDescription={t('countryPages.works.emptyDescription')}
      >
        {ready && ready.length > 0 ? (
          <Table data-testid="country-works">
            <TableHeader>
              <TableRow>
                <TableHead>{t('countryPages.works.work')}</TableHead>
                <TableHead>{t('countryPages.works.edition')}</TableHead>
                <TableHead>{t('countryPages.works.text')}</TableHead>
                <TableHead>{t('countryPages.works.state')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {byWork(ready).flatMap(({ work, editions }) =>
                editions.flatMap(({ edition, texts: list }, editionIndex) =>
                  list.map((text, textIndex) => (
                    <TableRow key={text.corpusFile}>
                      <TableCell className="font-medium">{editionIndex === 0 && textIndex === 0 ? work : null}</TableCell>
                      <TableCell>{textIndex === 0 ? edition : null}</TableCell>
                      <TableCell className="text-muted-foreground font-mono text-xs">{text.corpusFile}</TableCell>
                      <TableCell>
                        {text.released ? (
                          <Badge variant="success">{t('countryPages.works.released')}</Badge>
                        ) : text.changeRequestId ? (
                          <Button size="sm" variant="ghost" onClick={() => onOpen(text.changeRequestId ?? '')}>
                            {t(`countryKnowledge.status.${text.changeRequestStatus ?? 'draft'}`)}
                          </Button>
                        ) : (
                          <Badge variant="outline">{t('countryPages.works.unreleased')}</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  )),
                ),
              )}
            </TableBody>
          </Table>
        ) : null}
      </SectionCard>
    </div>
  )
}

export function SourcesSection({
  sources,
  onRetry,
}: {
  sources: Load<{ sources: SourceStatusView[] }>
  onRetry: () => void
}): JSX.Element {
  const t = useTranslations(platformCopy)
  const ready = sources.state === 'ready' ? sources.value.sources : null
  return (
    <SectionCard
      testId="country-section-sources"
      title={t('countryPages.sources.title')}
      description={t('countryPages.sources.description')}
      loading={sources.state === 'loading'}
      error={sources.state === 'error'}
      onRetry={onRetry}
      empty={ready !== null && ready.length === 0}
      emptyIcon={Plug}
      emptyTitle={t('countryPages.sources.emptyTitle')}
      emptyDescription={t('countryPages.sources.emptyDescription')}
      emptyAction={<ConnectAssistant />}
    >
      {ready && ready.length > 0 ? (
        <Table data-testid="country-sources">
          <TableHeader>
            <TableRow>
              <TableHead>{t('countryPages.sources.source')}</TableHead>
              <TableHead>{t('countryPages.sources.hosts')}</TableHead>
              <TableHead>{t('countryPages.works.state')}</TableHead>
              <TableHead>{t('countryPages.sources.check')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ready.map((source) => (
              <TableRow key={source.sourceKey}>
                <TableCell className="font-medium">{source.sourceKey}</TableCell>
                <TableCell className="text-muted-foreground text-xs">{source.hosts.map((host) => host.host).join(', ')}</TableCell>
                <TableCell>
                  <Badge variant={source.state === 'active' ? 'success' : 'info'}>{t(`countryPages.sources.states.${source.state}`)}</Badge>
                </TableCell>
                <TableCell className="text-sm">
                  {source.monitor.failure ? (
                    <Badge variant="danger">{t('countryPages.sources.failing')}</Badge>
                  ) : source.monitor.freshnessLagDays !== null ? (
                    t('countryPages.sources.lag', { days: source.monitor.freshnessLagDays })
                  ) : (
                    <span className="text-muted-foreground">{t('countryPages.sources.unwatched')}</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
    </SectionCard>
  )
}

export function RulesSection({ coverage }: { coverage: CountryCoverage }): JSX.Element {
  const t = useTranslations(platformCopy)
  const rulesets = coverage.released.ruleset ?? 0
  return (
    <SectionCard
      testId="country-section-rules"
      title={t('countryPages.rules.title')}
      description={t('countryPages.rules.description')}
      empty={rulesets === 0}
      emptyIcon={Scale}
      emptyTitle={t('countryPages.rules.emptyTitle')}
      emptyDescription={t('countryPages.rules.emptyDescription')}
      emptyAction={<ConnectAssistant />}
    >
      {rulesets > 0 ? <p className="text-sm">{t('countryPages.rules.released', { count: rulesets })}</p> : null}
    </SectionCard>
  )
}

export function ReviewSection({
  requests,
  onRetry,
  onOpen,
  onChanged,
}: {
  requests: Load<{ changeRequests: ChangeRequestSummary[] }>
  onRetry: () => void
  onOpen: (id: string) => void
  onChanged: () => void
}): JSX.Element {
  const t = useTranslations(platformCopy)
  const canReview = usePlatformCan(PLATFORM_PERMISSIONS.knowledgeReview)
  const ready = requests.state === 'ready' ? requests.value.changeRequests : null
  return (
    <SectionCard
      testId="country-section-review"
      title={t('countryPages.review.title')}
      description={t('countryPages.review.description')}
      loading={requests.state === 'loading'}
      error={requests.state === 'error'}
      onRetry={onRetry}
      empty={ready !== null && ready.length === 0}
      emptyIcon={ListChecks}
      emptyTitle={t('countryPages.review.emptyTitle')}
      emptyDescription={t('countryPages.review.emptyDescription')}
      emptyAction={<ConnectAssistant />}
    >
      {ready && ready.length > 0 ? (
        <div className="flex flex-col gap-6">
          {REQUEST_GROUPS.map((group) => {
            const members = ready.filter((request) => requestGroup(request) === group)
            if (members.length === 0) return null
            return (
              <section key={group} className="flex flex-col gap-2" data-testid={`country-review-${group}`}>
                <h3 className="text-sm font-medium">{t(`countryPages.review.groups.${group}`, { count: members.length })}</h3>
                <Table>
                  <TableBody>
                    {members.map((request) => (
                      <TableRow key={request.id}>
                        <TableCell className="font-medium">{request.title}</TableCell>
                        <TableCell className="text-muted-foreground text-sm">{t(`countryKnowledge.status.${request.status}`)}</TableCell>
                        <TableCell className="text-muted-foreground text-right text-sm tabular-nums">
                          {t('countryPages.review.records', { count: request.revisionCount })}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex flex-wrap justify-end gap-2">
                            {group === 'waiting' && canReview ? <AcceptAllButton requestId={request.id} onDone={onChanged} /> : null}
                            <Button size="sm" variant={group === 'waiting' ? 'default' : 'outline'} onClick={() => onOpen(request.id)}>
                              {t(`countryPages.review.open.${group}`)}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </section>
            )
          })}
        </div>
      ) : null}
    </SectionCard>
  )
}

export function QualitySection(): JSX.Element {
  const t = useTranslations(platformCopy)
  return (
    <SectionCard
      testId="country-section-quality"
      title={t('countryPages.quality.title')}
      description={t('countryPages.quality.description')}
      empty
      emptyIcon={ShieldCheck}
      emptyTitle={t('countryPages.quality.emptyTitle')}
      emptyDescription={t('countryPages.quality.none')}
    />
  )
}
