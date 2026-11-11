'use client'

/**
 * The country as one outline (country-onboarding-ux.md, B): the country, its
 * regions, each region's acts, and a second branch with the works the acts
 * make binding, their editions and each edition's text. Each row says its
 * value once; what a row holds unfolds under it. Read only in this slice.
 */

import type { JSX } from 'react'
import { useState } from 'react'
import { editionOrder, nextChange, summaryOf, summaryOn, type LawMap, type LawMapEdition, type LawMapStatement } from '@/lib/base-knowledge/platform/law-map'
import { useLocale, useTranslations } from '@/i18n'
import type { Translator } from '@/i18n'
import { lawMapCopy } from '@/i18n/namespaces/law-map'
import { Branch, OutlineRow, SourceQuote, Unfold } from './law-map-atoms'

function useDate(): (iso: string | null) => string {
  const { locale } = useLocale()
  return (iso) => (iso ? new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`)) : '–')
}

const designationOf = (map: LawMap, workId: string): string => map.topics.find((topic) => topic.workId === workId)?.designation ?? workId

function statementEditions(map: LawMap, statement: LawMapStatement) {
  return statement.cells.flatMap((cell) => {
    const edition = map.editions.get(cell.editionId)
    return edition ? [{ topicWorkId: cell.topicWorkId, edition }] : []
  })
}

function exceptionsText(map: LawMap, exceptions: readonly { topicWorkId?: string; topic?: { workId: string }; edition: LawMapEdition }[]): string {
  return exceptions.map((one) => `${designationOf(map, one.topic?.workId ?? one.topicWorkId ?? '')} ${one.edition.label}`).join(', ')
}

function StatementBody({ map, statement, t }: { map: LawMap; statement: LawMapStatement; t: Translator }): JSX.Element {
  const date = useDate()
  const summary = summaryOf(statementEditions(map, statement))
  const editions = summary.main ? (summary.exceptions.length ? t('editionsWithExceptions', { edition: summary.main.label, exceptions: exceptionsText(map, summary.exceptions) }) : summary.main.label) : '–'
  return (
    <Unfold>
      <p className="text-base">
        {t('says', { act: statement.provision ?? statement.actTitle, editions, territory: map.territories.get(statement.territoryId)?.name ?? statement.territoryId, date: date(statement.validFrom) })}
      </p>
      <div className="flex flex-col gap-2">
        <span className="text-muted-foreground text-xs">{t(`sourceKind.${statement.sourceKind}`)}</span>
        {statement.sources.map((source) => (
          <SourceQuote key={`${source.url}|${source.quote ?? ''}`} {...source} />
        ))}
      </div>
      <p className="text-muted-foreground">
        {statement.deviations.length === 0
          ? t('noDeviations')
          : statement.deviations.map((deviation) => t('deviationAt', { edition: map.editions.get(deviation.editionId)?.label ?? deviation.editionId, anchors: deviation.anchors.join(', ') })).join(' · ')}
      </p>
      <p className="text-muted-foreground text-xs">
        {t(`review.${statement.review}`)} · {t('readOnly')}
      </p>
    </Unfold>
  )
}

function EditionBody({ map, edition, t }: { map: LawMap; edition: LawMapEdition; t: Translator }): JSX.Element {
  const date = useDate()
  const lands = [...new Set(map.statements.filter((statement) => statement.cells.some((cell) => cell.editionId === edition.id)).map((statement) => map.territories.get(statement.territoryId)?.name ?? statement.territoryId))]
  return (
    <Unfold>
      <p>
        {designationOf(map, edition.workId)}, {edition.label}
        {edition.issuedOn ? ` · ${t('published', { date: date(edition.issuedOn) })}` : ''}
      </p>
      {edition.text ? (
        <p>
          {edition.text.url ? (
            <a href={edition.text.url} target="_blank" rel="noreferrer" className="underline underline-offset-2">
              {edition.text.file ?? edition.text.url}
            </a>
          ) : (
            edition.text.file
          )}
        </p>
      ) : (
        <p className="text-muted-foreground">{t('noText')}</p>
      )}
      <p className="text-muted-foreground">{lands.length ? t('bindsIn', { territories: lands.join(', ') }) : t('bindsNowhere')}</p>
    </Unfold>
  )
}

export function LawMapOutline({ map, today, rootName }: { map: LawMap; today: string; rootName: string }): JSX.Element {
  const t = useTranslations(lawMapCopy)
  const date = useDate()
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [open, setOpen] = useState<string | null>(null)
  const toggle = (id: string) => setExpanded((now) => (now.has(id) ? new Set([...now].filter((one) => one !== id)) : new Set([...now, id])))
  const flip = (id: string) => setOpen((now) => (now === id ? null : id))

  const rootId = map.rootIds[0] ?? ''
  const root = map.territories.get(rootId)
  const regions = root ? root.children : map.rootIds
  const worksShown = map.topics

  return (
    <div className="flex flex-col" data-testid="law-map-outline">
      <OutlineRow name={root?.name ?? rootName} size="lg" />
      <p className="text-muted-foreground mb-5 max-w-prose text-sm">{t('lead')}</p>
      <Branch>
        {regions.map((id) => {
          const territory = map.territories.get(id)
          const now = summaryOn(map, id, today)
          const coming = nextChange(map, id, today)
          const comingSummary = coming ? summaryOf(statementEditions(map, coming)) : null
          const statements = map.statements.filter((statement) => statement.territoryId === id).sort((a, b) => (a.validFrom ?? '').localeCompare(b.validFrom ?? ''))
          const statutes = map.statutes.filter((statute) => statute.territoryId === id)
          const isOpen = expanded.has(id)
          return (
            <div key={id}>
              <OutlineRow
                name={territory?.name ?? id}
                value={now.main?.label}
                exceptions={exceptionsText(map, now.exceptions)}
                coming={comingSummary?.main ? t('coming', { edition: comingSummary.main.label, date: date(coming?.validFrom ?? null) }) : undefined}
                attention={statements.some((statement) => statement.review === 'open')}
                expanded={isOpen}
                onClick={() => toggle(id)}
                testId={`region-${id}`}
              />
              {isOpen ? (
                <Branch>
                  {statutes.map((statute) => (
                    <OutlineRow key={statute.workId} size="sm" name={statute.url ? <a href={statute.url} target="_blank" rel="noreferrer" className="underline underline-offset-2">{statute.title}</a> : statute.title} meta={t('buildingLaw')} value={statute.designation} muted />
                  ))}
                  {statements.length === 0 ? <p className="text-muted-foreground py-2.5 text-sm">{t('noActs')}</p> : null}
                  {statements.map((statement) => {
                    const summary = summaryOf(statementEditions(map, statement))
                    return (
                      <div key={statement.key}>
                        <OutlineRow
                          size="sm"
                          name={statement.provision ?? statement.actTitle}
                          meta={t('fromDate', { date: date(statement.validFrom) })}
                          value={summary.main?.label}
                          exceptions={exceptionsText(map, summary.exceptions)}
                          attention={statement.review === 'open'}
                          confirmed={statement.review === 'accepted'}
                          expanded={open === statement.key}
                          onClick={() => flip(statement.key)}
                          testId={`statement-${statement.key}`}
                        />
                        {open === statement.key ? <StatementBody map={map} statement={statement} t={t} /> : null}
                      </div>
                    )
                  })}
                  {territory && territory.children.length > 0 ? <OutlineRow size="sm" muted name={t('below', { count: territory.children.length })} value={t('sameAs', { territory: territory.name })} /> : null}
                </Branch>
              ) : null}
            </div>
          )
        })}
        {worksShown.length > 0 ? (
          <div className="mt-5">
            <OutlineRow name={t('works')} meta={t('worksMeta')} value={t('series', { count: worksShown.length })} expanded={expanded.has('works')} onClick={() => toggle('works')} testId="works" />
            {expanded.has('works') ? (
              <Branch>
                {worksShown.map((topic) => {
                  const editions = [...map.editions.values()].filter((edition) => edition.workId === topic.workId).sort((a, b) => editionOrder(a).localeCompare(editionOrder(b)))
                  const key = `work:${topic.workId}`
                  return (
                    <div key={topic.workId}>
                      <OutlineRow size="sm" name={topic.designation} meta={topic.title} value={t('editions', { count: editions.length })} expanded={expanded.has(key)} onClick={() => toggle(key)} />
                      {expanded.has(key) ? (
                        <Branch>
                          {editions.map((edition) => (
                            <div key={edition.id}>
                              <OutlineRow size="sm" name={edition.label} meta={edition.text?.file ?? undefined} attention={edition.review === 'open'} confirmed={edition.review === 'accepted'} expanded={open === edition.id} onClick={() => flip(edition.id)} />
                              {open === edition.id ? <EditionBody map={map} edition={edition} t={t} /> : null}
                            </div>
                          ))}
                        </Branch>
                      ) : null}
                    </div>
                  )
                })}
              </Branch>
            ) : null}
          </div>
        ) : null}
      </Branch>
    </div>
  )
}
