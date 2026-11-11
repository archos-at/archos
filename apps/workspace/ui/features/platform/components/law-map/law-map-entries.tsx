'use client'

/**
 * What a confirmation covers, shown before it is given: every record of the
 * unit with each field in words, an act's bindings as one line each, and every
 * source once with its quote. A row says its
 * value once; this is where a reviewer reads everything the yes accepts
 * (a licence, a date in force, a region's parents), folded until asked for.
 */

import type { JSX } from 'react'
import { useState } from 'react'
import { useTranslations } from '@/i18n'
import { lawMapCopy } from '@/i18n/namespaces/law-map'
import type { LawMap } from '@/lib/base-knowledge/platform/law-map'
import type { ReviewUnit } from '@/lib/base-knowledge/platform/law-map-review'
import type { CaptureView, RevisionView } from '@/lib/base-knowledge/platform/wire'
import { SourceQuote } from './law-map-atoms'

/** The fields a reviewer reads, in the order they read best; anything else follows under its own path. */
const FIELDS = [
  'name',
  'title',
  'kind',
  'identifiers',
  'label',
  'issuer',
  'competenceTerritoryIds',
  'seatTerritoryId',
  'functionCodes',
  'territoryIds',
  'addressees',
  'parents',
  'issuedOn',
  'inForceFrom',
  'inForceTo',
  'validFrom',
  'validTo',
  'workId',
  'editionId',
  'form',
  'language',
  'licenceClass',
  'corpusFile',
  'aliases',
] as const

const rank = (path: string): number => {
  const at = (FIELDS as readonly string[]).indexOf(path)
  return at < 0 ? FIELDS.length : at
}

/** The machine's half of a relation: the record says it, the reviewer does not need to read it. */
const HIDDEN = new Set(['relationType', 'mode', 'fromType', 'toType', 'fromId'])

/** A record id in words: a region, an edition or a work by its name, else the id. */
function nameOfId(id: string, map: LawMap): string | null {
  const territory = map.territories.get(id)
  if (territory) return `${territory.name} (${id})`
  const edition = map.editions.get(id)
  if (edition) {
    const work = [...map.topics, ...map.otherWorks].find((one) => one.workId === edition.workId)
    return [work?.designation, edition.label].filter(Boolean).join(' ')
  }
  return [...map.topics, ...map.otherWorks].find((one) => one.workId === id)?.designation ?? null
}

/** A value in words: an id by its name, a list as a list, a designation or a dated parent as it reads. */
export function valueText(value: unknown, map: LawMap): string {
  if (value === null || value === undefined || value === '') return '–'
  if (typeof value === 'string') return nameOfId(value, map) ?? value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map((one) => valueText(one, map)).join(', ')
  if (typeof value === 'object') {
    const body = value as Record<string, unknown>
    // A parent link reads as its region, with its date when it has one.
    if (typeof body.id === 'string') return [valueText(body.id, map), typeof body.validFrom === 'string' ? `(${body.validFrom})` : null].filter(Boolean).join(' ')
    return Object.values(body).map((one) => valueText(one, map)).join(' · ')
  }
  return String(value)
}

const wrongIn = (revision: RevisionView): boolean => revision.claims.some((claim) => claim.decision === 'rejected' || claim.decision === 'edited')
const claimOf = (revision: RevisionView, path: string): unknown => revision.claims.find((claim) => claim.path === path)?.value

/** A binding as one line: what it makes binding, from when to when, under which provision. */
function Binding({ revision, map }: { revision: RevisionView; map: LawMap }): JSX.Element {
  const t = useTranslations(lawMapCopy)
  const from = claimOf(revision, 'validFrom')
  const to = claimOf(revision, 'validTo')
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 text-xs" data-testid={`entry-${revision.recordId}`}>
      <span className="break-words">
        {valueText(claimOf(revision, 'toId'), map)}
        {wrongIn(revision) ? <span className="text-destructive"> · {t('claimRejected')}</span> : null}
      </span>
      <span className="text-muted-foreground tabular-nums">{[valueText(from, map), to ? valueText(to, map) : null].filter(Boolean).join(' – ')}</span>
    </li>
  )
}

/** The unit's sources, each once, however many of its records cite it. */
export function Sources({ revisions, captures }: { revisions: RevisionView[]; captures: ReadonlyMap<string, CaptureView> }): JSX.Element | null {
  const t = useTranslations(lawMapCopy)
  const seen = new Map<string, { url: string; quote: string | null; note: string | null }>()
  for (const citation of revisions.flatMap((revision) => revision.citations)) {
    const capture = citation.captureId ? captures.get(citation.captureId) : undefined
    const url = citation.url ?? capture?.url ?? null
    if (!url) continue
    const note = [citation.note ?? null, capture && !capture.countsAsFetched ? t('pasted') : null].filter(Boolean).join(' · ') || null
    const key = `${url}|${citation.quote ?? ''}`
    if (!seen.has(key)) seen.set(key, { url, quote: citation.quote ?? null, note })
  }
  if (seen.size === 0) return null
  return (
    <div className="flex flex-col gap-2">
      {[...seen.entries()].map(([key, source]) => (
        <SourceQuote key={key} url={source.url} quote={source.quote} note={source.note} />
      ))}
    </div>
  )
}

function Record({ revision, map }: { revision: RevisionView; map: LawMap }): JSX.Element {
  const t = useTranslations(lawMapCopy)
  const claims = [...revision.claims].filter((claim) => !HIDDEN.has(claim.path)).sort((a, b) => rank(a.path) - rank(b.path))
  return (
    <li className="flex flex-col gap-2" data-testid={`entry-${revision.recordId}`}>
      <p className="text-muted-foreground text-xs">{t(`recordType.${revision.type}`)}</p>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-xs">
        {claims.map((claim) => (
          <div key={claim.path} className="contents">
            <dt className="text-muted-foreground">{rank(claim.path) < FIELDS.length ? t(`fields.${claim.path}`) : claim.path}</dt>
            <dd className="break-words">
              {valueText(claim.value, map)}
              {claim.decision === 'rejected' || claim.decision === 'edited' ? <span className="text-destructive"> · {t('claimRejected')}</span> : null}
            </dd>
          </div>
        ))}
      </dl>
      {revision.citations.length === 0 ? <p className="text-warning text-xs">{t('noSource')}</p> : null}
    </li>
  )
}

export function Entries({ unit, map, captures }: { unit: ReviewUnit; map: LawMap; captures: ReadonlyMap<string, CaptureView> }): JSX.Element {
  const t = useTranslations(lawMapCopy)
  const [shown, setShown] = useState(false)
  // An act's bindings read as lines of one table; every other record as its fields.
  const bindings = unit.revisions.filter((revision) => revision.type === 'relation' && claimOf(revision, 'relationType') === 'makes_binding')
  const records = unit.revisions.filter((revision) => !bindings.includes(revision))
  return (
    <div className="flex flex-col gap-3">
      <button type="button" className="text-muted-foreground hover:text-foreground self-start text-xs underline underline-offset-2" aria-expanded={shown} onClick={() => setShown((now) => !now)} data-testid={`entries-${unit.key}`}>
        {shown ? t('hideEntries') : t('entries', { count: unit.revisions.length })}
      </button>
      {shown ? (
        <div className="flex flex-col gap-4 border-l pl-3">
          {bindings.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <p className="text-muted-foreground text-xs">{t('bindings', { count: bindings.length })}</p>
              <ul className="flex flex-col gap-1">
                {bindings.map((revision) => (
                  <Binding key={revision.revisionId} revision={revision} map={map} />
                ))}
              </ul>
              {bindings.some((revision) => revision.citations.length === 0) ? <p className="text-warning text-xs">{t('noSource')}</p> : null}
            </div>
          ) : null}
          {records.length > 0 ? (
            <ul className="flex flex-col gap-4">
              {records.map((revision) => (
                <Record key={revision.revisionId} revision={revision} map={map} />
              ))}
            </ul>
          ) : null}
          <Sources revisions={unit.revisions} captures={captures} />
        </div>
      ) : null}
    </div>
  )
}
