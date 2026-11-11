'use client'

/**
 * The three places of the law map: a country (its regions, each with the
 * squares of what binds today), a region (its timeline, building law and
 * acts), and an adoption statement (what one act says, its source and its
 * deviations). Each view opens with one sentence saying what to do there.
 */

import type { JSX } from 'react'
import { bindingOn, reviewCounts, type LawMap, type LawMapStatement } from '@/lib/base-knowledge/platform/law-map'
import { useLocale, useTranslations } from '@/i18n'
import type { Translator } from '@/i18n'
import { lawMapCopy } from '@/i18n/namespaces/law-map'
import { EditionSquares, FolderList, FolderRow, ReviewBadge, SourceQuote, StatementCard, StatementFact, TimelineFrame, TimelineRow, shadeOf } from './law-map-atoms'

export interface LawMapViewProps {
  map: LawMap
  today: string
  /** The address of a node: a territory id or a statement key. */
  hrefOf: (node: string) => string
}

/** Every edition's shade by its year among all the map's edition years, oldest lightest. */
function editionShades(map: LawMap): Map<string, string> {
  const allYears = [...new Set([...map.editions.values()].map((edition) => yearOf(edition.issuedOn, edition.label)))].sort()
  const shades = new Map<string, string>()
  for (const edition of map.editions.values()) shades.set(edition.id, shadeOf(allYears.indexOf(yearOf(edition.issuedOn, edition.label)), allYears.length))
  return shades
}

/** Two digits of the edition's year, from its date or the last digits of its label. */
function yearOf(issuedOn: string | null, label: string): string {
  const year = issuedOn?.slice(0, 4) ?? label.match(/(\d{4})\s*$/)?.[1] ?? label
  return year.slice(-2)
}

function useDate(): (iso: string | null) => string {
  const { locale } = useLocale()
  return (iso) => (iso ? new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`)) : '–')
}

function Counts({ map, territoryId }: { map: LawMap; territoryId: string }): JSX.Element {
  const t = useTranslations(lawMapCopy)
  const counts = reviewCounts(map, territoryId)
  if (counts.open === 0 && counts.rejected === 0) return <ReviewBadge state="accepted" label={t('counts.done')} />
  return (
    <>
      {counts.open > 0 ? <ReviewBadge state="open" label={t('counts.open', { count: counts.open })} /> : null}
      {counts.rejected > 0 ? <ReviewBadge state="rejected" label={t('counts.rejected', { count: counts.rejected })} /> : null}
    </>
  )
}

export function CountryView({ map, today, hrefOf, rootId }: LawMapViewProps & { rootId: string }): JSX.Element {
  const t = useTranslations(lawMapCopy)
  const shades = editionShades(map)
  const root = map.territories.get(rootId)
  const regions = root ? root.children : map.rootIds
  const squaresOf = (territoryId: string) =>
    map.topics.map((topic) => {
      const binding = bindingOn(map, territoryId, topic.workId, today)
      const edition = binding ? map.editions.get(binding.cell.editionId) : undefined
      return { key: topic.workId, label: edition ? yearOf(edition.issuedOn, edition.label) : null, shade: edition ? shades.get(edition.id) ?? '' : '', title: `${topic.designation}: ${edition?.label ?? '–'}` }
    })
  return (
    <div className="flex flex-col gap-6">
      <FolderList heading={t('regions')}>
        {regions.map((id) => {
          const territory = map.territories.get(id)
          const statute = map.statutes.find((one) => one.territoryId === id)
          return (
            <FolderRow
              key={id}
              href={hrefOf(id)}
              icon="folder"
              name={territory?.name ?? id}
              meta={statute ? `${id} · ${statute.designation}` : id}
              end={
                <>
                  <EditionSquares squares={squaresOf(id)} />
                  <Counts map={map} territoryId={id} />
                </>
              }
            />
          )
        })}
      </FolderList>
      {map.topics.length > 0 ? <p className="text-muted-foreground text-xs">{t('legend', { topics: map.topics.map((topic) => topic.designation).join(' · ') })}</p> : null}
    </div>
  )
}

export function TerritoryView({ map, today, hrefOf, territoryId }: LawMapViewProps & { territoryId: string }): JSX.Element {
  const t = useTranslations(lawMapCopy)
  const date = useDate()
  const shades = editionShades(map)
  const statements = map.statements.filter((statement) => statement.territoryId === territoryId)
  const cells = statements.flatMap((statement) => statement.cells.map((cell) => ({ cell, statement })))
  const starts = cells.map(({ cell }) => cell.validFrom ?? today).sort()
  const firstYear = Number((starts[0] ?? today).slice(0, 4))
  const lastYear = Math.max(Number(today.slice(0, 4)) + 1, ...cells.map(({ cell }) => Number((cell.validTo ?? cell.validFrom ?? today).slice(0, 4)) + 1))
  const x0 = Date.UTC(firstYear, 0, 1)
  const x1 = Date.UTC(lastYear + 1, 0, 1)
  const at = (iso: string | null, fallback: number): number => (iso ? ((Date.parse(`${iso}T00:00:00Z`) - x0) / (x1 - x0)) * 100 : fallback)
  const ticks = Array.from({ length: lastYear - firstYear + 2 }, (_, index) => firstYear + index)
    .filter((year, index, all) => all.length <= 8 || index % 2 === 0)
    .map((year) => ({ at: at(`${year}-01-01`, 0), label: String(year) }))
  const topics = map.topics.filter((topic) => cells.some(({ cell }) => cell.topicWorkId === topic.workId))
  const statutes = map.statutes.filter((statute) => statute.territoryId === territoryId)
  return (
    <div className="flex flex-col gap-6">
      {topics.length > 0 ? (
        <TimelineFrame ticks={ticks}>
          {topics.map((topic) => (
            <TimelineRow
              key={topic.workId}
              label={topic.designation}
              sub={topic.title}
              today={at(today, 0)}
              segments={cells
                .filter(({ cell }) => cell.topicWorkId === topic.workId)
                .map(({ cell, statement }) => {
                  const edition = map.editions.get(cell.editionId)
                  return {
                    key: cell.relationId,
                    from: Math.max(0, at(cell.validFrom, 0)),
                    to: Math.min(100, at(cell.validTo, 100)),
                    label: edition?.label ?? cell.editionId,
                    shade: shades.get(cell.editionId) ?? '',
                    href: hrefOf(statement.key),
                    title: `${edition?.label ?? ''} · ${t('fromDate', { date: date(cell.validFrom) })}`,
                  }
                })}
            />
          ))}
        </TimelineFrame>
      ) : null}
      {statutes.length > 0 ? (
        <FolderList heading={t('buildingLaw')}>
          {statutes.map((statute) => (
            <FolderRow key={statute.workId} href={statute.url ?? hrefOf(territoryId)} external={statute.url !== null} icon="law" name={statute.title} meta={statute.designation} end={<ReviewBadge state={statute.review} label={t(`review.${statute.review}`)} />} />
          ))}
        </FolderList>
      ) : null}
      <FolderList heading={t('acts')}>
        {statements.length === 0 ? <p className="text-muted-foreground px-4 py-3 text-sm">{t('noActs')}</p> : null}
        {statements.map((statement) => (
          <FolderRow
            key={statement.key}
            href={hrefOf(statement.key)}
            icon="act"
            name={statement.provision ?? statement.actTitle}
            meta={`${t('guidelines', { count: statement.cells.length })} · ${[...new Set(statement.cells.map((cell) => map.editions.get(cell.editionId)?.label ?? ''))].join(', ')} · ${t('fromDate', { date: date(statement.validFrom) })}`}
            end={
              <>
                <span className="text-muted-foreground text-xs">{t(`sourceKind.${statement.sourceKind}`)}</span>
                <ReviewBadge state={statement.review} label={t(`review.${statement.review}`)} />
              </>
            }
          />
        ))}
      </FolderList>
    </div>
  )
}

function editionsSentence(map: LawMap, statement: LawMapStatement, t: Translator): string {
  const byEdition = new Map<string, string[]>()
  for (const cell of statement.cells) {
    const label = map.editions.get(cell.editionId)?.label ?? cell.editionId
    const designation = map.topics.find((topic) => topic.workId === cell.topicWorkId)?.designation ?? cell.topicWorkId
    byEdition.set(label, [...(byEdition.get(label) ?? []), designation])
  }
  return [...byEdition.entries()].map(([edition, designations]) => t('editionsOf', { designations: designations.join(', '), edition })).join(t('and'))
}

export function StatementView({ map, statement }: { map: LawMap; statement: LawMapStatement }): JSX.Element {
  const t = useTranslations(lawMapCopy)
  const date = useDate()
  const replaced = statement.cells.some((cell) => cell.validTo !== null)
  return (
    <StatementCard
      says={
        <>
          {t('says', { act: statement.provision ?? statement.actTitle, editions: editionsSentence(map, statement, t), territory: map.territories.get(statement.territoryId)?.name ?? statement.territoryId, date: date(statement.validFrom) })}
          {replaced ? <span className="text-muted-foreground"> {t('laterReplaced')}</span> : null}
        </>
      }
      footer={
        <>
          <ReviewBadge state={statement.review} label={t(`review.${statement.review}`)} />
          <span className="text-muted-foreground text-xs">{t('readOnly')}</span>
        </>
      }
    >
      <StatementFact label={t('source')}>
        <div className="flex flex-col gap-2">
          <span className="text-muted-foreground text-xs">{t(`sourceKind.${statement.sourceKind}`)}</span>
          {statement.sources.length === 0 ? t('noSource') : statement.sources.map((source) => <SourceQuote key={`${source.url}|${source.quote ?? ''}`} {...source} />)}
        </div>
      </StatementFact>
      <StatementFact label={t('deviations')}>
        {statement.deviations.length === 0
          ? t('noDeviations')
          : statement.deviations.map((deviation) => (
              <div key={deviation.relationId}>
                {t('deviationAt', { edition: map.editions.get(deviation.editionId)?.label ?? deviation.editionId, anchors: deviation.anchors.join(', ') })}
                {deviation.provision ? <span className="text-muted-foreground"> · {deviation.provision}</span> : null}
              </div>
            ))}
      </StatementFact>
    </StatementCard>
  )
}
