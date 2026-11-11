'use client'

/**
 * The country as one outline (country-onboarding-ux.md, B): the country, its
 * regions, each region's acts, and a second branch with the works the acts
 * make binding, their editions and each edition's text. Each row says its
 * value once; what a row holds unfolds under it, with its yes or no
 * (`ConfirmBar`) where the request is open for review.
 */

import type { JSX, ReactNode } from 'react'
import { bindingOn, editionOrder, nextChange, summaryOf, summaryOn, type LawMap, type LawMapEdition, type LawMapStatement } from '@/lib/base-knowledge/platform/law-map'
import { useTranslations } from '@/i18n'
import type { Translator } from '@/i18n'
import { lawMapCopy } from '@/i18n/namespaces/law-map'
import type { ReviewUnit } from '@/lib/base-knowledge/platform/law-map-review'
import { AddLine, Branch, OutlineRow, SourceQuote, Unfold, useDate } from './law-map-atoms'
import { ConfirmBar, type ConfirmContext } from './law-map-confirm'
import { AddActForm, AddEditionForm } from './law-map-add-forms'
import { namer, RecordBody } from './law-map-record'
import type { SourceStatusView } from '@/lib/base-knowledge/platform/source-service'

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

/** What the outline's parts share: the map, its review units, what is open, and the way to say yes or no. */
interface Outline {
  map: LawMap
  units: ReadonlyMap<string, ReviewUnit>
  confirm: ConfirmContext
  open: string | null
  flip: (key: string) => void
  t: Translator
  /** The map's day: what binds is read on it. */
  today: string
}

/** A unit's row marks: a dot while it waits for a verdict, a check once confirmed. */
const marks = (unit: ReviewUnit | undefined) => ({ attention: unit?.review === 'open', confirmed: unit?.review === 'accepted' })

function Decide({ o, unitKey, yes }: { o: Outline; unitKey: string; yes: string }): JSX.Element | null {
  const unit = o.units.get(unitKey)
  return unit ? <ConfirmBar unit={unit} context={o.confirm} yes={yes} /> : null
}

function StatementBody({ o, statement }: { o: Outline; statement: LawMapStatement }): JSX.Element {
  const { map, t } = o
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
      <Decide o={o} unitKey={statement.key} yes={t('yesStatement')} />
    </Unfold>
  )
}

function EditionBody({ o, edition }: { o: Outline; edition: LawMapEdition }): JSX.Element {
  const { map, t, today } = o
  const date = useDate()
  // Where it binds on the map's day, not everywhere it ever did.
  const territoryIds = [...new Set(map.statements.map((statement) => statement.territoryId))]
  const lands = territoryIds.filter((id) => bindingOn(map, id, edition.workId, today)?.cell.editionId === edition.id).map((id) => map.territories.get(id)?.name ?? id)
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
      <Decide o={o} unitKey={`edition:${edition.id}`} yes={t('yesEdition', { edition: edition.label })} />
    </Unfold>
  )
}

/** A row that opens its own unfold: the outline's one way to show what something holds. */
function Openable({ o, id, row, children }: { o: Outline; id: string; row: (open: boolean, onClick: () => void) => ReactNode; children: ReactNode }): JSX.Element {
  const isOpen = o.open === id
  return (
    <div id={`row-${id}`}>
      {row(isOpen, () => o.flip(id))}
      {isOpen ? children : null}
    </div>
  )
}

/** A region's own law: its building acts, then the acts that make editions binding there, each unfolding in place. */
function OwnLaw({ o, statutes, statements }: { o: Outline; statutes: LawMap['statutes']; statements: LawMapStatement[] }): JSX.Element {
  const { map, t } = o
  const date = useDate()
  return (
    <>
      {statutes.map((statute) => (
        <Openable key={statute.workId} o={o} id={`statute:${statute.workId}`} row={(isOpen, onClick) => <OutlineRow size="sm" name={statute.title} meta={t('buildingLaw')} value={statute.designation} muted {...marks(o.units.get(`statute:${statute.workId}`))} expanded={isOpen} onClick={onClick} />}>
          <Unfold>
            {statute.url ? (
              <a href={statute.url} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                {statute.url}
              </a>
            ) : null}
            <Decide o={o} unitKey={`statute:${statute.workId}`} yes={t('yesStatute')} />
          </Unfold>
        </Openable>
      ))}
      {statements.map((statement) => {
        const summary = summaryOf(statementEditions(map, statement))
        return (
          <Openable
            key={statement.key}
            o={o}
            id={statement.key}
            row={(isOpen, onClick) => (
              <OutlineRow size="sm" name={statement.provision ?? statement.actTitle} meta={t('fromDate', { date: date(statement.validFrom) })} value={summary.main?.label} exceptions={exceptionsText(map, summary.exceptions)} {...marks(o.units.get(statement.key))} expanded={isOpen} onClick={onClick} testId={`statement-${statement.key}`} />
            )}
          >
            <StatementBody o={o} statement={statement} />
          </Openable>
        )
      })}
    </>
  )
}

const byStart = (a: LawMapStatement, b: LawMapStatement): number => (a.validFrom ?? '').localeCompare(b.validFrom ?? '')
const statutesOn = (map: LawMap, territoryId: string) => map.statutes.filter((statute) => statute.territoryId === territoryId)
const statementsOn = (map: LawMap, territoryId: string) => map.statements.filter((statement) => statement.territoryId === territoryId).sort(byStart)

/** The areas below a region that make law of their own, each with it: nothing under a region is left unreachable. */
function BelowRegion({ o, territoryId }: { o: Outline; territoryId: string }): JSX.Element | null {
  const { map, t } = o
  const territory = map.territories.get(territoryId)
  if (!territory || territory.children.length === 0) return null
  const lawful = territory.children.filter((id) => [...under(map, id)].some((one) => statementsOn(map, one).length > 0 || statutesOn(map, one).length > 0))
  return (
    <>
      <OutlineRow size="sm" muted name={t('below', { count: territory.children.length })} value={lawful.length === 0 ? t('sameAs', { territory: territory.name }) : t('ownLaw', { count: lawful.length })} />
      {lawful.map((id) => (
        <div key={id}>
          <OutlineRow size="sm" name={map.territories.get(id)?.name ?? id} />
          <Branch>
            <OwnLaw o={o} statutes={statutesOn(map, id)} statements={statementsOn(map, id)} />
            <BelowRegion o={o} territoryId={id} />
          </Branch>
        </div>
      ))}
    </>
  )
}

/** Every territory id at and below one, in the tree the map holds. */
function under(map: LawMap, id: string): Set<string> {
  const ids = new Set<string>()
  const walk = (one: string): void => {
    ids.add(one)
    map.territories.get(one)?.children.forEach(walk)
  }
  walk(id)
  return ids
}

/** The branches a unit sits in, so opening it from "next" also shows it. */
/** The regions the outline lists: the root's children, or the topmost territories when the request holds no root. */
export function regionsOf(map: LawMap): string[] {
  // The country is the root when the request holds it; else every topmost region is a region of its own.
  const root = map.territories.get(map.countryId)
  return root ? root.children : map.rootIds
}

export function branchesOf(map: LawMap, unit: ReviewUnit): string[] {
  const regionFor = (territoryId: string): string[] => {
    if (territoryId === map.countryId && map.territories.has(territoryId)) return []
    const region = regionsOf(map).find((id) => under(map, id).has(territoryId))
    return [region ?? 'unplaced']
  }
  if (unit.kind === 'statement') return regionFor(map.statements.find((one) => one.key === unit.key)?.territoryId ?? '')
  if (unit.kind === 'statute') return regionFor(map.statutes.find((statute) => `statute:${statute.workId}` === unit.key)?.territoryId ?? '')
  // A series' own row sits under its work's row: both open, or "next" lands on a row nobody can see.
  if (unit.kind === 'series') return ['works', `work:${unit.key.slice('series:'.length)}`]
  if (unit.kind === 'edition') return ['works', `work:${map.editions.get(unit.key.slice('edition:'.length))?.workId ?? ''}`]
  if (unit.kind === 'record') return ['others']
  return []
}

/** What "+ Add" needs: the country, its sources (a page on their hosts is fetched), and where to go once added. */
export interface AddContext {
  countryId: string
  sources: readonly SourceStatusView[]
  onAdded: () => void
}

/** A quiet row that opens its form in place. */
function AddRow({ o, id, label, children }: { o: Outline; id: string; label: string; children: (close: () => void) => ReactNode }): JSX.Element {
  return o.open === id ? <>{children(() => o.flip(id))}</> : <AddLine label={label} onClick={() => o.flip(id)} testId={id} />
}

export function LawMapOutline({ map, units, confirm, add, today, rootName, expanded, toggle, open, setOpen }: {
  map: LawMap
  add: AddContext | null
  units: ReadonlyMap<string, ReviewUnit>
  confirm: ConfirmContext
  today: string
  rootName: string
  expanded: ReadonlySet<string>
  toggle: (id: string) => void
  open: string | null
  setOpen: (id: string | null) => void
}): JSX.Element {
  const t = useTranslations(lawMapCopy)
  const date = useDate()
  const o: Outline = { map, units, confirm, open, flip: (id) => setOpen(open === id ? null : id), t, today }

  // The country is the root when the request holds it; else every topmost region is a region of its own.
  const rootId = map.countryId
  const root = map.territories.get(rootId)
  const regions = regionsOf(map)
  const placed = new Set([...(root ? [rootId] : []), ...regions.flatMap((id) => [...under(map, id)])])
  // Law on no territory this request holds (its act is in another request): shown, never dropped.
  const unplaced = map.statements.filter((statement) => !placed.has(statement.territoryId)).sort(byStart)
  const unplacedStatutes = map.statutes.filter((statute) => !placed.has(statute.territoryId))
  const others = [...units.values()].filter((unit) => unit.kind === 'record')
  const name = namer(map, [...units.values()].flatMap((unit) => unit.revisions))
  const regionsUnit = units.get('regions')

  return (
    <div className="flex flex-col" data-testid="law-map-outline">
      <Openable o={o} id="regions" row={(isOpen, onClick) => <OutlineRow name={root?.name ?? rootName} size="lg" {...marks(regionsUnit)} expanded={isOpen} onClick={regionsUnit ? onClick : undefined} />}>
        <Unfold>
          <p>{t('regionsSay', { count: map.territories.size, names: [...map.territories.values()].map((territory) => territory.name).join(', ') })}</p>
          <Decide o={o} unitKey="regions" yes={t('yesRegions')} />
        </Unfold>
      </Openable>
      <p className="text-muted-foreground mb-5 max-w-prose text-sm">{t('lead')}</p>
      <Branch>
        {root ? <OwnLaw o={o} statutes={statutesOn(map, rootId)} statements={statementsOn(map, rootId)} /> : null}
        {regions.map((id) => {
          const territory = map.territories.get(id)
          const now = summaryOn(map, id, today)
          const coming = nextChange(map, id, today)
          const comingSummary = coming ? summaryOf(statementEditions(map, coming)) : null
          const statements = statementsOn(map, id)
          const inside = under(map, id)
          const waiting = map.statements.some((statement) => inside.has(statement.territoryId) && units.get(statement.key)?.review === 'open') || map.statutes.some((statute) => inside.has(statute.territoryId) && units.get(`statute:${statute.workId}`)?.review === 'open')
          return (
            <div key={id}>
              <OutlineRow
                name={territory?.name ?? id}
                value={now.main?.label}
                exceptions={exceptionsText(map, now.exceptions)}
                coming={comingSummary?.main ? t('coming', { edition: comingSummary.main.label, date: date(coming?.validFrom ?? null) }) : undefined}
                attention={waiting}
                expanded={expanded.has(id)}
                onClick={() => toggle(id)}
                testId={`region-${id}`}
              />
              {expanded.has(id) ? (
                <Branch>
                  {statements.length === 0 ? <p className="text-muted-foreground py-2.5 text-sm">{t('noActs')}</p> : null}
                  <OwnLaw o={o} statutes={statutesOn(map, id)} statements={statements} />
                  {add ? (
                    <AddRow o={o} id={`add-act-${id}`} label={t('addActTo', { region: territory?.name ?? id })}>
                      {(close) => <AddActForm map={map} territoryId={id} countryId={add.countryId} sources={add.sources} onAdded={add.onAdded} onCancel={close} />}
                    </AddRow>
                  ) : null}
                  <BelowRegion o={o} territoryId={id} />
                </Branch>
              ) : null}
            </div>
          )
        })}
        {unplaced.length + unplacedStatutes.length > 0 ? (
          <div>
            <OutlineRow name={t('unplaced')} value={t('ownActs', { count: unplaced.length + unplacedStatutes.length })} attention={unplaced.some((statement) => units.get(statement.key)?.review === 'open')} expanded={expanded.has('unplaced')} onClick={() => toggle('unplaced')} testId="unplaced" />
            {expanded.has('unplaced') ? (
              <Branch>
                <OwnLaw o={o} statutes={unplacedStatutes} statements={unplaced} />
              </Branch>
            ) : null}
          </div>
        ) : null}
        {map.topics.length > 0 ? (
          <div className="mt-5">
            <OutlineRow name={t('works')} meta={t('worksMeta')} value={t('series', { count: map.topics.length })} attention={[...units.values()].some((unit) => (unit.kind === 'series' || unit.kind === 'edition') && unit.review === 'open')} expanded={expanded.has('works')} onClick={() => toggle('works')} testId="works" />
            {expanded.has('works') ? (
              <Branch>
                {map.topics.map((topic) => {
                  const editions = [...map.editions.values()].filter((edition) => edition.workId === topic.workId).sort((a, b) => editionOrder(a).localeCompare(editionOrder(b)))
                  const key = `work:${topic.workId}`
                  const series = units.get(`series:${topic.workId}`)
                  return (
                    <div key={topic.workId}>
                      <OutlineRow size="sm" name={topic.designation} meta={topic.title} value={t('editions', { count: editions.length })} attention={[series, ...editions.map((edition) => units.get(`edition:${edition.id}`))].some((unit) => unit?.review === 'open')} expanded={expanded.has(key)} onClick={() => toggle(key)} />
                      {expanded.has(key) ? (
                        <Branch>
                          {series ? (
                            <Openable o={o} id={series.key} row={(isOpen, onClick) => <OutlineRow size="sm" muted name={t('theSeries', { designation: topic.designation })} meta={topic.title} {...marks(series)} expanded={isOpen} onClick={onClick} />}>
                              <Unfold>
                                <Decide o={o} unitKey={series.key} yes={t('yesSeries')} />
                              </Unfold>
                            </Openable>
                          ) : null}
                          {editions.map((edition) => (
                            <Openable key={edition.id} o={o} id={`edition:${edition.id}`} row={(isOpen, onClick) => <OutlineRow size="sm" name={edition.label} meta={edition.text?.file ?? undefined} {...marks(units.get(`edition:${edition.id}`))} expanded={isOpen} onClick={onClick} />}>
                              <EditionBody o={o} edition={edition} />
                            </Openable>
                          ))}
                          {add ? (
                            <AddRow o={o} id={`add-edition-${topic.workId}`} label={t('addEditionOf', { designation: topic.designation })}>
                              {(close) => <AddEditionForm workId={topic.workId} designation={topic.designation} countryId={add.countryId} onAdded={add.onAdded} onCancel={close} />}
                            </AddRow>
                          ) : null}
                        </Branch>
                      ) : null}
                    </div>
                  )
                })}
              </Branch>
            ) : null}
          </div>
        ) : null}
        {others.length > 0 ? (
          <div className="mt-5">
            <OutlineRow name={t('others')} value={t('records', { count: others.length })} attention={others.some((unit) => unit.review === 'open')} expanded={expanded.has('others')} onClick={() => toggle('others')} testId="others" />
            {expanded.has('others') ? (
              <Branch>
                {others.map((unit) => (
                  <Openable key={unit.key} o={o} id={unit.key} row={(isOpen, onClick) => <OutlineRow size="sm" name={unit.label} meta={t(`recordType.${unit.revisions[0]?.type ?? 'work'}`)} {...marks(unit)} expanded={isOpen} onClick={onClick} />}>
                    <Unfold>
                      {unit.revisions.map((revision) => (
                        <RecordBody key={revision.revisionId} revision={revision} name={name} />
                      ))}
                      <Decide o={o} unitKey={unit.key} yes={t('yesRecord')} />
                    </Unfold>
                  </Openable>
                ))}
              </Branch>
            ) : null}
          </div>
        ) : null}
      </Branch>
    </div>
  )
}
