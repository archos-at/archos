'use client'

/**
 * A record the outline has no branch for (a source, a test question, a rule,
 * an authority), said in words under its row: where a source fetches from, on
 * what licence, whether it is watched, the documents it may fetch and the test
 * that proves it; what a test question asks and what a right answer says.
 * The record's fields as stored stay one click away, behind "Technical
 * details", never as the first thing a reviewer reads.
 */

import type { JSX, ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { useTranslations } from '@/i18n'
import type { Translator } from '@/i18n'
import { lawMapCopy } from '@/i18n/namespaces/law-map'
import type { LawMap } from '@/lib/base-knowledge/platform/law-map'
import type { RevisionView } from '@/lib/base-knowledge/platform/wire'
import { useDate } from './law-map-atoms'

type Body = Record<string, unknown>

const isObject = (value: unknown): value is Body => typeof value === 'object' && value !== null && !Array.isArray(value)
const text = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 ? value : null)
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const strings = (value: unknown): string[] => list(value).filter((one): one is string => typeof one === 'string')
const bodyOf = (revision: RevisionView): Body => Object.fromEntries(revision.claims.map((claim) => [claim.path, claim.value]))

/**
 * A record id in words, never the id where the request names it: a region by its name, a work by its designation
 * or title, an edition as its work and label ("Erläuternde Bemerkungen zu OIB-Richtlinie 1 · Ausgabe Mai 2023"),
 * a text as its edition, else as its file.
 */
export function namer(map: LawMap, revisions: readonly RevisionView[]): (id: string) => string {
  const byId = new Map(revisions.map((revision) => [revision.recordId, bodyOf(revision)]))
  const workName = (body: Body | undefined): string | null => {
    const identifiers = isObject(body?.identifiers) ? body.identifiers : {}
    return text(identifiers.designation) ?? text(body?.title) ?? text(body?.name)
  }
  const name = (id: string): string => {
    const territory = map.territories.get(id)
    if (territory) return territory.name
    const body = byId.get(id)
    const edition = map.editions.get(id)
    if (edition || (body && text(body.workId))) {
      const workId = edition?.workId ?? String(body?.workId)
      const work = map.topics.find((topic) => topic.workId === workId)?.designation ?? workName(byId.get(workId))
      return [work, edition?.label ?? text(body?.label)].filter(Boolean).join(' · ') || id
    }
    if (body && text(body.editionId)) return byId.has(String(body.editionId)) || map.editions.has(String(body.editionId)) ? name(String(body.editionId)) : (text(body.corpusFile) ?? id)
    return workName(body) ?? text(body?.label) ?? text(body?.question) ?? id
  }
  return name
}

/** One line of a record in words, with its label when it has one. */
function Line({ label, children }: { label?: string; children: ReactNode }): JSX.Element {
  return (
    <p className="break-words">
      {label ? <span className="text-muted-foreground">{label}: </span> : null}
      {children}
    </p>
  )
}

function ExternalLink({ href, children }: { href: string; children: ReactNode }): JSX.Element {
  return /^https?:\/\//.test(href) ? (
    <a href={href} target="_blank" rel="noreferrer" className="underline underline-offset-2">
      {children}
    </a>
  ) : (
    <>{children}</>
  )
}

/** What one recorded test proves, in a line: "OIB-RL 2 reads with ≥ 30 passages". */
function testLine(fixture: Body, documents: ReadonlyMap<string, string>, t: Translator): string {
  const args = isObject(fixture.args) ? fixture.args : {}
  const expect = isObject(fixture.expect) ? fixture.expect : {}
  const subject = documents.get(String(args.id ?? '')) ?? text(args.id) ?? text(fixture.name) ?? ''
  if (typeof expect.min_passages === 'number') return t('record.source.testPassages', { subject, count: expect.min_passages })
  if (text(expect.title)) return t('record.source.testTitle', { subject, title: String(expect.title) })
  return t('record.source.test', { subject })
}

function SourceRecord({ body }: { body: Body }): JSX.Element {
  const t = useTranslations(lawMapCopy)
  const config = isObject(body.config) ? body.config : {}
  const terms = isObject(config.terms) ? config.terms : {}
  const access = isObject(config.access) ? config.access : {}
  const documents = list(access.documents).filter(isObject)
  const titles = new Map(documents.map((document) => [String(document.id ?? ''), text(document.title) ?? String(document.id ?? '')]))
  const licence = text(body.licence) ?? text(terms.licence)
  const hours = typeof body.monitorIntervalHours === 'number' ? body.monitorIntervalHours : 24
  return (
    <div className="flex flex-col gap-2">
      <Line>{t('record.source.fetchedFrom', { hosts: strings(body.hosts).join(', ') })}</Line>
      {licence ? (
        <Line label={t('record.source.licence')}>
          {licence === 'public_open' || licence === 'public_restricted' ? t(`record.source.licences.${licence}`) : licence}
          {text(terms.attribution) ? (
            <>
              {' · '}
              {t('record.quoted', { text: String(terms.attribution) })}
            </>
          ) : null}
          {text(terms.url) ? (
            <>
              {' · '}
              <ExternalLink href={String(terms.url)}>{t('record.source.terms')}</ExternalLink>
            </>
          ) : null}
        </Line>
      ) : null}
      <Line label={t('record.source.monitoring')}>{body.monitorKind === 'none' || !text(body.monitorKind) ? t('record.source.off') : t('record.source.every', { count: hours })}</Line>
      {body.dataFlow === 'site_keyed' ? <Line>{t('record.source.siteKeyed')}</Line> : null}
      {documents.length > 0 ? (
        <div className="flex flex-col gap-1">
          <p className="text-muted-foreground">{t('record.source.documents', { count: documents.length })}</p>
          <ul className="flex list-disc flex-col gap-0.5 pl-5">
            {documents.map((document) => (
              <li key={String(document.id ?? document.url)} className="break-words">
                <ExternalLink href={String(document.url ?? '')}>{text(document.title) ?? String(document.id ?? document.url ?? '')}</ExternalLink>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {list(config.fixtures)
        .filter(isObject)
        .map((fixture, index) => (
          <Line key={String(fixture.name ?? index)}>{testLine(fixture, titles, t)}</Line>
        ))}
    </div>
  )
}

function GoldenCaseRecord({ body, name }: { body: Body; name: (id: string) => string }): JSX.Element {
  const t = useTranslations(lawMapCopy)
  const date = useDate()
  const context = isObject(body.context) ? body.context : {}
  const expected = isObject(body.expected) ? body.expected : {}
  const facts = isObject(context.facts) ? Object.entries(context.facts) : []
  const edition = isObject(expected.edition) ? expected.edition : null
  const said = (value: unknown) => strings(isObject(value) ? value.anyOf : []).map((one) => t('record.quoted', { text: one })).join(' / ')
  return (
    <div className="flex flex-col gap-2">
      <q className="font-medium">{text(body.question) ?? ''}</q>
      <Line label={t('record.case.askedFor')}>
        {[text(context.territoryId) ? name(String(context.territoryId)) : t('record.case.noSite'), text(context.referenceDate) ? t('record.case.on', { date: date(String(context.referenceDate)) }) : null].filter(Boolean).join(', ')}
      </Line>
      {facts.length > 0 ? <Line label={t('record.case.facts')}>{facts.map(([key, value]) => `${key} = ${String(value)}`).join(', ')}</Line> : null}
      {text(context.note) ? <Line label={t('record.case.note')}>{String(context.note)}</Line> : null}
      {list(expected.values)
        .filter(isObject)
        .map((value, index) => (
          <Line key={`value-${index}`} label={text(value.label) ?? t('record.case.says')}>
            {said(value)}
          </Line>
        ))}
      {edition ? <Line label={t('record.case.restsOn')}>{`${name(`edition:${String(edition.editionKey ?? '')}`)} (${said(edition)})`}</Line> : null}
      {list(expected.citations)
        .filter(isObject)
        .map((citation, index) => (
          <Line key={`citation-${index}`} label={t('record.case.cites')}>
            {[text(citation.designation), text(citation.locus)].filter(Boolean).join(' ')}
          </Line>
        ))}
      {list(body.mustNot)
        .filter(isObject)
        .map((rule, index) => (
          <Line key={`not-${index}`} label={t('record.case.mustNot')}>
            {rule.kind === 'source' ? t('record.case.notCite', { kinds: strings(rule.sourceKinds).join(', ') }) : t('record.case.notSay', { phrases: said(rule) })}
          </Line>
        ))}
    </div>
  )
}

function RulesetRecord({ body, name }: { body: Body; name: (id: string) => string }): JSX.Element {
  const t = useTranslations(lawMapCopy)
  const date = useDate()
  const from = text(body.validFrom)
  const to = text(body.validTo)
  return (
    <div className="flex flex-col gap-2">
      {text(body.purpose) ? <Line label={t('record.rule.purpose')}>{String(body.purpose)}</Line> : null}
      {strings(body.territoryIds).length > 0 ? <Line label={t('record.rule.appliesIn')}>{strings(body.territoryIds).map(name).join(', ')}</Line> : null}
      {strings(body.workIds).length > 0 ? <Line label={t('record.rule.for')}>{strings(body.workIds).map(name).join(', ')}</Line> : null}
      {from || to ? <Line label={t('record.rule.valid')}>{`${date(from)} – ${to ? date(to) : t('record.rule.open')}`}</Line> : null}
      {text(body.basisEditionId) ? <Line label={t('record.rule.basis')}>{name(String(body.basisEditionId))}</Line> : null}
      <Line>{body.inherits === 'parent' ? t('record.rule.inherits') : t('record.rule.table', { schema: text(body.payloadSchema) ?? '–' })}</Line>
    </div>
  )
}

function AuthorityRecord({ body, name }: { body: Body; name: (id: string) => string }): JSX.Element {
  const t = useTranslations(lawMapCopy)
  return (
    <div className="flex flex-col gap-2">
      {text(body.seatTerritoryId) ? <Line label={t('record.authority.seat')}>{name(String(body.seatTerritoryId))}</Line> : null}
      {strings(body.competenceTerritoryIds).length > 0 ? <Line label={t('record.authority.competent')}>{strings(body.competenceTerritoryIds).map(name).join(', ')}</Line> : null}
      {strings(body.functionCodes).length > 0 ? <Line label={t('record.authority.functions')}>{strings(body.functionCodes).join(', ')}</Line> : null}
    </div>
  )
}

/** Any other record: the fields that read as words; whatever is structured stays in the technical details. */
function PlainRecord({ revision, name }: { revision: RevisionView; name: (id: string) => string }): JSX.Element {
  const plain = revision.claims.filter((claim) => ['string', 'number', 'boolean'].includes(typeof claim.value) || strings(claim.value).length === list(claim.value).length)
  return (
    <div className="flex flex-col gap-1">
      {plain.map((claim) => (
        <Line key={claim.path} label={claim.path}>
          {Array.isArray(claim.value) ? strings(claim.value).map(name).join(', ') || '–' : typeof claim.value === 'string' ? name(claim.value) : String(claim.value)}
        </Line>
      ))}
    </div>
  )
}

/** The record as stored, folded: for whoever needs the configuration itself. */
export function TechnicalDetails({ revision }: { revision: RevisionView }): JSX.Element {
  const t = useTranslations(lawMapCopy)
  return (
    <Collapsible>
      <CollapsibleTrigger className="text-muted-foreground hover:text-foreground group flex items-center gap-1 text-xs" data-testid={`technical-${revision.recordId}`}>
        <ChevronRight className="size-3.5 transition-transform group-data-[state=open]:rotate-90" aria-hidden />
        {t('record.technical')}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <pre className="bg-background mt-2 max-h-96 overflow-auto rounded-md p-3 text-xs whitespace-pre-wrap break-words">{JSON.stringify(bodyOf(revision), null, 2)}</pre>
      </CollapsibleContent>
    </Collapsible>
  )
}

/** A record in words, then its technical details. */
export function RecordBody({ revision, name }: { revision: RevisionView; name: (id: string) => string }): JSX.Element {
  const body = bodyOf(revision)
  const words =
    revision.type === 'source' ? (
      <SourceRecord body={body} />
    ) : revision.type === 'golden_case' ? (
      <GoldenCaseRecord body={body} name={name} />
    ) : revision.type === 'ruleset' ? (
      <RulesetRecord body={body} name={name} />
    ) : revision.type === 'authority' ? (
      <AuthorityRecord body={body} name={name} />
    ) : (
      <PlainRecord revision={revision} name={name} />
    )
  return (
    <div className="flex flex-col gap-3" data-testid={`record-${revision.recordId}`}>
      {words}
      <TechnicalDetails revision={revision} />
    </div>
  )
}
